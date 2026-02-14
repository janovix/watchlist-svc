import { OpenAPIRoute, ApiException } from "chanfana";
import { AppContext } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import { createPrismaClient } from "../../lib/prisma";
import { parseVectorId } from "../../lib/ofac-vectorize-service";
import {
	normalizeIdentifier,
	bestNameScore,
	computeMetaScore,
	computeHybridScore,
} from "../../lib/matching-utils";
import { createHash } from "crypto";
import { ofacMatch } from "./searchOfac";
import { unscMatch } from "./searchUnsc";
import { sat69bMatch } from "./searchSat69b";
import { createUsageRightsClient } from "../../lib/usage-rights-client";

// Tipos para los targets
type OfacTargetType = {
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

type UnscTargetType = {
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

type Sat69bTargetType = {
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
							const sat69bIds: string[] = [];
							const unscIds: string[] = [];

							for (const row of identifierMatches.results) {
								const dataset = (row as { dataset: string }).dataset;
								const recordId = (row as { record_id: string }).record_id;

								if (dataset === "ofac_sdn") {
									ofacIds.push(recordId);
								} else if (dataset === "sat_69b") {
									sat69bIds.push(recordId);
								} else if (dataset === "unsc") {
									unscIds.push(recordId);
								}
							}

							// Fetch OFAC records
							if (ofacIds.length > 0) {
								const ofacRecords = await prisma.ofacSdnEntry.findMany({
									where: { id: { in: ofacIds } },
								});

								for (const record of ofacRecords) {
									const target = {
										id: record.id,
										partyType: record.partyType,
										primaryName: record.primaryName,
										aliases: record.aliases ? JSON.parse(record.aliases) : null,
										birthDate: record.birthDate,
										birthPlace: record.birthPlace,
										addresses: record.addresses
											? JSON.parse(record.addresses)
											: null,
										identifiers: record.identifiers
											? JSON.parse(record.identifiers)
											: null,
										remarks: record.remarks,
										sourceList: record.sourceList,
										createdAt: record.createdAt.toISOString(),
										updatedAt: record.updatedAt.toISOString(),
									};

									candidateMap.set(record.id, {
										target,
										vectorScore: 0,
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
									const target = {
										id: record.id,
										rfc: record.rfc,
										taxpayerName: record.taxpayerName,
										taxpayerStatus: record.taxpayerStatus,
										presumptionPhase: {
											satNotice: record.presumptionSatNotice,
											satDate: record.presumptionSatDate,
											dofNotice: record.presumptionDofNotice,
											dofDate: record.presumptionDofDate,
										},
										rebuttalPhase: {
											satNotice: record.rebuttalSatNotice,
											satDate: record.rebuttalSatDate,
											dofNotice: record.rebuttalDofNotice,
											dofDate: record.rebuttalDofDate,
										},
										definitivePhase: {
											satNotice: record.definitiveSatNotice,
											satDate: record.definitiveSatDate,
											dofNotice: record.definitiveDofNotice,
											dofDate: record.definitiveDofDate,
										},
										favorablePhase: {
											satNotice: record.favorableSatNotice,
											satDate: record.favorableSatDate,
											dofNotice: record.favorableDofNotice,
											dofDate: record.favorableDofDate,
										},
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

							// Fetch UNSC records
							if (unscIds.length > 0) {
								const unscRecords = await prisma.unscEntry.findMany({
									where: { id: { in: unscIds } },
								});

								for (const record of unscRecords) {
									const target = {
										id: record.id,
										partyType: record.partyType,
										primaryName: record.primaryName,
										aliases: record.aliases ? JSON.parse(record.aliases) : null,
										birthDate: record.birthDate,
										birthPlace: record.birthPlace,
										gender: record.gender,
										nationalities: record.nationalities
											? JSON.parse(record.nationalities)
											: null,
										addresses: record.addresses
											? JSON.parse(record.addresses)
											: null,
										identifiers: record.identifiers
											? JSON.parse(record.identifiers)
											: null,
										designations: record.designations
											? JSON.parse(record.designations)
											: null,
										remarks: record.remarks,
										unListType: record.unListType,
										referenceNumber: record.referenceNumber,
										listedOn: record.listedOn,
										createdAt: record.createdAt.toISOString(),
										updatedAt: record.updatedAt.toISOString(),
									};

									candidateMap.set(record.id, {
										target,
										vectorScore: 0,
										identifierMatch: true,
										dataset: "unsc",
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
			const sat69bIdsToFetch: string[] = [];
			const unscIdsToFetch: string[] = [];

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
				} else if (dataset === "unsc") {
					unscIdsToFetch.push(recordId);
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
							partyType: record.partyType,
							primaryName: record.primaryName,
							aliases: record.aliases ? JSON.parse(record.aliases) : null,
							birthDate: record.birthDate,
							birthPlace: record.birthPlace,
							addresses: record.addresses ? JSON.parse(record.addresses) : null,
							identifiers: record.identifiers
								? JSON.parse(record.identifiers)
								: null,
							remarks: record.remarks,
							sourceList: record.sourceList,
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
							rfc: record.rfc,
							taxpayerName: record.taxpayerName,
							taxpayerStatus: record.taxpayerStatus,
							presumptionPhase: {
								satNotice: record.presumptionSatNotice,
								satDate: record.presumptionSatDate,
								dofNotice: record.presumptionDofNotice,
								dofDate: record.presumptionDofDate,
							},
							rebuttalPhase: {
								satNotice: record.rebuttalSatNotice,
								satDate: record.rebuttalSatDate,
								dofNotice: record.rebuttalDofNotice,
								dofDate: record.rebuttalDofDate,
							},
							definitivePhase: {
								satNotice: record.definitiveSatNotice,
								satDate: record.definitiveSatDate,
								dofNotice: record.definitiveDofNotice,
								dofDate: record.definitiveDofDate,
							},
							favorablePhase: {
								satNotice: record.favorableSatNotice,
								satDate: record.favorableSatDate,
								dofNotice: record.favorableDofNotice,
								dofDate: record.favorableDofDate,
							},
							createdAt: record.createdAt.toISOString(),
							updatedAt: record.updatedAt.toISOString(),
						};
					}
				}
			}

			// Fetch UNSC records
			if (unscIdsToFetch.length > 0) {
				const unscRecords = await prisma.unscEntry.findMany({
					where: { id: { in: unscIdsToFetch } },
				});

				for (const record of unscRecords) {
					const candidate = candidateMap.get(record.id);
					if (candidate) {
						candidate.target = {
							id: record.id,
							partyType: record.partyType,
							primaryName: record.primaryName,
							aliases: record.aliases ? JSON.parse(record.aliases) : null,
							birthDate: record.birthDate,
							birthPlace: record.birthPlace,
							gender: record.gender,
							nationalities: record.nationalities
								? JSON.parse(record.nationalities)
								: null,
							addresses: record.addresses ? JSON.parse(record.addresses) : null,
							identifiers: record.identifiers
								? JSON.parse(record.identifiers)
								: null,
							designations: record.designations
								? JSON.parse(record.designations)
								: null,
							remarks: record.remarks,
							unListType: record.unListType,
							referenceNumber: record.referenceNumber,
							listedOn: record.listedOn,
							createdAt: record.createdAt.toISOString(),
							updatedAt: record.updatedAt.toISOString(),
						};
					}
				}
			}

			// Step D: Hybrid Scoring
			console.log("[Search] Step D: Computing hybrid scores");

			const ofacMatches: Array<{
				target: OfacTargetType;
				score: number;
				breakdown: {
					vectorScore: number;
					nameScore: number;
					metaScore: number;
					identifierMatch: boolean;
				};
			}> = [];

			const unscMatches: Array<{
				target: UnscTargetType;
				score: number;
				breakdown: {
					vectorScore: number;
					nameScore: number;
					metaScore: number;
					identifierMatch: boolean;
				};
			}> = [];

			const sat69bMatches: Array<{
				target: Sat69bTargetType;
				score: number;
				breakdown: {
					vectorScore: number;
					nameScore: number;
					metaScore: number;
					identifierMatch: boolean;
				};
			}> = [];

			for (const [_recordId, candidate] of candidateMap.entries()) {
				if (!candidate.target) continue;

				let nameScore = 0;
				let metaScore = 0;
				let finalScore = 1.0;

				// Identifier matches get score of 1.0
				if (!candidate.identifierMatch) {
					// Compute name score based on dataset
					if (
						candidate.dataset === "ofac_sdn" ||
						candidate.dataset === "unsc"
					) {
						const target = candidate.target as {
							primaryName: string;
							aliases: string[] | null;
							birthDate: string | null;
						};
						nameScore = bestNameScore(
							data.body.q,
							target.primaryName,
							target.aliases,
						);
					} else if (candidate.dataset === "sat_69b") {
						const target = candidate.target as { taxpayerName: string };
						nameScore = bestNameScore(data.body.q, target.taxpayerName, null);
					}

					// Compute meta score (only for datasets with birthDate)
					if (
						candidate.dataset === "ofac_sdn" ||
						candidate.dataset === "unsc"
					) {
						const target = candidate.target as { birthDate: string | null };
						metaScore = computeMetaScore(
							data.body.birthDate,
							data.body.countries,
							target.birthDate,
							null,
						);
					}

					// Compute hybrid score
					finalScore = computeHybridScore(
						candidate.vectorScore,
						nameScore,
						metaScore,
					);
				}

				// Filter by threshold
				if (finalScore < data.body.threshold) continue;

				const match = {
					target: candidate.target,
					score: finalScore,
					breakdown: {
						vectorScore: candidate.vectorScore,
						nameScore,
						metaScore,
						identifierMatch: candidate.identifierMatch,
					},
				};

				// Add to appropriate array with type assertion
				if (candidate.dataset === "ofac_sdn") {
					ofacMatches.push(match as (typeof ofacMatches)[number]);
				} else if (candidate.dataset === "unsc") {
					unscMatches.push(match as (typeof unscMatches)[number]);
				} else if (candidate.dataset === "sat_69b") {
					sat69bMatches.push(match as (typeof sat69bMatches)[number]);
				}
			}

			// Sort each dataset by score descending
			ofacMatches.sort((a, b) => b.score - a.score);
			unscMatches.sort((a, b) => b.score - a.score);
			sat69bMatches.sort((a, b) => b.score - a.score);

			console.log("[Search] Search completed successfully", {
				totalCandidates: candidateMap.size,
				ofacCount: ofacMatches.length,
				unscCount: unscMatches.length,
				sat69bCount: sat69bMatches.length,
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
					ofac: {
						matches: ofacMatches,
						count: ofacMatches.length,
					},
					unsc: {
						matches: unscMatches,
						count: unscMatches.length,
					},
					sat69b: {
						matches: sat69bMatches,
						count: sat69bMatches.length,
					},
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
