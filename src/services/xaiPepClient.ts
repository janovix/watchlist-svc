import { LISTA_PEPS_2020_TEXT } from "../lib/lista-peps-2020";

export interface XaiPepClientConfig {
	apiKey: string;
	baseUrl?: string;
	model?: string;
	maxTurns?: number;
}

export interface PepScreeningMatch {
	candidate_name: string;
	candidate_birth_date: string | null;
	why_match: string;
	pep_basis: Array<{ rule_code: string; description: string }>;
	positions: Array<{
		title: string;
		organization: string;
		jurisdiction: string;
		start_date: string | null;
		end_date: string | null;
	}>;
	negative_info: Array<{ summary: string; evidence: string[] }>;
	evidence: string[];
}

export interface PepScreeningResponse {
	request_id: string;
	provider: "xai";
	model: string;
	query: { full_name: string; birth_date: string | null };
	is_pep: boolean;
	confidence: number; // 0.0 to 1.0
	needs_disambiguation: boolean;
	matches: PepScreeningMatch[];
	search_audit: { sources_consulted: string[] };
	raw: unknown; // raw provider response
}

const PEP_POLICY_SUMMARY = `# PEP Policy Summary - Lista PEPS 2020

## Governing Standard
The Lista PEPS 2020 is the official reference document for determining if a person qualifies as a PEP (Politically Exposed Person) in Mexico.

## Scope
PEP status applies to persons who currently hold or have held in the last 5 years (until December 2025) any of the listed public positions.

## PEP Categories

### Federal Level
- Presidente de la República, Secretarios de Estado, Subsecretarios
- Fiscal General de la República
- Senadores y Diputados federales
- Suprema Corte de Justicia (11 ministros)
- Directors General of state-owned enterprises (Pemex, CFE, etc.)
- High-ranking military officers (generales de división, almirantes)
- Autonomous bodies (Banco de México, INE, CNDH, INAI, etc.)

### State Level
- Gobernadores, Secretarios estatales, Diputados locales
- Procuradores estatales, Magistrados estatales
- All homologous positions to federal level

### Municipal Level
- Presidentes Municipales, Regidores, Síndicos
- Secretarios municipales, Tesoreros municipales
- All homologous positions to federal/state level

### Political Parties
- Precandidatos, Candidatos for any public office
- Presidente Nacional, Secretario General, Responsable Nacional de Finanzas
- Up to 2 levels below in financial/human resources/material resources areas

## Hierarchical Rules
- Three levels below: Consider up to 3 hierarchical levels below listed positions IF they have decision-making power
- Two levels below: For financial/human resources/material resources areas, consider up to 2 levels below

## Risk Factors
A person may be PEP even if not explicitly listed if they have "Prominent Functions" such as:
- Decision-making in public contracts/procurement
- Budget allocation/disposition
- Handling of reserved/confidential information
- Public finance management
- Granting authorizations, concessions, licenses
- Participation in audits and fiscal oversight

## Name Matching Rules
- Exact or very close match required (minor variations like accents, surname order OK)
- Partial matches are NOT sufficient - default to negative
- If ambiguous, return multiple candidates with needs_disambiguation=true

## Time Period
- Current positions: Always PEP
- Past positions: PEP if held within last 5 years (until December 2025)
- Historical positions (>5 years): Not PEP`;

export class XaiPepClient {
	private apiKey: string;
	private baseUrl: string;
	private model: string;
	private maxTurns: number;

	constructor(config: XaiPepClientConfig) {
		this.apiKey = config.apiKey;
		this.baseUrl = config.baseUrl || "https://api.x.ai/v1";
		this.model = config.model || "grok-4.1-fast-reasoning";
		this.maxTurns = config.maxTurns || 12;
	}

