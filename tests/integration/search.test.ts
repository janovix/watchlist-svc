import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Search API Tests", () => {
	it("should return error when query is missing", async () => {
		const response = await SELF.fetch("http://local.test/search", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				// Missing 'q' field
			}),
		});

		// Should return 400 (Bad Request) for invalid input
		expect(response.status).toBe(400);
	});

	// Note: Search endpoint requires AI and Vectorize bindings which are difficult to mock
	// in the Cloudflare Workers test environment. These tests verify error handling.
	// Full hybrid search functionality would need integration tests with real bindings.
});
