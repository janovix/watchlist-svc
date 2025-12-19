import type { Context } from "hono";

// Extend Env with additional bindings
interface Env extends Cloudflare.Env {
	AI?: {
		run: (
			model: string,
			input: { text: string[] },
		) => Promise<{ data: number[][] }>;
	};
	ADMIN_API_KEY?: string;
	GROK_API_KEY?: string;
	XAI_BASE_URL?: string;
	XAI_MODEL?: string;
	XAI_MAX_TURNS?: string;
	INGESTION_QUEUE?: Queue<IngestionJob>;
	CORS_ALLOWED_DOMAIN?: string; // Base domain for CORS (e.g., "janovix.workers.dev")
}

export interface IngestionJob {
	runId: number;
	csvUrl: string;
	reindexAll: boolean;
}

export type AppContext = Context<{ Bindings: Env }>;
export type HandleArgs = [AppContext];
