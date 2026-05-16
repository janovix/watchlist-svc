/**
 * Persist PEP AI / adverse-media research results (Gemini or legacy containers).
 */

import type { Bindings } from "../index";
import {
	runWatchlistContainerFailurePipeline,
	runWatchlistContainerSuccessPipeline,
} from "./container-callback-pipeline";
import {
	generateCacheKey,
	getAdverseMediaResearchCacheTtlSeconds,
	getPepAiResearchCacheTtlSeconds,
} from "./search-query-utils";
import {
	isGlobalCacheEnabled,
	resolveSearchQueryFlagEnvironment,
} from "./watchlist-cache";
import { createPrismaClient } from "./prisma";

export async function completePepAiResearch(
	env: Bindings,
	params: {
		searchId: string;
		query: string;
		entityType: string;
		birthdate?: string;
		country?: string;
		probability: number;
		summary: { es: string; en: string };
		sources: string[];
		logPrefix?: string;
	},
): Promise<{ broadcastSent: number }> {
	const logPrefix = params.logPrefix ?? "[PepAiResearch]";
	const prismaForFlags = createPrismaClient(env.DB);
	const flagEnv = await resolveSearchQueryFlagEnvironment(
		prismaForFlags,
		params.searchId,
	);
	const cacheOn = await isGlobalCacheEnabled(env, { environment: flagEnv });
	const pepSuffix = [params.entityType, params.birthdate, params.country]
		.filter(Boolean)
		.join(":");
	const cacheKey = generateCacheKey(
		"pep_ai",
		params.query,
		pepSuffix.length > 0 ? pepSuffix : undefined,
	);

	const cachePayload = {
		probability: params.probability,
		summary: params.summary,
		sources: params.sources,
	};
	const ttlSeconds = getPepAiResearchCacheTtlSeconds(cachePayload);

	const { broadcastSent } = await runWatchlistContainerSuccessPipeline({
		env,
		searchId: params.searchId,
		logPrefix,
		cacheWrite:
			cacheOn && env.PEP_CACHE
				? {
						kv: env.PEP_CACHE,
						key: cacheKey,
						value: cachePayload,
						ttlSeconds,
					}
				: undefined,
		persist: async (prisma) => {
			const row = await prisma.searchQuery.update({
				where: { id: params.searchId },
				data: {
					pepAiStatus: "completed",
					pepAiResult: JSON.stringify(cachePayload),
				},
			});
			return { source: row.source };
		},
		aml: { type: "pep_ai", matched: params.probability >= 0.7 },
		broadcast: {
			event: "pep_grok_results",
			payload: {
				search_id: params.searchId,
				query: params.query,
				probability: params.probability,
				summary: params.summary,
				sources: params.sources,
				status: "completed",
				completed_at: new Date().toISOString(),
			},
		},
	});

	return { broadcastSent };
}

export async function failPepAiResearch(
	env: Bindings,
	params: { searchId: string; error: string; logPrefix?: string },
): Promise<void> {
	const logPrefix = params.logPrefix ?? "[PepAiResearch]";
	await runWatchlistContainerFailurePipeline({
		env,
		searchId: params.searchId,
		logPrefix,
		persist: async (prisma) => {
			const row = await prisma.searchQuery.update({
				where: { id: params.searchId },
				data: {
					pepAiStatus: "failed",
					pepAiResult: JSON.stringify({ error: params.error }),
				},
			});
			return { source: row.source };
		},
		aml: { type: "pep_ai" },
		broadcast: {
			event: "pep_grok_error",
			payload: {
				search_id: params.searchId,
				status: "failed",
				error: params.error,
				failed_at: new Date().toISOString(),
			},
		},
	});
}

export async function completeAdverseMediaResearch(
	env: Bindings,
	params: {
		searchId: string;
		query: string;
		entityType: string;
		risk_level: "none" | "low" | "medium" | "high";
		findings: { es: string; en: string };
		sources: string[];
		logPrefix?: string;
	},
): Promise<{ broadcastSent: number }> {
	const logPrefix = params.logPrefix ?? "[AdverseMediaResearch]";
	const prismaForFlags = createPrismaClient(env.DB);
	const flagEnv = await resolveSearchQueryFlagEnvironment(
		prismaForFlags,
		params.searchId,
	);
	const cacheOn = await isGlobalCacheEnabled(env, { environment: flagEnv });
	const cacheKey = generateCacheKey(
		"adverse_media",
		params.query,
		params.entityType,
	);

	const cachePayload = {
		risk_level: params.risk_level,
		findings: params.findings,
		sources: params.sources,
	};
	const ttlSeconds = getAdverseMediaResearchCacheTtlSeconds(cachePayload);

	const { broadcastSent } = await runWatchlistContainerSuccessPipeline({
		env,
		searchId: params.searchId,
		logPrefix,
		cacheWrite:
			cacheOn && env.PEP_CACHE
				? {
						kv: env.PEP_CACHE,
						key: cacheKey,
						value: cachePayload,
						ttlSeconds,
					}
				: undefined,
		persist: async (prisma) => {
			const row = await prisma.searchQuery.update({
				where: { id: params.searchId },
				data: {
					adverseMediaStatus: "completed",
					adverseMediaResult: JSON.stringify(cachePayload),
					adverseMediaHasRisk: params.risk_level !== "none",
					adverseMediaRiskLevel:
						params.risk_level !== "none" ? params.risk_level : null,
				},
			});
			return { source: row.source };
		},
		aml: {
			type: "adverse_media",
			matched: params.risk_level === "high" || params.risk_level === "medium",
		},
		broadcast: {
			event: "adverse_media_results",
			payload: {
				search_id: params.searchId,
				query: params.query,
				risk_level: params.risk_level,
				findings: params.findings,
				sources: params.sources,
				status: "completed",
				completed_at: new Date().toISOString(),
			},
		},
	});

	return { broadcastSent };
}

export async function failAdverseMediaResearch(
	env: Bindings,
	params: { searchId: string; error: string; logPrefix?: string },
): Promise<void> {
	const logPrefix = params.logPrefix ?? "[AdverseMediaResearch]";
	await runWatchlistContainerFailurePipeline({
		env,
		searchId: params.searchId,
		logPrefix,
		persist: async (prisma) => {
			const row = await prisma.searchQuery.update({
				where: { id: params.searchId },
				data: {
					adverseMediaStatus: "failed",
					adverseMediaResult: JSON.stringify({ error: params.error }),
				},
			});
			return { source: row.source };
		},
		aml: { type: "adverse_media" },
		broadcast: {
			event: "adverse_media_error",
			payload: {
				search_id: params.searchId,
				status: "failed",
				error: params.error,
				failed_at: new Date().toISOString(),
			},
		},
	});
}
