/**
 * Subscription client via auth-svc RPC service binding
 *
 * This module provides helpers for checking subscription status,
 * reporting usage, and verifying features via the `AuthSvcEntrypoint`
 * RPC binding on auth-svc.
 */

/**
 * Plan tiers
 */
export type PlanTier = "none" | "free" | "business" | "pro" | "enterprise";

/**
 * Usage metric types (watchlist uses alerts for target matches)
 */
export type UsageMetric = "alerts";

/**
 * Feature names
 */
export type Feature =
	| "data_capture"
	| "compliance_validation"
	| "report_generation"
	| "acknowledgment_tracking"
	| "advanced_roles"
	| "approval_flows"
	| "report_templates"
	| "priority_support"
	| "sso"
	| "custom_branding"
	| "audit_export"
	| "api_access"
	| "dedicated_support"
	| "custom_integrations";

/**
 * Usage check result
 */
export interface UsageCheckResult {
	allowed: boolean;
	used: number;
	included: number;
	remaining: number;
	overage: number;
	planTier: PlanTier;
}

/**
 * Feature check result
 */
export interface FeatureCheckResult {
	allowed: boolean;
	planTier: PlanTier;
	requiredTier?: PlanTier;
}

/**
 * Full subscription status
 */
export interface SubscriptionStatus {
	hasSubscription: boolean;
	isEnterprise: boolean;
	status:
		| "inactive"
		| "trialing"
		| "active"
		| "past_due"
		| "canceled"
		| "unpaid";
	planTier: PlanTier;
	planName: string | null;
	features: Feature[];
}

/**
 * Minimal RPC interface for auth-svc subscription methods
 */
interface AuthSvcSubscriptionRpc {
	getSubscriptionStatus(organizationId: string): Promise<{
		hasSubscription: boolean;
		isEnterprise: boolean;
		status: string | null;
		planTier: string | null;
		planName: string | null;
		features: string[];
	} | null>;
	reportSubscriptionUsage(
		organizationId: string,
		metric: string,
		count?: number,
	): Promise<void>;
	checkSubscriptionUsage(
		organizationId: string,
		metric: string,
	): Promise<{
		allowed: boolean;
		used: number;
		included: number;
		remaining: number;
		overage: number;
	} | null>;
	checkSubscriptionFeature(
		organizationId: string,
		feature: string,
	): Promise<{ allowed: boolean; planTier: string | null }>;
}

/**
 * Subscription client for auth-svc communication via RPC
 */
export class SubscriptionClient {
	private authService: AuthSvcSubscriptionRpc | undefined;

	constructor(env: { AUTH_SERVICE?: unknown }) {
		this.authService = env.AUTH_SERVICE as AuthSvcSubscriptionRpc | undefined;
	}

	/**
	 * Get full subscription status for an organization
	 */
	async getSubscriptionStatus(
		organizationId: string,
	): Promise<SubscriptionStatus | null> {
		if (!this.authService) {
			console.warn(
				"AUTH_SERVICE binding not available, skipping subscription check",
			);
			return null;
		}

		try {
			const data = await this.authService.getSubscriptionStatus(organizationId);
			if (!data) return null;

			return {
				hasSubscription: data.hasSubscription,
				isEnterprise: data.isEnterprise,
				status: (data.status ?? "inactive") as SubscriptionStatus["status"],
				planTier: (data.planTier ?? "none") as PlanTier,
				planName: data.planName,
				features: (data.features ?? []) as Feature[],
			};
		} catch (error) {
			console.error("Error getting subscription status:", error);
			return null;
		}
	}

	/**
	 * Report usage increment (call after finding matches in watchlists)
	 */
	async reportUsage(
		organizationId: string,
		metric: UsageMetric,
		count: number = 1,
	): Promise<UsageCheckResult | null> {
		if (!this.authService) {
			console.warn("AUTH_SERVICE binding not available, skipping usage report");
			return null;
		}

		try {
			await this.authService.reportSubscriptionUsage(
				organizationId,
				metric,
				count,
			);
			// reportSubscriptionUsage returns void; return a minimal allowed result
			return {
				allowed: true,
				used: 0,
				included: 0,
				remaining: 0,
				overage: 0,
				planTier: "none",
			};
		} catch (error) {
			console.error("Error reporting usage:", error);
			return null;
		}
	}

	/**
	 * Check if usage is allowed before performing action
	 */
	async checkUsage(
		organizationId: string,
		metric: UsageMetric | "users",
	): Promise<UsageCheckResult | null> {
		if (!this.authService) {
			console.warn("AUTH_SERVICE binding not available, allowing action");
			return null;
		}

		try {
			const data = await this.authService.checkSubscriptionUsage(
				organizationId,
				metric,
			);
			if (!data) return null;

			return {
				allowed: data.allowed,
				used: data.used,
				included: data.included,
				remaining: data.remaining,
				overage: data.overage,
				planTier: "none",
			};
		} catch (error) {
			console.error("Error checking usage:", error);
			return null;
		}
	}

	/**
	 * Check if organization has access to a feature
	 */
	async hasFeature(
		organizationId: string,
		feature: Feature,
	): Promise<FeatureCheckResult | null> {
		if (!this.authService) {
			console.warn("AUTH_SERVICE binding not available, allowing feature");
			return null;
		}

		try {
			const data = await this.authService.checkSubscriptionFeature(
				organizationId,
				feature,
			);
			return {
				allowed: data.allowed,
				planTier: (data.planTier ?? "none") as PlanTier,
			};
		} catch (error) {
			console.error("Error checking feature:", error);
			return null;
		}
	}
}

/**
 * Create a subscription client instance
 */
export function createSubscriptionClient(env: {
	AUTH_SERVICE?: unknown;
}): SubscriptionClient {
	return new SubscriptionClient(env);
}
