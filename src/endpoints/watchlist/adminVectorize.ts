/**
 * Admin Vectorize endpoints for manual vectorization triggers.
 *
 * These endpoints allow admins to manually trigger vectorization jobs
 * for indexing records into Cloudflare Vectorize.
 */

import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { Bindings } from "../../index";
import { getCallbackUrl } from "../../lib/callback-utils";

// =============================================================================
// Reindex Endpoint
// =============================================================================

/**
 * POST /admin/vectorize/reindex
 * Triggers a vectorization job for a dataset
 */
export class AdminVectorizeReindexEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Admin"],
		summary: "Trigger vectorization reindex",
		description:
			"Creates a background job to index records from D1 into Vectorize. Requires admin role.",
		security: [{ bearerAuth: [] }],
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							dataset: z
								.enum(["ofac_sdn"])
								.describe("The dataset to index (e.g., ofac_sdn)"),
							reindex_all: z
								.boolean()
								.optional()
								.default(true)
								.describe("Delete existing vectors before indexing"),
							batch_size: z
								.number()
								.int()
								.min(10)
								.max(500)
								.optional()
								.default(100)
								.describe("Number of records per batch"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Vectorization job created",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							thread_id: z.string(),
							message: z.string(),
						}),
					},
				},
			},
			"500": {
				description: "Failed to create vectorization job",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							error: z.string(),
						}),
					},
				},
			},
		},
	};

	async handle(c: { env: Bindings; req: Request }) {
		const body = await c.req.json();
		const { dataset, reindex_all, batch_size } = body as {
			dataset: string;
			reindex_all?: boolean;
			batch_size?: number;
		};

		console.log(
			`[AdminVectorize] Reindex requested for dataset: ${dataset}, reindex_all: ${reindex_all}, batch_size: ${batch_size}`,
		);

		if (!c.env.THREAD_SVC) {
			return Response.json(
				{
					success: false,
					error: "Thread service not configured",
				},
				{ status: 500 },
			);
		}

		try {
			const callbackUrl = getCallbackUrl(c.env.ENVIRONMENT);

			const response = await c.env.THREAD_SVC.fetch(
				"http://thread-svc/threads",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						task_type: "vectorize_index",
						job_params: {
							dataset: dataset,
							reindex_all: reindex_all ?? true,
							batch_size: batch_size ?? 100,
							callback_url: callbackUrl,
							triggered_by: "admin_manual",
						},
						metadata: {
							source: "admin_api",
							environment: c.env.ENVIRONMENT,
						},
					}),
				},
			);

			if (!response.ok) {
				const errorText = await response.text();
				console.error(
					`[AdminVectorize] Failed to create thread: ${response.status} - ${errorText}`,
				);
				return Response.json(
					{
						success: false,
						error: `Failed to create vectorization job: ${response.status}`,
					},
					{ status: 500 },
				);
			}

			const thread = (await response.json()) as { id: string };
			console.log(
				`[AdminVectorize] Vectorization thread created: ${thread.id}`,
			);

			return Response.json({
				success: true,
				thread_id: thread.id,
				message: `Vectorization job started for dataset '${dataset}'`,
			});
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error(`[AdminVectorize] Error creating thread: ${errorMsg}`);
			return Response.json(
				{
					success: false,
					error: errorMsg,
				},
				{ status: 500 },
			);
		}
	}
}
