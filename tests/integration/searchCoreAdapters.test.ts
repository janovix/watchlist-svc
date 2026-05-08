import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/index";
import { createPrismaClient } from "../../src/lib/prisma";
import { performSearch } from "../../src/lib/search-core";
import { QUERY_SOURCE } from "../../src/lib/query-source";
import { WATCHLIST_EMBEDDING_MODEL } from "../../src/lib/embedding-config";
import { normalizeIdentifier } from "../../src/lib/matching-utils";
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
		await prisma.watchlistIdentifier.deleteMany({
			where: { recordId: { startsWith: "adapter-seed-" } },
		});
		await prisma.ofacSdnEntry.deleteMany({
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
});
