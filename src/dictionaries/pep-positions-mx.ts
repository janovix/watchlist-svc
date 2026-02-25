/**
 * Mexican PEP (Politically Exposed Person) Position Dictionaries
 *
 * Comprehensive dictionary of government and public positions in Mexico
 * classified by risk tier following FATF/GAFI recommendations and Mexican
 * AML regulations (LFPIORPI, CNBV Dispositions).
 *
 * Tier 1 - Alto Riesgo: Elected officials, constitutional appointees,
 *          senior judiciary, military commanders, heads of state enterprises.
 * Tier 2 - Riesgo Medio: Administrative leadership (directors, coordinators,
 *          delegates), mid-level judiciary, oversight officials.
 * Tier 3 - Riesgo Operativo: Operational positions with access to public
 *          resources or decision-making (subdirectors, department heads, etc.).
 *
 * Position titles are normalized to uppercase Spanish without accents for
 * matching purposes. Matching should use fuzzy/contains logic rather than
 * exact equality, since official records may include additional qualifiers.
 */

// =============================================================================
// Types
// =============================================================================

export interface PepPositionCategory {
	/** Human-readable category name */
	category: string;
	/** Position titles within this category */
	positions: readonly string[];
}

export interface PepPositionTier {
	tier: 1 | 2 | 3;
	/** Spanish label */
	label: string;
	/** Risk level label */
	riskLevel: string;
	/** Description of what this tier covers */
	description: string;
	/** Organized categories of positions */
	categories: readonly PepPositionCategory[];
}

export type PepTierResult = {
	tier: 1 | 2 | 3;
	riskLevel: string;
	matchedPosition: string;
};

// =============================================================================
// Tier 1 - Alto Riesgo (High Risk)
// Elected officials, constitutional appointees, senior judiciary,
// military/security commanders, heads of state enterprises, party leaders.
// =============================================================================

