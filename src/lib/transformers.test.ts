import type { WatchlistIngestionRun } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { transformIngestionRun } from "./transformers";

describe("transformIngestionRun", () => {
	const started = new Date("2024-02-03T04:05:06.000Z");
	const created = new Date("2024-02-03T04:05:07.000Z");

	function baseRun(
		over: Partial<WatchlistIngestionRun> = {},
	): WatchlistIngestionRun {
		return {
			id: 1,
			sourceUrl: "https://example.com/list.csv",
			sourceType: "csv_url",
			status: "running",
			startedAt: started,
			finishedAt: null,
			stats: null,
			errorMessage: null,
			createdAt: created,
			progressPhase: null,
			progressRecordsProcessed: null,
			progressTotalEstimate: null,
			progressPercentage: null,
			progressCurrentBatch: null,
			progressUpdatedAt: null,
			vectorizeThreadId: null,
			...over,
		};
	}

	it("ISO-stringifies timestamps and leaves null finishedAt", () => {
		const out = transformIngestionRun(baseRun());
		expect(out.id).toBe(1);
		expect(out.sourceUrl).toBe("https://example.com/list.csv");
		expect(out.status).toBe("running");
		expect(out.startedAt).toBe(started.toISOString());
		expect(out.finishedAt).toBeNull();
		expect(out.stats).toBeNull();
		expect(out.errorMessage).toBeNull();
		expect(out.createdAt).toBe(created.toISOString());
	});

	it("parses stats JSON and serializes finishedAt when present", () => {
		const finished = new Date("2024-02-04T00:00:00.000Z");
		const out = transformIngestionRun(
			baseRun({
				status: "completed",
				finishedAt: finished,
				stats: JSON.stringify({ inserted: 10 }),
			}),
		);
		expect(out.status).toBe("completed");
		expect(out.finishedAt).toBe(finished.toISOString());
		expect(out.stats).toEqual({ inserted: 10 });
	});

	it("returns null stats for invalid JSON", () => {
		const out = transformIngestionRun(baseRun({ stats: "{not-json" }));
		expect(out.stats).toBeNull();
	});

	it("treats empty stats string as null", () => {
		const out = transformIngestionRun(baseRun({ stats: "" }));
		expect(out.stats).toBeNull();
	});
});
