/**
 * Internal Adverse Media endpoints for container callbacks.
 *
 * These endpoints are called by the adverse_media_grok container to deliver search results
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
 * Adverse Media result schema
 */
const adverseMediaResultSchema = z.object({
	search_id: z.string().describe("Search ID for tracking"),
	query: z.string().describe("Person/organization name searched"),
	entity_type: z
		.enum(["person", "organization"])
		.describe("Entity type searched"),
	risk_level: z
		.enum(["none", "low", "medium", "high"])
		.describe("Risk level assessment"),
	findings: z
		.object({
			es: z.string().describe("Findings summary in Spanish"),
			en: z.string().describe("Findings summary in English"),
		})
		.describe("Bilingual findings"),
	sources: z.array(z.string()).describe("Source URLs or domains"),
});

export type AdverseMediaResult = z.infer<typeof adverseMediaResultSchema>;

// =============================================================================
// POST /internal/adverse-media/results - Receive search results from container
// =============================================================================

/**
 * POST /internal/adverse-media/results
 * Receives adverse media search results from adverse_media_grok container
 */
export class InternalAdverseMediaResultsEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Receive Adverse Media results (internal)",
		description:
			"Called by adverse_media_grok container with adverse media search results. " +
			"Results are broadcast via SSE to connected clients.",
		security: [],
		request: {
			body: {
				content: {
					"application/json": {
						schema: adverseMediaResultSchema,
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
		const { search_id, query, entity_type, risk_level, findings, sources } =
			body as AdverseMediaResult;

		console.log(
			`[InternalAdverseMedia] Received results for search ${search_id} (query: ${query}, entity: ${entity_type}, risk: ${risk_level})`,
		);

		// Store in KV cache (cross-org cache, entity-type specific)
		if (c.env.PEP_CACHE) {
			const cacheKey = generateCacheKey("adverse_media", query, entity_type);
			const cacheData = { risk_level, findings, sources };
			await writeCache(c.env.PEP_CACHE, cacheKey, cacheData);
		}

		// Persist to D1 search_query table (org-scoped audit trail)
		const prisma = createPrismaClient(c.env.DB);
		try {
			await prisma.searchQuery.update({
				where: { id: search_id },
				data: {
					adverseMediaStatus: "completed",
					adverseMediaResult: JSON.stringify({
						risk_level,
						findings,
						sources,
					}),
				},
			});

			console.log(
				`[InternalAdverseMedia] Persisted adverse media result to search_query ${search_id}`,
			);

			// Check if all search types completed
			await checkAndUpdateQueryCompletion(prisma, search_id);
		} catch (persistError) {
			console.error(
				`[InternalAdverseMedia] Failed to persist to D1:`,
				persistError,
			);
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
						event: "adverse_media_results",
						payload: {
							search_id,
							query,
							risk_level,
							findings,
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
						`[InternalAdverseMedia] Broadcast sent to ${broadcastSent} clients for search ${search_id}`,
					);
				} else {
					console.error(
						`[InternalAdverseMedia] Broadcast failed: ${response.status}`,
						await response.text(),
					);
				}
			} catch (error) {
				console.error(
					`[InternalAdverseMedia] Failed to broadcast results:`,
					error,
				);
				// Don't fail the whole request if broadcast fails
			}
		} else {
			console.warn(
				`[InternalAdverseMedia] PEP_EVENTS_DO binding not configured`,
			);
		}

		return Response.json({
			success: true,
			broadcast_sent: broadcastSent,
		});
	}
}

// =============================================================================
// POST /internal/adverse-media/failed - Mark search as failed
// =============================================================================

/**
 * POST /internal/adverse-media/failed
 * Called by container when search fails
 */
export class InternalAdverseMediaFailedEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Mark Adverse Media search as failed (internal)",
		description:
			"Called by adverse_media_grok container when search fails. Broadcasts error to SSE clients.",
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

		console.log(`[InternalAdverseMedia] Search ${search_id} failed: ${error}`);

		// Persist failure to D1
		const prisma = createPrismaClient(c.env.DB);
		try {
			await prisma.searchQuery.update({
				where: { id: search_id },
				data: {
					adverseMediaStatus: "failed",
					adverseMediaResult: JSON.stringify({ error }),
				},
			});

			console.log(
				`[InternalAdverseMedia] Persisted failure status to search_query ${search_id}`,
			);

			// Check if all search types completed
			await checkAndUpdateQueryCompletion(prisma, search_id);
		} catch (persistError) {
			console.error(
				`[InternalAdverseMedia] Failed to persist failure to D1:`,
				persistError,
			);
			// Don't fail if D1 update fails (row might not exist)
		}

		// Broadcast failure via SSE
		if (c.env.PEP_EVENTS_DO) {
			try {
				const id = c.env.PEP_EVENTS_DO.idFromName(search_id);
				const stub = c.env.PEP_EVENTS_DO.get(id);

				const response = await stub.fetch("http://pep-events/broadcast", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						event: "adverse_media_error",
						payload: {
							search_id,
							status: "failed",
							error,
							failed_at: new Date().toISOString(),
						},
					}),
				});

				if (response.ok) {
					console.log(
						`[InternalAdverseMedia] Failure broadcast for search ${search_id}`,
					);
				} else {
					console.error(
						`[InternalAdverseMedia] Broadcast failed: ${response.status}`,
						await response.text(),
					);
				}
			} catch (broadcastError) {
				console.error(
					`[InternalAdverseMedia] Failed to broadcast error:`,
					broadcastError,
				);
			}
		}

		return Response.json({
			success: true,
		});
	}
}
