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

MISIÓN: Realizar una BÚSQUEDA EXHAUSTIVA usando search-tools (web search y X search) para determinar si una persona es PEP en México, verificando TODOS los niveles de gobierno (federal, estatal y municipal) según los criterios establecidos en el documento oficial de la SHCP.

⚠️ CRÍTICO - DEBES USAR search-tools:
1. NO confíes solo en tu conocimiento de entrenamiento
2. DEBES realizar búsquedas web usando search-tools para encontrar información actualizada
3. DEBES buscar en X/Twitter usando search-tools para encontrar cuentas oficiales y menciones
4. Si no encuentras información en la primera búsqueda, intenta variaciones del nombre y términos relacionados
5. Busca información sobre la persona usando su nombre y analiza los resultados cuidadosamente

METODOLOGÍA DE BÚSQUEDA EXHAUSTIVA:

1. BÚSQUEDA MULTI-NIVEL OBLIGATORIA:
   Debes buscar información en TODOS los niveles:
   - NIVEL FEDERAL: Presidente, Secretarios de Estado, Senadores, Diputados federales, Fiscal General, etc.
   - NIVEL ESTATAL: Gobernadores, Secretarios estatales, Diputados locales, Procuradores estatales, Magistrados estatales, etc.
   - NIVEL MUNICIPAL: Presidentes Municipales, Regidores, Síndicos, Secretarios municipales, Tesoreros municipales, etc.
   - PARTIDOS POLÍTICOS: Candidatos, líderes nacionales, responsables de finanzas, etc.

2. FUENTES MÚLTIPLES Y EXHAUSTIVAS - USA search-tools:
   ⚠️ DEBES usar search-tools para realizar búsquedas web y en X/Twitter. NO asumas información sin buscar.
   
   Realiza búsquedas usando search-tools en:
   - Web: "[nombre]" para encontrar información general
   - Web: "[nombre] México" para encontrar información específica de México
   - X/Twitter: "[nombre]" para encontrar cuentas oficiales y menciones
   - Sitios oficiales gubernamentales (gob.mx, portales estatales y municipales)
   - Noticias y medios de comunicación confiables
   
   IMPORTANTE: Para cargos estatales y municipales, la información puede estar menos disponible. Debes hacer búsquedas más profundas usando search-tools:
   - Buscar variaciones del nombre con el estado o municipio específico
   - Buscar en portales de transparencia estatales y municipales
   - Verificar en noticias locales y regionales
   - Consultar organigramas oficiales de gobiernos estatales y municipales

3. VARIACIONES DE NOMBRE A VERIFICAR:
   Busca la persona usando:
   - Nombre completo tal como se proporciona
   - Variaciones con diferentes combinaciones de apellidos
   - Nombre con y sin acentos
   - Nombre con títulos o cargos (ej: "Lic. Juan Pérez", "Dr. María González")
   - Nombre con el cargo específico (ej: "Juan Pérez Gobernador", "María González Alcalde")
   - Nombre con ubicación geográfica (ej: "Juan Pérez Jalisco", "María González Guadalajara")

4. CRITERIOS ESTRICTOS DE MATCHING (para evitar falsos positivos):
   - COINCIDENCIA DE NOMBRES: El nombre debe ser una coincidencia exacta o muy cercana con el PEP real
   - Coincidencias parciales NO son suficientes para determinar que es PEP
   - Si solo hay similitud parcial en el nombre, debes retornar pepStatus: false
   - Ejemplo: Si buscas "Juan Pérez" y encuentras "Juan Carlos Pérez López", esto es solo coincidencia parcial y NO debe considerarse PEP a menos que haya evidencia adicional clara que confirme que es la misma persona

5. VERIFICACIÓN ESTRICTA: Solo retorna pepStatus: true si:
   - El nombre coincide exactamente o con variaciones menores (como acentos, orden de apellidos)
   - Y existe evidencia clara y verificable de que la persona ocupa o ocupó uno de los cargos PEP:
     * Explícitamente listados en el documento oficial, O
     * Homólogos (equivalentes estatales/municipales de cargos federales), O
     * Dentro de los "tres niveles jerárquicos inferiores" de organismos descentralizados/órganos desconcentrados
   - Y puedes confirmar con alta confianza que es la misma persona
   - Y el cargo está dentro del período de los últimos 5 años (hasta diciembre 2025)
   
   EJEMPLO: "Director Técnico Nacional" en un organismo descentralizado bajo Secretaría de Estado ES PEP porque:
   - El organismo descentralizado está bajo una Secretaría de Estado
   - "Director Técnico Nacional" está dentro de los tres niveles jerárquicos inferiores
   - Por lo tanto, aunque no esté explícitamente listado, califica como PEP

