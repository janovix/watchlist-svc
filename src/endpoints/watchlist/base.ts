import { z } from "zod";

// Zod schemas for watchlist data
export const watchlistIngestionRun = z.object({
	id: z.number().int(),
	sourceUrl: z.string(),
	status: z.enum(["running", "completed", "failed"]),
	startedAt: z.string().datetime(),
	finishedAt: z.string().datetime().nullable(),
	stats: z.record(z.unknown()).nullable(),
	errorMessage: z.string().nullable(),
	createdAt: z.string().datetime(),
});

// Progress tracking schema for polling
export const ingestionProgressPhase = z.enum([
	"idle",
	"initializing",
	"downloading",
	"parsing",
	"inserting",
	"completed",
	"failed",
]);

export const ingestionProgress = z.object({
	phase: ingestionProgressPhase,
	recordsProcessed: z.number().int(),
	totalRecordsEstimate: z.number().int(),
	percentage: z.number().int().min(0).max(100),
	currentBatch: z.number().int(),
	updatedAt: z.string().datetime().nullable(),
});

export type IngestionProgress = z.infer<typeof ingestionProgress>;
export type WatchlistIngestionRun = z.infer<typeof watchlistIngestionRun>;

// Helper to parse JSON fields from D1
export function parseJsonField<T>(value: string | null): T | null {
	if (value === null || value === "") return null;
	try {
		return JSON.parse(value) as T;
	} catch {
		return null;
	}
}

// Helper to serialize JSON fields for D1
export function serializeJsonField(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	try {
		return JSON.stringify(value);
	} catch {
		return null;
	}
}
