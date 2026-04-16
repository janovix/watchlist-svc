import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { corsMiddleware } from "./cors";

describe("corsMiddleware", () => {
	it("allows X-Environment header in preflight response", async () => {
		const app = new Hono<{ Bindings: { TRUSTED_ORIGINS?: string } }>();
		app.use("*", corsMiddleware());
		app.get("/test", (c) => c.text("ok"));

		const res = await app.request(
			"/test",
			{
				method: "OPTIONS",
				headers: {
					Origin: "https://watchlist.janovix.workers.dev",
					"Access-Control-Request-Method": "GET",
					"Access-Control-Request-Headers": "X-Environment",
				},
			},
			{ TRUSTED_ORIGINS: "*.janovix.workers.dev" },
		);

		expect(res.headers.get("access-control-allow-origin")).toBe(
			"https://watchlist.janovix.workers.dev",
		);
		expect(
			res.headers.get("access-control-allow-headers")?.toLowerCase(),
		).toContain("x-environment");
	});
});
