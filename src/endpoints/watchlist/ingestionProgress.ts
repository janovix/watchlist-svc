import { OpenAPIRoute, ApiException } from "chanfana";
import { AppContext } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import { createPrismaClient } from "../../lib/prisma";
import { ingestionProgress } from "./base";

export class IngestionProgressEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Ingestion"],
		summary: "Get real-time progress of an ingestion run",
		description:
			"Returns the current progress of an ingestion run. Poll this endpoint to track progress in real-time.",
		operationId: "getIngestionProgress",
		request: {
			params: z.object({
				runId: z.coerce
					.number()
					.int()
					.positive()
					.describe("The ID of the ingestion run"),
			}),
		},
		responses: {
			"200": {
				description: "Current progress of the ingestion run",
				...contentJson({
					success: Boolean,
					result: ingestionProgress,
				}),
			},
			"404": {
				description: "Ingestion run not found",
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
		const data = await this.getValidatedData<typeof this.schema>();
		const prisma = createPrismaClient(c.env.DB);

		const run = await prisma.watchlistIngestionRun.findUnique({
			where: { id: data.params.runId },
			select: {
				id: true,
				status: true,
				progressPhase: true,
				progressRecordsProcessed: true,
				progressTotalEstimate: true,
				progressPercentage: true,
				progressCurrentBatch: true,
				progressUpdatedAt: true,
				vectorizeThreadId: true,
			},
		});

		if (!run) {
			const error = new ApiException("Ingestion run not found");
			error.status = 404;
			error.code = 404;
			throw error;
		}

		let finalPercentage = run.progressPercentage ?? 0;
		let phase = run.progressPhase ?? mapStatusToPhase(run.status);

		// Si hay vectorización en progreso, consultar su progreso
		if (run.vectorizeThreadId && c.env.THREAD_SVC) {
			try {
				const threadResponse = await c.env.THREAD_SVC.fetch(
					`http://thread-svc/threads/${run.vectorizeThreadId}`,
				);

				if (threadResponse.ok) {
					const thread = (await threadResponse.json()) as {
						status: string;
						progress?: number;
						phase?: string;
					};

					// Si vectorización está en progreso, combinar porcentajes
					if (thread.status === "RUNNING") {
						const vectorizeProgress = thread.progress ?? 0; // 0-100
						// Ingestion = 0-70%, Vectorize = 70-100%
						finalPercentage = 70 + Math.round(vectorizeProgress * 0.3);
						phase = thread.phase ?? "vectorizing";
					} else if (thread.status === "COMPLETED") {
						finalPercentage = 100;
						phase = "completed";
					} else if (thread.status === "FAILED") {
						phase = "vectorize_failed";
					}
				}
			} catch (e) {
				console.error(
					"[IngestionProgress] Failed to fetch vectorize thread:",
					e,
				);
			}
		}

		return {
			success: true,
			result: {
				phase,
				recordsProcessed: run.progressRecordsProcessed ?? 0,
				totalRecordsEstimate: run.progressTotalEstimate ?? 0,
				percentage: finalPercentage,
				currentBatch: run.progressCurrentBatch ?? 0,
				updatedAt: run.progressUpdatedAt?.toISOString() ?? null,
			},
		};
	}
}

/**
 * Map run status to progress phase for backwards compatibility
 */
function mapStatusToPhase(
	status: string,
): "idle" | "initializing" | "completed" | "failed" {
	switch (status) {
		case "pending":
			return "idle";
		case "running":
			return "initializing";
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		default:
			return "idle";
	}
}
