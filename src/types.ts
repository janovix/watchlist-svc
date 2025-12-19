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
	XAI_COLLECTION_ID?: string;
	INGESTION_QUEUE?: Queue<IngestionJob>;
	CORS_ALLOWED_DOMAIN?: string; // Base domain for CORS (e.g., "janovix.workers.dev")
	/** Service binding to auth-svc for direct worker-to-worker communication */
	AUTH_SERVICE: Fetcher;
	/** Base URL for auth-svc (used to construct JWKS endpoint URL, optional) */
	AUTH_SERVICE_URL?: string;
	AUTH_JWKS_CACHE_TTL?: string;
}

export interface IngestionJob {
	runId: number;
	csvUrl: string;
	reindexAll: boolean;
}

export type AppContext = Context<{ Bindings: Env }>;
export type HandleArgs = [AppContext];
