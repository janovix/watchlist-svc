/**
 * Gemini 2.5 Flash + Google Search grounding for PEP / adverse-media research.
 * Calls Google AI Studio via Cloudflare AI Gateway (see docs/GEMINI_AI_GATEWAY.md).
 */

import type { Bindings } from "../index";

const DEFAULT_MODEL = "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 90_000;
const REDIRECT_RESOLVE_TIMEOUT_MS = 5_000;

/** Matches Grok PEP JSON contract (see thread-worker-container pep_grok handler). */
export type PepGeminiResult = {
	probability: number;
	summary: { es: string; en: string };
	sources: string[];
};

/** Matches adverse_media_grok JSON contract. */
export type AdverseMediaGeminiResult = {
	risk_level: "none" | "low" | "medium" | "high";
	findings: { es: string; en: string };
	sources: string[];
};

export type GroundingChunkSource = {
	uri: string;
	title: string;
};

const PEP_SYSTEM = `
You are an expert assistant that determines if a person is a politically exposed person (PEP) based on reliable sources.
Use the Google Search tool as needed to gather current information.
Provide the summary in both Spanish and English.
Respond ONLY with a single JSON object (no markdown, no code fences) using this exact schema:
{
  "probability": <number between 0 and 1>,
  "summary": { "es": "<Spanish summary>", "en": "<English summary>" },
  "sources": ["<URL 1>", "<URL 2>", ...]
}
Set probability to 0 when the person is not a PEP. Criminal notoriety, sanctions, or adverse media alone do not make a person a PEP unless they held a prominent public function or are a close associate/family member of a PEP.
`.trim();

const ADVERSE_SYSTEM_PERSON = `
You are an expert assistant that searches for adverse media about individuals. This includes negative news, sanctions, legal proceedings, fraud allegations, corruption, money laundering, regulatory violations, and other reputational risks.
Use the Google Search tool to gather current information.
Provide the findings in both Spanish and English.
Respond ONLY with a single JSON object (no markdown, no code fences) using this exact schema:
{
  "risk_level": "none" | "low" | "medium" | "high",
  "findings": { "es": "<Spanish findings>", "en": "<English findings>" },
  "sources": ["<URL 1>", "<URL 2>", ...]
}
Use "none" only when you find no credible adverse media. Use "high" for confirmed serious criminal convictions, sanctions, money laundering, corruption, fraud, terrorism, drug trafficking, or major regulatory/legal actions.
`.trim();

const ADVERSE_SYSTEM_ORG = `
You are an expert assistant that searches for adverse media about organizations, companies, and trusts. This includes sanctions, regulatory actions, fraud allegations, corruption, money laundering, legal proceedings, tax evasion, environmental violations, and other reputational risks.
Use the Google Search tool to gather current information.
Provide the findings in both Spanish and English.
Respond ONLY with a single JSON object (no markdown, no code fences) using this exact schema:
{
  "risk_level": "none" | "low" | "medium" | "high",
  "findings": { "es": "<Spanish findings>", "en": "<English findings>" },
  "sources": ["<URL 1>", "<URL 2>", ...]
}
Use "none" only when you find no credible adverse media. Use "high" for confirmed sanctions, major regulatory actions, serious criminal allegations or convictions, money laundering, corruption, fraud, terrorism, tax evasion, or other severe legal proceedings.
`.trim();

export function normalizeCitationUrl(raw: string): string {
	try {
		const u = new URL(raw.trim());
		u.hash = "";
		let path = u.pathname;
		if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
		u.pathname = path;
		return u.href.toLowerCase();
	} catch {
		return raw.trim().toLowerCase();
	}
}

export function extractGroundingChunks(
	candidate: Record<string, unknown>,
): GroundingChunkSource[] {
	const chunksOut: GroundingChunkSource[] = [];
	const seen = new Set<string>();
	const gm = candidate.groundingMetadata as Record<string, unknown> | undefined;
	const chunks = gm?.groundingChunks as unknown[] | undefined;
	if (!Array.isArray(chunks)) return chunksOut;
	for (const ch of chunks) {
		const web = (ch as Record<string, unknown>)?.web as
			| Record<string, unknown>
			| undefined;
		const uri = web?.uri;
		if (typeof uri === "string" && uri.length > 0) {
			const normalized = normalizeCitationUrl(uri);
			if (!seen.has(normalized)) {
				seen.add(normalized);
				const title = web?.title;
				chunksOut.push({
					uri,
					title: typeof title === "string" ? title : "",
				});
			}
		}
	}
	return chunksOut;
}

