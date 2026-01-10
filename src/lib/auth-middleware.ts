import { ApiException } from "chanfana";
import type { MiddlewareHandler } from "hono";
import * as jose from "jose";

import type { AppContext } from "../types";

/**
 * JWT payload structure from Better Auth
 */
export interface AuthTokenPayload {
	/** Subject - User ID */
	sub: string;
	/** Issuer - Auth service URL */
	iss?: string;
	/** Audience */
	aud?: string | string[];
	/** Expiration time (Unix timestamp) */
	exp?: number;
	/** Issued at (Unix timestamp) */
	iat?: number;
	/** JWT ID */
	jti?: string;
	/** User email (if included in token) */
	email?: string;
	/** User name (if included in token) */
	name?: string;
}

/**
 * Authenticated user context attached to requests
 */
export interface AuthUser {
	id: string;
	email?: string;
	name?: string;
}

/**
 * Extended environment bindings with auth context
 */
export interface AuthEnv {
	/** Service binding to auth-svc for direct worker-to-worker communication */
	AUTH_SERVICE: Fetcher;
	/** Base URL for auth-svc (used to construct JWKS endpoint URL, optional) */
	AUTH_SERVICE_URL?: string;
	AUTH_JWKS_CACHE_TTL?: string;
}

const DEFAULT_JWKS_CACHE_TTL = 3600; // 1 hour in seconds

/**
 * In-memory JWKS cache for the worker instance
 * This avoids fetching JWKS on every request within the same worker instance
 */
let cachedJWKS: jose.JSONWebKeySet | null = null;
let cachedJWKSExpiry: number = 0;

/**
 * Fetches JWKS from auth-svc with in-memory caching
 * Uses service binding for direct worker-to-worker communication
 */
async function getJWKS(
	cacheTtl: number,
	authServiceBinding: Fetcher,
	authServiceUrl?: string,
): Promise<jose.JSONWebKeySet> {
	const now = Date.now();

	// Check in-memory cache
	if (cachedJWKS && cachedJWKSExpiry > now) {
		return cachedJWKS;
	}

	// Construct JWKS URL - use provided URL or default format
	// When using service binding, the hostname doesn't affect routing but is used for Host header
	const jwksUrl = authServiceUrl
		? `${authServiceUrl}/api/auth/jwks`
		: "https://auth-svc.janovix.workers.dev/api/auth/jwks";

	// Use service binding for direct worker-to-worker communication
	// The hostname in the URL is used for the Host header but routing is handled by the binding
	const response = await authServiceBinding.fetch(
		new Request(jwksUrl, {
			headers: { Accept: "application/json" },
		}),
	);

	if (!response.ok) {
		throw new Error(
			`Failed to fetch JWKS from service binding: ${response.status} ${response.statusText}`,
		);
	}

	const jwks = (await response.json()) as jose.JSONWebKeySet;

	// Validate JWKS structure
	if (!jwks.keys || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
		throw new Error("Invalid JWKS: no keys found");
	}

	// Update in-memory cache
	cachedJWKS = jwks;
	cachedJWKSExpiry = now + cacheTtl * 1000;

	return jwks;
}

/**
 * Verifies a JWT using JWKS from auth-svc
 */
async function verifyToken(
	token: string,
	cacheTtl: number,
	authServiceBinding: Fetcher,
	authServiceUrl?: string,
): Promise<AuthTokenPayload> {
	const jwks = await getJWKS(cacheTtl, authServiceBinding, authServiceUrl);

	// Create a local JWKS for verification
	const jwksInstance = jose.createLocalJWKSet(jwks);

	// Verify the token
	const { payload } = await jose.jwtVerify(token, jwksInstance);

	// Validate required claims
	if (!payload.sub) {
		throw new Error("Token missing required 'sub' claim");
	}

	return payload as AuthTokenPayload;
}

/**
 * Extracts Bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | undefined): string | null {
	if (!authHeader) {
		return null;
	}

	const parts = authHeader.split(" ");
	if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
		return null;
	}

	return parts[1];
}

/**
 * Creates an authentication middleware that verifies JWTs signed by auth-svc
 * Throws ApiException on authentication failure (compatible with chanfana)
 *
 * @param options - Configuration options
 * @param options.optional - If true, allows unauthenticated requests to pass through
 * @returns Hono middleware handler
 *
 * @example
 * // Require authentication for all routes
 * app.use("*", authMiddleware());
 *
 * // Optional authentication (user info available if token present)
 * app.use("*", authMiddleware({ optional: true }));
 */
