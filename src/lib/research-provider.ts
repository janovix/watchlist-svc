/**
 * Resolve PEP/adverse research backend (Gemini vs legacy Grok containers).
 */

import type { Bindings } from "../index";
import { WATCHLIST_FEATURE_FLAG_KEYS } from "./watchlist-feature-flags";
import type { FlagsSvcBinding } from "../types/flags-rpc";

export type ResearchProviderName = "gemini" | "grok";

function normalizeEnvProvider(raw: string | undefined): ResearchProviderName {
	const v = (raw ?? "gemini").trim().toLowerCase();
	return v === "grok" ? "grok" : "gemini";
}

/**
 * Flags override env when set to `gemini` or `grok`.
 */
export async function resolveResearchProvider(
	env: Bindings,
	organizationId: string,
): Promise<ResearchProviderName> {
	let resolved = normalizeEnvProvider(env.RESEARCH_PROVIDER);

	const flagsBinding = env.FLAGS_SERVICE as unknown as
		| FlagsSvcBinding
		| undefined;
	if (!flagsBinding?.evaluateFlag) {
		return resolved;
	}

	try {
		const v = await flagsBinding.evaluateFlag(
			WATCHLIST_FEATURE_FLAG_KEYS.researchProvider,
			{
				organizationId,
				environment: env.ENVIRONMENT ?? "production",
			},
		);
		if (v === "grok" || v === "gemini") {
			resolved = v;
		}
	} catch (e) {
		console.warn(
			"[research-provider] evaluateFlag failed; using env default",
			e,
		);
	}

	return resolved;
}

export async function resolveResearchShadowEnabled(
	env: Bindings,
	organizationId: string,
): Promise<boolean> {
	if (String(env.RESEARCH_SHADOW ?? "").toLowerCase() === "true") {
		return true;
	}

	const flagsBinding = env.FLAGS_SERVICE as unknown as
		| FlagsSvcBinding
		| undefined;
	if (!flagsBinding?.evaluateFlag) {
		return false;
	}

	try {
		const v = await flagsBinding.evaluateFlag(
			WATCHLIST_FEATURE_FLAG_KEYS.researchShadow,
			{
				organizationId,
				environment: env.ENVIRONMENT ?? "production",
			},
		);
		return v === true;
	} catch {
		return false;
	}
}

/** ~5% deterministic sample by query id (for log volume when shadow is enabled). */
export function researchShadowSample(searchId: string): boolean {
	const hex = searchId.replace(/-/g, "");
	const prefix = hex.slice(0, 2);
	if (prefix.length < 2) return false;
	const n = Number.parseInt(prefix, 16);
	return Number.isFinite(n) && n < 13;
}
