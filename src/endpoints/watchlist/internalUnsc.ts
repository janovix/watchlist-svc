/**
 * Internal UNSC endpoints for container callbacks.
 *
 * These endpoints are called by thread-worker-container during UNSC parsing
 * to insert batches of records into D1 and report completion.
 *
 * These are INTERNAL endpoints - not exposed to public API.
 * They should be secured via service binding authentication or internal tokens.
 */

import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { createPrismaClient } from "../../lib/prisma";
import type { Bindings } from "../../index";
import { getCallbackUrl } from "../../lib/unsc-vectorize-service";
import {
	normalizeIdentifier,
	normalizeIdentifierType,
} from "../../lib/matching-utils";

// =============================================================================
// Schemas
// =============================================================================

/**
 * Identity document schema for UNSC records
 */
const identityDocumentSchema = z.object({
	type: z.string(),
	number: z.string(),
	country: z.string().nullable().optional(),
	issue_date: z.string().nullable().optional(),
	expiration_date: z.string().nullable().optional(),
});

/**
 * UNSC record schema matching the container output
 */
const unscRecordSchema = z.object({
	id: z.string(),
	party_type: z.enum(["Individual", "Entity"]),
	primary_name: z.string(),
	aliases: z.array(z.string()),
	birth_date: z.string().nullable(),
	birth_place: z.string().nullable(),
	gender: z.string().nullable(),
	addresses: z.array(z.string()),
	nationalities: z.array(z.string()),
	identifiers: z.array(identityDocumentSchema),
	designations: z.array(z.string()),
	remarks: z.string().nullable(),
	un_list_type: z.string(),
	reference_number: z.string().nullable(),
	listed_on: z.string().nullable(),
});

export type UnscRecord = z.infer<typeof unscRecordSchema>;

// =============================================================================
// Truncate Endpoint
// =============================================================================

/**
 * POST /internal/unsc/truncate
 * Truncates the unsc_entry table before a new ingestion
 */