export function authMiddleware(options?: {
	optional?: boolean;
}): MiddlewareHandler<{
	Bindings: AuthEnv & { ENVIRONMENT?: string };
	Variables: {
		user?: AuthUser;
		token?: string;
		tokenPayload?: AuthTokenPayload;
	};
}> {
	const { optional = false } = options ?? {};

	return async (c, next) => {
		// Skip authentication in test environment
		if (c.env.ENVIRONMENT === "test") {
			// Set a mock user for tests
			c.set("user", { id: "test-user-id", email: "test@example.com" });
			return next();
		}

		const authHeader = c.req.header("Authorization");
		const token = extractBearerToken(authHeader);

		// No token provided
		if (!token) {
			if (optional) {
				return next();
			}
			const error = new ApiException("Unauthorized");
			error.status = 401;
			error.code = 401;
			throw error;
		}

		// Get the service binding for direct worker-to-worker communication
		const authServiceBinding = c.env.AUTH_SERVICE;
		// AUTH_SERVICE_URL is optional - used to construct the JWKS endpoint URL
		const authServiceUrl = c.env.AUTH_SERVICE_URL;

		// Validate that service binding is configured
		if (!authServiceBinding) {
			console.error("AUTH_SERVICE binding is not configured");
			const error = new ApiException("Authentication service not configured");
			error.status = 500;
			error.code = 500;
			throw error;
		}

		const cacheTtl = c.env.AUTH_JWKS_CACHE_TTL
			? parseInt(c.env.AUTH_JWKS_CACHE_TTL, 10)
			: DEFAULT_JWKS_CACHE_TTL;

		try {
			const payload = await verifyToken(
				token,
				cacheTtl,
				authServiceBinding,
				authServiceUrl,
			);

			// Attach user info to context
			const user: AuthUser = {
				id: payload.sub,
				email: payload.email,
				name: payload.name,
			};

			c.set("user", user);
			c.set("token", token);
			c.set("tokenPayload", payload);

			return next();
		} catch (error) {
			// Handle specific JWT errors
			if (error instanceof jose.errors.JWTExpired) {
				const apiError = new ApiException(
					"The authentication token has expired",
				);
				apiError.status = 401;
				apiError.code = 401;
				throw apiError;
			}

			if (error instanceof jose.errors.JWTClaimValidationFailed) {
				const apiError = new ApiException("Token validation failed");
				apiError.status = 401;
				apiError.code = 401;
				throw apiError;
			}

			if (
				error instanceof jose.errors.JWSSignatureVerificationFailed ||
				error instanceof jose.errors.JWSInvalid
			) {
				const apiError = new ApiException(
					"Token signature verification failed",
				);
				apiError.status = 401;
				apiError.code = 401;
				throw apiError;
			}

			// Log unexpected errors
			console.error("Auth middleware error:", error);

			// For JWKS fetch errors, return 503
			if (
				error instanceof Error &&
				error.message.includes("Failed to fetch JWKS")
			) {
				const apiError = new ApiException(
					"Authentication service temporarily unavailable",
				);
				apiError.status = 503;
				apiError.code = 503;
				throw apiError;
			}

			// Generic auth error
			const apiError = new ApiException("Invalid authentication token");
			apiError.status = 401;
			apiError.code = 401;
			throw apiError;
		}
	};
}

/**
 * Helper to get the authenticated user from context
 * Throws ApiException if user is not authenticated (compatible with chanfana)
 */
export function getAuthUser(
	c: AppContext & { get: (key: "user") => AuthUser | undefined },
): AuthUser {
	const user = c.get("user");
	if (!user) {
		const error = new ApiException("User not authenticated");
		error.status = 401;
		error.code = 401;
		throw error;
	}
	return user;
}

/**
 * Helper to get the authenticated user from context, or null if not authenticated
 */
export function getAuthUserOrNull(
	c: AppContext & { get: (key: "user") => AuthUser | undefined },
): AuthUser | null {
	return c.get("user") ?? null;
}

/**
 * Clears the in-memory JWKS cache
 * Useful for testing or when keys need to be refreshed immediately
 */
export function clearJWKSCache(): void {
	cachedJWKS = null;
	cachedJWKSExpiry = 0;
}
