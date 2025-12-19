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

⚠️ INSTRUCCIÓN CRÍTICA: DEBES USAR BÚSQUEDA WEB ⚠️
- USA la funcionalidad de búsqueda web de Grok para TODAS las consultas
- NO confíes solo en conocimiento previo o información almacenada
- REALIZA búsquedas web activas y múltiples antes de responder
- Verifica TODA la información mediante búsquedas web en tiempo real

MISIÓN: Realizar una BÚSQUEDA EXHAUSTIVA usando BÚSQUEDA WEB ACTIVA para determinar si una persona es PEP en México, verificando TODOS los niveles de gobierno (federal, estatal y municipal) según los criterios establecidos en el documento oficial de la SHCP.

METODOLOGÍA DE BÚSQUEDA EXHAUSTIVA:

1. BÚSQUEDA MULTI-NIVEL OBLIGATORIA:
   Debes buscar información en TODOS los niveles:
   - NIVEL FEDERAL: Presidente, Secretarios de Estado, Senadores, Diputados federales, Fiscal General, etc.
   - NIVEL ESTATAL: Gobernadores, Secretarios estatales, Diputados locales, Procuradores estatales, Magistrados estatales, etc.
   - NIVEL MUNICIPAL: Presidentes Municipales, Regidores, Síndicos, Secretarios municipales, Tesoreros municipales, etc.
   - PARTIDOS POLÍTICOS: Candidatos, líderes nacionales, responsables de finanzas, etc.

2. BÚSQUEDA WEB OBLIGATORIA Y EXPLÍCITA:
   DEBES realizar búsquedas web activas usando la funcionalidad de búsqueda web de Grok. NO puedes confiar solo en conocimiento previo.
   
   INSTRUCCIONES PARA BÚSQUEDA WEB:
   - USA LA FUNCIÓN DE BÚSQUEDA WEB de Grok para cada consulta
   - Realiza MÚLTIPLES búsquedas web con diferentes términos
   - NO asumas información sin verificar mediante búsqueda web
   - Realiza al menos 3-5 búsquedas web diferentes por persona consultada
   
   TÉRMINOS DE BÚSQUEDA WEB A REALIZAR (usa búsqueda web para cada uno):
   - "[nombre] México PEP"
   - "[nombre] gobernador México"
   - "[nombre] alcalde México"
   - "[nombre] diputado México"
   - "[nombre] secretario estado México"
   - "[nombre] [cualquier estado mexicano]"
   - "[nombre] gobierno [cualquier estado]"
   - "[nombre] municipio [cualquier municipio]"
   - "[nombre] servidor público México"
   - "[nombre] cargo público México"
   
   FUENTES WEB A CONSULTAR (usa búsqueda web para acceder):
   - Sitios web oficiales gubernamentales (gob.mx, portales estatales y municipales)
   - Redes sociales oficiales (X/Twitter de instituciones gubernamentales)
   - Noticias y medios de comunicación confiables
   - Bases de datos públicas de servidores públicos
   - Registros oficiales de cargos públicos
   - Páginas de transparencia gubernamental
   
   IMPORTANTE: Para cargos estatales y municipales, la información puede estar menos disponible. Debes hacer búsquedas web MÁS PROFUNDAS:
   - Realiza búsquedas web con variaciones del nombre + estado específico
   - Realiza búsquedas web en portales de transparencia estatales y municipales
   - Realiza búsquedas web en noticias locales y regionales
   - Realiza búsquedas web para consultar organigramas oficiales de gobiernos estatales y municipales

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
   - Y existe evidencia clara y verificable de que la persona ocupa o ocupó uno de los cargos PEP listados en el documento oficial
   - Y puedes confirmar con alta confianza que es la misma persona
   - Y el cargo está dentro del período de los últimos 5 años (hasta diciembre 2025)

6. CUANDO DUDAR: Si hay cualquier incertidumbre, similitud parcial, o falta de evidencia clara:
   - DEBES retornar pepStatus: false
   - Es preferible un falso negativo que un falso positivo
   - Las coincidencias parciales de nombres deben tratarse como negativas por defecto

