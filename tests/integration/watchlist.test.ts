import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";

describe("Watchlist API Integration Tests", () => {
	beforeEach(async () => {
		// No cleanup needed - legacy tables removed
	});

	describe("GET /healthz", () => {
		it("should return health status", async () => {
			const response = await SELF.fetch("http://local.test/healthz");
			const body = await response.json<{
				success: boolean;
				result: { ok: boolean; timestamp: string };
			}>();

			expect(response.status).toBe(200);
			expect(body.success).toBe(true);
			expect(body.result.ok).toBe(true);
			expect(body.result.timestamp).toBeDefined();
			expect(new Date(body.result.timestamp).getTime()).toBeGreaterThan(0);
		});
	});

	describe("GET /admin/ingestion/runs", () => {
		it("should return empty list when no runs exist", async () => {
			const response = await SELF.fetch(
				"http://local.test/admin/ingestion/runs",
			);
			const body = await response.json<{
				success: boolean;
				result: Array<unknown>;
			}>();

			expect(response.status).toBe(200);
			expect(body.success).toBe(true);
			expect(body.result).toEqual([]);
		});

		it("should return list of ingestion runs", async () => {
			const prisma = createPrismaClient(env.DB);
			await prisma.watchlistIngestionRun.create({
				data: {
					sourceUrl: "https://example.com/test.csv",
					status: "completed",
					startedAt: new Date("2025-01-01T00:00:00Z"),
					finishedAt: new Date("2025-01-01T01:00:00Z"),
					stats: JSON.stringify({ totalRows: 100 }),
				},
			});

			const response = await SELF.fetch(
				"http://local.test/admin/ingestion/runs",
			);
			const body = await response.json<{
				success: boolean;
				result: Array<{
					id: number;
					sourceUrl: string;
					status: string;
				}>;
			}>();

			expect(response.status).toBe(200);
			expect(body.success).toBe(true);
			expect(body.result.length).toBe(1);
			expect(body.result[0].sourceUrl).toBe("https://example.com/test.csv");
			expect(body.result[0].status).toBe("completed");
		});

		it("should respect limit query parameter", async () => {
			const prisma = createPrismaClient(env.DB);
			// Create 5 runs
			for (let i = 0; i < 5; i++) {
				await prisma.watchlistIngestionRun.create({
					data: {
						sourceUrl: `https://example.com/test-${i}.csv`,
						status: "completed",
						startedAt: new Date(`2025-01-0${i + 1}T00:00:00Z`),
					},
				});
			}

			const response = await SELF.fetch(
				"http://local.test/admin/ingestion/runs?limit=2",
			);
			const body = await response.json<{
				success: boolean;
				result: Array<unknown>;
			}>();

			expect(response.status).toBe(200);
			expect(body.success).toBe(true);
			expect(body.result.length).toBe(2);
		});
	});

	describe("GET /admin/ingestion/runs/:runId", () => {
		it("should return 404 for non-existent run", async () => {
			const response = await SELF.fetch(
				"http://local.test/admin/ingestion/runs/99999",
			);
			const body = await response.json<{
				success: boolean;
				errors: Array<{ code: number; message: string }>;
			}>();

			expect(response.status).toBe(404);
			expect(body.success).toBe(false);
			expect(body.errors[0].code).toBe(404);
		});

		it("should return ingestion run when it exists", async () => {
			const prisma = createPrismaClient(env.DB);
			const run = await prisma.watchlistIngestionRun.create({
				data: {
					sourceUrl: "https://example.com/test.csv",
					status: "completed",
					startedAt: new Date("2025-01-01T00:00:00Z"),
					finishedAt: new Date("2025-01-01T01:00:00Z"),
					stats: JSON.stringify({ totalRows: 100, parsedRows: 95 }),
				},
			});

			const response = await SELF.fetch(
				`http://local.test/admin/ingestion/runs/${run.id}`,
			);
			const body = await response.json<{
				success: boolean;
				result: {
					id: number;
					sourceUrl: string;
					status: string;
					stats: unknown;
				};
			}>();

			expect(response.status).toBe(200);
			expect(body.success).toBe(true);
			expect(body.result.id).toBe(run.id);
			expect(body.result.sourceUrl).toBe("https://example.com/test.csv");
			expect(body.result.status).toBe("completed");
			expect(body.result.stats).toEqual({ totalRows: 100, parsedRows: 95 });
		});
	});
});
