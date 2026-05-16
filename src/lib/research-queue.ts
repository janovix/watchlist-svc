import type { Bindings } from "../index";
import { runGeminiAdverseMediaResearch } from "./gemini-research";
import {
	completeAdverseMediaResearch,
	failAdverseMediaResearch,
} from "./research-results";
import {
	researchShadowSample,
	resolveResearchShadowEnabled,
} from "./research-provider";
import { logResearchShadowMetric } from "./research-shadow";
import { broadcastPepEvent } from "./pep-events-broadcast";

const MAX_RESEARCH_QUEUE_ATTEMPTS = 3;

export type WatchlistResearchJob = {
	kind: "gemini_adverse_media";
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
		record.kind === "gemini_adverse_media" &&
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
	}
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
		const msg = err instanceof Error ? err.message : String(err);
		if (message.attempts < MAX_RESEARCH_QUEUE_ATTEMPTS) {
			const delaySeconds = 15 * message.attempts;
			console.warn("[ResearchQueue] Gemini adverse media failed; retrying", {
				searchId: job.searchId,
				attempt: message.attempts,
				nextDelaySeconds: delaySeconds,
				error: msg,
			});
			message.retry({ delaySeconds });
			return;
		}

		console.error("[ResearchQueue] Gemini adverse media failed permanently", {
			searchId: job.searchId,
			attempt: message.attempts,
			error: msg,
		});
		await failAdverseMediaResearch(env, {
			searchId: job.searchId,
			error: msg,
			logPrefix: "[ResearchQueue/Gemini adverse]",
		});
	}
}
