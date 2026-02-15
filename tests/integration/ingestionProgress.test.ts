import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { IngestionProgressEndpoint } from "../../src/endpoints/watchlist/ingestionProgress";
import type { Bindings } from "../../src/index";

describe("Ingestion Progress API", () => {
	let testRunId: number;

	beforeAll(async () => {
		const prisma = createPrismaClient((env as any).DB);

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
		const prisma = createPrismaClient((env as any).DB);

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

	describe("GET /admin/ingestion/runs/:runId/progress", () => {
		it("should return progress for an existing run", async () => {
			const response = await SELF.fetch(
				`http://local.test/admin/ingestion/runs/${testRunId}/progress`,
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
				"http://local.test/admin/ingestion/runs/999999/progress",
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
			const prisma = createPrismaClient((env as any).DB);

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
				`http://local.test/admin/ingestion/runs/${run.id}/progress`,
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
			const prisma = createPrismaClient((env as any).DB);

			const run = await prisma.watchlistIngestionRun.create({
				data: {
					sourceUrl: "test-progress-running.csv",
					sourceType: "csv_url",
					status: "running",
					progressPhase: null,
				},
			});

			const response = await SELF.fetch(
				`http://local.test/admin/ingestion/runs/${run.id}/progress`,
			);

			expect(response.status).toBe(200);

			const body = await response.json<{ success: boolean; result: any }>();

			expect(body.success).toBe(true);
			expect(body.result.phase).toBe("initializing");
		});

		it("should map 'completed' status to 'completed' phase", async () => {
			const prisma = createPrismaClient((env as any).DB);

			const run = await prisma.watchlistIngestionRun.create({
				data: {
					sourceUrl: "test-progress-completed.csv",
					sourceType: "csv_url",
					status: "completed",
					progressPhase: null,
				},
			});

			const response = await SELF.fetch(
				`http://local.test/admin/ingestion/runs/${run.id}/progress`,
			);

			expect(response.status).toBe(200);

			const body = await response.json<{ success: boolean; result: any }>();

			expect(body.success).toBe(true);
			expect(body.result.phase).toBe("completed");
		});

		it("should map 'failed' status to 'failed' phase", async () => {
			const prisma = createPrismaClient((env as any).DB);

			const run = await prisma.watchlistIngestionRun.create({
				data: {
					sourceUrl: "test-progress-failed.csv",
					sourceType: "csv_url",
					status: "failed",
					progressPhase: null,
				},
			});

			const response = await SELF.fetch(
				`http://local.test/admin/ingestion/runs/${run.id}/progress`,
			);

			expect(response.status).toBe(200);

			const body = await response.json<{ success: boolean; result: any }>();

			expect(body.success).toBe(true);
			expect(body.result.phase).toBe("failed");
		});

		it("should map unknown status to 'idle' phase", async () => {
			const prisma = createPrismaClient((env as any).DB);

			const run = await prisma.watchlistIngestionRun.create({
				data: {
					sourceUrl: "test-progress-unknown.csv",
					sourceType: "csv_url",
					status: "unknown-status",
					progressPhase: null,
				},
			});

			const response = await SELF.fetch(
				`http://local.test/admin/ingestion/runs/${run.id}/progress`,
			);

			expect(response.status).toBe(200);

			const body = await response.json<{ success: boolean; result: any }>();

			expect(body.success).toBe(true);
			expect(body.result.phase).toBe("idle"); // default case
		});

		it("should prioritize progressPhase over status mapping", async () => {
			const prisma = createPrismaClient((env as any).DB);

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
				`http://local.test/admin/ingestion/runs/${run.id}/progress`,
			);

			expect(response.status).toBe(200);

			const body = await response.json<{ success: boolean; result: any }>();

			expect(body.success).toBe(true);
			expect(body.result.phase).toBe("completed"); // progressPhase wins
		});
	});
});

// =========================================================================
// Direct handle() tests with mocked THREAD_SVC for vectorize progress
// =========================================================================
describe("IngestionProgressEndpoint.handle() - Vectorize Progress", () => {
	let endpoint: IngestionProgressEndpoint;
	let prisma: ReturnType<typeof createPrismaClient>;
	let mockThreadSvc: { fetch: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		endpoint = new (IngestionProgressEndpoint as any)();
		prisma = createPrismaClient((env as any).DB);
		mockThreadSvc = { fetch: vi.fn() };
	});

	it("should combine ingestion and vectorize progress when thread running", async () => {
		// Create ingestion run with vectorize thread
		const run = await prisma.watchlistIngestionRun.create({
			data: {
				sourceUrl: "test-vectorize-combine.csv",
				sourceType: "csv_url",
				status: "running",
				progressPhase: "vectorizing",
				progressRecordsProcessed: 100,
				progressTotalEstimate: 100,
				progressPercentage: 70, // ingestion at 70%
				vectorizeThreadId: "thread-combine-test",
			},
		});

		// Mock THREAD_SVC response with 50% progress
		mockThreadSvc.fetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ status: "RUNNING", progress: 50 }), {
				status: 200,
			}),
		);

		const mockEnv = {
			DB: (env as any).DB,
			THREAD_SVC: mockThreadSvc as any,
		} as Bindings;

		(endpoint.getValidatedData as any) = async () => ({
			params: { runId: run.id },
		});

		const response = await endpoint.handle({
			env: mockEnv,
			req: {} as any,
		} as any);

		expect(response.success).toBe(true);
		expect(response.result.phase).toBe("vectorizing");
		// Combined: 70 + (50 * 0.3) = 70 + 15 = 85%
		expect(response.result.percentage).toBe(85);
	});

	it("should return 100% when vectorize thread completed", async () => {
		const prisma = createPrismaClient((env as any).DB);

		const run = await prisma.watchlistIngestionRun.create({
			data: {
				sourceUrl: "test-vectorize-done.csv",
				sourceType: "csv_url",
				status: "running",
				progressPhase: "vectorizing",
				progressRecordsProcessed: 100,
				progressTotalEstimate: 100,
				progressPercentage: 70,
				vectorizeThreadId: "thread-done-test",
			},
		});

		mockThreadSvc.fetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ status: "COMPLETED" }), {
				status: 200,
			}),
		);

		const mockEnv = {
			DB: (env as any).DB,
			THREAD_SVC: mockThreadSvc as any,
		} as Bindings;

		(endpoint.getValidatedData as any) = async () => ({
			params: { runId: run.id },
		});

		const response = await endpoint.handle({
			env: mockEnv,
			req: {} as any,
		} as any);

		expect(response.success).toBe(true);
		expect(response.result.percentage).toBe(100);
	});

	it("should set phase to vectorize_failed when thread failed", async () => {
		const prisma = createPrismaClient((env as any).DB);

		const run = await prisma.watchlistIngestionRun.create({
			data: {
				sourceUrl: "test-vectorize-failed.csv",
				sourceType: "csv_url",
				status: "running",
				progressPhase: "vectorizing",
				progressPercentage: 70,
				vectorizeThreadId: "thread-failed-test",
			},
		});

		mockThreadSvc.fetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ status: "FAILED" }), {
				status: 200,
			}),
		);

		const mockEnv = {
			DB: (env as any).DB,
			THREAD_SVC: mockThreadSvc as any,
		} as Bindings;

		(endpoint.getValidatedData as any) = async () => ({
			params: { runId: run.id },
		});

		const response = await endpoint.handle({
			env: mockEnv,
			req: {} as any,
		} as any);

		expect(response.success).toBe(true);
		expect(response.result.phase).toBe("vectorize_failed");
	});

	it("should handle THREAD_SVC fetch failure gracefully", async () => {
		const prisma = createPrismaClient((env as any).DB);

		const run = await prisma.watchlistIngestionRun.create({
			data: {
				sourceUrl: "test-vectorize-fetch-error.csv",
				sourceType: "csv_url",
				status: "running",
				progressPhase: "vectorizing",
				progressPercentage: 70,
				vectorizeThreadId: "thread-error-test",
			},
		});

		mockThreadSvc.fetch.mockRejectedValueOnce(new Error("Network error"));

		const mockEnv = {
			DB: (env as any).DB,
			THREAD_SVC: mockThreadSvc as any,
		} as Bindings;

		(endpoint.getValidatedData as any) = async () => ({
			params: { runId: run.id },
		});

		// Should not throw and return gracefully
		const response = await endpoint.handle({
			env: mockEnv,
			req: {} as any,
		} as any);

		expect(response.success).toBe(true);
		// Should fall back to ingestion progress
		expect(response.result.percentage).toBe(70);
	});

	it("should not call THREAD_SVC when vectorizeThreadId not set", async () => {
		const prisma = createPrismaClient((env as any).DB);

		const run = await prisma.watchlistIngestionRun.create({
			data: {
				sourceUrl: "test-vectorize-no-thread.csv",
				sourceType: "csv_url",
				status: "running",
				progressPhase: "processing",
				progressPercentage: 50,
				vectorizeThreadId: null,
			},
		});

		const mockEnv = {
			DB: (env as any).DB,
			THREAD_SVC: mockThreadSvc as any,
		} as Bindings;

		(endpoint.getValidatedData as any) = async () => ({
			params: { runId: run.id },
		});

		await endpoint.handle({ env: mockEnv, req: {} as any } as any);

		// Should never call THREAD_SVC
		expect(mockThreadSvc.fetch).not.toHaveBeenCalled();
	});

	it("should handle THREAD_SVC 500 response", async () => {
		const prisma = createPrismaClient((env as any).DB);

		const run = await prisma.watchlistIngestionRun.create({
			data: {
				sourceUrl: "test-vectorize-500.csv",
				sourceType: "csv_url",
				status: "running",
				progressPhase: "vectorizing",
				progressPercentage: 70,
				vectorizeThreadId: "thread-500-test",
			},
		});

		mockThreadSvc.fetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ error: "Internal error" }), {
				status: 500,
			}),
		);

		const mockEnv = {
			DB: (env as any).DB,
			THREAD_SVC: mockThreadSvc as any,
		} as Bindings;

		(endpoint.getValidatedData as any) = async () => ({
			params: { runId: run.id },
		});

		const response = await endpoint.handle({
			env: mockEnv,
			req: {} as any,
		} as any);

		expect(response.success).toBe(true);
		// Should fall back to ingestion progress
		expect(response.result.percentage).toBe(70);
	});
});
