import { z } from "zod";

// Zod schemas for watchlist data
export const watchlistTarget = z.object({
	id: z.string(),
	schema: z.string().nullable(),
	name: z.string().nullable(),
	aliases: z.array(z.string()).nullable(),
	birthDate: z.string().nullable(),
	countries: z.array(z.string()).nullable(),
	addresses: z.array(z.string()).nullable(),
	identifiers: z.array(z.string()).nullable(),
	sanctions: z.array(z.string()).nullable(),
	phones: z.array(z.string()).nullable(),
	emails: z.array(z.string()).nullable(),
	programIds: z.array(z.string()).nullable(),
	dataset: z.string().nullable(),
	firstSeen: z.string().nullable(),
	lastSeen: z.string().nullable(),
	lastChange: z.string().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

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

export const watchlistVectorState = z.object({
	targetId: z.string(),
	lastIndexedAt: z.string().datetime(),
	lastIndexedChange: z.string().nullable(),
	vectorId: z.string(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

export type WatchlistTarget = z.infer<typeof watchlistTarget>;
export type WatchlistIngestionRun = z.infer<typeof watchlistIngestionRun>;
export type WatchlistVectorState = z.infer<typeof watchlistVectorState>;

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
