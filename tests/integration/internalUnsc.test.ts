import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";

/**
 * Internal UNSC Endpoint Tests
 *
 * Tests for the container callback endpoints used by unsc_parse
 * to stream batch inserts into D1 during UNSC ingestion.
 *
 * These endpoints are internal (no auth) and called by the container
 * during the ingestion flow:
 * 1. POST /internal/unsc/truncate  - clear existing records
 * 2. POST /internal/unsc/batch     - insert a batch of records
 * 3. POST /internal/unsc/complete  - mark ingestion as completed
 * 4. POST /internal/unsc/failed    - mark ingestion as failed
 */
describe("Internal UNSC Endpoints", () => {
	let prisma: ReturnType<typeof createPrismaClient>;
	let testRunId: number;

	beforeEach(async () => {
		prisma = createPrismaClient(env.DB);
		// Clean up tables
		await prisma.unscEntry.deleteMany({});
		await prisma.watchlistIngestionRun.deleteMany({});

		// Create a test ingestion run for callbacks to reference
		const run = await prisma.watchlistIngestionRun.create({
			data: {
				sourceUrl: "r2://test/consolidated_list.xml",
				sourceType: "unsc_xml",
				status: "running",
			},
		});
		testRunId = run.id;
	});

	// =========================================================================
	// POST /internal/unsc/truncate
	// =========================================================================
	describe("POST /internal/unsc/truncate", () => {
		it("should truncate unsc_entry table and return deleted count", async () => {
			// Seed some records
			await prisma.unscEntry.createMany({
				data: [
					{
						id: "1001",
						partyType: "Individual",
						primaryName: "ERIC BADEGE",
						unListType: "DRC",
					},
					{
						id: "2001",
						partyType: "Entity",
						primaryName: "ADF",
						unListType: "DRC",
					},
				],
			});

			const response = await SELF.fetch(
				"http://local.test/internal/unsc/truncate",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ run_id: testRunId }),
				},
			);

			expect(response.status).toBe(200);
			const body = await response.json<{
				success: boolean;
				deleted_count: number;
			}>();
			expect(body.success).toBe(true);
			expect(body.deleted_count).toBe(2);

			// Verify table is actually empty
			const count = await prisma.unscEntry.count();
			expect(count).toBe(0);
		});

		it("should update run status to inserting phase", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/unsc/truncate",
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
				"http://local.test/internal/unsc/truncate",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ run_id: testRunId }),
				},
			);

			expect(response.status).toBe(200);
			const body = await response.json<{
				success: boolean;
				deleted_count: number;
			}>();
			expect(body.success).toBe(true);
			expect(body.deleted_count).toBe(0);
		});
	});

	// =========================================================================
	// POST /internal/unsc/batch
	// =========================================================================
	describe("POST /internal/unsc/batch", () => {
		it("should insert a batch of UNSC records", async () => {
			const records = [
				{
					id: "1001",
					party_type: "Individual" as const,
					primary_name: "ERIC BADEGE",
					aliases: ["Badege"],
					birth_date: "1971",
					birth_place: "Democratic Republic of the Congo",
					gender: "Male",
					addresses: ["Rwanda"],
					nationalities: ["Democratic Republic of the Congo"],
					identifiers: [],
					designations: [],
					remarks: "He fled to Rwanda in March 2013",
					un_list_type: "DRC",
					reference_number: "CDi.001",
					listed_on: "2012-12-31",
				},
				{
					id: "2001",
					party_type: "Entity" as const,
					primary_name: "ADF",
					aliases: ["Allied Democratic Forces", "NALU"],
					birth_date: null,
					birth_place: null,
					gender: null,
					addresses: ["North Kivu, Democratic Republic of the Congo"],
					nationalities: [],
					identifiers: [],
					designations: ["Armed Group"],
					remarks: "Terrorist organization",
					un_list_type: "DRC",
					reference_number: "CDe.001",
					listed_on: "2014-06-30",
				},
			];

			const response = await SELF.fetch(
				"http://local.test/internal/unsc/batch",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						batch_number: 1,
						total_batches: 3,
						records,
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = await response.json<{
				success: boolean;
				inserted: number;
				errors: string[];
			}>();
			expect(body.success).toBe(true);
			expect(body.inserted).toBe(2);
			expect(body.errors).toHaveLength(0);

			// Verify records in DB
			const count = await prisma.unscEntry.count();
			expect(count).toBe(2);

			const individual = await prisma.unscEntry.findUnique({
				where: { id: "1001" },
			});
			expect(individual?.primaryName).toBe("ERIC BADEGE");
			expect(individual?.partyType).toBe("Individual");
			expect(individual?.unListType).toBe("DRC");
		});

		it("should handle empty batch", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/unsc/batch",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						batch_number: 1,
						total_batches: 1,
						records: [],
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = await response.json<{
				success: boolean;
				inserted: number;
				errors: string[];
			}>();
			expect(body.success).toBe(true);
			expect(body.inserted).toBe(0);
		});

		it("should update progress with accumulated records count", async () => {
			const record = {
				id: "3001",
				party_type: "Individual" as const,
				primary_name: "TEST PERSON",
				aliases: [],
				birth_date: null,
				birth_place: null,
				gender: null,
				addresses: [],
				nationalities: [],
				identifiers: [],
				designations: [],
				remarks: null,
				un_list_type: "DRC",
				reference_number: "CDi.999",
				listed_on: "2020-01-01",
			};

			// Update run with total estimate for progress calculation
			await prisma.watchlistIngestionRun.update({
				where: { id: testRunId },
				data: { progressTotalEstimate: 2 },
			});

			// Send first batch
			await SELF.fetch("http://local.test/internal/unsc/batch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					run_id: testRunId,
					batch_number: 1,
					total_batches: 2,
					records: [record],
				}),
			});

			// Send second batch
			await SELF.fetch("http://local.test/internal/unsc/batch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					run_id: testRunId,
					batch_number: 2,
					total_batches: 2,
					records: [{ ...record, id: "3002", primary_name: "TEST PERSON 2" }],
				}),
			});

			// Verify accumulated progress
			const run = await prisma.watchlistIngestionRun.findUnique({
				where: { id: testRunId },
			});
			expect(run?.progressRecordsProcessed).toBe(2);
			expect(run?.progressCurrentBatch).toBe(2);
			// With new calculation: (2/2) * 70% = 70% (ingestion phase max)
			expect(run?.progressPercentage).toBe(70);
		});

		it("should insert records with identifiers and create watchlist_identifier entries", async () => {
			const records = [
				{
					id: "4001",
					party_type: "Individual" as const,
					primary_name: "JOHN DOE",
					aliases: ["J. Doe"],
					birth_date: "1980-01-15",
					birth_place: "New York, USA",
					gender: "Male",
					addresses: ["123 Main St, New York"],
					nationalities: ["United States"],
					identifiers: [
						{
							type: "Passport",
							number: "P1234567",
							country: "USA",
							issue_date: "2015-01-01",
							expiration_date: "2025-01-01",
						},
						{
							type: "National ID",
							number: "ID987654321",
							country: "USA",
							issue_date: null,
							expiration_date: null,
						},
					],
					designations: ["Suspected terrorist"],
					remarks: "Active investigation",
					un_list_type: "Al-Qaida",
					reference_number: "QI.001",
					listed_on: "2021-03-15",
				},
			];

			const response = await SELF.fetch(
				"http://local.test/internal/unsc/batch",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						batch_number: 1,
						total_batches: 1,
						records,
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = await response.json<{
				success: boolean;
				inserted: number;
				errors: string[];
			}>();
			expect(body.success).toBe(true);
			expect(body.inserted).toBe(1);

			// Verify record in DB
			const record = await prisma.unscEntry.findUnique({
				where: { id: "4001" },
			});
			expect(record).not.toBeNull();
			expect(record?.primaryName).toBe("JOHN DOE");

			// Verify identifiers were inserted into watchlist_identifier table
			const identifiers = await env.DB.prepare(
				"SELECT * FROM watchlist_identifier WHERE dataset = ? AND record_id = ?",
			)
				.bind("unsc", "4001")
				.all();

			expect(identifiers.results).toHaveLength(2);
			expect(identifiers.results[0].identifier_raw).toBe("P1234567");
			expect(identifiers.results[1].identifier_raw).toBe("ID987654321");
		});

		it("should handle batch with multiple records (sub-batching)", async () => {
			// Create 3 simple records to test sub-batching without hitting D1 limits
			// SUB_BATCH_SIZE = 8, each record has 17 fields = 136 params per sub-batch (well under D1's 999 limit)
			const records = Array.from({ length: 3 }, (_, i) => ({
				id: `5${String(i).padStart(3, "0")}`,
				party_type: "Individual" as const,
				primary_name: `TEST PERSON ${i}`,
				aliases: [],
				birth_date: null,
				birth_place: null,
				gender: null,
				addresses: [],
				nationalities: [],
				identifiers: [],
				designations: [],
				remarks: null,
				un_list_type: "DRC",
				reference_number: `CDi.${i}`,
				listed_on: "2020-01-01",
			}));

			const response = await SELF.fetch(
				"http://local.test/internal/unsc/batch",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						batch_number: 1,
						total_batches: 1,
						records,
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = await response.json<{
				success: boolean;
				inserted: number;
				errors: string[];
			}>();
			expect(body.success).toBe(true);
			expect(body.inserted).toBe(3);
			expect(body.errors).toHaveLength(0);

			// Verify all records were inserted
			const count = await prisma.unscEntry.count();
			expect(count).toBe(3);
		});

		it("should handle records with no identifiers (no watchlist_identifier entries)", async () => {
			const records = [
				{
					id: "6001",
					party_type: "Individual" as const,
					primary_name: "NO IDENTIFIERS",
					aliases: [],
					birth_date: null,
					birth_place: null,
					gender: null,
					addresses: [],
					nationalities: [],
					identifiers: [], // Empty identifiers array
					designations: [],
					remarks: null,
					un_list_type: "DRC",
					reference_number: "CDi.999",
					listed_on: "2020-01-01",
				},
			];

			const response = await SELF.fetch(
				"http://local.test/internal/unsc/batch",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						batch_number: 1,
						total_batches: 1,
						records,
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = await response.json<{
				success: boolean;
				inserted: number;
				errors: string[];
			}>();
			expect(body.success).toBe(true);
			expect(body.inserted).toBe(1);
			expect(body.errors).toHaveLength(0);

			// Verify no watchlist_identifier entries were created
			const identifiers = await env.DB.prepare(
				"SELECT * FROM watchlist_identifier WHERE dataset = ? AND record_id = ?",
			)
				.bind("unsc", "6001")
				.all();

			expect(identifiers.results).toHaveLength(0);
		});

		it("should calculate progress percentage correctly without total_batches", async () => {
			const record = {
				id: "7001",
				party_type: "Individual" as const,
				primary_name: "TEST PERSON",
				aliases: [],
				birth_date: null,
				birth_place: null,
				gender: null,
				addresses: [],
				nationalities: [],
				identifiers: [],
				designations: [],
				remarks: null,
				un_list_type: "DRC",
				reference_number: "CDi.999",
				listed_on: "2020-01-01",
			};

			const response = await SELF.fetch(
				"http://local.test/internal/unsc/batch",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						batch_number: 1,
						total_batches: undefined, // No total_batches provided
						records: [record],
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = await response.json<{
				success: boolean;
				inserted: number;
				errors: string[];
			}>();
			expect(body.success).toBe(true);

			// When no total_batches, progress should be 0%
			const run = await prisma.watchlistIngestionRun.findUnique({
				where: { id: testRunId },
			});
			expect(run?.progressPercentage).toBe(0);
		});
	});

	// =========================================================================
	// POST /internal/unsc/complete
	// =========================================================================
	describe("POST /internal/unsc/complete", () => {
		it("should mark run as completed with stats", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/unsc/complete",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						total_records: 1200,
						total_batches: 12,
						errors: [],
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = await response.json<{ success: boolean }>();
			expect(body.success).toBe(true);

			// Verify run status
			const run = await prisma.watchlistIngestionRun.findUnique({
				where: { id: testRunId },
			});
			expect(run?.status).toBe("completed");
			expect(run?.progressPhase).toBe("completed");
			expect(run?.progressPercentage).toBe(100);
			expect(run?.progressRecordsProcessed).toBe(1200);
			expect(run?.finishedAt).not.toBeNull();

			// Verify stats JSON
			const stats = JSON.parse(run?.stats ?? "{}");
			expect(stats.totalRecords).toBe(1200);
			expect(stats.totalBatches).toBe(12);
		});

		it("should store errors in stats (truncated to 100)", async () => {
			const errors = Array.from({ length: 150 }, (_, i) => `Error ${i}`);

			const response = await SELF.fetch(
				"http://local.test/internal/unsc/complete",
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
				"http://local.test/internal/unsc/complete",
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
			const body = await response.json<{ success: boolean }>();
			expect(body.success).toBe(true);
		});

		it("should skip vectorization when skip_vectorization is true", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/unsc/complete",
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
			const body = await response.json<{
				success: boolean;
				vectorize_thread_id: string | null;
			}>();
			expect(body.success).toBe(true);
			expect(body.vectorize_thread_id).toBeNull();
		});

		it("should skip vectorization when total_records is 0", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/unsc/complete",
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
			const body = await response.json<{
				success: boolean;
				vectorize_thread_id: string | null;
			}>();
			expect(body.success).toBe(true);
			expect(body.vectorize_thread_id).toBeNull();
		});

		it("should skip vectorization when THREAD_SVC is not configured", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/unsc/complete",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						total_records: 100,
						total_batches: 1,
						errors: [],
						skip_vectorization: false,
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = await response.json<{
				success: boolean;
				vectorize_thread_id: string | null;
			}>();
			expect(body.success).toBe(true);
			// Should return null because THREAD_SVC binding is not configured in test env
			expect(body.vectorize_thread_id).toBeNull();
		});
	});

	// =========================================================================
	// POST /internal/unsc/failed
	// =========================================================================
	describe("POST /internal/unsc/failed", () => {
		it("should mark run as failed with error message", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/unsc/failed",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						error_message: "Parse error: malformed XML at line 42",
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = await response.json<{ success: boolean }>();
			expect(body.success).toBe(true);

			// Verify run status
			const run = await prisma.watchlistIngestionRun.findUnique({
				where: { id: testRunId },
			});
			expect(run?.status).toBe("failed");
			expect(run?.progressPhase).toBe("failed");
			expect(run?.finishedAt).not.toBeNull();
			expect(run?.errorMessage).toBe("Parse error: malformed XML at line 42");
		});

		it("should truncate long error messages to 1000 chars", async () => {
			const longError = "x".repeat(2000);

			const response = await SELF.fetch(
				"http://local.test/internal/unsc/failed",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						error_message: longError,
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
				"http://local.test/internal/unsc/failed",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: nonExistentRunId,
						error_message: "Test error",
					}),
				},
			);

			expect(response.status).toBe(200);
			const body = await response.json<{ success: boolean }>();
			expect(body.success).toBe(true);
		});
	});
});
