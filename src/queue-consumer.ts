/**
 * Queue consumer worker for background ingestion processing
 * Handles CSV ingestion jobs from the queue with memory-efficient streaming
 */

import { createPrismaClient } from "./lib/prisma";
import { ingestCSVStreaming } from "./lib/ingestion-service";
import { serializeJsonField } from "./endpoints/watchlist/base";
import type { IngestionJob } from "./types";

// Extend Env type for queue consumer
interface QueueEnv extends Env {
	AI?: {
		run: (
			model: string,
			input: { text: string[] },
		) => Promise<{ data: number[][] }>;
	};
}

export async function queue(
	batch: MessageBatch<IngestionJob>,
	env: QueueEnv,
	_ctx: ExecutionContext,
): Promise<void> {
	for (const message of batch.messages) {
		const job = message.body;
		const prisma = createPrismaClient(env.DB);

		console.log(`[Ingestion Worker] Processing job for runId: ${job.runId}`, {
			csvUrl: job.csvUrl,
			reindexAll: job.reindexAll,
			messageId: message.id,
		});

		try {
			// Update run status to running if not already
			await prisma.watchlistIngestionRun.update({
				where: { id: job.runId },
				data: {
					status: "running",
				},
			});

			console.log(
				`[Ingestion Worker] Starting ingestion for runId: ${job.runId}`,
			);

			// Process ingestion with streaming
			const stats = await ingestCSVStreaming(
				prisma,
				env.WATCHLIST_VECTORIZE,
				env.AI,
				job.csvUrl,
				job.runId,
				{
					reindexAll: job.reindexAll,
					onProgress: async (progress) => {
						// Update progress in database
						await prisma.watchlistIngestionRun.update({
							where: { id: job.runId },
							data: {
								stats: serializeJsonField(progress),
							},
						});
						console.log(
							`[Ingestion Worker] Progress for runId ${job.runId}:`,
							progress,
						);
					},
				},
			);

			// Update run status to completed
			await prisma.watchlistIngestionRun.update({
				where: { id: job.runId },
				data: {
					status: "completed",
					finishedAt: new Date(),
					stats: serializeJsonField(stats),
				},
			});

			console.log(
				`[Ingestion Worker] Completed ingestion for runId: ${job.runId}`,
				stats,
			);

			// Acknowledge message
			message.ack();
		} catch (error) {
			// Capture detailed error information
			let errorMessage: string;
			if (error instanceof Error) {
				errorMessage = error.message;
				// Include stack trace for debugging (first 500 chars to avoid DB limits)
				if (error.stack) {
					const stackPreview = error.stack.split("\n").slice(0, 5).join("\n");
					errorMessage = `${errorMessage}\n\nStack trace:\n${stackPreview}`;
				}
			} else {
				errorMessage = String(error);
			}

			// Truncate if too long (D1 has limits)
			if (errorMessage.length > 1000) {
				errorMessage = errorMessage.substring(0, 997) + "...";
			}

			console.error(
				`[Ingestion Worker] Failed ingestion for runId: ${job.runId}`,
				error,
			);

			// Update run status to failed
			await prisma.watchlistIngestionRun.update({
				where: { id: job.runId },
				data: {
					status: "failed",
					finishedAt: new Date(),
					errorMessage,
				},
			});

			// Retry the message (Cloudflare Queues will handle retries automatically)
			message.retry();
		}
	}
}