export const PEP_TIER_1: PepPositionTier = {
	tier: 1,
	label: "Alto Riesgo",
	riskLevel: "high",
	description:
		"Funcionarios electos, designados constitucionalmente, altos mandos judiciales, " +
		"militares, titulares de empresas del estado y dirigentes de partidos politicos.",
	categories: [
		// -----------------------------------------------------------------
		// Poder Ejecutivo Federal
		// -----------------------------------------------------------------
		{
			category: "Poder Ejecutivo Federal",
			positions: [
				"PRESIDENTE DE LA REPUBLICA",
				"PRESIDENTE DE MEXICO",
				"PRESIDENTE CONSTITUCIONAL",
				"SECRETARIO DE ESTADO",
				"SECRETARIO DE GOBERNACION",
				"SECRETARIO DE RELACIONES EXTERIORES",
				"SECRETARIO DE LA DEFENSA NACIONAL",
				"SECRETARIO DE MARINA",
				"SECRETARIO DE HACIENDA Y CREDITO PUBLICO",
				"SECRETARIO DE BIENESTAR",
				"SECRETARIO DE MEDIO AMBIENTE Y RECURSOS NATURALES",
				"SECRETARIO DE ENERGIA",
				"SECRETARIO DE ECONOMIA",
				"SECRETARIO DE AGRICULTURA Y DESARROLLO RURAL",
				"SECRETARIO DE INFRAESTRUCTURA COMUNICACIONES Y TRANSPORTES",
				"SECRETARIO DE LA FUNCION PUBLICA",
				"SECRETARIO DE EDUCACION PUBLICA",
				"SECRETARIO DE SALUD",
				"SECRETARIO DE TRABAJO Y PREVISION SOCIAL",
				"SECRETARIO DE DESARROLLO AGRARIO TERRITORIAL Y URBANO",
				"SECRETARIO DE CULTURA",
				"SECRETARIO DE TURISMO",
				"SECRETARIO DE SEGURIDAD Y PROTECCION CIUDADANA",
				"SECRETARIO DE CIENCIA HUMANIDADES TECNOLOGIA E INNOVACION",
				"SECRETARIO DE COMUNICACIONES Y TRANSPORTES",
				"SUBSECRETARIO DE ESTADO",
				"SUBSECRETARIO DE GOBERNACION",
				"SUBSECRETARIO DE HACIENDA Y CREDITO PUBLICO",
				"SUBSECRETARIO DE RELACIONES EXTERIORES",
				"SUBSECRETARIO DE EDUCACION PUBLICA",
				"SUBSECRETARIO DE SALUD",
				"SUBSECRETARIO DE PREVENCION Y PROMOCION DE LA SALUD",
				"SUBSECRETARIO",
				"CONSEJERO JURIDICO DEL EJECUTIVO FEDERAL",
				"JEFE DE LA OFICINA DE LA PRESIDENCIA",
				"OFICIAL MAYOR",
				"PROCURADOR GENERAL DE LA REPUBLICA",
				"FISCAL GENERAL DE LA REPUBLICA",
				"SUBPROCURADOR GENERAL DE LA REPUBLICA",
				"SUBPROCURADOR",
				"SUBFISCAL",
				"FISCAL GENERAL",
				"FISCAL ESPECIALIZADO",
				"FISCAL ANTICORRUPCION",
			],
		},

		// -----------------------------------------------------------------
		// Poder Legislativo Federal
		// -----------------------------------------------------------------
		{
			category: "Poder Legislativo Federal",
			positions: [
				"SENADOR",
				"SENADORA",
				"SENADOR DE LA REPUBLICA",
				"SENADORA DE LA REPUBLICA",
				"DIPUTADO FEDERAL",
				"DIPUTADA FEDERAL",
				"DIPUTADO",
				"DIPUTADA",
				"PRESIDENTE DE LA CAMARA DE SENADORES",
				"PRESIDENTA DE LA CAMARA DE SENADORES",
				"PRESIDENTE DE LA CAMARA DE DIPUTADOS",
				"PRESIDENTA DE LA CAMARA DE DIPUTADOS",
				"PRESIDENTE DE LA MESA DIRECTIVA",
				"PRESIDENTA DE LA MESA DIRECTIVA",
				"PRESIDENTE DE COMISION",
				"PRESIDENTA DE COMISION",
				"COORDINADOR DE GRUPO PARLAMENTARIO",
				"COORDINADORA DE GRUPO PARLAMENTARIO",
				"COORDINADOR PARLAMENTARIO",
				"COORDINADORA PARLAMENTARIA",
			],
		},

		// -----------------------------------------------------------------
		// Poder Judicial Federal
		// -----------------------------------------------------------------
		{
			category: "Poder Judicial Federal",
			positions: [
				"MINISTRO DE LA SUPREMA CORTE DE JUSTICIA DE LA NACION",
				"MINISTRA DE LA SUPREMA CORTE DE JUSTICIA DE LA NACION",
				"MINISTRO DE LA SCJN",
				"MINISTRA DE LA SCJN",
				"PRESIDENTE DE LA SUPREMA CORTE DE JUSTICIA DE LA NACION",
				"PRESIDENTA DE LA SUPREMA CORTE DE JUSTICIA DE LA NACION",
				"MAGISTRADO DE CIRCUITO",
				"MAGISTRADA DE CIRCUITO",
				"MAGISTRADO",
				"MAGISTRADA",
				"JUEZ DE DISTRITO",
				"JUEZA DE DISTRITO",
				"JUEZ",
				"JUEZA",
				"JUEZ FEDERAL",
				"JUEZA FEDERAL",
				"CONSEJERO DE LA JUDICATURA FEDERAL",
				"CONSEJERA DE LA JUDICATURA FEDERAL",
				"PRESIDENTE DEL CONSEJO DE LA JUDICATURA FEDERAL",
				"PRESIDENTA DEL CONSEJO DE LA JUDICATURA FEDERAL",
				"MAGISTRADO DEL TRIBUNAL ELECTORAL",
				"MAGISTRADA DEL TRIBUNAL ELECTORAL",
				"MAGISTRADO DEL TRIBUNAL FEDERAL DE JUSTICIA ADMINISTRATIVA",
				"MAGISTRADA DEL TRIBUNAL FEDERAL DE JUSTICIA ADMINISTRATIVA",
				"MAGISTRADO DEL TEPJF",
				"MAGISTRADA DEL TEPJF",
			],
		},

		// -----------------------------------------------------------------
		// Gobiernos Estatales
		// -----------------------------------------------------------------
		{
			category: "Gobiernos Estatales",
			positions: [
				"GOBERNADOR",
				"GOBERNADORA",
				"GOBERNADOR CONSTITUCIONAL",
				"GOBERNADORA CONSTITUCIONAL",
				"GOBERNADOR DEL ESTADO",
				"GOBERNADORA DEL ESTADO",
				"JEFE DE GOBIERNO",
				"JEFA DE GOBIERNO",
				"JEFE DE GOBIERNO DE LA CIUDAD DE MEXICO",
				"JEFA DE GOBIERNO DE LA CIUDAD DE MEXICO",
				"SECRETARIO DE GOBIERNO",
				"SECRETARIA DE GOBIERNO",
				"SECRETARIO GENERAL DE GOBIERNO",
				"SECRETARIA GENERAL DE GOBIERNO",
				"PROCURADOR GENERAL DE JUSTICIA",
				"PROCURADORA GENERAL DE JUSTICIA",
				"FISCAL GENERAL DEL ESTADO",
				"DIPUTADO LOCAL",
				"DIPUTADA LOCAL",
				"DIPUTADO DEL CONGRESO LOCAL",
				"DIPUTADA DEL CONGRESO LOCAL",
				"MAGISTRADO DEL TRIBUNAL SUPERIOR DE JUSTICIA",
				"MAGISTRADA DEL TRIBUNAL SUPERIOR DE JUSTICIA",
				"PRESIDENTE DEL TRIBUNAL SUPERIOR DE JUSTICIA",
				"PRESIDENTA DEL TRIBUNAL SUPERIOR DE JUSTICIA",
				"CONSEJERO DE LA JUDICATURA ESTATAL",
				"CONSEJERA DE LA JUDICATURA ESTATAL",
				"CONTRALOR GENERAL DEL ESTADO",
				"CONTRALORA GENERAL DEL ESTADO",
				"AUDITOR SUPERIOR DEL ESTADO",
				"AUDITORA SUPERIOR DEL ESTADO",
				"TESORERO DEL ESTADO",
				"TESORERA DEL ESTADO",
				"SECRETARIO DE FINANZAS",
				"SECRETARIA DE FINANZAS",
			],
		},

		// -----------------------------------------------------------------
		// Gobiernos Municipales
		// -----------------------------------------------------------------
		{
			category: "Gobiernos Municipales",
			positions: [
				"PRESIDENTE MUNICIPAL",
				"PRESIDENTA MUNICIPAL",
				"ALCALDE",
				"ALCALDESA",
				"SINDICO",
				"SINDICA",
				"SINDICO MUNICIPAL",
				"SINDICA MUNICIPAL",
				"SINDICO PROCURADOR",
				"SINDICA PROCURADORA",
				"REGIDOR",
				"REGIDORA",
				"TESORERO",
				"TESORERA",
				"TESORERO MUNICIPAL",
				"TESORERA MUNICIPAL",
				"CONTRALOR",
				"CONTRALORA",
				"CONTRALOR MUNICIPAL",
				"CONTRALORA MUNICIPAL",
				"SECRETARIO DEL AYUNTAMIENTO",
				"SECRETARIA DEL AYUNTAMIENTO",
				"PRESIDENTE DE JUNTA MUNICIPAL",
				"PRESIDENTA DE JUNTA MUNICIPAL",
				"CONCEJAL",
				"CONCEJALA",
			],
		},

		// -----------------------------------------------------------------
		// Organismos Autonomos Constitucionales
		// -----------------------------------------------------------------
		{
			category: "Organismos Autonomos Constitucionales",
			positions: [
				// INE
				"CONSEJERO PRESIDENTE DEL INE",
				"CONSEJERA PRESIDENTA DEL INE",
				"CONSEJERO ELECTORAL",
				"CONSEJERA ELECTORAL",
				"CONSEJERO DEL INE",
				"CONSEJERA DEL INE",
				"CONSEJERO DEL INSTITUTO NACIONAL ELECTORAL",
				"CONSEJERA DEL INSTITUTO NACIONAL ELECTORAL",
				// INAI
				"COMISIONADO DEL INAI",
				"COMISIONADA DEL INAI",
				"COMISIONADO PRESIDENTE DEL INAI",
				"COMISIONADA PRESIDENTA DEL INAI",
				// Banco de México
				"GOBERNADOR DEL BANCO DE MEXICO",
				"GOBERNADORA DEL BANCO DE MEXICO",
				"SUBGOBERNADOR DEL BANCO DE MEXICO",
				"SUBGOBERNADORA DEL BANCO DE MEXICO",
				// CNDH
				"PRESIDENTE DE LA CNDH",
				"PRESIDENTA DE LA CNDH",
				"PRESIDENTE DE LA COMISION NACIONAL DE LOS DERECHOS HUMANOS",
				"PRESIDENTA DE LA COMISION NACIONAL DE LOS DERECHOS HUMANOS",
				// COFECE
				"COMISIONADO DE LA COFECE",
				"COMISIONADA DE LA COFECE",
				"COMISIONADO PRESIDENTE DE LA COFECE",
				"COMISIONADA PRESIDENTA DE LA COFECE",
				// IFT
				"COMISIONADO DEL IFT",
				"COMISIONADA DEL IFT",
				"COMISIONADO PRESIDENTE DEL IFT",
				"COMISIONADA PRESIDENTA DEL IFT",
				// ASF
				"AUDITOR SUPERIOR DE LA FEDERACION",
				"AUDITORA SUPERIOR DE LA FEDERACION",
				"TITULAR DE LA AUDITORIA SUPERIOR DE LA FEDERACION",
				// CONEVAL
				"SECRETARIO EJECUTIVO DEL CONEVAL",
				"SECRETARIA EJECUTIVA DEL CONEVAL",
				// INEGI
				"PRESIDENTE DEL INEGI",
				"PRESIDENTA DEL INEGI",
				"VICEPRESIDENTE DEL INEGI",
				"VICEPRESIDENTA DEL INEGI",
				// CRE
				"COMISIONADO DE LA CRE",
				"COMISIONADA DE LA CRE",
				"COMISIONADO PRESIDENTE DE LA CRE",
				"COMISIONADA PRESIDENTA DE LA CRE",
				// CNH
				"COMISIONADO DE LA CNH",
				"COMISIONADA DE LA CNH",
				"COMISIONADO PRESIDENTE DE LA CNH",
				"COMISIONADA PRESIDENTA DE LA CNH",
				// Generic autonomous body
				"COMISIONADO",
				"COMISIONADA",
				"COMISIONADO PRESIDENTE",
				"COMISIONADA PRESIDENTA",
			],
		},

		// -----------------------------------------------------------------
		// Fuerzas Armadas y Seguridad
		// -----------------------------------------------------------------
		{
			category: "Fuerzas Armadas y Seguridad",
			positions: [
				"COMANDANTE SUPREMO DE LAS FUERZAS ARMADAS",
				"GENERAL DE DIVISION",
				"GENERAL DE BRIGADA",
				"GENERAL BRIGADIER",
				"ALMIRANTE",
				"VICEALMIRANTE",
				"CONTRAALMIRANTE",
				"COMANDANTE DE LA GUARDIA NACIONAL",
				"COMISIONADO NACIONAL DE SEGURIDAD",
				"COMISIONADA NACIONAL DE SEGURIDAD",
				"DIRECTOR GENERAL DEL CENTRO NACIONAL DE INTELIGENCIA",
				"DIRECTORA GENERAL DEL CENTRO NACIONAL DE INTELIGENCIA",
				"TITULAR DEL CENTRO NACIONAL DE INTELIGENCIA",
				"DIRECTOR GENERAL DE LA POLICIA FEDERAL",
				"COMISARIO GENERAL",
			],
		},

		// -----------------------------------------------------------------
		// Servicio Exterior y Diplomatico
		// -----------------------------------------------------------------
		{
			category: "Servicio Exterior y Diplomatico",
			positions: [
				"EMBAJADOR",
				"EMBAJADORA",
				"EMBAJADOR EXTRAORDINARIO Y PLENIPOTENCIARIO",
				"EMBAJADORA EXTRAORDINARIA Y PLENIPOTENCIARIA",
				"CONSUL GENERAL",
				"REPRESENTANTE PERMANENTE ANTE LA ONU",
				"REPRESENTANTE PERMANENTE ANTE LA OEA",
			],
		},

		// -----------------------------------------------------------------
		// Empresas Productivas del Estado y Paraestatales
		// -----------------------------------------------------------------
		{
			category: "Empresas del Estado y Paraestatales",
			positions: [
				"DIRECTOR GENERAL DE PEMEX",
				"DIRECTORA GENERAL DE PEMEX",
				"DIRECTOR GENERAL DE PETROLEOS MEXICANOS",
				"DIRECTORA GENERAL DE PETROLEOS MEXICANOS",
				"DIRECTOR GENERAL DE CFE",
				"DIRECTORA GENERAL DE CFE",
				"DIRECTOR GENERAL DE LA COMISION FEDERAL DE ELECTRICIDAD",
				"DIRECTORA GENERAL DE LA COMISION FEDERAL DE ELECTRICIDAD",
				"DIRECTOR GENERAL DEL IMSS",
				"DIRECTORA GENERAL DEL IMSS",
				"DIRECTOR GENERAL DEL INSTITUTO MEXICANO DEL SEGURO SOCIAL",
				"DIRECTORA GENERAL DEL INSTITUTO MEXICANO DEL SEGURO SOCIAL",
				"DIRECTOR GENERAL DEL ISSSTE",
				"DIRECTORA GENERAL DEL ISSSTE",
				"DIRECTOR GENERAL DE BANOBRAS",
				"DIRECTORA GENERAL DE BANOBRAS",
				"DIRECTOR GENERAL DE NAFIN",
				"DIRECTORA GENERAL DE NAFIN",
				"DIRECTOR GENERAL DE NACIONAL FINANCIERA",
				"DIRECTORA GENERAL DE NACIONAL FINANCIERA",
				"DIRECTOR GENERAL DE CONAGUA",
				"DIRECTORA GENERAL DE CONAGUA",
				"DIRECTOR GENERAL DE CONACYT",
				"DIRECTORA GENERAL DE CONACYT",
				"DIRECTOR GENERAL DE CONAHCYT",
				"DIRECTORA GENERAL DE CONAHCYT",
				"DIRECTOR GENERAL DEL INFONAVIT",
				"DIRECTORA GENERAL DEL INFONAVIT",
				"ADMINISTRADOR GENERAL DEL SAT",
				"ADMINISTRADORA GENERAL DEL SAT",
				"JEFATURA DEL SERVICIO DE ADMINISTRACION TRIBUTARIA",
				"DIRECTOR GENERAL DE AEROMEXICO",
				"DIRECTORA GENERAL DE AEROMEXICO",
				"DIRECTOR GENERAL DE MEXICANA DE AVIACION",
				"DIRECTORA GENERAL DE MEXICANA DE AVIACION",
			],
		},

		// -----------------------------------------------------------------
		// Partidos Politicos
		// -----------------------------------------------------------------
		{
			category: "Partidos Politicos",
			positions: [
				"PRESIDENTE DE PARTIDO POLITICO",
				"PRESIDENTA DE PARTIDO POLITICO",
				"PRESIDENTE NACIONAL",
				"PRESIDENTA NACIONAL",
				"SECRETARIO GENERAL DE PARTIDO POLITICO",
				"SECRETARIA GENERAL DE PARTIDO POLITICO",
				"PRESIDENTE DEL COMITE EJECUTIVO NACIONAL",
				"PRESIDENTA DEL COMITE EJECUTIVO NACIONAL",
				"DIRIGENTE NACIONAL",
				"PRESIDENTE DEL CONSEJO NACIONAL",
				"PRESIDENTA DEL CONSEJO NACIONAL",
				"COORDINADOR NACIONAL DE PARTIDO POLITICO",
				"COORDINADORA NACIONAL DE PARTIDO POLITICO",
			],
		},

		// -----------------------------------------------------------------
		// Organismos Internacionales (representantes mexicanos)
		// -----------------------------------------------------------------
		{
			category: "Organismos Internacionales",
			positions: [
				"REPRESENTANTE DE MEXICO ANTE ORGANISMOS INTERNACIONALES",
				"DIRECTOR EJECUTIVO DE ORGANISMO INTERNACIONAL",
				"DIRECTORA EJECUTIVA DE ORGANISMO INTERNACIONAL",
				"FUNCIONARIO INTERNACIONAL DE ALTO NIVEL",
			],
		},
	],
} as const;

