import { OpenAPIRoute, ApiException, contentJson } from "chanfana";
import { z } from "zod";
import { AppContext } from "../../types";
import { LISTA_PEPS_2020_TEXT } from "../../lib/lista-peps-2020";

const screenWithAnalysisRequestSchema = z.object({
	full_name: z.string().min(3, "full_name must be at least 3 characters"),
	birth_date: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "birth_date must be in YYYY-MM-DD format")
		.nullable()
		.optional()
		.transform((val) => val || null),
	max_search_turns: z
		.number()
		.int()
		.min(3)
		.max(20)
		.optional()
		.default(10)
		.describe("Maximum number of search iterations (3-20, default: 10)"),
	max_analysis_turns: z
		.number()
		.int()
		.min(3)
		.max(15)
		.optional()
		.default(8)
		.describe("Maximum number of analysis iterations (3-15, default: 8)"),
	search_depth: z
		.enum(["quick", "standard", "deep"])
		.optional()
		.default("standard")
		.describe(
			"Search depth: quick (3 searches), standard (5 searches), deep (7+ searches)",
		),
});

export class PepScreenWithAnalysisEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["PEP"],
		summary:
			"Screen a person for PEP status: get full summary then analyze against Lista PEPS",
		description:
			"Step 1: Use search-tools to get comprehensive summary of the person. Step 2: Analyze the summary against Lista PEPS 2020 to determine PEP status.",
		operationId: "screenPepWithAnalysis",
		request: {
			body: contentJson(screenWithAnalysisRequestSchema),
		},
		responses: {
			"200": {
				description: "PEP screening result with full analysis",
				...contentJson(
					z.object({
						request_id: z.string(),
						provider: z.literal("xai"),
						model: z.string(),
						query: z.object({
							full_name: z.string(),
							birth_date: z.string().nullable(),
						}),
						person_summary: z.string(),
						is_pep: z.boolean(),
						confidence: z.number().min(0).max(1),
						analysis: z.string(),
						positions_found: z.array(
							z.object({
								title: z.string(),
								organization: z.string(),
								jurisdiction: z.string(),
								start_date: z.string().nullable(),
								end_date: z.string().nullable(),
								evidence: z.string(),
								pep_basis: z.string(),
							}),
						),
						search_sources: z.array(z.string()),
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

		console.log("[PepScreenWithAnalysis] Starting screening", {
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
			const fullName = data.body.full_name;
			const birthDate = data.body.birth_date || null;
			const maxSearchTurns = data.body.max_search_turns || 10;
			const maxAnalysisTurns = data.body.max_analysis_turns || 8;
			const searchDepth = data.body.search_depth || "standard";

			// Define search queries based on depth
			const searchQueries: string[] = [];
			if (searchDepth === "quick") {
				searchQueries.push(
					`"${fullName} México"`,
					`"${fullName} gobierno"`,
					`"${fullName}"`,
				);
			} else if (searchDepth === "standard") {
				searchQueries.push(
					`"${fullName} México"`,
					`"${fullName} gobierno"`,
					`"${fullName} funcionario"`,
					`"${fullName} director"`,
					`"${fullName}"`,
				);
			} else {
				// deep
				searchQueries.push(
					`"${fullName} México"`,
					`"${fullName} gobierno"`,
					`"${fullName} funcionario público"`,
					`"${fullName} director"`,
					`"${fullName} secretario"`,
					`"${fullName} gobernador"`,
					`"${fullName}"`,
				);
			}

			// STEP 1: Get comprehensive summary using search-tools
			console.log("[PepScreenWithAnalysis] Step 1: Getting person summary");

			const summaryRequestBody = {
				model,
				messages: [
					{
						role: "system",
						content: `You are a research assistant. Use search-tools (web search and X search) to gather comprehensive information about a person. Return a detailed summary including:
- Full name and any aliases
- Current and past government positions
- Organizations they work/worked for
- Dates of positions (start/end dates if available)
- Any political roles
- Sources/URLs where information was found

Be thorough and search multiple sources.`,
					},
					{
						role: "user",
						content: `Gather information about this person using search-tools:

Name: ${fullName}
Birth date: ${birthDate || "not provided"}

Perform these searches (be efficient, focus on finding government positions):
${searchQueries.map((q, i) => `${i + 1}. ${q.includes("X") || q.includes("Twitter") ? `X/Twitter` : `Web`}: ${q}`).join("\n")}

Compile a concise summary focusing on:
- Full name and aliases
- Government positions (current and past, with dates if available)
- Organizations (government agencies, secretarías, estados, municipios)
- Key evidence/sources (most important URLs only)

Keep the summary focused and efficient. Return ONLY the summary text, no JSON.`,
					},
				],
				max_turns: maxSearchTurns,
			};

			const summaryResponse = await fetch(`${baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${c.env.GROK_API_KEY}`,
				},
				body: JSON.stringify(summaryRequestBody),
			});

			if (!summaryResponse.ok) {
				const errorText = await summaryResponse.text();
				throw new Error(
					`Summary step failed: ${summaryResponse.status} ${errorText}`,
				);
			}

			const summaryData = (await summaryResponse.json()) as {
				choices?: Array<{
					message?: {
						content?: string;
						tool_calls?: Array<{
							function?: {
								arguments?: string;
							};
						}>;
					};
				}>;
				model?: string;
			};

			const personSummary = summaryData.choices?.[0]?.message?.content || "";

			// Extract search sources from tool calls
			const searchSources: string[] = [];
			summaryData.choices?.[0]?.message?.tool_calls?.forEach((call) => {
				if (call.function?.arguments) {
					try {
						const args = JSON.parse(call.function.arguments);
						if (args.query) {
							searchSources.push(args.query);
						}
					} catch {
						// Ignore parse errors
					}
				}
			});

			console.log("[PepScreenWithAnalysis] Summary obtained", {
				summaryLength: personSummary.length,
				searchSourcesCount: searchSources.length,
			});

			// STEP 2: Analyze summary against Lista PEPS
			console.log(
				"[PepScreenWithAnalysis] Step 2: Analyzing against Lista PEPS",
			);

			const analysisRequestBody = {
				model,
				messages: [
					{
						role: "system",
						content: `You are a PEP analysis engine. Analyze a person's summary against the Lista PEPS 2020 document to determine if they qualify as PEP.

ANALYSIS PROCESS:
1. Read and understand the Lista PEPS 2020 document carefully
2. Extract ALL government positions from the person's summary
3. For each position found, check if it matches PEP criteria according to Lista PEPS 2020:
   - Is it explicitly listed in the document? OR
   - Is it a homologous position (state/municipal equivalent of federal position listed in the document)? OR
   - Is it within "three hierarchical levels below" in a decentralized body/desconcentrated organ listed in the document?

4. Apply the rules from the document:
   - Check Section F for homologous positions (state/municipal equivalents)
   - Check Section E for risk factors and "three levels below" criteria
   - Check all sections (Federal, State, Municipal, Political Parties) for explicit matches
   - Consider decentralized bodies and desconcentrated organs under Secretarías

5. Use your intelligence to match positions found in the summary against the rules and positions listed in the document. Do not rely on hardcoded examples - read the document and apply its rules.

Return JSON only.`,
					},
					{
						role: "user",
						content: `Analyze this person's summary against Lista PEPS 2020 to determine PEP status:

PERSON SUMMARY:
${personSummary}

LISTA PEPS 2020 DOCUMENT (complete reference):
${LISTA_PEPS_2020_TEXT.substring(0, 50000)}${LISTA_PEPS_2020_TEXT.length > 50000 ? "\n\n[Document continues - contains all PEP positions and rules]" : ""}

ANALYSIS TASK:
1. Read the complete Lista PEPS 2020 document above
2. Extract all government positions mentioned in the person's summary
3. For each position found, check if it qualifies as PEP by:
   - Reading the document to see if the position is explicitly listed, OR
   - Checking if it's a homologous position (state/municipal equivalent) according to Section F, OR
   - Checking if it's within "three hierarchical levels below" according to Section E and the document's rules

4. Apply the document's rules intelligently - read the sections on:
   - Federal level positions (Section I)
   - State level positions and homologous rules (Section II and F)
   - Municipal level positions and homologous rules (Section III and F)
   - Decentralized bodies and "three levels below" criteria (Section E and throughout)
   - Risk factors and prominent functions (Section E)

5. Match positions from the summary against the document's criteria - use your intelligence to understand the rules, not hardcoded examples.

6. Return JSON:
{
  "is_pep": boolean,
  "confidence": number (0.0-1.0),
  "analysis": "Detailed explanation of why this person is or isn't PEP, referencing specific positions found, how they match PEP criteria from Lista PEPS 2020, and which sections/rules of the document apply",
  "positions_found": [
    {
      "title": "exact position title",
      "organization": "organization name",
      "jurisdiction": "federal/estatal/municipal",
      "start_date": "YYYY-MM-DD or null",
      "end_date": "YYYY-MM-DD or null",
      "evidence": "URL or source",
      "pep_basis": "Detailed explanation of why this position is PEP, referencing specific sections/rules from Lista PEPS 2020 document"
    }
  ]
}`,
					},
				],
				response_format: { type: "json_object" },
				max_turns: maxAnalysisTurns,
			};

			const analysisResponse = await fetch(`${baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${c.env.GROK_API_KEY}`,
				},
				body: JSON.stringify(analysisRequestBody),
			});

			if (!analysisResponse.ok) {
				const errorText = await analysisResponse.text();
				throw new Error(
					`Analysis step failed: ${analysisResponse.status} ${errorText}`,
				);
			}

			const analysisData = (await analysisResponse.json()) as {
				choices?: Array<{
					message?: {
						content?: string;
					};
				}>;
				model?: string;
			};

			const analysisContent = analysisData.choices?.[0]?.message?.content;
			if (!analysisContent) {
				throw new Error("No content in analysis response");
			}

			// Parse analysis JSON
			let parsed: unknown;
			try {
				parsed = JSON.parse(analysisContent);
			} catch (parseError) {
				const jsonMatch = analysisContent.match(
					/```(?:json)?\s*(\{[\s\S]*\})\s*```/,
				);
				if (jsonMatch) {
					parsed = JSON.parse(jsonMatch[1]);
				} else {
					throw new Error(
						`Failed to parse analysis JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
					);
				}
			}

			const analysis = parsed as {
				is_pep: boolean;
				confidence: number;
				analysis: string;
				positions_found: Array<{
					title: string;
					organization: string;
					jurisdiction: string;
					start_date: string | null;
					end_date: string | null;
					evidence: string;
					pep_basis: string;
				}>;
			};

			console.log("[PepScreenWithAnalysis] Analysis completed", {
				isPep: analysis.is_pep,
				confidence: analysis.confidence,
				positionsCount: analysis.positions_found?.length || 0,
			});

			return {
				request_id: requestId,
				provider: "xai" as const,
				model: analysisData.model || model,
				query: {
					full_name: fullName,
					birth_date: birthDate,
				},
				person_summary: personSummary,
				is_pep: Boolean(analysis.is_pep),
				confidence: Math.max(0, Math.min(1, analysis.confidence || 0)),
				analysis: analysis.analysis || "",
				positions_found: Array.isArray(analysis.positions_found)
					? analysis.positions_found
					: [],
				search_sources: searchSources,
			};
		} catch (error) {
			console.error("[PepScreenWithAnalysis] Error", {
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
