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
import {
	runWatchlistContainerFailurePipeline,
	runWatchlistContainerSuccessPipeline,
} from "../../lib/container-callback-pipeline";
import { broadcastPepEvent } from "../../lib/pep-events-broadcast";
import { createPrismaClient } from "../../lib/prisma";
import { generateCacheKey } from "../../lib/search-query-utils";
import {
	isGlobalCacheEnabled,
	resolveSearchQueryFlagEnvironment,
} from "../../lib/watchlist-cache";
import { containerProgressPayloadSchema } from "./schemas";

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
	entity_type: z.enum(["person", "organization"]).optional(),
	birthdate: z.string().optional(),
	country: z.string().optional(),
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
		const {
			search_id,
			query,
			probability,
			summary,
			sources,
			entity_type,
			birthdate,
			country,
		} = body as GrokPepResult;

		console.log(
			`[InternalGrokPep] Received results for search ${search_id} (query: ${query}, probability: ${probability})`,
		);

		const prismaForFlags = createPrismaClient(c.env.DB);
		const flagEnv = await resolveSearchQueryFlagEnvironment(
			prismaForFlags,
			search_id,
		);
		const cacheOn = await isGlobalCacheEnabled(c.env, { environment: flagEnv });
		const pepSuffix = [entity_type ?? "person", birthdate, country]
			.filter(Boolean)
			.join(":");
		const cacheKey = generateCacheKey(
			"pep_ai",
			query,
			pepSuffix.length > 0 ? pepSuffix : undefined,
		);

		const { broadcastSent } = await runWatchlistContainerSuccessPipeline({
			env: c.env,
			searchId: search_id,
			logPrefix: "[InternalGrokPep]",
			cacheWrite:
				cacheOn && c.env.PEP_CACHE
					? {
							kv: c.env.PEP_CACHE,
							key: cacheKey,
							value: { probability, summary, sources },
						}
					: undefined,
			persist: async (prisma) => {
				const row = await prisma.searchQuery.update({
					where: { id: search_id },
					data: {
						pepAiStatus: "completed",
						pepAiResult: JSON.stringify({ probability, summary, sources }),
					},
				});
				return { source: row.source };
			},
			aml: { type: "pep_ai", matched: probability >= 0.7 },
			broadcast: {
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
			},
		});

		return Response.json({
			success: true,
			broadcast_sent: broadcastSent,
		});
	}
}

// =============================================================================
// POST /internal/grok-pep/progress - Progress updates from container
// =============================================================================

/**
 * POST /internal/grok-pep/progress
 * Called by pep_grok container during execution to stream progress to SSE clients.
 */
export class InternalGrokPepProgressEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Grok PEP progress (internal)",
		description:
			"Called by pep_grok container to broadcast progress (e.g. Searching websites..., Thinking...).",
		security: [],
		request: {
			body: {
				content: {
					"application/json": {
						schema: containerProgressPayloadSchema,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Progress broadcast sent",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							sent: z.number().int(),
						}),
					},
				},
			},
		},
	};

	async handle(c: { env: Bindings; req: Request }) {
		if (
			c.env.INTERNAL_SECRET != null &&
			c.env.INTERNAL_SECRET !== "" &&
			c.req.headers.get("X-Internal-Secret") !== c.env.INTERNAL_SECRET
		) {
			return Response.json(
				{ success: false, error: "Unauthorized" },
				{ status: 401 },
			);
		}
		const body = await c.req.json();
		const { search_id, phase, message, progress } = body as z.infer<
			typeof containerProgressPayloadSchema
		>;

		if (!search_id) {
			return Response.json(
				{ success: false, error: "search_id required" },
				{ status: 400 },
			);
		}

		const { sent } = await broadcastPepEvent(
			c.env,
			search_id,
			"pep_grok_progress",
			{
				phase,
				message,
				progress,
			},
		);

		return Response.json({ success: true, sent });
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

		await runWatchlistContainerFailurePipeline({
			env: c.env,
			searchId: search_id,
			logPrefix: "[InternalGrokPep]",
			persist: async (prisma) => {
				const row = await prisma.searchQuery.update({
					where: { id: search_id },
					data: {
						pepAiStatus: "failed",
						pepAiResult: JSON.stringify({ error }),
					},
				});
				return { source: row.source };
			},
			aml: { type: "pep_ai" },
			broadcast: {
				event: "pep_grok_error",
				payload: {
					search_id,
					status: "failed",
					error,
					failed_at: new Date().toISOString(),
				},
			},
		});

		return Response.json({
			success: true,
		});
	}
}
