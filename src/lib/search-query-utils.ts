/**
 * Shared utilities for search query persistence and caching.
 *
 * Two-layer storage:
 * - Layer 1: KV cache (TTL varies by risk; see research cache helpers)
 * - Layer 2: D1 search_query table (org-scoped, permanent) for audit trail
 */

import { createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";

/** @deprecated Use {@link RESEARCH_CACHE_TTL_SECONDS_NEGATIVE} or TTL helpers. */
export const GROK_CACHE_TTL_SECONDS = 259200;

/** KV TTL for low-risk / negative PEP + adverse-media cache (30 days, seconds). */
export const RESEARCH_CACHE_TTL_SECONDS_NEGATIVE = 30 * 24 * 60 * 60;

/** KV TTL when a hit or elevated risk is present (7 days, seconds). */
export const RESEARCH_CACHE_TTL_SECONDS_POSITIVE = 7 * 24 * 60 * 60;

export type PepAiCachePayload = {
	probability: number;
	summary: { es: string; en: string };
	sources: string[];
};

export type AdverseMediaCachePayload = {
	risk_level: string;
	findings: { es: string; en: string };
	sources: string[];
};

/**
 * PEP AI: long TTL when probability is low; shorter when elevated.
 */
export function getPepAiResearchCacheTtlSeconds(
	payload: PepAiCachePayload,
): number {
	const p = payload.probability;
	if (typeof p !== "number" || !Number.isFinite(p) || p < 0.3) {
		return RESEARCH_CACHE_TTL_SECONDS_NEGATIVE;
	}
	return RESEARCH_CACHE_TTL_SECONDS_POSITIVE;
}

/**
 * Adverse media: long TTL when risk is none; shorter otherwise.
 */
export function getAdverseMediaResearchCacheTtlSeconds(
	payload: AdverseMediaCachePayload,
): number {
	const rl = payload.risk_level;
	if (rl === "none" || rl === undefined) {
		return RESEARCH_CACHE_TTL_SECONDS_NEGATIVE;
	}
	return RESEARCH_CACHE_TTL_SECONDS_POSITIVE;
}

/**
 * True when Grok PEP (pep_ai) should count as a list/detail "match".
 * Aligns with watchlist screening UI: completed + probability &gt; 0 (not an error payload).
 */
export function computePepAiIndicatesMatch(
	pepAiStatus: string,
	pepAiResult: string | null,
): boolean {
	if (pepAiStatus !== "completed" || !pepAiResult) return false;
	try {
		const parsed = JSON.parse(pepAiResult) as {
			probability?: number;
			error?: unknown;
		};
		if (parsed && "error" in parsed && parsed.error != null) return false;
		return typeof parsed.probability === "number" && parsed.probability > 0;
	} catch {
		return false;
	}
}

/**
 * Generate deterministic cache key from query string.
 * Same query always generates same key (cross-org cache sharing).
 */
export function generateCacheKey(
	prefix: string,
	query: string,
	suffix?: string,
): string {
	const normalized = query.toLowerCase().trim();
	const input = suffix ? `${normalized}:${suffix}` : normalized;
	const hash = createHash("sha256").update(input).digest("hex");
	return `${prefix}:${hash}`;
}

/**
 * Read from KV cache.
 * Returns parsed JSON or null if not found/expired.
 */
export async function readCache<T = unknown>(
	kv: KVNamespace,
	key: string,
): Promise<T | null> {
	try {
		const cached = await kv.get(key, "json");
		return cached as T | null;
	} catch (error) {
		console.warn(`[Cache] Failed to read from KV (key: ${key}):`, error);
		return null;
	}
}

/**
 * Write to KV cache with configurable TTL (defaults to negative-result window).
 */
export async function writeCache(
	kv: KVNamespace,
	key: string,
	value: unknown,
	ttlSeconds: number = RESEARCH_CACHE_TTL_SECONDS_NEGATIVE,
): Promise<void> {
	try {
		await kv.put(key, JSON.stringify(value), {
			expirationTtl: ttlSeconds,
		});
		console.log(`[Cache] Wrote to KV (key: ${key}, TTL: ${ttlSeconds}s)`);
	} catch (error) {
		console.error(`[Cache] Failed to write to KV (key: ${key}):`, error);
		// Don't throw - cache failures shouldn't break the flow
	}
}

/**
 * Check if all search types are done and update query status accordingly.
 *
 * Status logic:
 * - "completed": All types done (completed/failed/skipped)
 * - "partial": Some types done, others pending
 * - "pending": No types done yet
 * - "failed": All types done, at least one failed
 */
export async function checkAndUpdateQueryCompletion(
	prisma: PrismaClient,
	queryId: string,
): Promise<void> {
	try {
		const query = await prisma.searchQuery.findUnique({
			where: { id: queryId },
		});

		if (!query) {
			console.warn(
				`[QueryCompletion] Query ${queryId} not found, skipping completion check`,
			);
			return;
		}

		const allStatuses = [
			query.ofacStatus,
			query.sat69bStatus,
			query.unStatus,
			query.pepOfficialStatus,
			query.pepAiStatus,
			query.adverseMediaStatus,
		];

		const doneStatuses = ["completed", "failed", "skipped"];
		const allDone = allStatuses.every((s) => doneStatuses.includes(s));
		const anyFailed = allStatuses.some((s) => s === "failed");
		const anyCompleted = allStatuses.some((s) => s === "completed");

		let newStatus: string | null = null;

		if (allDone) {
			// All search types finished
			newStatus = anyFailed ? "failed" : "completed";
		} else if (anyCompleted) {
			// At least one finished, others still pending
			newStatus = "partial";
		}

		if (newStatus && newStatus !== query.status) {
			await prisma.searchQuery.update({
				where: { id: queryId },
				data: { status: newStatus },
			});
			console.log(
				`[QueryCompletion] Updated query ${queryId} status to ${newStatus}`,
			);
		}
	} catch (error) {
		console.error(
			`[QueryCompletion] Failed to check/update completion for ${queryId}:`,
			error,
		);
		// Don't throw - completion check failures shouldn't break the flow
	}
}
