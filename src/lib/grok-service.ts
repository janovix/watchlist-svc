import { WatchlistTarget } from "../endpoints/watchlist/base";

export interface GrokPEPResponse {
	name: string | null;
	aliases: string[] | null;
	birthDate: string | null;
	countries: string[] | null;
	addresses: string[] | null;
	identifiers: string[] | null;
	sanctions: string[] | null;
	phones: string[] | null;
	emails: string[] | null;
	programIds: string[] | null;
	dataset: string | null;
	pepStatus: boolean;
	pepDetails?: string;
}

export interface GrokServiceConfig {
	apiKey: string;
	baseUrl?: string;
}

export class GrokService {
	private apiKey: string;
	private baseUrl: string;

	constructor(config: GrokServiceConfig) {
		this.apiKey = config.apiKey;
		this.baseUrl = config.baseUrl || "https://api.x.ai/v1";
	}

	/**
	 * Query Grok API for PEP (Politically Exposed Person) status
	 * Returns structured data matching our watchlist target format
	 */
	async queryPEPStatus(query: string): Promise<GrokPEPResponse | null> {
		console.log("[GrokService] Starting PEP status query", {
			query,
			baseUrl: this.baseUrl,
			hasApiKey: !!this.apiKey,
		});

		try {
			const requestBody = {
				model: "grok-4-fast-non-reasoning",
				messages: [
					{
						role: "system",
						content: `You are a PEP (Politically Exposed Person) status checker. Analyze the provided query and return structured JSON data about the person's PEP status and related information.

IMPORTANT: For Mexico, the following positions qualify as PEP (Politically Exposed Persons):

FEDERAL LEVEL:
- Executive Power: President of the Republic, all Secretaries of State and their dependencies, decentralized organs, and administrative entities including:
  * Secretaría de Gobernación
  * Secretaría de Relaciones Exteriores
  * Secretaría de la Defensa Nacional
  * Secretaría de Marina
  * Secretaría de Seguridad y Protección Ciudadana
  * Secretaría de Hacienda y Crédito Público
  * Secretaría de Bienestar
  * Secretaría del Medio Ambiente y Recursos Naturales
  * Secretaría de Energía
  * Secretaría de Economía
  * Secretaría de Agricultura y Desarrollo Rural
  * Secretaría de Comunicaciones y Transportes
  * Secretaría de Educación Pública
  * Secretaría de Salud
  * Secretaría de Trabajo y Previsión Social
  * Secretaría de Desarrollo Agrario, Territorial y Urbano
  * Secretaría de Turismo
  * Secretaría de Cultura
- Legal Counsel of the Executive Federal
- Coordinated Regulatory Bodies in Energy Matters
- Attorney General of the Republic (Fiscalía General de la República)
- Judicial Power: All federal judges and judicial officials
- Legislative Power: Senators, Deputies, and legislative officials
- Decentralized Public Administration: State Productive Companies, non-sectorized and sectorized organisms, state majority participation companies, public funds and trusts
- Autonomous Bodies and Others

STATE LEVEL:
- State Executive Power: Governors and state executive officials
- State Attorney General (Procuraduría General de Justicia)
- State Judicial Power: State judges and judicial officials
- State Legislative Power: State legislators
- Autonomous Bodies and Others

MUNICIPAL LEVEL:
- Municipal Executive Power: Mayors and municipal executive officials

POLITICAL PARTIES:
- Leaders and high-ranking officials of political parties

Return a JSON object with the following structure:
{
  "name": "string or null",
  "aliases": ["array of strings or null"],
  "birthDate": "ISO 8601 date string or null",
  "countries": ["array of country codes or names or null"],
  "addresses": ["array of addresses or null"],
  "identifiers": ["array of identifiers (passport, ID numbers, etc.) or null"],
  "sanctions": ["array of sanctions information or null"],
  "phones": ["array of phone numbers or null"],
  "emails": ["array of email addresses or null"],
  "programIds": ["array of program IDs or null"],
  "dataset": "string or null",
  "pepStatus": boolean,
  "pepDetails": "string describing PEP status details"
}

If no information is found, return null for all fields except pepStatus (which should be false).
Only include information you can confidently extract from the query.
When determining PEP status for Mexico, consider if the person holds or has held any of the positions listed above.`,
					},
					{
						role: "user",
						content: `Check PEP status for: ${query}`,
					},
				],
				temperature: 0.1,
				response_format: { type: "json_object" },
			};

			console.log("[GrokService] Sending request to Grok API", {
				url: `${this.baseUrl}/chat/completions`,
				model: requestBody.model,
			});

			const response = await fetch(`${this.baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify(requestBody),
			});

			console.log("[GrokService] Received response from Grok API", {
				status: response.status,
				statusText: response.statusText,
				ok: response.ok,
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error("[GrokService] Grok API error", {
					status: response.status,
					statusText: response.statusText,
					errorText,
				});
				return null;
			}

			const data = (await response.json()) as {
				choices?: Array<{
					message?: {
						content?: string;
					};
				}>;
			};

			console.log("[GrokService] Parsing Grok API response", {
				hasChoices: !!data.choices,
				choicesCount: data.choices?.length || 0,
			});

			const content = data.choices?.[0]?.message?.content;

			if (!content) {
				console.error("[GrokService] Grok API returned no content", {
					dataStructure: Object.keys(data),
				});
				return null;
			}

			console.log("[GrokService] Parsing JSON content from Grok response", {
				contentLength: content.length,
			});

			// Parse the JSON response
			const parsed = JSON.parse(content) as GrokPEPResponse;

			console.log("[GrokService] Successfully parsed Grok response", {
				hasName: !!parsed.name,
				pepStatus: parsed.pepStatus,
				hasPepDetails: !!parsed.pepDetails,
			});

			// Validate and normalize the response
			return {
				name: parsed.name || null,
				aliases: Array.isArray(parsed.aliases) ? parsed.aliases : null,
				birthDate: parsed.birthDate || null,
				countries: Array.isArray(parsed.countries) ? parsed.countries : null,
				addresses: Array.isArray(parsed.addresses) ? parsed.addresses : null,
				identifiers: Array.isArray(parsed.identifiers)
					? parsed.identifiers
					: null,
				sanctions: Array.isArray(parsed.sanctions) ? parsed.sanctions : null,
				phones: Array.isArray(parsed.phones) ? parsed.phones : null,
				emails: Array.isArray(parsed.emails) ? parsed.emails : null,
				programIds: Array.isArray(parsed.programIds) ? parsed.programIds : null,
				dataset: parsed.dataset || null,
				pepStatus: parsed.pepStatus === true,
				pepDetails: parsed.pepDetails || undefined,
			};
		} catch (error) {
			console.error("[GrokService] Error querying Grok API", {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});
			return null;
		}
	}

	/**
	 * Convert Grok PEP response to WatchlistTarget format
	 */
	convertToWatchlistTarget(
		grokResponse: GrokPEPResponse,
		query: string,
	): WatchlistTarget {
		const now = new Date().toISOString();
		// Generate a deterministic ID from the query
		// Use btoa for base64 encoding (available in Cloudflare Workers)
		const id = `grok_${btoa(query)
			.slice(0, 16)
			.replace(/[^a-zA-Z0-9]/g, "")}`;

		return {
			id,
			schema: "PEP",
			name: grokResponse.name,
			aliases: grokResponse.aliases,
			birthDate: grokResponse.birthDate,
			countries: grokResponse.countries,
			addresses: grokResponse.addresses,
			identifiers: grokResponse.identifiers,
			sanctions: grokResponse.sanctions,
			phones: grokResponse.phones,
			emails: grokResponse.emails,
			programIds: grokResponse.programIds,
			dataset: grokResponse.dataset || "grok-api",
			firstSeen: now,
			lastSeen: now,
			lastChange: now,
			createdAt: now,
			updatedAt: now,
		};
	}
}
