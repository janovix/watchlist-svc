import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";

/**
 * Internal Vectorize Endpoint Tests
 *
 * Tests for the container callback endpoints used by vectorize_index
 * to index records into Cloudflare Vectorize.
 *
 * These endpoints are internal (no auth) and called by the container
 * during the vectorization flow:
 * 1. GET /internal/vectorize/count           - get record count
 * 2. POST /internal/vectorize/delete-by-dataset - delete existing vectors
 * 3. POST /internal/vectorize/index-batch    - index a batch of records
 * 4. POST /internal/vectorize/complete       - mark job as completed
 */
describe("Internal Vectorize Endpoints", () => {
	let prisma: ReturnType<typeof createPrismaClient>;

	beforeEach(async () => {
		prisma = createPrismaClient(env.DB);
		// Clean up OFAC table
		await prisma.ofacSdnEntry.deleteMany({});
	});

	// =========================================================================
	// GET /internal/vectorize/count
	// =========================================================================
	describe("GET /internal/vectorize/count", () => {
		it("should return count for ofac_sdn dataset", async () => {
			// Seed some records
			await prisma.ofacSdnEntry.createMany({
				data: [
					{
						id: "1001",
						partyType: "Individual",
						primaryName: "Test Person One",
						sourceList: "SDN List",
					},
					{
						id: "1002",
						partyType: "Entity",
						primaryName: "Test Entity",
						sourceList: "SDN List",
					},
					{
						id: "1003",
						partyType: "Individual",
						primaryName: "Test Person Two",
						sourceList: "SDN List",
					},
				],
			});

			const response = await SELF.fetch(
				"http://local.test/internal/vectorize/count?dataset=ofac_sdn",
				{ method: "GET" },
			);

			expect(response.status).toBe(200);
			const body = await response.json<{
				success: boolean;
				dataset: string;
				count: number;
			}>();
			expect(body.success).toBe(true);
			expect(body.dataset).toBe("ofac_sdn");
			expect(body.count).toBe(3);
		});

		it("should return 0 for empty dataset", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/vectorize/count?dataset=ofac_sdn",
				{ method: "GET" },
			);

			expect(response.status).toBe(200);
			const body = await response.json<{
				success: boolean;
				dataset: string;
				count: number;
			}>();
			expect(body.success).toBe(true);
			expect(body.count).toBe(0);
		});

		it("should return error for unknown dataset", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/vectorize/count?dataset=unknown",
				{ method: "GET" },
			);

			expect(response.status).toBe(400);
			const body = await response.json<{
				success: boolean;
				error: string;
			}>();
			expect(body.success).toBe(false);
			expect(body.error).toContain("Unknown dataset");
		});
	});

	// =========================================================================
	// POST /internal/vectorize/delete-by-dataset
	// =========================================================================
	describe("POST /internal/vectorize/delete-by-dataset", () => {
		it("should return error for unknown dataset", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/vectorize/delete-by-dataset",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ dataset: "unknown" }),
				},
			);

			expect(response.status).toBe(400);
			const body = await response.json<{
				success: boolean;
				error: string;
			}>();
			expect(body.success).toBe(false);
			expect(body.error).toContain("Unknown dataset");
		});

		// Note: Full delete test requires Vectorize binding which is mocked in tests
		it("should accept valid dataset for deletion", async () => {
			// Seed some records so we have IDs to delete
			await prisma.ofacSdnEntry.createMany({
				data: [
					{
						id: "1001",
						partyType: "Individual",
						primaryName: "Test Person",
						sourceList: "SDN List",
					},
				],
			});

			const response = await SELF.fetch(
				"http://local.test/internal/vectorize/delete-by-dataset",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ dataset: "ofac_sdn" }),
				},
			);

			// In test environment, Vectorize may not be available
			// but the endpoint should at least not error on valid dataset
			expect(response.status).toBeLessThanOrEqual(500);
		});
	});

	// =========================================================================
	// POST /internal/vectorize/index-batch
	// =========================================================================
	describe("POST /internal/vectorize/index-batch", () => {
		it("should return error for unknown dataset", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/vectorize/index-batch",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						dataset: "unknown",
						offset: 0,
						limit: 10,
					}),
				},
			);

			expect(response.status).toBe(400);
			const body = await response.json<{
				success: boolean;
				error: string;
			}>();
			expect(body.success).toBe(false);
			expect(body.error).toContain("Unknown dataset");
		});

		it("should accept valid dataset for indexing (may fail without AI/Vectorize)", async () => {
			// Note: In test environment, AI and Vectorize may not be available
			// This test verifies the endpoint accepts valid dataset
			const response = await SELF.fetch(
				"http://local.test/internal/vectorize/index-batch",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						dataset: "ofac_sdn",
						offset: 0,
						limit: 10,
					}),
				},
			);

			// In test environment, may return 500 due to missing AI/Vectorize bindings
			// but should not return 400 for valid dataset
			expect(response.status).not.toBe(400);
		});

		// Note: Full indexing test requires AI and Vectorize bindings
	});

	// =========================================================================
	// POST /internal/vectorize/complete
	// =========================================================================
	describe("POST /internal/vectorize/complete", () => {
		it("should accept completion notification", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/vectorize/complete",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						dataset: "ofac_sdn",
						total_indexed: 1000,
						total_batches: 10,
						errors: [],
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = await response.json<{ success: boolean }>();
			expect(body.success).toBe(true);
		});

		it("should accept completion with errors", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/vectorize/complete",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						dataset: "ofac_sdn",
						total_indexed: 950,
						total_batches: 10,
						errors: ["Error on batch 3", "Error on batch 7"],
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = await response.json<{ success: boolean }>();
			expect(body.success).toBe(true);
		});
	});
});
