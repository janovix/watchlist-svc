import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src";
import {
	clampPepProbability,
	extractGroundingChunks,
	normalizeCitationUrl,
	parsePepType,
	runGeminiAdverseMediaResearch,
	runGeminiPepResearch,
	sourceEvidenceMatchesQuery,
	parseAdverseRiskLevel,
} from "../../src/lib/gemini-research";

type TestGroundingChunk = {
	uri: string;
	title?: string;
};

const GEMINI_URL =
	"https://gateway.example/google-ai-studio/v1beta/models/gemini-test-model:generateContent";
const DEFAULT_GROUNDING_CHUNKS: TestGroundingChunk[] = [
	{
		uri: "https://vertex.example/redirect/a#section",
		title: "news.example",
	},
];

function riskLevelResponse(level: string): Response {
	return geminiResponse(JSON.stringify({ risk_level: level }), []);
}

function namedChunks(name: string): TestGroundingChunk[] {
	return [
		{
			uri: "https://vertex.example/redirect/a#section",
			title: name,
		},
	];
}

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
	groundingChunks: TestGroundingChunk[] = DEFAULT_GROUNDING_CHUNKS,
): Response {
	return new Response(
		JSON.stringify({
			candidates: [
				{
					content: { parts: [{ text }] },
					groundingMetadata: {
						groundingChunks: groundingChunks.map((chunk) => ({
							web: {
								uri: chunk.uri,
								title: chunk.title ?? "",
							},
						})),
					},
				},
			],
		}),
		{ status: 200 },
	);
}

function redirectResponse(location: string): Response {
	return new Response(null, {
		status: 302,
		headers: { location },
	});
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

function mockGeminiAndRedirectFetch(
	text: string,
	groundingChunks: TestGroundingChunk[] = DEFAULT_GROUNDING_CHUNKS,
	resolvedByRedirect: Record<string, string> = {
		"https://vertex.example/redirect/a#section": "https://news.example/article",
	},
) {
	return vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
		const url = requestUrl(args[0]);
		if (url === GEMINI_URL) return geminiResponse(text, groundingChunks);
		return redirectResponse(resolvedByRedirect[url] ?? url);
	});
}

