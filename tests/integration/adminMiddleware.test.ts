import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ApiException } from "chanfana";
import {
	adminMiddleware,
	type AuthEnv,
	type AuthUser,
	type AuthTokenPayload,
} from "../../src/lib/auth-middleware";

type TestBindings = AuthEnv & { ENVIRONMENT?: string };
type TestVariables = {
	user?: AuthUser;
	token?: string;
	tokenPayload?: AuthTokenPayload;
};

/**
 * Unit tests for adminMiddleware
 *
 * These tests verify the adminMiddleware authorization logic
 * by manually setting up the context variables that would
 * normally be set by authMiddleware.
 */
describe("adminMiddleware", () => {
	it("should return 401 when tokenPayload is not set", async () => {
		const app = new Hono<{
			Bindings: TestBindings;
			Variables: TestVariables;
		}>();

		// Apply only adminMiddleware (without authMiddleware setting tokenPayload)
		app.use("/admin/*", adminMiddleware());
		app.get("/admin/test", (c) => c.json({ success: true }));

		// Override error handler to return JSON
		app.onError((err, c) => {
			if (err instanceof ApiException) {
				return c.json(
					{ success: false, error: err.message },
					err.status as 401 | 403 | 500,
				);
			}
			return c.json({ success: false, error: "Internal error" }, 500);
		});

		const response = await app.request("/admin/test", {
			method: "GET",
		});

		expect(response.status).toBe(401);
		const body = await response.json<{ success: boolean; error: string }>();
		expect(body.success).toBe(false);
		expect(body.error).toBe("Unauthorized");
	});

	it("should return 403 when user role is not admin", async () => {
		const app = new Hono<{
			Bindings: TestBindings;
			Variables: TestVariables;
		}>();

		// Middleware to simulate a non-admin user
		app.use("/admin/*", async (c, next) => {
			c.set("tokenPayload", {
				sub: "user-123",
				email: "user@example.com",
				role: "user", // Not admin
			});
			return next();
		});
		app.use("/admin/*", adminMiddleware());
		app.get("/admin/test", (c) => c.json({ success: true }));

		app.onError((err, c) => {
			if (err instanceof ApiException) {
				return c.json(
					{ success: false, error: err.message },
					err.status as 401 | 403 | 500,
				);
			}
			return c.json({ success: false, error: "Internal error" }, 500);
		});

		const response = await app.request("/admin/test", {
			method: "GET",
		});

		expect(response.status).toBe(403);
		const body = await response.json<{ success: boolean; error: string }>();
		expect(body.success).toBe(false);
		expect(body.error).toBe("Admin access required");
	});

	it("should return 403 when role is visitor", async () => {
		const app = new Hono<{
			Bindings: TestBindings;
			Variables: TestVariables;
		}>();

		app.use("/admin/*", async (c, next) => {
			c.set("tokenPayload", {
				sub: "visitor-123",
				email: "visitor@example.com",
				role: "visitor",
			});
			return next();
		});
		app.use("/admin/*", adminMiddleware());
		app.get("/admin/test", (c) => c.json({ success: true }));

		app.onError((err, c) => {
			if (err instanceof ApiException) {
				return c.json(
					{ success: false, error: err.message },
					err.status as 401 | 403 | 500,
				);
			}
			return c.json({ success: false, error: "Internal error" }, 500);
		});

		const response = await app.request("/admin/test", {
			method: "GET",
		});

		expect(response.status).toBe(403);
	});

	it("should return 403 when role is undefined", async () => {
		const app = new Hono<{
			Bindings: TestBindings;
			Variables: TestVariables;
		}>();

		app.use("/admin/*", async (c, next) => {
			c.set("tokenPayload", {
				sub: "user-123",
				email: "user@example.com",
				// role is undefined
			});
			return next();
		});
		app.use("/admin/*", adminMiddleware());
		app.get("/admin/test", (c) => c.json({ success: true }));

		app.onError((err, c) => {
			if (err instanceof ApiException) {
				return c.json(
					{ success: false, error: err.message },
					err.status as 401 | 403 | 500,
				);
			}
			return c.json({ success: false, error: "Internal error" }, 500);
		});

		const response = await app.request("/admin/test", {
			method: "GET",
		});

		expect(response.status).toBe(403);
	});

	it("should allow request when user has admin role", async () => {
		const app = new Hono<{
			Bindings: TestBindings;
			Variables: TestVariables;
		}>();

		app.use("/admin/*", async (c, next) => {
			c.set("tokenPayload", {
				sub: "admin-123",
				email: "admin@example.com",
				role: "admin",
			});
			return next();
		});
		app.use("/admin/*", adminMiddleware());
		app.get("/admin/test", (c) => c.json({ success: true, user: "admin" }));

		const response = await app.request("/admin/test", {
			method: "GET",
		});

		expect(response.status).toBe(200);
		const body = await response.json<{ success: boolean; user: string }>();
		expect(body.success).toBe(true);
		expect(body.user).toBe("admin");
	});

	it("should work correctly with authMiddleware in test environment", async () => {
		const app = new Hono<{
			Bindings: TestBindings;
			Variables: TestVariables;
		}>();

		// Simulate test environment
		app.use("/admin/*", async (c, next) => {
			// This simulates what authMiddleware does in test environment
			const mockPayload: AuthTokenPayload = {
				sub: "test-user-id",
				email: "test@example.com",
				name: "Test User",
				role: "admin",
			};
			c.set("user", {
				id: mockPayload.sub,
				email: mockPayload.email,
				name: mockPayload.name,
			});
			c.set("tokenPayload", mockPayload);
			return next();
		});
		app.use("/admin/*", adminMiddleware());
		app.get("/admin/test", (c) => {
			const payload = c.get("tokenPayload");
			return c.json({
				success: true,
				role: payload?.role,
			});
		});

		const response = await app.request("/admin/test", {
			method: "GET",
		});

		expect(response.status).toBe(200);
		const body = await response.json<{ success: boolean; role: string }>();
		expect(body.success).toBe(true);
		expect(body.role).toBe("admin");
	});
});
