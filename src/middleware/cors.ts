import { type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

/**
 * CORS middleware for cross-origin requests from frontend apps.
 * Uses TRUSTED_ORIGINS environment variable to configure allowed origins per environment.
 *
 * Supported patterns:
 * - Exact match: "https://aml.janovix.com"
 * - Wildcard subdomain: "*.janovix.workers.dev" (matches any subdomain)
 * - Localhost wildcard: "http://localhost:*" (matches any port)
 *
 * Examples:
 * - "*.janovix.com" matches: https://aml.janovix.com, https://auth.janovix.com
 * - "*.janovix.com" does NOT match: https://janovix.com (use explicit entry for root)
 * - "http://localhost:*" matches: http://localhost:3000, http://localhost:3001
 *
 * The TRUSTED_ORIGINS variable should be a comma-separated list of patterns:
 * Example: "*.janovix.com,https://janovix.com,http://localhost:*"
 */

/**
 * Check if an origin matches any of the allowed patterns.
 *
 * @param origin - The origin to check (e.g., "https://aml.janovix.com")
 * @param patterns - Array of allowed patterns
 * @returns true if the origin matches any pattern
 */
export function isOriginAllowed(origin: string, patterns: string[]): boolean {
	for (const pattern of patterns) {
		// Exact match
		if (pattern === origin) {
			return true;
		}

		// Wildcard subdomain match (*.domain.com)
		if (pattern.startsWith("*.")) {
			const domain = pattern.slice(1); // Remove * but keep the dot (e.g., ".janovix.com")
			if (origin.endsWith(domain)) {
				// Verify it's actually a subdomain with valid format
				// Extract the part before the domain (e.g., "https://aml" from "https://aml.janovix.com")
				const beforeDomain = origin.slice(0, -domain.length);
				// Must be a valid protocol + subdomain (alphanumeric and hyphens only)
				if (/^https?:\/\/[a-z0-9-]+$/i.test(beforeDomain)) {
					return true;
				}
			}
		}

		// Localhost wildcard port match (http://localhost:*)
		if (
			pattern === "http://localhost:*" &&
			origin.startsWith("http://localhost:")
		) {
			// Verify the port is numeric
			const port = origin.slice("http://localhost:".length);
			if (/^\d+$/.test(port)) {
				return true;
			}
		}
	}
	return false;
}

export function corsMiddleware(): MiddlewareHandler {
	return async (c, next) => {
		const trustedOriginsStr = c.env.TRUSTED_ORIGINS || "";

		// Parse comma-separated origins/patterns and trim whitespace
		const trustedPatterns = trustedOriginsStr
			.split(",")
			.map((pattern: string) => pattern.trim())
			.filter((pattern: string) => pattern.length > 0);

		// Apply CORS middleware with custom origin function for pattern matching
		const corsHandler = cors({
			origin: (origin) => {
				// If no origin header (same-origin request), allow
				if (!origin) {
					return null;
				}
				// If no trusted patterns are configured, deny all CORS requests
				// This is a security-first approach
				if (trustedPatterns.length === 0) {
					return null;
				}
				// Check if origin matches any pattern
				return isOriginAllowed(origin, trustedPatterns) ? origin : null;
			},
			allowHeaders: [
				"Content-Type",
				"Authorization",
				"X-Requested-With",
				"Accept",
			],
			allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
			exposeHeaders: ["Content-Length", "X-Request-Id"],
			maxAge: 600,
			credentials: true,
		});

		return corsHandler(c, next);
	};
}
