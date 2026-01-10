import type { Context } from "hono";
import type { Bindings } from "./index";

export interface IngestionJob {
	runId: number;
	csvUrl: string;
	reindexAll: boolean;
}

export type AppContext = Context<{ Bindings: Bindings }>;
export type HandleArgs = [AppContext];
