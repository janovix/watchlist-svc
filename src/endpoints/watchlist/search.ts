import { OpenAPIRoute, ApiException } from "chanfana";
import { AppContext } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import { createPrismaClient } from "../../lib/prisma";
import { watchlistTarget } from "./base";
import { GrokService } from "../../lib/grok-service";
import { transformWatchlistTarget } from "../../lib/transformers";

export class SearchEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Search"],
		summary:
			"Semantic search for watchlist targets using Vectorize first, then Grok API as fallback",
		operationId: "searchTargets",
		request: {
			body: contentJson(
				z.object({
					query: z.string().min(1, "Query string is required"),
					topK: z.number().int().min(1).max(100).optional().default(10),
				}),
			),
		},
		responses: {
			"200": {
				description: "Search results",
				...contentJson({
					success: Boolean,
					result: z.object({
						matches: z.array(
							z.object({
								target: watchlistTarget,
								score: z.number(),
							}),
						),
						count: z.number(),
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

		console.log("[Search] Starting search", {
			query: data.body.query,
			topK: data.body.topK,
		});

		try {
			// First, try Vectorize search
			if (!c.env.AI) {
				console.error("[Search] AI binding not available");
				const error = new ApiException(
					"AI binding not available. Please ensure Workers AI is enabled for your account.",
				);
				error.status = 503;
				error.code = 503;
				throw error;
			}

			if (!c.env.WATCHLIST_VECTORIZE) {
				console.error("[Search] WATCHLIST_VECTORIZE not available");
				const error = new ApiException(
					"Vectorize index not available. Please ensure WATCHLIST_VECTORIZE is configured.",
				);
				error.status = 503;
				error.code = 503;
				throw error;
			}

			console.log("[Search] Generating embedding for query");
			const queryResponse = (await c.env.AI.run("@cf/baai/bge-base-en-v1.5", {
				text: [data.body.query],
			})) as { data: number[][] };

			if (
				!queryResponse ||
				!Array.isArray(queryResponse.data) ||
				queryResponse.data.length === 0
			) {
				console.error("[Search] Failed to generate query embedding");
				const error = new ApiException("Failed to generate query embedding");
				error.status = 500;
				error.code = 500;
				throw error;
			}

			const embedding = queryResponse.data[0] as number[];
			console.log("[Search] Embedding generated", {
				embeddingLength: embedding.length,
			});

			console.log("[Search] Querying Vectorize");
			const vectorizeResults = await c.env.WATCHLIST_VECTORIZE.query(
				embedding,
				{
					topK: data.body.topK,
					returnMetadata: true,
				},
			);

			console.log("[Search] Vectorize query completed", {
				vectorizeMatchesCount: vectorizeResults.matches.length,
			});

			// If we found matches in Vectorize, return them
			if (vectorizeResults.matches.length > 0) {
				const prisma = createPrismaClient(c.env.DB);
				const targetIds = vectorizeResults.matches.map((m) => m.id);
				const targets = await prisma.watchlistTarget.findMany({
					where: {
						id: { in: targetIds },
					},
				});

				const targetMap = new Map(
					targets.map((t: (typeof targets)[number]) => [t.id, t]),
				);

				const matches = vectorizeResults.matches
					.map((match: { id: string; score?: number }) => {
						const target = targetMap.get(match.id);
						if (!target) return null;

						return {
							target: transformWatchlistTarget(target),
							score: match.score || 0,
						};
					})
					.filter(
						(
							m: { target: unknown; score: number } | null,
						): m is { target: unknown; score: number } => m !== null,
					);

				console.log("[Search] Search completed successfully from Vectorize", {
					matchesCount: matches.length,
				});

				return {
					success: true,
					result: {
						matches,
						count: matches.length,
					},
				};
			}

			// No matches in Vectorize, fallback to Grok API
			console.log(
				"[Search] No Vectorize matches found, falling back to Grok API",
			);

			if (!c.env.GROK_API_KEY) {
				console.log(
					"[Search] GROK_API_KEY not configured, returning empty results",
				);
				return {
					success: true,
					result: {
						matches: [],
						count: 0,
					},
				};
			}

			const grokService = new GrokService({
				apiKey: c.env.GROK_API_KEY,
			});

			console.log("[Search] Calling Grok API");
			const grokResponse = await grokService.queryPEPStatus(data.body.query);

			console.log("[Search] Grok API response received", {
				hasResponse: !!grokResponse,
				hasName: !!grokResponse?.name,
			});

			if (!grokResponse || !grokResponse.name) {
				console.log("[Search] Grok API returned no usable response");
				return {
					success: true,
					result: {
						matches: [],
						count: 0,
					},
				};
			}

			// Convert Grok response to WatchlistTarget format
			const grokTarget = grokService.convertToWatchlistTarget(
				grokResponse,
				data.body.query,
			);

			console.log("[Search] Search completed successfully from Grok", {
				targetId: grokTarget.id,
			});

			return {
				success: true,
				result: {
					matches: [
						{
							target: grokTarget,
							score: 0.5, // Default score for Grok API results
						},
					],
					count: 1,
				},
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
