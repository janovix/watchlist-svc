import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	SubscriptionClient,
	createSubscriptionClient,
	type SubscriptionStatus,
	type UsageCheckResult,
	type FeatureCheckResult,
} from "../../src/lib/subscription-client";

describe("SubscriptionClient", () => {
	let client: SubscriptionClient;
	let mockEnv: Cloudflare.Env;
	let mockAuthService: {
		fetch: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		mockAuthService = {
			fetch: vi.fn(),
		};
		mockEnv = {
			AUTH_SERVICE: mockAuthService as unknown as Service,
		} as Cloudflare.Env;
		client = new SubscriptionClient(mockEnv);
	});

	describe("constructor", () => {
		it("should create a subscription client instance", () => {
			const instance = new SubscriptionClient(mockEnv);
			expect(instance).toBeInstanceOf(SubscriptionClient);
		});
	});

	describe("getSubscriptionStatus", () => {
		it("should return null when AUTH_SERVICE is not available", async () => {
			const envWithoutService = {} as Cloudflare.Env;
			const clientWithoutService = new SubscriptionClient(envWithoutService);
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const result =
				await clientWithoutService.getSubscriptionStatus("org-123");

			expect(result).toBeNull();
			expect(consoleSpy).toHaveBeenCalledWith(
				"AUTH_SERVICE binding not available, skipping subscription check",
			);
			consoleSpy.mockRestore();
		});

		it("should return subscription status on success", async () => {
			const mockStatus: SubscriptionStatus = {
				hasSubscription: true,
				isEnterprise: false,
				status: "active",
				planTier: "business",
				planName: "Business Plan",
				features: ["api_access", "report_generation"],
			};

			mockAuthService.fetch.mockResolvedValue({
				ok: true,
				json: async () => ({
					success: true,
					data: mockStatus,
				}),
			});

			const result = await client.getSubscriptionStatus("org-123");

			expect(result).toEqual(mockStatus);
			expect(mockAuthService.fetch).toHaveBeenCalledWith(
				expect.objectContaining({
					url: expect.stringContaining(
						"https://auth-svc.internal/internal/subscription/status?organizationId=org-123",
					),
				}),
			);
		});

		it("should return null when response is not ok", async () => {
			mockAuthService.fetch.mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			});

			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const result = await client.getSubscriptionStatus("org-123");

			expect(result).toBeNull();
			expect(consoleSpy).toHaveBeenCalled();
			consoleSpy.mockRestore();
		});

		it("should return null when success is false", async () => {
			mockAuthService.fetch.mockResolvedValue({
				ok: true,
				json: async () => ({
					success: false,
					error: "Subscription not found",
				}),
			});

			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const result = await client.getSubscriptionStatus("org-123");

			expect(result).toBeNull();
			expect(consoleSpy).toHaveBeenCalled();
			consoleSpy.mockRestore();
		});

		it("should return null on fetch error", async () => {
			mockAuthService.fetch.mockRejectedValue(new Error("Network error"));

			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const result = await client.getSubscriptionStatus("org-123");

			expect(result).toBeNull();
			expect(consoleSpy).toHaveBeenCalled();
			consoleSpy.mockRestore();
		});
	});

	describe("reportUsage", () => {
		it("should return null when AUTH_SERVICE is not available", async () => {
			const envWithoutService = {} as Cloudflare.Env;
			const clientWithoutService = new SubscriptionClient(envWithoutService);
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const result = await clientWithoutService.reportUsage(
				"org-123",
				"alerts",
				1,
			);

			expect(result).toBeNull();
			expect(consoleSpy).toHaveBeenCalledWith(
				"AUTH_SERVICE binding not available, skipping usage report",
			);
			consoleSpy.mockRestore();
		});

		it("should report usage successfully", async () => {
			const mockUsageResult: UsageCheckResult = {
				allowed: true,
				used: 10,
				included: 100,
				remaining: 90,
				overage: 0,
				planTier: "business",
			};

			mockAuthService.fetch.mockResolvedValue({
				ok: true,
				json: async () => ({
					success: true,
					data: mockUsageResult,
				}),
			});

			const result = await client.reportUsage("org-123", "alerts", 5);

			expect(result).toEqual(mockUsageResult);
			expect(mockAuthService.fetch).toHaveBeenCalledWith(
				expect.objectContaining({
					url: expect.stringContaining(
						"https://auth-svc.internal/internal/subscription/usage/report",
					),
				}),
			);
		});

		it("should use default count of 1", async () => {
			const mockUsageResult: UsageCheckResult = {
				allowed: true,
				used: 1,
				included: 100,
				remaining: 99,
				overage: 0,
				planTier: "business",
			};

			mockAuthService.fetch.mockResolvedValue({
				ok: true,
				json: async () => ({
					success: true,
					data: mockUsageResult,
				}),
			});

			await client.reportUsage("org-123", "alerts");

			const callArgs = mockAuthService.fetch.mock.calls[0][0] as Request;
			const body = (await callArgs.json()) as { count: number };
			expect(body.count).toBe(1);
		});

		it("should return null when response is not ok", async () => {
			mockAuthService.fetch.mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			});

			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const result = await client.reportUsage("org-123", "alerts", 1);

			expect(result).toBeNull();
			consoleSpy.mockRestore();
		});

		it("should return null when success is false", async () => {
			mockAuthService.fetch.mockResolvedValue({
				ok: true,
				json: async () => ({
					success: false,
					error: "Usage report failed",
				}),
			});

			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const result = await client.reportUsage("org-123", "alerts", 1);

			expect(result).toBeNull();
			consoleSpy.mockRestore();
		});

		it("should return null on fetch error", async () => {
			mockAuthService.fetch.mockRejectedValue(new Error("Network error"));

			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const result = await client.reportUsage("org-123", "alerts", 1);

			expect(result).toBeNull();
			consoleSpy.mockRestore();
		});
	});

	describe("checkUsage", () => {
		it("should return null when AUTH_SERVICE is not available", async () => {
			const envWithoutService = {} as Cloudflare.Env;
			const clientWithoutService = new SubscriptionClient(envWithoutService);
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			const result = await clientWithoutService.checkUsage("org-123", "alerts");

			expect(result).toBeNull();
			expect(consoleSpy).toHaveBeenCalledWith(
				"AUTH_SERVICE binding not available, allowing action",
			);
			consoleSpy.mockRestore();
		});

		it("should check usage successfully", async () => {
			const mockUsageResult: UsageCheckResult = {
				allowed: true,
				used: 50,
				included: 100,
				remaining: 50,
				overage: 0,
				planTier: "business",
			};

			mockAuthService.fetch.mockResolvedValue({
				ok: true,
				json: async () => ({
					success: true,
					data: mockUsageResult,
				}),
			});

			const result = await client.checkUsage("org-123", "alerts");

			expect(result).toEqual(mockUsageResult);
			expect(mockAuthService.fetch).toHaveBeenCalledWith(
				expect.objectContaining({
					url: expect.stringContaining(
						"https://auth-svc.internal/internal/subscription/usage/check",
					),
				}),
			);
		});

		it("should return null when response is not ok", async () => {
			mockAuthService.fetch.mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			});

			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const result = await client.checkUsage("org-123", "alerts");

			expect(result).toBeNull();
			consoleSpy.mockRestore();
		});

		it("should return null when success is false", async () => {
			mockAuthService.fetch.mockResolvedValue({
				ok: true,
				json: async () => ({
					success: false,
					error: "Usage check failed",
				}),
			});

			const result = await client.checkUsage("org-123", "alerts");

			expect(result).toBeNull();
		});

		it("should return null on fetch error", async () => {
			mockAuthService.fetch.mockRejectedValue(new Error("Network error"));

			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const result = await client.checkUsage("org-123", "alerts");

			expect(result).toBeNull();
			consoleSpy.mockRestore();
		});
	});

	describe("hasFeature", () => {
		it("should return null when AUTH_SERVICE is not available", async () => {
			const envWithoutService = {} as Cloudflare.Env;
			const clientWithoutService = new SubscriptionClient(envWithoutService);
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

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
			const mockFeatureResult: FeatureCheckResult = {
				allowed: true,
				planTier: "business",
			};

			mockAuthService.fetch.mockResolvedValue({
				ok: true,
				json: async () => ({
					success: true,
					data: mockFeatureResult,
				}),
			});

			const result = await client.hasFeature("org-123", "api_access");

			expect(result).toEqual(mockFeatureResult);
			expect(mockAuthService.fetch).toHaveBeenCalledWith(
				expect.objectContaining({
					url: expect.stringContaining(
						"https://auth-svc.internal/internal/subscription/feature/check",
					),
				}),
			);
		});

		it("should return null when response is not ok", async () => {
			mockAuthService.fetch.mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			});

			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const result = await client.hasFeature("org-123", "api_access");

			expect(result).toBeNull();
			consoleSpy.mockRestore();
		});

		it("should return null when success is false", async () => {
			mockAuthService.fetch.mockResolvedValue({
				ok: true,
				json: async () => ({
					success: false,
					error: "Feature check failed",
				}),
			});

			const result = await client.hasFeature("org-123", "api_access");

			expect(result).toBeNull();
		});

		it("should return null on fetch error", async () => {
			mockAuthService.fetch.mockRejectedValue(new Error("Network error"));

			const consoleSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const result = await client.hasFeature("org-123", "api_access");

			expect(result).toBeNull();
			consoleSpy.mockRestore();
		});
	});

	describe("createSubscriptionClient", () => {
		it("should create a subscription client instance", () => {
			const instance = createSubscriptionClient(mockEnv);
			expect(instance).toBeInstanceOf(SubscriptionClient);
		});
	});
});
