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
