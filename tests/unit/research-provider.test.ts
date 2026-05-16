import { describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src";
import {
	researchShadowSample,
	resolveResearchProvider,
	resolveResearchShadowEnabled,
} from "../../src/lib/research-provider";
import { WATCHLIST_FEATURE_FLAG_KEYS } from "../../src/lib/watchlist-feature-flags";

function envWith(overrides: Partial<Bindings> = {}): Bindings {
	return {
		ENVIRONMENT: "test",
		...overrides,
	} as unknown as Bindings;
}

describe("research-provider", () => {
	it("normalizes env provider values", async () => {
		await expect(resolveResearchProvider(envWith(), "org-1")).resolves.toBe(
			"gemini",
		);
		await expect(
			resolveResearchProvider(envWith({ RESEARCH_PROVIDER: "grok" }), "org-1"),
		).resolves.toBe("grok");
		await expect(
			resolveResearchProvider(
				envWith({ RESEARCH_PROVIDER: "GEMINI" }),
				"org-1",
			),
		).resolves.toBe("gemini");
		await expect(
			resolveResearchProvider(
				envWith({ RESEARCH_PROVIDER: "unknown" }),
				"org-1",
			),
		).resolves.toBe("gemini");
	});

	it("lets flags override provider when valid and ignores invalid flag values", async () => {
		const evaluateFlag = vi
			.fn()
			.mockResolvedValueOnce("grok")
			.mockResolvedValueOnce("gemini")
			.mockResolvedValueOnce("other");
		const FLAGS_SERVICE = {
			evaluateFlag,
		} as unknown as Bindings["FLAGS_SERVICE"];

		await expect(
			resolveResearchProvider(envWith({ FLAGS_SERVICE }), "org-flag"),
		).resolves.toBe("grok");
		await expect(
			resolveResearchProvider(
				envWith({ RESEARCH_PROVIDER: "grok", FLAGS_SERVICE }),
				"org-flag",
			),
		).resolves.toBe("gemini");
		await expect(
			resolveResearchProvider(
				envWith({ RESEARCH_PROVIDER: "grok", FLAGS_SERVICE }),
				"org-flag",
			),
		).resolves.toBe("grok");

		expect(evaluateFlag).toHaveBeenCalledWith(
			WATCHLIST_FEATURE_FLAG_KEYS.researchProvider,
			{ organizationId: "org-flag", environment: "test" },
		);
	});

	it("falls back to env provider when flag evaluation throws", async () => {
		const FLAGS_SERVICE = {
			evaluateFlag: vi.fn(async () => {
				throw new Error("flag down");
			}),
		} as unknown as Bindings["FLAGS_SERVICE"];

		await expect(
			resolveResearchProvider(
				envWith({ RESEARCH_PROVIDER: "grok", FLAGS_SERVICE }),
				"org-1",
			),
		).resolves.toBe("grok");
	});

	it("resolves research shadow from env and flags", async () => {
		await expect(
			resolveResearchShadowEnabled(envWith({ RESEARCH_SHADOW: "true" }), "org"),
		).resolves.toBe(true);
		await expect(resolveResearchShadowEnabled(envWith(), "org")).resolves.toBe(
			false,
		);

		const evaluateFlag = vi
			.fn()
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false)
			.mockRejectedValueOnce(new Error("flag down"));
		const FLAGS_SERVICE = {
			evaluateFlag,
		} as unknown as Bindings["FLAGS_SERVICE"];

		await expect(
			resolveResearchShadowEnabled(envWith({ FLAGS_SERVICE }), "org-shadow"),
		).resolves.toBe(true);
		await expect(
			resolveResearchShadowEnabled(envWith({ FLAGS_SERVICE }), "org-shadow"),
		).resolves.toBe(false);
		await expect(
			resolveResearchShadowEnabled(envWith({ FLAGS_SERVICE }), "org-shadow"),
		).resolves.toBe(false);

		expect(evaluateFlag).toHaveBeenCalledWith(
			WATCHLIST_FEATURE_FLAG_KEYS.researchShadow,
			{ organizationId: "org-shadow", environment: "test" },
		);
	});

	it("deterministically samples roughly the first 5% of hex prefixes", () => {
		expect(researchShadowSample("0c000000-0000-4000-8000-000000000000")).toBe(
			true,
		);
		expect(researchShadowSample("0d000000-0000-4000-8000-000000000000")).toBe(
			false,
		);
		expect(researchShadowSample("ff000000-0000-4000-8000-000000000000")).toBe(
			false,
		);
		expect(researchShadowSample("z")).toBe(false);
	});
});
