import type { Bindings } from "../index";
import { runGeminiAdverseMediaResearch } from "./gemini-research";
import {
	runGrokAdverseMediaResearch,
	runGrokPepResearch,
} from "./grok-research";
import {
	completeAdverseMediaResearch,
	completePepAiResearch,
	failAdverseMediaResearch,
	failPepAiResearch,
} from "./research-results";
import {
	researchShadowSample,
	resolveResearchShadowEnabled,
} from "./research-provider";
import { logResearchShadowMetric } from "./research-shadow";
import { broadcastPepEvent } from "./pep-events-broadcast";

const MAX_RESEARCH_QUEUE_ATTEMPTS = 3;

const RESEARCH_JOB_KINDS = new Set([
	"gemini_adverse_media",
	"grok_pep",
	"grok_adverse_media",
]);

export type WatchlistResearchJob = {
	kind: "gemini_adverse_media" | "grok_pep" | "grok_adverse_media";
	searchId: string;
	query: string;
	entityType: string;
	birthdate?: string;
	country?: string;
	organizationId: string;
	environment: string;
};

function isWatchlistResearchJob(value: unknown): value is WatchlistResearchJob {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.kind === "string" &&
		RESEARCH_JOB_KINDS.has(record.kind) &&
		typeof record.searchId === "string" &&
		typeof record.query === "string" &&
		typeof record.entityType === "string" &&
		typeof record.organizationId === "string" &&
		typeof record.environment === "string"
	);
}

export async function processWatchlistResearchBatch(
	batch: MessageBatch<WatchlistResearchJob>,
	env: Bindings,
): Promise<void> {
	for (const message of batch.messages) {
		await processWatchlistResearchMessage(message, env);
	}
}

export async function processWatchlistResearchMessage(
	message: Message<WatchlistResearchJob>,
	env: Bindings,
): Promise<void> {
	const job = message.body;
	if (!isWatchlistResearchJob(job)) {
		console.warn("[ResearchQueue] Ignoring malformed research job", {
			messageId: message.id,
			body: job,
		});
		return;
	}

	switch (job.kind) {
		case "gemini_adverse_media":
			await processGeminiAdverseMediaJob(message, job, env);
			return;
		case "grok_pep":
			await processGrokPepJob(message, job, env);
			return;
		case "grok_adverse_media":
			await processGrokAdverseMediaJob(message, job, env);
			return;
		default: {
			const unknownKind: never = job.kind;
			console.warn("[ResearchQueue] Unhandled research job", unknownKind);
			return;
		}
	}
}

async function settleResearchFailure(
	message: Message<WatchlistResearchJob>,
	label: string,
	error: unknown,
	fail: (errorMessage: string) => Promise<void>,
): Promise<void> {
	const msg = error instanceof Error ? error.message : String(error);
	if (message.attempts < MAX_RESEARCH_QUEUE_ATTEMPTS) {
		const delaySeconds = 15 * message.attempts;
		console.warn(`[ResearchQueue] ${label} failed; retrying`, {
			searchId: message.body.searchId,
			attempt: message.attempts,
			nextDelaySeconds: delaySeconds,
			error: msg,
		});
		message.retry({ delaySeconds });
		return;
	}

	console.error(`[ResearchQueue] ${label} failed permanently`, {
		searchId: message.body.searchId,
		attempt: message.attempts,
		error: msg,
	});
	await fail(msg);
}

