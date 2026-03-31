import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { ApiException } from "chanfana";
import { generateKeyPair, exportJWK, SignJWT, type JSONWebKeySet } from "jose";

import {
	authMiddleware,
	clearJWKSCache,
	type AuthEnv,
	type AuthUser,
	type AuthTokenPayload,
} from "../../src/middleware/auth";

type KeyPairResult = Awaited<ReturnType<typeof generateKeyPair>>;

/** Per-request env: override pool default `ENVIRONMENT=test` so JWT path runs. */
type TestBindings = AuthEnv & { ENVIRONMENT?: string };

type TestVariables = {
	user?: AuthUser;
	token?: string;
	tokenPayload?: AuthTokenPayload;
	organization?: { id: string } | null;
};

async function generateTestKeyPair(): Promise<KeyPairResult> {
	return generateKeyPair("ES256", { extractable: true });
}

async function publicKeyToJWK(publicKey: KeyPairResult["publicKey"]) {
	const jwk = await exportJWK(publicKey);
	return {
		...jwk,
		kid: "test-key-id",
		use: "sig",
		alg: "ES256",
	};
}

async function createTestJWT(
	privateKey: KeyPairResult["privateKey"],
	payload: Record<string, unknown>,
	options?: { expiresIn?: string },
) {
	const builder = new SignJWT(payload)
		.setProtectedHeader({ alg: "ES256", kid: "test-key-id" })
		.setIssuedAt()
		.setSubject(payload.sub as string);

	if (options?.expiresIn) {
		builder.setExpirationTime(options.expiresIn);
	} else {
		builder.setExpirationTime("1h");
	}

	return builder.sign(privateKey);
}

function productionEnv(
	mockAuth: TestBindings["AUTH_SERVICE"],
	extra?: Partial<TestBindings>,
): TestBindings {
	return {
		ENVIRONMENT: "production",
		AUTH_SERVICE: mockAuth,
		...extra,
	};
}

function attachApiExceptionHandler(
	app: Hono<{ Bindings: TestBindings; Variables: TestVariables }>,
) {
	app.onError((err, c) => {
		if (err instanceof ApiException) {
			return c.json(
				{ success: false, error: err.message },
				err.status as 401 | 403 | 500 | 503,
			);
		}
		return c.json({ success: false, error: "Internal error" }, 500);
	});
}

