import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src";
import {
	extractGroundingSources,
	normalizeCitationUrl,
	runGeminiAdverseMediaResearch,
	runGeminiPepResearch,
} from "../../src/lib/gemini-research";

function geminiEnv(overrides: Partial<Bindings> = {}): Bindings {
	return {
		GEMINI_API_KEY: "test-gemini-key",
		AI_GATEWAY_URL: "https://gateway.example",
		GEMINI_MODEL: "gemini-test-model",
		...overrides,
	} as unknown as Bindings;
}

function geminiResponse(
	text: string,
	groundingUrls: string[] = ["https://news.example/a#section"],
): Response {
	return new Response(
		JSON.stringify({
			candidates: [
				{
					content: { parts: [{ text }] },
					groundingMetadata: {
						groundingChunks: groundingUrls.map((uri) => ({ web: { uri } })),
					},
				},
			],
		}),
		{ status: 200 },
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("gemini-research", () => {
	it("normalizes citations and extracts authoritative grounding sources", () => {
		expect(normalizeCitationUrl("HTTPS://Example.COM/path/#frag")).toBe(
			"https://example.com/path",
		);
		expect(normalizeCitationUrl(" not a url ")).toBe("not a url");

		expect(
			extractGroundingSources({
				groundingMetadata: {
					groundingChunks: [
						{ web: { uri: "https://news.example/a#section" } },
						{ web: { uri: "https://news.example/a#section" } },
						{ web: { uri: "https://news.example/b" } },
						{ web: { uri: "" } },
					],
				},
			}),
		).toEqual(["https://news.example/a#section", "https://news.example/b"]);
	});

	it("runs PEP research and uses grounding chunks as sources", async () => {
		const fetchMock = vi.fn(async () =>
			geminiResponse(
				JSON.stringify({
					probability: 1.5,
					summary: { es: "Si", en: "Yes" },
					sources: [
						"https://news.example/a",
						"https://ungrounded.example/story",
					],
				}),
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await runGeminiPepResearch(geminiEnv(), {
			query: "Jane Public",
			birthdate: "1980-01-01",
			country: "MX",
		});

		expect(result.probability).toBe(1);
		expect(result.summary.en).toBe("Yes");
		expect(result.sources).toEqual(["https://news.example/a#section"]);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://gateway.example/google-ai-studio/v1beta/models/gemini-test-model:generateContent",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"x-goog-api-key": "test-gemini-key",
				}),
			}),
		);
	});

	it("forces PEP probability to zero when positive result has no grounding chunks", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				geminiResponse(
					JSON.stringify({
						probability: 0.8,
						summary: { es: "Si", en: "Yes" },
						sources: ["https://ungrounded.example/story"],
					}),
					[],
				),
			),
		);

		const result = await runGeminiPepResearch(geminiEnv(), {
			query: "No Grounding",
		});

		expect(result.probability).toBe(0);
		expect(result.sources).toEqual([]);
	});

	it("runs adverse media research for people and organizations", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				geminiResponse(
					JSON.stringify({
						risk_level: "medium",
						findings: { es: "Hallazgo", en: "Finding" },
						sources: ["https://news.example/a"],
					}),
				),
			)
			.mockResolvedValueOnce(
				geminiResponse(
					JSON.stringify({
						risk_level: "high",
						findings: { es: "Empresa", en: "Company" },
						sources: ["https://news.example/a"],
					}),
				),
			);
		vi.stubGlobal("fetch", fetchMock);

		const person = await runGeminiAdverseMediaResearch(geminiEnv(), {
			query: "Jane Public",
			entityType: "person",
			birthdate: "1980-01-01",
			country: "MX",
		});
		const organization = await runGeminiAdverseMediaResearch(geminiEnv(), {
			query: "Example SA",
			entityType: "organization",
			country: "MX",
		});

		expect(person.risk_level).toBe("medium");
		expect(organization.risk_level).toBe("high");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("defaults invalid adverse risk and clears adverse findings without grounding chunks", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				geminiResponse(
					JSON.stringify({
						risk_level: "severe",
						findings: { es: "?", en: "?" },
						sources: ["https://news.example/a"],
					}),
				),
			)
			.mockResolvedValueOnce(
				geminiResponse(
					JSON.stringify({
						risk_level: "high",
						findings: { es: "Riesgo", en: "Risk" },
						sources: ["https://ungrounded.example/story"],
					}),
					[],
				),
			);
		vi.stubGlobal("fetch", fetchMock);

		const invalid = await runGeminiAdverseMediaResearch(geminiEnv(), {
			query: "Invalid Risk",
			entityType: "person",
		});
		const ungrounded = await runGeminiAdverseMediaResearch(geminiEnv(), {
			query: "Ungrounded Risk",
			entityType: "person",
		});

		expect(invalid.risk_level).toBe("none");
		expect(ungrounded.risk_level).toBe("none");
		expect(ungrounded.sources).toEqual([]);
	});

	it("retries once on transient Gemini responses", async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("slow down", { status: 429 }))
			.mockResolvedValueOnce(
				geminiResponse(
					JSON.stringify({
						probability: 0.4,
						summary: { es: "Tal vez", en: "Maybe" },
						sources: ["https://news.example/a"],
					}),
				),
			);
		vi.stubGlobal("fetch", fetchMock);

		const pending = runGeminiPepResearch(geminiEnv(), {
			query: "Retry Person",
		});
		await vi.advanceTimersByTimeAsync(2_000);
		const result = await pending;

		expect(result.probability).toBe(0.4);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("throws for non-OK Gemini responses and malformed successful payloads", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("bad request", { status: 400 })),
		);
		await expect(
			runGeminiPepResearch(geminiEnv(), { query: "Error Person" }),
		).rejects.toThrow("Gemini HTTP 400");

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
		);
		await expect(
			runGeminiPepResearch(geminiEnv(), { query: "No Candidates" }),
		).rejects.toThrow("Gemini returned no candidates");

		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							candidates: [{ content: { parts: [{}] } }],
						}),
						{ status: 200 },
					),
			),
		);
		await expect(
			runGeminiPepResearch(geminiEnv(), { query: "No Text" }),
		).rejects.toThrow("Gemini candidate missing text part");
	});

	it("throws before fetch when required Gemini configuration is missing", async () => {
		await expect(
			runGeminiPepResearch(geminiEnv({ GEMINI_API_KEY: "" }), {
				query: "Missing Key",
			}),
		).rejects.toThrow("GEMINI_API_KEY is not configured");

		await expect(
			runGeminiPepResearch(geminiEnv({ AI_GATEWAY_URL: "" }), {
				query: "Missing Gateway",
			}),
		).rejects.toThrow("AI_GATEWAY_URL is not configured");
	});

	it("parses fenced JSON from Gemini text parts", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				geminiResponse(`\`\`\`json
{
  "probability": 0.2,
  "summary": { "es": "Bajo", "en": "Low" },
  "sources": ["https://news.example/a"]
}
\`\`\``),
			),
		);

		const result = await runGeminiPepResearch(geminiEnv(), {
			query: "Fenced Person",
		});

		expect(result.probability).toBe(0.2);
		expect(result.summary.en).toBe("Low");
	});
});