	/**
	 * Build the system prompt with policy rules and output constraints
	 */
	private buildSystemPrompt(): string {
		return `You are a PEP screening engine for Mexico. Your role is to determine if a person qualifies as a Politically Exposed Person (PEP) according to the official "Lista de Personas Políticamente Expuestas Nacionales 2020" issued by SHCP (Secretaría de Hacienda y Crédito Público).

GOVERNING STANDARD:
${PEP_POLICY_SUMMARY}

FULL OFFICIAL DOCUMENT:
The complete official Lista PEPS 2020 document is provided below. You must consult ALL sections (Federal, State, Municipal, Political Parties) during your search.

${LISTA_PEPS_2020_TEXT}

SEARCH REQUIREMENTS:
1. Perform EXHAUSTIVE search using web + X (if tools are available)
2. Search ALL government levels: Federal, State, Municipal
3. Prefer primary/official sources (gob.mx, official portals, transparency sites)
4. Never guess identity - if ambiguous, return multiple candidates
5. Verify all positions are listed in the official document

OUTPUT REQUIREMENTS:
- Output ONLY valid JSON matching the exact schema below
- No markdown, no prose, no commentary
- Every asserted role/claim MUST include evidence URLs in the "evidence" array
- Include all sources consulted in search_audit.sources_consulted

REQUIRED JSON SCHEMA:
{
  "request_id": "string (uuid)",
  "provider": "xai",
  "model": "string",
  "query": { "full_name": "string", "birth_date": "string|null" },
  "is_pep": boolean,
  "confidence": number (0.0 to 1.0),
  "needs_disambiguation": boolean,
  "matches": [
    {
      "candidate_name": "string",
      "candidate_birth_date": "string|null",
      "why_match": "string (explanation)",
      "pep_basis": [
        {
          "rule_code": "string (e.g., SECCION_I_FEDERAL_EXECUTIVE)",
          "description": "string"
        }
      ],
      "positions": [
        {
          "title": "string",
          "organization": "string",
          "jurisdiction": "string (federal/estatal/municipal)",
          "start_date": "string|null (YYYY-MM-DD)",
          "end_date": "string|null (YYYY-MM-DD)"
        }
      ],
      "negative_info": [
        {
          "summary": "string",
          "evidence": ["array of URLs"]
        }
      ],
      "evidence": ["array of URLs"]
    }
  ],
  "search_audit": { "sources_consulted": ["array of URLs"] },
  "raw": {}
}`;
	}

	/**
	 * Build the user prompt with the screening request
	 */
	private buildUserPrompt(fullName: string, birthDate: string | null): string {
		const birthDateStr = birthDate || "not provided";
		return `SCREENING_REQUEST
full_name: "${fullName}"
birth_date: "${birthDateStr}"

Task: Determine if this person is a PEP under Lista_PEPS_2020. Perform exhaustive web+X search across all government levels (federal, estatal, municipal). Return strict JSON only - no markdown, no prose.

If the name matches multiple people or is ambiguous, return multiple candidates in the matches array and set needs_disambiguation=true.

For each match, include:
- Exact name match verification
- PEP basis with rule codes from the document
- All positions held (current or within last 5 years)
- Evidence URLs for every claim
- Sources consulted in search_audit`;
	}

	/**
	 * Build the XAI API request payload
	 */
	private buildXaiRequest(
		fullName: string,
		birthDate: string | null,
	): {
		model: string;
		messages: Array<{ role: string; content: string }>;
		temperature: number;
		response_format: { type: string };
		max_turns?: number;
		tools?: unknown[];
	} {
		const systemPrompt = this.buildSystemPrompt();
		const userPrompt = this.buildUserPrompt(fullName, birthDate);

		// Build request - check if tools/live search are supported
		// For now, use chat completions API with response_format for JSON
		const request: {
			model: string;
			messages: Array<{ role: string; content: string }>;
			temperature: number;
			response_format: { type: string };
			max_turns?: number;
			tools?: unknown[];
		} = {
			model: this.model,
			messages: [
				{
					role: "system",
					content: systemPrompt,
				},
				{
					role: "user",
					content: userPrompt,
				},
			],
			temperature: 0.1,
			response_format: { type: "json_object" },
		};

		// Add max_turns if supported by the model
		if (this.maxTurns > 1) {
			request.max_turns = this.maxTurns;
		}

		// Note: If xAI API supports web_search/x_search tools, add them here
		// Example: request.tools = [{ type: "web_search" }, { type: "x_search" }];

		return request;
	}

