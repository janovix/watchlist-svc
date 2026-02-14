/**
 * Internal Grok PEP endpoints for container callbacks.
 *
 * These endpoints are called by the pep_grok container to deliver search results
 * and broadcast them to clients via SSE (Server-Sent Events).
 *
 * These are INTERNAL endpoints - not exposed to public API.
 */

import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { Bindings } from "../../index";
import { createPrismaClient } from "../../lib/prisma";
import {
	generateCacheKey,
	writeCache,
	checkAndUpdateQueryCompletion,
} from "../../lib/search-query-utils";

// =============================================================================
// Schemas
// =============================================================================

/**
 * Grok PEP result schema
 */
const grokPepResultSchema = z.object({
	search_id: z.string().describe("Search ID for tracking"),
	query: z.string().describe("Person's name searched"),
	probability: z.number().min(0).max(1).describe("PEP probability (0-1)"),
	summary: z
		.object({
			es: z.string().describe("Summary in Spanish"),
			en: z.string().describe("Summary in English"),
		})
		.describe("Bilingual summary"),
	sources: z.array(z.string()).describe("Source URLs or domains"),
});

export type GrokPepResult = z.infer<typeof grokPepResultSchema>;

// =============================================================================
// POST /internal/grok-pep/results - Receive search results from container
// =============================================================================

/**
 * POST /internal/grok-pep/results
 * Receives PEP detection results from pep_grok container
 */
export class InternalGrokPepResultsEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Receive Grok PEP results (internal)",
		description:
			"Called by pep_grok container with PEP detection results. " +
			"Results are broadcast via SSE to connected clients.",
		security: [],
		request: {
			body: {
				content: {
					"application/json": {
						schema: grokPepResultSchema,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Results received and broadcast successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							broadcast_sent: z.number().int(),
						}),
					},
				},
			},
		},
	};

	async handle(c: { env: Bindings; req: Request }) {
		const body = await c.req.json();
		const { search_id, query, probability, summary, sources } =
			body as GrokPepResult;

		console.log(
			`[InternalGrokPep] Received results for search ${search_id} (query: ${query}, probability: ${probability})`,
		);

		// Store in KV cache (cross-org cache for latency reduction)
		if (c.env.PEP_CACHE) {
			const cacheKey = generateCacheKey("pep_ai", query);
			const cacheData = { probability, summary, sources };
			await writeCache(c.env.PEP_CACHE, cacheKey, cacheData);
		}

		// Persist to D1 search_query table (org-scoped audit trail)
		const prisma = createPrismaClient(c.env.DB);
		try {
			await prisma.searchQuery.update({
				where: { id: search_id },
				data: {
					pepAiStatus: "completed",
					pepAiResult: JSON.stringify({ probability, summary, sources }),
				},
			});

			console.log(
				`[InternalGrokPep] Persisted PEP AI result to search_query ${search_id}`,
			);

			// Check if all search types completed
			await checkAndUpdateQueryCompletion(prisma, search_id);
		} catch (persistError) {
			console.error(`[InternalGrokPep] Failed to persist to D1:`, persistError);
			// Don't fail the whole request if D1 persistence fails
		}

		// Broadcast results via SSE to connected clients
		let broadcastSent = 0;
		if (c.env.PEP_EVENTS_DO) {
			try {
				const id = c.env.PEP_EVENTS_DO.idFromName(search_id);
				const stub = c.env.PEP_EVENTS_DO.get(id);

				const response = await stub.fetch("http://pep-events/broadcast", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						event: "pep_grok_results",
						payload: {
							search_id,
							query,
							probability,
							summary,
							sources,
							status: "completed",
							completed_at: new Date().toISOString(),
						},
					}),
				});

				if (response.ok) {
					const broadcastResult = (await response.json()) as {
						sent: number;
					};
					broadcastSent = broadcastResult.sent;
					console.log(
						`[InternalGrokPep] Broadcast sent to ${broadcastSent} clients for search ${search_id}`,
					);
				} else {
					console.error(
						`[InternalGrokPep] Broadcast failed: ${response.status}`,
						await response.text(),
					);
				}
			} catch (error) {
				console.error(`[InternalGrokPep] Failed to broadcast results:`, error);
				// Don't fail the whole request if broadcast fails
			}
		} else {
			console.warn(`[InternalGrokPep] PEP_EVENTS_DO binding not configured`);
		}

		return Response.json({
			success: true,
			broadcast_sent: broadcastSent,
		});
	}
}

// =============================================================================
// POST /internal/grok-pep/failed - Mark search as failed
// =============================================================================

/**
 * POST /internal/grok-pep/failed
 * Called by container when search fails
 */
export class InternalGrokPepFailedEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Mark Grok PEP search as failed (internal)",
		description:
			"Called by pep_grok container when search fails. Broadcasts error to SSE clients.",
		security: [],
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							search_id: z.string().describe("Search ID"),
							error: z.string().describe("Error message"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Failure acknowledged",
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
		const { search_id, error } = body as { search_id: string; error: string };

		console.log(`[InternalGrokPep] Search ${search_id} failed: ${error}`);

		// Persist failure to D1
		const prisma = createPrismaClient(c.env.DB);
		try {
			await prisma.searchQuery.update({
				where: { id: search_id },
				data: {
					pepAiStatus: "failed",
					pepAiResult: JSON.stringify({ error }),
				},
			});

			console.log(
				`[InternalGrokPep] Persisted failure status to search_query ${search_id}`,
			);

			// Check if all search types completed
			await checkAndUpdateQueryCompletion(prisma, search_id);
		} catch (persistError) {
			console.error(
				`[InternalGrokPep] Failed to persist failure to D1:`,
				persistError,
			);
			// Don't fail if D1 update fails (row might not exist)
		}

		// Broadcast failure via SSE
		if (c.env.PEP_EVENTS_DO) {
			try {
				const id = c.env.PEP_EVENTS_DO.idFromName(search_id);
				const stub = c.env.PEP_EVENTS_DO.get(id);

				await stub.fetch("http://pep-events/broadcast", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						event: "pep_grok_error",
						payload: {
							search_id,
							status: "failed",
							error,
							failed_at: new Date().toISOString(),
						},
					}),
				});

				console.log(
					`[InternalGrokPep] Failure broadcast for search ${search_id}`,
				);
			} catch (broadcastError) {
				console.error(
					`[InternalGrokPep] Failed to broadcast error:`,
					broadcastError,
				);
			}
		}

		return Response.json({
			success: true,
		});
	}
}
