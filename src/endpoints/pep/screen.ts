import { OpenAPIRoute, ApiException, contentJson } from "chanfana";
import { z } from "zod";
import { AppContext } from "../../types";

const pepScreeningRequestSchema = z.object({
	full_name: z.string().min(3, "full_name must be at least 3 characters"),
	birth_date: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "birth_date must be in YYYY-MM-DD format")
		.nullable()
		.optional()
		.transform((val) => val || null),
});

const pepScreeningResponseSchema = z.object({
	request_id: z.string(),
	provider: z.literal("xai"),
	model: z.string(),
	query: z.object({
		full_name: z.string(),
		birth_date: z.string().nullable(),
	}),
	is_pep: z.boolean(),
	confidence: z.number().min(0).max(1),
	needs_disambiguation: z.boolean(),
	matches: z.array(
		z.object({
			candidate_name: z.string(),
			candidate_birth_date: z.string().nullable(),
			why_match: z.string(),
			pep_basis: z.array(
				z.object({
					rule_code: z.string(),
					description: z.string(),
				}),
			),
			positions: z.array(
				z.object({
					title: z.string(),
					organization: z.string(),
					jurisdiction: z.string(),
					start_date: z.string().nullable(),
					end_date: z.string().nullable(),
				}),
			),
			negative_info: z.array(
				z.object({
					summary: z.string(),
					evidence: z.array(z.string()),
				}),
			),
			evidence: z.array(z.string()),
		}),
	),
	search_audit: z.object({
		sources_consulted: z.array(z.string()),
	}),
	raw: z.record(z.unknown()),
});

