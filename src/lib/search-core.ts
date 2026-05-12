/**
 * Core search logic shared between public and internal search endpoints
 */

import { ApiException } from "chanfana";
import { createPrismaClient } from "./prisma";
import {
	checkAndUpdateQueryCompletion,
	generateCacheKey,
	readCache,
} from "./search-query-utils";
import {
	generateSyncCacheKey,
	isGlobalCacheEnabled,
	readSyncCache,
	writeSyncCache,
} from "./watchlist-cache";
import { parseVectorId } from "./ofac-vectorize-service";
import { getCallbackUrl } from "./callback-utils";
import { QUERY_SOURCE } from "./query-source";
import {
	normalizeIdentifier,
	bestNameScore,
	computeMetaSignal,
	computeHybridScore,
	passesMatchFilter,
	parseRfcBirthDate,
	extractOfacRecordCountries,
	extractUnscRecordCountries,
} from "./matching-utils";
import type { Bindings } from "../index";
import { WATCHLIST_EMBEDDING_MODEL } from "./embedding-config";
import {
	type OfacTargetType,
	type Sat69bTargetType,
	type UnscTargetType,
	toOfacTarget,
	toSat69bTarget,
	toUnscTarget,
} from "./target-mappers";
import {
	type EmbeddingsAdapter,
	type VectorIndexAdapter,
	defaultEmbeddings,
	defaultVectorIndex,
} from "./search-vectorize";
import {
	runGeminiAdverseMediaResearch,
	runGeminiPepResearch,
} from "./gemini-research";
import {
	completeAdverseMediaResearch,
	completePepAiResearch,
	failAdverseMediaResearch,
	failPepAiResearch,
} from "./research-results";
import {
	researchShadowSample,
	resolveResearchProvider,
	resolveResearchShadowEnabled,
} from "./research-provider";
import { logResearchShadowMetric } from "./research-shadow";
import { broadcastPepEvent } from "./pep-events-broadcast";

export type {
	OfacTargetType,
	Sat69bTargetType,
	UnscTargetType,
} from "./target-mappers";

export interface SearchParams {
	env: Bindings;
	executionCtx: ExecutionContext;
	organizationId: string;
	userId: string;
	source: string; // canonical: 'aml' | 'manual' | etc.
	query: string;
	entityType?: string;
	birthDate?: string;
	countries?: string[];
	identifiers?: string[];
	topK?: number;
	threshold?: number;
	/** Deployment environment for data isolation (defaults to "production") */
	environment?: string;
	/** When set, links this query to an AML client or beneficial controller */
	entityId?: string;
	entityKind?: "client" | "beneficial_controller";
	/** Optional test/prod injection for embeddings + Vectorize (defaults to env bindings). */
	adapters?: {
		embeddings?: EmbeddingsAdapter;
		vectorIndex?: VectorIndexAdapter;
	};
}

export interface SearchResult {
	queryId: string;
	ofac: {
		matches: Array<{
			target: OfacTargetType;
			score: number;
			breakdown: {
				vectorScore: number;
				nameScore: number;
				metaScore: number;
				identifierMatch: boolean;
			};
		}>;
		count: number;
	};
	unsc: {
		matches: Array<{
			target: UnscTargetType;
			score: number;
			breakdown: {
				vectorScore: number;
				nameScore: number;
				metaScore: number;
				identifierMatch: boolean;
			};
		}>;
		count: number;
	};
	sat69b: {
		matches: Array<{
			target: Sat69bTargetType;
			score: number;
			breakdown: {
				vectorScore: number;
				nameScore: number;
				metaScore: number;
				identifierMatch: boolean;
			};
		}>;
		count: number;
	};
	pepSearch?: {
		searchId: string;
		status: "completed" | "pending" | "disabled";
		results: unknown | null;
	};
	pepAiSearch?: {
		searchId: string;
		status: "completed" | "pending" | "skipped" | "disabled" | "failed";
		result: unknown | null;
	};
	adverseMediaSearch?: {
		searchId: string;
		status: "completed" | "pending" | "disabled" | "failed";
		result: unknown | null;
	};
}

