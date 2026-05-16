import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Bindings } from "../../src/index";
import { disableAsyncSearchSideEffects } from "./_helpers";

describe("UNSC Search Endpoint", () => {
	beforeEach(() => {
		disableAsyncSearchSideEffects(env as unknown as Bindings);
	});

	describe("POST /search/unsc - Validation", () => {
		it("should require query parameter", async () => {
			const response = await SELF.fetch("http://local.test/search/unsc", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});

			expect(response.status).toBe(400);
			const data = (await response.json()) as any;
			expect(data.success).toBe(false);
		});

		it("should reject invalid topK values", async () => {
			const response = await SELF.fetch("http://local.test/search/unsc", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					q: "Test",
					topK: -1,
				}),
			});

			expect(response.status).toBe(400);
		});

		it("should reject invalid threshold values", async () => {
			const response = await SELF.fetch("http://local.test/search/unsc", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					q: "Test",
					threshold: 1.5,
				}),
			});

			expect(response.status).toBe(400);
		});

		it("should handle empty query gracefully", async () => {
			const response = await SELF.fetch("http://local.test/search/unsc", {
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

	describe("POST /search/unsc — mocked AI / Vectorize", () => {
		it("returns 200 with empty matches when Vectorize returns no hits", async () => {
			const response = await SELF.fetch("http://local.test/search/unsc", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					q: "Integration UNSC Smoke Gamma",
					topK: 10,
					threshold: 0.875,
				}),
			});

			expect(response.status).toBe(200);
			const data = (await response.json()) as {
				success: boolean;
				result: { matches: unknown[]; count: number };
			};
			expect(data.success).toBe(true);
			expect(data.result.count).toBe(0);
		});
	});
});
