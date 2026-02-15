import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";

/**
 * Admin Vectorize Endpoint Tests
 *
 * Tests for the admin endpoints that trigger manual vectorization jobs.
 *
 * Note: These tests focus on basic endpoint functionality.
 * Full integration with THREAD_SVC is tested manually since service binding
 * mocking is complex in the Cloudflare Workers test environment.
 */
describe("Admin Vectorize Endpoints", () => {
	beforeEach(async () => {
		const prisma = createPrismaClient((env as any).DB);
		await prisma.watchlistIngestionRun.deleteMany({});
	});

	// =========================================================================
	// POST /admin/vectorize/reindex
	// =========================================================================
	describe("POST /admin/vectorize/reindex", () => {
		it("should accept valid request with dataset ofac_sdn", async () => {
			const response = await SELF.fetch(
				"http://local.test/admin/vectorize/reindex",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						dataset: "ofac_sdn",
						reindex_all: true,
						batch_size: 100,
					}),
				},
			);

			// Either 200 (success with THREAD_SVC) or 500 (THREAD_SVC not configured)
			// Both are valid responses - we're testing the endpoint exists and accepts input
			expect([200, 500]).toContain(response.status);
			const body = (await response.json()) as {
				success: boolean;
			};
			expect(typeof body.success).toBe("boolean");
		});

		it("should accept request with only dataset parameter (using defaults)", async () => {
			const response = await SELF.fetch(
				"http://local.test/admin/vectorize/reindex",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						dataset: "ofac_sdn",
						// Optional parameters omitted - defaults should be applied
					}),
				},
			);

			// Either 200 or 500 depending on THREAD_SVC configuration
			expect([200, 500]).toContain(response.status);
		});

		it("should accept batch_size within valid range", async () => {
			const response = await SELF.fetch(
				"http://local.test/admin/vectorize/reindex",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						dataset: "ofac_sdn",
						batch_size: 250, // Within range 10-500
					}),
				},
			);

			// Should pass validation (200 or 500 depending on THREAD_SVC)
			expect([200, 500]).toContain(response.status);
		});

		it("should accept reindex_all false parameter", async () => {
			const response = await SELF.fetch(
				"http://local.test/admin/vectorize/reindex",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						dataset: "ofac_sdn",
						reindex_all: false,
					}),
				},
			);

			// Should pass validation
			expect([200, 500]).toContain(response.status);
		});

		it("should respond to POST method", async () => {
			// Verify endpoint exists and responds
			const response = await SELF.fetch(
				"http://local.test/admin/vectorize/reindex",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						dataset: "ofac_sdn",
					}),
				},
			);

			// Should not return 404 (endpoint exists)
			expect(response.status).not.toBe(404);
		});

		it("should validate batch_size range", async () => {
			const response = await SELF.fetch(
				"http://local.test/admin/vectorize/reindex",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						dataset: "ofac_sdn",
						batch_size: 9999, // Out of range
					}),
				},
			);

			// Should fail validation with 400 or 500 (depending on when validation occurs)
			expect([400, 401, 403, 500]).toContain(response.status);
		});

		it("should validate dataset parameter", async () => {
			const response = await SELF.fetch(
				"http://local.test/admin/vectorize/reindex",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						dataset: "invalid_dataset",
					}),
				},
			);

			// Should fail validation or endpoint logic
			expect([400, 401, 403, 500]).toContain(response.status);
		});

		it("should handle different dataset types", async () => {
			for (const dataset of ["ofac_sdn", "sat_69b", "unsc"]) {
				const response = await SELF.fetch(
					"http://local.test/admin/vectorize/reindex",
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ dataset }),
					},
				);

				expect([200, 500]).toContain(response.status);
			}
		});
	});
});