export async function resolveCanonicalUrl(
	redirectUrl: string,
	title: string,
): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(),
		REDIRECT_RESOLVE_TIMEOUT_MS,
	);
	try {
		const res = await fetch(redirectUrl, {
			method: "HEAD",
			redirect: "follow",
			signal: controller.signal,
		});
		if (res.url && res.url !== redirectUrl) return res.url;
	} catch {
		// Fall back below; unresolved redirects should not fail screening.
	} finally {
		clearTimeout(timer);
	}

	const trimmedTitle = title.trim();
	if (trimmedTitle) return `https://${trimmedTitle}`;
	return redirectUrl;
}

export async function resolveGroundingSources(
	chunks: GroundingChunkSource[],
): Promise<string[]> {
	const resolved = await Promise.all(
		chunks.map((chunk) => resolveCanonicalUrl(chunk.uri, chunk.title)),
	);
	const seen = new Set<string>();
	const sources: string[] = [];
	for (const url of resolved) {
		const normalized = normalizeCitationUrl(url);
		if (!seen.has(normalized)) {
			seen.add(normalized);
			sources.push(url);
		}
	}
	return sources;
}

function parseJsonObject(text: string): Record<string, unknown> {
	const trimmed = text.trim();
	try {
		return JSON.parse(trimmed) as Record<string, unknown>;
	} catch {
		const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
		if (fence?.[1]) {
			return JSON.parse(fence[1].trim()) as Record<string, unknown>;
		}
		throw new Error("Gemini returned non-JSON text");
	}
}

function geminiGenerateUrl(env: Bindings): string {
	const base = (env.AI_GATEWAY_URL ?? "").replace(/\/$/, "");
	const model = env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
	return `${base}/google-ai-studio/v1beta/models/${model}:generateContent`;
}

