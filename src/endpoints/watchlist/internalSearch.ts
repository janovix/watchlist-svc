/**
 * Internal search endpoint for aml-svc.
 *
 * This endpoint is called by aml-svc via service binding when a client or UBO
 * is created/updated. It bypasses usage rights checks and sets source='aml-screening'.
 *
 * Authentication: None (internal endpoint, secured via service binding)
 */

import { OpenAPIRoute, ApiException } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";
import { contentJson } from "chanfana";
import { performSearch } from "../../lib/search-core";
import type { Bindings } from "../../index";
import { ofacMatch } from "./searchOfac";
import { unscMatch } from "./searchUnsc";
import { sat69bMatch } from "./searchSat69b";

export class InternalSearchEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Internal search endpoint for automated AML screening",
		description:
			"Called by aml-svc via service binding when a client or UBO is created/updated. " +
			"Bypasses usage rights checks and sets source='aml-screening' on the SearchQuery record.",
		security: [],
		request: {
			body: contentJson(
				z.object({
					q: z.string().min(1, "Query string is required"),
					entityType: z
						.enum(["person", "organization"])
						.optional()
						.default("person"),
					source: z
						.string()
						.optional()
						.describe(
							"Source of the search (e.g., 'aml:client', 'aml:bc', 'manual')",
						),
					birthDate: z.string().optional(),
					countries: z.array(z.string()).optional(),
					identifiers: z.array(z.string()).optional(),
					topK: z.number().int().min(1).max(100).optional().default(20),
					threshold: z.number().min(0).max(1).optional().default(0.85),
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
				description:
					"Bad request - missing required headers or invalid payload",
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

	public async handle(c: Context<{ Bindings: Bindings }>) {
		// Read organizationId and userId from headers (set by aml-svc)
		const organizationId = c.req.header("X-Organization-Id");
		const userId = c.req.header("X-User-Id");

		if (!organizationId) {
			const error = new ApiException("X-Organization-Id header is required");
			error.status = 400;
			error.code = 400;
			throw error;
		}

		if (!userId) {
			const error = new ApiException("X-User-Id header is required");
			error.status = 400;
			error.code = 400;
			throw error;
		}

		// Get validated request data using Chanfana's schema validation
		const data = await this.getValidatedData<typeof this.schema>();
		const {
			q,
			entityType = "person",
			source,
			birthDate,
			countries,
			identifiers,
			topK = 20,
			threshold = 0.85,
		} = data.body as {
			q: string;
			entityType?: string;
			source?: string;
			birthDate?: string;
			countries?: string[];
			identifiers?: string[];
			topK?: number;
			threshold?: number;
		};

		console.log("[InternalSearch] Starting automated AML screening", {
			q,
			organizationId,
			userId,
			entityType,
			source,
			topK,
			threshold,
			hasIdentifiers: !!identifiers,
		});

		try {
			// Call shared search core with source from request or default to 'aml-screening'
			const result = await performSearch({
				env: c.env,
				executionCtx: c.executionCtx,
				organizationId,
				userId,
				source: source || "aml-screening",
				query: q,
				entityType,
				birthDate,
				countries,
				identifiers,
				topK,
				threshold,
			});

			return Response.json({
				success: true,
				result,
			});
		} catch (error) {
			console.error("[InternalSearch] Error during search", {
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
