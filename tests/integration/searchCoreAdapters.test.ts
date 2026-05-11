import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/index";
import { createPrismaClient } from "../../src/lib/prisma";
import { performSearch } from "../../src/lib/search-core";
import { QUERY_SOURCE } from "../../src/lib/query-source";
import { WATCHLIST_EMBEDDING_MODEL } from "../../src/lib/embedding-config";
import { normalizeIdentifier } from "../../src/lib/matching-utils";
import { generateCacheKey } from "../../src/lib/search-query-utils";
import { generateSyncCacheKey } from "../../src/lib/watchlist-cache";
import type {
	EmbeddingsAdapter,
	VectorIndexAdapter,
} from "../../src/lib/search-vectorize";
import {
	clearPepCache,
	disableAsyncSearchSideEffects,
	mergeTestBindingsWithGlobalCacheFlag,
} from "./_helpers";

describe("performSearch — injected embeddings / vector adapters", () => {
	const prisma = createPrismaClient(env.DB);

	beforeEach(async () => {
		await clearPepCache(env);
		disableAsyncSearchSideEffects(env as unknown as Bindings);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await prisma.watchlistIdentifier.deleteMany({
			where: { recordId: { startsWith: "adapter-seed-" } },
		});
		await prisma.ofacSdnEntry.deleteMany({
			where: { id: { startsWith: "adapter-seed-" } },
		});
		await prisma.sat69bEntry.deleteMany({
			where: { id: { startsWith: "adapter-seed-" } },
		});
		await prisma.unscEntry.deleteMany({
			where: { id: { startsWith: "adapter-seed-" } },
		});
	});

	it("uses adapters for embed + vector query on identifier hit (sync path)", async () => {
		const recordId = `adapter-seed-${crypto.randomUUID()}`;
		const rawId = `adp-${recordId.slice(-12)}`;

		await prisma.ofacSdnEntry.create({
			data: {
				id: recordId,
				partyType: "Individual",
				primaryName: "Adapter Identifier Person",
				sourceList: "SDN",
			},
		});

		await prisma.watchlistIdentifier.create({
			data: {
				dataset: "ofac_sdn",
				recordId,
				identifierRaw: rawId,
				identifierNorm: normalizeIdentifier(rawId),
			},
		});

		const embedSpy = vi.fn(
			async (_text: string, _model: string): Promise<number[]> => [
				0.01, 0.02, 0.03,
			],
		);
		const querySpy = vi.fn(
			async (): Promise<{ matches: { id: string; score: number }[] }> => ({
				matches: [],
			}),
		);

		const mergedEnv = mergeTestBindingsWithGlobalCacheFlag(
			env as unknown as Bindings,
			false,
			{
				PEP_SEARCH_ENABLED: "false",
				PEP_GROK_ENABLED: "false",
				ADVERSE_MEDIA_ENABLED: "false",
			} as unknown as Partial<Bindings>,
		);

		const pending: Promise<unknown>[] = [];
		const executionCtx = {
			waitUntil(p: Promise<unknown>) {
				pending.push(p);
			},
		} as unknown as ExecutionContext;

		const result = await performSearch({
			env: mergedEnv,
			executionCtx,
			organizationId: "org-adapter",
			userId: "user-adapter",
			source: QUERY_SOURCE.AML,
			query: "irrelevant-name-for-identifier-hit",
			entityType: "person",
			identifiers: [rawId],
			topK: 10,
			threshold: 0.875,
			environment: "production",
			adapters: {
				embeddings: { embed: embedSpy },
				vectorIndex: { query: querySpy },
			},
		});

		await Promise.all(pending);

		expect(embedSpy).toHaveBeenCalledWith(
			"irrelevant-name-for-identifier-hit",
			WATCHLIST_EMBEDDING_MODEL,
		);
		expect(querySpy).toHaveBeenCalledTimes(1);

		expect(result.ofac.count).toBe(1);
		expect(result.ofac.matches[0]?.target.id).toBe(recordId);
		expect(result.ofac.matches[0]?.breakdown.identifierMatch).toBe(true);

		const row = await prisma.searchQuery.findUnique({
			where: { id: result.queryId },
		});
		expect(row?.ofacStatus).toBe("completed");
		expect(row?.ofacCount).toBe(1);
	});

	it("hybrid scoring via adapters when vector returns a hydrated OFAC row", async () => {
		const recordId = `adapter-seed-${crypto.randomUUID()}`;
		const primaryName = "Zebra Adapter Hybrid Person QA";

		await prisma.ofacSdnEntry.create({
			data: {
				id: recordId,
				partyType: "Individual",
				primaryName,
				sourceList: "SDN",
			},
		});

		const embeddingsAdapter: EmbeddingsAdapter = {
			embed: async () => new Array(8).fill(0.05),
		};
		const vectorIndexAdapter: VectorIndexAdapter = {
			query: async () => ({
				matches: [
					{
						id: `ofac_sdn:${recordId}`,
						score: 0.95,
						metadata: { recordId, dataset: "ofac_sdn" },
					},
				],
			}),
		};

		const mergedEnv = mergeTestBindingsWithGlobalCacheFlag(
			env as unknown as Bindings,
			false,
			{
				PEP_SEARCH_ENABLED: "false",
				PEP_GROK_ENABLED: "false",
				ADVERSE_MEDIA_ENABLED: "false",
			} as unknown as Partial<Bindings>,
		);

		const pending: Promise<unknown>[] = [];
		const executionCtx = {
			waitUntil(p: Promise<unknown>) {
				pending.push(p);
			},
		} as unknown as ExecutionContext;

		const result = await performSearch({
			env: mergedEnv,
			executionCtx,
			organizationId: "org-hyb",
			userId: "user-hyb",
			source: QUERY_SOURCE.WATCHLIST_QUERY,
			query: primaryName,
			entityType: "person",
			topK: 20,
			threshold: 0.875,
			environment: "production",
			adapters: {
				embeddings: embeddingsAdapter,
				vectorIndex: vectorIndexAdapter,
			},
		});

		await Promise.all(pending);

		expect(result.ofac.count).toBe(1);
		expect(result.ofac.matches[0]?.breakdown.identifierMatch).toBe(false);
		expect(result.ofac.matches[0]?.score).toBeGreaterThanOrEqual(0.875);
	});

	it("routes SAT 69-B and UNSC identifier matches into the correct result buckets", async () => {
		const satId = `adapter-seed-sat-${crypto.randomUUID()}`;
		const unscId = `adapter-seed-unsc-${crypto.randomUUID()}`;
		const satRfc = `SAT${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
		const unscDoc = `UN-${crypto.randomUUID().slice(0, 8)}`;

		await prisma.sat69bEntry.create({
			data: {
				id: satId,
				rfc: satRfc,
				taxpayerName: "Adapter SAT Identifier Taxpayer",
				taxpayerStatus: "Definitivo",
			},
		});
		await prisma.unscEntry.create({
			data: {
				id: unscId,
				partyType: "Individual",
				primaryName: "Adapter UNSC Identifier Person",
				unListType: "TAL",
				identifiers: JSON.stringify([{ type: "PASSPORT", number: unscDoc }]),
			},
		});
		await prisma.watchlistIdentifier.createMany({
			data: [
				{
					dataset: "sat_69b",
					recordId: satId,
					identifierRaw: satRfc,
					identifierNorm: normalizeIdentifier(satRfc),
				},
				{
					dataset: "unsc",
					recordId: unscId,
					identifierRaw: unscDoc,
					identifierNorm: normalizeIdentifier(unscDoc),
				},
			],
		});

		const result = await performSearch({
			env: mergeTestBindingsWithGlobalCacheFlag(
				env as unknown as Bindings,
				false,
				{
					PEP_SEARCH_ENABLED: "false",
					PEP_GROK_ENABLED: "false",
					ADVERSE_MEDIA_ENABLED: "false",
				} as unknown as Partial<Bindings>,
			),
			executionCtx: { waitUntil: vi.fn() } as unknown as ExecutionContext,
			organizationId: "org-adapter-identifiers",
			userId: "user-adapter",
			source: QUERY_SOURCE.WATCHLIST_QUERY,
			query: "identifier buckets",
			entityType: "person",
			identifiers: [satRfc, unscDoc],
			topK: 10,
			threshold: 0.875,
			environment: "production",
			adapters: {
				embeddings: { embed: async () => [0.01, 0.02] },
				vectorIndex: { query: async () => ({ matches: [] }) },
			},
		});

		expect(result.sat69b.count).toBe(1);
		expect(result.sat69b.matches[0]?.target.id).toBe(satId);
		expect(result.sat69b.matches[0]?.breakdown.identifierMatch).toBe(true);
		expect(result.unsc.count).toBe(1);
		expect(result.unsc.matches[0]?.target.id).toBe(unscId);
		expect(result.unsc.matches[0]?.breakdown.identifierMatch).toBe(true);
	});

	it("hydrates SAT 69-B and UNSC vector matches via metadata and vector-id fallback", async () => {
		const satId = `adapter-seed-sat-vector-${crypto.randomUUID()}`;
		const unscId = `adapter-seed-unsc-vector-${crypto.randomUUID()}`;

		await prisma.sat69bEntry.create({
			data: {
				id: satId,
				rfc: "SATVEC800101AAA",
				taxpayerName: "Adapter SAT Vector Match",
				taxpayerStatus: "Definitivo",
			},
		});
		await prisma.unscEntry.create({
			data: {
				id: unscId,
				partyType: "Individual",
				primaryName: "Adapter UNSC Vector Match",
				unListType: "TAL",
			},
		});

		const result = await performSearch({
			env: mergeTestBindingsWithGlobalCacheFlag(
				env as unknown as Bindings,
				false,
				{
					PEP_SEARCH_ENABLED: "false",
					PEP_GROK_ENABLED: "false",
					ADVERSE_MEDIA_ENABLED: "false",
				} as unknown as Partial<Bindings>,
			),
			executionCtx: { waitUntil: vi.fn() } as unknown as ExecutionContext,
			organizationId: "org-adapter-vectors",
			userId: "user-adapter",
			source: QUERY_SOURCE.WATCHLIST_QUERY,
			query: "Adapter Vector Match",
			entityType: "person",
			topK: 10,
			threshold: 0.7,
			environment: "production",
			adapters: {
				embeddings: { embed: async () => [0.02, 0.03] },
				vectorIndex: {
					query: async () => ({
						matches: [
							{
								id: "ignored-when-metadata-present",
								score: 0.99,
								metadata: { dataset: "sat_69b", recordId: satId },
							},
							{ id: `unsc:${unscId}`, score: 0.99 },
						],
					}),
				},
			},
		});

		expect(result.sat69b.matches[0]?.target.id).toBe(satId);
		expect(result.unsc.matches[0]?.target.id).toBe(unscId);
		expect(result.sat69b.matches[0]?.breakdown.identifierMatch).toBe(false);
		expect(result.unsc.matches[0]?.breakdown.identifierMatch).toBe(false);
	});

	it("continues when identifier lookup fails and still uses vector results", async () => {
		const recordId = `adapter-seed-ofac-identifier-error-${crypto.randomUUID()}`;
		await prisma.ofacSdnEntry.create({
			data: {
				id: recordId,
				partyType: "Individual",
				primaryName: "Adapter Identifier Error Vector Person",
				sourceList: "SDN",
			},
		});

		const db = env.DB as D1Database;
		const originalPrepare = db.prepare.bind(db);
		vi.spyOn(db, "prepare").mockImplementation((query: string) => {
			if (query.includes("watchlist_identifier")) {
				throw new Error("identifier lookup unavailable");
			}
			return originalPrepare(query);
		});

		const result = await performSearch({
			env: mergeTestBindingsWithGlobalCacheFlag(
				env as unknown as Bindings,
				false,
				{
					PEP_SEARCH_ENABLED: "false",
					PEP_GROK_ENABLED: "false",
					ADVERSE_MEDIA_ENABLED: "false",
				} as unknown as Partial<Bindings>,
			),
			executionCtx: { waitUntil: vi.fn() } as unknown as ExecutionContext,
			organizationId: "org-adapter-identifier-error",
			userId: "user-adapter",
			source: QUERY_SOURCE.WATCHLIST_QUERY,
			query: "Adapter Identifier Error Vector Person",
			entityType: "person",
			identifiers: ["ERR-123"],
			topK: 10,
			threshold: 0.7,
			environment: "production",
			adapters: {
				embeddings: { embed: async () => [0.01, 0.02] },
				vectorIndex: {
					query: async () => ({
						matches: [{ id: `ofac_sdn:${recordId}`, score: 0.99 }],
					}),
				},
			},
		});

		expect(result.ofac.count).toBe(1);
		expect(result.ofac.matches[0]?.target.id).toBe(recordId);
		expect(result.ofac.matches[0]?.breakdown.identifierMatch).toBe(false);
	});

	it("throws an ApiException when the injected embeddings adapter returns no vector", async () => {
		await expect(
			performSearch({
				env: mergeTestBindingsWithGlobalCacheFlag(
					env as unknown as Bindings,
					false,
					{
						PEP_SEARCH_ENABLED: "false",
						PEP_GROK_ENABLED: "false",
						ADVERSE_MEDIA_ENABLED: "false",
					} as unknown as Partial<Bindings>,
				),
				executionCtx: { waitUntil: vi.fn() } as unknown as ExecutionContext,
				organizationId: "org-empty-embedding",
				userId: "user-adapter",
				source: QUERY_SOURCE.WATCHLIST_QUERY,
				query: "empty embedding",
				entityType: "person",
				topK: 10,
				threshold: 0.875,
				environment: "production",
				adapters: {
					embeddings: { embed: async () => [] },
					vectorIndex: { query: async () => ({ matches: [] }) },
				},
			}),
		).rejects.toMatchObject({
			status: 500,
			message: "Failed to generate query embedding",
		});
	});

	it("uses the L1 sync cache when present and skips vector adapters", async () => {
		const query = "Adapter Cached Sync Person";
		const syncKey = generateSyncCacheKey({
			query,
			entityType: "person",
			birthDate: null,
			countries: null,
			identifiers: null,
			topK: 10,
			threshold: 0.875,
			environment: "production",
		});
		await env.PEP_CACHE.put(
			syncKey,
			JSON.stringify({
				v: 1,
				ofac: [
					{
						target: { id: "cached-ofac", primaryName: query },
						score: 0.9,
						breakdown: {
							vectorScore: 0.9,
							nameScore: 1,
							metaScore: 0,
							identifierMatch: false,
						},
					},
				],
				unsc: [],
				sat69b: [],
			}),
		);

		const embedSpy = vi.fn(async () => [0.01, 0.02]);
		const querySpy = vi.fn(async () => ({ matches: [] }));
		const result = await performSearch({
			env: mergeTestBindingsWithGlobalCacheFlag(
				env as unknown as Bindings,
				true,
				{
					PEP_SEARCH_ENABLED: "false",
					PEP_GROK_ENABLED: "false",
					ADVERSE_MEDIA_ENABLED: "false",
				} as unknown as Partial<Bindings>,
			),
			executionCtx: { waitUntil: vi.fn() } as unknown as ExecutionContext,
			organizationId: "org-l1-hit",
			userId: "user-adapter",
			source: QUERY_SOURCE.WATCHLIST_QUERY,
			query,
			entityType: "person",
			topK: 10,
			threshold: 0.875,
			environment: "production",
			adapters: {
				embeddings: { embed: embedSpy },
				vectorIndex: { query: querySpy },
			},
		});

		expect(result.ofac.count).toBe(1);
		expect(result.ofac.matches[0]?.target.id).toBe("cached-ofac");
		expect(embedSpy).not.toHaveBeenCalled();
		expect(querySpy).not.toHaveBeenCalled();
	});

	it("writes the L1 sync cache on a global-cache miss", async () => {
		const query = `Adapter Sync Cache Miss ${crypto.randomUUID()}`;
		const syncKey = generateSyncCacheKey({
			query,
			entityType: "person",
			birthDate: null,
			countries: null,
			identifiers: null,
			topK: 10,
			threshold: 0.875,
			environment: "production",
		});
		const pending: Promise<unknown>[] = [];

		await performSearch({
			env: mergeTestBindingsWithGlobalCacheFlag(
				env as unknown as Bindings,
				true,
				{
					PEP_SEARCH_ENABLED: "false",
					PEP_GROK_ENABLED: "false",
					ADVERSE_MEDIA_ENABLED: "false",
				} as unknown as Partial<Bindings>,
			),
			executionCtx: {
				waitUntil(p: Promise<unknown>) {
					pending.push(p);
				},
			} as unknown as ExecutionContext,
			organizationId: "org-l1-miss",
			userId: "user-adapter",
			source: QUERY_SOURCE.WATCHLIST_QUERY,
			query,
			entityType: "person",
			topK: 10,
			threshold: 0.875,
			environment: "production",
			adapters: {
				embeddings: { embed: async () => [0.01, 0.02] },
				vectorIndex: { query: async () => ({ matches: [] }) },
			},
		});

		await Promise.all(pending);
		const cached = await env.PEP_CACHE.get<{ v: 1 }>(syncKey, "json");
		expect(cached?.v).toBe(1);
	});

	it("uses PEP, PEP AI, and adverse-media cache hits and sends AML callbacks", async () => {
		const query = `Adapter Async Cache ${crypto.randomUUID()}`;
		await env.PEP_CACHE.put(
			generateCacheKey("pep_search", query),
			JSON.stringify({ officials: [{ name: query }] }),
		);
		await env.PEP_CACHE.put(
			generateCacheKey("pep_ai", query, "person:1980-01-01:MX"),
			JSON.stringify({
				probability: 0.8,
				summary: { es: "si", en: "yes" },
				sources: ["https://example.com/pep"],
			}),
		);
		await env.PEP_CACHE.put(
			generateCacheKey("adverse_media", query, "person"),
			JSON.stringify({
				risk_level: "high",
				findings: { es: "riesgo", en: "risk" },
				sources: ["https://example.com/risk"],
			}),
		);

		const amlCallback = vi.fn(async () => undefined);
		const pending: Promise<unknown>[] = [];
		const result = await performSearch({
			env: mergeTestBindingsWithGlobalCacheFlag(
				env as unknown as Bindings,
				true,
				{
					AML_SERVICE: {
						processScreeningCallback: amlCallback,
					} as unknown as Bindings["AML_SERVICE"],
					PEP_SEARCH_ENABLED: "true",
					PEP_GROK_ENABLED: "true",
					ADVERSE_MEDIA_ENABLED: "true",
				} as unknown as Partial<Bindings>,
			),
			executionCtx: {
				waitUntil(p: Promise<unknown>) {
					pending.push(p);
				},
			} as unknown as ExecutionContext,
			organizationId: "org-async-cache",
			userId: "user-adapter",
			source: QUERY_SOURCE.AML,
			query,
			entityType: "person",
			birthDate: "1980-01-01",
			countries: ["MX"],
			topK: 10,
			threshold: 0.875,
			environment: "production",
			adapters: {
				embeddings: { embed: async () => [0.01, 0.02] },
				vectorIndex: { query: async () => ({ matches: [] }) },
			},
		});

		await Promise.all(pending);

		expect(result.pepSearch?.status).toBe("completed");
		expect(result.pepAiSearch?.status).toBe("completed");
		expect(result.adverseMediaSearch?.status).toBe("completed");
		expect(amlCallback).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "pep_ai",
				status: "completed",
				matched: true,
			}),
		);
		expect(amlCallback).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "adverse_media",
				status: "completed",
				matched: true,
			}),
		);
	});

	it("uses Grok THREAD_SVC branches for PEP AI and adverse media", async () => {
		const createThread = vi.fn(async () => ({ id: "thread-ok" }));
		const result = await performSearch({
			env: mergeTestBindingsWithGlobalCacheFlag(
				env as unknown as Bindings,
				false,
				{
					RESEARCH_PROVIDER: "grok",
					THREAD_SVC: {
						createThread,
					} as unknown as Bindings["THREAD_SVC"],
					PEP_SEARCH_ENABLED: "false",
					PEP_GROK_ENABLED: "true",
					ADVERSE_MEDIA_ENABLED: "true",
				} as unknown as Partial<Bindings>,
			),
			executionCtx: { waitUntil: vi.fn() } as unknown as ExecutionContext,
			organizationId: "org-grok-thread",
			userId: "user-adapter",
			source: QUERY_SOURCE.WATCHLIST_QUERY,
			query: `Adapter Grok ${crypto.randomUUID()}`,
			entityType: "person",
			topK: 10,
			threshold: 0.875,
			environment: "production",
			adapters: {
				embeddings: { embed: async () => [0.01, 0.02] },
				vectorIndex: { query: async () => ({ matches: [] }) },
			},
		});

		expect(result.pepAiSearch?.status).toBe("pending");
		expect(result.adverseMediaSearch?.status).toBe("pending");
		expect(createThread).toHaveBeenCalledTimes(2);
	});

	it("marks Grok THREAD_SVC failures without failing the whole search", async () => {
		const createThread = vi.fn(async () => {
			throw new Error("thread down");
		});
		const result = await performSearch({
			env: mergeTestBindingsWithGlobalCacheFlag(
				env as unknown as Bindings,
				false,
				{
					RESEARCH_PROVIDER: "grok",
					THREAD_SVC: {
						createThread,
					} as unknown as Bindings["THREAD_SVC"],
					PEP_SEARCH_ENABLED: "false",
					PEP_GROK_ENABLED: "true",
					ADVERSE_MEDIA_ENABLED: "true",
				} as unknown as Partial<Bindings>,
			),
			executionCtx: { waitUntil: vi.fn() } as unknown as ExecutionContext,
			organizationId: "org-grok-thread-fail",
			userId: "user-adapter",
			source: QUERY_SOURCE.WATCHLIST_QUERY,
			query: `Adapter Grok Failure ${crypto.randomUUID()}`,
			entityType: "person",
			topK: 10,
			threshold: 0.875,
			environment: "production",
			adapters: {
				embeddings: { embed: async () => [0.01, 0.02] },
				vectorIndex: { query: async () => ({ matches: [] }) },
			},
		});

		expect(result.pepAiSearch?.status).toBe("failed");
		expect(result.adverseMediaSearch?.status).toBe("failed");
	});

	it("skips PEP AI for non-person entity types", async () => {
		const result = await performSearch({
			env: mergeTestBindingsWithGlobalCacheFlag(
				env as unknown as Bindings,
				false,
				{
					PEP_SEARCH_ENABLED: "false",
					PEP_GROK_ENABLED: "true",
					ADVERSE_MEDIA_ENABLED: "false",
				} as unknown as Partial<Bindings>,
			),
			executionCtx: { waitUntil: vi.fn() } as unknown as ExecutionContext,
			organizationId: "org-non-person",
			userId: "user-adapter",
			source: QUERY_SOURCE.WATCHLIST_QUERY,
			query: `Adapter Organization ${crypto.randomUUID()}`,
			entityType: "organization",
			topK: 10,
			threshold: 0.875,
			environment: "production",
			adapters: {
				embeddings: { embed: async () => [0.01, 0.02] },
				vectorIndex: { query: async () => ({ matches: [] }) },
			},
		});

		expect(result.pepAiSearch?.status).toBe("skipped");
	});
});