const SAFETY_SETTINGS = [
	{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
	{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
	{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
	{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

async function postGemini(
	env: Bindings,
	body: Record<string, unknown>,
): Promise<Response> {
	const key = env.GEMINI_API_KEY;
	if (!key || key.trim() === "") {
		throw new Error("GEMINI_API_KEY is not configured");
	}
	const url = geminiGenerateUrl(env);
	if (!env.AI_GATEWAY_URL || env.AI_GATEWAY_URL.trim() === "") {
		throw new Error("AI_GATEWAY_URL is not configured");
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"x-goog-api-key": key,
	};
	const gatewayToken = env.AI_GATEWAY_TOKEN?.trim();
	if (gatewayToken) {
		headers["cf-aig-authorization"] = `Bearer ${gatewayToken}`;
	}
	try {
		return await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}
}

async function generateStructured(
	env: Bindings,
	systemInstruction: string,
	userText: string,
): Promise<{
	parsed: Record<string, unknown>;
	groundingChunks: GroundingChunkSource[];
}> {
	const body = {
		systemInstruction: {
			parts: [{ text: systemInstruction }],
		},
		contents: [
			{
				role: "user",
				parts: [{ text: userText }],
			},
		],
		tools: [{ google_search: {} }],
		generationConfig: {
			temperature: 0.2,
		},
		safetySettings: SAFETY_SETTINGS,
	};

	let res = await postGemini(env, body);
	if (res.status === 429 || res.status >= 500) {
		await new Promise((r) => setTimeout(r, 2000));
		res = await postGemini(env, body);
	}
	if (!res.ok) {
		const errText = await res.text().catch(() => "");
		throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 500)}`);
	}

	const json = (await res.json()) as Record<string, unknown>;
	const candidates = json.candidates as unknown[] | undefined;
	const first = candidates?.[0] as Record<string, unknown> | undefined;
	if (!first) {
		throw new Error("Gemini returned no candidates");
	}

	const content = first.content as Record<string, unknown> | undefined;
	const parts = content?.parts as unknown[] | undefined;
	const textPart = parts?.[0] as Record<string, unknown> | undefined;
	const text = textPart?.text;
	if (typeof text !== "string") {
		throw new Error("Gemini candidate missing text part");
	}

	const groundingChunks = extractGroundingChunks(first);
	const parsed = parseJsonObject(text);
	return { parsed, groundingChunks };
}

/**
 * Single retry on transient errors is applied inside {@link generateStructured}.
 */
export async function runGeminiPepResearch(
	env: Bindings,
	params: {
		query: string;
		birthdate?: string;
		country?: string;
	},
): Promise<PepGeminiResult> {
	const userParts = [
		`Task: Determine whether ${params.query} is a politically exposed person (PEP).`,
		`Use search to verify against official and reputable news sources.`,
		`Answer in JSON only.`,
	];
	if (params.birthdate) {
		userParts.push(
			`Birth date context (if relevant for disambiguation): ${params.birthdate}.`,
		);
	}
	if (params.country) {
		userParts.push(`Country / nationality context: ${params.country}.`);
	}
	userParts.push(
		`Provide both Spanish and English summaries. Cite only URLs you actually retrieved via search.`,
	);
	const userText = userParts.join("\n");

	const { parsed, groundingChunks } = await generateStructured(
		env,
		PEP_SYSTEM,
		userText,
	);

	let probability = Number(parsed.probability);
	if (!Number.isFinite(probability)) probability = 0;
	probability = Math.min(1, Math.max(0, probability));

	const summary = parsed.summary as Record<string, unknown> | undefined;
	const es = typeof summary?.es === "string" ? summary.es : "";
	const en = typeof summary?.en === "string" ? summary.en : "";
	const sources = await resolveGroundingSources(groundingChunks);
	if (groundingChunks.length === 0 && probability > 0) {
		console.warn(
			"[GeminiResearch] PEP: no grounding chunks returned; forcing probability to 0",
		);
		probability = 0;
	}

	return { probability, summary: { es, en }, sources };
}

export async function runGeminiAdverseMediaResearch(
	env: Bindings,
	params: {
		query: string;
		entityType: string;
		birthdate?: string;
		country?: string;
	},
): Promise<AdverseMediaGeminiResult> {
	const isOrg = params.entityType === "organization";
	const system = isOrg ? ADVERSE_SYSTEM_ORG : ADVERSE_SYSTEM_PERSON;

	const userParts: string[] = [];
	if (isOrg) {
		userParts.push(
			`Search for adverse media, sanctions, regulatory actions, fraud, or legal proceedings involving the organization ${params.query}.`,
		);
	} else {
		userParts.push(
			`Search for adverse media, negative news, sanctions, or regulatory violations involving ${params.query}.`,
		);
	}
	if (params.birthdate && !isOrg) {
		userParts.push(`Birth date context: ${params.birthdate}.`);
	}
	if (params.country) {
		userParts.push(`Country context: ${params.country}.`);
	}
	userParts.push(
		`Use Spanish and English in findings. Cite only URLs you actually retrieved via search.`,
	);

	const { parsed, groundingChunks } = await generateStructured(
		env,
		system,
		userParts.join("\n"),
	);

	const rlRaw = parsed.risk_level;
	const allowedRl = new Set(["none", "low", "medium", "high"]);
	let risk_level = allowedRl.has(String(rlRaw))
		? (String(rlRaw) as AdverseMediaGeminiResult["risk_level"])
		: "none";

	const findings = parsed.findings as Record<string, unknown> | undefined;
	const es = typeof findings?.es === "string" ? findings.es : "";
	const en = typeof findings?.en === "string" ? findings.en : "";
	const sources = await resolveGroundingSources(groundingChunks);
	if (groundingChunks.length === 0 && risk_level !== "none") {
		console.warn(
			"[GeminiResearch] Adverse media: no grounding chunks returned; forcing risk_level to none",
		);
		risk_level = "none";
	}

	return { risk_level, findings: { es, en }, sources };
}
