/**
 * Auth Settings integration via service binding
 *
 * This module provides helpers for fetching user settings from auth-svc
 * via Cloudflare service binding.
 */

import type { Bindings } from "../index";

/**
 * Theme options
 */
export type Theme = "light" | "dark" | "system";

/**
 * Language codes
 */
export type LanguageCode = "en" | "es";

/**
 * Date format options
 */
export type DateFormat =
	| "MM/DD/YYYY"
	| "DD/MM/YYYY"
	| "YYYY-MM-DD"
	| "DD.MM.YYYY";

/**
 * Resolved settings from auth-svc
 */
export interface ResolvedSettings {
	theme: Theme;
	timezone: string;
	language: LanguageCode;
	dateFormat: DateFormat;
	avatarUrl: string | null;
	paymentMethods: Array<{
		id: string;
		type: "card" | "bank_account" | "paypal";
		label: string;
		last4?: string;
		isDefault?: boolean;
	}>;
	sources: {
		theme: "user" | "organization" | "browser" | "default";
		timezone: "user" | "organization" | "browser" | "default";
		language: "user" | "organization" | "browser" | "default";
		dateFormat: "user" | "organization" | "default";
	};
}

/**
 * Browser hints to pass to auth-svc for smart defaults
 */
export interface BrowserHints {
	"accept-language"?: string;
	"x-timezone"?: string;
	"x-preferred-theme"?: Theme;
}

/**
 * Encode browser hints as base64 for query param
 */
function encodeBrowserHints(hints: BrowserHints): string {
	return btoa(JSON.stringify(hints));
}

/**
 * Fetch resolved user settings from auth-svc via service binding
 *
 * @param env - Worker environment bindings
 * @param userId - User ID to get settings for
 * @param orgId - Optional organization ID for org defaults
 * @param browserHints - Optional browser hints for smart defaults
 * @returns Resolved settings or null if fetch fails
 *
 * @example
 * ```typescript
 * // In a route handler
 * const settings = await getResolvedSettings(c.env, user.id, org?.id, {
 *   "accept-language": c.req.header("Accept-Language"),
 *   "x-timezone": c.req.header("X-Timezone"),
 * });
 *
 * // Use settings for formatting
 * const formattedDate = formatDate(date, settings?.dateFormat ?? "YYYY-MM-DD");
 * ```
 */
export async function getResolvedSettings(
	env: Bindings,
	userId: string,
	orgId?: string,
	browserHints?: BrowserHints,
): Promise<ResolvedSettings | null> {
	const authService = env.AUTH_SERVICE;
	if (!authService) {
		console.warn("AUTH_SERVICE binding not available");
		return null;
	}

	try {
		const params = new URLSearchParams();
		params.set("userId", userId);
		if (orgId) {
			params.set("orgId", orgId);
		}
		if (browserHints) {
			params.set("headers", encodeBrowserHints(browserHints));
		}

		const response = await authService.fetch(
			new Request(
				`https://auth-svc.internal/internal/settings/resolved?${params}`,
				{
					headers: { Accept: "application/json" },
				},
			),
		);

		if (!response.ok) {
			console.error(
				`Failed to fetch settings: ${response.status} ${response.statusText}`,
			);
			return null;
		}

		const result = (await response.json()) as {
			success: boolean;
			data: ResolvedSettings;
		};

		return result.success ? result.data : null;
	} catch (error) {
		console.error("Error fetching settings from auth-svc:", error);
		return null;
	}
}

/**
 * Get default settings when auth-svc is unavailable
 */
export function getDefaultSettings(): ResolvedSettings {
	return {
		theme: "system",
		timezone: "UTC",
		language: "en",
		dateFormat: "YYYY-MM-DD",
		avatarUrl: null,
		paymentMethods: [],
		sources: {
			theme: "default",
			timezone: "default",
			language: "default",
			dateFormat: "default",
		},
	};
}

/**
 * Extract browser hints from request headers
 */
export function extractBrowserHints(headers: Headers): BrowserHints {
	return {
		"accept-language": headers.get("Accept-Language") ?? undefined,
		"x-timezone": headers.get("X-Timezone") ?? undefined,
		"x-preferred-theme":
			(headers.get("X-Preferred-Theme") as Theme) ?? undefined,
	};
}

/**
 * Get settings with fallback to defaults
 * Convenience wrapper that always returns settings
 */
export async function getSettingsWithFallback(
	env: Bindings,
	userId: string,
	orgId?: string,
	browserHints?: BrowserHints,
): Promise<ResolvedSettings> {
	const settings = await getResolvedSettings(env, userId, orgId, browserHints);
	return settings ?? getDefaultSettings();
}
