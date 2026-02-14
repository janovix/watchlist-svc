import type { Context } from "hono";
import type { Bindings } from "./index";

/**
 * Original CSV ingestion job (used by queue-consumer.ts)
 */
export interface IngestionJob {
	runId: number;
	csvUrl: string;
	reindexAll: boolean;
}

/**
 * Extended context with organization info from auth middleware
 */
export type AppContext = Context<{
	Bindings: Bindings;
	Variables: {
		organization?: { id: string } | null;
		user?: { id: string; email?: string; name?: string };
		token?: string;
		tokenPayload?: {
			sub: string;
			organizationId?: string | null;
			role?: string;
			[key: string]: unknown;
		};
	};
}>;
export type HandleArgs = [AppContext];
