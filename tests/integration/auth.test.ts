import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { validateSession, requireAuth } from "../../src/lib/auth";
import type { AppContext } from "../../src/types";

describe("Auth Module Tests", () => {
	describe("validateSession", () => {
		it("should return mock session when AUTH_SERVICE is not configured", async () => {
			// Create a mock context without AUTH_SERVICE
			const mockContext = {
				env: {
					...env,
					AUTH_SERVICE: undefined,
					AUTH_SERVICE_URL: undefined,
				},
				req: {
					header: () => "",
				},
			} as unknown as AppContext;

			const session = await validateSession(mockContext);

			expect(session).toBeDefined();
			expect(session.user.id).toBe("test-user");
			expect(session.user.email).toBe("test@example.com");
			expect(session.session.id).toBe("test-session");
		});

		it("should validate session via AUTH_SERVICE when configured", async () => {
			const mockSessionData = {
				user: {
					id: "real-user-id",
					email: "user@example.com",
					name: "Real User",
				},
				session: {
					id: "real-session-id",
					expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
				},
			};

			// Mock AUTH_SERVICE to return valid session
			const mockAuthService = {
				fetch: vi.fn().mockResolvedValue(
					new Response(JSON.stringify(mockSessionData), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
				),
			};

			const mockContext = {
				env: {
					...env,
					AUTH_SERVICE: mockAuthService as unknown as Fetcher,
					AUTH_SERVICE_URL: undefined,
				},
				req: {
					header: (name: string) => {
						if (name === "Cookie") return "session=test-cookie";
						return undefined;
					},
				},
			} as unknown as AppContext;

			const session = await validateSession(mockContext);

			expect(session).toBeDefined();
			expect(session.user.id).toBe("real-user-id");
			expect(session.user.email).toBe("user@example.com");
			expect(mockAuthService.fetch).toHaveBeenCalled();
			// Verify the mock session data was used
			expect(session.user.name).toBe("Real User");
		});

		it("should throw 401 when AUTH_SERVICE returns unauthorized", async () => {
			const mockAuthService = {
				fetch: vi.fn().mockResolvedValue(
					new Response(JSON.stringify({ error: "Unauthorized" }), {
						status: 401,
						headers: { "Content-Type": "application/json" },
					}),
				),
			};

			const mockContext = {
				env: {
					...env,
					AUTH_SERVICE: mockAuthService as unknown as Fetcher,
					AUTH_SERVICE_URL: undefined,
				},
				req: {
					header: () => "",
				},
			} as unknown as AppContext;

			await expect(validateSession(mockContext)).rejects.toThrow();
			expect(mockAuthService.fetch).toHaveBeenCalled();
		});
	});

	describe("requireAuth", () => {
		it("should set session in context when auth succeeds", async () => {
			const mockSet = vi.fn();
			const mockContext = {
				env: {
					...env,
					AUTH_SERVICE: undefined,
					AUTH_SERVICE_URL: undefined,
				},
				req: {
					header: () => "",
				},
				set: mockSet,
			} as unknown as AppContext;

			await requireAuth(mockContext);

			expect(mockSet).toHaveBeenCalledWith(
				"session",
				expect.objectContaining({
					user: expect.objectContaining({ id: "test-user" }),
				}),
			);
		});
	});
});
