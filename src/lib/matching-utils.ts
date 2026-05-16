/**
 * Matching utilities for hybrid watchlist search
 * Provides normalization, Jaro-Winkler similarity, and hybrid scoring
 */

/** Minimum discriminative token-set score; below this we cap name score to reduce false positives from generic-term-only overlap. Set to 0.7 so capped scores stay below default search threshold (0.875). */
const DISCRIMINATIVE_MIN = 0.7;

/** Per-token Jaro–Winkler below this for a discriminative query token triggers a score cap. */
const WEAKEST_LINK_FLOOR = 0.85;

/**
 * Generic entity terms (Spanish/Mexican company name boilerplate).
 * When name similarity is driven only by these tokens, we cap the score
 * so that e.g. "INMOBILIARIA MORALES" does not match "INMOBILIARIA EL ESCORPION DEL NORTE".
 */
const ENTITY_GENERIC_TERMS = new Set<string>([
	// Legal / structural
	"SA",
	"DE",
	"CV",
	"CO",
	"SAPI",
	"SAB",
	"SC",
	"SNC",
	"SOFOM",
	"ENR",
	"SRL",
	"INC",
	"LLC",
	"LTD",
	"NA",
	// Common business words
	"INMOBILIARIA",
	"SOCIEDAD",
	"COMERCIAL",
	"CASA",
	"GRUPO",
	"CORPORACION",
	"CONSTRUCTORA",
	"DISTRIBUIDORA",
	"OPERADORA",
	"ADMINISTRADORA",
	"INVERSIONES",
	"SERVICIOS",
	"SOLUCIONES",
	"Y",
	"LA",
	"LOS",
	"LAS",
	"EL",
	"DEL",
	"AL",
	"A",
]);

/**
 * Normalize an identifier for exact matching
 * Converts to uppercase and strips all non-alphanumeric characters
 *
 * @example
 * normalizeIdentifier("HEMA-621127") => "HEMA621127"
 * normalizeIdentifier("B 960789") => "B960789"
 * normalizeIdentifier("800113437-2") => "8001134372"
 */
