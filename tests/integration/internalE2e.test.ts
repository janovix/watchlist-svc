import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("internal E2E purge", () => {
	it("returns 401 without API key", async () => {
		const res = await SELF.fetch(
			"http://local.test/api/v1/internal/e2e/purge",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ organizationIds: ["org-a"] }),
			},
		);
		expect(res.status).toBe(401);
	});

	it("purges search queries when API key matches", async () => {
		const res = await SELF.fetch(
			"http://local.test/api/v1/internal/e2e/purge",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-e2e-api-key": "test-e2e-key",
				},
				body: JSON.stringify({
					organizationIds: ["nonexistent-org-purge-test"],
				}),
			},
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			purgedSearchQueries: number;
			errors: string[];
		};
		expect(body.errors).toEqual([]);
		expect(typeof body.purgedSearchQueries).toBe("number");
	});
});
