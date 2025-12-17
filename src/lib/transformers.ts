import { parseJsonField } from "../endpoints/watchlist/base";
import type { WatchlistTarget } from "../endpoints/watchlist/base";
import type { Prisma } from "@prisma/client";

type WatchlistTargetPrisma = Prisma.WatchlistTargetGetPayload<
	Record<string, never>
>;
type WatchlistIngestionRunPrisma = Prisma.WatchlistIngestionRunGetPayload<
	Record<string, never>
>;

/**
 * Transform Prisma WatchlistTarget model to API response format
 */
export function transformWatchlistTarget(
	target: WatchlistTargetPrisma,
): WatchlistTarget {
	return {
		id: target.id,
		schema: target.schema,
		name: target.name,
		aliases: parseJsonField<string[]>(target.aliases),
		birthDate: target.birthDate,
		countries: parseJsonField<string[]>(target.countries),
		addresses: parseJsonField<string[]>(target.addresses),
		identifiers: parseJsonField<string[]>(target.identifiers),
		sanctions: parseJsonField<string[]>(target.sanctions),
		phones: parseJsonField<string[]>(target.phones),
		emails: parseJsonField<string[]>(target.emails),
		programIds: parseJsonField<string[]>(target.programIds),
		dataset: target.dataset,
		firstSeen: target.firstSeen,
		lastSeen: target.lastSeen,
		lastChange: target.lastChange,
		createdAt: target.createdAt.toISOString(),
		updatedAt: target.updatedAt.toISOString(),
	};
}

/**
 * Transform Prisma WatchlistIngestionRun model to API response format
 */
export function transformIngestionRun(run: WatchlistIngestionRunPrisma): {
	id: number;
	sourceUrl: string;
	status: "running" | "completed" | "failed";
	startedAt: string;
	finishedAt: string | null;
	stats: Record<string, unknown> | null;
	errorMessage: string | null;
	createdAt: string;
} {
	return {
		id: run.id,
		sourceUrl: run.sourceUrl,
		status: run.status as "running" | "completed" | "failed",
		startedAt: run.startedAt.toISOString(),
		finishedAt: run.finishedAt?.toISOString() || null,
		stats: parseJsonField<Record<string, unknown>>(run.stats),
		errorMessage: run.errorMessage,
		createdAt: run.createdAt.toISOString(),
	};
}
