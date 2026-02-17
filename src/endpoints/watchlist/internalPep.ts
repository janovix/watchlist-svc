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
import { createHash } from "crypto";
import { createPrismaClient } from "../../lib/prisma";
import { checkAndUpdateQueryCompletion } from "../../lib/search-query-utils";

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

		let cached = false;

		// Store in KV cache if enabled
		const cacheEnabled = c.env.PEP_CACHE_ENABLED === "true";
		if (cacheEnabled && c.env.PEP_CACHE) {
			try {
				const cacheKey = this.generateCacheKey(query);
				const cacheData = {
					query,
					total_results,
					total_pages,
					results,
					results_sent,
					cached_at: new Date().toISOString(),
				};

				await c.env.PEP_CACHE.put(cacheKey, JSON.stringify(cacheData), {
					expirationTtl: 86400, // 24 hours
				});

				cached = true;
				console.log(
					`[InternalPep] Cached ${results_sent} results for query "${query}" (TTL: 24h)`,
				);
			} catch (error) {
				console.error(`[InternalPep] Failed to cache results:`, error);
				// Don't fail the whole request if cache fails
			}
		}

		// Persist to SearchQuery table
		try {
			const prisma = createPrismaClient(c.env.DB);
			const searchQuery = await prisma.searchQuery.update({
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
			console.log(
				`[InternalPep] Persisted ${results_sent} results to SearchQuery ${search_id}`,
			);

			// Check if all searches are done and update overall status
			await checkAndUpdateQueryCompletion(prisma, search_id);

			// If this is an AML-screening query, callback to aml-svc
			if (searchQuery.source === "aml-screening" && c.env.AML_SERVICE) {
				try {
					const response = await c.env.AML_SERVICE.fetch(
						"http://aml-svc/internal/screening-callback",
						{
							method: "PATCH",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								queryId: search_id,
								type: "pep_official",
								status: "completed",
								matched: results_sent > 0,
							}),
						},
					);

					if (response.ok) {
						console.log(
							`[InternalPep] AML callback sent for query ${search_id}`,
						);
					} else {
						const errorText = await response.text();
						console.error(
							`[InternalPep] AML callback failed: ${response.status} ${errorText}`,
						);
					}
				} catch (callbackError) {
					console.error(
						`[InternalPep] Failed to send AML callback:`,
						callbackError,
					);
					// Don't fail the whole request if callback fails
				}
			}
		} catch (error) {
			console.error(
				`[InternalPep] Failed to persist results to SearchQuery:`,
				error,
			);
			// Don't fail the whole request if persistence fails
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
					}),
				});

				if (response.ok) {
					const broadcastResult = (await response.json()) as {
						sent: number;
					};
					broadcastSent = broadcastResult.sent;
					console.log(
						`[InternalPep] Broadcast sent to ${broadcastSent} clients for search ${search_id}`,
					);
				} else {
					console.error(
						`[InternalPep] Broadcast failed: ${response.status}`,
						await response.text(),
					);
				}
			} catch (error) {
				console.error(`[InternalPep] Failed to broadcast results:`, error);
				// Don't fail the whole request if broadcast fails
			}
		} else {
			console.warn(`[InternalPep] PEP_EVENTS_DO binding not configured`);
		}

		return Response.json({
			success: true,
			cached,
			broadcast_sent: broadcastSent,
		});
	}

	/**
	 * Generate cache key from query string
	 */
	private generateCacheKey(query: string): string {
		const normalized = query.toLowerCase().trim();
		const hash = createHash("sha256").update(normalized).digest("hex");
		return `pep_search:${hash}`;
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

		// Persist failure to SearchQuery table
		try {
			const prisma = createPrismaClient(c.env.DB);
			const searchQuery = await prisma.searchQuery.update({
				where: { id: search_id },
				data: {
					pepOfficialStatus: "failed",
					pepOfficialResult: JSON.stringify({ error }),
				},
			});
			console.log(
				`[InternalPep] Persisted failure to SearchQuery ${search_id}`,
			);

			// Check if all searches are done and update overall status
			await checkAndUpdateQueryCompletion(prisma, search_id);

			// If this is an AML-screening query, callback to aml-svc
			if (searchQuery.source === "aml-screening" && c.env.AML_SERVICE) {
				try {
					const response = await c.env.AML_SERVICE.fetch(
						"http://aml-svc/internal/screening-callback",
						{
							method: "PATCH",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								queryId: search_id,
								type: "pep_official",
								status: "failed",
								matched: false,
							}),
						},
					);

					if (response.ok) {
						console.log(
							`[InternalPep] AML callback sent for failed query ${search_id}`,
						);
					} else {
						const errorText = await response.text();
						console.error(
							`[InternalPep] AML callback failed: ${response.status} ${errorText}`,
						);
					}
				} catch (callbackError) {
					console.error(
						`[InternalPep] Failed to send AML callback:`,
						callbackError,
					);
					// Don't fail the whole request if callback fails
				}
			}
		} catch (persistError) {
			console.error(
				`[InternalPep] Failed to persist failure to SearchQuery:`,
				persistError,
			);
			// Don't fail the whole request if persistence fails
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
						event: "pep_error",
						payload: {
							search_id,
							status: "failed",
							error,
							failed_at: new Date().toISOString(),
						},
					}),
				});

				console.log(`[InternalPep] Failure broadcast for search ${search_id}`);
			} catch (broadcastError) {
				console.error(
					`[InternalPep] Failed to broadcast error:`,
					broadcastError,
				);
			}
		}

		return Response.json({
			success: true,
		});
	}
}