7. REFERENCIA AL DOCUMENTO OFICIAL:
   El documento oficial de la SHCP que se te proporciona contiene la lista completa de cargos públicos que convierten a una persona en PEP. Debes:
   - Consultar TODAS las secciones del documento (Federal, Estatal, Municipal, Partidos Políticos)
   - Verificar que el cargo encontrado esté listado en el documento
   - Aplicar los criterios y factores de riesgo mencionados en el documento
   - Considerar los tres niveles jerárquicos inferiores cuando aplique según el documento

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
- Verifica que cualquier cargo encontrado esté listado en el documento
- Aplica los criterios de "tres niveles jerárquicos inferiores" cuando corresponda
- Considera los factores de riesgo mencionados en la sección E del documento
- Para cargos estatales y municipales, verifica que sean homólogos a los listados en el ámbito federal según la sección F del documento`,
					},
					{
						role: "user",
						content: `Realiza una BÚSQUEDA EXHAUSTIVA usando BÚSQUEDA WEB ACTIVA para determinar si "${query}" actualmente ocupa o ha ocupado en los últimos 5 años (hasta diciembre 2025) cualquiera de los cargos públicos que lo convierten automáticamente en PEP según la lista oficial de 2020 de la SHCP.

⚠️ INSTRUCCIÓN CRÍTICA: DEBES USAR LA FUNCIÓN DE BÚSQUEDA WEB DE GROK ⚠️
- NO confíes solo en tu conocimiento previo
- REALIZA búsquedas web activas usando la herramienta de búsqueda web
- Realiza MÚLTIPLES búsquedas web con diferentes términos de búsqueda
- Verifica TODA la información mediante búsquedas web antes de responder

BÚSQUEDAS WEB ESPECÍFICAS A REALIZAR (usa búsqueda web para cada una):
1. Búsqueda web: "${query} México PEP"
2. Búsqueda web: "${query} gobernador México"
3. Búsqueda web: "${query} alcalde México"
4. Búsqueda web: "${query} diputado México"
5. Búsqueda web: "${query} secretario estado México"
6. Búsqueda web: "${query} servidor público México"
7. Búsqueda web: "${query} cargo público México"
8. Búsqueda web: "${query} gobierno México"
9. Búsqueda web: "${query} [buscar con cada uno de los 32 estados de México]"
10. Búsqueda web: "${query} municipio México"

BÚSQUEDA REQUERIDA:

1. NIVEL FEDERAL (prioridad alta - información más disponible):
   - Busca en sitios oficiales del gobierno federal (gob.mx)
   - Verifica cargos como: Presidente, Secretarios de Estado, Senadores, Diputados federales, Fiscal General, etc.
   - Consulta noticias y comunicados oficiales

2. NIVEL ESTATAL (búsqueda profunda requerida):
   - Busca en portales oficiales de los 32 estados de México
   - Verifica si es Gobernador, Secretario estatal, Diputado local, Procurador estatal, Magistrado estatal
   - Busca variaciones del nombre con nombres de estados: "${query} [nombre del estado]"
   - Consulta portales de transparencia estatales
   - Revisa noticias locales y regionales
   - Verifica organigramas oficiales de gobiernos estatales

3. NIVEL MUNICIPAL (búsqueda más profunda requerida - información menos disponible):
   - Busca en portales oficiales municipales
   - Verifica si es Presidente Municipal, Regidor, Síndico, Secretario municipal, Tesorero municipal
   - Busca variaciones del nombre con nombres de municipios: "${query} [nombre del municipio]"
   - Consulta portales de transparencia municipales
   - Revisa noticias locales y periódicos regionales
   - Verifica cabildos y estructuras municipales

4. PARTIDOS POLÍTICOS:
   - Verifica si es candidato a cualquier cargo público
   - Busca si es líder nacional de partido político
   - Verifica si es responsable de finanzas de partido político

5. VARIACIONES DE BÚSQUEDA:
   Busca usando múltiples variaciones:
   - "${query}"
   - "${query} México"
   - "${query} gobernador"
   - "${query} alcalde"
   - "${query} diputado"
   - "${query} secretario"
   - "${query} [cualquier estado de México]"
   - "${query} [cualquier municipio]"

CRITERIOS DE MATCHING ESTRICTOS:
- Solo retorna pepStatus: true si el nombre coincide exactamente o con variaciones menores (no parciales)
- Si solo hay coincidencia parcial del nombre, retorna pepStatus: false
- Verifica que sea la misma persona con evidencia clara antes de retornar positivo
- El cargo debe estar claramente listado en el documento oficial de la SHCP
- En caso de duda, retorna pepStatus: false

IMPORTANTE: Realiza búsquedas exhaustivas en múltiples fuentes. No te limites solo a resultados obvios. Los cargos estatales y municipales requieren búsquedas más profundas ya que la información puede estar menos disponible públicamente.`,
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
