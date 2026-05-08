import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/index";
import { performSearch } from "../../src/lib/search-core";
import { QUERY_SOURCE } from "../../src/lib/query-source";
import { generateCacheKey, writeCache } from "../../src/lib/search-query-utils";
import {
	generateSyncCacheKey,
	writeSyncCache,
} from "../../src/lib/watchlist-cache";
import {
	clearPepCache,
	mergeTestBindingsWithGlobalCacheFlag,
} from "./_helpers";

describe("performSearch — L1 sync cache & AML Grok cache hits", () => {
	beforeEach(async () => {
		await clearPepCache(env);
	});

	it("preloaded L1 KV skips AI/Vectorize and yields distinct queryIds per org", async () => {
		const query = "Sync cache harness entity ABC 991";
		const environment = "production";
		const syncKey = generateSyncCacheKey({
			query,
			entityType: "person",
			birthDate: null,
			countries: null,
			identifiers: null,
			topK: 50,
			threshold: 0.875,
			environment,
		});

		expect(env.PEP_CACHE).toBeDefined();
		await writeSyncCache(env.PEP_CACHE!, syncKey, {
			v: 1,
			ofac: [],
			unsc: [],
			sat69b: [],
		});

		const pending: Promise<unknown>[] = [];
		const executionCtx = {
			waitUntil(p: Promise<unknown>) {
				pending.push(p);
			},
		} as unknown as ExecutionContext;

		const mergedEnv = mergeTestBindingsWithGlobalCacheFlag(
			env as unknown as Bindings,
			true,
			{
				CACHE_ENABLED: "true",
				PEP_SEARCH_ENABLED: "false",
				PEP_GROK_ENABLED: "false",
				ADVERSE_MEDIA_ENABLED: "false",
			} as unknown as Partial<Bindings>,
		);

		const r1 = await performSearch({
			env: mergedEnv,
			executionCtx,
			organizationId: "org-a",
			userId: "user-1",
			source: QUERY_SOURCE.AML,
			query,
			entityType: "person",
			topK: 50,
			threshold: 0.875,
			environment,
		});

		const r2 = await performSearch({
			env: mergedEnv,
			executionCtx,
			organizationId: "org-b",
			userId: "user-2",
			source: QUERY_SOURCE.AML,
			query,
			entityType: "person",
			topK: 50,
			threshold: 0.875,
			environment,
		});

		await Promise.all(pending);

		expect(r1.queryId).not.toBe(r2.queryId);
		expect(r1.ofac.count).toBe(0);
		expect(r2.ofac.count).toBe(0);
	});

	it("AML screening: pep_ai KV cache hit schedules processScreeningCallback via waitUntil", async () => {
		const query = "Pep AI AML cache harness XYZ 772";
		const environment = "production";

		const syncKey = generateSyncCacheKey({
			query,
			entityType: "person",
			birthDate: null,
			countries: null,
			identifiers: null,
			topK: 50,
			threshold: 0.875,
			environment,
		});
		await writeSyncCache(env.PEP_CACHE!, syncKey, {
			v: 1,
			ofac: [],
			unsc: [],
			sat69b: [],
		});

		const pepCacheSuffix = ["person"].filter(Boolean).join(":");
		const pepAiKey = generateCacheKey("pep_ai", query, pepCacheSuffix);
		await writeCache(env.PEP_CACHE!, pepAiKey, {
			probability: 0.91,
			summary: { es: "x", en: "y" },
			sources: [],
		});

		const amlSpy = vi.fn().mockResolvedValue(undefined);
		const threadSpy = vi
			.fn()
			.mockRejectedValue(new Error("createThread should not run on cache hit"));

		const pending: Promise<unknown>[] = [];
		const executionCtx = {
			waitUntil(p: Promise<unknown>) {
				pending.push(p);
			},
		} as unknown as ExecutionContext;

		const mergedEnv = mergeTestBindingsWithGlobalCacheFlag(
			env as unknown as Bindings,
			true,
			{
				CACHE_ENABLED: "true",
				PEP_SEARCH_ENABLED: "false",
				PEP_GROK_ENABLED: "true",
				ADVERSE_MEDIA_ENABLED: "false",
				THREAD_SVC: { createThread: threadSpy },
				AML_SERVICE: { processScreeningCallback: amlSpy },
			} as unknown as Partial<Bindings>,
		);

		await performSearch({
			env: mergedEnv,
			executionCtx,
			organizationId: "org-aml",
			userId: "user-aml",
			source: QUERY_SOURCE.AML,
			query,
			entityType: "person",
			topK: 50,
			threshold: 0.875,
			environment,
		});

		await Promise.all(pending);

		expect(threadSpy).not.toHaveBeenCalled();
		expect(amlSpy).toHaveBeenCalledTimes(1);
		expect(amlSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "pep_ai",
				status: "completed",
				matched: true,
			}),
		);
	});
});