export class InternalUnscTruncateEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Truncate UNSC table (internal)",
		description:
			"Clears all records from unsc_entry table. Called by container before batch inserts.",
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

		console.log(`[InternalUnsc] Truncating unsc_entry for run ${run_id}`);

		const prisma = createPrismaClient(c.env.DB);

		// Get count before deletion for logging
		const countResult = await prisma.unscEntry.count();

		// Delete all records
		await prisma.unscEntry.deleteMany({});

		console.log(
			`[InternalUnsc] Deleted ${countResult} records from unsc_entry`,
		);

		// Also truncate watchlist_identifier for unsc dataset
		const db = c.env.DB;
		try {
			await db
				.prepare("DELETE FROM watchlist_identifier WHERE dataset = ?")
				.bind("unsc")
				.run();
			console.log(`[InternalUnsc] Deleted identifiers for unsc dataset`);
		} catch (e) {
			console.warn(
				`[InternalUnsc] Failed to delete identifiers (may not exist yet):`,
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
				`[InternalUnsc] Could not update run ${run_id} (may not exist):`,
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
 * POST /internal/unsc/batch
 * Receives and inserts a batch of UNSC records
 */
export class InternalUnscBatchEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Insert UNSC batch (internal)",
		description:
			"Inserts a batch of UNSC records into D1. Called by container for each parsed batch.",
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
							records: z.array(unscRecordSchema).describe("Records to insert"),
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
			records: UnscRecord[];
		};

		console.log(
			`[InternalUnsc] Processing batch ${batch_number}${total_batches ? `/${total_batches}` : ""} with ${records.length} records for run ${run_id}`,
		);

		const prisma = createPrismaClient(c.env.DB);
		const db = c.env.DB;

		const errors: string[] = [];
		let inserted = 0;

		// Insert records in sub-batches to avoid SQL parameter limits
		// D1 has a limit of ~999 parameters per statement
		// Each record has 15 fields, so batch size of 8 = 120 parameters
		const SUB_BATCH_SIZE = 8;

		for (let i = 0; i < records.length; i += SUB_BATCH_SIZE) {
			const subBatch = records.slice(i, i + SUB_BATCH_SIZE);

			try {
				// Build parameterized INSERT statement
				const placeholders = subBatch
					.map(
						() =>
							"(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
					)
					.join(", ");

				const values: unknown[] = [];
				for (const record of subBatch) {
					values.push(
						record.id,
						record.party_type,
						record.primary_name,
						record.aliases.length > 0 ? JSON.stringify(record.aliases) : null,
						record.birth_date,
						record.birth_place,
						record.gender,
						record.addresses.length > 0
							? JSON.stringify(record.addresses)
							: null,
						record.nationalities.length > 0
							? JSON.stringify(record.nationalities)
							: null,
						record.identifiers.length > 0
							? JSON.stringify(record.identifiers)
							: null,
						record.designations.length > 0
							? JSON.stringify(record.designations)
							: null,
						record.remarks,
						record.un_list_type,
						record.reference_number,
						record.listed_on,
					);
				}

				const stmt = db.prepare(`
					INSERT INTO unsc_entry 
					(id, party_type, primary_name, aliases, birth_date, birth_place, gender, 
					 addresses, nationalities, identifiers, designations, remarks, 
					 un_list_type, reference_number, listed_on, created_at, updated_at)
					VALUES ${placeholders}
				`);

				await stmt.bind(...values).run();

				inserted += subBatch.length;
			} catch (e) {
				const errorMsg = `Failed to insert sub-batch ${i / SUB_BATCH_SIZE + 1}: ${e}`;
				console.error(`[InternalUnsc] ${errorMsg}`);
				errors.push(errorMsg);
			}
		}

		// Insert identifiers for all records in this batch
		const identifiersToInsert: Array<{
			dataset: string;
			recordId: string;
			identifierType: string | null;
			identifierRaw: string;
			identifierNorm: string;
		}> = [];

		for (const record of records) {
			// Extract identifiers from record.identifiers array
			for (const identifier of record.identifiers) {
				const normType = normalizeIdentifierType(identifier.type);
				const normValue = normalizeIdentifier(identifier.number);

				if (normValue) {
					identifiersToInsert.push({
						dataset: "unsc",
						recordId: record.id,
						identifierType: normType,
						identifierRaw: identifier.number,
						identifierNorm: normValue,
					});
				}
			}
		}

		// Insert identifiers in batches (max 15 per batch = 90 parameters)
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

			try {
				const placeholders = identifierBatch
					.map(() => "(?, ?, ?, ?, ?, CURRENT_TIMESTAMP)")
					.join(", ");

				const values: unknown[] = [];
				for (const identifier of identifierBatch) {
					values.push(
						identifier.dataset,
						identifier.recordId,
						identifier.identifierType,
						identifier.identifierRaw,
						identifier.identifierNorm,
					);
				}

				const stmt = db.prepare(`
					INSERT INTO watchlist_identifier 
					(dataset, record_id, identifier_type, identifier_raw, identifier_norm, created_at)
					VALUES ${placeholders}
				`);

				await stmt.bind(...values).run();
			} catch (e) {
				console.warn(`[InternalUnsc] Failed to insert identifier batch: ${e}`);
			}
		}

		// Update progress (0-70% for insertion phase)
		try {
			const progressPercentage = total_batches
				? Math.floor((batch_number / total_batches) * 70)
				: 0;

			await prisma.watchlistIngestionRun.update({
				where: { id: run_id },
				data: {
					progressRecordsProcessed: batch_number * records.length,
					progressPercentage,
					progressCurrentBatch: batch_number,
					progressUpdatedAt: new Date(),
				},
			});
		} catch (e) {
			console.warn(
				`[InternalUnsc] Could not update progress for run ${run_id}:`,
				e,
			);
		}

		console.log(
			`[InternalUnsc] Batch ${batch_number} complete: inserted ${inserted}/${records.length} records, ${identifiersToInsert.length} identifiers`,
		);

		return Response.json({
			success: true,
			inserted,
			errors,
		});
	}
}

// =============================================================================
// Complete Endpoint
// =============================================================================

/**
 * POST /internal/unsc/complete
 * Marks ingestion as complete and optionally triggers vectorization
 */
