import { OpenAPIRoute, ApiException } from "chanfana";
import { AppContext } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import { createPrismaClient } from "../../lib/prisma";
import { watchlistTarget } from "./base";
import { transformWatchlistTarget } from "../../lib/transformers";
import { parseVectorId } from "../../lib/ofac-vectorize-service";
import {
	normalizeIdentifier,
	bestNameScore,
	computeMetaScore,
	computeHybridScore,
} from "../../lib/matching-utils";
import { createHash } from "crypto";

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
					dataset: z.string().optional(),
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
				description: "Search results with hybrid scoring",
				...contentJson({
					success: Boolean,
					result: z.object({
						matches: z.array(
							z.object({
								target: watchlistTarget,
								score: z.number(),
								breakdown: z.object({
									vectorScore: z.number(),
									nameScore: z.number(),
									metaScore: z.number(),
									identifierMatch: z.boolean(),
								}),
							}),
						),
						count: z.number(),
						pepSearch: z
							.object({
								searchId: z.string(),
								status: z.enum(["completed", "pending"]),
								results: z.any().nullable(),
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
			// Check required bindings
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

			const prisma = createPrismaClient(c.env.DB);
			const candidateMap = new Map<
				string,
				{
					target: unknown;
					vectorScore: number;
					identifierMatch: boolean;
					dataset: string;
				}
			>();

			// Step A: Exact Identifier Matching
			if (data.body.identifiers && data.body.identifiers.length > 0) {
				console.log(
					"[Search] Step A: Exact identifier lookup for",
					data.body.identifiers.length,
					"identifiers",
				);

				const normalizedIdentifiers = data.body.identifiers
					.map((id) => normalizeIdentifier(id))
					.filter((id) => id.length > 0);

				if (normalizedIdentifiers.length > 0) {
					try {
						// Query watchlist_identifier table
						const db = c.env.DB;
						const placeholders = normalizedIdentifiers
							.map(() => "?")
							.join(", ");
						const identifierMatches = await db
							.prepare(
								`SELECT DISTINCT dataset, record_id FROM watchlist_identifier WHERE identifier_norm IN (${placeholders})`,
							)
							.bind(...normalizedIdentifiers)
							.all();

						console.log(
							"[Search] Found",
							identifierMatches.results?.length || 0,
							"identifier matches",
						);

						if (
							identifierMatches.results &&
							identifierMatches.results.length > 0
						) {
							// Group by dataset
							const ofacIds: string[] = [];
							const csvIds: string[] = [];
							const sat69bIds: string[] = [];

							for (const row of identifierMatches.results) {
								const dataset = (row as { dataset: string }).dataset;
								const recordId = (row as { record_id: string }).record_id;

								if (dataset === "ofac_sdn") {
									ofacIds.push(recordId);
								} else if (dataset === "sat_69b") {
									sat69bIds.push(recordId);
								} else {
									csvIds.push(recordId);
								}
							}

							// Fetch OFAC records
							if (ofacIds.length > 0) {
								const ofacRecords = await prisma.ofacSdnEntry.findMany({
									where: { id: { in: ofacIds } },
								});

								for (const record of ofacRecords) {
									// Transform OFAC record to watchlist target format
									const target = {
										id: record.id,
										schema: null,
										name: record.primaryName,
										aliases: record.aliases ? JSON.parse(record.aliases) : null,
										birthDate: record.birthDate,
										countries: null, // OFAC doesn't have direct countries field
										addresses: record.addresses
											? JSON.parse(record.addresses)
											: null,
										identifiers: record.identifiers
											? JSON.parse(record.identifiers)
											: null,
										sanctions: null,
										phones: null,
										emails: null,
										programIds: null,
										dataset: "ofac_sdn",
										firstSeen: null,
										lastSeen: null,
										lastChange: null,
										createdAt: record.createdAt.toISOString(),
										updatedAt: record.updatedAt.toISOString(),
									};

									candidateMap.set(record.id, {
										target,
										vectorScore: 0, // Will be updated if also found in vector search
										identifierMatch: true,
										dataset: "ofac_sdn",
									});
								}
							}

							// Fetch SAT 69-B records
							if (sat69bIds.length > 0) {
								const sat69bRecords = await prisma.sat69bEntry.findMany({
									where: { id: { in: sat69bIds } },
								});

								for (const record of sat69bRecords) {
									// Transform SAT 69-B record to watchlist target format
									const target = {
										id: record.id,
										schema: null,
										name: record.taxpayerName,
										aliases: null,
										birthDate: null,
										countries: ["MX"], // SAT 69-B is Mexico-specific
										addresses: null,
										identifiers: [{ type: "RFC", number: record.rfc }],
										sanctions: [record.taxpayerStatus],
										phones: null,
										emails: null,
										programIds: null,
										dataset: "sat_69b",
										firstSeen: null,
										lastSeen: null,
										lastChange: null,
										createdAt: record.createdAt.toISOString(),
										updatedAt: record.updatedAt.toISOString(),
									};

									candidateMap.set(record.id, {
										target,
										vectorScore: 0,
										identifierMatch: true,
										dataset: "sat_69b",
									});
								}
							}

							// Fetch CSV target records
							if (csvIds.length > 0) {
								const csvRecords = await prisma.watchlistTarget.findMany({
									where: { id: { in: csvIds } },
								});

								for (const record of csvRecords) {
									candidateMap.set(record.id, {
										target: transformWatchlistTarget(record),
										vectorScore: 0,
										identifierMatch: true,
										dataset: record.dataset || "csv",
									});
								}
							}
						}
					} catch (identifierError) {
						console.error(
							"[Search] Error in identifier lookup:",
							identifierError,
						);
						// Continue with vector search even if identifier lookup fails
					}
				}
			}

			// Step B: Vector Search
			console.log("[Search] Step B: Generating embedding for query");
			const queryResponse = (await c.env.AI.run("@cf/baai/bge-base-en-v1.5", {
				text: [data.body.q],
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

			// Build Vectorize query with optional filters
			const vectorizeOptions: {
				topK: number;
				returnMetadata: true;
				filter?: VectorizeVectorMetadataFilter;
			} = {
				topK: data.body.topK,
				returnMetadata: true,
			};

			if (data.body.dataset) {
				vectorizeOptions.filter = { dataset: data.body.dataset };
			}

			console.log("[Search] Querying Vectorize");
			const vectorizeResults = await c.env.WATCHLIST_VECTORIZE.query(
				embedding,
				vectorizeOptions,
			);

			console.log("[Search] Vectorize query completed", {
				vectorizeMatchesCount: vectorizeResults.matches.length,
			});

			// Step C: Rehydrate from D1
			console.log("[Search] Step C: Rehydrating records from D1");

			const ofacIdsToFetch: string[] = [];
			const csvIdsToFetch: string[] = [];
			const sat69bIdsToFetch: string[] = [];

			for (const match of vectorizeResults.matches) {
				const metadata = match.metadata as {
					recordId?: string;
					dataset?: string;
				} | null;

				let recordId: string;
				let dataset: string;

				if (metadata?.recordId) {
					recordId = metadata.recordId;
					dataset = metadata.dataset || "csv";
				} else {
					// Fallback: parse vector ID
					const parsed = parseVectorId(match.id);
					recordId = parsed.id;
					dataset = parsed.dataset;
				}

				// Skip if already in candidates (from identifier match)
				if (candidateMap.has(recordId)) {
					// Update vector score
					const existing = candidateMap.get(recordId)!;
					existing.vectorScore = match.score || 0;
					continue;
				}

				// Queue for fetching
				if (dataset === "ofac_sdn") {
					ofacIdsToFetch.push(recordId);
				} else if (dataset === "sat_69b") {
					sat69bIdsToFetch.push(recordId);
				} else {
					csvIdsToFetch.push(recordId);
				}

				// Store preliminary entry with vector score
				candidateMap.set(recordId, {
					target: null, // Will be populated below
					vectorScore: match.score || 0,
					identifierMatch: false,
					dataset,
				});
			}

			// Fetch OFAC records
			if (ofacIdsToFetch.length > 0) {
				const ofacRecords = await prisma.ofacSdnEntry.findMany({
					where: { id: { in: ofacIdsToFetch } },
				});

				for (const record of ofacRecords) {
					const candidate = candidateMap.get(record.id);
					if (candidate) {
						candidate.target = {
							id: record.id,
							schema: null,
							name: record.primaryName,
							aliases: record.aliases ? JSON.parse(record.aliases) : null,
							birthDate: record.birthDate,
							countries: null,
							addresses: record.addresses ? JSON.parse(record.addresses) : null,
							identifiers: record.identifiers
								? JSON.parse(record.identifiers)
								: null,
							sanctions: null,
							phones: null,
							emails: null,
							programIds: null,
							dataset: "ofac_sdn",
							firstSeen: null,
							lastSeen: null,
							lastChange: null,
							createdAt: record.createdAt.toISOString(),
							updatedAt: record.updatedAt.toISOString(),
						};
					}
				}
			}

			// Fetch SAT 69-B records
			if (sat69bIdsToFetch.length > 0) {
				const sat69bRecords = await prisma.sat69bEntry.findMany({
					where: { id: { in: sat69bIdsToFetch } },
				});

				for (const record of sat69bRecords) {
					const candidate = candidateMap.get(record.id);
					if (candidate) {
						candidate.target = {
							id: record.id,
							schema: null,
							name: record.taxpayerName,
							aliases: null,
							birthDate: null,
							countries: ["MX"], // SAT 69-B is Mexico-specific
							addresses: null,
							identifiers: [{ type: "RFC", number: record.rfc }],
							sanctions: [record.taxpayerStatus],
							phones: null,
							emails: null,
							programIds: null,
							dataset: "sat_69b",
							firstSeen: null,
							lastSeen: null,
							lastChange: null,
							createdAt: record.createdAt.toISOString(),
							updatedAt: record.updatedAt.toISOString(),
						};
					}
				}
			}

			// Fetch CSV target records
			if (csvIdsToFetch.length > 0) {
				const csvRecords = await prisma.watchlistTarget.findMany({
					where: { id: { in: csvIdsToFetch } },
				});

				for (const record of csvRecords) {
					const candidate = candidateMap.get(record.id);
					if (candidate) {
						candidate.target = transformWatchlistTarget(record);
					}
				}
			}

			// Step D: Hybrid Scoring
			console.log("[Search] Step D: Computing hybrid scores");

			const matches: Array<{
				target: unknown;
				score: number;
				breakdown: {
					vectorScore: number;
					nameScore: number;
					metaScore: number;
					identifierMatch: boolean;
				};
			}> = [];

			for (const [_recordId, candidate] of candidateMap.entries()) {
				if (!candidate.target) continue; // Skip if target not found

				const target = candidate.target as {
					name: string | null;
					aliases: string[] | null;
					birthDate: string | null;
					countries: string[] | null;
				};

				// Identifier matches get score override of 1.0
				if (candidate.identifierMatch) {
					matches.push({
						target: candidate.target,
						score: 1.0,
						breakdown: {
							vectorScore: candidate.vectorScore,
							nameScore: 0,
							metaScore: 0,
							identifierMatch: true,
						},
					});
					continue;
				}

				// Compute name score
				const nameScore = target.name
					? bestNameScore(data.body.q, target.name, target.aliases)
					: 0;

				// Compute meta score
				const metaScore = computeMetaScore(
					data.body.birthDate,
					data.body.countries,
					target.birthDate,
					target.countries,
				);

				// Compute hybrid score
				const finalScore = computeHybridScore(
					candidate.vectorScore,
					nameScore,
					metaScore,
				);

				// Log candidate score for diagnostics
				console.log("[Search] Candidate score", {
					recordId: _recordId,
					name: target.name,
					vectorScore: candidate.vectorScore,
					nameScore,
					metaScore,
					hybridScore: finalScore,
					passesThreshold: finalScore >= data.body.threshold,
				});

				matches.push({
					target: candidate.target,
					score: finalScore,
					breakdown: {
						vectorScore: candidate.vectorScore,
						nameScore,
						metaScore,
						identifierMatch: false,
					},
				});
			}

			// Filter by threshold and sort by score descending
			const filteredMatches = matches
				.filter((m) => m.score >= data.body.threshold)
				.sort((a, b) => b.score - a.score);

			console.log("[Search] Search completed successfully", {
				totalCandidates: candidateMap.size,
				matchesCount: filteredMatches.length,
				identifierMatches: matches.filter((m) => m.breakdown.identifierMatch)
					.length,
			});

			// ===================================================================
			// PEP Search (Parallel, Fire-and-Forget)
			// ===================================================================
			let pepSearchInfo:
				| {
						searchId: string;
						status: "completed" | "pending";
						results: unknown | null;
				  }
				| undefined = undefined;

			// Generate search ID from query hash
			const pepSearchId = this.generatePepSearchId(data.body.q);

			// Check KV cache if enabled
			const cacheEnabled = c.env.PEP_CACHE_ENABLED === "true";
			let cachedPepResults: unknown = null;

			if (cacheEnabled && c.env.PEP_CACHE) {
				try {
					const cacheKey = this.generatePepCacheKey(data.body.q);
					const cached = await c.env.PEP_CACHE.get(cacheKey, "json");
					if (cached) {
						cachedPepResults = cached;
						console.log(`[Search] PEP cache hit for query "${data.body.q}"`);
						pepSearchInfo = {
							searchId: pepSearchId,
							status: "completed",
							results: cachedPepResults,
						};
					}
				} catch (error) {
					console.warn(`[Search] Failed to check PEP cache:`, error);
				}
			}

			// If not cached, trigger PEP search in background
			if (!cachedPepResults && c.env.THREAD_SVC) {
				try {
					const callbackUrl = new URL(c.req.url).origin + "/internal/pep";

					const threadPayload = {
						task_type: "pep_search",
						job_params: {
							query: data.body.q,
							callback_url: callbackUrl,
							search_id: pepSearchId,
							max_results: 1000,
						},
						metadata: {
							source: "watchlist-svc",
							triggered_by: "search",
						},
					};

					// Fire-and-forget: use waitUntil to prevent cancellation
					c.executionCtx.waitUntil(
						c.env.THREAD_SVC.fetch("http://thread-svc/threads", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(threadPayload),
						})
							.then((response) => {
								if (response.ok) {
									console.log(
										`[Search] PEP search thread created for query "${data.body.q}"`,
									);
								} else {
									console.error(
										`[Search] Failed to create PEP thread: ${response.status}`,
									);
								}
							})
							.catch((error) => {
								console.error(`[Search] Error creating PEP thread:`, error);
							}),
					);

					pepSearchInfo = {
						searchId: pepSearchId,
						status: "pending",
						results: null,
					};
				} catch (error) {
					console.error(`[Search] Failed to trigger PEP search:`, error);
					// Don't fail the whole search if PEP fails
				}
			}

			// ===================================================================
			// Return Results
			// ===================================================================
			return {
				success: true,
				result: {
					matches: filteredMatches,
					count: filteredMatches.length,
					pepSearch: pepSearchInfo,
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

	/**
	 * Generate PEP search ID from query
	 */
	private generatePepSearchId(query: string): string {
		const normalized = query.toLowerCase().trim();
		const hash = createHash("sha256").update(normalized).digest("hex");
		return `pep_${hash.substring(0, 16)}`;
	}

	/**
	 * Generate PEP cache key from query
	 */
	private generatePepCacheKey(query: string): string {
		const normalized = query.toLowerCase().trim();
		const hash = createHash("sha256").update(normalized).digest("hex");
		return `pep_search:${hash}`;
	}
}
