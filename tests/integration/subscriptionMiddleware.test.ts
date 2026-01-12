import { describe, it, expect, beforeEach, vi } from "vitest";
import { Context, Hono } from "hono";
import {
	requireUsageQuota,
	requireFeature,
	requireSubscription,
	getUsageInfo,
	type SubscriptionVariables,
} from "../../src/lib/subscription-middleware";
import { SubscriptionClient } from "../../src/lib/subscription-client";

// Mock the SubscriptionClient
vi.mock("../../src/lib/subscription-client", async () => {
	const actual = await vi.importActual("../../src/lib/subscription-client");
	return {
		...actual,
		SubscriptionClient: vi.fn(),
	};
});

describe("Subscription Middleware", () => {
	let app: Hono<{
		Bindings: Cloudflare.Env;
		Variables: { organization?: { id: string; name: string; slug: string } };
	}>;
	let mockClient: {
		checkUsage: ReturnType<typeof vi.fn>;
		hasFeature: ReturnType<typeof vi.fn>;
		getSubscriptionStatus: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		app = new Hono<{
			Bindings: Cloudflare.Env;
			Variables: { organization?: { id: string; name: string; slug: string } };
		}>();

		mockClient = {
			checkUsage: vi.fn(),
			hasFeature: vi.fn(),
			getSubscriptionStatus: vi.fn(),
		};

		(
			SubscriptionClient as unknown as ReturnType<typeof vi.fn>
		).mockImplementation(() => mockClient);
	});

	describe("requireUsageQuota", () => {
		it("should return 409 when organization is missing", async () => {
			app.post("/test", requireUsageQuota("alerts"), (c) =>
				c.json({ ok: true }),
			);

			const res = await app.request("/test", { method: "POST" });
			const body = await res.json<{
				success: boolean;
				error: string;
				code: string;
			}>();

			expect(res.status).toBe(409);
			expect(body.error).toBe("Organization Required");
			expect(body.code).toBe("ORGANIZATION_REQUIRED");
		});

		it("should allow action when usage check returns null", async () => {
			mockClient.checkUsage.mockResolvedValue(null);

			app.post(
				"/test",
				(c, next) => {
					c.set("organization", { id: "org-123", name: "Test", slug: "test" });
					return next();
				},
				requireUsageQuota("alerts"),
				(c) => c.json({ ok: true }),
			);

			const res = await app.request("/test", { method: "POST" });
			const body = await res.json<{ ok: boolean }>();

			expect(res.status).toBe(200);
			expect(body.ok).toBe(true);
		});

		it("should set usage info and headers when usage check succeeds", async () => {
			const mockUsageResult = {
				allowed: true,
				used: 50,
				included: 100,
				remaining: 50,
				overage: 0,
				planTier: "business" as const,
			};
			mockClient.checkUsage.mockResolvedValue(mockUsageResult);

			app.post(
				"/test",
				(c, next) => {
					c.set("organization", { id: "org-123", name: "Test", slug: "test" });
					return next();
				},
				requireUsageQuota("alerts"),
				(c) => {
					const usageInfo = c.get("usageInfo");
					return c.json({ ok: true, usageInfo });
				},
			);

			const res = await app.request("/test", { method: "POST" });
			const body = await res.json<{ ok: boolean; usageInfo: unknown }>();

			expect(res.status).toBe(200);
			expect(body.ok).toBe(true);
			expect(body.usageInfo).toEqual(mockUsageResult);
			expect(res.headers.get("X-Usage-Used")).toBe("50");
			expect(res.headers.get("X-Usage-Included")).toBe("100");
			expect(res.headers.get("X-Usage-Overage")).toBe("0");
			expect(res.headers.get("X-Plan-Tier")).toBe("business");
		});

		it("should handle unlimited included (-1)", async () => {
			const mockUsageResult = {
				allowed: true,
				used: 50,
				included: -1,
				remaining: -1,
				overage: 0,
				planTier: "enterprise" as const,
			};
			mockClient.checkUsage.mockResolvedValue(mockUsageResult);

			app.post(
				"/test",
				(c, next) => {
					c.set("organization", { id: "org-123", name: "Test", slug: "test" });
					return next();
				},
				requireUsageQuota("alerts"),
				(c) => c.json({ ok: true }),
			);

			const res = await app.request("/test", { method: "POST" });

			expect(res.status).toBe(200);
			expect(res.headers.get("X-Usage-Included")).toBe("unlimited");
		});
	});

	describe("requireFeature", () => {
		it("should return 409 when organization is missing", async () => {
			app.post("/test", requireFeature("api_access"), (c) =>
				c.json({ ok: true }),
			);

			const res = await app.request("/test", { method: "POST" });
			const body = await res.json<{
				success: boolean;
				error: string;
				code: string;
			}>();

			expect(res.status).toBe(409);
			expect(body.error).toBe("Organization Required");
			expect(body.code).toBe("ORGANIZATION_REQUIRED");
		});

		it("should allow action when feature check returns null", async () => {
			mockClient.hasFeature.mockResolvedValue(null);

			app.post(
				"/test",
				(c, next) => {
					c.set("organization", { id: "org-123", name: "Test", slug: "test" });
					return next();
				},
				requireFeature("api_access"),
				(c) => c.json({ ok: true }),
			);

			const res = await app.request("/test", { method: "POST" });
			const body = await res.json<{ ok: boolean }>();

			expect(res.status).toBe(200);
			expect(body.ok).toBe(true);
		});

		it("should allow action when feature is allowed", async () => {
			mockClient.hasFeature.mockResolvedValue({
				allowed: true,
				planTier: "business",
			});

			app.post(
				"/test",
				(c, next) => {
					c.set("organization", { id: "org-123", name: "Test", slug: "test" });
					return next();
				},
				requireFeature("api_access"),
				(c) => c.json({ ok: true }),
			);

			const res = await app.request("/test", { method: "POST" });
			const body = await res.json<{ ok: boolean }>();

			expect(res.status).toBe(200);
			expect(body.ok).toBe(true);
		});

		it("should return 403 when feature is not allowed", async () => {
			mockClient.hasFeature.mockResolvedValue({
				allowed: false,
				planTier: "free",
				requiredTier: "business",
			});

			app.post(
				"/test",
				(c, next) => {
					c.set("organization", { id: "org-123", name: "Test", slug: "test" });
					return next();
				},
				requireFeature("api_access"),
				(c) => c.json({ ok: true }),
			);

			const res = await app.request("/test", { method: "POST" });
			const body = await res.json<{
				success: boolean;
				error: string;
				code: string;
				requiredTier: string;
				currentTier: string;
			}>();

			expect(res.status).toBe(403);
			expect(body.error).toBe("Feature Not Available");
			expect(body.code).toBe("FEATURE_REQUIRED");
			expect(body.requiredTier).toBe("business");
			expect(body.currentTier).toBe("free");
		});
	});

	describe("requireSubscription", () => {
		it("should return 409 when organization is missing", async () => {
			app.post("/test", requireSubscription(), (c) => c.json({ ok: true }));

			const res = await app.request("/test", { method: "POST" });
			const body = await res.json<{
				success: boolean;
				error: string;
				code: string;
			}>();

			expect(res.status).toBe(409);
			expect(body.error).toBe("Organization Required");
			expect(body.code).toBe("ORGANIZATION_REQUIRED");
		});

		it("should allow action when subscription check returns null", async () => {
			mockClient.getSubscriptionStatus.mockResolvedValue(null);

			app.post(
				"/test",
				(c, next) => {
					c.set("organization", { id: "org-123", name: "Test", slug: "test" });
					return next();
				},
				requireSubscription(),
				(c) => c.json({ ok: true }),
			);

			const res = await app.request("/test", { method: "POST" });
			const body = await res.json<{ ok: boolean }>();

			expect(res.status).toBe(200);
			expect(body.ok).toBe(true);
		});

		it("should allow action when has subscription", async () => {
			mockClient.getSubscriptionStatus.mockResolvedValue({
				hasSubscription: true,
				isEnterprise: false,
				status: "active",
				planTier: "free",
				planName: "Free Plan",
				features: [],
			});

			app.post(
				"/test",
				(c, next) => {
					c.set("organization", { id: "org-123", name: "Test", slug: "test" });
					return next();
				},
				requireSubscription(),
				(c) => c.json({ ok: true }),
			);

			const res = await app.request("/test", { method: "POST" });
			const body = await res.json<{ ok: boolean }>();

			expect(res.status).toBe(200);
			expect(body.ok).toBe(true);
		});

		it("should allow action when planTier is not 'none'", async () => {
			mockClient.getSubscriptionStatus.mockResolvedValue({
				hasSubscription: false,
				isEnterprise: false,
				status: "inactive",
				planTier: "free",
				planName: null,
				features: [],
			});

			app.post(
				"/test",
				(c, next) => {
					c.set("organization", { id: "org-123", name: "Test", slug: "test" });
					return next();
				},
				requireSubscription(),
				(c) => c.json({ ok: true }),
			);

			const res = await app.request("/test", { method: "POST" });
			const body = await res.json<{ ok: boolean }>();

			expect(res.status).toBe(200);
			expect(body.ok).toBe(true);
		});

		it("should return 402 when planTier is 'none' and no subscription", async () => {
			mockClient.getSubscriptionStatus.mockResolvedValue({
				hasSubscription: false,
				isEnterprise: false,
				status: "inactive",
				planTier: "none",
				planName: null,
				features: [],
			});

			app.post(
				"/test",
				(c, next) => {
					c.set("organization", { id: "org-123", name: "Test", slug: "test" });
					return next();
				},
				requireSubscription(),
				(c) => c.json({ ok: true }),
			);

			const res = await app.request("/test", { method: "POST" });
			const body = await res.json<{
				success: boolean;
				error: string;
				code: string;
			}>();

			expect(res.status).toBe(402);
			expect(body.error).toBe("Subscription Required");
			expect(body.code).toBe("SUBSCRIPTION_REQUIRED");
		});
	});

	describe("getUsageInfo", () => {
		it("should return usage info from context", () => {
			const mockUsageInfo: SubscriptionVariables["usageInfo"] = {
				allowed: true,
				used: 50,
				included: 100,
				remaining: 50,
				overage: 0,
				planTier: "business",
			};

			// This is a helper function test, so we'll test it directly
			const mockContext = {
				get: vi.fn((key: string) => {
					if (key === "usageInfo") return mockUsageInfo;
					return undefined;
				}),
			} as unknown as Context<{
				Variables: Partial<SubscriptionVariables>;
			}>;

			const result = getUsageInfo(mockContext);
			expect(result).toEqual(mockUsageInfo);
		});

		it("should return null when usage info is not set", () => {
			const mockContext = {
				get: vi.fn(() => undefined),
			} as unknown as Context<{
				Variables: Partial<SubscriptionVariables>;
			}>;

			const result = getUsageInfo(mockContext);
			expect(result).toBeNull();
		});
	});
});
