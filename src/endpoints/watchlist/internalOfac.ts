/**
 * Internal OFAC endpoints for container callbacks.
 *
 * These endpoints are called by thread-worker-container during OFAC parsing
 * to insert batches of records into D1 and report completion.
 *
 * These are INTERNAL endpoints - not exposed to public API.
 * They should be secured via service binding authentication or internal tokens.
 */

import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { createPrismaClient } from "../../lib/prisma";
import type { Bindings } from "../../index";
import { getCallbackUrl } from "../../lib/ofac-vectorize-service";

// =============================================================================
// Schemas
// =============================================================================

/**
 * Identity document schema for OFAC records
 */
const identityDocumentSchema = z.object({
	type: z.string(),
	number: z.string(),
	country: z.string().nullable().optional(),
	issue_date: z.string().nullable().optional(),
	expiration_date: z.string().nullable().optional(),
});

/**
 * OFAC record schema matching the container output
 */
const ofacRecordSchema = z.object({
	id: z.string(),
	party_type: z.enum(["Individual", "Entity", "Vessel", "Aircraft"]),
	primary_name: z.string(),
	aliases: z.array(z.string()),
	birth_date: z.string().nullable(),
	birth_place: z.string().nullable(),
	addresses: z.array(z.string()),
	identifiers: z.array(identityDocumentSchema),
	remarks: z.string().nullable(),
	source_list: z.string(),
});

export type OfacRecord = z.infer<typeof ofacRecordSchema>;

// =============================================================================
// Truncate Endpoint
// =============================================================================

/**
 * POST /internal/ofac/truncate
 * Truncates the ofac_sdn_entry table before a new ingestion
 */
export class InternalOfacTruncateEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Truncate OFAC SDN table (internal)",
		description:
			"Clears all records from ofac_sdn_entry table. Called by container before batch inserts.",
		security: [],
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							run_id: z.number().int().describe("The ingestion run ID"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Table truncated successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							deleted_count: z.number().int(),
						}),
					},
				},
			},
		},
	};

	async handle(c: { env: Bindings; req: Request }) {
		const body = await c.req.json();
		const { run_id } = body as { run_id: number };

		console.log(`[InternalOfac] Truncating ofac_sdn_entry for run ${run_id}`);

		const prisma = createPrismaClient(c.env.DB);

		// Get count before deletion for logging
		const countResult = await prisma.ofacSdnEntry.count();

		// Delete all records
		await prisma.ofacSdnEntry.deleteMany({});

		console.log(
			`[InternalOfac] Deleted ${countResult} records from ofac_sdn_entry`,
		);

		// Update run status to show we're in the inserting phase (if run exists)
		try {
			await prisma.watchlistIngestionRun.update({
				where: { id: run_id },
				data: {
					status: "running",
					progressPhase: "inserting",
					progressRecordsProcessed: 0,
					progressPercentage: 0,
					progressUpdatedAt: new Date(),
				},
			});
		} catch (e) {
			// Run might not exist in manual testing - that's ok
			console.log(
				`[InternalOfac] Could not update run ${run_id} (may not exist):`,
				e,
			);
		}

		return Response.json({
			success: true,
			deleted_count: countResult,
		});
	}
}

// =============================================================================
// Batch Insert Endpoint
// =============================================================================

/**
 * POST /internal/ofac/batch
 * Receives and inserts a batch of OFAC records
 */
