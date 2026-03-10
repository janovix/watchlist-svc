/**
 * Usage Rights client via auth-svc service binding
 *
 * Provides gate-and-meter, check, and meter operations via the
 * /internal/usage-rights/* endpoints on auth-svc.
 *
 * Uses Cloudflare service bindings -- no auth headers needed.
 */

/**
 * Usage metrics that can be gated and metered
 */
export type UsageMetric =
	| "reports"
	| "notices"
	| "alerts"
	| "operations"
	| "clients"
	| "users"
	| "watchlistQueries"
	| "organizations";

/**
 * Entitlement types
 */
export type EntitlementType = "license" | "stripe" | "none";

/**
 * Result of a gate-and-meter or check operation
 */
export interface GateResult {
	allowed: boolean;
	metric?: UsageMetric;
	used?: number;
	limit?: number;
	remaining?: number;
	entitlementType?: EntitlementType;
	error?: string;
	upgradeRequired?: boolean;
}

/**
 * Minimal fetch interface for auth-svc service binding
 */
interface AuthSvcFetcher {
	fetch(request: Request | string, init?: RequestInit): Promise<Response>;
}

/**
 * Environment bindings needed for usage rights
 */
interface UsageRightsEnv {
	AUTH_SERVICE?: AuthSvcFetcher;
}

const AUTH_SVC_BASE = "http://auth-service";

/**
 * Usage Rights client for auth-svc communication
 */
export class UsageRightsClient {
	constructor(private env: UsageRightsEnv) {}

	/**
	 * Gate-and-meter: check if action is allowed + increment meter atomically.
	 * Returns allowed=true if permitted, allowed=false with 403 details if not.
	 *
	 * Fail-open: if the AUTH_SERVICE binding is unavailable, allows the action.
	 */
	async gate(
		orgId: string,
		metric: UsageMetric,
		count: number = 1,
	): Promise<GateResult> {
		const authService = this.env.AUTH_SERVICE;
		if (!authService) {
			console.warn(
				"AUTH_SERVICE binding not available, allowing action (fail-open)",
			);
			return { allowed: true };
		}

		try {
			const response = await authService.fetch(
				new Request(`${AUTH_SVC_BASE}/internal/usage-rights/gate`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ organizationId: orgId, metric, count }),
				}),
			);

			const data = (await response.json()) as GateResult;
			if (response.status === 403) {
				return { ...data, allowed: false };
			}
			return data;
		} catch (error) {
			console.error("[UsageRights] Error calling gate:", error);
			return { allowed: true }; // Fail-open
		}
	}

	/**
	 * Meter-only: increment counter without gate check.
	 * Fire-and-forget style -- errors are logged but don't fail the request.
	 */
	async meter(
		orgId: string,
		metric: UsageMetric,
		count: number = 1,
	): Promise<void> {
		const authService = this.env.AUTH_SERVICE;
		if (!authService) return;

		try {
			await authService.fetch(
				new Request(`${AUTH_SVC_BASE}/internal/usage-rights/meter`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ organizationId: orgId, metric, count }),
				}),
			);
		} catch (error) {
			console.error("[UsageRights] Error calling meter:", error);
		}
	}

	/**
	 * Check-only: pre-flight check without incrementing meter.
	 */
	async check(orgId: string, metric: UsageMetric): Promise<GateResult | null> {
		const authService = this.env.AUTH_SERVICE;
		if (!authService) return null;

		try {
			const url = new URL(`${AUTH_SVC_BASE}/internal/usage-rights/check`);
			url.searchParams.set("organizationId", orgId);
			url.searchParams.set("metric", metric);

			const response = await authService.fetch(new Request(url.toString()));
			const data = (await response.json()) as GateResult;

			if (response.status === 403) {
				return { ...data, allowed: false };
			}
			return data;
		} catch (error) {
			console.error("[UsageRights] Error calling check:", error);
			return null;
		}
	}
}

/**
 * Create a UsageRightsClient instance
 */
export function createUsageRightsClient(
	env: UsageRightsEnv,
): UsageRightsClient {
	return new UsageRightsClient(env);
}
