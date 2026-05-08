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

		const prismaForFlags = createPrismaClient(c.env.DB);
		const flagEnv = await resolveSearchQueryFlagEnvironment(
			prismaForFlags,
			search_id,
		);
		const cacheOn = await isGlobalCacheEnabled(c.env, { environment: flagEnv });
		const cacheKey = generateCacheKey("adverse_media", query, entity_type);

		const { broadcastSent } = await runWatchlistContainerSuccessPipeline({
			env: c.env,
			searchId: search_id,
			logPrefix: "[InternalAdverseMedia]",
			cacheWrite:
				cacheOn && c.env.PEP_CACHE
					? {
							kv: c.env.PEP_CACHE,
							key: cacheKey,
							value: { risk_level, findings, sources },
						}
					: undefined,
			persist: async (prisma) => {
				const row = await prisma.searchQuery.update({
					where: { id: search_id },
					data: {
						adverseMediaStatus: "completed",
						adverseMediaResult: JSON.stringify({
							risk_level,
							findings,
							sources,
						}),
						adverseMediaHasRisk: risk_level !== "none",
						adverseMediaRiskLevel: risk_level !== "none" ? risk_level : null,
					},
				});
				return { source: row.source };
			},
			aml: {
				type: "adverse_media",
				matched: risk_level === "high" || risk_level === "medium",
			},
			broadcast: {
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
			},
		});

		return Response.json({
			success: true,
			broadcast_sent: broadcastSent,
		});
	}
}

// =============================================================================
// POST /internal/adverse-media/progress - Progress updates from container
// =============================================================================

/**
 * POST /internal/adverse-media/progress
 * Called by adverse_media_grok container during execution to stream progress to SSE clients.
 */
export class InternalAdverseMediaProgressEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Adverse Media progress (internal)",
		description:
			"Called by adverse_media_grok container to broadcast progress (e.g. Searching websites..., Thinking...).",
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
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return Response.json(
				{ success: false, error: "Invalid JSON body" },
				{ status: 400 },
			);
		}
		const parsed = containerProgressPayloadSchema.safeParse(body);
		if (!parsed.success) {
			return Response.json(
				{
					success: false,
					error: "Validation failed",
					issues: parsed.error.issues,
				},
				{ status: 400 },
			);
		}
		const { search_id, phase, message, progress } = parsed.data;

		const { sent } = await broadcastPepEvent(
			c.env,
			search_id,
			"adverse_media_progress",
			{ phase, message, progress },
		);

		return Response.json({ success: true, sent });
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

		await runWatchlistContainerFailurePipeline({
			env: c.env,
			searchId: search_id,
			logPrefix: "[InternalAdverseMedia]",
			persist: async (prisma) => {
				const row = await prisma.searchQuery.update({
					where: { id: search_id },
					data: {
						adverseMediaStatus: "failed",
						adverseMediaResult: JSON.stringify({ error }),
					},
				});
				return { source: row.source };
			},
			aml: { type: "adverse_media" },
			broadcast: {
				event: "adverse_media_error",
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
