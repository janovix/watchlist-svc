/**
 * Structured logs for observability / dashboard pipelines (research shadow sampling).
 */

export type ResearchShadowLogPayload = {
	kind: "watchlist_research_shadow_sample";
	search_id: string;
	organization_id: string;
	research_kind: "pep_ai" | "adverse_media";
	provider: "gemini";
	latency_ms: number;
	summary: Record<string, unknown>;
};

export function logResearchShadowMetric(
	payload: ResearchShadowLogPayload,
): void {
	console.log(JSON.stringify(payload));
}