// =============================================================================
// Tier 2 - Riesgo Medio (Medium Risk)
// Administrative leadership, mid-level officials, regional delegates,
// municipal department heads, oversight bodies, regulatory staff.
// =============================================================================

export const PEP_TIER_2: PepPositionTier = {
	tier: 2,
	label: "Riesgo Medio",
	riskLevel: "medium",
	description:
		"Directores generales, directores de area, coordinadores generales, " +
		"delegados, titulares de unidad, contralores internos y mandos medios " +
		"con autoridad significativa.",
	categories: [
		// -----------------------------------------------------------------
		// Mandos Superiores de la Administracion Publica
		// -----------------------------------------------------------------
		{
			category: "Mandos Superiores Administrativos",
			positions: [
				"DIRECTOR GENERAL",
				"DIRECTORA GENERAL",
				"DIRECTOR GENERAL ADJUNTO",
				"DIRECTORA GENERAL ADJUNTA",
				"DIRECTOR DE AREA",
				"DIRECTORA DE AREA",
				"DIRECTOR",
				"DIRECTORA",
				"TITULAR DE UNIDAD",
				"TITULAR DE ENTIDAD",
				"TITULAR DE ORGANO INTERNO DE CONTROL",
				"TITULAR DE ORGANO DE CONTROL",
				"TITULAR DEL ORGANO INTERNO DE CONTROL",
				"TITULAR",
				"COORDINADOR GENERAL",
				"COORDINADORA GENERAL",
				"COORDINADOR NACIONAL",
				"COORDINADORA NACIONAL",
				"COORDINADOR",
				"COORDINADORA",
				"COORDINADOR EJECUTIVO",
				"COORDINADORA EJECUTIVA",
				"CONTRALOR INTERNO",
				"CONTRALORA INTERNA",
				"CONTRALOR GENERAL",
				"CONTRALORA GENERAL",
				"OFICIAL MAYOR",
				"SECRETARIO TECNICO",
				"SECRETARIA TECNICA",
				"SECRETARIO EJECUTIVO",
				"SECRETARIA EJECUTIVA",
				"SECRETARIO PARTICULAR",
				"SECRETARIA PARTICULAR",
				"SECRETARIO ADMINISTRATIVO",
				"SECRETARIA ADMINISTRATIVA",
				"SECRETARIO PRIVADO",
				"SECRETARIA PRIVADA",
			],
		},

		// -----------------------------------------------------------------
		// Direcciones Especificas Comunes
		// -----------------------------------------------------------------
		{
			category: "Direcciones Especificas",
			positions: [
				"DIRECTOR DE ADMINISTRACION",
				"DIRECTORA DE ADMINISTRACION",
				"DIRECTOR DE FINANZAS",
				"DIRECTORA DE FINANZAS",
				"DIRECTOR DE PLANEACION",
				"DIRECTORA DE PLANEACION",
				"DIRECTOR DE RECURSOS HUMANOS",
				"DIRECTORA DE RECURSOS HUMANOS",
				"DIRECTOR DE RECURSOS MATERIALES",
				"DIRECTORA DE RECURSOS MATERIALES",
				"DIRECTOR DE RECURSOS FINANCIEROS",
				"DIRECTORA DE RECURSOS FINANCIEROS",
				"DIRECTOR JURIDICO",
				"DIRECTORA JURIDICA",
				"DIRECTOR DE ASUNTOS JURIDICOS",
				"DIRECTORA DE ASUNTOS JURIDICOS",
				"DIRECTOR DE COMUNICACION SOCIAL",
				"DIRECTORA DE COMUNICACION SOCIAL",
				"DIRECTOR DE TECNOLOGIAS DE LA INFORMACION",
				"DIRECTORA DE TECNOLOGIAS DE LA INFORMACION",
				"DIRECTOR DE OBRAS PUBLICAS",
				"DIRECTORA DE OBRAS PUBLICAS",
				"DIRECTOR DE SEGURIDAD PUBLICA",
				"DIRECTORA DE SEGURIDAD PUBLICA",
				"DIRECTOR DE DESARROLLO SOCIAL",
				"DIRECTORA DE DESARROLLO SOCIAL",
				"DIRECTOR DE DESARROLLO URBANO",
				"DIRECTORA DE DESARROLLO URBANO",
				"DIRECTOR DE DESARROLLO ECONOMICO",
				"DIRECTORA DE DESARROLLO ECONOMICO",
				"DIRECTOR DE SERVICIOS PUBLICOS",
				"DIRECTORA DE SERVICIOS PUBLICOS",
				"DIRECTOR DE MEDIO AMBIENTE",
				"DIRECTORA DE MEDIO AMBIENTE",
				"DIRECTOR DE EDUCACION",
				"DIRECTORA DE EDUCACION",
				"DIRECTOR DE SALUD",
				"DIRECTORA DE SALUD",
				"DIRECTOR DE CULTURA",
				"DIRECTORA DE CULTURA",
				"DIRECTOR DE DEPORTES",
				"DIRECTORA DE DEPORTES",
				"DIRECTOR DE PROTECCION CIVIL",
				"DIRECTORA DE PROTECCION CIVIL",
				"DIRECTOR DE TRANSITO",
				"DIRECTORA DE TRANSITO",
				"DIRECTOR DE CATASTRO",
				"DIRECTORA DE CATASTRO",
				"DIRECTOR DE INGRESOS",
				"DIRECTORA DE INGRESOS",
				"DIRECTOR DE EGRESOS",
				"DIRECTORA DE EGRESOS",
			],
		},

		// -----------------------------------------------------------------
		// Delegados y Representantes
		// -----------------------------------------------------------------
		{
			category: "Delegados y Representantes",
			positions: [
				"DELEGADO FEDERAL",
				"DELEGADA FEDERAL",
				"DELEGADO ESTATAL",
				"DELEGADA ESTATAL",
				"DELEGADO REGIONAL",
				"DELEGADA REGIONAL",
				"DELEGADO",
				"DELEGADA",
				"REPRESENTANTE",
				"REPRESENTANTE FEDERAL",
				"REPRESENTANTE ESTATAL",
				"SUPERDELEGADO",
				"SUPERDELEGADA",
				"COORDINADOR ESTATAL DE PROGRAMAS DE DESARROLLO",
				"COORDINADORA ESTATAL DE PROGRAMAS DE DESARROLLO",
			],
		},

		// -----------------------------------------------------------------
		// Vocales y Comisarios
		// -----------------------------------------------------------------
		{
			category: "Vocales y Comisarios",
			positions: [
				"VOCAL EJECUTIVO",
				"VOCAL EJECUTIVA",
				"VOCAL",
				"COMISARIO",
				"COMISARIA",
				"COMISARIO PUBLICO",
				"COMISARIA PUBLICA",
			],
		},

		// -----------------------------------------------------------------
		// Poder Judicial - Nivel Medio
		// -----------------------------------------------------------------
		{
			category: "Poder Judicial - Nivel Medio",
			positions: [
				"JUEZ DE PRIMERA INSTANCIA",
				"JUEZA DE PRIMERA INSTANCIA",
				"JUEZ DE CONTROL",
				"JUEZA DE CONTROL",
				"JUEZ PENAL",
				"JUEZA PENAL",
				"JUEZ CIVIL",
				"JUEZA CIVIL",
				"JUEZ FAMILIAR",
				"JUEZA FAMILIAR",
				"JUEZ LABORAL",
				"JUEZA LABORAL",
				"JUEZ MUNICIPAL",
				"JUEZA MUNICIPAL",
				"JUEZ CIVICO",
				"JUEZA CIVICA",
				"JUEZ CALIFICADOR",
				"JUEZA CALIFICADORA",
				"JUEZ DE EJECUCION",
				"JUEZA DE EJECUCION",
				"SECRETARIO DE ACUERDOS",
				"SECRETARIA DE ACUERDOS",
				"SECRETARIO DE ESTUDIO Y CUENTA",
				"SECRETARIA DE ESTUDIO Y CUENTA",
				"ACTUARIO JUDICIAL",
				"ACTUARIA JUDICIAL",
				"OFICIAL DEL REGISTRO CIVIL",
				"NOTARIO PUBLICO",
				"NOTARIA PUBLICA",
			],
		},

		// -----------------------------------------------------------------
		// Administracion de Justicia y Seguridad
		// -----------------------------------------------------------------
		{
			category: "Administracion de Justicia y Seguridad",
			positions: [
				"AGENTE DEL MINISTERIO PUBLICO",
				"MINISTERIO PUBLICO",
				"AGENTE DEL MINISTERIO PUBLICO FEDERAL",
				"AGENTE DEL MINISTERIO PUBLICO ESTATAL",
				"FISCAL DE DISTRITO",
				"FISCAL REGIONAL",
				"VISITADOR GENERAL",
				"VISITADORA GENERAL",
				"VISITADOR",
				"VISITADORA",
				"DEFENSOR PUBLICO",
				"DEFENSORA PUBLICA",
				"DEFENSOR DE OFICIO",
				"DEFENSORA DE OFICIO",
				"PERITO OFICIAL",
				"COMISIONADO DE POLICIA",
				"COMISIONADA DE POLICIA",
				"JEFE DE POLICIA",
				"JEFA DE POLICIA",
				"DIRECTOR DE POLICIA",
				"DIRECTORA DE POLICIA",
				"INSPECTOR GENERAL",
				"INSPECTORA GENERAL",
			],
		},

		// -----------------------------------------------------------------
		// Organismos Electorales - Nivel Medio
		// -----------------------------------------------------------------
		{
			category: "Organismos Electorales - Nivel Medio",
			positions: [
				"VOCAL EJECUTIVO DE JUNTA LOCAL DEL INE",
				"VOCAL EJECUTIVA DE JUNTA LOCAL DEL INE",
				"VOCAL EJECUTIVO DE JUNTA DISTRITAL DEL INE",
				"VOCAL EJECUTIVA DE JUNTA DISTRITAL DEL INE",
				"CONSEJERO ELECTORAL LOCAL",
				"CONSEJERA ELECTORAL LOCAL",
				"CONSEJERO ELECTORAL DISTRITAL",
				"CONSEJERA ELECTORAL DISTRITAL",
				"DIRECTOR EJECUTIVO DEL INE",
				"DIRECTORA EJECUTIVA DEL INE",
			],
		},

		// -----------------------------------------------------------------
		// Partidos Politicos - Nivel Estatal
		// -----------------------------------------------------------------
		{
			category: "Partidos Politicos - Nivel Estatal",
			positions: [
				"PRESIDENTE ESTATAL DE PARTIDO POLITICO",
				"PRESIDENTA ESTATAL DE PARTIDO POLITICO",
				"DIRIGENTE ESTATAL",
				"SECRETARIO GENERAL ESTATAL DE PARTIDO POLITICO",
				"SECRETARIA GENERAL ESTATAL DE PARTIDO POLITICO",
				"DELEGADO DE PARTIDO POLITICO",
				"DELEGADA DE PARTIDO POLITICO",
			],
		},

		// -----------------------------------------------------------------
		// Administradores del SAT
		// -----------------------------------------------------------------
		{
			category: "Servicio de Administracion Tributaria",
			positions: [
				"ADMINISTRADOR GENERAL DE AUDITORIA FISCAL FEDERAL",
				"ADMINISTRADORA GENERAL DE AUDITORIA FISCAL FEDERAL",
				"ADMINISTRADOR GENERAL DE RECAUDACION",
				"ADMINISTRADORA GENERAL DE RECAUDACION",
				"ADMINISTRADOR GENERAL DE ADUANAS",
				"ADMINISTRADORA GENERAL DE ADUANAS",
				"ADMINISTRADOR GENERAL JURIDICO",
				"ADMINISTRADORA GENERAL JURIDICA",
				"ADMINISTRADOR CENTRAL",
				"ADMINISTRADORA CENTRAL",
				"ADMINISTRADOR LOCAL",
				"ADMINISTRADORA LOCAL",
				"ADMINISTRADOR DESCONCENTRADO",
				"ADMINISTRADORA DESCONCENTRADA",
				"ADMINISTRADOR DE ADUANA",
				"ADMINISTRADORA DE ADUANA",
			],
		},

		// -----------------------------------------------------------------
		// Asesores de Alto Nivel
		// -----------------------------------------------------------------
		{
			category: "Asesores de Alto Nivel",
			positions: [
				"ASESOR",
				"ASESORA",
				"ASESOR DEL PRESIDENTE",
				"ASESORA DEL PRESIDENTE",
				"ASESOR DEL GOBERNADOR",
				"ASESORA DEL GOBERNADOR",
				"ASESOR DEL SECRETARIO",
				"ASESORA DEL SECRETARIO",
				"CONSULTOR POLITICO",
				"CONSULTORA POLITICA",
			],
		},

		// -----------------------------------------------------------------
		// Servicio Exterior - Nivel Medio
		// -----------------------------------------------------------------
		{
			category: "Servicio Exterior - Nivel Medio",
			positions: [
				"CONSUL",
				"MINISTRO DE EMBAJADA",
				"MINISTRA DE EMBAJADA",
				"CONSEJERO DE EMBAJADA",
				"CONSEJERA DE EMBAJADA",
				"AGREGADO MILITAR",
				"AGREGADA MILITAR",
				"AGREGADO CULTURAL",
				"AGREGADA CULTURAL",
				"AGREGADO COMERCIAL",
				"AGREGADA COMERCIAL",
			],
		},
	],
} as const;

