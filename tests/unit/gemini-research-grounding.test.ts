import { describe, expect, it } from "vitest";
import {
	extractGroundingSources,
	normalizeCitationUrl,
} from "../../src/lib/gemini-research";

describe("gemini-research grounding helpers", () => {
	it("normalizeCitationUrl strips hash and lowercases host", () => {
		expect(normalizeCitationUrl("HTTPS://Example.COM/path/#frag")).toBe(
			"https://example.com/path",
		);
	});

	it("extractGroundingSources returns ordered unique grounding chunk URLs", () => {
		const out = extractGroundingSources({
			groundingMetadata: {
				groundingChunks: [
					{ web: { uri: "https://vertex.example/redirect/a" } },
					{ web: { uri: "https://vertex.example/redirect/a" } },
					{ web: { uri: "https://vertex.example/redirect/b" } },
					{ web: {} },
				],
			},
		});
		expect(out).toEqual([
			"https://vertex.example/redirect/a",
			"https://vertex.example/redirect/b",
		]);
	});
});
