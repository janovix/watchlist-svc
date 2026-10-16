import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src";
import {
	runGrokAdverseMediaResearch,
	runGrokPepResearch,
} from "../../src/lib/grok-research";

const RESPONSES_URL = "https://api.x.ai/v1/responses";

function grokEnv(overrides: Partial<Bindings> = {}): Bindings {
	return {
		GROK_API_KEY: "test-grok-key",
		...overrides,
	} as unknown as Bindings;
}

function responsesBody(
	text: string,
	citationUrl?: string,
): Record<string, unknown> {
	return {
		output: [
			{
				type: "message",
				role: "assistant",
				content: [
					{
						type: "output_text",
						text,
						annotations: citationUrl
							? [{ type: "url_citation", url: citationUrl }]
							: [],
					},
				],
			},
		],
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("runGrokPepResearch", () => {
	it("calls xAI responses with web search and parses the JSON", async () => {
		const fetchSpy = vi.fn(async () =>
			Response.json(
				responsesBody(
					JSON.stringify({
						probability: 0.92,
						summary: { es: "Senador", en: "Senator" },
						sources: ["https://news.example/a"],
					}),
					"https://news.example/b",
				),
			),
		);
		vi.stubGlobal("fetch", fetchSpy);

		const result = await runGrokPepResearch(grokEnv(), {
			query: "JANE DOE",
			birthdate: "1980-05-15",
			country: "Mexico",
		});

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, init] = fetchSpy.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe(RESPONSES_URL);
		expect(init.method).toBe("POST");
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer test-grok-key",
		);
		const body = JSON.parse(String(init.body)) as {
			model: string;
			tools: Array<{ type: string }>;
			input: Array<{ role: string; content: string }>;
		};
		expect(body.model).toBe("grok-4-1-fast-reasoning");
		expect(body.tools).toEqual([{ type: "web_search" }]);
		expect(body.input[1]?.content).toBe(
			"Is JANE DOE a politically exposed person (PEP)? (born 1980-05-15) from Mexico",
		);
		expect(result.probability).toBe(0.92);
		expect(result.summary.en).toBe("Senator");
		expect(result.sources).toEqual([
			"https://news.example/a",
			"https://news.example/b",
		]);
	});

	it("uses GROK_MODEL when set", async () => {
		const fetchSpy = vi.fn(async () =>
			Response.json(
				responsesBody(
					JSON.stringify({
						probability: 0,
						summary: { es: "no", en: "no" },
						sources: [],
					}),
				),
			),
		);
		vi.stubGlobal("fetch", fetchSpy);

		await runGrokPepResearch(grokEnv({ GROK_MODEL: "grok-test-model" }), {
			query: "JANE DOE",
		});

		const body = JSON.parse(
			String(
				(fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body,
			),
		) as { model: string };
		expect(body.model).toBe("grok-test-model");
	});

	it("retries once on HTTP 500", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValueOnce(new Response("busy", { status: 500 }))
			.mockResolvedValueOnce(
				Response.json(
					responsesBody(
						JSON.stringify({
							probability: 0.4,
							summary: { es: "x", en: "y" },
							sources: [],
						}),
					),
				),
			);
		vi.stubGlobal("fetch", fetchSpy);

		const result = await runGrokPepResearch(grokEnv(), { query: "JANE DOE" });

		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(result.probability).toBe(0.4);
	});

	it("throws when the API key is missing", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);

		await expect(
			runGrokPepResearch(grokEnv({ GROK_API_KEY: "" }), { query: "JANE DOE" }),
		).rejects.toThrow("GROK_API_KEY is not configured");
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("throws when the model does not return JSON", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(responsesBody("not json"))),
		);

		await expect(
			runGrokPepResearch(grokEnv(), { query: "JANE DOE" }),
		).rejects.toThrow("xAI returned non-JSON text");
	});
});

describe("runGrokAdverseMediaResearch", () => {
	it("parses organization risk and keeps the organization prompt", async () => {
		const fetchSpy = vi.fn(async () =>
			Response.json(
				responsesBody(
					JSON.stringify({
						risk_level: "high",
						findings: { es: "Sancion", en: "Sanction" },
						sources: ["reuters.com"],
					}),
				),
			),
		);
		vi.stubGlobal("fetch", fetchSpy);

		const result = await runGrokAdverseMediaResearch(grokEnv(), {
			query: "ACME SA",
			entityType: "organization",
			country: "Mexico",
		});

		const body = JSON.parse(
			String(
				(fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body,
			),
		) as { input: Array<{ content: string }> };
		expect(body.input[1]?.content).toContain("the organization ACME SA");
		expect(body.input[1]?.content).not.toContain("born");
		expect(result.risk_level).toBe("high");
		expect(result.findings.en).toBe("Sanction");
		expect(result.sources).toEqual(["reuters.com"]);
	});
});
