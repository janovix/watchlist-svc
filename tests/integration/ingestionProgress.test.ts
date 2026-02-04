import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";

describe("Ingestion Progress API", () => {
	let testRunId: number;

	beforeAll(async () => {
		const prisma = createPrismaClient(env.DB);

		// Clean up any existing test data
		await prisma.watchlistIngestionRun.deleteMany({
			where: {
				OR: [
					{ sourceUrl: { startsWith: "test-progress-" } },
					{ id: { gte: 10000 } },
				],
			},
		});
	});

	beforeEach(async () => {
		const prisma = createPrismaClient(env.DB);

		// Create a test ingestion run
		const run = await prisma.watchlistIngestionRun.create({
			data: {
				sourceUrl: "test-progress-run.csv",
				sourceType: "csv_url",
				status: "running",
				progressPhase: "processing",
				progressRecordsProcessed: 50,
				progressTotalEstimate: 100,
				progressPercentage: 50,
				progressCurrentBatch: 2,
				progressUpdatedAt: new Date(),
			},
		});

		testRunId = run.id;
	});

	describe("GET /ingestion/runs/:runId/progress", () => {
		it("should return progress for an existing run", async () => {
			const response = await SELF.fetch(
				`http://local.test/ingestion/runs/${testRunId}/progress`,
			);

			expect(response.status).toBe(200);

			const body = await response.json<{
				success: boolean;
				result: {
					phase: string;
					recordsProcessed: number;
					totalRecordsEstimate: number;
					percentage: number;
					currentBatch: number;
					updatedAt: string | null;
				};
			}>();

			expect(body.success).toBe(true);
			expect(body.result.phase).toBe("processing");
			expect(body.result.recordsProcessed).toBe(50);
			expect(body.result.totalRecordsEstimate).toBe(100);
			expect(body.result.percentage).toBe(50);
			expect(body.result.currentBatch).toBe(2);
			expect(body.result.updatedAt).toBeTruthy();
		});

		it("should return 404 for non-existent run", async () => {
			const response = await SELF.fetch(
				"http://local.test/ingestion/runs/999999/progress",
			);

			expect(response.status).toBe(404);

			const body = await response.json<{
				success: boolean;
				errors: Array<{ code: number; message: string }>;
			}>();

			expect(body.success).toBe(false);
			expect(body.errors).toBeDefined();
			expect(body.errors[0].message).toBe("Ingestion run not found");
		});

		it("should map status to phase when progress fields are null", async () => {
			const prisma = createPrismaClient(env.DB);

			// Create a run without progress fields but with status
			const run = await prisma.watchlistIngestionRun.create({
				data: {
					sourceUrl: "test-progress-no-fields.csv",
					sourceType: "csv_url",
					status: "pending",
					progressPhase: null,
					progressRecordsProcessed: null,
					progressTotalEstimate: null,
					progressPercentage: null,
					progressCurrentBatch: null,
					progressUpdatedAt: null,
				},
			});

			const response = await SELF.fetch(
				`http://local.test/ingestion/runs/${run.id}/progress`,
			);

			expect(response.status).toBe(200);

			const body = await response.json<{
				success: boolean;
				result: {
					phase: string;
					recordsProcessed: number;
					totalRecordsEstimate: number;
					percentage: number;
					currentBatch: number;
					updatedAt: string | null;
				};
			}>();

			expect(body.success).toBe(true);
			expect(body.result.phase).toBe("idle"); // pending maps to idle
			expect(body.result.recordsProcessed).toBe(0);
			expect(body.result.totalRecordsEstimate).toBe(0);
			expect(body.result.percentage).toBe(0);
			expect(body.result.currentBatch).toBe(0);
			expect(body.result.updatedAt).toBeNull();
		});

		it("should map 'running' status to 'initializing' phase", async () => {
			const prisma = createPrismaClient(env.DB);

			const run = await prisma.watchlistIngestionRun.create({
				data: {
					sourceUrl: "test-progress-running.csv",
					sourceType: "csv_url",
					status: "running",
					progressPhase: null,
				},
			});

			const response = await SELF.fetch(
				`http://local.test/ingestion/runs/${run.id}/progress`,
			);

			expect(response.status).toBe(200);

			const body = await response.json<{ success: boolean; result: any }>();

			expect(body.success).toBe(true);
			expect(body.result.phase).toBe("initializing");
		});

		it("should map 'completed' status to 'completed' phase", async () => {
			const prisma = createPrismaClient(env.DB);

			const run = await prisma.watchlistIngestionRun.create({
				data: {
					sourceUrl: "test-progress-completed.csv",
					sourceType: "csv_url",
					status: "completed",
					progressPhase: null,
				},
			});

			const response = await SELF.fetch(
				`http://local.test/ingestion/runs/${run.id}/progress`,
			);

			expect(response.status).toBe(200);

			const body = await response.json<{ success: boolean; result: any }>();

			expect(body.success).toBe(true);
			expect(body.result.phase).toBe("completed");
		});

		it("should map 'failed' status to 'failed' phase", async () => {
			const prisma = createPrismaClient(env.DB);

			const run = await prisma.watchlistIngestionRun.create({
				data: {
					sourceUrl: "test-progress-failed.csv",
					sourceType: "csv_url",
					status: "failed",
					progressPhase: null,
				},
			});

			const response = await SELF.fetch(
				`http://local.test/ingestion/runs/${run.id}/progress`,
			);

			expect(response.status).toBe(200);

			const body = await response.json<{ success: boolean; result: any }>();

			expect(body.success).toBe(true);
			expect(body.result.phase).toBe("failed");
		});

		it("should map unknown status to 'idle' phase", async () => {
			const prisma = createPrismaClient(env.DB);

			const run = await prisma.watchlistIngestionRun.create({
				data: {
					sourceUrl: "test-progress-unknown.csv",
					sourceType: "csv_url",
					status: "unknown-status",
					progressPhase: null,
				},
			});

			const response = await SELF.fetch(
				`http://local.test/ingestion/runs/${run.id}/progress`,
			);

			expect(response.status).toBe(200);

			const body = await response.json<{ success: boolean; result: any }>();

			expect(body.success).toBe(true);
			expect(body.result.phase).toBe("idle"); // default case
		});

		it("should prioritize progressPhase over status mapping", async () => {
			const prisma = createPrismaClient(env.DB);

			// Create a run with both status and progressPhase set
			const run = await prisma.watchlistIngestionRun.create({
				data: {
					sourceUrl: "test-progress-priority.csv",
					sourceType: "csv_url",
					status: "running", // would map to 'initializing'
					progressPhase: "completed", // but this takes priority
				},
			});

			const response = await SELF.fetch(
				`http://local.test/ingestion/runs/${run.id}/progress`,
			);

			expect(response.status).toBe(200);

			const body = await response.json<{ success: boolean; result: any }>();

			expect(body.success).toBe(true);
			expect(body.result.phase).toBe("completed"); // progressPhase wins
		});
	});
});
