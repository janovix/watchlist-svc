/**
 * Ingestion Upload Endpoints
 * Handles the presigned URL upload flow for watchlist file ingestion
 */
import { OpenAPIRoute, ApiException, contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../../types";
import { createPrismaClient } from "../../lib/prisma";
import { watchlistIngestionRun } from "./base";
import { transformIngestionRun } from "../../lib/transformers";
import {
	generateSdnXmlKey,
	generatePresignedUploadUrl,
	validateR2Config,
	checkFileExistsInR2,
} from "../../lib/r2-presigned";

// Allowed source types for ingestion
const SOURCE_TYPES = ["sdn_xml"] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

// Content types by source type
const CONTENT_TYPES: Record<SourceType, string[]> = {
	sdn_xml: ["application/xml", "text/xml"],
};

// Presigned URL expiration time (10 minutes)
const PRESIGNED_URL_EXPIRES_SECONDS = 600;

/**
 * Schema for the presigned URL response
 */
const presignedUploadResponseSchema = z.object({
	runId: z.number().describe("The ingestion run ID to use for completion"),
	presignedUrl: z
		.string()
		.url()
		.describe("The presigned URL for uploading the file directly to R2"),
	r2Key: z.string().describe("The R2 object key where the file will be stored"),
	expiresAt: z.string().datetime().describe("When the presigned URL expires"),
	allowedContentTypes: z
		.array(z.string())
		.describe("Allowed content types for this upload"),
	maxFileSizeMB: z.number().describe("Maximum file size in MB"),
});

/**
 * POST /ingestion/start
 * Start an ingestion process by creating a run and generating a presigned URL
 */
export class IngestionStartEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Ingestion"],
		summary: "Start ingestion and get presigned upload URL",
		description: `
Initiates a new ingestion process and returns a presigned URL for direct file upload to R2.

## Flow:
1. Call this endpoint with the source type
2. Upload the file directly to R2 using the presigned URL
3. Call POST /ingestion/{runId}/complete to start processing
4. Or call POST /ingestion/{runId}/failed if upload failed

## Upload Instructions:
- Use PUT method to upload to the presigned URL
- Set Content-Type header to match the file type
- The presigned URL expires in 10 minutes
		`,
		operationId: "ingestionStart",
		request: {
			body: contentJson(
				z.object({
					sourceType: z
						.enum(SOURCE_TYPES)
						.describe("The type of file being uploaded"),
					fileName: z
						.string()
						.optional()
						.describe("Original file name (for metadata)"),
					batchSize: z
						.number()
						.int()
						.min(1)
						.max(500)
						.optional()
						.default(100)
						.describe("Batch size for processing"),
					reindexAll: z
						.boolean()
						.optional()
						.default(false)
						.describe("Whether to reindex all vectors"),
				}),
			),
		},
		responses: {
			"200": {
				description: "Ingestion started, upload URL generated",
				...contentJson({
					success: z.literal(true),
					result: presignedUploadResponseSchema,
				}),
			},
			"401": {
				description: "Unauthorized - valid authentication required",
				...contentJson({
					success: z.literal(false),
					errors: z.array(z.object({ code: z.number(), message: z.string() })),
				}),
			},
			"503": {
				description: "R2 presigned URLs not configured",
				...contentJson({
					success: z.literal(false),
					errors: z.array(z.object({ code: z.number(), message: z.string() })),
				}),
			},
		},
	};

	public async handle(c: AppContext) {
		const validatedData = await this.getValidatedData<typeof this.schema>();
		const { sourceType, fileName, batchSize, reindexAll } = validatedData.body;

		// Validate R2 configuration for presigned URLs
		const r2Config = validateR2Config(c.env);
		if (!r2Config) {
			const error = new ApiException(
				"R2 presigned URLs not configured. Required: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CLOUDFLARE_ACCOUNT_ID, R2_BUCKET_NAME",
			);
			error.status = 503;
			error.code = 503;
			throw error;
		}

		const prisma = createPrismaClient(c.env.DB);

		// Generate R2 key based on source type
		let r2Key: string;
		let contentTypes: string[];

		switch (sourceType) {
			case "sdn_xml":
				r2Key = generateSdnXmlKey(c.env.ENVIRONMENT);
				contentTypes = CONTENT_TYPES.sdn_xml;
				break;
			default: {
				const error = new ApiException(
					`Unsupported source type: ${sourceType}`,
				);
				error.status = 400;
				error.code = 400;
				throw error;
			}
		}

		// Create ingestion run record with 'pending' status
		const run = await prisma.watchlistIngestionRun.create({
			data: {
				sourceUrl: `r2://${r2Key}`,
				sourceType,
				status: "pending",
				// Store metadata for later use
				stats: JSON.stringify({
					fileName: fileName || null,
					batchSize,
					reindexAll,
					uploadStartedAt: new Date().toISOString(),
				}),
			},
		});

		// Generate presigned URL for upload
		const presigned = await generatePresignedUploadUrl(
			r2Config,
			r2Key,
			contentTypes[0], // Use first content type as default
			PRESIGNED_URL_EXPIRES_SECONDS,
		);

		console.log(
			`[IngestionStart] Created run ${run.id} with presigned URL for key: ${r2Key}`,
		);

		return {
			success: true as const,
			result: {
				runId: run.id,
				presignedUrl: presigned.url,
				r2Key: presigned.key,
				expiresAt: presigned.expiresAt.toISOString(),
				allowedContentTypes: contentTypes,
				maxFileSizeMB: 150,
			},
		};
	}
}