6. CUANDO DUDAR: Si hay cualquier incertidumbre, similitud parcial, o falta de evidencia clara:
   - DEBES retornar pepStatus: false
   - Es preferible un falso negativo que un falso positivo
   - Las coincidencias parciales de nombres deben tratarse como negativas por defecto

7. REFERENCIA AL DOCUMENTO OFICIAL:
   El documento oficial de la SHCP que se te proporciona contiene la lista completa de cargos públicos que convierten a una persona en PEP. Debes:
   - Consultar TODAS las secciones del documento (Federal, Estatal, Municipal, Partidos Políticos)
   - Verificar que el cargo encontrado esté listado EXPLÍCITAMENTE en el documento, O sea un cargo HOMÓLOGO (equivalente estatal/municipal), O esté dentro de los "tres niveles jerárquicos inferiores"
   - Aplicar los criterios y factores de riesgo mencionados en el documento
   - Considerar los tres niveles jerárquicos inferiores cuando aplique según el documento

8. CARGOS EN ORGANISMOS DESCENTRALIZADOS Y ÓRGANOS DESCONCENTRADOS:
   IMPORTANTE: Los directores, titulares y hasta dos niveles jerárquicos inferiores en organismos descentralizados y órganos desconcentrados de las Secretarías de Estado SON PEP.
   
   Ejemplos de organismos descentralizados bajo Secretarías que incluyen cargos PEP:
   - Cualquier organismo descentralizado bajo Secretaría de Educación Pública: Directores, Subdirectores, Coordinadores Nacionales, Directores Técnicos Nacionales
   - Cualquier organismo descentralizado bajo otras Secretarías: Directores, Subdirectores
   - CENAPRED bajo Secretaría de Gobernación: Directores, Subdirectores
   - Y TODOS los demás organismos descentralizados listados en el documento bajo cada Secretaría
   
   REGLA: Si encuentras a una persona como "Director", "Subdirector", "Coordinador Nacional", "Director Técnico Nacional", "Jefe de Unidad", etc. en CUALQUIER organismo descentralizado u órgano desconcentrado de una Secretaría de Estado, esa persona ES PEP, incluso si el cargo específico no está explícitamente listado.
   
   Los "tres niveles jerárquicos inferiores" se aplican a:
   - Titulares de organismos descentralizados (nivel 1)
   - Subdirectores, Directores Generales, Coordinadores (nivel 2)
   - Directores de área, Jefes de departamento, Directores Técnicos (nivel 3)

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
  "pepDetails": "string describing PEP status details including level (federal/estatal/municipal), specific position, and time period"
}

REGLAS PARA pepStatus:
- Retorna true SOLO si hay coincidencia exacta o muy cercana del nombre Y evidencia clara de cargo PEP (federal, estatal o municipal)
- Retorna false si hay coincidencia parcial del nombre (incluso si hay similitud)
- Retorna false si no hay evidencia suficiente o hay incertidumbre
- Retorna false si no se encuentra información después de búsqueda exhaustiva
- Si no hay información encontrada, retorna null para todos los campos excepto pepStatus (que debe ser false)
- Solo incluye información que puedas extraer con confianza de la consulta
- En pepDetails, incluye el nivel de gobierno (federal/estatal/municipal), el cargo específico y el período`,
					},
					{
						role: "user",
						content: `A continuación se incluye el texto completo de la versión oficial del documento "Lista de Personas Políticamente Expuestas Nacionales 2020" emitido por la Secretaría de Hacienda y Crédito Público (SHCP) de México.

Este documento es tu REFERENCIA OFICIAL Y DEFINITIVA para determinar si una persona es PEP. Contiene:

1. SECCIÓN I - ÁMBITO FEDERAL: Todos los cargos PEP a nivel federal (Poder Ejecutivo, Legislativo, Judicial, Administración Pública Descentralizada, Organismos Autónomos)

2. SECCIÓN II - ÁMBITO ESTATAL: Cargos PEP a nivel estatal (Gobernadores, Secretarios estatales, Diputados locales, Procuradores estatales, Magistrados estatales, etc.)

3. SECCIÓN III - ÁMBITO MUNICIPAL: Cargos PEP a nivel municipal (Presidentes Municipales, Regidores, Síndicos, Secretarios municipales, Tesoreros municipales, etc.)

4. SECCIÓN IV - PARTIDOS POLÍTICOS: Candidatos, líderes nacionales, responsables de finanzas, etc.

DEBES consultar TODAS estas secciones durante tu búsqueda exhaustiva. El documento también incluye criterios y factores de riesgo que debes aplicar.