describe("Auth Middleware", () => {
	let testKeyPair: KeyPairResult;
	let testJWKS: JSONWebKeySet;
	let mockAuthService: { getJwks: () => Promise<JSONWebKeySet> };

	beforeEach(async () => {
		clearJWKSCache();
		testKeyPair = await generateTestKeyPair();
		const publicJWK = await publicKeyToJWK(testKeyPair.publicKey);
		testJWKS = { keys: [publicJWK] };
		mockAuthService = {
			getJwks: vi.fn().mockResolvedValue(testJWKS),
		};
	});

	afterEach(() => {
		clearJWKSCache();
	});

	function createTestApp(options?: { optional?: boolean }) {
		const app = new Hono<{
			Bindings: TestBindings;
			Variables: TestVariables;
		}>();
		app.use("*", authMiddleware(options));
		app.get("/protected", (c) =>
			c.json({
				user: c.get("user"),
				organization: c.get("organization"),
			}),
		);
		attachApiExceptionHandler(app);
		return app;
	}

	describe("test environment bypass", () => {
		it("skips JWT and injects mock user when ENVIRONMENT=test", async () => {
			const app = createTestApp();
			const res = await app.request(
				"/protected",
				{ headers: { Authorization: "Bearer any" } },
				{
					ENVIRONMENT: "test",
					AUTH_SERVICE: mockAuthService,
				} as TestBindings,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { user: { id: string } };
			expect(body.user.id).toBe("test-user-id");
		});

		it("skips JWT without a token when ENVIRONMENT=test", async () => {
			const app = createTestApp();
			const res = await app.request("/protected", {}, {
				ENVIRONMENT: "test",
				AUTH_SERVICE: mockAuthService,
			} as TestBindings);
			expect(res.status).toBe(200);
		});
	});

	describe("token extraction", () => {
		it("returns 401 when no Authorization header", async () => {
			const app = createTestApp();
			const res = await app.request(
				"/protected",
				{},
				productionEnv(mockAuthService),
			);
			expect(res.status).toBe(401);
			const body = (await res.json()) as { error: string };
			expect(body.error).toBe("Unauthorized");
		});

		it("returns 401 for malformed Authorization header", async () => {
			const app = createTestApp();
			const res = await app.request(
				"/protected",
				{ headers: { Authorization: "InvalidFormat" } },
				productionEnv(mockAuthService),
			);
			expect(res.status).toBe(401);
		});

		it("returns 401 for non-Bearer token type", async () => {
			const app = createTestApp();
			const res = await app.request(
				"/protected",
				{ headers: { Authorization: "Basic dXNlcjpwYXNz" } },
				productionEnv(mockAuthService),
			);
			expect(res.status).toBe(401);
		});
	});

	describe("token verification", () => {
		it("allows requests with valid JWT", async () => {
			const app = createTestApp();
			const token = await createTestJWT(testKeyPair.privateKey, {
				sub: "user-123",
				email: "test@example.com",
				name: "Test User",
			});

			const res = await app.request(
				"/protected",
				{ headers: { Authorization: `Bearer ${token}` } },
				productionEnv(mockAuthService),
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				user: { id: string; email?: string; name?: string };
				organization: null;
			};
			expect(body.user).toEqual({
				id: "user-123",
				email: "test@example.com",
				name: "Test User",
			});
			expect(body.organization).toBeNull();
		});

		it("sets organization when organizationId is in JWT", async () => {
			const app = createTestApp();
			const token = await createTestJWT(testKeyPair.privateKey, {
				sub: "user-123",
				organizationId: "org-1",
			});

			const res = await app.request(
				"/protected",
				{ headers: { Authorization: `Bearer ${token}` } },
				productionEnv(mockAuthService),
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				organization: { id: string } | null;
			};
			expect(body.organization).toEqual({ id: "org-1" });
		});

		it("returns 401 for expired JWT", async () => {
			const app = createTestApp();
			const token = await createTestJWT(
				testKeyPair.privateKey,
				{ sub: "user-123" },
				{ expiresIn: "-1h" },
			);

			const res = await app.request(
				"/protected",
				{ headers: { Authorization: `Bearer ${token}` } },
				productionEnv(mockAuthService),
			);

			expect(res.status).toBe(401);
			const body = (await res.json()) as { error: string };
			expect(body.error).toMatch(/expired/i);
		});

		it("returns 401 for JWT signed with wrong key", async () => {
			const app = createTestApp();
			const wrongKeyPair = await generateTestKeyPair();
			const token = await createTestJWT(wrongKeyPair.privateKey, {
				sub: "user-123",
			});

			const res = await app.request(
				"/protected",
				{ headers: { Authorization: `Bearer ${token}` } },
				productionEnv(mockAuthService),
			);

			expect(res.status).toBe(401);
			const body = (await res.json()) as { error: string };
			expect(body.error).toMatch(/signature/i);
		});

		it("returns 401 for malformed JWT", async () => {
			const app = createTestApp();
			const res = await app.request(
				"/protected",
				{ headers: { Authorization: "Bearer not.a.valid.jwt" } },
				productionEnv(mockAuthService),
			);
			expect(res.status).toBe(401);
		});
	});

	describe("optional authentication", () => {
		it("allows unauthenticated requests when optional=true", async () => {
			const app = createTestApp({ optional: true });
			app.get("/optional", (c) =>
				c.json({
					authenticated: !!c.get("user"),
					user: c.get("user") ?? null,
				}),
			);

			const res = await app.request(
				"/optional",
				{},
				productionEnv(mockAuthService),
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				authenticated: boolean;
				user: unknown;
			};
			expect(body.authenticated).toBe(false);
			expect(body.user).toBeNull();
		});

		it("still validates token when optional=true and token provided", async () => {
			const app = createTestApp({ optional: true });
			const token = await createTestJWT(testKeyPair.privateKey, {
				sub: "user-123",
			});

			const res = await app.request(
				"/protected",
				{ headers: { Authorization: `Bearer ${token}` } },
				productionEnv(mockAuthService),
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as { user: { id: string } };
			expect(body.user.id).toBe("user-123");
		});
	});

	describe("JWKS fetching", () => {
		it("fetches JWKS from auth service via RPC", async () => {
			const app = createTestApp();
			const token = await createTestJWT(testKeyPair.privateKey, {
				sub: "user-123",
			});

			await app.request(
				"/protected",
				{ headers: { Authorization: `Bearer ${token}` } },
				productionEnv(mockAuthService),
			);

			expect(mockAuthService.getJwks).toHaveBeenCalledTimes(1);
		});

		it("caches JWKS in memory", async () => {
			const app = createTestApp();
			const token = await createTestJWT(testKeyPair.privateKey, {
				sub: "user-123",
			});

			await app.request(
				"/protected",
				{ headers: { Authorization: `Bearer ${token}` } },
				productionEnv(mockAuthService),
			);
			await app.request(
				"/protected",
				{ headers: { Authorization: `Bearer ${token}` } },
				productionEnv(mockAuthService),
			);

			expect(mockAuthService.getJwks).toHaveBeenCalledTimes(1);
		});

		it("returns 503 when JWKS RPC call fails", async () => {
			const failingAuthService = {
				getJwks: vi.fn().mockRejectedValue(new Error("Service Unavailable")),
			};

			const app = createTestApp();
			const token = await createTestJWT(testKeyPair.privateKey, {
				sub: "user-123",
			});

			const res = await app.request(
				"/protected",
				{ headers: { Authorization: `Bearer ${token}` } },
				productionEnv(
					failingAuthService as unknown as TestBindings["AUTH_SERVICE"],
				),
			);

			expect(res.status).toBe(503);
			const body = (await res.json()) as { error: string };
			expect(body.error).toMatch(/unavailable|temporarily/i);
		});

		it("returns 503 when JWKS has no keys", async () => {
			const emptyJwksService = {
				getJwks: vi.fn().mockResolvedValue({ keys: [] }),
			};
			const app = createTestApp();
			const token = await createTestJWT(testKeyPair.privateKey, {
				sub: "user-123",
			});

			const res = await app.request(
				"/protected",
				{ headers: { Authorization: `Bearer ${token}` } },
				productionEnv(
					emptyJwksService as unknown as TestBindings["AUTH_SERVICE"],
				),
			);

			expect(res.status).toBe(503);
		});
	});

	describe("configuration", () => {
		it("returns 500 when AUTH_SERVICE binding is not configured", async () => {
			const app = createTestApp();
			const token = await createTestJWT(testKeyPair.privateKey, {
				sub: "user-123",
			});

			const res = await app.request(
				"/protected",
				{ headers: { Authorization: `Bearer ${token}` } },
				{
					ENVIRONMENT: "production",
					AUTH_SERVICE: undefined as unknown as TestBindings["AUTH_SERVICE"],
				},
			);

			expect(res.status).toBe(500);
			const body = (await res.json()) as { error: string };
			expect(body.error).toMatch(/not configured|Authentication service/i);
		});

		it("respects AUTH_JWKS_CACHE_TTL when set", async () => {
			const app = createTestApp();
			const token = await createTestJWT(testKeyPair.privateKey, {
				sub: "user-123",
			});

			const res = await app.request(
				"/protected",
				{ headers: { Authorization: `Bearer ${token}` } },
				productionEnv(mockAuthService, { AUTH_JWKS_CACHE_TTL: "60" }),
			);

			expect(res.status).toBe(200);
		});
	});
});
