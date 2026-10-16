/**
 * xAI Grok + web search for PEP / adverse-media research.
 * Prompts match grok-test/grok-pep.py and grok-test/grok-adverse-media.py.
 */

import type { Bindings } from "../index";

const DEFAULT_MODEL = "grok-4-1-fast-reasoning";
const RESPONSES_URL = "https://api.x.ai/v1/responses";
const REQUEST_TIMEOUT_MS = 120_000;

const PEP_SYSTEM = `
You are an expert assistant that determines if a person is a politically exposed person (PEP) based on reliable sources.
Use the web search tool if needed to gather current information.
Provide the summary in both Spanish and English.
Respond only in this exact JSON format:
{
  "probability": float between 0 and 1,
  "summary": {
    "es": "string, max 100 characters in Spanish",
    "en": "string, max 100 characters in English"
  },
  "sources": ["array of source URLs or domain strings"]
}
Do not add any extra text.
`.trim();

const ADVERSE_SYSTEM_PERSON = `
You are an expert assistant that searches for adverse media about individuals. This includes negative news, sanctions, legal proceedings, fraud allegations, corruption, money laundering, regulatory violations, and other reputational risks.
Use the web search tool to gather current information.
Provide the findings in both Spanish and English.
Respond only in this exact JSON format:
{
  "risk_level": "string: none | low | medium | high",
  "findings": {
    "es": "string, max 200 characters in Spanish summarizing key findings or 'Sin medios adversos encontrados' if clean",
    "en": "string, max 200 characters in English summarizing key findings or 'No adverse media found' if clean"
  },
  "sources": ["array of source URLs or domain strings"]
}
Do not add any extra text.
`.trim();

const ADVERSE_SYSTEM_ORG = `
You are an expert assistant that searches for adverse media about organizations, companies, and trusts. This includes sanctions, regulatory actions, fraud allegations, corruption, money laundering, legal proceedings, tax evasion, environmental violations, and other reputational risks.
Use the web search tool to gather current information.
Provide the findings in both Spanish and English.
Respond only in this exact JSON format:
{
  "risk_level": "string: none | low | medium | high",
  "findings": {
    "es": "string, max 200 characters in Spanish summarizing key findings or 'Sin medios adversos encontrados' if clean",
    "en": "string, max 200 characters in English summarizing key findings or 'No adverse media found' if clean"
  },
  "sources": ["array of source URLs or domain strings"]
}
Do not add any extra text.
`.trim();

const RISK_LEVELS = new Set(["none", "low", "medium", "high"]);

export type GrokPepResult = {
	probability: number;
	summary: { es: string; en: string };
	sources: string[];
};

export type GrokAdverseMediaResult = {
	risk_level: "none" | "low" | "medium" | "high";
	findings: { es: string; en: string };
	sources: string[];
};

export function buildPepUserQuery(params: {
	query: string;
	birthdate?: string;
	country?: string;
}): string {
	const parts = [`Is ${params.query} a politically exposed person (PEP)?`];
	if (params.birthdate) {
		parts.push(` (born ${params.birthdate})`);
	}
	if (params.country) {
		parts.push(` from ${params.country}`);
	}
	return parts.join("");
}

export function buildAdverseUserQuery(params: {
	query: string;
	entityType: string;
	birthdate?: string;
	country?: string;
}): string {
	if (params.entityType === "organization") {
		const parts = [
			`Search for adverse media, sanctions, regulatory actions, fraud, or legal proceedings involving the organization ${params.query}`,
		];
		if (params.country) {
			parts.push(` from ${params.country}`);
		}
		return parts.join("");
	}

	const parts = [
		`Search for adverse media, negative news, sanctions, or regulatory violations involving ${params.query}`,
	];
	if (params.birthdate) {
		parts.push(` (born ${params.birthdate})`);
	}
	if (params.country) {
		parts.push(` from ${params.country}`);
	}
	return parts.join("");
}

function grokModel(env: Bindings): string {
	const model = env.GROK_MODEL?.trim();
	return model && model.length > 0 ? model : DEFAULT_MODEL;
}

