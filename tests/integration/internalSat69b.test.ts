import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";

/**
 * Internal SAT 69-B Endpoint Tests
 *
 * Tests for the container callback endpoints used by sat_69b_parse
 * to stream batch inserts into D1 during SAT 69-B ingestion.
 *
 * These endpoints are internal (no auth) and called by the container
 * during the ingestion flow:
 * 1. POST /internal/sat69b/truncate  - clear existing records
 * 2. POST /internal/sat69b/batch     - insert a batch of records
 * 3. POST /internal/sat69b/complete  - mark ingestion as completed
 * 4. POST /internal/sat69b/failed    - mark ingestion as failed
 */
describe("Internal SAT 69-B Endpoints", () => {
	let prisma: ReturnType<typeof createPrismaClient>;
	let testRunId: number;

	beforeEach(async () => {
		prisma = createPrismaClient(env.DB);
		// Clean up tables
		await prisma.sat69bEntry.deleteMany({});
		await prisma.watchlistIdentifier.deleteMany({
			where: { dataset: "sat_69b" },
		});
		await prisma.watchlistIngestionRun.deleteMany({});

		// Create a test ingestion run for callbacks to reference
		const run = await prisma.watchlistIngestionRun.create({
			data: {
				sourceUrl: "r2://test/sat_69b.csv",
				sourceType: "sat_69b_csv",
				status: "running",
			},
		});
		testRunId = run.id;
	});

	// =========================================================================
	// POST /internal/sat69b/truncate
	// =========================================================================
	describe("POST /internal/sat69b/truncate", () => {
		it("should truncate sat_69b_entry table and return deleted count", async () => {
			// Seed some records
			await prisma.sat69bEntry.createMany({
				data: [
					{
						id: "RFC001",
						rfc: "RFC001",
						taxpayerName: "Test Taxpayer One",
						taxpayerStatus: "Definitivo",
					},
					{
						id: "RFC002",
						rfc: "RFC002",
						taxpayerName: "Test Taxpayer Two",
						taxpayerStatus: "Presunto",
					},
				],
			});

			const response = await SELF.fetch(
				"http://local.test/internal/sat69b/truncate",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ run_id: testRunId }),
				},
			);

			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				success: boolean;
				deleted_count: number;
			};
			expect(body.success).toBe(true);
			expect(body.deleted_count).toBe(2);

			// Verify table is actually empty
			const count = await prisma.sat69bEntry.count();
			expect(count).toBe(0);
		});

		it("should update run status to inserting phase", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/sat69b/truncate",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ run_id: testRunId }),
				},
			);

			expect(response.status).toBe(200);

			// Verify run progress was updated
			const run = await prisma.watchlistIngestionRun.findUnique({
				where: { id: testRunId },
			});
			expect(run?.progressPhase).toBe("inserting");
			expect(run?.progressRecordsProcessed).toBe(0);
			expect(run?.progressPercentage).toBe(0);
		});

		it("should handle truncate when table is already empty", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/sat69b/truncate",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ run_id: testRunId }),
				},
			);

			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				success: boolean;
				deleted_count: number;
			};
			expect(body.success).toBe(true);
			expect(body.deleted_count).toBe(0);
		});
	});

	// =========================================================================
	// POST /internal/sat69b/batch
	// =========================================================================
	describe("POST /internal/sat69b/batch", () => {
		it("should insert a batch of SAT 69-B records", async () => {
			const batchData = {
				run_id: testRunId,
				batch_number: 1,
				records: [
					{
						id: "RFC123",
						row_number: 1,
						rfc: "RFC123",
						taxpayer_name: "Taxpayer Alpha",
						taxpayer_status: "Definitivo",
						definitive_sat_notice: "SAT-001/2024",
						definitive_sat_date: "2024-01-15",
					},
					{
						id: "RFC456",
						row_number: 2,
						rfc: "RFC456",
						taxpayer_name: "Taxpayer Beta",
						taxpayer_status: "Presunto",
						presumption_sat_notice: "SAT-002/2024",
						presumption_sat_date: "2024-02-20",
					},
				],
				identifiers: [
					{
						identifier: "RFC123",
						identifier_norm: "rfc123",
						dataset: "sat_69b",
						record_id: "RFC123",
					},
					{
						identifier: "RFC456",
						identifier_norm: "rfc456",
						dataset: "sat_69b",
						record_id: "RFC456",
					},
				],
			};

			const response = await SELF.fetch(
				"http://local.test/internal/sat69b/batch",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(batchData),
				},
			);

			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				success: boolean;
				inserted: number;
			};
			expect(body.success).toBe(true);
			expect(body.inserted).toBe(2);

			// Verify records were actually inserted
			const records = await prisma.sat69bEntry.findMany();
			expect(records).toHaveLength(2);
			expect(records[0].rfc).toBe("RFC123");
			expect(records[0].taxpayerStatus).toBe("Definitivo");
			expect(records[1].rfc).toBe("RFC456");
			expect(records[1].taxpayerStatus).toBe("Presunto");

			// Verify identifiers were inserted
			const identifiers = await prisma.watchlistIdentifier.findMany({
				where: { dataset: "sat_69b" },
			});
			expect(identifiers).toHaveLength(2);
		});

		it("should handle empty batch gracefully", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/sat69b/batch",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						batch_number: 1,
						records: [],
						identifiers: [],
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				success: boolean;
				inserted: number;
			};
			expect(body.success).toBe(true);
			expect(body.inserted).toBe(0);
		});

		it("should update progress with accumulated records count", async () => {
			const record = {
				id: "RFCTEST1",
				row_number: 1,
				rfc: "RFCTEST1",
				taxpayer_name: "Test Taxpayer",
				taxpayer_status: "Definitivo",
			};

			// Update run with total estimate for progress calculation
			await prisma.watchlistIngestionRun.update({
				where: { id: testRunId },
				data: { progressTotalEstimate: 2 },
			});

			// Send first batch
			await SELF.fetch("http://local.test/internal/sat69b/batch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					run_id: testRunId,
					batch_number: 1,
					records: [record],
					identifiers: [],
				}),
			});

			// Send second batch
			await SELF.fetch("http://local.test/internal/sat69b/batch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					run_id: testRunId,
					batch_number: 2,
					records: [{ ...record, id: "RFCTEST2", rfc: "RFCTEST2" }],
					identifiers: [],
				}),
			});

			// Verify accumulated progress
			const run = await prisma.watchlistIngestionRun.findUnique({
				where: { id: testRunId },
			});
			expect(run?.progressRecordsProcessed).toBe(2);
			expect(run?.progressCurrentBatch).toBe(2);
		});
	});

	// =========================================================================
	// POST /internal/sat69b/complete
	// =========================================================================
	describe("POST /internal/sat69b/complete", () => {
		it("should mark run as completed with stats", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/sat69b/complete",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						total_records: 500,
						total_batches: 5,
						errors: [],
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { success: boolean };
			expect(body.success).toBe(true);

			// Verify run status
			const run = await prisma.watchlistIngestionRun.findUnique({
				where: { id: testRunId },
			});
			expect(run?.status).toBe("completed");
			expect(run?.progressPhase).toBe("completed");
			expect(run?.progressPercentage).toBe(100);
			expect(run?.progressRecordsProcessed).toBe(500);
			expect(run?.finishedAt).not.toBeNull();

			// Verify stats JSON
			const stats = JSON.parse(run?.stats ?? "{}");
			expect(stats.totalRecords).toBe(500);
			expect(stats.totalBatches).toBe(5);
		});

		it("should store errors in stats (truncated to 100)", async () => {
			const errors = Array.from({ length: 150 }, (_, i) => `Error ${i}`);

			const response = await SELF.fetch(
				"http://local.test/internal/sat69b/complete",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						total_records: 100,
						total_batches: 1,
						errors,
					}),
				},
			);

			expect(response.status).toBe(200);

			const run = await prisma.watchlistIngestionRun.findUnique({
				where: { id: testRunId },
			});
			const stats = JSON.parse(run?.stats ?? "{}");
			expect(stats.errors).toHaveLength(100);
		});

		it("should handle completion when run_id does not exist", async () => {
			const nonExistentRunId = 99999;

			const response = await SELF.fetch(
				"http://local.test/internal/sat69b/complete",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: nonExistentRunId,
						total_records: 100,
						total_batches: 1,
						errors: [],
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { success: boolean };
			expect(body.success).toBe(true);
		});

		it("should skip vectorization when skip_vectorization is true", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/sat69b/complete",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						total_records: 100,
						total_batches: 1,
						errors: [],
						skip_vectorization: true,
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				success: boolean;
				vectorization_thread_id: string | null;
			};
			expect(body.success).toBe(true);
			expect(body.vectorization_thread_id).toBeNull();
		});

		it("should skip vectorization when total_records is 0", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/sat69b/complete",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						total_records: 0,
						total_batches: 0,
						errors: [],
						skip_vectorization: false,
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				success: boolean;
				vectorization_thread_id: string | null;
			};
			expect(body.success).toBe(true);
			expect(body.vectorization_thread_id).toBeNull();
		});
	});

	// =========================================================================
	// POST /internal/sat69b/failed
	// =========================================================================
	describe("POST /internal/sat69b/failed", () => {
		it("should mark run as failed with error message", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/sat69b/failed",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						error: "Parse error: malformed CSV at row 42",
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { success: boolean };
			expect(body.success).toBe(true);

			// Verify run status
			const run = await prisma.watchlistIngestionRun.findUnique({
				where: { id: testRunId },
			});
			expect(run?.status).toBe("failed");
			expect(run?.progressPhase).toBe("failed");
			expect(run?.finishedAt).not.toBeNull();
			expect(run?.errorMessage).toBe("Parse error: malformed CSV at row 42");
		});

		it("should truncate long error messages to 1000 chars", async () => {
			const longError = "x".repeat(2000);

			const response = await SELF.fetch(
				"http://local.test/internal/sat69b/failed",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						error: longError,
					}),
				},
			);

			expect(response.status).toBe(200);

			const run = await prisma.watchlistIngestionRun.findUnique({
				where: { id: testRunId },
			});
			expect(run?.errorMessage?.length).toBe(1000);
		});

		it("should handle failure when run_id does not exist", async () => {
			const nonExistentRunId = 99999;

			const response = await SELF.fetch(
				"http://local.test/internal/sat69b/failed",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: nonExistentRunId,
						error: "Test error",
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { success: boolean };
			expect(body.success).toBe(true);
		});
	});
});
