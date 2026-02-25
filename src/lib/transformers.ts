import { parseJsonField } from "../endpoints/watchlist/base";
import type { Prisma } from "@prisma/client";

type WatchlistIngestionRunPrisma = Prisma.WatchlistIngestionRunGetPayload<
	Record<string, never>
>;

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
