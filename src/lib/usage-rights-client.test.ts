import { describe, expect, it, beforeEach, vi } from "vitest";
import {
	UsageRightsClient,
	createUsageRightsClient,
} from "./usage-rights-client";

describe("UsageRightsClient", () => {
	let client: UsageRightsClient;
	let mockAuthSvc: {
		gateUsageRights: ReturnType<typeof vi.fn>;
		meterUsageRights: ReturnType<typeof vi.fn>;
		checkUsageRights: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		mockAuthSvc = {
			gateUsageRights: vi.fn(),
			meterUsageRights: vi.fn(),
			checkUsageRights: vi.fn(),
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

		it("should return allowed:true on successful gate", async () => {
			mockAuthSvc.gateUsageRights.mockResolvedValueOnce({
				allowed: true,
				used: 10,
				limit: 100,
				remaining: 90,
			});

			client = new UsageRightsClient({ AUTH_SERVICE: mockAuthSvc });

			const result = await client.gate("org-123", "watchlistQueries", 1);
			expect(result.allowed).toBe(true);
			expect(result.used).toBe(10);
			expect(result.remaining).toBe(90);
		});

		it("should return allowed:false when gate denies", async () => {
			mockAuthSvc.gateUsageRights.mockResolvedValueOnce({
				allowed: false,
				used: 100,
				limit: 100,
				remaining: 0,
				error: "Limit exceeded",
			});

			client = new UsageRightsClient({ AUTH_SERVICE: mockAuthSvc });

			const result = await client.gate("org-123", "watchlistQueries");
			expect(result.allowed).toBe(false);
			expect(result.error).toBe("Limit exceeded");
		});

		it("should return allowed:true and fail-open on RPC error", async () => {
			mockAuthSvc.gateUsageRights.mockRejectedValueOnce(new Error("RPC error"));

			client = new UsageRightsClient({ AUTH_SERVICE: mockAuthSvc });

			const result = await client.gate("org-123", "watchlistQueries");
			expect(result.allowed).toBe(true);
		});

		it("should pass orgId, metric and count to gateUsageRights", async () => {
			mockAuthSvc.gateUsageRights.mockResolvedValueOnce({ allowed: true });

			client = new UsageRightsClient({ AUTH_SERVICE: mockAuthSvc });

			await client.gate("org-123", "watchlistQueries", 5);

			expect(mockAuthSvc.gateUsageRights).toHaveBeenCalledWith(
				"org-123",
				"watchlistQueries",
				5,
			);
		});

		it("should use default count of 1", async () => {
			mockAuthSvc.gateUsageRights.mockResolvedValueOnce({ allowed: true });

			client = new UsageRightsClient({ AUTH_SERVICE: mockAuthSvc });

			await client.gate("org-123", "watchlistQueries");

			expect(mockAuthSvc.gateUsageRights).toHaveBeenCalledWith(
				"org-123",
				"watchlistQueries",
				1,
			);
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

		it("should call meterUsageRights RPC", async () => {
			mockAuthSvc.meterUsageRights.mockResolvedValueOnce(undefined);

			client = new UsageRightsClient({ AUTH_SERVICE: mockAuthSvc });

			await client.meter("org-123", "watchlistQueries", 1);

			expect(mockAuthSvc.meterUsageRights).toHaveBeenCalledWith(
				"org-123",
				"watchlistQueries",
				1,
			);
		});

		it("should not throw on RPC error", async () => {
			mockAuthSvc.meterUsageRights.mockRejectedValueOnce(
				new Error("RPC error"),
			);

			client = new UsageRightsClient({ AUTH_SERVICE: mockAuthSvc });

			await expect(
				client.meter("org-123", "watchlistQueries"),
			).resolves.not.toThrow();
		});

		it("should use default count of 1", async () => {
			mockAuthSvc.meterUsageRights.mockResolvedValueOnce(undefined);

			client = new UsageRightsClient({ AUTH_SERVICE: mockAuthSvc });

			await client.meter("org-123", "watchlistQueries");

			expect(mockAuthSvc.meterUsageRights).toHaveBeenCalledWith(
				"org-123",
				"watchlistQueries",
				1,
			);
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

		it("should return gate result on successful check", async () => {
			mockAuthSvc.checkUsageRights.mockResolvedValueOnce({
				allowed: true,
				used: 5,
				limit: 100,
				remaining: 95,
			});

			client = new UsageRightsClient({ AUTH_SERVICE: mockAuthSvc });

			const result = await client.check("org-123", "watchlistQueries");
			expect(result?.allowed).toBe(true);
			expect(result?.used).toBe(5);
		});

		it("should return allowed:false when check denies", async () => {
			mockAuthSvc.checkUsageRights.mockResolvedValueOnce({
				allowed: false,
				used: 100,
				limit: 100,
				remaining: 0,
			});

			client = new UsageRightsClient({ AUTH_SERVICE: mockAuthSvc });

			const result = await client.check("org-123", "watchlistQueries");
			expect(result?.allowed).toBe(false);
		});

		it("should return null on RPC error", async () => {
			mockAuthSvc.checkUsageRights.mockRejectedValueOnce(
				new Error("RPC error"),
			);

			client = new UsageRightsClient({ AUTH_SERVICE: mockAuthSvc });

			const result = await client.check("org-123", "watchlistQueries");
			expect(result).toBeNull();
		});

		it("should pass orgId and metric to checkUsageRights", async () => {
			mockAuthSvc.checkUsageRights.mockResolvedValueOnce({ allowed: true });

			client = new UsageRightsClient({ AUTH_SERVICE: mockAuthSvc });

			await client.check("org-456", "reports");

			expect(mockAuthSvc.checkUsageRights).toHaveBeenCalledWith(
				"org-456",
				"reports",
			);
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

		it("should pass env to client and call meterUsageRights", async () => {
			mockAuthSvc.meterUsageRights.mockResolvedValueOnce(undefined);

			const client = createUsageRightsClient({ AUTH_SERVICE: mockAuthSvc });

			await client.meter("org-123", "watchlistQueries");
			expect(mockAuthSvc.meterUsageRights).toHaveBeenCalled();
		});
	});
});
