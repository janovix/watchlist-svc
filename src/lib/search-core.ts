/**
 * Core search logic shared between public and internal search endpoints
 */

import { ApiException } from "chanfana";
import { createPrismaClient } from "./prisma";
import { parseVectorId } from "./ofac-vectorize-service";
import { getCallbackUrl } from "./callback-utils";
import {
	normalizeIdentifier,
	bestNameScore,
	computeMetaScore,
	computeHybridScore,
} from "./matching-utils";
import { createHash } from "crypto";
import type { Bindings } from "../index";

// Type definitions for search targets
export type OfacTargetType = {
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

export type UnscTargetType = {
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

export type Sat69bTargetType = {
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

export interface SearchParams {
	env: Bindings;
	executionCtx: ExecutionContext;
	organizationId: string;
	userId: string;
	source: string; // 'manual' | 'aml-screening'
	query: string;
	entityType?: string;
	birthDate?: string;
	countries?: string[];
	identifiers?: string[];
	topK?: number;
	threshold?: number;
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
		status: "completed" | "pending";
		results: unknown | null;
	};
	pepAiSearch?: {
		searchId: string;
		status: "completed" | "pending" | "skipped";
		result: unknown | null;
	};
	adverseMediaSearch?: {
		searchId: string;
		status: "completed" | "pending";
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
		topK = 20,
		threshold = 0.7,
	} = params;

	// Generate query ID for persistent tracking and SSE subscription
	const queryId = crypto.randomUUID();
	console.log("[SearchCore] Generated query ID:", queryId);

	// Create SearchQuery record for audit trail and async result aggregation
	const prisma = createPrismaClient(env.DB);

	try {
		await prisma.searchQuery.create({
			data: {
				id: queryId,
				organizationId,
				userId,
				query,
				source,
				entityType,
				birthDate: birthDate ?? null,
				countries: countries ? JSON.stringify(countries) : null,
				status: "pending",
				// Set to pending so containers can update it; will transition to completed/failed when all async searches finish
				ofacStatus: "running",
				sat69bStatus: "running",
				unStatus: "running",
				pepOfficialStatus: "pending",
				// Grok PEP is only for persons, not organizations
				pepAiStatus: entityType === "person" ? "pending" : "skipped",
				adverseMediaStatus: "pending",
			},
		});
		console.log(
			`[SearchCore] Created SearchQuery record ${queryId} for org ${organizationId}`,
		);
	} catch (err) {
		console.error(
			`[SearchCore] Failed to create SearchQuery (non-fatal, continuing):`,
			err,
		);
		// Don't fail the whole search if query creation fails
	}

	// Check required bindings
	if (!env.AI) {
		console.error("[SearchCore] AI binding not available");
		const error = new ApiException(
			"AI binding not available. Please ensure Workers AI is enabled for your account.",
		);
		error.status = 503;
		error.code = 503;
		throw error;
	}

	if (!env.WATCHLIST_VECTORIZE) {
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

				if (identifierMatches.results && identifierMatches.results.length > 0) {
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
					"[SearchCore] Error in identifier lookup:",
					identifierError,
				);
				// Continue with vector search even if identifier lookup fails
			}
		}
	}

	// Step B: Vector Search
	console.log("[SearchCore] Step B: Generating embedding for query");
	const queryResponse = (await env.AI.run("@cf/baai/bge-base-en-v1.5", {
		text: [query],
	})) as { data: number[][] };

	if (
		!queryResponse ||
		!Array.isArray(queryResponse.data) ||
		queryResponse.data.length === 0
	) {
		console.error("[SearchCore] Failed to generate query embedding");
		const error = new ApiException("Failed to generate query embedding");
		error.status = 500;
		error.code = 500;
		throw error;
	}

	const embedding = queryResponse.data[0] as number[];
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
	const vectorizeResults = await env.WATCHLIST_VECTORIZE.query(
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
	console.log("[SearchCore] Step D: Computing hybrid scores");

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
			if (candidate.dataset === "ofac_sdn" || candidate.dataset === "unsc") {
				const target = candidate.target as {
					primaryName: string;
					aliases: string[] | null;
					birthDate: string | null;
				};
				nameScore = bestNameScore(query, target.primaryName, target.aliases);
			} else if (candidate.dataset === "sat_69b") {
				const target = candidate.target as { taxpayerName: string };
				nameScore = bestNameScore(query, target.taxpayerName, null);
			}

			// Compute meta score (only for datasets with birthDate)
			if (candidate.dataset === "ofac_sdn" || candidate.dataset === "unsc") {
				const target = candidate.target as { birthDate: string | null };
				metaScore = computeMetaScore(
					birthDate,
					countries,
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
		if (finalScore < threshold) continue;

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
				status: "completed" | "pending";
				results: unknown | null;
		  }
		| undefined = undefined;

	// Use queryId directly instead of hash-based search ID
	const pepSearchId = queryId;

	// Check KV cache if enabled (still using query hash for cache key)
	const cacheEnabled = env.PEP_CACHE_ENABLED === "true";
	let cachedPepResults: unknown = null;

	if (cacheEnabled && env.PEP_CACHE) {
		try {
			const cacheKey = generatePepCacheKey(query);
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
					search_id: pepSearchId, // CHANGED: use queryId instead of pep_${hash}
					max_results: 1000,
				},
				metadata: {
					source: "watchlist-svc",
					triggered_by: "search",
				},
			};

			// Fire-and-forget: use waitUntil to prevent cancellation
			executionCtx.waitUntil(
				env.THREAD_SVC.fetch("http://thread-svc/threads", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(threadPayload),
				})
					.then((response) => {
						if (response.ok) {
							console.log(
								`[SearchCore] PEP search thread created for query "${query}"`,
							);
						} else {
							console.error(
								`[SearchCore] Failed to create PEP thread: ${response.status}`,
							);
						}
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
			// Don't fail the whole search if PEP fails
		}
	}

	// ===================================================================
	// Grok PEP AI Search (Person-only, Fire-and-Forget)
	// ===================================================================
	let pepAiSearch:
		| {
				searchId: string;
				status: "completed" | "pending" | "skipped";
				result: unknown | null;
		  }
		| undefined = undefined;

	if (entityType === "person" && env.THREAD_SVC) {
		try {
			const pepAiSearchId = queryId; // Use queryId for unified SSE
			const callbackUrl =
				getCallbackUrl(env.ENVIRONMENT) + "/internal/grok-pep";

			const threadPayload = {
				task_type: "pep_grok",
				job_params: {
					query: query,
					callback_url: callbackUrl,
					search_id: pepAiSearchId,
					birthdate: birthDate,
					country: countries?.[0],
				},
				metadata: {
					source: "watchlist-svc",
					triggered_by: "search",
					env: {
						XAI_API_KEY: env.GROK_API_KEY,
					},
				},
			};

			executionCtx.waitUntil(
				env.THREAD_SVC.fetch("http://thread-svc/threads", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(threadPayload),
				})
					.then((response) => {
						if (response.ok) {
							console.log(
								`[SearchCore] Grok PEP AI search thread created for query "${query}"`,
							);
						} else {
							console.error(
								`[SearchCore] Failed to create Grok PEP thread: ${response.status}`,
							);
						}
					})
					.catch((error) => {
						console.error(
							`[SearchCore] Error creating Grok PEP thread:`,
							error,
						);
					}),
			);

			pepAiSearch = {
				searchId: pepAiSearchId,
				status: "pending",
				result: null,
			};
		} catch (error) {
			console.error(`[SearchCore] Failed to trigger Grok PEP search:`, error);
			// Don't fail the whole search if Grok PEP fails
		}
	} else if (entityType !== "person") {
		pepAiSearch = {
			searchId: queryId,
			status: "skipped",
			result: null,
		};
	}

	// ===================================================================
	// Adverse Media Grok Search (Fire-and-Forget)
	// ===================================================================
	let adverseMediaSearch:
		| {
				searchId: string;
				status: "completed" | "pending";
				result: unknown | null;
		  }
		| undefined = undefined;

	if (env.THREAD_SVC) {
		try {
			const adverseMediaSearchId = queryId; // Use queryId for unified SSE
			const callbackUrl =
				getCallbackUrl(env.ENVIRONMENT) + "/internal/adverse-media";

			const threadPayload = {
				task_type: "adverse_media_grok",
				job_params: {
					query: query,
					callback_url: callbackUrl,
					search_id: adverseMediaSearchId,
					entity_type: entityType,
					birthdate: birthDate,
					country: countries?.[0],
				},
				metadata: {
					source: "watchlist-svc",
					triggered_by: "search",
					env: {
						XAI_API_KEY: env.GROK_API_KEY,
					},
				},
			};

			executionCtx.waitUntil(
				env.THREAD_SVC.fetch("http://thread-svc/threads", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(threadPayload),
				})
					.then((response) => {
						if (response.ok) {
							console.log(
								`[SearchCore] Adverse media Grok search thread created for query "${query}"`,
							);
						} else {
							console.error(
								`[SearchCore] Failed to create adverse media thread: ${response.status}`,
							);
						}
					})
					.catch((error) => {
						console.error(
							`[SearchCore] Error creating adverse media thread:`,
							error,
						);
					}),
			);

			adverseMediaSearch = {
				searchId: adverseMediaSearchId,
				status: "pending",
				result: null,
			};
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

/**
 * Generate PEP cache key from query (for KV cache)
 */
function generatePepCacheKey(query: string): string {
	const normalized = query.toLowerCase().trim();
	const hash = createHash("sha256").update(normalized).digest("hex");
	return `pep_search:${hash}`;
}