export class InternalOfacBatchEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Insert OFAC batch (internal)",
		description:
			"Inserts a batch of OFAC records into D1. Called by container for each parsed batch.",
		security: [],
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							run_id: z.number().int().describe("The ingestion run ID"),
							batch_number: z.number().int().describe("Current batch number"),
							total_batches: z
								.number()
								.int()
								.optional()
								.describe("Total expected batches"),
							records: z.array(ofacRecordSchema).describe("Records to insert"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Batch inserted successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							inserted: z.number().int(),
							errors: z.array(z.string()),
						}),
					},
				},
			},
		},
	};

	async handle(c: { env: Bindings; req: Request }) {
		const body = await c.req.json();
		const { run_id, batch_number, total_batches, records } = body as {
			run_id: number;
			batch_number: number;
			total_batches?: number;
			records: OfacRecord[];
		};

		console.log(
			`[InternalOfac] Inserting batch ${batch_number} with ${records.length} records for run ${run_id}`,
		);

		if (records.length === 0) {
			return Response.json({
				success: true,
				inserted: 0,
				errors: [],
			});
		}

		const errors: string[] = [];
		let inserted = 0;

		// Use raw D1 for bulk insert performance
		// D1 has a limit on SQL parameters (~100), so we chunk into sub-batches of 8 records
		// 8 records × 12 fields = 96 parameters (safely under the limit)
		const db = c.env.DB;
		const now = new Date().toISOString();
		const SUB_BATCH_SIZE = 8;

		// Split records into sub-batches for efficient bulk inserts
		for (let i = 0; i < records.length; i += SUB_BATCH_SIZE) {
			const subBatch = records.slice(i, i + SUB_BATCH_SIZE);

			try {
				const values = subBatch.map(
					() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
				);
				const insertSql = `
					INSERT OR REPLACE INTO ofac_sdn_entry (
						id, party_type, primary_name, aliases, birth_date, birth_place,
						addresses, identifiers, remarks, source_list, created_at, updated_at
					) VALUES ${values.join(", ")}
				`;

				const params: unknown[] = [];
				for (const record of subBatch) {
					params.push(
						record.id,
						record.party_type,
						record.primary_name,
						JSON.stringify(record.aliases),
						record.birth_date,
						record.birth_place,
						JSON.stringify(record.addresses),
						JSON.stringify(record.identifiers),
						record.remarks,
						record.source_list,
						now,
						now,
					);
				}

				await db
					.prepare(insertSql)
					.bind(...params)
					.run();
				inserted += subBatch.length;
			} catch (error) {
				// If sub-batch fails, fallback to individual inserts for this sub-batch only
				const errorMsg = error instanceof Error ? error.message : String(error);
				console.warn(
					`[InternalOfac] Sub-batch insert failed, using individual inserts: ${errorMsg}`,
				);

				const prisma = createPrismaClient(c.env.DB);
				for (const record of subBatch) {
					try {
						await prisma.ofacSdnEntry.upsert({
							where: { id: record.id },
							create: {
								id: record.id,
								partyType: record.party_type,
								primaryName: record.primary_name,
								aliases: JSON.stringify(record.aliases),
								birthDate: record.birth_date,
								birthPlace: record.birth_place,
								addresses: JSON.stringify(record.addresses),
								identifiers: JSON.stringify(record.identifiers),
								remarks: record.remarks,
								sourceList: record.source_list,
							},
							update: {
								partyType: record.party_type,
								primaryName: record.primary_name,
								aliases: JSON.stringify(record.aliases),
								birthDate: record.birth_date,
								birthPlace: record.birth_place,
								addresses: JSON.stringify(record.addresses),
								identifiers: JSON.stringify(record.identifiers),
								remarks: record.remarks,
								sourceList: record.source_list,
							},
						});
						inserted++;
					} catch (err) {
						errors.push(`Failed to insert ${record.id}: ${err}`);
					}
				}
			}
		}

		// Update progress (if run exists)
		const prisma = createPrismaClient(c.env.DB);
		const percentage = total_batches
			? Math.round((batch_number / total_batches) * 100)
			: 0;

		try {
			// Get current progress to accumulate records processed
			const currentRun = await prisma.watchlistIngestionRun.findUnique({
				where: { id: run_id },
				select: { progressRecordsProcessed: true },
			});

			const totalProcessed =
				(currentRun?.progressRecordsProcessed ?? 0) + inserted;

			await prisma.watchlistIngestionRun.update({
				where: { id: run_id },
				data: {
					progressPhase: "inserting",
					progressRecordsProcessed: totalProcessed,
					progressPercentage: percentage,
					progressCurrentBatch: batch_number,
					progressUpdatedAt: new Date(),
				},
			});
		} catch (e) {
			// Run might not exist in manual testing - that's ok
			console.log(
				`[InternalOfac] Could not update run ${run_id} progress (may not exist):`,
				e,
			);
		}

		console.log(
			`[InternalOfac] Batch ${batch_number} complete: inserted=${inserted}, errors=${errors.length}`,
		);

		return Response.json({
			success: errors.length === 0,
			inserted,
			errors,
		});
	}
}

// =============================================================================
// Complete Endpoint
// =============================================================================

/**
 * POST /internal/ofac/complete
 * Marks an ingestion run as completed
 */
