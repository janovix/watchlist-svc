import { OpenAPIRoute, ApiException, contentJson } from "chanfana";
import { z } from "zod";
import { AppContext } from "../../types";

const testSearchRequestSchema = z.object({
	name: z.string().min(1, "name is required"),
});

export class PepTestSearchEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["PEP"],
		summary: "Test search-tools to see what results are returned for a name",
		description:
			"Performs web and X searches using search-tools and returns raw results for debugging.",
		operationId: "testPepSearch",
		request: {
			body: contentJson(testSearchRequestSchema),
		},
		responses: {
			"200": {
				description: "Search results from search-tools",
				...contentJson(
					z.object({
						name: z.string(),
						searches_performed: z.array(z.string()),
						raw_response: z.record(z.unknown()),
						search_results_summary: z.string(),
					}),
				),
			},
			"503": {
				description: "Service unavailable - API not configured",
				...contentJson({
					success: z.literal(false),
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

		console.log("[PepTestSearch] Starting test search", {
			name: data.body.name,
		});

		if (!c.env.GROK_API_KEY) {
			const error = new ApiException(
				"Grok API key not configured. Please ensure GROK_API_KEY is set.",
			);
			error.status = 503;
			error.code = 503;
			throw error;
		}

		try {
			const model = c.env.XAI_MODEL || "grok-4-1-fast";
			const baseUrl = c.env.XAI_BASE_URL || "https://api.x.ai/v1";
			const name = data.body.name;

			// Build request that explicitly uses search-tools
			const requestBody = {
				model,
				messages: [
					{
						role: "system",
						content: `You are a search assistant. Use search-tools (web search and X search) to find information about a person. Return ALL search results you find, including URLs and snippets.`,
					},
					{
						role: "user",
						content: `Perform the following searches using search-tools and return all results:

1. Web search: "${name}"
2. Web search: "${name} México"
3. X/Twitter search: "${name}"

For each search, return:
- The search query used
- URLs found
- Snippets/excerpts from results
- Any official government accounts or mentions

Analyze the results thoroughly to find any government positions or political roles.

Return a detailed summary of all search results found.`,
					},
				],
				max_turns: 20, // Allow many turns for multiple searches
			};

			console.log("[PepTestSearch] Calling xAI API", {
				model,
				name,
			});

			// Call xAI API
			const response = await fetch(`${baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${c.env.GROK_API_KEY}`,
				},
				body: JSON.stringify(requestBody),
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error("[PepTestSearch] xAI API error", {
					status: response.status,
					errorText,
				});
				throw new Error(`xAI API error: ${response.status} ${errorText}`);
			}

			const apiResponse = (await response.json()) as {
				choices?: Array<{
					message?: {
						content?: string;
						tool_calls?: Array<{
							id: string;
							type: string;
							function?: {
								name: string;
								arguments: string;
							};
						}>;
					};
				}>;
				model?: string;
			};

			const message = apiResponse.choices?.[0]?.message;
			const content = message?.content || "";
			const toolCalls = message?.tool_calls || [];

			// Extract search queries that were performed
			const searchesPerformed: string[] = [];
			toolCalls.forEach((call) => {
				if (call.function?.name) {
					try {
						const args = JSON.parse(call.function.arguments);
						if (args.query) {
							searchesPerformed.push(args.query);
						}
					} catch {
						// Ignore parse errors
					}
				}
			});

			console.log("[PepTestSearch] Search completed", {
				name,
				searchesPerformed: searchesPerformed.length,
				contentLength: content.length,
				toolCallsCount: toolCalls.length,
			});

			return {
				name,
				searches_performed: searchesPerformed,
				raw_response: {
					model: apiResponse.model || model,
					content,
					tool_calls: toolCalls,
					content_length: content.length,
					tool_calls_count: toolCalls.length,
				},
				search_results_summary: content,
			};
		} catch (error) {
			console.error("[PepTestSearch] Error", {
				error: error instanceof Error ? error.message : String(error),
			});

			if (error instanceof ApiException) {
				throw error;
			}

			const apiError = new ApiException(
				error instanceof Error ? error.message : "An unexpected error occurred",
			);
			apiError.status = 502;
			apiError.code = 502;
			throw apiError;
		}
	}
}