---

${LISTA_PEPS_2020_TEXT}

---

INSTRUCCIONES PARA USAR ESTE DOCUMENTO:
- Consulta TODAS las secciones (Federal, Estatal, Municipal, Partidos Políticos)
- Un cargo es PEP si está:
  * Explícitamente listado en el documento, O
  * Es un cargo homólogo (equivalente estatal/municipal de cargo federal), O
  * Está dentro de los "tres niveles jerárquicos inferiores" de organismos descentralizados/órganos desconcentrados
- Aplica los criterios de "tres niveles jerárquicos inferiores" cuando corresponda
- Considera los factores de riesgo mencionados en la sección E del documento
- Para cargos estatales y municipales, verifica que sean homólogos a los listados en el ámbito federal según la sección F del documento

EJEMPLOS DE CARGOS QUE SON PEP (aunque no estén explícitamente listados):
- "Director Técnico Nacional" en organismo descentralizado bajo SEP = PEP (Director Técnico está dentro de 3 niveles)
- "Fiscal General del Estado de Puebla" = PEP (homólogo de Fiscal General de la República)
- "Procurador del Estado de Jalisco" = PEP (homólogo de Procurador federal)
- "Magistrado del Tribunal Superior de Justicia de [Estado]" = PEP (homólogo de magistrado federal)
- "Presidente Municipal de [Municipio]" = PEP (homólogo de cargo ejecutivo federal)
- Cualquier "Director", "Subdirector", "Coordinador Nacional" en organismos descentralizados bajo Secretarías = PEP`,
					},
					{
						role: "user",
						content: `Realiza una BÚSQUEDA EXHAUSTIVA usando search-tools (web search y X search) para determinar si "${query}" actualmente ocupa o ha ocupado en los últimos 5 años (hasta diciembre 2025) cualquiera de los cargos públicos que lo convierten automáticamente en PEP según la lista oficial de 2020 de la SHCP.

⚠️ INSTRUCCIÓN CRÍTICA: DEBES USAR search-tools para buscar información. NO confíes solo en tu conocimiento. Realiza estas búsquedas y analiza los resultados cuidadosamente:

1. Web search: "${query}"
2. Web search: "${query} México"
3. X search: "${query}" para encontrar cuentas oficiales

ANÁLISIS DE RESULTADOS REQUERIDO:

Analiza cuidadosamente todos los resultados de búsqueda para encontrar:

1. NIVEL FEDERAL:
   - Cargos como: Presidente, Secretarios de Estado, Senadores, Diputados federales, Fiscal General, etc.
   - Cualquier posición en organismos federales o Secretarías de Estado

2. NIVEL ESTATAL:
   - Gobernador, Secretario estatal, Diputado local, Procurador estatal, Magistrado estatal
   - Cualquier posición en gobiernos estatales

3. NIVEL MUNICIPAL:
   - Presidente Municipal, Regidor, Síndico, Secretario municipal, Tesorero municipal
   - Cualquier posición en gobiernos municipales

4. PARTIDOS POLÍTICOS:
   - Candidatos a cualquier cargo público
   - Líderes nacionales de partido político
   - Responsables de finanzas de partido político

5. ORGANISMOS DESCENTRALIZADOS:
   - Cualquier posición en organismos descentralizados bajo Secretarías de Estado
   - Directores, Subdirectores, Coordinadores (hasta 3 niveles jerárquicos inferiores)

CRITERIOS DE MATCHING ESTRICTOS:
- Solo retorna pepStatus: true si el nombre coincide exactamente o con variaciones menores (no parciales)
- Si solo hay coincidencia parcial del nombre, retorna pepStatus: false
- Verifica que sea la misma persona con evidencia clara antes de retornar positivo
- El cargo debe ser PEP según el documento: explícitamente listado, homólogo, o dentro de 3 niveles jerárquicos inferiores
- En caso de duda sobre el nombre, retorna pepStatus: false
- PERO: Si el nombre coincide y encuentras un cargo en organismo descentralizado/órgano desconcentrado bajo una Secretaría de Estado, ese cargo SÍ es PEP aunque no esté explícitamente listado

IMPORTANTE: Realiza búsquedas exhaustivas en múltiples fuentes. No te limites solo a resultados obvios. Los cargos estatales y municipales requieren búsquedas más profundas ya que la información puede estar menos disponible públicamente.`,
					},
				],
				temperature: 0.1,
				response_format: { type: "json_object" },
				max_turns: 15, // Allow multiple turns for search-tools usage
				// Note: search-tools should be automatically available in grok-4-1-fast-reasoning
				// The model will use them when instructed to search
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
