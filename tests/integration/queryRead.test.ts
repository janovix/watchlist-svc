import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/**
 * Query Read Endpoint Tests
 *
 * Tests for GET /queries/:id endpoint that retrieves
 * a single search query with all aggregated results.
 *
 * Note: These tests verify basic endpoint behavior.
 * Full auth and org scoping would require JWT token generation
 * which is complex in the Cloudflare Workers test environment.
 */
describe("GET /queries/:id", () => {
	it("should return error when organization context is missing", async () => {
		const testId = "550e8400-e29b-41d4-a716-446655440000";
		const response = await SELF.fetch(`http://local.test/queries/${testId}`, {
			method: "GET",
		});

		// Should return 403 or 404 without proper auth (depending on test env)
		expect([403, 404]).toContain(response.status);
	});

	it("should handle malformed UUID", async () => {
		const response = await SELF.fetch("http://local.test/queries/not-a-uuid", {
			method: "GET",
		});

		// Should return error (403 or 400)
		expect([400, 403]).toContain(response.status);
	});

	it("should return proper content type", async () => {
		const testId = "550e8400-e29b-41d4-a716-446655440001";
		const response = await SELF.fetch(`http://local.test/queries/${testId}`, {
			method: "GET",
		});

		expect(response.headers.get("content-type")).toContain("application/json");
	});
});
