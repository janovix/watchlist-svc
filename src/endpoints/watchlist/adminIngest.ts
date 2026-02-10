import { OpenAPIRoute, ApiException } from "chanfana";
import type { AppContext, IngestionJob } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import { createPrismaClient } from "../../lib/prisma";
import { watchlistIngestionRun } from "./base";
import { transformIngestionRun } from "../../lib/transformers";
import {
	generatePresignedDownloadUrl,
	validateR2Config,
} from "../../lib/r2-presigned";

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

		// Create thread in thread-svc for processing
		if (!c.env.THREAD_SVC) {
			await prisma.watchlistIngestionRun.update({
				where: { id: run.id },
				data: {
					status: "failed",
					finishedAt: new Date(),
					errorMessage: "Thread service not configured",
				},
			});

			const error = new ApiException("Thread service not configured");
			error.status = 500;
			error.code = 500;
			throw error;
		}

		// Build callback URL for container to call back to watchlist-svc
		const callbackUrl = new URL(c.req.url).origin + "/internal/ofac";

		// Generate presigned download URL for container to fetch the file
		const r2Config = validateR2Config(c.env);
		let r2PresignedUrl: string | undefined;
		let r2UrlExpiresAt: string | undefined;

		if (r2Config) {
			const presignedDownload = await generatePresignedDownloadUrl(
				r2Config,
				validatedData.body.r2Key,
				7200, // 2 hours expiration
			);
			r2PresignedUrl = presignedDownload.url;
			r2UrlExpiresAt = presignedDownload.expiresAt.toISOString();
		}

		const threadPayload = {
			task_type: "ofac_parse",
			job_params: {
				r2_key: validatedData.body.r2Key,
				r2_presigned_url: r2PresignedUrl,
				r2_url_expires_at: r2UrlExpiresAt,
				callback_url: callbackUrl,
				truncate_before: true,
				run_id: run.id,
				batch_size: validatedData.body.batchSize ?? 100,
			},
			metadata: {
				source: "watchlist-svc",
				source_type: "sdn_xml",
				triggered_by: "admin",
				file_size: r2Object.size,
			},
		};

		try {
			const threadResponse = await c.env.THREAD_SVC.fetch(
				"http://thread-svc/threads",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(threadPayload),
				},
			);

			if (!threadResponse.ok) {
				const errorText = await threadResponse.text();
				throw new Error(
					`Thread service returned ${threadResponse.status}: ${errorText}`,
				);
			}

			const threadData = (await threadResponse.json()) as { id: string };
			console.log(
				`[AdminIngestSdnXml] Created thread ${threadData.id} for runId: ${run.id}`,
			);

			// Store thread ID in run stats for tracking
			await prisma.watchlistIngestionRun.update({
				where: { id: run.id },
				data: {
					stats: JSON.stringify({
						threadId: threadData.id,
						r2Key: validatedData.body.r2Key,
						batchSize: validatedData.body.batchSize,
						fileSize: r2Object.size,
					}),
				},
			});
		} catch (error) {
			console.error(
				`[AdminIngestSdnXml] Failed to create thread for runId: ${run.id}`,
				error,
			);

			await prisma.watchlistIngestionRun.update({
				where: { id: run.id },
				data: {
					status: "failed",
					finishedAt: new Date(),
					errorMessage: `Failed to create thread: ${
						error instanceof Error ? error.message : String(error)
					}`,
				},
			});

			const apiError = new ApiException("Failed to create processing thread");
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