// =============================================================================
// Tier 3 - Riesgo Operativo (Operational Risk)
// Operational positions with access to public resources, decision-making
// at department level, or proximity to higher-tier PEPs.
// =============================================================================

export const PEP_TIER_3: PepPositionTier = {
	tier: 3,
	label: "Riesgo Operativo",
	riskLevel: "low",
	description:
		"Subdirectores, jefes de departamento, jefes de area, coordinadores " +
		"operativos y personal con acceso a recursos publicos o toma de decisiones " +
		"a nivel operativo.",
	categories: [
		// -----------------------------------------------------------------
		// Subdirecciones
		// -----------------------------------------------------------------
		{
			category: "Subdirecciones",
			positions: [
				"SUBDIRECTOR",
				"SUBDIRECTORA",
				"SUBDIRECTOR DE AREA",
				"SUBDIRECTORA DE AREA",
				"SUBDIRECTOR GENERAL",
				"SUBDIRECTORA GENERAL",
				"SUBDIRECTOR DE ADMINISTRACION",
				"SUBDIRECTORA DE ADMINISTRACION",
				"SUBDIRECTOR DE FINANZAS",
				"SUBDIRECTORA DE FINANZAS",
				"SUBDIRECTOR DE PLANEACION",
				"SUBDIRECTORA DE PLANEACION",
				"SUBDIRECTOR DE RECURSOS HUMANOS",
				"SUBDIRECTORA DE RECURSOS HUMANOS",
				"SUBDIRECTOR JURIDICO",
				"SUBDIRECTORA JURIDICA",
				"SUBDIRECTOR DE OPERACIONES",
				"SUBDIRECTORA DE OPERACIONES",
				"SUBDIRECTOR DE SISTEMAS",
				"SUBDIRECTORA DE SISTEMAS",
				"SUBDIRECTOR DE TECNOLOGIAS",
				"SUBDIRECTORA DE TECNOLOGIAS",
				"SUBDIRECTOR TECNICO",
				"SUBDIRECTORA TECNICA",
			],
		},

		// -----------------------------------------------------------------
		// Jefaturas de Departamento
		// -----------------------------------------------------------------
		{
			category: "Jefaturas de Departamento",
			positions: [
				"JEFE DE DEPARTAMENTO",
				"JEFA DE DEPARTAMENTO",
				"JEFE DE UNIDAD",
				"JEFA DE UNIDAD",
				"JEFE DE UNIDAD DEPARTAMENTAL",
				"JEFA DE UNIDAD DEPARTAMENTAL",
				"JEFE DE SECCION",
				"JEFA DE SECCION",
				"JEFE DE DEPARTAMENTO DE RECURSOS HUMANOS",
				"JEFA DE DEPARTAMENTO DE RECURSOS HUMANOS",
				"JEFE DE DEPARTAMENTO DE ADQUISICIONES",
				"JEFA DE DEPARTAMENTO DE ADQUISICIONES",
				"JEFE DE DEPARTAMENTO DE CONTABILIDAD",
				"JEFA DE DEPARTAMENTO DE CONTABILIDAD",
				"JEFE DE DEPARTAMENTO DE PRESUPUESTO",
				"JEFA DE DEPARTAMENTO DE PRESUPUESTO",
				"JEFE DE DEPARTAMENTO DE OBRA PUBLICA",
				"JEFA DE DEPARTAMENTO DE OBRA PUBLICA",
				"JEFE DE DEPARTAMENTO JURIDICO",
				"JEFA DE DEPARTAMENTO JURIDICO",
				"JEFE DE DEPARTAMENTO DE INFORMATICA",
				"JEFA DE DEPARTAMENTO DE INFORMATICA",
			],
		},

		// -----------------------------------------------------------------
		// Jefaturas de Area
		// -----------------------------------------------------------------
		{
			category: "Jefaturas de Area",
			positions: [
				"JEFE DE AREA",
				"JEFA DE AREA",
				"JEFE DE OFICINA",
				"JEFA DE OFICINA",
				"RESPONSABLE DE AREA",
				"RESPONSABLE DE DEPARTAMENTO",
				"RESPONSABLE DE OFICINA",
				"RESPONSABLE DE PROGRAMA",
				"RESPONSABLE",
				"ENCARGADO DE AREA",
				"ENCARGADA DE AREA",
				"ENCARGADO DE DESPACHO",
				"ENCARGADA DE DESPACHO",
				"ENCARGADO DE DIRECCION",
				"ENCARGADA DE DIRECCION",
			],
		},

		// -----------------------------------------------------------------
		// Coordinaciones Operativas
		// -----------------------------------------------------------------
		{
			category: "Coordinaciones Operativas",
			positions: [
				"COORDINADOR DE AREA",
				"COORDINADORA DE AREA",
				"COORDINADOR DE PROYECTOS",
				"COORDINADORA DE PROYECTOS",
				"COORDINADOR DE PROGRAMAS",
				"COORDINADORA DE PROGRAMAS",
				"COORDINADOR ADMINISTRATIVO",
				"COORDINADORA ADMINISTRATIVA",
				"COORDINADOR OPERATIVO",
				"COORDINADORA OPERATIVA",
				"COORDINADOR TECNICO",
				"COORDINADORA TECNICA",
				"COORDINADOR DE ZONA",
				"COORDINADORA DE ZONA",
				"COORDINADOR DE REGION",
				"COORDINADORA DE REGION",
				"COORDINADOR JURIDICO",
				"COORDINADORA JURIDICA",
			],
		},

		// -----------------------------------------------------------------
		// Personal de Fiscalizacion y Control
		// -----------------------------------------------------------------
		{
			category: "Fiscalizacion y Control",
			positions: [
				"AUDITOR",
				"AUDITORA",
				"AUDITOR SENIOR",
				"AUDITORA SENIOR",
				"AUDITOR INTERNO",
				"AUDITORA INTERNA",
				"AUDITOR EXTERNO",
				"AUDITORA EXTERNA",
				"AUDITOR GUBERNAMENTAL",
				"AUDITORA GUBERNAMENTAL",
				"INSPECTOR",
				"INSPECTORA",
				"INSPECTOR FISCAL",
				"INSPECTORA FISCAL",
				"INSPECTOR DE ADUANAS",
				"INSPECTORA DE ADUANAS",
				"VERIFICADOR",
				"VERIFICADORA",
				"SUPERVISOR",
				"SUPERVISORA",
				"SUPERVISOR DE OBRA",
				"SUPERVISORA DE OBRA",
				"SUPERVISOR DE AUDITORIAS",
				"SUPERVISORA DE AUDITORIAS",
			],
		},

		// -----------------------------------------------------------------
		// Enlaces y Analistas
		// -----------------------------------------------------------------
		{
			category: "Enlaces y Analistas",
			positions: [
				"ENLACE",
				"ENLACE ADMINISTRATIVO",
				"ENLACE LEGISLATIVO",
				"ENLACE DE ALTO NIVEL",
				"ANALISTA",
				"ANALISTA SENIOR",
				"ANALISTA ESPECIALIZADO",
				"ANALISTA DE PROYECTOS",
				"EJECUTIVO DE PROYECTOS",
				"EJECUTIVA DE PROYECTOS",
				"LIDER DE PROYECTO",
				"ESPECIALISTA",
				"ESPECIALISTA TECNICO",
				"ESPECIALISTA TECNICA",
			],
		},

		// -----------------------------------------------------------------
		// Personal de Adquisiciones y Licitaciones
		// -----------------------------------------------------------------
		{
			category: "Adquisiciones y Licitaciones",
			positions: [
				"JEFE DE ADQUISICIONES",
				"JEFA DE ADQUISICIONES",
				"JEFE DE LICITACIONES",
				"JEFA DE LICITACIONES",
				"RESPONSABLE DE ADQUISICIONES",
				"RESPONSABLE DE LICITACIONES",
				"RESPONSABLE DE COMPRAS",
				"RESPONSABLE DE CONTRATOS",
				"ENCARGADO DE ADQUISICIONES",
				"ENCARGADA DE ADQUISICIONES",
			],
		},

		// -----------------------------------------------------------------
		// Personal Municipal Operativo
		// -----------------------------------------------------------------
		{
			category: "Municipal Operativo",
			positions: [
				"DIRECTOR DE AREA MUNICIPAL",
				"DIRECTORA DE AREA MUNICIPAL",
				"JEFE DE DEPARTAMENTO MUNICIPAL",
				"JEFA DE DEPARTAMENTO MUNICIPAL",
				"SECRETARIO TECNICO MUNICIPAL",
				"SECRETARIA TECNICA MUNICIPAL",
				"COORDINADOR MUNICIPAL",
				"COORDINADORA MUNICIPAL",
				"JEFE DE TENENCIA",
				"JEFA DE TENENCIA",
				"DELEGADO MUNICIPAL",
				"DELEGADA MUNICIPAL",
			],
		},
	],
} as const;