export class PepScreenEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["PEP"],
		summary: "Screen a person for PEP (Politically Exposed Person) status",
		description:
			"Performs PEP screening using Grok with search-tools and Lista PEPS collection.",
		operationId: "screenPEP",
		request: {
			body: contentJson(pepScreeningRequestSchema),
		},
		responses: {
			"200": {
				description: "PEP screening result",
				...contentJson(pepScreeningResponseSchema),
			},
			"400": {
				description: "Bad request - invalid input",
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
			"502": {
				description: "Bad gateway - provider error",
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

		console.log("[PepScreen] Starting PEP screening", {
			fullName: data.body.full_name,
			birthDate: data.body.birth_date,
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
			const requestId = crypto.randomUUID();
			const model = c.env.XAI_MODEL || "grok-4-1-fast";
			const baseUrl = c.env.XAI_BASE_URL || "https://api.x.ai/v1";

			// Get collection ID from environment or use default
			const collectionId = c.env.XAI_COLLECTION_ID || "lista-peps-2020";

			// Build the request with search-tools
			const requestBody = {
				model,
				messages: [
					{
						role: "system",
						content: `You are a PEP screening engine for Mexico. Use search-tools to find information about a person and determine if they qualify as PEP according to Lista PEPS 2020.

CRITICAL UNDERSTANDING - HOMOLOGOUS POSITIONS:
The Lista PEPS document includes Section F which states that state and municipal positions that are HOMOLOGOUS (equivalent) to federal positions are ALSO PEP, even if not explicitly listed.

Examples of homologous positions:
- "Fiscal General del Estado de [Estado]" = PEP (homologous to "Fiscal General de la República" at federal level)
- "Procurador del Estado de [Estado]" = PEP (homologous to federal Procurador)
- "Secretario del Estado de [Estado]" = PEP (homologous to federal Secretarios de Estado)
- "Magistrado del Tribunal Superior de Justicia de [Estado]" = PEP (homologous to federal magistrates)
- "Presidente Municipal de [Municipio]" = PEP (homologous to federal executive positions)
- "Regidor de [Municipio]" = PEP (homologous to federal legislative positions)
- "Síndico de [Municipio]" = PEP (homologous to federal positions)

SEARCH STRATEGY (EFFICIENT):
1. Search collection "${collectionId}" with the person's name
2. Perform ONE web search: "${data.body.full_name} México" - analyze the first 10-15 results carefully
3. Perform ONE X/Twitter search: "${data.body.full_name}" - check official government accounts and verified profiles
4. Analyze the search results to identify:
   - Any government positions held (federal, state, or municipal)
   - Job titles and organizations
   - Time periods (current or within last 5 years)
5. For each position found, check if it matches:
   - Explicitly listed positions in the collection, OR
   - Homologous positions (state/municipal equivalents of federal positions)

IMPORTANT: 
- Positions like "Fiscal General del Estado", "Procurador Estatal", "Magistrado Estatal", "Presidente Municipal", "Regidor", "Síndico" ARE PEP positions even if not explicitly listed - they are homologous
- Analyze search results carefully - don't just look for exact title matches
- Check if the person's position is equivalent to any federal PEP position listed in the collection

Return strict JSON matching the required schema.`,
					},
					{
						role: "user",
						content: `Screen this person for PEP status:
Full name: ${data.body.full_name}
Birth date: ${data.body.birth_date || "not provided"}

SEARCH INSTRUCTIONS:
1. Search collection "${collectionId}" with: "${data.body.full_name}"
2. Perform web search: "${data.body.full_name} México" - analyze the first 10-15 results carefully
3. Perform X search: "${data.body.full_name}" - check for official government accounts
4. Analyze results to find ANY government positions (federal, state, municipal)
5. For each position found, determine if it's PEP by checking:
   - Is it explicitly listed in the collection? OR
   - Is it a HOMOLOGOUS position (state/municipal equivalent of a federal PEP position)?

Remember: Positions like "Fiscal General del Estado", "Procurador Estatal", "Magistrado Estatal", "Presidente Municipal", "Regidor", "Síndico" are PEP even if not explicitly listed.

Return JSON in this exact format:
{
  "request_id": "${requestId}",
  "provider": "xai",
  "model": "${model}",
  "query": {
    "full_name": "${data.body.full_name}",
    "birth_date": ${data.body.birth_date ? `"${data.body.birth_date}"` : "null"}
  },
  "is_pep": boolean,
  "confidence": number (0.0-1.0),
  "needs_disambiguation": boolean,
  "matches": [
    {
      "candidate_name": "string",
      "candidate_birth_date": "string|null",
      "why_match": "string",
      "pep_basis": [{"rule_code": "string", "description": "string"}],
      "positions": [{"title": "string", "organization": "string", "jurisdiction": "string", "start_date": "string|null", "end_date": "string|null"}],
      "negative_info": [{"summary": "string", "evidence": ["string"]}],
      "evidence": ["string"]
    }
  ],
  "search_audit": {"sources_consulted": ["string"]},
  "raw": {}
}`,
					},
				],
				response_format: { type: "json_object" },
				max_turns: 15, // Allow enough turns for collection + web + X searches and analysis
			};

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
				console.error("[PepScreen] xAI API error", {
					status: response.status,
					errorText,
				});
				throw new Error(`xAI API error: ${response.status} ${errorText}`);
			}

			const apiResponse = (await response.json()) as {
				choices?: Array<{
					message?: {
						content?: string;
					};
				}>;
				model?: string;
			};

			const content = apiResponse.choices?.[0]?.message?.content;
			if (!content) {
				throw new Error("No content in API response");
			}

			// Parse JSON response
			let parsed: unknown;
			try {
				parsed = JSON.parse(content);
			} catch (parseError) {
				// Try to extract JSON from markdown code blocks
				const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
				if (jsonMatch) {
					parsed = JSON.parse(jsonMatch[1]);
				} else {
					throw new Error(
						`Failed to parse JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
					);
				}
			}

			// Validate and return response
			const result = pepScreeningResponseSchema.parse(parsed);

			console.log("[PepScreen] Screening completed", {
				requestId: result.request_id,
				isPep: result.is_pep,
				confidence: result.confidence,
			});

			return result;
		} catch (error) {
			console.error("[PepScreen] Error", {
				error: error instanceof Error ? error.message : String(error),
			});

			if (error instanceof ApiException) {
				throw error;
			}

			if (error instanceof z.ZodError) {
				const apiError = new ApiException(
					`Invalid response format: ${error.errors.map((e) => e.message).join(", ")}`,
				);
				apiError.status = 502;
				apiError.code = 502;
				throw apiError;
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
