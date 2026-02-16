import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";

/**
 * Internal OFAC Endpoint Tests
 *
 * Tests for the container callback endpoints used by ofac_parse
 * to stream batch inserts into D1 during OFAC ingestion.
 *
 * These endpoints are internal (no auth) and called by the container
 * during the ingestion flow:
 * 1. POST /internal/ofac/truncate  - clear existing records
 * 2. POST /internal/ofac/batch     - insert a batch of records
 * 3. POST /internal/ofac/complete  - mark ingestion as completed
 * 4. POST /internal/ofac/failed    - mark ingestion as failed
 */
describe("Internal OFAC Endpoints", () => {
	let prisma: ReturnType<typeof createPrismaClient>;
	let testRunId: number;

	beforeEach(async () => {
		prisma = createPrismaClient(env.DB);
		// Clean up tables
		await prisma.ofacSdnEntry.deleteMany({});
		await prisma.watchlistIngestionRun.deleteMany({});

		// Create a test ingestion run for callbacks to reference
		const run = await prisma.watchlistIngestionRun.create({
			data: {
				sourceUrl: "r2://test/sdn_advanced.xml",
				sourceType: "sdn_xml",
				status: "running",
			},
		});
		testRunId = run.id;
	});

	// =========================================================================
	// POST /internal/ofac/truncate
	// =========================================================================
	describe("POST /internal/ofac/truncate", () => {
		it("should truncate ofac_sdn_entry table and return deleted count", async () => {
			// Seed some records
			await prisma.ofacSdnEntry.createMany({
				data: [
					{
						id: "1001",
						partyType: "Individual",
						primaryName: "Test Person One",
						sourceList: "SDN List",
					},
					{
						id: "1002",
						partyType: "Entity",
						primaryName: "Test Entity",
						sourceList: "SDN List",
					},
				],
			});

			const response = await SELF.fetch(
				"http://local.test/internal/ofac/truncate",
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
			const count = await prisma.ofacSdnEntry.count();
			expect(count).toBe(0);
		});

		it("should update run status to inserting phase", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/ofac/truncate",
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
				"http://local.test/internal/ofac/truncate",
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
	// POST /internal/ofac/batch
	// =========================================================================
	describe("POST /internal/ofac/batch", () => {
		it("should insert a batch of records", async () => {
			const records = [
				{
					id: "2001",
					party_type: "Individual" as const,
					primary_name: "JOHN DOE",
					aliases: ["JD", "Johnny"],
					birth_date: "1980-01-15",
					birth_place: "New York, USA",
					addresses: ["123 Main St, NY"],
					identifiers: [
						{
							type: "Passport",
							number: "ABC123",
							country: "US",
						},
					],
					remarks: "Test remark",
					source_list: "SDN List",
				},
				{
					id: "2002",
					party_type: "Entity" as const,
					primary_name: "EVIL CORP",
					aliases: [],
					birth_date: null,
					birth_place: null,
					addresses: ["456 Bad Ln"],
					identifiers: [],
					remarks: null,
					source_list: "SDN List",
				},
			];

			const response = await SELF.fetch(
				"http://local.test/internal/ofac/batch",
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
			const count = await prisma.ofacSdnEntry.count();
			expect(count).toBe(2);

			const person = await prisma.ofacSdnEntry.findUnique({
				where: { id: "2001" },
			});
			expect(person?.primaryName).toBe("JOHN DOE");
			expect(person?.partyType).toBe("Individual");
		});

		it("should handle empty batch", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/ofac/batch",
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
				primary_name: "TEST",
				aliases: [],
				birth_date: null,
				birth_place: null,
				addresses: [],
				identifiers: [],
				remarks: null,
				source_list: "SDN List",
			};

			// Update run with total estimate for progress calculation
			await prisma.watchlistIngestionRun.update({
				where: { id: testRunId },
				data: { progressTotalEstimate: 2 },
			});

			// Send first batch
			await SELF.fetch("http://local.test/internal/ofac/batch", {
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
			await SELF.fetch("http://local.test/internal/ofac/batch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					run_id: testRunId,
					batch_number: 2,
					total_batches: 2,
					records: [{ ...record, id: "3002", primary_name: "TEST 2" }],
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

		it("should handle records with identifiers and create watchlist_identifier entries", async () => {
			const records = [
				{
					id: "4001",
					party_type: "Individual" as const,
					primary_name: "JOHN DOE",
					aliases: ["J. Doe"],
					birth_date: "1980-01-15",
					birth_place: "New York, USA",
					addresses: ["123 Main St, New York"],
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
					remarks: "Active investigation",
					source_list: "SDN List",
				},
			];

			const response = await SELF.fetch(
				"http://local.test/internal/ofac/batch",
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
			const record = await prisma.ofacSdnEntry.findUnique({
				where: { id: "4001" },
			});
			expect(record).not.toBeNull();
			expect(record?.primaryName).toBe("JOHN DOE");

			// Verify identifiers were inserted into watchlist_identifier table
			// Note: Uses "ofac_sdn" dataset name, not "ofac"
			const identifiers = await env.DB.prepare(
				"SELECT * FROM watchlist_identifier WHERE dataset = ? AND record_id = ?",
			)
				.bind("ofac_sdn", "4001")
				.all();

			expect(identifiers.results).toHaveLength(2);
			expect(identifiers.results[0].identifier_raw).toBe("P1234567");
			expect(identifiers.results[1].identifier_raw).toBe("ID987654321");
		});

		it("should handle records with no identifiers (no watchlist_identifier entries)", async () => {
			const records = [
				{
					id: "5001",
					party_type: "Entity" as const,
					primary_name: "NO IDENTIFIERS",
					aliases: [],
					birth_date: null,
					birth_place: null,
					addresses: [],
					identifiers: [], // Empty identifiers array
					remarks: null,
					source_list: "SDN List",
				},
			];

			const response = await SELF.fetch(
				"http://local.test/internal/ofac/batch",
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

			// Verify no watchlist_identifier entries were created
			const identifiers = await env.DB.prepare(
				"SELECT * FROM watchlist_identifier WHERE dataset = ? AND record_id = ?",
			)
				.bind("ofac_sdn", "5001")
				.all();

			expect(identifiers.results).toHaveLength(0);
		});

		it("should calculate progress percentage correctly without total_batches", async () => {
			const record = {
				id: "6001",
				party_type: "Individual" as const,
				primary_name: "TEST PERSON",
				aliases: [],
				birth_date: null,
				birth_place: null,
				addresses: [],
				identifiers: [],
				remarks: null,
				source_list: "SDN List",
			};

			const response = await SELF.fetch(
				"http://local.test/internal/ofac/batch",
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
	// POST /internal/ofac/complete
	// =========================================================================
	describe("POST /internal/ofac/complete", () => {
		it("should mark run as completed with stats", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/ofac/complete",
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
			const body = await response.json<{ success: boolean }>();
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
				"http://local.test/internal/ofac/complete",
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
				"http://local.test/internal/ofac/complete",
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
				"http://local.test/internal/ofac/complete",
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
				vectorization_thread_id: string | null;
			}>();
			expect(body.success).toBe(true);
			expect(body.vectorization_thread_id).toBeNull();
		});

		it("should skip vectorization when total_records is 0", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/ofac/complete",
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
				vectorization_thread_id: string | null;
			}>();
			expect(body.success).toBe(true);
			expect(body.vectorization_thread_id).toBeNull();
		});

		it("should skip vectorization when THREAD_SVC is not configured", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/ofac/complete",
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
				vectorization_thread_id: string | null;
			}>();
			expect(body.success).toBe(true);
			// Should return null because THREAD_SVC binding is not configured in test env
			expect(body.vectorization_thread_id).toBeNull();
		});
	});

	// =========================================================================
	// POST /internal/ofac/failed
	// =========================================================================
	describe("POST /internal/ofac/failed", () => {
		it("should mark run as failed with error message", async () => {
			const response = await SELF.fetch(
				"http://local.test/internal/ofac/failed",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						run_id: testRunId,
						error: "Parse error: malformed XML at line 42",
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
				"http://local.test/internal/ofac/failed",
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
				"http://local.test/internal/ofac/failed",
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
			const body = await response.json<{ success: boolean }>();
			expect(body.success).toBe(true);
		});
	});
});
