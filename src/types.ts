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
 * SDN XML ingestion job (used by watchlist-ingest)
 */
export interface SdnXmlIngestionJob {
	runId: number;
	sourceType: "sdn_xml";
	r2Key: string;
	reindexAll?: boolean;
	batchSize?: number;
}

export type AppContext = Context<{ Bindings: Bindings }>;
export type HandleArgs = [AppContext];
