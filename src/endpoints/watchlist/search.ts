import { OpenAPIRoute, ApiException } from "chanfana";
import { AppContext } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import { createPrismaClient } from "../../lib/prisma";
import { watchlistTarget } from "./base";
import { parseJsonField } from "./base";
import { GrokService } from "../../lib/grok-service";

export class SearchEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Search"],
		summary: "Semantic search for watchlist targets",
		operationId: "searchTargets",
		request: {
			body: contentJson(
				z.object({
					query: z.string().min(1),
					schema: z.string().optional(),
					dataset: z.string().optional(),
					country: z.string().optional(),
					programId: z.string().optional(),
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
		},
	};

	public async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const prisma = createPrismaClient(c.env.DB);

		console.log("[Search] Starting search", {
			query: data.body.query,
			schema: data.body.schema,
			dataset: data.body.dataset,
			country: data.body.country,
			topK: data.body.topK,
		});

		// Generate embedding for query
		// Workers AI binding should be automatically available
		// If not available, it may need to be enabled in the Cloudflare dashboard
		if (!c.env.AI) {
			console.error("[Search] AI binding not available");
			const error = new ApiException(
				"AI binding not available. Please ensure Workers AI is enabled for your account.",
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
			console.error("[Search] Failed to generate query embedding", {
				queryResponse: queryResponse ? "exists" : "null",
			});
			const error = new ApiException("Failed to generate query embedding");
			error.status = 500;
			error.code = 500;
			throw error;
		}

		const embedding = queryResponse.data[0] as number[];
		console.log("[Search] Embedding generated", {
			embeddingLength: embedding.length,
		});

		// Build metadata filter
		const filter: Record<string, string | { $in: string[] }> = {};
		if (data.body.schema) {
			filter.schema = data.body.schema;
		}
		if (data.body.dataset) {
			filter.dataset = data.body.dataset;
		}
		if (data.body.country) {
			filter.countries = { $in: [data.body.country] };
		}
		// Note: programId filtering would need to be handled differently
		// as Vectorize metadata filters work on top-level fields

		console.log("[Search] Querying Vectorize", {
			topK: data.body.topK,
			hasFilter: Object.keys(filter).length > 0,
			filter,
		});

		// Query Vectorize
		const vectorizeResults = await c.env.WATCHLIST_VECTORIZE.query(embedding, {
			topK: data.body.topK,
			returnMetadata: true,
			filter:
				Object.keys(filter).length > 0
					? (filter as Record<string, string | { $in: string[] }>)
					: undefined,
		});

		console.log("[Search] Vectorize query completed", {
			vectorizeMatchesCount: vectorizeResults.matches.length,
			targetIds: vectorizeResults.matches.map((m) => m.id),
		});

		// Fetch full records from D1
		const targetIds = vectorizeResults.matches.map((m) => m.id);
		const targets = await prisma.watchlistTarget.findMany({
			where: {
				id: { in: targetIds },
			},
		});

		console.log("[Search] D1 query completed", {
			targetIdsRequested: targetIds.length,
			targetsFound: targets.length,
		});

		// Create a map for quick lookup
		const targetMap = new Map(
			targets.map((t: (typeof targets)[number]) => [t.id, t]),
		);

		// Combine results
		const matches = vectorizeResults.matches
			.map((match: { id: string; score?: number }) => {
				const target = targetMap.get(match.id);
				if (!target) return null;

				const targetData = {
					id: target.id,
					schema: target.schema,
					name: target.name,
					aliases: parseJsonField<string[]>(target.aliases),
					birthDate: target.birthDate,
					countries: parseJsonField<string[]>(target.countries),
					addresses: parseJsonField<string[]>(target.addresses),
					identifiers: parseJsonField<string[]>(target.identifiers),
					sanctions: parseJsonField<string[]>(target.sanctions),
					phones: parseJsonField<string[]>(target.phones),
					emails: parseJsonField<string[]>(target.emails),
					programIds: parseJsonField<string[]>(target.programIds),
					dataset: target.dataset,
					firstSeen: target.firstSeen,
					lastSeen: target.lastSeen,
					lastChange: target.lastChange,
					createdAt: target.createdAt.toISOString(),
					updatedAt: target.updatedAt.toISOString(),
				};

				return {
					target: targetData,
					score: match.score || 0,
				};
			})
			.filter(
				(
					m: { target: unknown; score: number } | null,
				): m is { target: unknown; score: number } => m !== null,
			);

		console.log("[Search] D1 results processed", {
			matchesCount: matches.length,
			hasGrokApiKey: !!c.env.GROK_API_KEY,
		});

		// If no results from D1, try Grok API as fallback
		if (matches.length === 0 && c.env.GROK_API_KEY) {
			console.log(
				"[Search] No D1 results found, attempting Grok API fallback",
				{
					query: data.body.query,
				},
			);
			try {
				const grokService = new GrokService({
					apiKey: c.env.GROK_API_KEY,
				});

				console.log("[Search] Calling Grok API for PEP status check");
				const grokResponse = await grokService.queryPEPStatus(data.body.query);

				console.log("[Search] Grok API response received", {
					hasResponse: !!grokResponse,
					pepStatus: grokResponse?.pepStatus,
					hasName: !!grokResponse?.name,
				});

				if (grokResponse && grokResponse.pepStatus) {
					console.log("[Search] Grok API found PEP status, returning result", {
						name: grokResponse.name,
						pepDetails: grokResponse.pepDetails,
					});
					const grokTarget = grokService.convertToWatchlistTarget(
						grokResponse,
						data.body.query,
					);

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
				} else {
					console.log(
						"[Search] Grok API did not find PEP status or returned no results",
						{
							hasResponse: !!grokResponse,
							pepStatus: grokResponse?.pepStatus,
						},
					);
				}
			} catch (error) {
				// Log error but don't fail the request
				console.error("[Search] Grok API fallback error:", error);
			}
		} else {
			if (matches.length === 0) {
				console.log("[Search] No D1 results and Grok API key not configured", {
					hasGrokApiKey: !!c.env.GROK_API_KEY,
				});
			} else {
				console.log("[Search] Returning D1 results, skipping Grok fallback", {
					matchesCount: matches.length,
				});
			}
		}

		console.log("[Search] Search completed", {
			finalMatchesCount: matches.length,
			source: matches.length > 0 ? "D1" : "none",
		});

		return {
			success: true,
			result: {
				matches,
				count: matches.length,
			},
		};
	}
}