export function normalizeIdentifier(raw: string): string {
	return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Normalize an identifier type
 * Strips dots, hyphens, #, whitespace, and converts to uppercase
 *
 * @example
 * normalizeIdentifierType("R.F.C.") => "RFC"
 * normalizeIdentifierType("NIT #") => "NIT"
 * normalizeIdentifierType("Cedula No.") => "CEDULANO"
 */
export function normalizeIdentifierType(type: string): string {
	return type
		.replace(/[.\-#\s]/g, "")
		.toUpperCase()
		.trim();
}

/**
 * Normalize country code for comparison (2–3 letter codes)
 */
function normalizeCountryForMeta(code: string): string {
	return code.toUpperCase().trim();
}

/**
 * OFAC record countries from identifiers and trailing country hints in address lines
 */
export function extractOfacRecordCountries(target: {
	identifiers: Array<{ country?: string }> | null;
	addresses: string[] | null;
}): string[] {
	const out: string[] = [];
	if (target.identifiers) {
		for (const id of target.identifiers) {
			if (id.country && id.country.trim()) {
				out.push(normalizeCountryForMeta(id.country));
			}
		}
	}
	if (target.addresses) {
		for (const line of target.addresses) {
			if (!line) continue;
			// e.g. "...MEXICO" or ", MX" at end
			const parts = line.split(",").map((s) => s.trim());
			const last = parts[parts.length - 1];
			if (last && /^[A-Z]{2,3}$/i.test(last)) {
				out.push(last.toUpperCase());
			}
		}
	}
	return [...new Set(out.filter(Boolean))];
}

/**
 * UNSC nationalities as normalized country list
 */
export function extractUnscRecordCountries(
	nationalities: string[] | null | undefined,
): string[] {
	if (!nationalities || nationalities.length === 0) return [];
	return [
		...new Set(nationalities.map((c) => normalizeCountryForMeta(c))),
	].filter((c) => c.length > 0);
}

/**
 * Parse birth date (YYYY-MM-DD) from a 13-char natural-person Mexican RFC, else null.
 * 12-char RFC = legal entity; no date segment for comparison here.
 * SAT pivot: YY 00-29 => 20YY, 30-99 => 19YY
 */
export function parseRfcBirthDate(rfc: string): string | null {
	const r = rfc.replace(/\s+/g, "").toUpperCase();
	if (r.length !== 13) return null;
	const yymmdd = r.slice(4, 10);
	if (!/^\d{6}$/.test(yymmdd)) return null;
	const yy = yymmdd.slice(0, 2);
	const mm = yymmdd.slice(2, 4);
	const dd = yymmdd.slice(4, 6);
	const nYy = Number.parseInt(yy, 10);
	if (nYy < 0 || nYy > 99) return null;
	const year = nYy <= 29 ? 2000 + nYy : 1900 + nYy;
	const iso = `${String(year).padStart(4, "0")}-${mm}-${dd}`;
	const d = new Date(`${iso}T00:00:00Z`);
	if (Number.isNaN(d.getTime())) return null;
	if (d.toISOString().slice(0, 10) !== iso) return null;
	return iso;
}

/**
 * Normalize a name for similarity comparison
 * Converts to uppercase, decomposes diacritics, strips combining marks,
 * removes punctuation, and collapses whitespace
 *
 * @example
 * normalizeName("José García") => "JOSE GARCIA"
 * normalizeName("María  González-Fernández") => "MARIA GONZALEZ FERNANDEZ"
 */
export function normalizeName(name: string): string {
	return name
		.normalize("NFD") // Decompose diacritics (é => e + ́)
		.replace(/[\u0300-\u036f]/g, "") // Strip combining marks
		.toUpperCase()
		.replace(/[^\w\s]/g, " ") // Replace punctuation with space
		.replace(/\s+/g, " ") // Collapse multiple spaces
		.trim();
}

/**
 * Calculate Jaro-Winkler similarity between two strings
 * Returns a score between 0 (completely different) and 1 (identical)
 *
 * @param s1 - First string
 * @param s2 - Second string
 * @param prefixScale - Weight for common prefix (default: 0.1)
 * @returns Similarity score between 0 and 1
 */
export function jaroWinkler(s1: string, s2: string, prefixScale = 0.1): number {
	if (s1 === s2) return 1.0;
	if (s1.length === 0 && s2.length === 0) return 1.0;
	if (s1.length === 0 || s2.length === 0) return 0.0;

	const len1 = s1.length;
	const len2 = s2.length;

	// Match window: max(len1, len2) / 2 - 1
	const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
	if (matchWindow < 0) return 0.0;

	const s1Matches = new Array(len1).fill(false);
	const s2Matches = new Array(len2).fill(false);

	let matches = 0;
	let transpositions = 0;

	// Identify matches
	for (let i = 0; i < len1; i++) {
		const start = Math.max(0, i - matchWindow);
		const end = Math.min(i + matchWindow + 1, len2);

		for (let j = start; j < end; j++) {
			if (s2Matches[j] || s1[i] !== s2[j]) continue;
			s1Matches[i] = true;
			s2Matches[j] = true;
			matches++;
			break;
		}
	}

	if (matches === 0) return 0.0;

	// Count transpositions
	let k = 0;
	for (let i = 0; i < len1; i++) {
		if (!s1Matches[i]) continue;
		while (!s2Matches[k]) k++;
		if (s1[i] !== s2[k]) transpositions++;
		k++;
	}

	// Calculate Jaro similarity
	const jaro =
		(matches / len1 +
			matches / len2 +
			(matches - transpositions / 2) / matches) /
		3;

	// Calculate common prefix (up to 4 characters)
	let prefix = 0;
	for (let i = 0; i < Math.min(len1, len2, 4); i++) {
		if (s1[i] === s2[i]) prefix++;
		else break;
	}

	// Calculate Jaro-Winkler
	return jaro + prefix * prefixScale * (1 - jaro);
}

/**
 * Multiplier when the worst discriminative query token match is below WEAKEST_LINK_FLOOR
 */
function weakestLinkMultiplier(
	queryTokens: string[],
	targetTokens: string[],
): number {
	const discriminative = queryTokens.filter(
		(t) => !ENTITY_GENERIC_TERMS.has(t),
	);
	if (discriminative.length === 0) return 1.0;

	let worst = 1.0;
	for (const qt of discriminative) {
		let best = 0;
		for (const tt of targetTokens) {
			best = Math.max(best, jaroWinkler(qt, tt));
		}
		worst = Math.min(worst, best);
	}

	if (worst >= WEAKEST_LINK_FLOOR) return 1.0;
	return Math.min(1, worst + 0.15);
}

/**
 * Compute token-set similarity: measures how well query tokens are covered
 * by the target name. Resilient to extra tokens in the target (e.g., middle names)
 * and token reordering.
 *
 * For each query token, finds the best Jaro-Winkler match among target tokens.
 * Discriminative query tokens use a "weakest link" cap so a wrong surname
 * (e.g. PEREZ vs no such token) cannot be averaged away.
 */
function tokenSetScore(queryTokens: string[], targetTokens: string[]): number {
	if (queryTokens.length === 0 || targetTokens.length === 0) return 0;

	let totalScore = 0;
	for (const qt of queryTokens) {
		let bestMatch = 0;
		for (const tt of targetTokens) {
			bestMatch = Math.max(bestMatch, jaroWinkler(qt, tt));
		}
		totalScore += bestMatch;
	}

	const queryCoverage = totalScore / queryTokens.length;

	// Penalize slightly when query has fewer tokens than target (partial name search)
	// but don't penalize too much — searching "JOAQUIN GUZMAN" should still match well
	const lengthRatio = Math.min(queryTokens.length / targetTokens.length, 1.0);
	const lengthPenalty = 0.8 + 0.2 * lengthRatio;

	const wlm = weakestLinkMultiplier(queryTokens, targetTokens);
	return queryCoverage * lengthPenalty * wlm;
}

/**
 * Token-set score using only discriminative query tokens (excludes ENTITY_GENERIC_TERMS).
 * If the query has no discriminative tokens, falls back to full token-set score.
 */
function tokenSetScoreDiscriminative(
	queryTokens: string[],
	targetTokens: string[],
	genericSet: Set<string>,
): number {
	const discriminativeQuery = queryTokens.filter((t) => !genericSet.has(t));
	if (discriminativeQuery.length === 0) {
		return tokenSetScore(queryTokens, targetTokens);
	}
	return tokenSetScore(discriminativeQuery, targetTokens);
}

/**
 * Find the best name score by comparing query against name and all aliases.
 * Uses three strategies and picks the maximum:
 *   1. Full-string Jaro-Winkler (good for exact/near-exact matches)
 *   2. Token-sorted Jaro-Winkler (handles name reordering; prefix scale 0 — sorted order is not natural prefix)
 *   3. Token-set coverage (handles missing middle names and extra tokens)
 *
 * When the query has discriminative tokens (non-generic), the score is capped
 * by the discriminative token-set score so that matches driven only by
 * generic terms (e.g. INMOBILIARIA) do not exceed the threshold.
 *
 * @param query - Search query name
 * @param name - Primary name
 * @param aliases - Array of alias names
 * @returns Maximum score found (0-1)
 */
export function bestNameScore(
	query: string,
	name: string,
	aliases: string[] | null,
): number {
	const normalizedQuery = normalizeName(query);
	const normalizedName = normalizeName(name);

	const queryTokens = normalizedQuery.split(" ").filter((t) => t.length > 0);
	const nameTokens = normalizedName.split(" ").filter((t) => t.length > 0);

	const discriminativeQueryTokens = queryTokens.filter(
		(t) => !ENTITY_GENERIC_TERMS.has(t),
	);

	// Strategy 1: Full-string Jaro-Winkler
	let maxScore = jaroWinkler(normalizedQuery, normalizedName);
	let bestTokens = nameTokens;

	// Strategy 2: Token-sorted Jaro-Winkler (handles reordering; no prefix bonus on sorted strings)
	const sortedQuery = [...queryTokens].sort().join(" ");
	const sortedName = [...nameTokens].sort().join(" ");
	const score2 = jaroWinkler(sortedQuery, sortedName, 0);
	if (score2 > maxScore) {
		maxScore = score2;
		bestTokens = nameTokens;
	}

	// Strategy 3: Token-set coverage (handles extra/missing tokens like middle names)
	const score3 = tokenSetScore(queryTokens, nameTokens);
	if (score3 > maxScore) {
		maxScore = score3;
		bestTokens = nameTokens;
	}

	if (aliases && aliases.length > 0) {
		for (const alias of aliases) {
			const normalizedAlias = normalizeName(alias);
			const aliasTokens = normalizedAlias
				.split(" ")
				.filter((t) => t.length > 0);

			const aliasFull = jaroWinkler(normalizedQuery, normalizedAlias);
			const aliasSorted = jaroWinkler(
				sortedQuery,
				[...aliasTokens].sort().join(" "),
				0,
			);
			const aliasSet = tokenSetScore(queryTokens, aliasTokens);
			const aliasMax = Math.max(aliasFull, aliasSorted, aliasSet);
			if (aliasMax > maxScore) {
				maxScore = aliasMax;
				bestTokens = aliasTokens;
			}
		}
	}

	// Cap by discriminative score when overlap is only from generic terms
	if (discriminativeQueryTokens.length > 0) {
		const discriminativeScore = tokenSetScoreDiscriminative(
			queryTokens,
			bestTokens,
			ENTITY_GENERIC_TERMS,
		);
		if (discriminativeScore < DISCRIMINATIVE_MIN) {
			return Math.min(maxScore, discriminativeScore);
		}
	}

	return maxScore;
}

/**
 * Result of metadata comparison: reward matches and report hard mismatches
 */
export interface MetaSignal {
	score: number;
	/** true when both sides have comparable data and they conflict */
	mismatch: boolean;
}

/**
 * Compute metadata signal from birth date and country overlap
 */
export function computeMetaSignal(
	queryBirthDate: string | null | undefined,
	queryCountries: string[] | null | undefined,
	recordBirthDate: string | null | undefined,
	recordCountries: string[] | null | undefined,
): MetaSignal {
	let score = 0;
	let mismatch = false;

	if (queryBirthDate && recordBirthDate) {
		if (queryBirthDate === recordBirthDate) {
			score += 0.5;
		} else {
			// Definitive different person: do not reward partial country overlap
			return { score: 0, mismatch: true };
		}
	}

	if (
		queryCountries &&
		queryCountries.length > 0 &&
		recordCountries &&
		recordCountries.length > 0
	) {
		const querySet = new Set(
			queryCountries.map((c) => normalizeCountryForMeta(c)),
		);
		const hasOverlap = recordCountries.some((c) =>
			querySet.has(normalizeCountryForMeta(c)),
		);
		if (hasOverlap) {
			score += 0.5;
		} else {
			mismatch = true;
		}
	}

	return { score, mismatch };
}

/**
 * @deprecated use computeMetaSignal; kept for call sites that need score only
 */
export function computeMetaScore(
	queryBirthDate: string | null | undefined,
	queryCountries: string[] | null | undefined,
	recordBirthDate: string | null | undefined,
	recordCountries: string[] | null | undefined,
): number {
	return computeMetaSignal(
		queryBirthDate,
		queryCountries,
		recordBirthDate,
		recordCountries,
	).score;
}

/**
 * Compute hybrid score from vector, name, and meta scores
 * Formula: 0.35 * vectorScore + 0.55 * nameScore + 0.10 * metaScore
 *
 * Name score is the primary signal (55%), aligned with industry best practices
 * where name matching has the highest weight in sanctions screening.
 * Vector score provides semantic recall (35%) for name variations.
 * Metadata score provides additional confidence boost (10%).
 *
 * @param vectorScore - Cosine similarity from Vectorize (0-1)
 * @param nameScore - Jaro-Winkler name similarity (0-1)
 * @param metaScore - Metadata match score (0-1)
 * @returns Hybrid score between 0 and 1
 */
export function computeHybridScore(
	vectorScore: number,
	nameScore: number,
	metaScore: number,
): number {
	return 0.35 * vectorScore + 0.55 * nameScore + 0.1 * metaScore;
}

/** Minimum name score to allow "override" when hybrid is below threshold (exact/near-exact name matches). */
const NAME_OVERRIDE_MIN_NAME = 0.9;
/** Minimum hybrid score when using name override (avoid pure-name matches with no semantic support). */
const NAME_OVERRIDE_MIN_HYBRID = 0.7;

export type PassesMatchFilterOpts = {
	/** true when identifier matched or metadata contributed positively */
	corroborated: boolean;
	/** true when DOB or country proves a different person */
	mismatch: boolean;
};

/**
 * Returns true if a candidate should be shown as a match given the hybrid score, name score, and threshold.
 * Mismatch always rejects. Otherwise: hybrid >= threshold, or name-override with corroboration.
 */
export function passesMatchFilter(
	hybridScore: number,
	nameScore: number,
	threshold: number,
	opts: PassesMatchFilterOpts,
): boolean {
	if (opts.mismatch) return false;
	if (hybridScore >= threshold) return true;
	return (
		nameScore >= NAME_OVERRIDE_MIN_NAME &&
		hybridScore >= NAME_OVERRIDE_MIN_HYBRID &&
		opts.corroborated
	);
}