/**
 * Core search logic for hybrid watchlist search
 */
export async function performSearch(
	params: SearchParams,
): Promise<SearchResult> {
	const {
		env,
		executionCtx,
		organizationId,
		userId,
		source,
		query,
		entityType = "person",
		birthDate,
		countries,
		identifiers,
		topK = 50,
		threshold = 0.875,
		environment = "production",
		entityId: entityIdParam,
		entityKind: entityKindParam,
	} = params;

	// Generate query ID for persistent tracking and SSE subscription
	const queryId = crypto.randomUUID();
	console.log("[SearchCore] Generated query ID:", queryId);

	// Create SearchQuery record for audit trail and async result aggregation
	const prisma = createPrismaClient(env.DB);

	const entityId =
		typeof entityIdParam === "string" && entityIdParam.trim() !== ""
			? entityIdParam.trim()
			: null;
	const entityKind =
		entityKindParam === "client" || entityKindParam === "beneficial_controller"
			? entityKindParam
			: null;

	try {
		await prisma.searchQuery.create({
			data: {
				id: queryId,
				organizationId,
				environment,
				userId,
				query,
				source,
				entityType,
				entityId,
				entityKind,
				birthDate: birthDate ?? null,
				countries: countries ? JSON.stringify(countries) : null,
				status: "pending",
				ofacStatus: "running",
				sat69bStatus: "running",
				unStatus: "running",
				pepOfficialStatus:
					String(env.PEP_SEARCH_ENABLED ?? "") !== "false"
						? "pending"
						: "skipped",
				pepAiStatus:
					entityType === "person" &&
					String(env.PEP_GROK_ENABLED ?? "") !== "false"
						? "pending"
						: "skipped",
				adverseMediaStatus:
					String(env.ADVERSE_MEDIA_ENABLED ?? "") !== "false"
						? "pending"
						: "skipped",
			},
		});
		console.log(
			`[SearchCore] Created SearchQuery record ${queryId} for org ${organizationId} env ${environment}`,
		);
	} catch (err) {
		console.error(
			`[SearchCore] Failed to create SearchQuery (non-fatal, continuing):`,
			err,
		);
		// Don't fail the whole search if query creation fails
	}

	type OfacMatchRow = {
		target: OfacTargetType;
		score: number;
		breakdown: {
			vectorScore: number;
			nameScore: number;
			metaScore: number;
			identifierMatch: boolean;
		};
	};
	type UnscMatchRow = {
		target: UnscTargetType;
		score: number;
		breakdown: {
			vectorScore: number;
			nameScore: number;
			metaScore: number;
			identifierMatch: boolean;
		};
	};
	type Sat69bMatchRow = {
		target: Sat69bTargetType;
		score: number;
		breakdown: {
			vectorScore: number;
			nameScore: number;
			metaScore: number;
			identifierMatch: boolean;
		};
	};

	let ofacMatches: OfacMatchRow[] = [];
	let unscMatches: UnscMatchRow[] = [];
	let sat69bMatches: Sat69bMatchRow[] = [];

	const globalCacheEnabled = await isGlobalCacheEnabled(env, { environment });
	let syncCacheKey: string | undefined;
	let usedL1SyncCache = false;

	if (globalCacheEnabled && env.PEP_CACHE) {
		syncCacheKey = generateSyncCacheKey({
			query,
			entityType,
			birthDate: birthDate ?? null,
			countries: countries ?? null,
			identifiers: identifiers ?? null,
			topK,
			threshold,
			environment,
		});
		const cachedSync = await readSyncCache<{
			v: 1;
			ofac: OfacMatchRow[];
			unsc: UnscMatchRow[];
			sat69b: Sat69bMatchRow[];
		}>(env.PEP_CACHE, syncCacheKey);
		if (
			cachedSync?.v === 1 &&
			Array.isArray(cachedSync.ofac) &&
			Array.isArray(cachedSync.unsc) &&
			Array.isArray(cachedSync.sat69b)
		) {
			usedL1SyncCache = true;
			ofacMatches = cachedSync.ofac;
			unscMatches = cachedSync.unsc;
			sat69bMatches = cachedSync.sat69b;
			console.log("[SearchCore] L1 sync cache hit", { key: syncCacheKey });
		}
	}

	if (!usedL1SyncCache) {
		const embeddingsAdapter: EmbeddingsAdapter =
			params.adapters?.embeddings ?? defaultEmbeddings(env);
		const vectorIndexAdapter: VectorIndexAdapter =
			params.adapters?.vectorIndex ?? defaultVectorIndex(env);

		// Check required bindings when not injected (tests may supply adapters only).
		if (!params.adapters?.embeddings && !env.AI) {
			console.error("[SearchCore] AI binding not available");
			const error = new ApiException(
				"AI binding not available. Please ensure Workers AI is enabled for your account.",
			);
			error.status = 503;
			error.code = 503;
			throw error;
		}

		if (!params.adapters?.vectorIndex && !env.WATCHLIST_VECTORIZE) {
			console.error("[SearchCore] WATCHLIST_VECTORIZE not available");
			const error = new ApiException(
				"Vectorize index not available. Please ensure WATCHLIST_VECTORIZE is configured.",
			);
			error.status = 503;
			error.code = 503;
			throw error;
		}

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
		if (identifiers && identifiers.length > 0) {
			console.log(
				"[SearchCore] Step A: Exact identifier lookup for",
				identifiers.length,
				"identifiers",
			);

			const normalizedIdentifiers = identifiers
				.map((id) => normalizeIdentifier(id))
				.filter((id) => id.length > 0);

			if (normalizedIdentifiers.length > 0) {
				try {
					// Query watchlist_identifier table
					const db = env.DB;
					const placeholders = normalizedIdentifiers.map(() => "?").join(", ");
					const identifierMatches = await db
						.prepare(
							`SELECT DISTINCT dataset, record_id FROM watchlist_identifier WHERE identifier_norm IN (${placeholders})`,
						)
						.bind(...normalizedIdentifiers)
						.all();

					console.log(
						"[SearchCore] Found",
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
								const target = toOfacTarget(record);

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
								const target = toSat69bTarget(record);

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
								const target = toUnscTarget(record);

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
						"[SearchCore] Error in identifier lookup:",
						identifierError,
					);
					// Continue with vector search even if identifier lookup fails
				}
			}
		}

		// Step B: Vector Search
		console.log("[SearchCore] Step B: Generating embedding for query");
		const embedding = await embeddingsAdapter.embed(
			query,
			WATCHLIST_EMBEDDING_MODEL,
		);

		if (!embedding || embedding.length === 0) {
			console.error("[SearchCore] Failed to generate query embedding");
			const error = new ApiException("Failed to generate query embedding");
			error.status = 500;
			error.code = 500;
			throw error;
		}
		console.log("[SearchCore] Embedding generated", {
			embeddingLength: embedding.length,
		});

		// Build Vectorize query with optional filters
		const vectorizeOptions: {
			topK: number;
			returnMetadata: true;
			filter?: VectorizeVectorMetadataFilter;
		} = {
			topK,
			returnMetadata: true,
		};

		console.log("[SearchCore] Querying Vectorize");
		const vectorizeResults = await vectorIndexAdapter.query(
			embedding,
			vectorizeOptions,
		);

		console.log("[SearchCore] Vectorize query completed", {
			vectorizeMatchesCount: vectorizeResults.matches.length,
		});

		// Step C: Rehydrate from D1
		console.log("[SearchCore] Step C: Rehydrating records from D1");

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
					candidate.target = toOfacTarget(record);
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
					candidate.target = toSat69bTarget(record);
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
					candidate.target = toUnscTarget(record);
				}
			}
		}

		// Step D: Hybrid Scoring
		console.log("[SearchCore] Step D: Computing hybrid scores");

		for (const [_recordId, candidate] of candidateMap.entries()) {
			if (!candidate.target) continue;

			let nameScore = 0;
			let metaScore = 0;
			let metaMismatch = false;
			let finalScore = 1.0;

			const userProvidedDisambiguators =
				Boolean(birthDate) || (countries && countries.length > 0);

			// Identifier matches get score of 1.0
			if (!candidate.identifierMatch) {
				// Compute name score based on dataset
				if (candidate.dataset === "ofac_sdn" || candidate.dataset === "unsc") {
					const target = candidate.target as {
						primaryName: string;
						aliases: string[] | null;
						birthDate: string | null;
						identifiers: Array<{
							type?: string;
							number?: string;
							country?: string;
						}> | null;
						addresses: string[] | null;
					};
					nameScore = bestNameScore(query, target.primaryName, target.aliases);
				} else if (candidate.dataset === "sat_69b") {
					const target = candidate.target as { taxpayerName: string };
					nameScore = bestNameScore(query, target.taxpayerName, null);
				}

				if (candidate.dataset === "ofac_sdn") {
					const target = candidate.target as {
						birthDate: string | null;
						identifiers: Array<{
							type?: string;
							number?: string;
							country?: string;
						}> | null;
						addresses: string[] | null;
					};
					const { score, mismatch } = computeMetaSignal(
						birthDate,
						countries,
						target.birthDate,
						extractOfacRecordCountries(target),
					);
					metaScore = score;
					metaMismatch = mismatch;
				} else if (candidate.dataset === "unsc") {
					const target = candidate.target as {
						birthDate: string | null;
						nationalities: string[] | null;
					};
					const { score, mismatch } = computeMetaSignal(
						birthDate,
						countries,
						target.birthDate,
						extractUnscRecordCountries(target.nationalities),
					);
					metaScore = score;
					metaMismatch = mismatch;
				} else if (candidate.dataset === "sat_69b") {
					const target = candidate.target as { rfc: string };
					const { score, mismatch } = computeMetaSignal(
						birthDate,
						countries,
						parseRfcBirthDate(target.rfc),
						["MX"],
					);
					metaScore = score;
					metaMismatch = mismatch;
				}

				// Compute hybrid score
				finalScore = computeHybridScore(
					candidate.vectorScore,
					nameScore,
					metaScore,
				);
			}

			const corroborated =
				candidate.identifierMatch ||
				metaScore > 0 ||
				!userProvidedDisambiguators;
			// Filter by threshold (or name-score override for exact/near-exact name matches)
			if (
				!passesMatchFilter(finalScore, nameScore, threshold, {
					corroborated,
					mismatch: metaMismatch,
				})
			)
				continue;

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

		console.log("[SearchCore] Search completed successfully", {
			totalCandidates: candidateMap.size,
			ofacCount: ofacMatches.length,
			unscCount: unscMatches.length,
			sat69bCount: sat69bMatches.length,
		});
	} // end !usedL1SyncCache

	if (!usedL1SyncCache && globalCacheEnabled && env.PEP_CACHE && syncCacheKey) {
		const payload = {
			v: 1 as const,
			ofac: ofacMatches,
			unsc: unscMatches,
			sat69b: sat69bMatches,
		};
		executionCtx.waitUntil(
			writeSyncCache(env.PEP_CACHE, syncCacheKey, payload),
		);
	}

	// Persist sync results to SearchQuery for audit trail
	try {
		await prisma.searchQuery.update({
			where: { id: queryId },
			data: {
				ofacStatus: "completed",
				ofacResult: ofacMatches.length > 0 ? JSON.stringify(ofacMatches) : null,
				ofacCount: ofacMatches.length,
				sat69bStatus: "completed",
				sat69bResult:
					sat69bMatches.length > 0 ? JSON.stringify(sat69bMatches) : null,
				sat69bCount: sat69bMatches.length,
				unStatus: "completed",
				unResult: unscMatches.length > 0 ? JSON.stringify(unscMatches) : null,
				unCount: unscMatches.length,
			},
		});
		console.log(
			`[SearchCore] Persisted sync results to SearchQuery ${queryId}`,
		);

		// Eagerly check completion — when all async features are disabled their
		// statuses are already "skipped" at creation time, so this single call
		// transitions the query straight to "completed" without waiting for
		// callbacks that will never fire.
		await checkAndUpdateQueryCompletion(prisma, queryId);
	} catch (err) {
		console.error(
			`[SearchCore] Failed to persist sync results to SearchQuery (non-fatal):`,
			err,
		);
	}

	// ===================================================================
	// PEP Search (Parallel, Fire-and-Forget) - UNIFIED TO USE queryId
	// ===================================================================
	let pepSearchInfo:
		| {
				searchId: string;
				status: "completed" | "pending" | "disabled";
				results: unknown | null;
		  }
		| undefined = undefined;

	const pepSearchEnabled = String(env.PEP_SEARCH_ENABLED ?? "") !== "false";

	if (!pepSearchEnabled) {
		console.log(`[SearchCore] PEP search disabled via PEP_SEARCH_ENABLED`);
		pepSearchInfo = {
			searchId: queryId,
			status: "disabled",
			results: null,
		};
	} else {
		// Use queryId directly instead of hash-based search ID
		const pepSearchId = queryId;

		let cachedPepResults: unknown = null;

		if (globalCacheEnabled && env.PEP_CACHE) {
			try {
				const cacheKey = generateCacheKey("pep_search", query);
				const cached = await env.PEP_CACHE.get(cacheKey, "json");
				if (cached) {
					cachedPepResults = cached;
					console.log(`[SearchCore] PEP cache hit for query "${query}"`);
					pepSearchInfo = {
						searchId: pepSearchId,
						status: "completed",
						results: cachedPepResults,
					};
				}
			} catch (error) {
				console.warn(`[SearchCore] Failed to check PEP cache:`, error);
			}
		}

		// If not cached, trigger PEP search in background
		if (!cachedPepResults && env.THREAD_SVC) {
			try {
				const callbackUrl = getCallbackUrl(env.ENVIRONMENT) + "/internal/pep";

				const threadPayload = {
					task_type: "pep_search",
					job_params: {
						query: query,
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
				executionCtx.waitUntil(
					env.THREAD_SVC.createThread(threadPayload)
						.then((thread) => {
							console.log(
								`[SearchCore] PEP search thread created for query "${query}": ${thread.id}`,
							);
						})
						.catch((error) => {
							console.error(`[SearchCore] Error creating PEP thread:`, error);
						}),
				);

				pepSearchInfo = {
					searchId: pepSearchId,
					status: "pending",
					results: null,
				};
			} catch (error) {
				console.error(`[SearchCore] Failed to trigger PEP search:`, error);
			}
		}
	}

	const researchProvider = await resolveResearchProvider(env, organizationId);

	// ===================================================================
	// PEP AI web research (Gemini + Search Grounding or legacy Grok containers)
	// ===================================================================
	let pepAiSearch:
		| {
				searchId: string;
				status: "completed" | "pending" | "skipped" | "disabled" | "failed";
				result: unknown | null;
		  }
		| undefined = undefined;

	const pepGrokEnabled = String(env.PEP_GROK_ENABLED ?? "") !== "false";

	if (!pepGrokEnabled) {
		console.log(`[SearchCore] PEP AI search disabled via PEP_GROK_ENABLED`);
		pepAiSearch = {
			searchId: queryId,
			status: "disabled",
			result: null,
		};
	} else if (entityType === "person") {
		try {
			const pepAiSearchId = queryId; // Use queryId for unified SSE

			let cachedPepAi: unknown = null;
			if (globalCacheEnabled && env.PEP_CACHE) {
				try {
					const pepCacheSuffix = [entityType, birthDate, countries?.[0]]
						.filter(Boolean)
						.join(":");
					const cacheKey = generateCacheKey(
						"pep_ai",
						query,
						pepCacheSuffix || undefined,
					);
					cachedPepAi = await readCache(env.PEP_CACHE, cacheKey);
					if (cachedPepAi) {
						console.log(`[SearchCore] PEP AI cache hit for query "${query}"`);
						pepAiSearch = {
							searchId: pepAiSearchId,
							status: "completed",
							result: cachedPepAi,
						};
						await prisma.searchQuery.update({
							where: { id: queryId },
							data: {
								pepAiStatus: "completed",
								pepAiResult: JSON.stringify(cachedPepAi),
							},
						});
						await checkAndUpdateQueryCompletion(prisma, queryId);
						if (source === QUERY_SOURCE.AML && env.AML_SERVICE) {
							const prob = (cachedPepAi as { probability?: number })
								.probability;
							const matched =
								typeof prob === "number" &&
								Number.isFinite(prob) &&
								prob >= 0.7;
							executionCtx.waitUntil(
								env.AML_SERVICE.processScreeningCallback({
									queryId,
									type: "pep_ai",
									status: "completed",
									matched,
								}).catch((err) =>
									console.error(
										"[SearchCore] AML callback (pep_ai cache) failed:",
										err,
									),
								),
							);
						}
					}
				} catch (error) {
					console.warn(`[SearchCore] Failed to check PEP AI cache:`, error);
				}
			}

			if (!cachedPepAi) {
				if (researchProvider === "gemini") {
					pepAiSearch = {
						searchId: pepAiSearchId,
						status: "pending",
						result: null,
					};
					executionCtx.waitUntil(
						(async () => {
							const t0 = Date.now();
							try {
								void broadcastPepEvent(
									env,
									pepAiSearchId,
									"pep_grok_progress",
									{
										phase: "searching",
										message: "Researching PEP status...",
										progress: 0.2,
									},
								);
								const geminiResult = await runGeminiPepResearch(env, {
									query,
									birthdate: birthDate,
									country: countries?.[0],
								});
								await completePepAiResearch(env, {
									searchId: pepAiSearchId,
									query,
									entityType,
									birthdate: birthDate,
									country: countries?.[0],
									probability: geminiResult.probability,
									summary: geminiResult.summary,
									sources: geminiResult.sources,
									logPrefix: "[SearchCore/Gemini PEP]",
								});
								const shadowOn = await resolveResearchShadowEnabled(
									env,
									organizationId,
								);
								if (shadowOn && researchShadowSample(pepAiSearchId)) {
									logResearchShadowMetric({
										kind: "watchlist_research_shadow_sample",
										search_id: pepAiSearchId,
										organization_id: organizationId,
										research_kind: "pep_ai",
										provider: "gemini",
										latency_ms: Date.now() - t0,
										summary: {
											probability: geminiResult.probability,
											source_count: geminiResult.sources.length,
										},
									});
								}
							} catch (err) {
								const msg = err instanceof Error ? err.message : String(err);
								console.error("[SearchCore] Gemini PEP research failed:", err);
								await failPepAiResearch(env, {
									searchId: pepAiSearchId,
									error: msg,
									logPrefix: "[SearchCore/Gemini PEP]",
								});
							}
						})(),
					);
				} else if (env.THREAD_SVC) {
					const baseUrl = getCallbackUrl(env.ENVIRONMENT);
					const callbackUrl = baseUrl + "/internal/grok-pep";
					const progressCallbackUrl = baseUrl + "/internal/grok-pep/progress";

					const threadPayload = {
						task_type: "pep_grok",
						job_params: {
							query: query,
							callback_url: callbackUrl,
							progress_callback_url: progressCallbackUrl,
							search_id: pepAiSearchId,
							birthdate: birthDate,
							country: countries?.[0],
						},
						metadata: {
							source: "watchlist-svc",
							triggered_by: "search",
							needs_grok_key: true,
							...(env.GROK_API_KEY && {
								env: { GROK_API_KEY: env.GROK_API_KEY },
							}),
						},
					};

					try {
						await env.THREAD_SVC.createThread(threadPayload);
						pepAiSearch = {
							searchId: pepAiSearchId,
							status: "pending",
							result: null,
						};
					} catch (threadError) {
						console.error(
							`[SearchCore] Error creating Grok PEP thread:`,
							threadError,
						);
						pepAiSearch = {
							searchId: pepAiSearchId,
							status: "failed",
							result: null,
						};
					}
				} else {
					console.warn(
						"[SearchCore] PEP AI skipped: provider=grok but THREAD_SVC missing",
					);
					pepAiSearch = {
						searchId: pepAiSearchId,
						status: "failed",
						result: null,
					};
				}
			}
		} catch (error) {
			console.error(`[SearchCore] Failed to trigger PEP AI search:`, error);
			// Don't fail the whole search if PEP AI fails
		}
	} else if (entityType !== "person") {
		pepAiSearch = {
			searchId: queryId,
			status: "skipped",
			result: null,
		};
	}

	// ===================================================================
	// Adverse media web research (Gemini + Search Grounding or legacy Grok containers)
	// ===================================================================
	let adverseMediaSearch:
		| {
				searchId: string;
				status: "completed" | "pending" | "disabled" | "failed";
				result: unknown | null;
		  }
		| undefined = undefined;

	const adverseMediaEnabled =
		String(env.ADVERSE_MEDIA_ENABLED ?? "") !== "false";

	if (!adverseMediaEnabled) {
		console.log(
			`[SearchCore] Adverse media search disabled via ADVERSE_MEDIA_ENABLED`,
		);
		adverseMediaSearch = {
			searchId: queryId,
			status: "disabled",
			result: null,
		};
	} else {
		try {
			const adverseMediaSearchId = queryId; // Use queryId for unified SSE

			let cachedAdverseMedia: unknown = null;
			if (globalCacheEnabled && env.PEP_CACHE) {
				try {
					const cacheKey = generateCacheKey("adverse_media", query, entityType);
					cachedAdverseMedia = await readCache(env.PEP_CACHE, cacheKey);
					if (cachedAdverseMedia) {
						console.log(
							`[SearchCore] Adverse media cache hit for query "${query}" (entity: ${entityType})`,
						);
						adverseMediaSearch = {
							searchId: adverseMediaSearchId,
							status: "completed",
							result: cachedAdverseMedia,
						};
						const rl =
							(cachedAdverseMedia as { risk_level?: string }).risk_level ??
							"none";
						const adverseMediaHasRisk = rl !== "none";
						const adverseMediaRiskLevel = adverseMediaHasRisk ? rl : null;
						await prisma.searchQuery.update({
							where: { id: queryId },
							data: {
								adverseMediaStatus: "completed",
								adverseMediaResult: JSON.stringify(cachedAdverseMedia),
								adverseMediaHasRisk,
								adverseMediaRiskLevel,
							},
						});
						await checkAndUpdateQueryCompletion(prisma, queryId);
						if (source === QUERY_SOURCE.AML && env.AML_SERVICE) {
							const matched = rl === "high" || rl === "medium";
							executionCtx.waitUntil(
								env.AML_SERVICE.processScreeningCallback({
									queryId,
									type: "adverse_media",
									status: "completed",
									matched,
								}).catch((err) =>
									console.error(
										"[SearchCore] AML callback (adverse_media cache) failed:",
										err,
									),
								),
							);
						}
					}
				} catch (error) {
					console.warn(
						`[SearchCore] Failed to check adverse media cache:`,
						error,
					);
				}
			}

			if (!cachedAdverseMedia) {
				if (researchProvider === "gemini") {
					adverseMediaSearch = {
						searchId: adverseMediaSearchId,
						status: "pending",
						result: null,
					};
					executionCtx.waitUntil(
						(async () => {
							const t0 = Date.now();
							try {
								void broadcastPepEvent(
									env,
									adverseMediaSearchId,
									"adverse_media_progress",
									{
										phase: "searching",
										message: "Searching adverse media...",
										progress: 0.2,
									},
								);
								const geminiResult = await runGeminiAdverseMediaResearch(env, {
									query,
									entityType,
									birthdate: birthDate,
									country: countries?.[0],
								});
								await completeAdverseMediaResearch(env, {
									searchId: adverseMediaSearchId,
									query,
									entityType,
									risk_level: geminiResult.risk_level,
									findings: geminiResult.findings,
									sources: geminiResult.sources,
									logPrefix: "[SearchCore/Gemini adverse]",
								});
								const shadowOn = await resolveResearchShadowEnabled(
									env,
									organizationId,
								);
								if (shadowOn && researchShadowSample(adverseMediaSearchId)) {
									logResearchShadowMetric({
										kind: "watchlist_research_shadow_sample",
										search_id: adverseMediaSearchId,
										organization_id: organizationId,
										research_kind: "adverse_media",
										provider: "gemini",
										latency_ms: Date.now() - t0,
										summary: {
											risk_level: geminiResult.risk_level,
											source_count: geminiResult.sources.length,
										},
									});
								}
							} catch (err) {
								const msg = err instanceof Error ? err.message : String(err);
								console.error("[SearchCore] Gemini adverse media failed:", err);
								await failAdverseMediaResearch(env, {
									searchId: adverseMediaSearchId,
									error: msg,
									logPrefix: "[SearchCore/Gemini adverse]",
								});
							}
						})(),
					);
				} else if (env.THREAD_SVC) {
					const baseUrl = getCallbackUrl(env.ENVIRONMENT);
					const callbackUrl = baseUrl + "/internal/adverse-media";
					const progressCallbackUrl =
						baseUrl + "/internal/adverse-media/progress";

					const threadPayload = {
						task_type: "adverse_media_grok",
						job_params: {
							query: query,
							callback_url: callbackUrl,
							progress_callback_url: progressCallbackUrl,
							search_id: adverseMediaSearchId,
							entity_type: entityType,
							birthdate: birthDate,
							country: countries?.[0],
						},
						metadata: {
							source: "watchlist-svc",
							triggered_by: "search",
							needs_grok_key: true,
							...(env.GROK_API_KEY && {
								env: { GROK_API_KEY: env.GROK_API_KEY },
							}),
						},
					};

					try {
						await env.THREAD_SVC.createThread(threadPayload);
						adverseMediaSearch = {
							searchId: adverseMediaSearchId,
							status: "pending",
							result: null,
						};
					} catch (threadError) {
						console.error(
							`[SearchCore] Error creating adverse media thread:`,
							threadError,
						);
						adverseMediaSearch = {
							searchId: adverseMediaSearchId,
							status: "failed",
							result: null,
						};
					}
				} else {
					console.warn(
						"[SearchCore] Adverse media failed: provider=grok but THREAD_SVC missing",
					);
					adverseMediaSearch = {
						searchId: adverseMediaSearchId,
						status: "failed",
						result: null,
					};
				}
			}
		} catch (error) {
			console.error(
				`[SearchCore] Failed to trigger adverse media search:`,
				error,
			);
			// Don't fail the whole search if adverse media fails
		}
	}

	// ===================================================================
	// Return Results
	// ===================================================================
	return {
		queryId,
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
		pepAiSearch,
		adverseMediaSearch,
	};
}
