import { OpenAPIRoute, ApiException } from "chanfana";
import type { AppContext, IngestionJob, SdnXmlIngestionJob } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import { createPrismaClient } from "../../lib/prisma";
import { watchlistIngestionRun } from "./base";
import { transformIngestionRun } from "../../lib/transformers";

export class AdminIngestEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Admin"],
		summary: "Trigger CSV ingestion (admin only)",
		operationId: "adminIngest",
		request: {
			body: contentJson(
				z.object({
					csvUrl: z.string().url(),
					reindexAll: z.boolean().optional().default(false),
				}),
			),
		},
		responses: {
			"200": {
				description: "Ingestion started",
				...contentJson({
					success: Boolean,
					result: watchlistIngestionRun,
				}),
			},
			"401": {
				description: "Unauthorized",
				...contentJson({
					success: Boolean,
					errors: z.array(
						z.object({
							code: z.number(),
							message: z.string(),
						}),
					),
				}),
			},
		},
	};

	public async handle(c: AppContext) {
		const validatedData = await this.getValidatedData<typeof this.schema>();
		const prisma = createPrismaClient(c.env.DB);

		// Create ingestion run record
		const run = await prisma.watchlistIngestionRun.create({
			data: {
				sourceUrl: validatedData.body.csvUrl,
				sourceType: "csv_url",
				status: "running",
			},
		});

		// Send job to queue for background processing
		if (!c.env.INGESTION_QUEUE) {
			const error = new ApiException("Ingestion queue not configured");
			error.status = 500;
			error.code = 500;
			throw error;
		}

		const job: IngestionJob = {
			runId: run.id,
			csvUrl: validatedData.body.csvUrl,
			reindexAll: validatedData.body.reindexAll ?? false,
		};

		try {
			await c.env.INGESTION_QUEUE.send(job);
			console.log(
				`[AdminIngest] Queued ingestion job for runId: ${run.id}`,
				job,
			);
		} catch (error) {
			console.error(
				`[AdminIngest] Failed to queue ingestion job for runId: ${run.id}`,
				error,
			);
			// Update run status to failed
			await prisma.watchlistIngestionRun.update({
				where: { id: run.id },
				data: {
					status: "failed",
					finishedAt: new Date(),
					errorMessage: `Failed to queue job: ${
						error instanceof Error ? error.message : String(error)
					}`,
				},
			});

			const apiError = new ApiException("Failed to queue ingestion job");
			apiError.status = 500;
			apiError.code = 500;
			throw apiError;
		}

		return {
			success: true,
			result: transformIngestionRun(run),
		};
	}
}

/**
 * Endpoint for triggering SDN XML ingestion from R2
 */
export class AdminIngestSdnXmlEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Admin"],
		summary: "Trigger SDN XML ingestion from R2 (admin only)",
		operationId: "adminIngestSdnXml",
		request: {
			body: contentJson(
				z.object({
					r2Key: z
						.string()
						.min(1)
						.describe("R2 object key returned from /api/upload/sdn-xml"),
					reindexAll: z.boolean().optional().default(false),
					batchSize: z.number().int().min(1).max(500).optional().default(100),
				}),
			),
		},
		responses: {
			"200": {
				description: "Ingestion started",
				...contentJson({
					success: Boolean,
					result: watchlistIngestionRun,
				}),
			},
			"400": {
				description: "Invalid R2 key",
				...contentJson({
					success: Boolean,
					errors: z.array(
						z.object({
							code: z.number(),
							message: z.string(),
						}),
					),
				}),
			},
			"401": {
				description: "Unauthorized",
				...contentJson({
					success: Boolean,
					errors: z.array(
						z.object({
							code: z.number(),
							message: z.string(),
						}),
					),
				}),
			},
			"503": {
				description: "R2 bucket not configured",
				...contentJson({
					success: Boolean,
					errors: z.array(
						z.object({
							code: z.number(),
							message: z.string(),
						}),
					),
				}),
			},
		},
	};

	public async handle(c: AppContext) {
		const validatedData = await this.getValidatedData<typeof this.schema>();
		const prisma = createPrismaClient(c.env.DB);

		// Check if R2 bucket is configured
		if (!c.env.WATCHLIST_UPLOADS_BUCKET) {
			const error = new ApiException("R2 bucket not configured");
			error.status = 503;
			error.code = 503;
			throw error;
		}

		// Verify the R2 object exists
		const r2Object = await c.env.WATCHLIST_UPLOADS_BUCKET.head(
			validatedData.body.r2Key,
		);
		if (!r2Object) {
			const error = new ApiException(
				`File not found in R2: ${validatedData.body.r2Key}`,
			);
			error.status = 400;
			error.code = 400;
			throw error;
		}

		// Create ingestion run record
		const run = await prisma.watchlistIngestionRun.create({
			data: {
				sourceUrl: `r2://${validatedData.body.r2Key}`,
				sourceType: "sdn_xml",
				status: "running",
			},
		});

		// Send job to queue for background processing
		if (!c.env.INGESTION_QUEUE) {
			const error = new ApiException("Ingestion queue not configured");
			error.status = 500;
			error.code = 500;
			throw error;
		}

		const job: SdnXmlIngestionJob = {
			runId: run.id,
			sourceType: "sdn_xml",
			r2Key: validatedData.body.r2Key,
			reindexAll: validatedData.body.reindexAll,
			batchSize: validatedData.body.batchSize,
		};

		try {
			await c.env.INGESTION_QUEUE.send(job);
			console.log(
				`[AdminIngestSdnXml] Queued SDN XML ingestion job for runId: ${run.id}`,
				job,
			);
		} catch (error) {
			console.error(
				`[AdminIngestSdnXml] Failed to queue ingestion job for runId: ${run.id}`,
				error,
			);
			// Update run status to failed
			await prisma.watchlistIngestionRun.update({
				where: { id: run.id },
				data: {
					status: "failed",
					finishedAt: new Date(),
					errorMessage: `Failed to queue job: ${
						error instanceof Error ? error.message : String(error)
					}`,
				},
			});

			const apiError = new ApiException("Failed to queue ingestion job");
			apiError.status = 500;
			apiError.code = 500;
			throw apiError;
		}

		return {
			success: true,
			result: transformIngestionRun(run),
		};
	}
}

export class AdminReindexEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Admin"],
		summary: "Reindex all targets from D1 to Vectorize (admin only)",
		operationId: "adminReindex",
		request: {
			body: contentJson(
				z.object({
					batchSize: z.number().int().min(1).max(100).optional().default(50),
				}),
			),
		},
		responses: {
			"200": {
				description: "Reindexing started",
				...contentJson({
					success: Boolean,
					result: z.object({
						message: z.string(),
						targetCount: z.number(),
					}),
				}),
			},
			"401": {
				description: "Unauthorized",
				...contentJson({
					success: Boolean,
					errors: z.array(
						z.object({
							code: z.number(),
							message: z.string(),
						}),
					),
				}),
			},
		},
	};

	public async handle(c: AppContext) {
		await this.getValidatedData<typeof this.schema>();
		const prisma = createPrismaClient(c.env.DB);

		// Count targets (original flow)
		const targetCount = await prisma.watchlistTarget.count();

		// Reindexing logic would go here
		// For now, return a placeholder response
		// Full implementation would iterate through targets and reindex them

		return {
			success: true,
			result: {
				message: "Reindexing started",
				targetCount,
			},
		};
	}
}
