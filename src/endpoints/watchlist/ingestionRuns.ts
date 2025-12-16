import { OpenAPIRoute, ApiException } from "chanfana";
import { AppContext } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import { createPrismaClient } from "../../lib/prisma";
import { watchlistIngestionRun, parseJsonField } from "./base";

export class IngestionRunsListEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Ingestion"],
		summary: "List ingestion runs",
		operationId: "listIngestionRuns",
		request: {
			query: z.object({
				limit: z.coerce.number().int().min(1).max(100).optional().default(10),
			}),
		},
		responses: {
			"200": {
				description: "List of ingestion runs",
				...contentJson({
					success: Boolean,
					result: z.array(watchlistIngestionRun),
				}),
			},
		},
	};

	public async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const prisma = createPrismaClient(c.env.DB);

		const runs = await prisma.watchlistIngestionRun.findMany({
			orderBy: { startedAt: "desc" },
			take: data.query.limit,
		});

		return {
			success: true,
			result: runs.map((run: (typeof runs)[number]) => ({
				id: run.id,
				sourceUrl: run.sourceUrl,
				status: run.status as "running" | "completed" | "failed",
				startedAt: run.startedAt.toISOString(),
				finishedAt: run.finishedAt?.toISOString() || null,
				stats: parseJsonField<Record<string, unknown>>(run.stats),
				errorMessage: run.errorMessage,
				createdAt: run.createdAt.toISOString(),
			})),
		};
	}
}

export class IngestionRunReadEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Ingestion"],
		summary: "Get an ingestion run by ID",
		operationId: "getIngestionRun",
		request: {
			params: z.object({
				runId: z.coerce.number().int().positive().describe("The ID of the ingestion run"),
			}),
		},
		responses: {
			"200": {
				description: "Ingestion run found",
				...contentJson({
					success: Boolean,
					result: watchlistIngestionRun,
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
		});

		if (!run) {
			const error = new ApiException("Ingestion run not found");
			error.status = 404;
			error.code = 404;
			throw error;
		}

		return {
			success: true,
			result: {
				id: run.id,
				sourceUrl: run.sourceUrl,
				status: run.status as "running" | "completed" | "failed",
				startedAt: run.startedAt.toISOString(),
				finishedAt: run.finishedAt?.toISOString() || null,
				stats: parseJsonField<Record<string, unknown>>(run.stats),
				errorMessage: run.errorMessage,
				createdAt: run.createdAt.toISOString(),
			},
		};
	}
}