/**
 * POST /ingestion/:runId/complete
 * Notify that upload is complete and start processing
 */
export class IngestionCompleteEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Ingestion"],
		summary: "Complete ingestion upload and start processing",
		description: `
Call this endpoint after successfully uploading the file to the presigned URL.
This will verify the file exists in R2 and queue the ingestion job for processing.
		`,
		operationId: "ingestionComplete",
		request: {
			params: z.object({
				runId: z.string().regex(/^\d+$/).transform(Number),
			}),
			body: contentJson(
				z.object({
					fileSize: z
						.number()
						.int()
						.positive()
						.optional()
						.describe("Actual file size uploaded (for validation)"),
				}),
			),
		},
		responses: {
			"200": {
				description: "Upload verified, processing queued",
				...contentJson({
					success: z.literal(true),
					result: watchlistIngestionRun,
				}),
			},
			"400": {
				description: "File not found in R2 or invalid run state",
				...contentJson({
					success: z.literal(false),
					errors: z.array(z.object({ code: z.number(), message: z.string() })),
				}),
			},
			"404": {
				description: "Ingestion run not found",
				...contentJson({
					success: z.literal(false),
					errors: z.array(z.object({ code: z.number(), message: z.string() })),
				}),
			},
		},
	};

	public async handle(c: AppContext) {
		const validatedData = await this.getValidatedData<typeof this.schema>();
		const { runId } = validatedData.params;

		const prisma = createPrismaClient(c.env.DB);

		// Find the ingestion run
		const run = await prisma.watchlistIngestionRun.findUnique({
			where: { id: runId },
		});

		if (!run) {
			const error = new ApiException(`Ingestion run ${runId} not found`);
			error.status = 404;
			error.code = 404;
			throw error;
		}

		// Verify run is in 'pending' state
		if (run.status !== "pending") {
			const error = new ApiException(
				`Ingestion run ${runId} is not in pending state (current: ${run.status})`,
			);
			error.status = 400;
			error.code = 400;
			throw error;
		}

		// Extract R2 key from sourceUrl
		const r2Key = run.sourceUrl.replace("r2://", "");

		// Verify file exists in R2
		// Try binding first (production), then fall back to S3 API (local dev)
		let fileSize: number | undefined;

		if (c.env.WATCHLIST_UPLOADS_BUCKET) {
			const r2Object = await c.env.WATCHLIST_UPLOADS_BUCKET.head(r2Key);
			if (r2Object) {
				fileSize = r2Object.size;
			}
		}

		// If binding didn't find the file, try S3 API with credentials
		// This handles local dev where binding uses local storage but presigned URLs upload to real R2
		if (fileSize === undefined) {
			const r2Config = validateR2Config(c.env);
			if (r2Config) {
				const fileInfo = await checkFileExistsInR2(r2Config, r2Key);
				if (fileInfo.exists) {
					fileSize = fileInfo.size;
				}
			}
		}

		if (fileSize === undefined) {
			const error = new ApiException(
				`File not found in R2: ${r2Key}. Please upload the file using the presigned URL first.`,
			);
			error.status = 400;
			error.code = 400;
			throw error;
		}

		// Parse stored metadata
		let metadata: {
			batchSize?: number;
			reindexAll?: boolean;
		} = {};
		try {
			metadata = run.stats ? JSON.parse(run.stats) : {};
		} catch {
			// Ignore parse errors
		}

		// Update run status to 'running'
		const updatedRun = await prisma.watchlistIngestionRun.update({
			where: { id: runId },
			data: {
				status: "running",
				stats: JSON.stringify({
					...metadata,
					uploadCompletedAt: new Date().toISOString(),
					fileSize,
				}),
			},
		});

		// Create thread in thread-svc for processing
		if (!c.env.THREAD_SVC) {
			// Update run to failed if thread service not available
			await prisma.watchlistIngestionRun.update({
				where: { id: runId },
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

		// Create thread in thread-svc
		const threadPayload = {
			task_type: "ofac_parse",
			job_params: {
				r2_key: r2Key,
				callback_url: callbackUrl,
				truncate_before: true,
				run_id: run.id,
				batch_size: metadata.batchSize ?? 100,
			},
			metadata: {
				source: "watchlist-svc",
				source_type: run.sourceType,
				file_size: fileSize,
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
				`[IngestionComplete] Created thread ${threadData.id} for runId: ${run.id}, r2Key: ${r2Key}`,
			);

			// Store thread ID in run stats for tracking
			await prisma.watchlistIngestionRun.update({
				where: { id: runId },
				data: {
					stats: JSON.stringify({
						...metadata,
						uploadCompletedAt: new Date().toISOString(),
						fileSize,
						threadId: threadData.id,
					}),
				},
			});
		} catch (threadError) {
			console.error(
				`[IngestionComplete] Failed to create thread for runId: ${run.id}`,
				threadError,
			);

			// Update run to failed
			await prisma.watchlistIngestionRun.update({
				where: { id: runId },
				data: {
					status: "failed",
					finishedAt: new Date(),
					errorMessage: `Failed to create thread: ${
						threadError instanceof Error
							? threadError.message
							: String(threadError)
					}`,
				},
			});

			const error = new ApiException("Failed to create processing thread");
			error.status = 500;
			error.code = 500;
			throw error;
		}

		return {
			success: true as const,
			result: transformIngestionRun(updatedRun),
		};
	}
}

/**
 * POST /ingestion/:runId/failed
 * Notify that upload failed and clean up
 */
export class IngestionFailedEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Ingestion"],
		summary: "Report upload failure",
		description: `
Call this endpoint if the file upload to the presigned URL failed.
This will mark the ingestion run as failed and clean up any partial uploads.
		`,
		operationId: "ingestionFailed",
		request: {
			params: z.object({
				runId: z.string().regex(/^\d+$/).transform(Number),
			}),
			body: contentJson(
				z.object({
					error: z
						.string()
						.max(1000)
						.describe("Error message describing what went wrong"),
				}),
			),
		},
		responses: {
			"200": {
				description: "Failure recorded",
				...contentJson({
					success: z.literal(true),
					result: watchlistIngestionRun,
				}),
			},
			"404": {
				description: "Ingestion run not found",
				...contentJson({
					success: z.literal(false),
					errors: z.array(z.object({ code: z.number(), message: z.string() })),
				}),
			},
		},
	};

	public async handle(c: AppContext) {
		const validatedData = await this.getValidatedData<typeof this.schema>();
		const { runId } = validatedData.params;
		const { error: errorMessage } = validatedData.body;

		const prisma = createPrismaClient(c.env.DB);

		// Find the ingestion run
		const run = await prisma.watchlistIngestionRun.findUnique({
			where: { id: runId },
		});

		if (!run) {
			const error = new ApiException(`Ingestion run ${runId} not found`);
			error.status = 404;
			error.code = 404;
			throw error;
		}

		// Only allow failing pending runs
		if (run.status !== "pending") {
			const error = new ApiException(
				`Ingestion run ${runId} is not in pending state (current: ${run.status})`,
			);
			error.status = 400;
			error.code = 400;
			throw error;
		}

		// Extract R2 key and try to clean up partial upload
		const r2Key = run.sourceUrl.replace("r2://", "");

		if (c.env.WATCHLIST_UPLOADS_BUCKET) {
			try {
				// Check if partial upload exists and delete it
				const r2Object = await c.env.WATCHLIST_UPLOADS_BUCKET.head(r2Key);
				if (r2Object) {
					await c.env.WATCHLIST_UPLOADS_BUCKET.delete(r2Key);
					console.log(
						`[IngestionFailed] Cleaned up partial upload for runId: ${runId}, key: ${r2Key}`,
					);
				}
			} catch (cleanupError) {
				console.warn(
					`[IngestionFailed] Failed to clean up partial upload: ${cleanupError}`,
				);
				// Don't fail the request if cleanup fails
			}
		}

		// Update run status to 'failed'
		const updatedRun = await prisma.watchlistIngestionRun.update({
			where: { id: runId },
			data: {
				status: "failed",
				finishedAt: new Date(),
				errorMessage: `Upload failed: ${errorMessage}`,
			},
		});

		console.log(
			`[IngestionFailed] Marked run ${runId} as failed: ${errorMessage}`,
		);

		return {
			success: true as const,
			result: transformIngestionRun(updatedRun),
		};
	}
}
