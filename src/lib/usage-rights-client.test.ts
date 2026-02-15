import { describe, expect, it, beforeEach, vi } from "vitest";
import {
	UsageRightsClient,
	createUsageRightsClient,
} from "./usage-rights-client";

describe("UsageRightsClient", () => {
	let client: UsageRightsClient;
	let mockFetcher: { fetch: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		mockFetcher = {
			fetch: vi.fn(),
		};
	});

	// =========================================================================
	// gate()
	// =========================================================================
	describe("gate", () => {
		it("should return allowed:true when AUTH_SERVICE not configured", async () => {
			client = new UsageRightsClient({});

			const result = await client.gate("org-123", "watchlistQueries");
			expect(result).toEqual({ allowed: true });
		});

		it("should return allowed:true on 200 response", async () => {
			mockFetcher.fetch.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						allowed: true,
						used: 10,
						limit: 100,
						remaining: 90,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			);

			client = new UsageRightsClient({
				AUTH_SERVICE: mockFetcher as unknown as Fetcher,
			});

			const result = await client.gate("org-123", "watchlistQueries", 1);
			expect(result.allowed).toBe(true);
			expect(result.used).toBe(10);
			expect(result.remaining).toBe(90);
		});

		it("should return allowed:false on 403 response", async () => {
			mockFetcher.fetch.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						used: 100,
						limit: 100,
						remaining: 0,
						error: "Limit exceeded",
					}),
					{ status: 403, headers: { "Content-Type": "application/json" } },
				),
			);

			client = new UsageRightsClient({
				AUTH_SERVICE: mockFetcher as unknown as Fetcher,
			});

			const result = await client.gate("org-123", "watchlistQueries");
			expect(result.allowed).toBe(false);
			expect(result.error).toBe("Limit exceeded");
		});

		it("should return allowed:true and fail-open on fetch error", async () => {
			mockFetcher.fetch.mockRejectedValueOnce(new Error("Network error"));

			client = new UsageRightsClient({
				AUTH_SERVICE: mockFetcher as unknown as Fetcher,
			});

			const result = await client.gate("org-123", "watchlistQueries");
			expect(result.allowed).toBe(true);
		});

		it("should include count in request", async () => {
			mockFetcher.fetch.mockResolvedValueOnce(
				new Response(JSON.stringify({ allowed: true }), {
					status: 200,
				}),
			);

			client = new UsageRightsClient({
				AUTH_SERVICE: mockFetcher as unknown as Fetcher,
			});

			await client.gate("org-123", "watchlistQueries", 5);

			const call = mockFetcher.fetch.mock.calls[0][0];
			expect(call).toBeInstanceOf(Request);
			const body = JSON.parse(await call.clone().text());
			expect(body.count).toBe(5);
		});
	});

	// =========================================================================
	// meter()
	// =========================================================================
	describe("meter", () => {
		it("should return immediately when AUTH_SERVICE not configured", async () => {
			client = new UsageRightsClient({});
			await expect(
				client.meter("org-123", "watchlistQueries"),
			).resolves.toBeUndefined();
		});

		it("should call AUTH_SERVICE on meter request", async () => {
			mockFetcher.fetch.mockResolvedValueOnce(
				new Response(JSON.stringify({}), { status: 200 }),
			);

			client = new UsageRightsClient({
				AUTH_SERVICE: mockFetcher as unknown as Fetcher,
			});

			await client.meter("org-123", "watchlistQueries", 1);

			expect(mockFetcher.fetch).toHaveBeenCalledTimes(1);
			const call = mockFetcher.fetch.mock.calls[0][0];
			expect(call.url).toContain("/internal/usage-rights/meter");
		});

		it("should not throw on meter fetch error", async () => {
			mockFetcher.fetch.mockRejectedValueOnce(new Error("Network error"));

			client = new UsageRightsClient({
				AUTH_SERVICE: mockFetcher as unknown as Fetcher,
			});

			await expect(
				client.meter("org-123", "watchlistQueries"),
			).resolves.not.toThrow();
		});

		it("should use default count of 1", async () => {
			mockFetcher.fetch.mockResolvedValueOnce(
				new Response(JSON.stringify({}), { status: 200 }),
			);

			client = new UsageRightsClient({
				AUTH_SERVICE: mockFetcher as unknown as Fetcher,
			});

			await client.meter("org-123", "watchlistQueries");

			const call = mockFetcher.fetch.mock.calls[0][0];
			const body = JSON.parse(await call.clone().text());
			expect(body.count).toBe(1);
		});
	});

	// =========================================================================
	// check()
	// =========================================================================
	describe("check", () => {
		it("should return null when AUTH_SERVICE not configured", async () => {
			client = new UsageRightsClient({});

			const result = await client.check("org-123", "watchlistQueries");
			expect(result).toBeNull();
		});

		it("should return gate result on 200 response", async () => {
			mockFetcher.fetch.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						allowed: true,
						used: 5,
						limit: 100,
						remaining: 95,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			);

			client = new UsageRightsClient({
				AUTH_SERVICE: mockFetcher as unknown as Fetcher,
			});

			const result = await client.check("org-123", "watchlistQueries");
			expect(result?.allowed).toBe(true);
			expect(result?.used).toBe(5);
		});

		it("should return allowed:false on 403 response", async () => {
			mockFetcher.fetch.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						used: 100,
						limit: 100,
						remaining: 0,
					}),
					{ status: 403, headers: { "Content-Type": "application/json" } },
				),
			);

			client = new UsageRightsClient({
				AUTH_SERVICE: mockFetcher as unknown as Fetcher,
			});

			const result = await client.check("org-123", "watchlistQueries");
			expect(result?.allowed).toBe(false);
		});

		it("should return null on fetch error", async () => {
			mockFetcher.fetch.mockRejectedValueOnce(new Error("Network error"));

			client = new UsageRightsClient({
				AUTH_SERVICE: mockFetcher as unknown as Fetcher,
			});

			const result = await client.check("org-123", "watchlistQueries");
			expect(result).toBeNull();
		});

		it("should use query params for org and metric", async () => {
			mockFetcher.fetch.mockResolvedValueOnce(
				new Response(JSON.stringify({ allowed: true }), { status: 200 }),
			);

			client = new UsageRightsClient({
				AUTH_SERVICE: mockFetcher as unknown as Fetcher,
			});

			await client.check("org-456", "reports");

			const call = mockFetcher.fetch.mock.calls[0][0];
			expect(call.url).toContain("organizationId=org-456");
			expect(call.url).toContain("metric=reports");
		});
	});

	// =========================================================================
	// createUsageRightsClient()
	// =========================================================================
	describe("createUsageRightsClient", () => {
		it("should create UsageRightsClient instance", () => {
			const client = createUsageRightsClient({});
			expect(client).toBeInstanceOf(UsageRightsClient);
		});

		it("should pass env to client", async () => {
			mockFetcher.fetch.mockResolvedValueOnce(
				new Response(JSON.stringify({}), { status: 200 }),
			);

			const client = createUsageRightsClient({
				AUTH_SERVICE: mockFetcher as unknown as Fetcher,
			});

			await client.meter("org-123", "watchlistQueries");
			expect(mockFetcher.fetch).toHaveBeenCalled();
		});
	});
});
