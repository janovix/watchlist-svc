import { OpenAPIRoute, ApiException } from "chanfana";
import { AppContext } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import { GrokService } from "../../lib/grok-service";
import { watchlistTarget } from "./base";
import { createPrismaClient } from "../../lib/prisma";
import { transformWatchlistTarget } from "../../lib/transformers";
import { requireAuth } from "../../lib/auth";

export class PepSearchEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["PEP"],
		summary:
			"Search for PEP (Politically Exposed Person) status using Vectorize first, then Grok API as fallback",
		operationId: "searchPEP",
		request: {
			body: contentJson(
				z.object({
					query: z.string().min(1, "Query string is required"),
				}),
			),
		},
		responses: {
			"200": {
				description: "PEP search results",
				...contentJson({
					success: Boolean,
					result: z.object({
						target: watchlistTarget,
						pepStatus: z.boolean(),
						pepDetails: z.string().optional(),
						matchConfidence: z.enum(["exact", "possible"]),
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
			"401": {
				description: "Unauthorized - Invalid or missing session",
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
		// Require authentication
		await requireAuth(c);
		const data = await this.getValidatedData<typeof this.schema>();

		console.log("[PepSearch] Starting PEP search", {
			query: data.body.query,
		});

		try {
			// First, try Vectorize search
			if (!c.env.AI) {
				console.error("[PepSearch] AI binding not available");
				const error = new ApiException(
					"AI binding not available. Please ensure Workers AI is enabled for your account.",
				);
				error.status = 503;
				error.code = 503;
				throw error;
			}

			if (!c.env.WATCHLIST_VECTORIZE) {
				console.error("[PepSearch] WATCHLIST_VECTORIZE not available");
				const error = new ApiException(
					"Vectorize index not available. Please ensure WATCHLIST_VECTORIZE is configured.",
				);
				error.status = 503;
				error.code = 503;
				throw error;
			}

			console.log("[PepSearch] Generating embedding for query");
			const queryResponse = (await c.env.AI.run("@cf/baai/bge-base-en-v1.5", {
				text: [data.body.query],
			})) as { data: number[][] };

			if (
				!queryResponse ||
				!Array.isArray(queryResponse.data) ||
				queryResponse.data.length === 0
			) {
				console.error("[PepSearch] Failed to generate query embedding");
				const error = new ApiException("Failed to generate query embedding");
				error.status = 500;
				error.code = 500;
				throw error;
			}

			const embedding = queryResponse.data[0] as number[];
			console.log("[PepSearch] Embedding generated", {
				embeddingLength: embedding.length,
			});

			console.log("[PepSearch] Querying Vectorize");
			const vectorizeResults = await c.env.WATCHLIST_VECTORIZE.query(
				embedding,
				{
					topK: 10,
					returnMetadata: true,
				},
			);

			console.log("[PepSearch] Vectorize query completed", {
				vectorizeMatchesCount: vectorizeResults.matches.length,
			});

			// If we found matches in Vectorize, return the first match
			if (vectorizeResults.matches.length > 0) {
				const prisma = createPrismaClient(c.env.DB);
				const firstMatch = vectorizeResults.matches[0];
				const matchScore = firstMatch.score || 0;

				// Determine if this is an exact match based on similarity score
				// Vectorize scores typically range from 0-1, with higher scores being better matches
				// Using 0.8 as threshold for "exact" match
				const matchConfidence: "exact" | "possible" =
					matchScore >= 0.8 ? "exact" : "possible";

				const targetIds = vectorizeResults.matches.map((m) => m.id);
				const targets = await prisma.watchlistTarget.findMany({
					where: {
						id: { in: targetIds },
					},
				});

				if (targets.length > 0) {
					const target = transformWatchlistTarget(targets[0]);
					const pepStatus = target.schema === "PEP";

					console.log(
						"[PepSearch] PEP search completed successfully from Vectorize",
						{
							pepStatus,
							targetId: target.id,
							schema: target.schema,
							matchScore,
							matchConfidence,
						},
					);

					return {
						success: true,
						result: {
							target,
							pepStatus,
							pepDetails: pepStatus
								? `Found in watchlist with schema: ${target.schema}`
								: undefined,
							matchConfidence,
						},
					};
				}
			}

			// No matches in Vectorize, fallback to Grok API
			console.log(
				"[PepSearch] No Vectorize matches found, falling back to Grok API",
			);

			if (!c.env.GROK_API_KEY) {
				console.error("[PepSearch] GROK_API_KEY not configured");
				const error = new ApiException(
					"Grok API key not configured. Please ensure GROK_API_KEY is set in your environment.",
				);
				error.status = 503;
				error.code = 503;
				throw error;
			}

			const grokService = new GrokService({
				apiKey: c.env.GROK_API_KEY,
			});

			console.log("[PepSearch] Calling Grok API for PEP status check");
			const grokResponse = await grokService.queryPEPStatus(data.body.query);

			console.log("[PepSearch] Grok API response received", {
				hasResponse: !!grokResponse,
				pepStatus: grokResponse?.pepStatus,
				hasName: !!grokResponse?.name,
			});

			if (!grokResponse) {
				console.log("[PepSearch] Grok API returned no response");
				const error = new ApiException(
					"Failed to get response from Grok API. Please try again later.",
				);
				error.status = 503;
				error.code = 503;
				throw error;
			}

			// Convert Grok response to WatchlistTarget format
			const target = grokService.convertToWatchlistTarget(
				grokResponse,
				data.body.query,
			);

			console.log("[PepSearch] PEP search completed successfully from Grok", {
				pepStatus: grokResponse.pepStatus,
				targetId: target.id,
			});

			return {
				success: true,
				result: {
					target,
					pepStatus: grokResponse.pepStatus,
					pepDetails: grokResponse.pepDetails,
					matchConfidence: "possible" as const, // Grok fallback is always a possible match
				},
			};
		} catch (error) {
			console.error("[PepSearch] Error during PEP search", {
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
					: "An unexpected error occurred during PEP search",
			);
			apiError.status = 500;
			apiError.code = 500;
			throw apiError;
		}
	}
}