async function processGeminiAdverseMediaJob(
	message: Message<WatchlistResearchJob>,
	job: WatchlistResearchJob,
	env: Bindings,
): Promise<void> {
	const t0 = Date.now();
	try {
		console.log("[ResearchQueue] Running Gemini adverse media research", {
			searchId: job.searchId,
			entityType: job.entityType,
			model: env.GEMINI_MODEL,
			attempt: message.attempts,
			environment: job.environment,
		});

		await broadcastPepEvent(env, job.searchId, "adverse_media_progress", {
			phase: "searching",
			message: "Searching adverse media...",
			progress: 0.2,
		});

		const geminiResult = await runGeminiAdverseMediaResearch(env, {
			query: job.query,
			entityType: job.entityType,
			birthdate: job.birthdate,
			country: job.country,
		});

		await completeAdverseMediaResearch(env, {
			searchId: job.searchId,
			query: job.query,
			entityType: job.entityType,
			provider: "gemini",
			risk_level: geminiResult.risk_level,
			findings: geminiResult.findings,
			sources: geminiResult.sources,
			logPrefix: "[ResearchQueue/Gemini adverse]",
		});

		const shadowOn = await resolveResearchShadowEnabled(
			env,
			job.organizationId,
		);
		if (shadowOn && researchShadowSample(job.searchId)) {
			logResearchShadowMetric({
				kind: "watchlist_research_shadow_sample",
				search_id: job.searchId,
				organization_id: job.organizationId,
				research_kind: "adverse_media",
				provider: "gemini",
				latency_ms: Date.now() - t0,
				summary: {
					risk_level: geminiResult.risk_level,
					source_count: geminiResult.sources.length,
				},
			});
		}

		console.log("[ResearchQueue] Gemini adverse media research completed", {
			searchId: job.searchId,
			latencyMs: Date.now() - t0,
			riskLevel: geminiResult.risk_level,
		});
	} catch (err) {
		await settleResearchFailure(
			message,
			"Gemini adverse media",
			err,
			async (errorMessage) => {
				await failAdverseMediaResearch(env, {
					searchId: job.searchId,
					error: errorMessage,
					logPrefix: "[ResearchQueue/Gemini adverse]",
				});
			},
		);
	}
}

async function processGrokPepJob(
	message: Message<WatchlistResearchJob>,
	job: WatchlistResearchJob,
	env: Bindings,
): Promise<void> {
	try {
		console.log("[ResearchQueue] Running Grok PEP research", {
			searchId: job.searchId,
			model: env.GROK_MODEL,
			attempt: message.attempts,
			environment: job.environment,
		});

		await broadcastPepEvent(env, job.searchId, "pep_grok_progress", {
			phase: "searching",
			message: "Researching PEP status...",
			progress: 0.2,
		});

		const grokResult = await runGrokPepResearch(env, {
			query: job.query,
			birthdate: job.birthdate,
			country: job.country,
		});

		await completePepAiResearch(env, {
			searchId: job.searchId,
			query: job.query,
			entityType: job.entityType,
			birthdate: job.birthdate,
			country: job.country,
			provider: "grok",
			probability: grokResult.probability,
			summary: grokResult.summary,
			sources: grokResult.sources,
			logPrefix: "[ResearchQueue/Grok PEP]",
		});

		console.log("[ResearchQueue] Grok PEP research completed", {
			searchId: job.searchId,
			probability: grokResult.probability,
		});
	} catch (err) {
		await settleResearchFailure(
			message,
			"Grok PEP",
			err,
			async (errorMessage) => {
				await failPepAiResearch(env, {
					searchId: job.searchId,
					error: errorMessage,
					logPrefix: "[ResearchQueue/Grok PEP]",
				});
			},
		);
	}
}

async function processGrokAdverseMediaJob(
	message: Message<WatchlistResearchJob>,
	job: WatchlistResearchJob,
	env: Bindings,
): Promise<void> {
	try {
		console.log("[ResearchQueue] Running Grok adverse media research", {
			searchId: job.searchId,
			entityType: job.entityType,
			model: env.GROK_MODEL,
			attempt: message.attempts,
			environment: job.environment,
		});

		await broadcastPepEvent(env, job.searchId, "adverse_media_progress", {
			phase: "searching",
			message: "Searching adverse media...",
			progress: 0.2,
		});

		const grokResult = await runGrokAdverseMediaResearch(env, {
			query: job.query,
			entityType: job.entityType,
			birthdate: job.birthdate,
			country: job.country,
		});

		await completeAdverseMediaResearch(env, {
			searchId: job.searchId,
			query: job.query,
			entityType: job.entityType,
			provider: "grok",
			risk_level: grokResult.risk_level,
			findings: grokResult.findings,
			sources: grokResult.sources,
			logPrefix: "[ResearchQueue/Grok adverse]",
		});

		console.log("[ResearchQueue] Grok adverse media research completed", {
			searchId: job.searchId,
			riskLevel: grokResult.risk_level,
		});
	} catch (err) {
		await settleResearchFailure(
			message,
			"Grok adverse media",
			err,
			async (errorMessage) => {
				await failAdverseMediaResearch(env, {
					searchId: job.searchId,
					error: errorMessage,
					logPrefix: "[ResearchQueue/Grok adverse]",
				});
			},
		);
	}
}