export class InternalOfacCompleteEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Complete OFAC ingestion (internal)",
		description: "Marks the ingestion run as completed with final statistics.",
		security: [],
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							run_id: z.number().int().describe("The ingestion run ID"),
							total_records: z
								.number()
								.int()
								.describe("Total records processed"),
							total_batches: z
								.number()
								.int()
								.describe("Total batches processed"),
							errors: z
								.array(z.string())
								.optional()
								.describe("Any errors encountered"),
							skip_vectorization: z
								.boolean()
								.optional()
								.default(false)
								.describe("Skip automatic vectorization trigger"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Ingestion marked as complete",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							vectorization_thread_id: z.string().nullable().optional(),
						}),
					},
				},
			},
		},
	};

	async handle(c: { env: Bindings; req: Request }) {
		const body = await c.req.json();
		const { run_id, total_records, total_batches, errors, skip_vectorization } =
			body as {
				run_id: number;
				total_records: number;
				total_batches: number;
				errors?: string[];
				skip_vectorization?: boolean;
			};

		console.log(
			`[InternalOfac] Completing run ${run_id}: total_records=${total_records}, total_batches=${total_batches}`,
		);

		const prisma = createPrismaClient(c.env.DB);

		try {
			await prisma.watchlistIngestionRun.update({
				where: { id: run_id },
				data: {
					status: "completed",
					finishedAt: new Date(),
					progressPhase: "completed",
					progressPercentage: 100,
					progressRecordsProcessed: total_records,
					progressTotalEstimate: total_records,
					progressUpdatedAt: new Date(),
					stats: JSON.stringify({
						totalRecords: total_records,
						totalBatches: total_batches,
						errors: errors?.slice(0, 100) ?? [],
					}),
				},
			});
			console.log(`[InternalOfac] Run ${run_id} marked as completed`);
		} catch (e) {
			// Run might not exist in manual testing - that's ok
			console.log(
				`[InternalOfac] Could not update run ${run_id} to completed (may not exist):`,
				e,
			);
		}

		// Trigger automatic vectorization if not skipped and records were processed
		let vectorizationThreadId: string | null = null;
		if (!skip_vectorization && total_records > 0 && c.env.THREAD_SVC) {
			console.log(
				`[InternalOfac] Triggering automatic vectorization for ${total_records} records`,
			);

			try {
				const callbackUrl = getCallbackUrl(c.env.ENVIRONMENT);
				const response = await c.env.THREAD_SVC.fetch(
					"http://thread-svc/threads",
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							task_type: "vectorize_index",
							job_params: {
								dataset: "ofac_sdn",
								reindex_all: true,
								batch_size: 100,
								callback_url: callbackUrl,
								triggered_by: `ofac_ingestion_run_${run_id}`,
							},
							metadata: {
								source: "auto_trigger",
								ofac_run_id: run_id,
								total_records: total_records,
							},
						}),
					},
				);

				if (response.ok) {
					const thread = (await response.json()) as { id: string };
					vectorizationThreadId = thread.id;
					console.log(
						`[InternalOfac] Vectorization thread created: ${vectorizationThreadId}`,
					);
				} else {
					console.error(
						`[InternalOfac] Failed to create vectorization thread: ${response.status}`,
					);
				}
			} catch (e) {
				// Log but don't fail - vectorization can be triggered manually
				console.error(`[InternalOfac] Failed to trigger vectorization: ${e}`);
			}
		}

		return Response.json({
			success: true,
			vectorization_thread_id: vectorizationThreadId,
		});
	}
}

// =============================================================================
// Failed Endpoint
// =============================================================================

/**
 * POST /internal/ofac/failed
 * Marks an ingestion run as failed
 */
export class InternalOfacFailedEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Mark OFAC ingestion as failed (internal)",
		description: "Marks the ingestion run as failed with error message.",
		security: [],
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							run_id: z.number().int().describe("The ingestion run ID"),
							error: z.string().describe("Error message"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Ingestion marked as failed",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
						}),
					},
				},
			},
		},
	};

	async handle(c: { env: Bindings; req: Request }) {
		const body = await c.req.json();
		const { run_id, error } = body as { run_id: number; error: string };

		console.log(`[InternalOfac] Marking run ${run_id} as failed: ${error}`);

		const prisma = createPrismaClient(c.env.DB);

		try {
			await prisma.watchlistIngestionRun.update({
				where: { id: run_id },
				data: {
					status: "failed",
					finishedAt: new Date(),
					progressPhase: "failed",
					progressUpdatedAt: new Date(),
					errorMessage: error.substring(0, 1000),
				},
			});
		} catch (e) {
			// Run might not exist in manual testing - that's ok
			console.log(
				`[InternalOfac] Could not update run ${run_id} to failed (may not exist):`,
				e,
			);
		}

		return Response.json({
			success: true,
		});
	}
}
