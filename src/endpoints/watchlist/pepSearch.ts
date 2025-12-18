import { OpenAPIRoute, ApiException } from "chanfana";
import { AppContext } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import { GrokService } from "../../lib/grok-service";
import { watchlistTarget } from "./base";

export class PepSearchEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["PEP"],
		summary:
			"Search for PEP (Politically Exposed Person) status using Grok API",
		operationId: "searchPEP",
		request: {
			body: contentJson(
				z.object({
					query: z.string().min(1, "Query string is required"),
				}),
			),
		},
		responses: {
			"200": {
				description: "PEP search results",
				...contentJson({
					success: Boolean,
					result: z.object({
						target: watchlistTarget,
						pepStatus: z.boolean(),
						pepDetails: z.string().optional(),
					}),
				}),
			},
			"400": {
				description: "Bad request",
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
			"503": {
				description: "Service unavailable - Grok API not configured",
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
		const data = await this.getValidatedData<typeof this.schema>();

		console.log("[PepSearch] Starting PEP search", {
			query: data.body.query,
		});

		// Check if Grok API key is configured
		if (!c.env.GROK_API_KEY) {
			console.error("[PepSearch] GROK_API_KEY not configured");
			const error = new ApiException(
				"Grok API key not configured. Please ensure GROK_API_KEY is set in your environment.",
			);
			error.status = 503;
			error.code = 503;
			throw error;
		}

		try {
			const grokService = new GrokService({
				apiKey: c.env.GROK_API_KEY,
			});

			console.log("[PepSearch] Calling Grok API for PEP status check");
			const grokResponse = await grokService.queryPEPStatus(data.body.query);

			console.log("[PepSearch] Grok API response received", {
				hasResponse: !!grokResponse,
				pepStatus: grokResponse?.pepStatus,
				hasName: !!grokResponse?.name,
			});

			if (!grokResponse) {
				console.log("[PepSearch] Grok API returned no response");
				const error = new ApiException(
					"Failed to get response from Grok API. Please try again later.",
				);
				error.status = 503;
				error.code = 503;
				throw error;
			}

			// Convert Grok response to WatchlistTarget format
			const target = grokService.convertToWatchlistTarget(
				grokResponse,
				data.body.query,
			);

			console.log("[PepSearch] PEP search completed successfully", {
				pepStatus: grokResponse.pepStatus,
				targetId: target.id,
			});

			return {
				success: true,
				result: {
					target,
					pepStatus: grokResponse.pepStatus,
					pepDetails: grokResponse.pepDetails,
				},
			};
		} catch (error) {
			console.error("[PepSearch] Error during PEP search", {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});

			// Re-throw ApiException as-is
			if (error instanceof ApiException) {
				throw error;
			}

			// Wrap other errors
			const apiError = new ApiException(
				error instanceof Error
					? error.message
					: "An unexpected error occurred during PEP search",
			);
			apiError.status = 500;
			apiError.code = 500;
			throw apiError;
		}
	}
}
