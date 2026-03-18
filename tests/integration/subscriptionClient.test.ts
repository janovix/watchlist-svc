import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	SubscriptionClient,
	createSubscriptionClient,
	type SubscriptionStatus,
	type UsageCheckResult,
	type FeatureCheckResult,
} from "../../src/lib/subscription-client";

type MockAuthSvc = {
	getSubscriptionStatus: ReturnType<typeof vi.fn>;
	reportSubscriptionUsage: ReturnType<typeof vi.fn>;
	checkSubscriptionUsage: ReturnType<typeof vi.fn>;
	checkSubscriptionFeature: ReturnType<typeof vi.fn>;
};

describe("SubscriptionClient", () => {
	let client: SubscriptionClient;
	let mockAuthSvc: MockAuthSvc;

	beforeEach(() => {
		mockAuthSvc = {
			getSubscriptionStatus: vi.fn(),
			reportSubscriptionUsage: vi.fn(),
			checkSubscriptionUsage: vi.fn(),
			checkSubscriptionFeature: vi.fn(),
		};
		client = new SubscriptionClient({ AUTH_SERVICE: mockAuthSvc });
	});

	describe("constructor", () => {
		it("should create a subscription client instance", () => {
			const instance = new SubscriptionClient({ AUTH_SERVICE: mockAuthSvc });
			expect(instance).toBeInstanceOf(SubscriptionClient);
		});
	});

	describe("getSubscriptionStatus", () => {
		it("should return null when AUTH_SERVICE is not available", async () => {
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			const clientWithoutService = new SubscriptionClient({});

			const result =
				await clientWithoutService.getSubscriptionStatus("org-123");

			expect(result).toBeNull();
			expect(consoleSpy).toHaveBeenCalledWith(
				"AUTH_SERVICE binding not available, skipping subscription check",
			);
			consoleSpy.mockRestore();
		});

		it("should return subscription status on success", async () => {
			const mockRpcData = {
				hasSubscription: true,
				isEnterprise: false,
				status: "active",
				planTier: "business",
				planName: "Business Plan",
				features: ["api_access", "report_generation"],
			};
			mockAuthSvc.getSubscriptionStatus.mockResolvedValue(mockRpcData);

			const result = await client.getSubscriptionStatus("org-123");

			const expected: SubscriptionStatus = {
				hasSubscription: true,
				isEnterprise: false,
				status: "active",
				planTier: "business",
				planName: "Business Plan",
				features: ["api_access", "report_generation"],
			};
			expect(result).toEqual(expected);
			expect(mockAuthSvc.getSubscriptionStatus).toHaveBeenCalledWith("org-123");
		});

		it("should return null when RPC returns null", async () => {
			mockAuthSvc.getSubscriptionStatus.mockResolvedValue(null);
			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			const result = await client.getSubscriptionStatus("org-123");

			expect(result).toBeNull();
			consoleSpy.mockRestore();
		});

		it("should return null on RPC error", async () => {
			mockAuthSvc.getSubscriptionStatus.mockRejectedValue(
				new Error("RPC error"),
			);
			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			const result = await client.getSubscriptionStatus("org-123");

			expect(result).toBeNull();
			expect(consoleSpy).toHaveBeenCalled();
			consoleSpy.mockRestore();
		});

		it("should use default status and planTier when RPC returns null for them", async () => {
			mockAuthSvc.getSubscriptionStatus.mockResolvedValue({
				hasSubscription: false,
				isEnterprise: false,
				status: null,
				planTier: null,
				planName: null,
				features: null,
			});

			const result = await client.getSubscriptionStatus("org-123");

			expect(result).not.toBeNull();
			expect(result?.status).toBe("inactive");
			expect(result?.planTier).toBe("none");
			expect(result?.features).toEqual([]);
		});
	});

	describe("reportUsage", () => {
		it("should return without calling RPC when AUTH_SERVICE is not available", async () => {
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			const clientWithoutService = new SubscriptionClient({});

			await clientWithoutService.reportUsage("org-123", "alerts", 1);

			expect(consoleSpy).toHaveBeenCalledWith(
				"AUTH_SERVICE binding not available, skipping usage report",
			);
			consoleSpy.mockRestore();
		});

		it("should report usage and return void", async () => {
			mockAuthSvc.reportSubscriptionUsage.mockResolvedValue(undefined);

			await client.reportUsage("org-123", "alerts", 5);

			expect(mockAuthSvc.reportSubscriptionUsage).toHaveBeenCalledWith(
				"org-123",
				"alerts",
				5,
			);
		});

		it("should use default count of 1", async () => {
			mockAuthSvc.reportSubscriptionUsage.mockResolvedValue(undefined);

			await client.reportUsage("org-123", "alerts");

			expect(mockAuthSvc.reportSubscriptionUsage).toHaveBeenCalledWith(
				"org-123",
				"alerts",
				1,
			);
		});

		it("should throw on RPC error", async () => {
			mockAuthSvc.reportSubscriptionUsage.mockRejectedValue(
				new Error("RPC error"),
			);
			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			await expect(client.reportUsage("org-123", "alerts", 1)).rejects.toThrow(
				"RPC error",
			);
			consoleSpy.mockRestore();
		});
	});

	describe("checkUsage", () => {
		it("should return null when AUTH_SERVICE is not available", async () => {
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			const clientWithoutService = new SubscriptionClient({});

			const result = await clientWithoutService.checkUsage("org-123", "alerts");

			expect(result).toBeNull();
			expect(consoleSpy).toHaveBeenCalledWith(
				"AUTH_SERVICE binding not available, allowing action",
			);
			consoleSpy.mockRestore();
		});

		it("should check usage successfully", async () => {
			const mockRpcData = {
				allowed: true,
				used: 50,
				included: 100,
				remaining: 50,
				overage: 0,
			};
			mockAuthSvc.checkSubscriptionUsage.mockResolvedValue(mockRpcData);

			const result = await client.checkUsage("org-123", "alerts");

			const expected: UsageCheckResult = {
				allowed: true,
				used: 50,
				included: 100,
				remaining: 50,
				overage: 0,
				planTier: "none",
			};
			expect(result).toEqual(expected);
			expect(mockAuthSvc.checkSubscriptionUsage).toHaveBeenCalledWith(
				"org-123",
				"alerts",
			);
		});

		it("should return null when RPC returns null", async () => {
			mockAuthSvc.checkSubscriptionUsage.mockResolvedValue(null);

			const result = await client.checkUsage("org-123", "alerts");

			expect(result).toBeNull();
		});

		it("should return null on RPC error", async () => {
			mockAuthSvc.checkSubscriptionUsage.mockRejectedValue(
				new Error("RPC error"),
			);
			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			const result = await client.checkUsage("org-123", "alerts");

			expect(result).toBeNull();
			consoleSpy.mockRestore();
		});

		it("should use tier when planTier is undefined (fallback path)", async () => {
			mockAuthSvc.checkSubscriptionUsage.mockResolvedValue({
				allowed: true,
				used: 0,
				included: 10,
				remaining: 10,
				overage: 0,
				planTier: undefined,
				tier: "free",
			});

			const result = await client.checkUsage("org-123", "alerts");

			expect(result).not.toBeNull();
			expect(result?.planTier).toBe("free");
		});

		it("should use default values when RPC returns undefined for numeric fields", async () => {
			mockAuthSvc.checkSubscriptionUsage.mockResolvedValue({
				allowed: undefined,
				used: undefined,
				included: undefined,
				remaining: undefined,
				overage: undefined,
			});

			const result = await client.checkUsage("org-123", "alerts");

			expect(result).toEqual({
				allowed: false,
				used: 0,
				included: 0,
				remaining: 0,
				overage: 0,
				planTier: "none",
			});
		});
	});

	describe("hasFeature", () => {
		it("should return null when AUTH_SERVICE is not available", async () => {
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			const clientWithoutService = new SubscriptionClient({});

			const result = await clientWithoutService.hasFeature(
				"org-123",
				"api_access",
			);

			expect(result).toBeNull();
			expect(consoleSpy).toHaveBeenCalledWith(
				"AUTH_SERVICE binding not available, allowing feature",
			);
			consoleSpy.mockRestore();
		});

		it("should check feature successfully", async () => {
			mockAuthSvc.checkSubscriptionFeature.mockResolvedValue({
				allowed: true,
				planTier: "business",
			});

			const result = await client.hasFeature("org-123", "api_access");

			const expected: FeatureCheckResult = {
				allowed: true,
				planTier: "business",
			};
			expect(result).toEqual(expected);
			expect(mockAuthSvc.checkSubscriptionFeature).toHaveBeenCalledWith(
				"org-123",
				"api_access",
			);
		});

		it("should return allowed:false when feature is denied", async () => {
			mockAuthSvc.checkSubscriptionFeature.mockResolvedValue({
				allowed: false,
				planTier: "business",
			});

			const result = await client.hasFeature("org-123", "api_access");

			expect(result?.allowed).toBe(false);
		});

		it("should return null on RPC error", async () => {
			mockAuthSvc.checkSubscriptionFeature.mockRejectedValue(
				new Error("RPC error"),
			);
			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});

			const result = await client.hasFeature("org-123", "api_access");

			expect(result).toBeNull();
			consoleSpy.mockRestore();
		});

		it("should use default planTier when RPC returns null", async () => {
			mockAuthSvc.checkSubscriptionFeature.mockResolvedValue({
				allowed: true,
				planTier: null,
			});

			const result = await client.hasFeature("org-123", "api_access");

			expect(result).not.toBeNull();
			expect(result?.planTier).toBe("none");
		});
	});

	describe("createSubscriptionClient", () => {
		it("should create a subscription client instance", () => {
			const instance = createSubscriptionClient({ AUTH_SERVICE: mockAuthSvc });
			expect(instance).toBeInstanceOf(SubscriptionClient);
		});
	});
});
