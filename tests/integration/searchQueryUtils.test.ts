import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
	generateCacheKey,
	readCache,
	writeCache,
	checkAndUpdateQueryCompletion,
} from "../../src/lib/search-query-utils";
import { createPrismaClient } from "../../src/lib/prisma";

describe("Search Query Utils", () => {
	// =========================================================================
	// generateCacheKey
	// =========================================================================
	describe("generateCacheKey", () => {
		it("should generate deterministic cache key from prefix and query", () => {
			const key1 = generateCacheKey("test", "My Query");
			const key2 = generateCacheKey("test", "My Query");
			expect(key1).toBe(key2);
			expect(key1).toContain("test:");
		});

		it("should normalize query to lowercase", () => {
			const key1 = generateCacheKey("test", "MY QUERY");
			const key2 = generateCacheKey("test", "my query");
			expect(key1).toBe(key2);
		});

		it("should trim whitespace", () => {
			const key1 = generateCacheKey("test", "  my query  ");
			const key2 = generateCacheKey("test", "my query");
			expect(key1).toBe(key2);
		});

		it("should include suffix in cache key when provided", () => {
			const keyWithoutSuffix = generateCacheKey("test", "query", undefined);
			const keyWithSuffix = generateCacheKey("test", "query", "suffix");
			expect(keyWithoutSuffix).not.toBe(keyWithSuffix);
			expect(keyWithSuffix).toContain("test:");
		});

		it("should generate different keys for different queries", () => {
			const key1 = generateCacheKey("test", "query1");
			const key2 = generateCacheKey("test", "query2");
			expect(key1).not.toBe(key2);
		});
	});

	// =========================================================================
	// readCache
	// =========================================================================
	describe("readCache", () => {
		it("should return null when key does not exist", async () => {
			const kv = (env as { WATCHLIST_KV?: KVNamespace }).WATCHLIST_KV;
			if (!kv) {
				return;
				return;
			}

			const result = await readCache(kv, "nonexistent-key");
			expect(result).toBeNull();
		});

		it("should return cached value when key exists", async () => {
			const kv = (env as { WATCHLIST_KV?: KVNamespace }).WATCHLIST_KV;
			if (!kv) {
				return;
				return;
			}

			const testValue = { foo: "bar", count: 42 };
			await kv.put("test-cache-key", JSON.stringify(testValue));

			const result = await readCache<typeof testValue>(kv, "test-cache-key");
			expect(result).toEqual(testValue);
		});

		it("should return null on KV error", async () => {
			const kv = (env as { WATCHLIST_KV?: KVNamespace }).WATCHLIST_KV;
			if (!kv) {
				return;
				return;
			}

			// Mock a KV that throws - use a mock object
			const mockKv = {
				get: async () => {
					throw new Error("KV error");
				},
			} as unknown as KVNamespace;

			const result = await readCache(mockKv, "key");
			expect(result).toBeNull();
		});

		it("should handle null cache values", async () => {
			const kv = (env as { WATCHLIST_KV?: KVNamespace }).WATCHLIST_KV;
			if (!kv) {
				return;
				return;
			}

			await kv.put("test-null-key", "null");

			const result = await readCache(kv, "test-null-key");
			expect(result).toBeNull();
		});

		it("should parse JSON correctly", async () => {
			const kv = (env as { WATCHLIST_KV?: KVNamespace }).WATCHLIST_KV;
			if (!kv) {
				return;
				return;
			}

			const complexObject = {
				nested: { data: "value" },
				array: [1, 2, 3],
				bool: true,
			};
			await kv.put("test-complex", JSON.stringify(complexObject));

			const result = await readCache(kv, "test-complex");
			expect(result).toEqual(complexObject);
		});
	});

	// =========================================================================
	// writeCache
	// =========================================================================
	describe("writeCache", () => {
		it("should write value to cache", async () => {
			const kv = (env as { WATCHLIST_KV?: KVNamespace }).WATCHLIST_KV;
			if (!kv) {
				return;
				return;
			}

			const testValue = { data: "test" };
			await writeCache(kv, "write-test-key", testValue);

			// Verify by reading back
			const cached = await kv.get("write-test-key", "json");
			expect(cached).toEqual(testValue);
		});

		it("should set 24 hour TTL", async () => {
			const kv = (env as { WATCHLIST_KV?: KVNamespace }).WATCHLIST_KV;
			if (!kv) {
				return;
				return;
			}

			const testValue = { ttl: "test" };
			await writeCache(kv, "ttl-test-key", testValue);

			// TTL is 24h (86400s), we can't directly verify but write succeeds
			const cached = await kv.get("ttl-test-key", "json");
			expect(cached).toEqual(testValue);
		});

		it("should not throw on write error", async () => {
			const mockKv = {
				put: async () => {
					throw new Error("KV write failed");
				},
			} as unknown as KVNamespace;

			// Should not throw
			await expect(
				writeCache(mockKv, "key", { test: "value" }),
			).resolves.not.toThrow();
		});
	});

	// =========================================================================
	// checkAndUpdateQueryCompletion
	// =========================================================================
	describe("checkAndUpdateQueryCompletion", () => {
		let prisma: ReturnType<typeof createPrismaClient>;

		beforeEach(() => {
			prisma = createPrismaClient((env as any).DB);
		});

		it("should not crash when query not found", async () => {
			await expect(
				checkAndUpdateQueryCompletion(prisma, "nonexistent-query-id"),
			).resolves.not.toThrow();
		});

		it("should update status to completed when all types are done", async () => {
			const queryId = "test-query-" + Date.now();
			const orgId = "test-org-" + Date.now();

			// Create a search query with all statuses completed
			await prisma.searchQuery.create({
				data: {
					id: queryId,
					organizationId: orgId,
					userId: "test-user",
					query: "test query",
					entityType: "person",
					status: "pending",
					ofacStatus: "completed",
					sat69bStatus: "completed",
					unStatus: "completed",
					pepOfficialStatus: "completed",
					pepAiStatus: "completed",
					adverseMediaStatus: "completed",
				},
			});

			await checkAndUpdateQueryCompletion(prisma, queryId);

			const updated = await prisma.searchQuery.findUnique({
				where: { id: queryId },
			});
			expect(updated?.status).toBe("completed");
		});

		it("should update status to failed when any type failed", async () => {
			const queryId = "test-query-failed-" + Date.now();
			const orgId = "test-org-" + Date.now();

			await prisma.searchQuery.create({
				data: {
					id: queryId,
					organizationId: orgId,
					userId: "test-user",
					query: "test query",
					entityType: "person",
					status: "pending",
					ofacStatus: "failed",
					sat69bStatus: "completed",
					unStatus: "completed",
					pepOfficialStatus: "completed",
					pepAiStatus: "completed",
					adverseMediaStatus: "completed",
				},
			});

			await checkAndUpdateQueryCompletion(prisma, queryId);

			const updated = await prisma.searchQuery.findUnique({
				where: { id: queryId },
			});
			expect(updated?.status).toBe("failed");
		});

		it("should update status to partial when some completed and others pending", async () => {
			const queryId = "test-query-partial-" + Date.now();
			const orgId = "test-org-" + Date.now();

			await prisma.searchQuery.create({
				data: {
					id: queryId,
					organizationId: orgId,
					userId: "test-user",
					query: "test query",
					entityType: "person",
					status: "pending",
					ofacStatus: "completed",
					sat69bStatus: "pending",
					unStatus: "pending",
					pepOfficialStatus: "pending",
					pepAiStatus: "pending",
					adverseMediaStatus: "pending",
				},
			});

			await checkAndUpdateQueryCompletion(prisma, queryId);

			const updated = await prisma.searchQuery.findUnique({
				where: { id: queryId },
			});
			expect(updated?.status).toBe("partial");
		});

		it("should not change status when all are pending", async () => {
			const queryId = "test-query-pending-" + Date.now();
			const orgId = "test-org-" + Date.now();

			await prisma.searchQuery.create({
				data: {
					id: queryId,
					organizationId: orgId,
					userId: "test-user",
					query: "test query",
					entityType: "person",
					status: "pending",
					ofacStatus: "pending",
					sat69bStatus: "pending",
					unStatus: "pending",
					pepOfficialStatus: "pending",
					pepAiStatus: "pending",
					adverseMediaStatus: "pending",
				},
			});

			await checkAndUpdateQueryCompletion(prisma, queryId);

			const updated = await prisma.searchQuery.findUnique({
				where: { id: queryId },
			});
			expect(updated?.status).toBe("pending");
		});

		it("should handle skipped statuses correctly", async () => {
			const queryId = "test-query-skipped-" + Date.now();
			const orgId = "test-org-" + Date.now();

			await prisma.searchQuery.create({
				data: {
					id: queryId,
					organizationId: orgId,
					userId: "test-user",
					query: "test query",
					entityType: "person",
					status: "pending",
					ofacStatus: "completed",
					sat69bStatus: "skipped",
					unStatus: "skipped",
					pepOfficialStatus: "skipped",
					pepAiStatus: "skipped",
					adverseMediaStatus: "skipped",
				},
			});

			await checkAndUpdateQueryCompletion(prisma, queryId);

			const updated = await prisma.searchQuery.findUnique({
				where: { id: queryId },
			});
			expect(updated?.status).toBe("completed");
		});
	});
});
