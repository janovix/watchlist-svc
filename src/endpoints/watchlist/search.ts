import { OpenAPIRoute, ApiException } from "chanfana";
import { AppContext } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import { ofacMatch } from "./searchOfac";
import { unscMatch } from "./searchUnsc";
import { sat69bMatch } from "./searchSat69b";
import { createUsageRightsClient } from "../../lib/usage-rights-client";
import { performSearch } from "../../lib/search-core";

// Tipos para los targets
type _OfacTargetType = {
	id: string;
	partyType: string;
	primaryName: string;
	aliases: string[] | null;
	birthDate: string | null;
	birthPlace: string | null;
	addresses: string[] | null;
	identifiers: Array<{
		type?: string;
		number?: string;
		country?: string;
		issueDate?: string;
		expirationDate?: string;
	}> | null;
	remarks: string | null;
	sourceList: string;
	createdAt: string;
	updatedAt: string;
};

type _UnscTargetType = {
	id: string;
	partyType: string;
	primaryName: string;
	aliases: string[] | null;
	birthDate: string | null;
	birthPlace: string | null;
	gender: string | null;
	nationalities: string[] | null;
	addresses: string[] | null;
	identifiers: Array<{ type?: string; number?: string }> | null;
	designations: string[] | null;
	remarks: string | null;
	unListType: string;
	referenceNumber: string | null;
	listedOn: string | null;
	createdAt: string;
	updatedAt: string;
};

type _Sat69bTargetType = {
	id: string;
	rfc: string;
	taxpayerName: string;
	taxpayerStatus: string;
	presumptionPhase: {
		satNotice: string | null;
		satDate: string | null;
		dofNotice: string | null;
		dofDate: string | null;
	} | null;
	rebuttalPhase: {
		satNotice: string | null;
		satDate: string | null;
		dofNotice: string | null;
		dofDate: string | null;
	} | null;
	definitivePhase: {
		satNotice: string | null;
		satDate: string | null;
		dofNotice: string | null;
		dofDate: string | null;
	} | null;
	favorablePhase: {
		satNotice: string | null;
		satDate: string | null;
		dofNotice: string | null;
		dofDate: string | null;
	} | null;
	createdAt: string;
	updatedAt: string;
};

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
					topK: z.number().int().min(1).max(100).optional().default(20),
					threshold: z.number().min(0).max(1).optional().default(0.7),
				}),
			),
		},
		responses: {
			"200": {
				description: "Search results with hybrid scoring, separated by dataset",
				...contentJson({
					success: Boolean,
					result: z.object({
						queryId: z
							.string()
							.describe("Persistent query ID for result aggregation"),
						ofac: z.object({
							matches: z.array(ofacMatch),
							count: z.number(),
						}),
						unsc: z.object({
							matches: z.array(unscMatch),
							count: z.number(),
						}),
						sat69b: z.object({
							matches: z.array(sat69bMatch),
							count: z.number(),
						}),
						pepSearch: z
							.object({
								searchId: z.string(),
								status: z.enum(["completed", "pending"]),
								results: z.any().nullable(),
							})
							.optional(),
						pepAiSearch: z
							.object({
								searchId: z.string(),
								status: z.enum(["completed", "pending", "skipped"]),
								result: z.any().nullable(),
							})
							.optional(),
						adverseMediaSearch: z
							.object({
								searchId: z.string(),
								status: z.enum(["completed", "pending"]),
								result: z.any().nullable(),
							})
							.optional(),
					}),
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
				return c.json(
					{
						success: false,
						error: gateResult.error ?? "usage_limit_exceeded",
						code: "USAGE_LIMIT_EXCEEDED",
						upgradeRequired: true,
						metric: "watchlistQueries",
						used: gateResult.used,
						limit: gateResult.limit,
						entitlementType: gateResult.entitlementType,
						message:
							"Daily watchlist query limit reached. Please upgrade or try again tomorrow.",
					},
					403,
				);
			}

			// Call shared search core with source='manual' for UI-initiated searches
			const user = c.get("user");
			const entityType =
				(data.body as unknown as { entityType?: string }).entityType ??
				"person";

			const result = await performSearch({
				env: c.env,
				executionCtx: c.executionCtx,
				organizationId: organization.id,
				userId: user?.id ?? "unknown",
				source: "manual",
				query: data.body.q,
				entityType,
				birthDate: data.body.birthDate,
				countries: data.body.countries,
				identifiers: data.body.identifiers,
				topK: data.body.topK,
				threshold: data.body.threshold,
				requestOrigin: new URL(c.req.url).origin,
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
