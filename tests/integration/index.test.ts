import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";

describe("Index Routes", () => {
	beforeEach(() => {
		// Reset TRUSTED_ORIGINS if it was set
		delete (env as { TRUSTED_ORIGINS?: string }).TRUSTED_ORIGINS;
	});

	describe("GET /", () => {
		it("should return app metadata", async () => {
			const response = await SELF.fetch("http://local.test/");
			const body = await response.json<{ name: string; version: string }>();

			expect(response.status).toBe(200);
			expect(body.name).toBe("watchlist-svc");
			expect(body.version).toBeDefined();
		});

		it("should throw error when x-force-error header is set", async () => {
			const response = await SELF.fetch("http://local.test/", {
				headers: { "x-force-error": "1" },
			});

			expect(response.status).toBe(500);
		});
	});

	describe("CORS Configuration", () => {
		it("should deny CORS when TRUSTED_ORIGINS is not set (security-first)", async () => {
			// TRUSTED_ORIGINS is not set in test env by default
			const response = await SELF.fetch("http://local.test/", {
				method: "OPTIONS",
				headers: {
					Origin: "https://example.com",
					"Access-Control-Request-Method": "GET",
				},
			});

			// CORS middleware denies requests when no trusted origins are configured
			// This is a security-first approach
			expect([200, 204]).toContain(response.status);
			const origin = response.headers.get("Access-Control-Allow-Origin");
			// When TRUSTED_ORIGINS is not set, CORS is denied (no origin header)
			expect(origin).toBeNull();
		});

		// Note: CORS domain matching tests are skipped because environment variables
		// set in tests don't propagate to the worker runtime in cloudflare:test
		// The CORS logic is tested through integration tests in the actual deployment
		// environment where environment variables are properly configured.
	});

	describe("GET /docsz", () => {
		it("should return Scalar HTML documentation", async () => {
			const response = await SELF.fetch("http://local.test/docsz");

			expect(response.status).toBe(200);
			expect(response.headers.get("Content-Type")).toContain("text/html");
			const html = await response.text();
			expect(html).toContain("Scalar");
		});
	});
});
