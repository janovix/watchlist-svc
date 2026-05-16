/**
 * Legacy HTTP paths for PEP AI callbacks (`/internal/grok-pep/*`).
 * Handlers delegate to {@link completePepAiResearch} / {@link failPepAiResearch}.
 */

import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { Bindings } from "../../index";
import {
	failPepAiResearch,
	completePepAiResearch,
} from "../../lib/research-results";
import { broadcastPepEvent } from "../../lib/pep-events-broadcast";
import { containerProgressPayloadSchema } from "./schemas";

const grokPepResultSchema = z.object({
	search_id: z.string(),
	query: z.string(),
	probability: z.number().min(0).max(1),
	summary: z.object({
		es: z.string(),
		en: z.string(),
	}),
	sources: z.array(z.string()),
	entity_type: z.enum(["person", "organization"]).optional(),
	birthdate: z.string().optional(),
	country: z.string().optional(),
});

export type GrokPepResult = z.infer<typeof grokPepResultSchema>;

export class InternalGrokPepResultsEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Receive PEP AI results (internal)",
		description:
			"Legacy path name (grok-pep). Persists PEP AI results and broadcasts SSE.",
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
				description: "Results received",
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
		const body = grokPepResultSchema.parse(await c.req.json());
		console.log(
			`[InternalGrokPep] Received results for search ${body.search_id} (query: ${body.query}, probability: ${body.probability})`,
		);

		const { broadcastSent } = await completePepAiResearch(c.env, {
			searchId: body.search_id,
			query: body.query,
			entityType: body.entity_type ?? "person",
			birthdate: body.birthdate,
			country: body.country,
			probability: body.probability,
			summary: body.summary,
			sources: body.sources,
			logPrefix: "[InternalGrokPep]",
		});

		return Response.json({
			success: true,
			broadcast_sent: broadcastSent,
		});
	}
}

export class InternalGrokPepProgressEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "PEP AI progress (internal)",
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

export class InternalGrokPepFailedEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Mark PEP AI search as failed (internal)",
		security: [],
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							search_id: z.string(),
							error: z.string(),
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

		await failPepAiResearch(c.env, {
			searchId: search_id,
			error,
			logPrefix: "[InternalGrokPep]",
		});

		return Response.json({
			success: true,
		});
	}
}
