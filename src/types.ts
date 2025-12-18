import type { Context } from "hono";
import type { SessionData } from "./lib/auth";

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
	INGESTION_QUEUE?: Queue<IngestionJob>;
	CORS_ALLOWED_DOMAIN?: string; // Base domain for CORS (e.g., "janovix.workers.dev")
	AUTH_SERVICE?: Fetcher; // Service binding to auth-svc worker
	AUTH_SERVICE_URL?: string; // Fallback URL for auth service (for local dev or HTTP)
}

export interface IngestionJob {
	runId: number;
	csvUrl: string;
	reindexAll: boolean;
}

// Extend context variables to include session data
interface Variables {
	session?: SessionData;
}

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;
export type HandleArgs = [AppContext];
