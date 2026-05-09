/**
 * Legacy HTTP paths for adverse-media callbacks (`/internal/adverse-media/*`).
 * Handlers delegate to {@link completeAdverseMediaResearch} / {@link failAdverseMediaResearch}.
 */

import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { Bindings } from "../../index";
import {
	completeAdverseMediaResearch,
	failAdverseMediaResearch,
} from "../../lib/research-results";
import { broadcastPepEvent } from "../../lib/pep-events-broadcast";
import { containerProgressPayloadSchema } from "./schemas";

const adverseMediaResultSchema = z.object({
	search_id: z.string(),
	query: z.string(),
	entity_type: z.enum(["person", "organization"]),
	risk_level: z.enum(["none", "low", "medium", "high"]),
	findings: z.object({
		es: z.string(),
		en: z.string(),
	}),
	sources: z.array(z.string()),
});

export type AdverseMediaResult = z.infer<typeof adverseMediaResultSchema>;

export class InternalAdverseMediaResultsEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Receive adverse media results (internal)",
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
		const body = adverseMediaResultSchema.parse(await c.req.json());

		console.log(
			`[InternalAdverseMedia] Received results for search ${body.search_id} (query: ${body.query}, entity: ${body.entity_type}, risk: ${body.risk_level})`,
		);

		const { broadcastSent } = await completeAdverseMediaResearch(c.env, {
			searchId: body.search_id,
			query: body.query,
			entityType: body.entity_type,
			risk_level: body.risk_level,
			findings: body.findings,
			sources: body.sources,
			logPrefix: "[InternalAdverseMedia]",
		});

		return Response.json({
			success: true,
			broadcast_sent: broadcastSent,
		});
	}
}

export class InternalAdverseMediaProgressEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Adverse Media progress (internal)",
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

export class InternalAdverseMediaFailedEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Mark Adverse Media search as failed (internal)",
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

		console.log(`[InternalAdverseMedia] Search ${search_id} failed: ${error}`);

		await failAdverseMediaResearch(c.env, {
			searchId: search_id,
			error,
			logPrefix: "[InternalAdverseMedia]",
		});

		return Response.json({
			success: true,
		});
	}
}
