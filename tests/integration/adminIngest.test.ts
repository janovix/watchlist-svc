import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";

/**
 * Admin Ingestion API Tests
 *
 * These tests run in the test environment where ENVIRONMENT=test.
 * The authMiddleware automatically sets a mock user with admin role
 * when ENVIRONMENT=test, so authentication is bypassed in tests.
 *
 * Note: Queue mocking in Cloudflare Workers test environment is limited.
 * Tests focus on validation and endpoint behavior rather than queue interactions.
 */
describe("Admin Ingestion API Tests", () => {
	beforeEach(async () => {
		const prisma = createPrismaClient(env.DB);
		await prisma.watchlistIngestionRun.deleteMany({});
		await prisma.watchlistTarget.deleteMany({});
		await prisma.watchlistVectorState.deleteMany({});
	});

	describe("POST /admin/ingest", () => {
		it("should validate request body schema - missing csvUrl", async () => {
			const response = await SELF.fetch("http://local.test/admin/ingest", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					// Missing required csvUrl
					reindexAll: true,
				}),
			});

			// Should return 400 for invalid request body
			expect(response.status).toBe(400);
		});

		it("should validate csvUrl is a valid URL", async () => {
			const response = await SELF.fetch("http://local.test/admin/ingest", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					csvUrl: "not-a-valid-url",
				}),
			});

			// Should return 400 for invalid URL
			expect(response.status).toBe(400);
		});

		it("should accept valid csvUrl format", async () => {
			// This test verifies the endpoint accepts valid input
			// It may return 500 if queue is not configured, but validates input first
			const response = await SELF.fetch("http://local.test/admin/ingest", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					csvUrl: "https://example.com/test.csv",
					reindexAll: false,
				}),
			});

			// Either 200 (success) or 500 (queue not configured) - not 400 (validation error)
			expect([200, 500]).toContain(response.status);
		});

		it("should accept reindexAll boolean parameter", async () => {
			const response = await SELF.fetch("http://local.test/admin/ingest", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					csvUrl: "https://example.com/test-reindex.csv",
					reindexAll: true,
				}),
			});

			// Either 200 (success) or 500 (queue not configured) - not 400 (validation error)
			expect([200, 500]).toContain(response.status);
		});
	});

	describe("POST /admin/ingest/sdn-xml", () => {
		it("should validate request body schema - missing r2Key", async () => {
			const response = await SELF.fetch(
				"http://local.test/admin/ingest/sdn-xml",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						// Missing required r2Key
						reindexAll: false,
					}),
				},
			);

			// Should return 400 for invalid request body
			expect(response.status).toBe(400);
		});

		it("should validate r2Key is not empty", async () => {
			const response = await SELF.fetch(
				"http://local.test/admin/ingest/sdn-xml",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						r2Key: "",
					}),
				},
			);

			// Should return 400 for empty r2Key
			expect(response.status).toBe(400);
		});
	});

	describe("POST /admin/reindex", () => {
		it("should return target count with valid request", async () => {
			// Create some test targets
			const prisma = createPrismaClient(env.DB);
			await prisma.watchlistTarget.createMany({
				data: [
					{
						id: "target-1",
						dataset: "test",
						firstSeen: "2025-01-01T00:00:00Z",
						lastSeen: "2025-01-01T00:00:00Z",
						lastChange: "2025-01-01T00:00:00Z",
					},
					{
						id: "target-2",
						dataset: "test",
						firstSeen: "2025-01-01T00:00:00Z",
						lastSeen: "2025-01-01T00:00:00Z",
						lastChange: "2025-01-01T00:00:00Z",
					},
				],
			});

			const response = await SELF.fetch("http://local.test/admin/reindex", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					batchSize: 50,
				}),
			});

			expect(response.status).toBe(200);
			const body = await response.json<{
				success: boolean;
				result: { message: string; targetCount: number };
			}>();
			expect(body.success).toBe(true);
			expect(body.result.targetCount).toBe(2);
			expect(body.result.message).toBe("Reindexing started");
		});

		it("should use default batchSize when not provided", async () => {
			const response = await SELF.fetch("http://local.test/admin/reindex", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({}),
			});

			expect(response.status).toBe(200);
			const body = await response.json<{
				success: boolean;
				result: { message: string; targetCount: number };
			}>();
			expect(body.success).toBe(true);
		});

		it("should validate batchSize is within range", async () => {
			const response = await SELF.fetch("http://local.test/admin/reindex", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					batchSize: 1000, // Exceeds max of 100
				}),
			});

			// Should return 400 for invalid batchSize
			expect(response.status).toBe(400);
		});
	});
});
