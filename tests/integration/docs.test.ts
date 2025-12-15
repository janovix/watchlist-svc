import { SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { getOpenApiInfo } from "../../src/app-meta";

describe("API docs", () => {
	it("serves Scalar API reference at /docsz", async () => {
		const res = await SELF.fetch("http://local.test/docsz");
		const html = await res.text();

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/i);
		// High-signal markers that we are serving Scalar (not the old viewer).
		expect(html).toContain("@scalar/api-reference");
		expect(html).toContain("api-reference");
	});

	it("serves app metadata JSON at /", async () => {
		const res = await SELF.fetch("http://local.test/");
		const body = (await res.json()) as { name?: string; version?: string };

		expect(res.status).toBe(200);
		expect(body).toHaveProperty("name");
		expect(body).toHaveProperty("version");
	});

	it("serves health check at /healthz", async () => {
		const res = await SELF.fetch("http://local.test/healthz");
		const body = (await res.json()) as {
			success?: boolean;
			result?: { ok?: boolean; timestamp?: string };
		};

		expect(res.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.result?.ok).toBe(true);
		expect(body.result?.timestamp).toBeDefined();
	});

	it("returns a 500 JSON for unexpected errors", async () => {
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const res = await SELF.fetch("http://local.test/", {
			headers: {
				"x-force-error": "1",
			},
		});
		const body = await res.json<{
			success: boolean;
			errors: Array<{ code: number; message: string }>;
		}>();

		expect(res.status).toBe(500);
		expect(body.success).toBe(false);
		expect(body.errors[0]).toEqual({
			code: 7000,
			message: "Internal Server Error",
		});

		consoleErrorSpy.mockRestore();
	});

	it("serves OpenAPI schema JSON", async () => {
		const res = await SELF.fetch("http://local.test/openapi.json");
		const body = (await res.json()) as { openapi?: string; info?: unknown };

		expect(res.status).toBe(200);
		expect(body).toHaveProperty("openapi");
		expect(body).toHaveProperty("info");
	});

	it("builds OpenAPI description fallback when package description is missing", () => {
		const info = getOpenApiInfo({ name: "backend-template", version: "0.0.0" });

		expect(info.description).toBe(
			"OpenAPI documentation for backend-template (0.0.0).",
		);
	});
});
