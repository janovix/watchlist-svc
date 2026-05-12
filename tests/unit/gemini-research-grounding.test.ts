import { afterEach, describe, expect, it, vi } from "vitest";
import {
	extractGroundingChunks,
	normalizeCitationUrl,
	resolveCanonicalUrl,
	resolveGroundingSources,
} from "../../src/lib/gemini-research";

describe("gemini-research grounding helpers", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("normalizeCitationUrl strips hash and lowercases host", () => {
		expect(normalizeCitationUrl("HTTPS://Example.COM/path/#frag")).toBe(
			"https://example.com/path",
		);
	});

	it("extractGroundingChunks returns ordered unique grounding chunk data", () => {
		const out = extractGroundingChunks({
			groundingMetadata: {
				groundingChunks: [
					{
						web: {
							uri: "https://vertex.example/redirect/a",
							title: "news.example",
						},
					},
					{
						web: {
							uri: "https://vertex.example/redirect/a",
							title: "duplicate.example",
						},
					},
					{
						web: {
							uri: "https://vertex.example/redirect/b",
							title: "other.example",
						},
					},
					{ web: {} },
				],
			},
		});
		expect(out).toEqual([
			{ uri: "https://vertex.example/redirect/a", title: "news.example" },
			{ uri: "https://vertex.example/redirect/b", title: "other.example" },
		]);
	});

	it("resolveCanonicalUrl follows redirects to the final response URL", async () => {
		const final = "https://justice.gov/article";
		const response = new Response(null, { status: 200 });
		Object.defineProperty(response, "url", { value: final });
		const fetchMock = vi.fn(async () => response);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			resolveCanonicalUrl("https://vertex.example/redirect/a", "justice.gov"),
		).resolves.toBe(final);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://vertex.example/redirect/a",
			expect.objectContaining({
				method: "HEAD",
				redirect: "follow",
			}),
		);
	});

	it("resolveCanonicalUrl falls back to title when redirect resolution fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network unavailable");
			}),
		);

		await expect(
			resolveCanonicalUrl("https://vertex.example/redirect/a", "justice.gov"),
		).resolves.toBe("https://justice.gov");
	});

	it("resolveGroundingSources resolves and deduplicates canonical URLs", async () => {
		const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
			const response = new Response(null, { status: 200 });
			const url = typeof input === "string" ? input : input.toString();
			Object.defineProperty(response, "url", {
				value:
					url === "https://vertex.example/redirect/a"
						? "https://news.example/story#section"
						: "https://news.example/story",
			});
			return response;
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			resolveGroundingSources([
				{ uri: "https://vertex.example/redirect/a", title: "news.example" },
				{ uri: "https://vertex.example/redirect/b", title: "news.example" },
			]),
		).resolves.toEqual(["https://news.example/story#section"]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("resolveCanonicalUrl falls back to redirect URL when title is missing", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network unavailable");
			}),
		);

		await expect(
			resolveCanonicalUrl("https://vertex.example/redirect/a", ""),
		).resolves.toBe("https://vertex.example/redirect/a");
	});
});
