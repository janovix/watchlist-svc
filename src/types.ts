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

export type AppContext = Context<{ Bindings: Bindings }>;
export type HandleArgs = [AppContext];
