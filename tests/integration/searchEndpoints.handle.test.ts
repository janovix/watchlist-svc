/**
 * Direct SearchEndpoint / InternalSearchEndpoint.handle() coverage.
 * SELF.fetch cannot inject AUTH_SERVICE or omit org context; mock AppContext instead.
 */

import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiException } from "chanfana";

import type { Bindings } from "../../src/index";
import { InternalSearchEndpoint } from "../../src/endpoints/watchlist/internalSearch";
import { SearchEndpoint } from "../../src/endpoints/watchlist/search";
import * as searchCore from "../../src/lib/search-core";
import type { AppContext } from "../../src/types";

describe("SearchEndpoint.handle()", () => {
	let endpoint: SearchEndpoint;

	beforeEach(() => {
		endpoint = new (SearchEndpoint as unknown as new () => SearchEndpoint)();
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("throws 403 ApiException when organization context is missing", async () => {
		const mockContext = {
			env: env as unknown as AppContext["env"],
			executionCtx: { waitUntil: vi.fn() },
			get: (key: string) => {
				if (key === "organization") return null;
				return undefined;
			},
		} as unknown as AppContext;

		(
			endpoint as unknown as { getValidatedData: () => Promise<unknown> }
		).getValidatedData = async () => ({
			body: {
				q: "test query",
				topK: 50,
				threshold: 0.875,
				entityType: "person",
			},
		});

		await expect(endpoint.handle(mockContext)).rejects.toMatchObject({
			status: 403,
			message: "Organization context required",
		});
	});

	it("returns 403 JSON when usage gate denies (USAGE_LIMIT_EXCEEDED custom message)", async () => {
		const mockContext = {
			env: {
				...(env as unknown as Bindings),
				AUTH_SERVICE: {
					gateUsageRights: vi.fn().mockResolvedValue({
						allowed: false,
						code: "USAGE_LIMIT_EXCEEDED",
						metric: "watchlistQueries",
						used: 100,
						limit: 100,
					}),
				} as unknown as Bindings["AUTH_SERVICE"],
			},
			executionCtx: { waitUntil: vi.fn() },
			json: (data: unknown, status?: number) =>
				new Response(JSON.stringify(data), {
					status: status ?? 200,
					headers: { "content-type": "application/json" },
				}),
			get: (key: string) => {
				if (key === "organization") return { id: "org-gate" };
				if (key === "user") return { id: "user-1" };
				if (key === "environment") return "production";
				return undefined;
			},
		} as unknown as AppContext;

		(
			endpoint as unknown as { getValidatedData: () => Promise<unknown> }
		).getValidatedData = async () => ({
			body: {
				q: "gated query",
				topK: 50,
				threshold: 0.875,
				entityType: "person",
			},
		});

		const res = (await endpoint.handle(mockContext)) as unknown as Response;
		expect(res).toBeInstanceOf(Response);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { message?: string; code?: string };
		expect(body.code).toBe("USAGE_LIMIT_EXCEEDED");
		expect(body.message).toContain("Daily watchlist query limit");
	});

	it("returns 403 JSON when usage gate denies (non-usage code)", async () => {
		const mockContext = {
			env: {
				...(env as unknown as Bindings),
				AUTH_SERVICE: {
					gateUsageRights: vi.fn().mockResolvedValue({
						allowed: false,
						code: "ORGANIZATION_ARCHIVED",
					}),
				} as unknown as Bindings["AUTH_SERVICE"],
			},
			executionCtx: { waitUntil: vi.fn() },
			json: (data: unknown, status?: number) =>
				new Response(JSON.stringify(data), {
					status: status ?? 200,
					headers: { "content-type": "application/json" },
				}),
			get: (key: string) => {
				if (key === "organization") return { id: "org-arch" };
				if (key === "user") return { id: "user-1" };
				if (key === "environment") return "production";
				return undefined;
			},
		} as unknown as AppContext;

		(
			endpoint as unknown as { getValidatedData: () => Promise<unknown> }
		).getValidatedData = async () => ({
			body: {
				q: "archived org query",
				topK: 50,
				threshold: 0.875,
				entityType: "person",
			},
		});

		const res = (await endpoint.handle(mockContext)) as unknown as Response;
		expect(res.status).toBe(403);
		const body = (await res.json()) as { code?: string; message?: string };
		expect(body.code).toBe("ORGANIZATION_ARCHIVED");
		expect(body.message).toContain("archived");
	});

	it("wraps non-ApiException errors from performSearch as 500", async () => {
		vi.spyOn(searchCore, "performSearch").mockRejectedValueOnce(
			new Error("simulated search failure"),
		);

		const mockContext = {
			env: env as unknown as AppContext["env"],
			executionCtx: { waitUntil: vi.fn() },
			get: (key: string) => {
				if (key === "organization") return { id: "org-1" };
				if (key === "user") return { id: "u1" };
				if (key === "environment") return "production";
				return undefined;
			},
		} as unknown as AppContext;

		(
			endpoint as unknown as { getValidatedData: () => Promise<unknown> }
		).getValidatedData = async () => ({
			body: {
				q: "error path",
				topK: 50,
				threshold: 0.875,
				entityType: "person",
			},
		});

		await expect(endpoint.handle(mockContext)).rejects.toMatchObject({
			status: 500,
			message: "simulated search failure",
		});
	});
});

describe("InternalSearchEndpoint.handle()", () => {
	let endpoint: InternalSearchEndpoint;

	beforeEach(() => {
		endpoint =
			new (InternalSearchEndpoint as unknown as new () => InternalSearchEndpoint)();
		vi.restoreAllMocks();
	});

	it("throws 400 ApiException when source is not AML-originated", async () => {
		const mockContext = {
			env: env as unknown as AppContext["env"],
			executionCtx: { waitUntil: vi.fn() },
			req: {
				header: (name: string) => {
					if (name === "X-Organization-Id") return "org-int";
					if (name === "X-User-Id") return "user-int";
					if (name === "X-Environment") return "production";
					return undefined;
				},
			},
		} as unknown as Parameters<InternalSearchEndpoint["handle"]>[0];

		(
			endpoint as unknown as { getValidatedData: () => Promise<unknown> }
		).getValidatedData = async () => ({
			body: {
				q: "q",
				source: "manual",
				entityType: "person",
				topK: 50,
				threshold: 0.875,
			},
		});

		await expect(endpoint.handle(mockContext)).rejects.toMatchObject({
			status: 400,
		});
	});

	it("re-throws ApiException from performSearch", async () => {
		const apiErr = new ApiException("vector down");
		apiErr.status = 503;
		apiErr.code = 503;
		vi.spyOn(searchCore, "performSearch").mockRejectedValueOnce(apiErr);

		const mockContext = {
			env: env as unknown as AppContext["env"],
			executionCtx: { waitUntil: vi.fn() },
			req: {
				header: (name: string) => {
					if (name === "X-Organization-Id") return "org-int";
					if (name === "X-User-Id") return "user-int";
					return undefined;
				},
			},
		} as unknown as Parameters<InternalSearchEndpoint["handle"]>[0];

		(
			endpoint as unknown as { getValidatedData: () => Promise<unknown> }
		).getValidatedData = async () => ({
			body: {
				q: "aml search",
				entityType: "person",
				topK: 50,
				threshold: 0.875,
			},
		});

		await expect(endpoint.handle(mockContext)).rejects.toMatchObject({
			status: 503,
			message: "vector down",
		});
	});

	it("wraps generic errors from performSearch as 500", async () => {
		vi.spyOn(searchCore, "performSearch").mockRejectedValueOnce(
			new Error("internal boom"),
		);

		const mockContext = {
			env: env as unknown as AppContext["env"],
			executionCtx: { waitUntil: vi.fn() },
			req: {
				header: (name: string) => {
					if (name === "X-Organization-Id") return "org-int";
					if (name === "X-User-Id") return "user-int";
					return undefined;
				},
			},
		} as unknown as Parameters<InternalSearchEndpoint["handle"]>[0];

		(
			endpoint as unknown as { getValidatedData: () => Promise<unknown> }
		).getValidatedData = async () => ({
			body: {
				q: "aml search",
				entityType: "person",
				topK: 50,
				threshold: 0.875,
			},
		});

		await expect(endpoint.handle(mockContext)).rejects.toMatchObject({
			status: 500,
			message: "internal boom",
		});
	});
});
