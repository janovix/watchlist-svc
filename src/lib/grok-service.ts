import { WatchlistTarget } from "../endpoints/watchlist/base";
import { LISTA_PEPS_2020_TEXT } from "./lista-peps-2020";

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
				model: "grok-4-1-fast-reasoning",
				messages: [
					{
						role: "system",
						content: `Eres un verificador oficial de Personas Políticamente Expuestas (PEP) en México según la "Lista de Personas Políticamente Expuestas Nacionales 2020" de la SHCP.

Revisa si la persona actualmente ocupa o ha ocupado en los últimos 5 años (hasta diciembre 2025) cualquiera de los siguientes cargos públicos que lo convierten automáticamente en PEP nacional:

- Presidente de la República
- Secretarios de Estado (todas las secretarías federales: Gobernación, Hacienda, Defensa, Marina, SRE, etc.)
- Titulares de órganos desconcentrados, descentralizados, reguladores energéticos
- Fiscal General de la República
- Senadores y Diputados federales
- Gobernadores, Jefes de Gobierno de CDMX, Presidentes Municipales
- Procuradores o Fiscales Generales estatales
- Magistrados y Jueces de alto nivel (Suprema Corte, Tribunales federales y estatales)
- Titulares de organismos autónomos (INE, INAI, CNDH, Banco de México, etc.)
- Directores generales de empresas productivas del Estado (Pemex, CFE, etc.) y empresas de participación estatal mayoritaria
- Altos mandos militares (generales de división, almirantes)
- Líderes o directores nacionales de partidos políticos
- Titulares de fondos y fideicomisos públicos relevantes

Usa búsqueda web, X y fuentes oficiales para confirmar su cargo actual y últimos 5 años.

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

For pepStatus: return true if the person is PEP according to the official 2020 list (currently holds or held any of the above positions in the last 5 years until December 2025), false otherwise.
If no information is found, return null for all fields except pepStatus (which should be false).
Only include information you can confidently extract from the query.`,
					},
					{
						role: "user",
						content: `A continuación se incluye el texto completo de la versión oficial del documento "Lista de Personas Políticamente Expuestas Nacionales 2020" emitido por la Secretaría de Hacienda y Crédito Público (SHCP) de México. Este es el documento oficial de referencia que debes usar para determinar si una persona es PEP según los cargos públicos listados:

---

${LISTA_PEPS_2020_TEXT}

---

Usa este documento oficial como referencia principal para verificar si una persona ocupa o ha ocupado alguno de los cargos públicos mencionados que la convierten en PEP nacional.`,
					},
					{
						role: "user",
						content: `Revisa si ${query} actualmente ocupa o ha ocupado en los últimos 5 años (hasta diciembre 2025) cualquiera de los cargos públicos que lo convierten automáticamente en PEP nacional según la lista oficial de 2020 de la SHCP.`,
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