// =============================================================================
// All tiers combined
// =============================================================================

export const PEP_POSITION_TIERS: readonly PepPositionTier[] = [
	PEP_TIER_1,
	PEP_TIER_2,
	PEP_TIER_3,
] as const;

// =============================================================================
// Flat lookup sets for fast matching
// =============================================================================

function extractPositions(tier: PepPositionTier): ReadonlySet<string> {
	const positions = new Set<string>();
	for (const category of tier.categories) {
		for (const position of category.positions) {
			positions.add(position);
		}
	}
	return positions;
}

/** All Tier 1 (high risk) positions */
export const PEP_TIER_1_POSITIONS: ReadonlySet<string> =
	extractPositions(PEP_TIER_1);

/** All Tier 2 (medium risk) positions */
export const PEP_TIER_2_POSITIONS: ReadonlySet<string> =
	extractPositions(PEP_TIER_2);

/** All Tier 3 (operational risk) positions */
export const PEP_TIER_3_POSITIONS: ReadonlySet<string> =
	extractPositions(PEP_TIER_3);

/** All PEP positions across all tiers */
export const ALL_PEP_POSITIONS: ReadonlySet<string> = new Set([
	...PEP_TIER_1_POSITIONS,
	...PEP_TIER_2_POSITIONS,
	...PEP_TIER_3_POSITIONS,
]);

