import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Search API Tests", () => {
	it("should return error when AI binding is not available", async () => {
		const response = await SELF.fetch("http://local.test/search", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query: "test query",
			}),
		});

		// Should return 500 if AI binding is not available
		expect(response.status).toBe(500);
	});

	// Note: Search endpoint requires AI and Vectorize bindings which are difficult to mock
	// in the Cloudflare Workers test environment. These tests verify error handling.
});
