/**
 * Cross-org watchlist caching (KV): L1 synchronous hybrid results + L2 Grok payloads.
 */

import { createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";
import type { Bindings } from "../index";
import type { FlagsSvcBinding } from "../types/flags-rpc";
import { WATCHLIST_FEATURE_FLAG_KEYS } from "./watchlist-feature-flags";
import { readCache } from "./search-query-utils";

export { generateCacheKey, readCache, writeCache } from "./search-query-utils";

/** TTL for L1 sync hybrid-search cache (seconds): 1 hour. */
export const WATCHLIST_SYNC_CACHE_TTL_SECONDS = 3600;

/**
 * Flag evaluation context for container callbacks: use the same deployment environment
 * string stored on the SearchQuery row as performSearch (defaults to "production").
 */
export async function resolveSearchQueryFlagEnvironment(
	prisma: PrismaClient,
	searchId: string,
): Promise<string> {
	const row = await prisma.searchQuery.findUnique({
		where: { id: searchId },
		select: { environment: true },
	});
	return row?.environment ?? "production";
}

export interface SyncCacheKeyInput {
	query: string;
	entityType: string;
	birthDate?: string | null;
	countries?: string[] | null;
	identifiers?: string[] | null;
	topK: number;
	threshold: number;
	environment: string;
}

/** Normalize query string for deterministic cache keys (exact match; no fuzzy fallback). */
export function normalizeQueryForCache(s: string): string {
	return s
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.trim()
		.replace(/\s+/g, " ");
}

export function generateSyncCacheKey(input: SyncCacheKeyInput): string {
	const normalizedCountries = [...(input.countries ?? [])]
		.map((c) => c.trim().toLowerCase())
		.sort();
	const normalizedIds = [...(input.identifiers ?? [])]
		.map((id) => id.trim().toLowerCase())
		.sort();
	const payload = {
		q: normalizeQueryForCache(input.query),
		entityType: input.entityType,
		birthDate: input.birthDate ?? null,
		countries: normalizedCountries,
		identifiers: normalizedIds,
		topK: input.topK,
		threshold: input.threshold,
		environment: input.environment,
	};
	const hash = createHash("sha256")
		.update(JSON.stringify(payload))
		.digest("hex");
	return `watchlist_sync:${hash}`;
}

export async function readSyncCache<T>(
	kv: KVNamespace,
	key: string,
): Promise<T | null> {
	return readCache<T>(kv, key);
}

export async function writeSyncCache(
	kv: KVNamespace,
	key: string,
	value: unknown,
): Promise<void> {
	try {
		await kv.put(key, JSON.stringify(value), {
			expirationTtl: WATCHLIST_SYNC_CACHE_TTL_SECONDS,
		});
		console.log(
			`[SyncCache] Wrote to KV (key: ${key}, TTL: ${WATCHLIST_SYNC_CACHE_TTL_SECONDS}s)`,
		);
	} catch (error) {
		console.error(`[SyncCache] Failed to write (key: ${key}):`, error);
	}
}

/**
 * When flags-svc is available, `watchlist-global-cache` controls all KV reads/writes.
 * Falls back to CACHE_ENABLED=true when FLAGS_SERVICE is missing or RPC fails.
 */
export async function isGlobalCacheEnabled(
	env: Bindings,
	evaluationContext?: { environment?: string },
): Promise<boolean> {
	const flagsBinding = env.FLAGS_SERVICE as unknown as
		| FlagsSvcBinding
		| undefined;
	if (flagsBinding?.isFlagEnabled) {
		try {
			return await flagsBinding.isFlagEnabled(
				WATCHLIST_FEATURE_FLAG_KEYS.globalCache,
				{
					environment:
						evaluationContext?.environment ?? env.ENVIRONMENT ?? "production",
				},
			);
		} catch (err) {
			console.warn(
				"[watchlist-cache] FLAGS_SERVICE.isFlagEnabled failed; falling back to CACHE_ENABLED",
				err,
			);
		}
	}
	return String(env.CACHE_ENABLED ?? "") === "true";
}
