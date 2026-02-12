/**
 * Internal SAT 69-B endpoints for container callbacks.
 *
 * These endpoints are called by thread-worker-container during SAT 69-B parsing
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
import { normalizeIdentifier } from "../../lib/matching-utils";

// =============================================================================
// Schemas
// =============================================================================

/**
 * SAT 69-B record schema matching the container output
 */
const sat69bRecordSchema = z.object({
	id: z.string(), // RFC
	row_number: z.number().int().nullable(),
	rfc: z.string(),
	taxpayer_name: z.string(),
	taxpayer_status: z.string(),
	presumption_sat_notice: z.string().nullable(),
	presumption_sat_date: z.string().nullable(),
	presumption_dof_notice: z.string().nullable(),
	presumption_dof_date: z.string().nullable(),
	rebuttal_sat_notice: z.string().nullable(),
	rebuttal_sat_date: z.string().nullable(),
	rebuttal_dof_notice: z.string().nullable(),
	rebuttal_dof_date: z.string().nullable(),
	definitive_sat_notice: z.string().nullable(),
	definitive_sat_date: z.string().nullable(),
	definitive_dof_notice: z.string().nullable(),
	definitive_dof_date: z.string().nullable(),
	favorable_sat_notice: z.string().nullable(),
	favorable_sat_date: z.string().nullable(),
	favorable_dof_notice: z.string().nullable(),
	favorable_dof_date: z.string().nullable(),
});

export type Sat69bRecord = z.infer<typeof sat69bRecordSchema>;

// =============================================================================
// Truncate Endpoint
// =============================================================================

/**
 * POST /internal/sat69b/truncate
 * Truncates the sat_69b_entry table before a new ingestion
 */
export class InternalSat69bTruncateEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Truncate SAT 69-B table (internal)",
		description:
			"Clears all records from sat_69b_entry table. Called by container before batch inserts.",
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

		console.log(`[InternalSat69b] Truncating sat_69b_entry for run ${run_id}`);

		const prisma = createPrismaClient(c.env.DB);

		// Get count before deletion for logging
		const countResult = await prisma.sat69bEntry.count();

		// Delete all records
		await prisma.sat69bEntry.deleteMany({});

		console.log(
			`[InternalSat69b] Deleted ${countResult} records from sat_69b_entry`,
		);

		// Also truncate watchlist_identifier for sat_69b dataset
		const db = c.env.DB;
		try {
			await db
				.prepare("DELETE FROM watchlist_identifier WHERE dataset = ?")
				.bind("sat_69b")
				.run();
			console.log(`[InternalSat69b] Deleted identifiers for sat_69b dataset`);
		} catch (e) {
			console.warn(
				`[InternalSat69b] Failed to delete identifiers (may not exist yet):`,
				e,
			);
		}

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
				`[InternalSat69b] Could not update run ${run_id} (may not exist):`,
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
 * POST /internal/sat69b/batch
 * Receives and inserts a batch of SAT 69-B records
 */
