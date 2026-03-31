import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ApiException } from "chanfana";
import {
	adminMiddleware,
	type AuthEnv,
	type AuthUser,
	type AuthTokenPayload,
} from "../../src/middleware/auth";

type TestBindings = AuthEnv & { ENVIRONMENT?: string };
type TestVariables = {
	user?: AuthUser;
	token?: string;
	tokenPayload?: AuthTokenPayload;
	organization?: { id: string } | null;
};

type AdminTestApp = Hono<{
	Bindings: TestBindings;
	Variables: TestVariables;
}>;

function attachAdminErrorHandler(app: AdminTestApp) {
	app.onError((err, c) => {
		if (err instanceof ApiException) {
			return c.json(
				{ success: false, error: err.message },
				err.status as 401 | 403 | 500,
			);
		}
		return c.json({ success: false, error: "Internal error" }, 500);
	});
}

function createAdminTestApp(): AdminTestApp {
	const app = new Hono<{
		Bindings: TestBindings;
		Variables: TestVariables;
	}>();
	attachAdminErrorHandler(app);
	return app;
}

describe("adminMiddleware", () => {
	it("returns 401 when tokenPayload is not set", async () => {
		const app = createAdminTestApp();
		app.use("/admin/*", adminMiddleware());
		app.get("/admin/test", (c) => c.json({ success: true }));

		const response = await app.request("/admin/test", { method: "GET" });

		expect(response.status).toBe(401);
		const body = await response.json<{ success: boolean; error: string }>();
		expect(body.success).toBe(false);
		expect(body.error).toBe("Unauthorized");
	});

	it("returns 403 when user role is not admin", async () => {
		const app = createAdminTestApp();
		app.use("/admin/*", async (c, next) => {
			c.set("tokenPayload", {
				sub: "user-123",
				email: "user@example.com",
				role: "user",
			});
			return next();
		});
		app.use("/admin/*", adminMiddleware());
		app.get("/admin/test", (c) => c.json({ success: true }));

		const response = await app.request("/admin/test", { method: "GET" });

		expect(response.status).toBe(403);
		const body = await response.json<{ success: boolean; error: string }>();
		expect(body.success).toBe(false);
		expect(body.error).toBe("Admin access required");
	});

	it("returns 403 when role is visitor", async () => {
		const app = createAdminTestApp();
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

		const response = await app.request("/admin/test", { method: "GET" });

		expect(response.status).toBe(403);
	});

	it("returns 403 when role is undefined", async () => {
		const app = createAdminTestApp();
		app.use("/admin/*", async (c, next) => {
			c.set("tokenPayload", {
				sub: "user-123",
				email: "user@example.com",
			});
			return next();
		});
		app.use("/admin/*", adminMiddleware());
		app.get("/admin/test", (c) => c.json({ success: true }));

		const response = await app.request("/admin/test", { method: "GET" });

		expect(response.status).toBe(403);
	});

	it("allows request when user has admin role", async () => {
		const app = createAdminTestApp();
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

		const response = await app.request("/admin/test", { method: "GET" });

		expect(response.status).toBe(200);
		const body = await response.json<{ success: boolean; user: string }>();
		expect(body.success).toBe(true);
		expect(body.user).toBe("admin");
	});

	it("works when tokenPayload is set like authMiddleware in test env", async () => {
		const app = createAdminTestApp();
		app.use("/admin/*", async (c, next) => {
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

		const response = await app.request("/admin/test", { method: "GET" });

		expect(response.status).toBe(200);
		const body = await response.json<{ success: boolean; role: string }>();
		expect(body.success).toBe(true);
		expect(body.role).toBe("admin");
	});
});