function mockGeminiSequenceAndRedirectFetch(
	geminiResponses: Response[],
	resolvedByRedirect: Record<string, string> = {
		"https://vertex.example/redirect/a#section": "https://news.example/article",
	},
) {
	let geminiCallIndex = 0;
	return vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
		const url = requestUrl(args[0]);
		if (url === GEMINI_URL) {
			const response = geminiResponses[geminiCallIndex];
			geminiCallIndex += 1;
			if (!response)
				throw new Error(`Unexpected Gemini request #${geminiCallIndex}`);
			return response;
		}
		return redirectResponse(resolvedByRedirect[url] ?? url);
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("gemini-research", () => {
	it("normalizes citations and extracts grounding chunks with titles", () => {
		expect(normalizeCitationUrl("HTTPS://Example.COM/path/#frag")).toBe(
			"https://example.com/path",
		);
		expect(normalizeCitationUrl(" not a url ")).toBe("not a url");

		expect(
			extractGroundingChunks({
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
						{ web: { uri: "" } },
					],
				},
			}),
		).toEqual([
			{ uri: "https://vertex.example/redirect/a", title: "news.example" },
			{ uri: "https://vertex.example/redirect/b", title: "other.example" },
		]);
	});

	it("runs PEP research and resolves grounding chunks to canonical sources", async () => {
		const fetchMock = mockGeminiAndRedirectFetch(
			JSON.stringify({
				probability: 1.5,
				pep_type: "direct_current",
				summary: { es: "Si", en: "Yes" },
				sources: ["https://news.example/a", "https://ungrounded.example/story"],
			}),
			namedChunks("Jane Public"),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await runGeminiPepResearch(geminiEnv(), {
			query: "Jane Public",
			birthdate: "1980-01-01",
			country: "MX",
		});

		expect(result.probability).toBe(1);
		expect(result.pep_type).toBe("direct_current");
		expect(result.summary.en).toBe("Yes");
		expect(result.sources).toEqual(["https://news.example/article"]);
		expect(fetchMock).toHaveBeenCalledWith(
			GEMINI_URL,
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"x-goog-api-key": "test-gemini-key",
				}),
			}),
		);
		const geminiInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
		expect(JSON.parse(String(geminiInit.body))).toEqual(
			expect.objectContaining({
				generationConfig: {
					temperature: 0.2,
					thinkingConfig: { thinkingBudget: 0 },
				},
			}),
		);
	});

	it("caps related-family PEP probability at 0.65 even when Gemini returns 1.0", async () => {
		vi.stubGlobal(
			"fetch",
			mockGeminiAndRedirectFetch(
				JSON.stringify({
					probability: 1.0,
					pep_type: "related_family",
					summary: { es: "PEP por parentesco", en: "PEP by family tie" },
					sources: ["https://news.example/a"],
				}),
				namedChunks("Ricardo Salinas Pliego"),
			),
		);

		const result = await runGeminiPepResearch(geminiEnv(), {
			query: "Ricardo Salinas Pliego",
		});

		expect(result.probability).toBe(0.65);
		expect(result.pep_type).toBe("related_family");
	});

	it("passes through direct-current PEP probability of 1.0 unchanged", async () => {
		vi.stubGlobal(
			"fetch",
			mockGeminiAndRedirectFetch(
				JSON.stringify({
					probability: 1.0,
					pep_type: "direct_current",
					summary: { es: "Presidenta", en: "President" },
					sources: ["https://news.example/a"],
				}),
				namedChunks("Claudia Sheinbaum"),
			),
		);

		const result = await runGeminiPepResearch(geminiEnv(), {
			query: "Claudia Sheinbaum",
		});

		expect(result.probability).toBe(1);
		expect(result.pep_type).toBe("direct_current");
	});

	it("caps associate and advisory_or_distant PEP probabilities", async () => {
		const fetchMock = mockGeminiSequenceAndRedirectFetch([
			geminiResponse(
				JSON.stringify({
					probability: 0.9,
					pep_type: "associate",
					summary: { es: "Asociado", en: "Associate" },
					sources: ["https://news.example/a"],
				}),
				namedChunks("Business Associate"),
			),
			geminiResponse(
				JSON.stringify({
					probability: 0.9,
					pep_type: "associate",
				}),
				[],
			),
			geminiResponse(
				JSON.stringify({
					probability: 0.8,
					pep_type: "advisory_or_distant",
					summary: { es: "Asesor", en: "Advisor" },
					sources: ["https://news.example/a"],
				}),
				namedChunks("Advisory Council Member"),
			),
			geminiResponse(
				JSON.stringify({
					probability: 0.8,
					pep_type: "advisory_or_distant",
				}),
				[],
			),
		]);
		vi.stubGlobal("fetch", fetchMock);

		const associate = await runGeminiPepResearch(geminiEnv(), {
			query: "Business Associate",
		});
		const advisory = await runGeminiPepResearch(geminiEnv(), {
			query: "Advisory Council Member",
		});

		expect(associate.probability).toBe(0.55);
		expect(associate.pep_type).toBe("associate");
		expect(advisory.probability).toBe(0.35);
		expect(advisory.pep_type).toBe("advisory_or_distant");
	});

	it("defaults to related_family cap when pep_type is missing or invalid", async () => {
		const fetchMock = mockGeminiSequenceAndRedirectFetch([
			geminiResponse(
				JSON.stringify({
					probability: 0.9,
					summary: { es: "Sin tipo", en: "No type" },
					sources: ["https://news.example/a"],
				}),
				namedChunks("Missing Pep Type"),
			),
			geminiResponse(JSON.stringify({ probability: 0.9 }), []),
			geminiResponse(
				JSON.stringify({
					probability: 0.9,
					pep_type: "invalid_type",
					summary: { es: "Tipo invalido", en: "Invalid type" },
					sources: ["https://news.example/a"],
				}),
				namedChunks("Invalid Pep Type"),
			),
			geminiResponse(
				JSON.stringify({ probability: 0.9, pep_type: "invalid_type" }),
				[],
			),
		]);
		vi.stubGlobal("fetch", fetchMock);

		const missing = await runGeminiPepResearch(geminiEnv(), {
			query: "Missing Pep Type",
		});
		const invalid = await runGeminiPepResearch(geminiEnv(), {
			query: "Invalid Pep Type",
		});

		expect(missing.probability).toBe(0.65);
		expect(missing.pep_type).toBe("related_family");
		expect(invalid.probability).toBe(0.65);
		expect(invalid.pep_type).toBe("related_family");
	});

	it("clampPepProbability and parsePepType enforce rubric caps", () => {
		expect(parsePepType("related_family")).toBe("related_family");
		expect(parsePepType(undefined)).toBe("related_family");
		expect(parsePepType("bogus")).toBe("related_family");
		expect(clampPepProbability("related_family", 1)).toBe(0.65);
		expect(clampPepProbability("direct_current", 1)).toBe(1);
		expect(clampPepProbability("none", 0.5)).toBe(0);
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
		const fetchMock = mockGeminiSequenceAndRedirectFetch([
			geminiResponse(
				JSON.stringify({
					risk_level: "medium",
					findings: { es: "Hallazgo", en: "Finding" },
					sources: ["https://news.example/a"],
				}),
				namedChunks("Jane Public"),
			),
			riskLevelResponse("medium"),
			geminiResponse(
				JSON.stringify({
					risk_level: "high",
					findings: { es: "Empresa", en: "Company" },
					sources: ["https://news.example/a"],
				}),
				namedChunks("Example SA"),
			),
			riskLevelResponse("high"),
		]);
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
		expect(person.sources).toEqual(["https://news.example/article"]);
		expect(organization.sources).toEqual(["https://news.example/article"]);
		expect(fetchMock).toHaveBeenCalledTimes(6);
	});

	it("defaults invalid adverse risk and clears adverse findings without grounding chunks", async () => {
		const fetchMock = mockGeminiSequenceAndRedirectFetch([
			geminiResponse(
				JSON.stringify({
					risk_level: "severe",
					findings: { es: "?", en: "?" },
					sources: ["https://news.example/a"],
				}),
			),
			riskLevelResponse("none"),
			geminiResponse(
				JSON.stringify({
					risk_level: "high",
					findings: { es: "Riesgo", en: "Risk" },
					sources: ["https://ungrounded.example/story"],
				}),
				[],
			),
			riskLevelResponse("high"),
		]);
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
		const fetchMock = mockGeminiSequenceAndRedirectFetch([
			new Response("slow down", { status: 429 }),
			geminiResponse(
				JSON.stringify({
					probability: 0.4,
					pep_type: "related_family",
					summary: { es: "Tal vez", en: "Maybe" },
					sources: ["https://news.example/a"],
				}),
				namedChunks("Retry Person"),
			),
			geminiResponse(
				JSON.stringify({
					pep_type: "related_family",
					probability: 0.4,
				}),
				[],
			),
		]);
		vi.stubGlobal("fetch", fetchMock);

		const pending = runGeminiPepResearch(geminiEnv(), {
			query: "Retry Person",
		});
		await vi.advanceTimersByTimeAsync(2_000);
		const result = await pending;

		expect(result.probability).toBe(0.4);
		expect(fetchMock).toHaveBeenCalledTimes(4);
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
			mockGeminiAndRedirectFetch(
				`\`\`\`json
{
  "probability": 0.2,
  "pep_type": "advisory_or_distant",
  "summary": { "es": "Bajo", "en": "Low" },
  "sources": ["https://news.example/a"]
}
\`\`\``,
				namedChunks("Fenced Person"),
			),
		);

		const result = await runGeminiPepResearch(geminiEnv(), {
			query: "Fenced Person",
		});

		expect(result.probability).toBe(0.2);
		expect(result.pep_type).toBe("advisory_or_distant");
		expect(result.summary.en).toBe("Low");
	});

	it("uses the classifier risk level when research labeled sanctions as none", async () => {
		const fetchMock = mockGeminiSequenceAndRedirectFetch([
			geminiResponse(
				JSON.stringify({
					risk_level: "none",
					findings: {
						es: "Gedo Hamdan Ahmed ha sido objeto de sanciones multilaterales de OFAC y del Consejo de Seguridad de la ONU.",
						en: "Gedo Hamdan Ahmed is under OFAC and UN Security Council sanctions.",
					},
					sources: ["https://news.example/a"],
				}),
				namedChunks("Gedo Hamdan Ahmed"),
			),
			riskLevelResponse("high"),
		]);
		vi.stubGlobal("fetch", fetchMock);

		const result = await runGeminiAdverseMediaResearch(geminiEnv(), {
			query: "Gedo Hamdan Ahmed",
			entityType: "person",
		});

		expect(result.risk_level).toBe("high");
		expect(result.findings.es).toContain("sanciones");
		const classifierCall = fetchMock.mock.calls.find((call) => {
			const init = call[1] as RequestInit | undefined;
			if (!init?.body) return false;
			const body = JSON.parse(String(init.body)) as Record<string, unknown>;
			return "responseJsonSchema" in ((body.generationConfig as object) ?? {});
		});
		const classifierBody = JSON.parse(
			String((classifierCall?.[1] as RequestInit).body),
		) as Record<string, unknown>;
		expect(classifierBody).not.toHaveProperty("tools");
		expect(classifierBody.generationConfig).toEqual(
			expect.objectContaining({
				responseMimeType: "application/json",
				responseJsonSchema: expect.objectContaining({
					required: ["risk_level"],
				}),
			}),
		);
	});

	it("parses adverse risk labels from the model", () => {
		expect(parseAdverseRiskLevel("HIGH")).toBe("high");
		expect(parseAdverseRiskLevel("Alto")).toBe("high");
		expect(parseAdverseRiskLevel("severe")).toBe("none");
	});

	it("raises a zero PEP score when the classifier says the summary is a current PEP", async () => {
		vi.stubGlobal(
			"fetch",
			mockGeminiSequenceAndRedirectFetch([
				geminiResponse(
					JSON.stringify({
						probability: 0,
						pep_type: "none",
						summary: {
							es: "Gedo Hamdan Ahmed califica como Persona Políticamente Expuesta.",
							en: "Gedo Hamdan Ahmed qualifies as a politically exposed person.",
						},
						sources: ["https://news.example/a"],
					}),
					namedChunks("Gedo Hamdan Ahmed"),
				),
				geminiResponse(
					JSON.stringify({
						pep_type: "direct_current",
						probability: 0,
					}),
					[],
				),
			]),
		);

		const result = await runGeminiPepResearch(geminiEnv(), {
			query: "Gedo Hamdan Ahmed",
		});

		expect(result.pep_type).toBe("direct_current");
		expect(result.probability).toBe(0.85);
	});

	it("fails the screening when the risk classifier cannot return JSON", async () => {
		vi.stubGlobal(
			"fetch",
			mockGeminiSequenceAndRedirectFetch([
				geminiResponse(
					JSON.stringify({
						risk_level: "none",
						findings: {
							es: "Gedo Hamdan Ahmed sancionado por OFAC.",
							en: "Gedo Hamdan Ahmed is sanctioned by OFAC.",
						},
						sources: ["https://news.example/a"],
					}),
					namedChunks("Gedo Hamdan Ahmed"),
				),
				geminiResponse("not json", []),
				geminiResponse("still not json", []),
			]),
		);

		await expect(
			runGeminiAdverseMediaResearch(geminiEnv(), {
				query: "Gedo Hamdan Ahmed",
				entityType: "person",
			}),
		).rejects.toThrow("Gemini returned non-JSON text");
	});

	it("reads the JSON part when Gemini also returns a thought part", async () => {
		vi.stubGlobal(
			"fetch",
			mockGeminiSequenceAndRedirectFetch([
				new Response(
					JSON.stringify({
						candidates: [
							{
								content: {
									parts: [
										{ thought: true, text: "checking sanctions" },
										{
											text: JSON.stringify({
												risk_level: "none",
												findings: {
													es: "Gedo Hamdan Ahmed sancionado por OFAC.",
													en: "sanctioned by OFAC",
												},
												sources: [],
											}),
										},
									],
								},
								groundingMetadata: {
									groundingChunks: [
										{
											web: {
												uri: "https://vertex.example/redirect/a#section",
												title: "Gedo Hamdan Ahmed",
											},
										},
									],
								},
							},
						],
					}),
					{ status: 200 },
				),
				riskLevelResponse("high"),
			]),
		);

		const result = await runGeminiAdverseMediaResearch(geminiEnv(), {
			query: "Gedo Hamdan Ahmed",
			entityType: "person",
		});

		expect(result.risk_level).toBe("high");
		expect(result.findings.es).toContain("OFAC");
	});
	it("matches a person only when source text contains their given name and surnames", () => {
		const lazzeri =
			"Roberto Lazzeri Montaño was confirmed as Ambassador of Mexico to the United States";
		expect(
			sourceEvidenceMatchesQuery("Rodrigo Ignacio Spesia Ruiz", lazzeri),
		).toBe(false);
		expect(
			sourceEvidenceMatchesQuery(
				"Rodrigo Ignacio Spesia Ruiz",
				"Rodrigo Ignacio Spesia Ruiz es una persona políticamente expuesta",
			),
		).toBe(true);
		expect(
			sourceEvidenceMatchesQuery(
				"Joaquin Guzman Perez",
				"Joaquin Guzman Loera",
			),
		).toBe(false);
		expect(
			sourceEvidenceMatchesQuery(
				"Joaquin Guzman",
				"Joaquin Archivaldo Guzman Loera",
			),
		).toBe(true);
		expect(
			sourceEvidenceMatchesQuery(
				"Fernando Calatayud Solis",
				"Alexis Calatayud",
			),
		).toBe(false);
	});

	it("drops a PEP hit when the cited page is about someone else", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
				const url = requestUrl(args[0]);
				const method = (args[1]?.method ?? "GET").toUpperCase();
				if (url === GEMINI_URL) {
					return geminiResponse(
						JSON.stringify({
							probability: 0.95,
							pep_type: "direct_current",
							summary: {
								es: "Rodrigo Ignacio Spesia Ruiz es embajador de México. En noviembre de 2020 se unió a la Secretaría de Hacienda.",
								en: "Rodrigo Ignacio Spesia Ruiz is the ambassador of Mexico.",
							},
							sources: ["https://embamex.sre.gob.mx/ambassador"],
						}),
						[
							{
								uri: "https://vertex.example/redirect/a#section",
								title: "Roberto Lazzeri Montaño",
							},
						],
					);
				}
				if (method === "HEAD") {
					return redirectResponse("https://embamex.sre.gob.mx/ambassador");
				}
				return new Response(
					"<html><p>Roberto Lazzeri Montaño was confirmed by the Senate as Ambassador Extraordinary and Plenipotentiary of Mexico to the United States.</p></html>",
					{ status: 200, headers: { "content-type": "text/html" } },
				);
			}),
		);

		const result = await runGeminiPepResearch(geminiEnv(), {
			query: "Rodrigo Ignacio Spesia Ruiz",
		});

		expect(result.probability).toBe(0);
		expect(result.pep_type).toBe("none");
		expect(result.summary).toEqual({ es: "", en: "" });
		expect(result.sources).toEqual([]);
	});

	it("keeps a PEP hit when the page body names the queried person", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
				const url = requestUrl(args[0]);
				const method = (args[1]?.method ?? "GET").toUpperCase();
				if (url === GEMINI_URL) {
					return geminiResponse(
						JSON.stringify({
							probability: 0.9,
							pep_type: "direct_current",
							summary: { es: "Presidenta", en: "President" },
							sources: ["https://news.example/a"],
						}),
						[
							{
								uri: "https://vertex.example/redirect/a#section",
								title: "The President",
							},
						],
					);
				}
				if (method === "HEAD") {
					return redirectResponse("https://news.example/article");
				}
				return new Response(
					"<p>Claudia Sheinbaum took office as president of Mexico.</p>",
					{ status: 200, headers: { "content-type": "text/html" } },
				);
			}),
		);

		const result = await runGeminiPepResearch(geminiEnv(), {
			query: "Claudia Sheinbaum",
		});

		expect(result.probability).toBe(0.9);
		expect(result.pep_type).toBe("direct_current");
		expect(result.sources).toEqual(["https://news.example/article"]);
	});
});
