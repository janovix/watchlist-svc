/**
 * Gemini 2.5 Flash + Google Search grounding for PEP / adverse-media research.
 * Calls Google AI Studio via Cloudflare AI Gateway (see docs/GEMINI_AI_GATEWAY.md).
 */

import type { Bindings } from "../index";

const DEFAULT_MODEL = "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 90_000;

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

const PEP_SYSTEM = `
You are an expert assistant that determines if a person is a politically exposed person (PEP) based on reliable sources.
Use the Google Search tool as needed to gather current information.
Provide the summary in both Spanish and English.
Respond only with JSON matching the response schema (no markdown).
`.trim();

const ADVERSE_SYSTEM_PERSON = `
You are an expert assistant that searches for adverse media about individuals. This includes negative news, sanctions, legal proceedings, fraud allegations, corruption, money laundering, regulatory violations, and other reputational risks.
Use the Google Search tool to gather current information.
Provide the findings in both Spanish and English.
Respond only with JSON matching the response schema (no markdown).
`.trim();

const ADVERSE_SYSTEM_ORG = `
You are an expert assistant that searches for adverse media about organizations, companies, and trusts. This includes sanctions, regulatory actions, fraud allegations, corruption, money laundering, legal proceedings, tax evasion, environmental violations, and other reputational risks.
Use the Google Search tool to gather current information.
Provide the findings in both Spanish and English.
Respond only with JSON matching the response schema (no markdown).
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

function extractGroundingUrls(candidate: Record<string, unknown>): Set<string> {
	const urls = new Set<string>();
	const gm = candidate.groundingMetadata as Record<string, unknown> | undefined;
	const chunks = gm?.groundingChunks as unknown[] | undefined;
	if (!Array.isArray(chunks)) return urls;
	for (const ch of chunks) {
		const web = (ch as Record<string, unknown>)?.web as
			| Record<string, unknown>
			| undefined;
		const uri = web?.uri;
		if (typeof uri === "string" && uri.length > 0) {
			urls.add(normalizeCitationUrl(uri));
		}
	}
	return urls;
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

const PEP_RESPONSE_SCHEMA = {
	type: "OBJECT",
	properties: {
		probability: { type: "NUMBER" },
		summary: {
			type: "OBJECT",
			properties: {
				es: { type: "STRING" },
				en: { type: "STRING" },
			},
			required: ["es", "en"],
		},
		sources: {
			type: "ARRAY",
			items: { type: "STRING" },
		},
	},
	required: ["probability", "summary", "sources"],
} as const;

const ADVERSE_RESPONSE_SCHEMA = {
	type: "OBJECT",
	properties: {
		risk_level: {
			type: "STRING",
			description:
				'One of: "none", "low", "medium", "high". Use "none" when no adverse signals.',
		},
		findings: {
			type: "OBJECT",
			properties: {
				es: { type: "STRING" },
				en: { type: "STRING" },
			},
			required: ["es", "en"],
		},
		sources: {
			type: "ARRAY",
			items: { type: "STRING" },
		},
	},
	required: ["risk_level", "findings", "sources"],
} as const;

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
	try {
		return await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-goog-api-key": key,
			},
			body: JSON.stringify(body),
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}
}

export function filterSourcesToGrounding(
	sources: string[],
	allowed: Set<string>,
): string[] {
	return sources.filter((s) => {
		if (typeof s !== "string" || s.trim() === "") return false;
		return allowed.has(normalizeCitationUrl(s));
	});
}

async function generateStructured(
	env: Bindings,
	systemInstruction: string,
	userText: string,
	responseSchema: Record<string, unknown>,
): Promise<{ parsed: Record<string, unknown>; groundingUrls: Set<string> }> {
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
			responseMimeType: "application/json",
			responseSchema,
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

	const groundingUrls = extractGroundingUrls(first);
	const parsed = parseJsonObject(text);
	return { parsed, groundingUrls };
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

	const { parsed, groundingUrls } = await generateStructured(
		env,
		PEP_SYSTEM,
		userText,
		PEP_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
	);

	let probability = Number(parsed.probability);
	if (!Number.isFinite(probability)) probability = 0;
	probability = Math.min(1, Math.max(0, probability));

	const summary = parsed.summary as Record<string, unknown> | undefined;
	const es = typeof summary?.es === "string" ? summary.es : "";
	const en = typeof summary?.en === "string" ? summary.en : "";
	const rawSources = Array.isArray(parsed.sources)
		? (parsed.sources.filter((s) => typeof s === "string") as string[])
		: [];

	const sources = filterSourcesToGrounding(rawSources, groundingUrls);
	if (sources.length === 0 && probability > 0) {
		console.warn(
			"[GeminiResearch] PEP: no grounded sources after filter; forcing probability to 0",
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

	const { parsed, groundingUrls } = await generateStructured(
		env,
		system,
		userParts.join("\n"),
		ADVERSE_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
	);

	const rlRaw = parsed.risk_level;
	const allowedRl = new Set(["none", "low", "medium", "high"]);
	let risk_level = allowedRl.has(String(rlRaw))
		? (String(rlRaw) as AdverseMediaGeminiResult["risk_level"])
		: "none";

	const findings = parsed.findings as Record<string, unknown> | undefined;
	const es = typeof findings?.es === "string" ? findings.es : "";
	const en = typeof findings?.en === "string" ? findings.en : "";
	const rawSources = Array.isArray(parsed.sources)
		? (parsed.sources.filter((s) => typeof s === "string") as string[])
		: [];

	const sources = filterSourcesToGrounding(rawSources, groundingUrls);
	if (sources.length === 0 && risk_level !== "none") {
		console.warn(
			"[GeminiResearch] Adverse media: no grounded sources; forcing risk_level to none",
		);
		risk_level = "none";
	}

	return { risk_level, findings: { es, en }, sources };
}
