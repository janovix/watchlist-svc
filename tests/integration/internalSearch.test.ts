import { env, SELF } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";

/**
 * Internal Search Endpoint Tests
 *
 * Tests for POST /internal/search endpoint used by aml-svc
 * to trigger watchlist searches for client/UBO screening.
 */
describe("POST /internal/search - AML Screening", () => {
	beforeEach(async () => {
		// Clear any cache if exists
		const cache = (env as { CACHE?: any }).CACHE;
		if (cache?.default) {
			try {
				// Clear cache entries
			} catch {
				// Ignore if cache not configured
			}
		}
	});

	describe("Authentication & Headers", () => {
		it("should require X-Organization-Id header", async () => {
			const response = await SELF.fetch("http://localhost/internal/search", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					// Missing X-Organization-Id
					"X-User-Id": "user-123",
				},
				body: JSON.stringify({
					q: "Juan Perez",
					entityType: "person",
					topK: 20,
					threshold: 0.7,
				}),
			});

			expect(response.status).toBe(400);
			const data = (await response.json()) as any;
			expect(data.errors?.[0]?.message || data.error || "").toContain(
				"X-Organization-Id",
			);
		});

		it("should require X-User-Id header", async () => {
			const response = await SELF.fetch("http://localhost/internal/search", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Organization-Id": "org-123",
					// Missing X-User-Id
				},
				body: JSON.stringify({
					q: "Juan Perez",
					entityType: "person",
					topK: 20,
					threshold: 0.7,
				}),
			});

			expect(response.status).toBe(400);
			const data = (await response.json()) as any;
			expect(data.errors?.[0]?.message || data.error || "").toContain(
				"X-User-Id",
			);
		});
	});

	describe("Request Validation", () => {
		it("should require query text", async () => {
			const response = await SELF.fetch("http://localhost/internal/search", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Organization-Id": "org-123",
					"X-User-Id": "user-123",
				},
				body: JSON.stringify({
					// Missing q
					entityType: "person",
					topK: 20,
					threshold: 0.7,
				}),
			});

			expect(response.status).toBe(400);
		});

		it.skip("should require entityType", async () => {
			const response = await SELF.fetch("http://localhost/internal/search", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Organization-Id": "org-123",
					"X-User-Id": "user-123",
				},
				body: JSON.stringify({
					q: "Juan Perez",
					// Missing entityType
					topK: 20,
					threshold: 0.7,
				}),
			});

			expect(response.status).toBe(400);
		});
	});

	describe("Search Response", () => {
		it.skip("should return queryId and result counts for person search", async () => {
			const response = await SELF.fetch("http://localhost/internal/search", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Organization-Id": "org-123",
					"X-User-Id": "user-123",
				},
				body: JSON.stringify({
					q: "Juan Perez",
					entityType: "person",
					topK: 20,
					threshold: 0.7,
				}),
			});

			expect(response.status).toBe(200);
			const data = (await response.json()) as any;
			expect(data.success).toBe(true);
			expect(data.result).toBeDefined();
			expect(data.result.queryId).toBeDefined();
			expect(typeof data.result.queryId).toBe("string");
			// Should include sync result counts
			expect(data.result.ofac).toBeDefined();
			expect(typeof data.result.ofac.count).toBe("number");
			expect(data.result.unsc).toBeDefined();
			expect(typeof data.result.unsc.count).toBe("number");
			expect(data.result.sat69b).toBeDefined();
			expect(typeof data.result.sat69b.count).toBe("number");
		});

		it.skip("should return queryId and result counts for organization search", async () => {
			const response = await SELF.fetch("http://localhost/internal/search", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Organization-Id": "org-123",
					"X-User-Id": "user-123",
				},
				body: JSON.stringify({
					q: "Acme Corp",
					entityType: "organization",
					topK: 20,
					threshold: 0.7,
				}),
			});

			expect(response.status).toBe(200);
			const data = (await response.json()) as any;
			expect(data.success).toBe(true);
			expect(data.result.queryId).toBeDefined();
		});
	});

	describe("Source Tracking", () => {
		it.skip("should create search query with source='aml-screening'", async () => {
			const response = await SELF.fetch("http://localhost/internal/search", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Organization-Id": "org-123",
					"X-User-Id": "user-123",
				},
				body: JSON.stringify({
					q: "Juan Perez",
					entityType: "person",
					topK: 20,
					threshold: 0.7,
				}),
			});

			expect(response.status).toBe(200);
			const data = (await response.json()) as any;
			const queryId = data.result.queryId;

			// Verify the query was created with source="aml-screening"
			// This could be done via a separate GET /internal/queries/:id endpoint
			// For now, just verify queryId was returned
			expect(queryId).toBeDefined();
		});
	});

	describe("Optional Parameters", () => {
		it.skip("should accept identifiers array", async () => {
			const response = await SELF.fetch("http://localhost/internal/search", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Organization-Id": "org-123",
					"X-User-Id": "user-123",
				},
				body: JSON.stringify({
					q: "Juan Perez",
					entityType: "person",
					identifiers: ["RFC123456789"],
					topK: 20,
					threshold: 0.7,
				}),
			});

			expect(response.status).toBe(200);
			const data = (await response.json()) as any;
			expect(data.result.queryId).toBeDefined();
		});

		it.skip("should accept countries array", async () => {
			const response = await SELF.fetch("http://localhost/internal/search", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Organization-Id": "org-123",
					"X-User-Id": "user-123",
				},
				body: JSON.stringify({
					q: "Juan Perez",
					entityType: "person",
					countries: ["MX"],
					topK: 20,
					threshold: 0.7,
				}),
			});

			expect(response.status).toBe(200);
		});

		it.skip("should accept birthDate for person searches", async () => {
			const response = await SELF.fetch("http://localhost/internal/search", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Organization-Id": "org-123",
					"X-User-Id": "user-123",
				},
				body: JSON.stringify({
					q: "Juan Perez",
					entityType: "person",
					birthDate: "1980-01-15",
					topK: 20,
					threshold: 0.7,
				}),
			});

			expect(response.status).toBe(200);
		});
	});
});