async function postGrok(
	env: Bindings,
	system: string,
	userText: string,
): Promise<unknown> {
	const key = env.GROK_API_KEY;
	if (!key || key.trim() === "") {
		throw new Error("GROK_API_KEY is not configured");
	}

	const body = {
		model: grokModel(env),
		input: [
			{ role: "system", content: system },
			{ role: "user", content: userText },
		],
		tools: [{ type: "web_search" }],
	};

	const send = async (): Promise<Response> => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			return await fetch(RESPONSES_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${key}`,
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timer);
		}
	};

	let res = await send();
	if (res.status === 429 || res.status >= 500) {
		await new Promise((resolve) => setTimeout(resolve, 2000));
		res = await send();
	}
	if (!res.ok) {
		const errText = await res.text().catch(() => "");
		throw new Error(`xAI HTTP ${res.status}: ${errText.slice(0, 500)}`);
	}
	return await res.json();
}

function collectOutputText(
	node: unknown,
	texts: string[],
	depth: number,
): void {
	if (depth > 6 || node == null) return;
	if (Array.isArray(node)) {
		for (const item of node) collectOutputText(item, texts, depth + 1);
		return;
	}
	if (typeof node !== "object") return;
	const record = node as Record<string, unknown>;
	if (record.type === "output_text" && typeof record.text === "string") {
		texts.push(record.text);
	}
	if (typeof record.content === "string" && record.role === "assistant") {
		texts.push(record.content);
	}
	if (Array.isArray(record.content)) {
		collectOutputText(record.content, texts, depth + 1);
	}
	if (Array.isArray(record.output)) {
		collectOutputText(record.output, texts, depth + 1);
	}
	if (Array.isArray(record.choices)) {
		collectOutputText(record.choices, texts, depth + 1);
	}
	if (record.message && typeof record.message === "object") {
		collectOutputText(record.message, texts, depth + 1);
	}
}

function collectCitations(
	node: unknown,
	citations: string[],
	depth: number,
): void {
	if (depth > 6 || node == null) return;
	if (Array.isArray(node)) {
		for (const item of node) collectCitations(item, citations, depth + 1);
		return;
	}
	if (typeof node !== "object") return;
	const record = node as Record<string, unknown>;
	const type = record.type;
	if (
		(type === "url_citation" || type === "citation") &&
		typeof record.url === "string" &&
		record.url.trim() !== ""
	) {
		citations.push(record.url.trim());
	}
	if (Array.isArray(record.citations)) {
		for (const citation of record.citations) {
			if (typeof citation === "string" && citation.trim() !== "") {
				citations.push(citation.trim());
			} else {
				collectCitations(citation, citations, depth + 1);
			}
		}
	}
	if (Array.isArray(record.annotations)) {
		collectCitations(record.annotations, citations, depth + 1);
	}
	if (Array.isArray(record.content)) {
		collectCitations(record.content, citations, depth + 1);
	}
	if (Array.isArray(record.output)) {
		collectCitations(record.output, citations, depth + 1);
	}
}

function parseJsonObject(text: string): Record<string, unknown> {
	const trimmed = text.trim();
	const candidates = [trimmed];
	const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence?.[1]) candidates.push(fence[1].trim());
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start >= 0 && end > start) {
		candidates.push(trimmed.slice(start, end + 1));
	}
	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			// Try the next candidate.
		}
	}
	throw new Error("xAI returned non-JSON text");
}

function stringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

export function mergeGrokSources(primary: string[], extra: string[]): string[] {
	const seen = new Set<string>();
	const sources: string[] = [];
	for (const source of [...primary, ...extra]) {
		const trimmed = source.trim();
		if (trimmed === "") continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		sources.push(trimmed);
	}
	return sources;
}

function bilingual(value: unknown): { es: string; en: string } {
	const record =
		value && typeof value === "object"
			? (value as Record<string, unknown>)
			: undefined;
	return {
		es: typeof record?.es === "string" ? record.es : "",
		en: typeof record?.en === "string" ? record.en : "",
	};
}

function readGrokPayload(body: unknown): {
	parsed: Record<string, unknown>;
	citations: string[];
} {
	const texts: string[] = [];
	const citations: string[] = [];
	collectOutputText(body, texts, 0);
	collectCitations(body, citations, 0);
	const text = texts
		.map((part) => part.trim())
		.filter((part) => part !== "")
		.join("\n");
	if (text === "") {
		throw new Error("xAI response missing text");
	}
	return { parsed: parseJsonObject(text), citations };
}

export async function runGrokPepResearch(
	env: Bindings,
	params: {
		query: string;
		birthdate?: string;
		country?: string;
	},
): Promise<GrokPepResult> {
	const body = await postGrok(env, PEP_SYSTEM, buildPepUserQuery(params));
	const { parsed, citations } = readGrokPayload(body);
	const probability = Number(parsed.probability);
	if (!Number.isFinite(probability)) {
		throw new Error("xAI PEP response missing probability");
	}
	return {
		probability: Math.min(1, Math.max(0, probability)),
		summary: bilingual(parsed.summary),
		sources: mergeGrokSources(stringList(parsed.sources), citations),
	};
}

export async function runGrokAdverseMediaResearch(
	env: Bindings,
	params: {
		query: string;
		entityType: string;
		birthdate?: string;
		country?: string;
	},
): Promise<GrokAdverseMediaResult> {
	const isOrg = params.entityType === "organization";
	const body = await postGrok(
		env,
		isOrg ? ADVERSE_SYSTEM_ORG : ADVERSE_SYSTEM_PERSON,
		buildAdverseUserQuery(params),
	);
	const { parsed, citations } = readGrokPayload(body);
	const risk = String(parsed.risk_level ?? parsed.riskLevel ?? "")
		.trim()
		.toLowerCase();
	if (!RISK_LEVELS.has(risk)) {
		throw new Error(`xAI adverse media response missing risk_level`);
	}
	return {
		risk_level: risk as GrokAdverseMediaResult["risk_level"],
		findings: bilingual(parsed.findings),
		sources: mergeGrokSources(stringList(parsed.sources), citations),
	};
}
