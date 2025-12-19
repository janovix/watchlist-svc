import { OpenAPIRoute, ApiException, contentJson } from "chanfana";
import { z } from "zod";
import { AppContext } from "../../types";
import { LISTA_PEPS_2020_TEXT } from "../../lib/lista-peps-2020";

const analyzeSearchRequestSchema = z.object({
	name: z.string().min(1, "name is required"),
	search_results: z.string().min(1, "search_results is required"),
});

export class PepAnalyzeSearchEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["PEP"],
		summary:
			"Analyze search results against Lista PEPS to determine PEP status",
		description:
			"Takes search results and intelligently analyzes them against the Lista PEPS 2020 document to determine if the person qualifies as PEP.",
		operationId: "analyzePepSearch",
		request: {
			body: contentJson(analyzeSearchRequestSchema),
		},
		responses: {
			"200": {
				description: "PEP analysis result",
				...contentJson(
					z.object({
						name: z.string(),
						is_pep: z.boolean(),
						confidence: z.number().min(0).max(1),
						analysis: z.string(),
						positions_found: z.array(
							z.object({
								title: z.string(),
								organization: z.string(),
								jurisdiction: z.string(),
								evidence: z.string(),
								pep_basis: z.string(),
							}),
						),
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

		console.log("[PepAnalyzeSearch] Starting analysis", {
			name: data.body.name,
			searchResultsLength: data.body.search_results.length,
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

			// Build request to analyze search results against PEP criteria
			const requestBody = {
				model,
				messages: [
					{
						role: "system",
						content: `You are a PEP analysis engine. Your task is to analyze search results about a person and determine if they qualify as PEP according to the Lista PEPS 2020 document.

ANALYSIS PROCESS:
1. Extract ALL government positions mentioned in the search results
2. For each position found, check if it matches PEP criteria:
   - Is it explicitly listed in the Lista PEPS document? OR
   - Is it a homologous position (state/municipal equivalent of federal)? OR
   - Is it within "three hierarchical levels below" in a decentralized body/desconcentrated organ?

3. Key rules:
   - CONADE is a decentralized body under Secretaría de Educación Pública
   - "Director", "Subdirector", "Coordinador Nacional", "Director Técnico Nacional" in CONADE ARE PEP (within 3 levels)
   - "Fiscal General del Estado" = PEP (homologous to federal Fiscal General)
   - "Procurador Estatal" = PEP (homologous to federal Procurador)
   - "Magistrado Estatal" = PEP (homologous to federal magistrates)
   - "Presidente Municipal" = PEP (homologous to federal executive)
   - "Regidor", "Síndico" = PEP (homologous to federal positions)

4. Return structured analysis with:
   - is_pep: boolean
   - confidence: 0.0-1.0
   - analysis: detailed explanation
   - positions_found: array of positions with PEP basis

Return JSON only, no markdown.`,
					},
					{
						role: "user",
						content: `Analyze these search results for "${data.body.name}" and determine PEP status:

SEARCH RESULTS:
${data.body.search_results}

LISTA PEPS 2020 DOCUMENT (reference):
${LISTA_PEPS_2020_TEXT.substring(0, 5000)}...

[Document continues - contains all PEP positions and rules]

ANALYSIS TASK:
1. Extract all government positions mentioned in the search results
2. For each position, determine if it's PEP according to Lista PEPS 2020
3. Check if positions are:
   - Explicitly listed in the document
   - Homologous positions (state/municipal equivalents)
   - Within 3 hierarchical levels in decentralized bodies

4. Return JSON:
{
  "name": "${data.body.name}",
  "is_pep": boolean,
  "confidence": number (0.0-1.0),
  "analysis": "Detailed explanation of why this person is or isn't PEP, referencing specific positions found and how they match PEP criteria",
  "positions_found": [
    {
      "title": "exact position title found",
      "organization": "organization name",
      "jurisdiction": "federal/estatal/municipal",
      "evidence": "URL or source where this was found",
      "pep_basis": "Why this position is PEP (explicitly listed / homologous / within 3 levels)"
    }
  ]
}`,
					},
				],
				response_format: { type: "json_object" },
				max_turns: 10,
			};

			console.log("[PepAnalyzeSearch] Calling xAI API for analysis");

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
				console.error("[PepAnalyzeSearch] xAI API error", {
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
				const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
				if (jsonMatch) {
					parsed = JSON.parse(jsonMatch[1]);
				} else {
					throw new Error(
						`Failed to parse JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
					);
				}
			}

			// Validate response structure
			if (
				typeof parsed !== "object" ||
				parsed === null ||
				!("is_pep" in parsed) ||
				!("analysis" in parsed)
			) {
				throw new Error("Invalid response structure from analysis");
			}

			const result = parsed as {
				name: string;
				is_pep: boolean;
				confidence: number;
				analysis: string;
				positions_found: Array<{
					title: string;
					organization: string;
					jurisdiction: string;
					evidence: string;
					pep_basis: string;
				}>;
			};

			console.log("[PepAnalyzeSearch] Analysis completed", {
				name: result.name,
				isPep: result.is_pep,
				confidence: result.confidence,
				positionsCount: result.positions_found?.length || 0,
			});

			return {
				name: result.name || data.body.name,
				is_pep: Boolean(result.is_pep),
				confidence: Math.max(0, Math.min(1, result.confidence || 0)),
				analysis: result.analysis || "",
				positions_found: Array.isArray(result.positions_found)
					? result.positions_found
					: [],
			};
		} catch (error) {
			console.error("[PepAnalyzeSearch] Error", {
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