export class InternalUnscCompleteEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Mark UNSC ingestion complete (internal)",
		description:
			"Marks the ingestion run as complete and optionally triggers vectorization. Called by container after all batches.",
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
							total_batches: z.number().int().describe("Total batches sent"),
							skip_vectorization: z
								.boolean()
								.optional()
								.describe("Skip auto-vectorization (default: false)"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Ingestion marked complete",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							vectorize_thread_id: z.string().optional(),
						}),
					},
				},
			},
		},
	};

	async handle(c: { env: Bindings; req: Request }) {
		const body = await c.req.json();
		const { run_id, total_records, total_batches, skip_vectorization } =
			body as {
				run_id: number;
				total_records: number;
				total_batches: number;
				skip_vectorization?: boolean;
			};

		console.log(
			`[InternalUnsc] Marking run ${run_id} complete: ${total_records} records in ${total_batches} batches`,
		);

		const prisma = createPrismaClient(c.env.DB);

		// Update run status
		await prisma.watchlistIngestionRun.update({
			where: { id: run_id },
			data: {
				status: "completed",
				finishedAt: new Date(),
				progressPhase: "completed",
				progressRecordsProcessed: total_records,
				progressTotalEstimate: total_records,
				progressPercentage: 100,
				progressUpdatedAt: new Date(),
				stats: JSON.stringify({
					totalRecords: total_records,
					totalBatches: total_batches,
					errors: [],
				}),
			},
		});

		// Trigger vectorization if not skipped
		let vectorizeThreadId: string | undefined;

		if (!skip_vectorization) {
			try {
				console.log(
					`[InternalUnsc] Creating vectorization thread for run ${run_id}`,
				);

				const callbackUrl = getCallbackUrl(c.env.ENVIRONMENT);

				if (!c.env.THREAD_SVC) {
					throw new Error("THREAD_SVC not configured");
				}

				const vectorizeResponse = await c.env.THREAD_SVC.fetch(
					new Request("http://thread-svc/thread", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							task_type: "vectorize_index",
							params: {
								callback_url: callbackUrl,
								run_id,
								dataset: "unsc",
								batch_size: 50,
							},
						}),
					}),
				);

				if (!vectorizeResponse.ok) {
					throw new Error(
						`Vectorization thread creation failed: ${vectorizeResponse.status} ${await vectorizeResponse.text()}`,
					);
				}

				const vectorizeData = (await vectorizeResponse.json()) as {
					thread_id: string;
				};
				vectorizeThreadId = vectorizeData.thread_id;

				// Update run with vectorize thread ID
				await prisma.watchlistIngestionRun.update({
					where: { id: run_id },
					data: {
						vectorizeThreadId,
						progressPhase: "vectorizing",
					},
				});

				console.log(
					`[InternalUnsc] Created vectorization thread ${vectorizeThreadId}`,
				);
			} catch (e) {
				console.error(
					`[InternalUnsc] Failed to create vectorization thread:`,
					e,
				);
				// Don't fail the completion - vectorization can be done manually
			}
		}

		return Response.json({
			success: true,
			vectorize_thread_id: vectorizeThreadId,
		});
	}
}

// =============================================================================
// Failed Endpoint
// =============================================================================

/**
 * POST /internal/unsc/failed
 * Marks ingestion as failed with error details
 */
export class InternalUnscFailedEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Mark UNSC ingestion failed (internal)",
		description:
			"Marks the ingestion run as failed with error message. Called by container on error.",
		security: [],
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							run_id: z.number().int().describe("The ingestion run ID"),
							error_message: z.string().describe("Error description"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Ingestion marked failed",
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
		const { run_id, error_message } = body as {
			run_id: number;
			error_message: string;
		};

		console.log(
			`[InternalUnsc] Marking run ${run_id} as failed: ${error_message}`,
		);

		const prisma = createPrismaClient(c.env.DB);

		try {
			await prisma.watchlistIngestionRun.update({
				where: { id: run_id },
				data: {
					status: "failed",
					finishedAt: new Date(),
					progressPhase: "failed",
					progressUpdatedAt: new Date(),
					errorMessage: error_message,
				},
			});
		} catch (e) {
			console.error(`[InternalUnsc] Failed to update run ${run_id}:`, e);
		}

		return Response.json({ success: true });
	}
}
