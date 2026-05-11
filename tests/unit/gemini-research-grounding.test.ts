import { describe, expect, it } from "vitest";
import {
	filterSourcesToGrounding,
	normalizeCitationUrl,
} from "../../src/lib/gemini-research";

describe("gemini-research grounding helpers", () => {
	it("normalizeCitationUrl strips hash and lowercases host", () => {
		expect(normalizeCitationUrl("HTTPS://Example.COM/path/#frag")).toBe(
			"https://example.com/path",
		);
	});

	it("filterSourcesToGrounding keeps only URLs present in grounding set", () => {
		const allowed = new Set([normalizeCitationUrl("https://news.example/a")]);
		const out = filterSourcesToGrounding(
			["https://news.example/a", "https://evil.example/phishing", ""],
			allowed,
		);
		expect(out).toEqual(["https://news.example/a"]);
	});
});
