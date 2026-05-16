/**
 * Internal PEP endpoints for container callbacks.
 *
 * These endpoints are called by the pep_search container to deliver search results
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
import { createPrismaClient } from "../../lib/prisma";
import { generateCacheKey } from "../../lib/search-query-utils";
import {
	isGlobalCacheEnabled,
	resolveSearchQueryFlagEnvironment,
} from "../../lib/watchlist-cache";

// =============================================================================
// Schemas
// =============================================================================

/**
 * PEP raw result schema (full datosSolr object from API)
 */
const pepRawResultSchema = z
	.object({
		id: z.string(),
		nombre: z.string(),
		entidadfederativa: z.string().optional(),
		sujetoobligado: z.string().optional(),
		denominacion: z.string().optional(),
		areaadscripcion: z.string().optional(),
		periodoreporta: z.string().optional(),
		informacionPrincipal: z
			.object({
				nombre: z.string().optional(),
				institucion: z.string().optional(),
				cargo: z.string().optional(),
				area: z.string().optional(),
				telefono: z.string().optional(),
				correo: z.string().optional(),
				direccion: z.string().optional(),
				periodoinforma: z.string().optional(),
			})
			.optional(),
		complementoPrincipal: z
			.object({
				nombre: z.string().optional(),
				primerApellido: z.string().optional(),
				segundoApellido: z.string().optional(),
				entidadFederativa: z.string().optional(),
				sujetoObligado: z.string().optional(),
				denominacionCargo: z.string().optional(),
				areaAdscripcion: z.string().optional(),
				ejercicio: z.number().optional(),
				anioFechaInicio: z.number().optional(),
				fechaInicioPeriodo: z.string().optional(),
				fechaFinPeriodo: z.string().optional(),
			})
			.optional(),
		// Allow additional fields not explicitly defined
	})
	.passthrough()
	.describe("Complete datosSolr object from Transparency API");

export type PepRawResult = z.infer<typeof pepRawResultSchema>;

// =============================================================================
// POST /internal/pep/results - Receive search results from container
// =============================================================================

/**
 * POST /internal/pep/results
 * Receives complete search results from pep_search container
 */
export class InternalPepResultsEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Receive PEP search results (internal)",
		description:
			"Called by pep_search container with complete search results. " +
			"Results are cached (if enabled) and broadcast via SSE to connected clients.",
		security: [],
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							search_id: z.string().describe("Search ID for tracking"),
							query: z.string().describe("Original search query"),
							total_results: z
								.number()
								.int()
								.describe("Total results available"),
							total_pages: z.number().int().describe("Total pages available"),
							results: z
								.array(pepRawResultSchema)
								.describe("Complete datosSolr objects"),
							results_sent: z
								.number()
								.int()
								.describe("Number of results in this response"),
						}),
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
							cached: z.boolean(),
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
			total_results,
			total_pages,
			results,
			results_sent,
		} = body as {
			search_id: string;
			query: string;
			total_results: number;
			total_pages: number;
			results: PepRawResult[];
			results_sent: number;
		};

		console.log(
			`[InternalPep] Received ${results_sent} results for search ${search_id} (query: ${query})`,
		);

		const prismaForFlags = createPrismaClient(c.env.DB);
		const flagEnv = await resolveSearchQueryFlagEnvironment(
			prismaForFlags,
			search_id,
		);
		const cacheOn = await isGlobalCacheEnabled(c.env, { environment: flagEnv });
		const cacheKey = generateCacheKey("pep_search", query);

		const { broadcastSent, cacheWritten } =
			await runWatchlistContainerSuccessPipeline({
				env: c.env,
				searchId: search_id,
				logPrefix: "[InternalPep]",
				cacheWrite:
					cacheOn && c.env.PEP_CACHE
						? {
								kv: c.env.PEP_CACHE,
								key: cacheKey,
								value: {
									query,
									total_results,
									total_pages,
									results,
									results_sent,
									cached_at: new Date().toISOString(),
								},
							}
						: undefined,
				persist: async (prisma) => {
					const row = await prisma.searchQuery.update({
						where: { id: search_id },
						data: {
							pepOfficialStatus: "completed",
							pepOfficialResult: JSON.stringify({
								query,
								total_results,
								total_pages,
								results,
								results_sent,
							}),
							pepOfficialCount: results_sent,
						},
					});
					return { source: row.source };
				},
				aml: { type: "pep_official", matched: results_sent > 0 },
				broadcast: {
					event: "pep_results",
					payload: {
						search_id,
						query,
						total_results,
						total_pages,
						results,
						results_sent,
						status: "completed",
						completed_at: new Date().toISOString(),
					},
				},
			});

		return Response.json({
			success: true,
			cached: cacheWritten,
			broadcast_sent: broadcastSent,
		});
	}
}

// =============================================================================
// POST /internal/pep/failed - Mark search as failed
// =============================================================================

/**
 * POST /internal/pep/failed
 * Called by container when search fails
 */
export class InternalPepFailedEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Mark PEP search as failed (internal)",
		description:
			"Called by pep_search container when search fails. Broadcasts error to SSE clients.",
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

		console.log(`[InternalPep] Search ${search_id} failed: ${error}`);

		await runWatchlistContainerFailurePipeline({
			env: c.env,
			searchId: search_id,
			logPrefix: "[InternalPep]",
			persist: async (prisma) => {
				const row = await prisma.searchQuery.update({
					where: { id: search_id },
					data: {
						pepOfficialStatus: "failed",
						pepOfficialResult: JSON.stringify({ error }),
					},
				});
				return { source: row.source };
			},
			aml: { type: "pep_official" },
			broadcast: {
				event: "pep_error",
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
