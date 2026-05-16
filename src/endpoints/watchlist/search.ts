import { OpenAPIRoute, ApiException } from "chanfana";
import { AppContext } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import {
	buildGateDenialBody,
	createUsageRightsClient,
} from "../../lib/usage-rights-client";
import { performSearch } from "../../lib/search-core";
import { QUERY_SOURCE } from "../../lib/query-source";
import { hybridWatchlistSearchResultSchema } from "./schemas";

export class SearchEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Search"],
		summary:
			"Hybrid semantic search for watchlist targets using identifier lookup, vector search, and Jaro-Winkler name similarity",
		operationId: "searchTargets",
		request: {
			body: contentJson(
				z.object({
					q: z.string().min(1, "Query string is required"),
					dataset: z.enum(["ofac_sdn", "unsc", "sat_69b"]).optional(),
					entityType: z
						.enum(["person", "organization"])
						.optional()
						.default("person")
						.describe("Entity type for adverse media search"),
					countries: z.array(z.string()).optional(),
					birthDate: z.string().optional(),
					identifiers: z.array(z.string()).optional(),
					topK: z.number().int().min(1).max(100).optional().default(50),
					threshold: z.number().min(0).max(1).optional().default(0.875),
				}),
			),
		},
		responses: {
			"200": {
				description: "Search results with hybrid scoring, separated by dataset",
				...contentJson({
					success: Boolean,
					result: hybridWatchlistSearchResultSchema,
				}),
			},
			"400": {
				description: "Bad request",
				...contentJson({
					success: Boolean,
					errors: z.array(
						z.object({
							code: z.number(),
							message: z.string(),
						}),
					),
				}),
			},
			"503": {
				description: "Service unavailable - Required services not configured",
				...contentJson({
					success: Boolean,
					errors: z.array(
						z.object({
							code: z.number(),
							message: z.string(),
						}),
					),
				}),
			},
		},
	};

	public async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();

		console.log("[Search] Starting hybrid search", {
			q: data.body.q,
			topK: data.body.topK,
			threshold: data.body.threshold,
			hasIdentifiers: !!data.body.identifiers,
		});

		try {
			// Check usage rights: gate-and-meter for watchlist queries
			const organization = c.get("organization");
			if (!organization) {
				const error = new ApiException("Organization context required");
				error.status = 403;
				error.code = 403;
				throw error;
			}

			const usageRights = createUsageRightsClient(c.env);
			const gateResult = await usageRights.gate(
				organization.id,
				"watchlistQueries",
			);

			if (!gateResult.allowed) {
				const body = buildGateDenialBody("watchlistQueries", gateResult);
				if (body.code === "USAGE_LIMIT_EXCEEDED") {
					body.message =
						"Daily watchlist query limit reached. Please upgrade or try again tomorrow.";
				}
				return c.json(body, 403);
			}

			// Call shared search core with source='watchlist_query' for UI-initiated searches
			const user = c.get("user");
			const entityType =
				(data.body as unknown as { entityType?: string }).entityType ??
				"person";

			const result = await performSearch({
				env: c.env,
				executionCtx: c.executionCtx,
				organizationId: organization.id,
				userId: user?.id ?? "unknown",
				source: QUERY_SOURCE.WATCHLIST_QUERY,
				query: data.body.q,
				entityType,
				birthDate: data.body.birthDate,
				countries: data.body.countries,
				identifiers: data.body.identifiers,
				topK: data.body.topK,
				threshold: data.body.threshold,
				environment: c.get("environment") || "production",
			});

			return {
				success: true,
				result,
			};
		} catch (error) {
			console.error("[Search] Error during search", {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});

			// Re-throw ApiException as-is
			if (error instanceof ApiException) {
				throw error;
			}

			// Wrap other errors
			const apiError = new ApiException(
				error instanceof Error
					? error.message
					: "An unexpected error occurred during search",
			);
			apiError.status = 500;
			apiError.code = 500;
			throw apiError;
		}
	}
}