export class InternalSat69bBatchEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Insert SAT 69-B batch (internal)",
		description:
			"Inserts a batch of SAT 69-B records into D1. Called by container for each parsed batch.",
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
							records: z
								.array(sat69bRecordSchema)
								.describe("Records to insert"),
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
		const { run_id, batch_number, records } = body as {
			run_id: number;
			batch_number: number;
			total_batches?: number;
			records: Sat69bRecord[];
		};

		console.log(
			`[InternalSat69b] Inserting batch ${batch_number} with ${records.length} records for run ${run_id}`,
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
		// D1 has a limit on SQL parameters (~100), so we chunk into sub-batches of 5 records
		// 5 records × 23 fields = 115 parameters (safely under the limit)
		const db = c.env.DB;
		const now = new Date().toISOString();
		const SUB_BATCH_SIZE = 5;

		// Split records into sub-batches for efficient bulk inserts
		for (let i = 0; i < records.length; i += SUB_BATCH_SIZE) {
			const subBatch = records.slice(i, i + SUB_BATCH_SIZE);

			try {
				const values = subBatch.map(
					() =>
						"(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
				);
				const insertSql = `
					INSERT OR REPLACE INTO sat_69b_entry (
						id, row_number, rfc, taxpayer_name, taxpayer_status,
						presumption_sat_notice, presumption_sat_date, presumption_dof_notice, presumption_dof_date,
						rebuttal_sat_notice, rebuttal_sat_date, rebuttal_dof_notice, rebuttal_dof_date,
						definitive_sat_notice, definitive_sat_date, definitive_dof_notice, definitive_dof_date,
						favorable_sat_notice, favorable_sat_date, favorable_dof_notice, favorable_dof_date,
						created_at, updated_at
					) VALUES ${values.join(", ")}
				`;

				const params: unknown[] = [];
				for (const record of subBatch) {
					params.push(
						record.id,
						record.row_number,
						record.rfc,
						record.taxpayer_name,
						record.taxpayer_status,
						record.presumption_sat_notice,
						record.presumption_sat_date,
						record.presumption_dof_notice,
						record.presumption_dof_date,
						record.rebuttal_sat_notice,
						record.rebuttal_sat_date,
						record.rebuttal_dof_notice,
						record.rebuttal_dof_date,
						record.definitive_sat_notice,
						record.definitive_sat_date,
						record.definitive_dof_notice,
						record.definitive_dof_date,
						record.favorable_sat_notice,
						record.favorable_sat_date,
						record.favorable_dof_notice,
						record.favorable_dof_date,
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
					`[InternalSat69b] Sub-batch insert failed, using individual inserts: ${errorMsg}`,
				);

				const prisma = createPrismaClient(c.env.DB);
				for (const record of subBatch) {
					try {
						await prisma.sat69bEntry.upsert({
							where: { id: record.id },
							create: {
								id: record.id,
								rowNumber: record.row_number,
								rfc: record.rfc,
								taxpayerName: record.taxpayer_name,
								taxpayerStatus: record.taxpayer_status,
								presumptionSatNotice: record.presumption_sat_notice,
								presumptionSatDate: record.presumption_sat_date,
								presumptionDofNotice: record.presumption_dof_notice,
								presumptionDofDate: record.presumption_dof_date,
								rebuttalSatNotice: record.rebuttal_sat_notice,
								rebuttalSatDate: record.rebuttal_sat_date,
								rebuttalDofNotice: record.rebuttal_dof_notice,
								rebuttalDofDate: record.rebuttal_dof_date,
								definitiveSatNotice: record.definitive_sat_notice,
								definitiveSatDate: record.definitive_sat_date,
								definitiveDofNotice: record.definitive_dof_notice,
								definitiveDofDate: record.definitive_dof_date,
								favorableSatNotice: record.favorable_sat_notice,
								favorableSatDate: record.favorable_sat_date,
								favorableDofNotice: record.favorable_dof_notice,
								favorableDofDate: record.favorable_dof_date,
							},
							update: {
								rowNumber: record.row_number,
								rfc: record.rfc,
								taxpayerName: record.taxpayer_name,
								taxpayerStatus: record.taxpayer_status,
								presumptionSatNotice: record.presumption_sat_notice,
								presumptionSatDate: record.presumption_sat_date,
								presumptionDofNotice: record.presumption_dof_notice,
								presumptionDofDate: record.presumption_dof_date,
								rebuttalSatNotice: record.rebuttal_sat_notice,
								rebuttalSatDate: record.rebuttal_sat_date,
								rebuttalDofNotice: record.rebuttal_dof_notice,
								rebuttalDofDate: record.rebuttal_dof_date,
								definitiveSatNotice: record.definitive_sat_notice,
								definitiveSatDate: record.definitive_sat_date,
								definitiveDofNotice: record.definitive_dof_notice,
								definitiveDofDate: record.definitive_dof_date,
								favorableSatNotice: record.favorable_sat_notice,
								favorableSatDate: record.favorable_sat_date,
								favorableDofNotice: record.favorable_dof_notice,
								favorableDofDate: record.favorable_dof_date,
							},
						});
						inserted++;
					} catch (err) {
						errors.push(`Failed to insert ${record.id}: ${err}`);
					}
				}
			}
		}

		// Insert RFC identifiers into watchlist_identifier table
		console.log(
			`[InternalSat69b] Extracting and inserting RFC identifiers for ${records.length} records`,
		);
		let identifiersInserted = 0;

		try {
			// Collect all RFC identifiers from all records
			interface IdentifierToInsert {
				recordId: string;
				identifierType: string;
				identifierRaw: string;
				identifierNorm: string;
			}

			const identifiersToInsert: IdentifierToInsert[] = [];

			for (const record of records) {
				if (!record.rfc || !record.rfc.trim()) continue;

				const identifierNorm = normalizeIdentifier(record.rfc);
				if (!identifierNorm) continue; // Skip if empty after normalization

				identifiersToInsert.push({
					recordId: record.id,
					identifierType: "RFC",
					identifierRaw: record.rfc,
					identifierNorm,
				});
			}

			// Insert identifiers in sub-batches
			// Each identifier has 5 fields (excluding id and created_at which are auto)
			// So we can do ~15 identifiers per batch (15 * 5 = 75 params)
			const IDENTIFIER_BATCH_SIZE = 15;

			for (
				let i = 0;
				i < identifiersToInsert.length;
				i += IDENTIFIER_BATCH_SIZE
			) {
				const identifierBatch = identifiersToInsert.slice(
					i,
					i + IDENTIFIER_BATCH_SIZE,
				);

				if (identifierBatch.length === 0) continue;

				try {
					const values = identifierBatch.map(() => "(?, ?, ?, ?, ?, ?)");
					const insertIdentifierSql = `
						INSERT INTO watchlist_identifier (
							dataset, record_id, identifier_type, identifier_raw, identifier_norm, created_at
						) VALUES ${values.join(", ")}
					`;

					const identifierParams: unknown[] = [];
					for (const id of identifierBatch) {
						identifierParams.push(
							"sat_69b",
							id.recordId,
							id.identifierType,
							id.identifierRaw,
							id.identifierNorm,
							now,
						);
					}

					await db
						.prepare(insertIdentifierSql)
						.bind(...identifierParams)
						.run();

					identifiersInserted += identifierBatch.length;
				} catch (idError) {
					console.warn(
						`[InternalSat69b] Failed to insert identifier batch:`,
						idError,
					);
					// Continue with next batch even if one fails
				}
			}

			console.log(
				`[InternalSat69b] Inserted ${identifiersInserted} identifiers for batch ${batch_number}`,
			);
		} catch (identifierError) {
			console.warn(
				`[InternalSat69b] Error extracting identifiers:`,
				identifierError,
			);
			// Don't fail the whole batch if identifier insertion fails
		}

		// Update progress (if run exists)
		const prisma = createPrismaClient(c.env.DB);

		try {
			// Get current progress to accumulate records processed and calculate percentage
			const currentRun = await prisma.watchlistIngestionRun.findUnique({
				where: { id: run_id },
				select: {
					progressRecordsProcessed: true,
					progressTotalEstimate: true,
				},
			});

			const totalProcessed =
				(currentRun?.progressRecordsProcessed ?? 0) + inserted;
			const totalEstimate = currentRun?.progressTotalEstimate ?? 0;

			// Calculate percentage based on records processed (0-70% for ingestion phase)
			// We reserve 70-100% for vectorization
			const ingestionPercentage =
				totalEstimate > 0
					? Math.min(70, Math.round((totalProcessed / totalEstimate) * 70))
					: 0;

			await prisma.watchlistIngestionRun.update({
				where: { id: run_id },
				data: {
					progressPhase: "inserting",
					progressRecordsProcessed: totalProcessed,
					progressPercentage: ingestionPercentage,
					progressCurrentBatch: batch_number,
					progressUpdatedAt: new Date(),
				},
			});
		} catch (e) {
			// Run might not exist in manual testing - that's ok
			console.log(
				`[InternalSat69b] Could not update run ${run_id} progress (may not exist):`,
				e,
			);
		}

		console.log(
			`[InternalSat69b] Batch ${batch_number} complete: inserted=${inserted}, errors=${errors.length}`,
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
 * POST /internal/sat69b/complete
 * Marks an ingestion run as completed
 */
export class InternalSat69bCompleteEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Complete SAT 69-B ingestion (internal)",
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
			`[InternalSat69b] Completing run ${run_id}: total_records=${total_records}, total_batches=${total_batches}`,
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
			console.log(`[InternalSat69b] Run ${run_id} marked as completed`);
		} catch (e) {
			// Run might not exist in manual testing - that's ok
			console.log(
				`[InternalSat69b] Could not update run ${run_id} to completed (may not exist):`,
				e,
			);
		}

		// Trigger automatic vectorization if not skipped and records were processed
		let vectorizationThreadId: string | null = null;
		if (!skip_vectorization && total_records > 0 && c.env.THREAD_SVC) {
			console.log(
				`[InternalSat69b] Triggering automatic vectorization for ${total_records} records`,
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
								dataset: "sat_69b",
								reindex_all: true,
								batch_size: 100,
								callback_url: callbackUrl,
								triggered_by: `sat_69b_ingestion_run_${run_id}`,
							},
							metadata: {
								source: "auto_trigger",
								sat_69b_run_id: run_id,
								total_records: total_records,
							},
						}),
					},
				);

				if (response.ok) {
					const thread = (await response.json()) as { id: string };
					vectorizationThreadId = thread.id;
					console.log(
						`[InternalSat69b] Vectorization thread created: ${vectorizationThreadId}`,
					);

					// Update the run with the vectorize thread ID and phase
					try {
						await prisma.watchlistIngestionRun.update({
							where: { id: run_id },
							data: {
								vectorizeThreadId: vectorizationThreadId,
								progressPhase: "vectorizing",
								progressUpdatedAt: new Date(),
							},
						});
						console.log(
							`[InternalSat69b] Run ${run_id} updated with vectorize thread ID`,
						);
					} catch (updateErr) {
						console.error(
							`[InternalSat69b] Failed to update run with vectorize thread ID:`,
							updateErr,
						);
					}
				} else {
					console.error(
						`[InternalSat69b] Failed to create vectorization thread: ${response.status}`,
					);
				}
			} catch (e) {
				// Log but don't fail - vectorization can be triggered manually
				console.error(`[InternalSat69b] Failed to trigger vectorization: ${e}`);
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
 * POST /internal/sat69b/failed
 * Marks an ingestion run as failed
 */
export class InternalSat69bFailedEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Mark SAT 69-B ingestion as failed (internal)",
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

		console.log(`[InternalSat69b] Marking run ${run_id} as failed: ${error}`);

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
				`[InternalSat69b] Could not update run ${run_id} to failed (may not exist):`,
				e,
			);
		}

		return Response.json({
			success: true,
		});
	}
}