	/**
	 * Extract JSON from response text, handling markdown code blocks
	 */
	private extractJson(text: string): unknown {
		// Try to parse as-is first
		try {
			return JSON.parse(text);
		} catch {
			// Try to extract JSON from markdown code blocks
			const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
			if (jsonMatch) {
				try {
					return JSON.parse(jsonMatch[1]);
				} catch {
					// Fall through
				}
			}

			// Try to find JSON object in the text
			const braceMatch = text.match(/\{[\s\S]*\}/);
			if (braceMatch) {
				try {
					return JSON.parse(braceMatch[0]);
				} catch {
					// Fall through
				}
			}

			throw new Error("No valid JSON found in response");
		}
	}

	/**
	 * Call XAI API with retry logic for non-JSON responses
	 */
	async screen(
		fullName: string,
		birthDate: string | null,
	): Promise<{ response: PepScreeningResponse; raw: unknown }> {
		const startTime = Date.now();
		const requestId = this.generateRequestId();

		console.log("[XaiPepClient] Starting PEP screening", {
			requestId,
			fullName,
			birthDate,
			model: this.model,
		});

		const requestBody = this.buildXaiRequest(fullName, birthDate);

		try {
			// First attempt
			let response = await fetch(`${this.baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify(requestBody),
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error("[XaiPepClient] XAI API error", {
					status: response.status,
					statusText: response.statusText,
					errorText,
				});
				throw new Error(
					`XAI API error: ${response.status} ${response.statusText}`,
				);
			}

			const data = (await response.json()) as {
				choices?: Array<{
					message?: {
						content?: string;
					};
				}>;
				model?: string;
			};

			const content = data.choices?.[0]?.message?.content;
			if (!content) {
				throw new Error("XAI API returned no content");
			}

			console.log("[XaiPepClient] Received response", {
				contentLength: content.length,
				model: data.model || this.model,
			});

			let parsed: unknown;
			try {
				parsed = this.extractJson(content);
			} catch (parseError) {
				console.warn("[XaiPepClient] Failed to parse JSON, attempting retry", {
					error:
						parseError instanceof Error
							? parseError.message
							: String(parseError),
				});

				// Retry with fix instruction
				const retryRequestBody: {
					model: string;
					messages: Array<{ role: string; content: string }>;
					temperature: number;
					response_format: { type: string };
					max_turns?: number;
				} = {
					...requestBody,
					messages: [
						...requestBody.messages,
						{
							role: "user",
							content: `Fix: output ONLY valid JSON that matches the schema; no commentary, no markdown. Previous invalid output: ${content.substring(0, 500)}`,
						},
					],
				};

				response = await fetch(`${this.baseUrl}/chat/completions`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${this.apiKey}`,
					},
					body: JSON.stringify(retryRequestBody),
				});

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(
						`XAI API retry error: ${response.status} ${response.statusText}: ${errorText}`,
					);
				}

				const retryData = (await response.json()) as {
					choices?: Array<{
						message?: {
							content?: string;
						};
					}>;
				};

				const retryContent = retryData.choices?.[0]?.message?.content;
				if (!retryContent) {
					throw new Error("XAI API retry returned no content");
				}

				parsed = this.extractJson(retryContent);
			}

			// Validate and normalize the response
			const screeningResponse = this.normalizeResponse(
				parsed,
				requestId,
				fullName,
				birthDate,
				data.model || this.model,
			);

			const latencyMs = Date.now() - startTime;
			console.log("[XaiPepClient] Screening completed", {
				requestId,
				isPep: screeningResponse.is_pep,
				confidence: screeningResponse.confidence,
				matchesCount: screeningResponse.matches.length,
				latencyMs,
			});

			return {
				response: screeningResponse,
				raw: data,
			};
		} catch (error) {
			const latencyMs = Date.now() - startTime;
			console.error("[XaiPepClient] Error during screening", {
				requestId,
				error: error instanceof Error ? error.message : String(error),
				latencyMs,
			});
			throw error;
		}
	}

	/**
	 * Normalize and validate the response from XAI API
	 */
	private normalizeResponse(
		parsed: unknown,
		requestId: string,
		fullName: string,
		birthDate: string | null,
		model: string,
	): PepScreeningResponse {
		// Type guard and validation
		if (typeof parsed !== "object" || parsed === null) {
			throw new Error("Invalid response: not an object");
		}

		const obj = parsed as Record<string, unknown>;

		// Extract and validate fields
		const isPep = Boolean(obj.is_pep);
		const confidence = this.normalizeConfidence(obj.confidence);
		const needsDisambiguation = Boolean(obj.needs_disambiguation);
		const matches = Array.isArray(obj.matches)
			? (obj.matches as PepScreeningMatch[])
			: [];

		// Ensure matches array is properly structured
		const normalizedMatches: PepScreeningMatch[] = matches.map((match) => ({
			candidate_name: String(match.candidate_name || ""),
			candidate_birth_date:
				match.candidate_birth_date &&
				String(match.candidate_birth_date) !== "null"
					? String(match.candidate_birth_date)
					: null,
			why_match: String(match.why_match || ""),
			pep_basis: Array.isArray(match.pep_basis)
				? match.pep_basis.map((b) => ({
						rule_code: String(b.rule_code || ""),
						description: String(b.description || ""),
					}))
				: [],
			positions: Array.isArray(match.positions)
				? match.positions.map((p) => ({
						title: String(p.title || ""),
						organization: String(p.organization || ""),
						jurisdiction: String(p.jurisdiction || ""),
						start_date:
							p.start_date && String(p.start_date) !== "null"
								? String(p.start_date)
								: null,
						end_date:
							p.end_date && String(p.end_date) !== "null"
								? String(p.end_date)
								: null,
					}))
				: [],
			negative_info: Array.isArray(match.negative_info)
				? match.negative_info.map((n) => ({
						summary: String(n.summary || ""),
						evidence: Array.isArray(n.evidence)
							? n.evidence.map((e) => String(e))
							: [],
					}))
				: [],
			evidence: Array.isArray(match.evidence)
				? match.evidence.map((e) => String(e))
				: [],
		}));

		const searchAudit = obj.search_audit as
			| { sources_consulted?: unknown[] }
			| undefined;
		const sourcesConsulted = Array.isArray(searchAudit?.sources_consulted)
			? searchAudit.sources_consulted.map((s) => String(s))
			: [];

		return {
			request_id: requestId,
			provider: "xai",
			model,
			query: {
				full_name: fullName,
				birth_date: birthDate,
			},
			is_pep: isPep,
			confidence,
			needs_disambiguation: needsDisambiguation,
			matches: normalizedMatches,
			search_audit: {
				sources_consulted: sourcesConsulted,
			},
			raw: obj.raw || {},
		};
	}

	/**
	 * Normalize confidence value to 0.0-1.0 range
	 */
	private normalizeConfidence(confidence: unknown): number {
		if (typeof confidence === "number") {
			return Math.max(0, Math.min(1, confidence));
		}
		if (typeof confidence === "string") {
			const parsed = parseFloat(confidence);
			if (!isNaN(parsed)) {
				return Math.max(0, Math.min(1, parsed));
			}
		}
		// Default confidence based on is_pep
		return 0.5;
	}

	/**
	 * Generate a deterministic request ID (UUID-like)
	 */
	private generateRequestId(): string {
		// Generate UUID v4-like string
		// In Cloudflare Workers, we can use crypto.randomUUID() if available
		// Otherwise, generate a simple UUID-like string
		const hex = "0123456789abcdef";
		let uuid = "";
		for (let i = 0; i < 36; i++) {
			if (i === 8 || i === 13 || i === 18 || i === 23) {
				uuid += "-";
			} else {
				uuid += hex[Math.floor(Math.random() * 16)];
			}
		}
		return uuid;
	}
}
