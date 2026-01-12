/**
 * Subscription middleware for checking usage limits and feature access
 */

import type { Context, MiddlewareHandler } from "hono";
import {
	SubscriptionClient,
	type UsageMetric,
	type Feature,
	type UsageCheckResult,
} from "./subscription-client";

/**
 * Middleware variables with subscription info
 */
export interface SubscriptionVariables {
	organization?: { id: string; name: string; slug: string };
	usageInfo?: UsageCheckResult;
}

/**
 * Middleware that checks usage limits before allowing an action
 *
 * @param metric - The usage metric to check (alerts)
 *
 * @example
 * ```typescript
 * // Add to route that creates alerts
 * router.post("/search", authMiddleware(), requireUsageQuota("alerts"), async (c) => {
 *   // If we get here, the org has quota available
 *   const usageInfo = c.get("usageInfo");
 *   console.log(`Using ${usageInfo.used + 1}/${usageInfo.included}`);
 * });
 * ```
 */
export function requireUsageQuota(metric: UsageMetric): MiddlewareHandler<{
	Bindings: Cloudflare.Env;
	Variables: SubscriptionVariables;
}> {
	return async (c, next) => {
		const organization = c.get("organization");

		if (!organization) {
			return c.json(
				{
					success: false,
					error: "Organization Required",
					code: "ORGANIZATION_REQUIRED",
					message: "An active organization must be selected",
				},
				409,
			);
		}

		const client = new SubscriptionClient(c.env);
		const result = await client.checkUsage(organization.id, metric);

		// If we can't check (service unavailable), allow the action
		// This provides graceful degradation
		if (!result) {
			return next();
		}

		// For now, we always allow actions but track usage
		// The overage will be billed via Stripe metered billing
		c.set("usageInfo", result);

		// Add usage info to response headers
		c.header("X-Usage-Used", result.used.toString());
		c.header(
			"X-Usage-Included",
			result.included === -1 ? "unlimited" : result.included.toString(),
		);
		c.header("X-Usage-Overage", result.overage.toString());
		c.header("X-Plan-Tier", result.planTier);

		return next();
	};
}

/**
 * Middleware that checks feature access
 *
 * @param feature - The feature to check
 *
 * @example
 * ```typescript
 * // Require advanced roles feature
 * router.post("/roles/advanced", authMiddleware(), requireFeature("advanced_roles"), async (c) => {
 *   // Only accessible if org has this feature
 * });
 * ```
 */
export function requireFeature(feature: Feature): MiddlewareHandler<{
	Bindings: Cloudflare.Env;
	Variables: SubscriptionVariables;
}> {
	return async (c, next) => {
		const organization = c.get("organization");

		if (!organization) {
			return c.json(
				{
					success: false,
					error: "Organization Required",
					code: "ORGANIZATION_REQUIRED",
					message: "An active organization must be selected",
				},
				409,
			);
		}

		const client = new SubscriptionClient(c.env);
		const result = await client.hasFeature(organization.id, feature);

		// If we can't check (service unavailable), allow the action
		if (!result) {
			return next();
		}

		if (!result.allowed) {
			return c.json(
				{
					success: false,
					error: "Feature Not Available",
					code: "FEATURE_REQUIRED",
					message: `This feature requires ${result.requiredTier || "a higher"} plan.`,
					requiredTier: result.requiredTier,
					currentTier: result.planTier,
				},
				403,
			);
		}

		return next();
	};
}

/**
 * Middleware that requires an active subscription (allows free tier)
 *
 * @example
 * ```typescript
 * // Require active subscription for all routes
 * router.use("*", authMiddleware(), requireSubscription());
 * ```
 */
export function requireSubscription(): MiddlewareHandler<{
	Bindings: Cloudflare.Env;
	Variables: SubscriptionVariables;
}> {
	return async (c, next) => {
		const organization = c.get("organization");

		if (!organization) {
			return c.json(
				{
					success: false,
					error: "Organization Required",
					code: "ORGANIZATION_REQUIRED",
					message: "An active organization must be selected",
				},
				409,
			);
		}

		const client = new SubscriptionClient(c.env);
		const status = await client.getSubscriptionStatus(organization.id);

		// If we can't check (service unavailable), allow the action
		if (!status) {
			return next();
		}

		// Allow free tier (hasSubscription might be false but they have a customer)
		// Only block if planTier is "none"
		if (status.planTier === "none" && !status.hasSubscription) {
			return c.json(
				{
					success: false,
					error: "Subscription Required",
					code: "SUBSCRIPTION_REQUIRED",
					message:
						"An active subscription is required to use this feature. Please subscribe to continue.",
				},
				402, // Payment Required
			);
		}

		return next();
	};
}

/**
 * Helper to get usage info from context
 */
export function getUsageInfo(
	c: Context<{ Variables: Partial<SubscriptionVariables> }>,
): UsageCheckResult | null {
	return c.get("usageInfo") ?? null;
}
