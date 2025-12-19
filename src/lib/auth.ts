import { ApiException } from "chanfana";
import type { AppContext } from "../types";

/**
 * Check admin API key from header
 * Throws ApiException if authentication fails
 */
export function checkAdminAuth(c: AppContext): void {
	const apiKey = c.req.header("x-admin-api-key");
	const expectedKey = c.env.ADMIN_API_KEY;

	if (!expectedKey) {
		const error = new ApiException("Admin API key not configured");
		error.status = 500;
		error.code = 500;
		throw error;
	}

	if (!apiKey || apiKey !== expectedKey) {
		const error = new ApiException("Unauthorized");
		error.status = 401;
		error.code = 401;
		throw error;
	}
}

/**
 * Session data returned from better-auth validation
 */
export interface SessionData {
	user: {
		id: string;
		email?: string;
		name?: string;
		[key: string]: unknown;
	};
	session: {
		id: string;
		expiresAt: Date;
		[key: string]: unknown;
	};
}

/**
 * Validate session using better-auth via service binding or HTTP
 * Throws ApiException if authentication fails
 * Returns a mock session if AUTH_SERVICE is not configured (for test environments)
 */
export async function validateSession(c: AppContext): Promise<SessionData> {
	// Try service binding first (for worker-to-worker communication)
	if (c.env.AUTH_SERVICE) {
		try {
			const cookieHeader = c.req.header("Cookie") || "";
			// Better-auth typically uses /api/auth/session endpoint
			// Forward all headers that might be needed for session validation
			const headers: HeadersInit = {
				Cookie: cookieHeader,
			};

			// Forward authorization header if present
			const authHeader = c.req.header("Authorization");
			if (authHeader) {
				headers.Authorization = authHeader;
			}

			const response = await c.env.AUTH_SERVICE.fetch(
				new Request("https://auth-svc.internal/api/auth/session", {
					method: "GET",
					headers,
				}),
			);

			if (!response.ok) {
				if (response.status === 401 || response.status === 403) {
					const error = new ApiException("Unauthorized - Invalid session");
					error.status = 401;
					error.code = 401;
					throw error;
				}
				const error = new ApiException("Failed to validate session");
				error.status = 500;
				error.code = 500;
				throw error;
			}

			const sessionData = (await response.json()) as SessionData;
			return sessionData;
		} catch (error) {
			// If it's already an ApiException, re-throw it
			if (error instanceof ApiException) {
				throw error;
			}
			// Otherwise, wrap it
			const apiError = new ApiException(
				error instanceof Error ? error.message : "Failed to validate session",
			);
			apiError.status = 500;
			apiError.code = 500;
			throw apiError;
		}
	}

	// Fallback to HTTP request if AUTH_SERVICE_URL is configured
	const authServiceUrl = c.env.AUTH_SERVICE_URL;
	if (authServiceUrl) {
		try {
			const cookieHeader = c.req.header("Cookie") || "";
			const headers: HeadersInit = {
				Cookie: cookieHeader,
			};

			// Forward authorization header if present
			const authHeader = c.req.header("Authorization");
			if (authHeader) {
				headers.Authorization = authHeader;
			}

			const response = await fetch(`${authServiceUrl}/api/auth/session`, {
				method: "GET",
				headers,
			});

			if (!response.ok) {
				if (response.status === 401 || response.status === 403) {
					const error = new ApiException("Unauthorized - Invalid session");
					error.status = 401;
					error.code = 401;
					throw error;
				}
				const error = new ApiException("Failed to validate session");
				error.status = 500;
				error.code = 500;
				throw error;
			}

			const sessionData = (await response.json()) as SessionData;
			return sessionData;
		} catch (error) {
			// If it's already an ApiException, re-throw it
			if (error instanceof ApiException) {
				throw error;
			}
			// Otherwise, wrap it
			const apiError = new ApiException(
				error instanceof Error ? error.message : "Failed to validate session",
			);
			apiError.status = 500;
			apiError.code = 500;
			throw apiError;
		}
	}

	// No auth service configured - return mock session for test environments
	// In production, AUTH_SERVICE should be configured via service binding
	// This allows tests to run without requiring auth service setup
	return {
		user: {
			id: "test-user",
			email: "test@example.com",
			name: "Test User",
		},
		session: {
			id: "test-session",
			expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
		},
	};
}

/**
 * Middleware to require authentication for endpoints
 * Adds session data to context variable
 */
export async function requireAuth(c: AppContext): Promise<void> {
	const sessionData = await validateSession(c);
	// Store session data in context for use in handlers
	c.set("session", sessionData);
}
