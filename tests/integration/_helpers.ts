/**
 * Shared helpers for integration tests (Workers vitest pool).
 */

import type { PrismaClient } from "@prisma/client";
import type { Bindings } from "../../src/index";
import { WATCHLIST_FEATURE_FLAG_KEYS } from "../../src/lib/watchlist-feature-flags";
import type { FlagsSvcBinding } from "../../src/types/flags-rpc";

/** Base URL used by @cloudflare/vitest-pool-workers SELF.fetch in this repo. */
export function localSelfUrl(path: string): string {
	const p = path.startsWith("/") ? path : `/${path}`;
	return `http://local.test${p}`;
}

export function amlInternalSearchHeaders(
	organizationId: string,
	userId: string,
	environment = "production",
): Record<string, string> {
	return {
		"Content-Type": "application/json",
		"X-Organization-Id": organizationId,
		"X-User-Id": userId,
		"X-Environment": environment,
	};
}

/** Clear all keys in PEP_CACHE when the binding exists (best-effort). */
export async function clearPepCache(env: {
	PEP_CACHE?: KVNamespace;
}): Promise<void> {
	const pepCache = env.PEP_CACHE;
	if (!pepCache) return;
	try {
		let cursor: string | undefined;
		do {
			const page = await pepCache.list({ cursor });
			for (const key of page.keys) {
				await pepCache.delete(key.name);
			}
			cursor = page.list_complete ? undefined : page.cursor;
		} while (cursor);
	} catch {
		// Ignore when KV not configured or unsupported in harness
	}
}

export interface SeedIngestionRunOpts {
	sourceUrl: string;
	sourceType: string;
}

/**
 * Creates a running ingestion run row (after callers clear dataset-specific tables).
 */
export async function seedIngestionRun(
	prisma: PrismaClient,
	opts: SeedIngestionRunOpts,
): Promise<{ id: number }> {
	const run = await prisma.watchlistIngestionRun.create({
		data: {
			sourceUrl: opts.sourceUrl,
			sourceType: opts.sourceType,
			status: "running",
		},
	});
	return { id: run.id };
}

/**
 * Merge worker `env` with overrides and a stub {@link FlagsSvcBinding} so
 * `watchlist-global-cache` resolves deterministically in Vitest (real service
 * bindings are not RPC-complete in the pool).
 */
/**
 * PEP / Grok / adverse-media paths call THREAD_SVC and are flaky without stubs.
 * Disable them for integration tests that only exercise sync watchlist search.
 */
export function disableAsyncSearchSideEffects(testEnv: Bindings): void {
	const e = testEnv as unknown as Record<string, unknown>;
	e.PEP_SEARCH_ENABLED = "false";
	e.PEP_GROK_ENABLED = "false";
	e.ADVERSE_MEDIA_ENABLED = "false";
}

export function mergeTestBindingsWithGlobalCacheFlag(
	env: Bindings,
	globalCacheFlagEnabled: boolean,
	overrides: Partial<Bindings> = {},
): Bindings {
	const flagsService: FlagsSvcBinding = {
		fetch: async () => new Response(null, { status: 404 }),
		evaluateFlag: async () => null,
		evaluateFlags: async () => ({}),
		evaluateAllFlags: async () => ({}),
		isFlagEnabled: async (key) =>
			key === WATCHLIST_FEATURE_FLAG_KEYS.globalCache
				? globalCacheFlagEnabled
				: true,
	};
	return {
		...env,
		...overrides,
		FLAGS_SERVICE: flagsService as unknown as Bindings["FLAGS_SERVICE"],
	} as Bindings;
}