// =============================================================================
// Utility: Normalize position string for matching
// =============================================================================

/**
 * Normalize a position string for matching:
 * - Uppercase
 * - Remove accents/diacritics
 * - Collapse multiple spaces
 * - Trim
 */
export function normalizePosition(raw: string): string {
	return raw
		.toUpperCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

// =============================================================================
// Utility: Classify a position string into a PEP tier
// =============================================================================

/**
 * Classify a raw position string into a PEP tier.
 *
 * Matching strategy (in order):
 * 1. Exact match against normalized position sets
 * 2. Check if any dictionary position is contained in the input
 * 3. Check if the input is contained in any dictionary position
 *
 * Returns the highest-risk (lowest tier number) match found, or null.
 */
export function classifyPepPosition(rawPosition: string): PepTierResult | null {
	const normalized = normalizePosition(rawPosition);

	if (!normalized) return null;

	// Try each tier in order (highest risk first)
	const tiers: Array<{
		tier: 1 | 2 | 3;
		riskLevel: string;
		positions: ReadonlySet<string>;
	}> = [
		{ tier: 1, riskLevel: "high", positions: PEP_TIER_1_POSITIONS },
		{ tier: 2, riskLevel: "medium", positions: PEP_TIER_2_POSITIONS },
		{ tier: 3, riskLevel: "low", positions: PEP_TIER_3_POSITIONS },
	];

	for (const { tier, riskLevel, positions } of tiers) {
		// Strategy 1: Exact match
		if (positions.has(normalized)) {
			return { tier, riskLevel, matchedPosition: normalized };
		}

		// Strategy 2: Dictionary position contained in input
		// (e.g., input "SECRETARIO DE GOBERNACION DEL ESTADO DE JALISCO"
		//  matches "SECRETARIO DE GOBERNACION")
		for (const position of positions) {
			if (normalized.includes(position)) {
				return { tier, riskLevel, matchedPosition: position };
			}
		}

		// Strategy 3: Input contained in dictionary position
		// (e.g., input "GOBERNADOR" matches "GOBERNADOR DEL ESTADO")
		if (normalized.length >= 4) {
			for (const position of positions) {
				if (position.includes(normalized)) {
					return { tier, riskLevel, matchedPosition: position };
				}
			}
		}
	}

	return null;
}

/**
 * Check whether a position string matches any PEP position at any tier.
 */
export function isPepPosition(rawPosition: string): boolean {
	return classifyPepPosition(rawPosition) !== null;
}

/**
 * Get total count of positions per tier.
 */
export function getPepPositionStats(): {
	tier1: number;
	tier2: number;
	tier3: number;
	total: number;
} {
	return {
		tier1: PEP_TIER_1_POSITIONS.size,
		tier2: PEP_TIER_2_POSITIONS.size,
		tier3: PEP_TIER_3_POSITIONS.size,
		total: ALL_PEP_POSITIONS.size,
	};
}
