import { OpenAPIRoute, ApiException } from "chanfana";
import { AppContext } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import { createPrismaClient } from "../../lib/prisma";
import { ingestCSV } from "../../lib/ingestion-service";
import { watchlistIngestionRun } from "./base";

/**
 * Check admin API key from header
 */
function checkAdminAuth(c: AppContext): void {
	const apiKey = c.req.header("x-admin-api-key");
	const expectedKey = c.env.ADMIN_API_KEY;

	if (!expectedKey) {
		const error = new ApiException("Admin API key not configured");
		error.status = 500;
		error.code = 500;
		throw error;
	}

	if (!apiKey || apiKey !== expectedKey) {
		const error = new ApiException("Unauthorized");
		error.status = 401;
		error.code = 401;
		throw error;
	}
}

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
		checkAdminAuth(c);
		const validatedData = await this.getValidatedData<typeof this.schema>();
		const prisma = createPrismaClient(c.env.DB);

		// Create ingestion run record
		const run = await prisma.watchlistIngestionRun.create({
			data: {
				sourceUrl: validatedData.body.csvUrl,
				status: "running",
			},
		});

		// Start ingestion asynchronously
		const ingestionPromise = ingestCSV(
			prisma,
			c.env.WATCHLIST_VECTORIZE,
			c.env.AI,
			validatedData.body.csvUrl,
			run.id,
			{
				reindexAll: validatedData.body.reindexAll,
			},
		)
			.then(async (stats) => {
				await prisma.watchlistIngestionRun.update({
					where: { id: run.id },
					data: {
						status: "completed",
						finishedAt: new Date(),
						stats: JSON.stringify(stats),
					},
				});
			})
			.catch(async (error) => {
				await prisma.watchlistIngestionRun.update({
					where: { id: run.id },
					data: {
						status: "failed",
						finishedAt: new Date(),
						errorMessage:
							error instanceof Error ? error.message : String(error),
					},
				});
			});

		// Use waitUntil if available, otherwise await (for testing)
		const executionCtx = c.executionCtx as {
			waitUntil?: (p: Promise<unknown>) => void;
		};
		if (executionCtx?.waitUntil) {
			executionCtx.waitUntil(ingestionPromise);
		} else {
			// For testing, we might want to await
			await ingestionPromise;
		}

		return {
			success: true,
			result: {
				id: run.id,
				sourceUrl: run.sourceUrl,
				status: run.status as "running" | "completed" | "failed",
				startedAt: run.startedAt.toISOString(),
				finishedAt: run.finishedAt?.toISOString() || null,
				stats: null,
				errorMessage: null,
				createdAt: run.createdAt.toISOString(),
			},
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
		checkAdminAuth(c);
		await this.getValidatedData<typeof this.schema>();
		const prisma = createPrismaClient(c.env.DB);

		// Count targets
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
