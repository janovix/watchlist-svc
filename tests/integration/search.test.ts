import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Bindings } from "../../src/index";
import { disableAsyncSearchSideEffects } from "./_helpers";

describe("Search API Tests", () => {
	beforeEach(() => {
		disableAsyncSearchSideEffects(env as unknown as Bindings);
	});

	describe("POST /search - Validation", () => {
		it("should return error when query is missing", async () => {
			const response = await SELF.fetch("http://local.test/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					// Missing 'q' field
				}),
			});

			expect(response.status).toBe(400);
		});

		it("should reject invalid topK values", async () => {
			const response = await SELF.fetch("http://local.test/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					q: "test",
					topK: -1,
				}),
			});

			expect(response.status).toBe(400);
		});

		it("should reject invalid threshold values", async () => {
			const response = await SELF.fetch("http://local.test/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					q: "test",
					threshold: 2.0,
				}),
			});

			expect(response.status).toBe(400);
		});

		it("should reject invalid dataset values", async () => {
			const response = await SELF.fetch("http://local.test/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					q: "test",
					dataset: "invalid_dataset",
				}),
			});

			expect(response.status).toBe(400);
		});

		it("should handle empty query gracefully", async () => {
			const response = await SELF.fetch("http://local.test/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					q: "",
				}),
			});

			expect(response.status).toBe(400);
		});

		// Note: GET method test removed because it causes hangs in the test environment
		// due to how Chanfana/Hono handles unregistered routes with authMiddleware.
	});

	describe("POST /search — mocked AI / Vectorize (apply-migrations)", () => {
		it("returns 200 with empty dataset buckets for a valid query", async () => {
			const response = await SELF.fetch("http://local.test/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					q: "Integration Search Smoke Alpha",
					entityType: "person",
					topK: 5,
					threshold: 0.875,
				}),
			});

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				success: boolean;
				result: {
					queryId: string;
					ofac: { count: number };
					unsc: { count: number };
					sat69b: { count: number };
				};
			};
			expect(data.success).toBe(true);
			expect(typeof data.result.queryId).toBe("string");
			expect(data.result.ofac.count).toBe(0);
			expect(data.result.unsc.count).toBe(0);
			expect(data.result.sat69b.count).toBe(0);
		});
	});
});
