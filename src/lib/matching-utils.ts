/**
 * Matching utilities for hybrid watchlist search
 * Provides normalization, Jaro-Winkler similarity, and hybrid scoring
 */

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
 * Find the best name score by comparing query against name and all aliases
 * Uses Jaro-Winkler similarity with normalized strings
 * Includes token-sorted comparison to handle name reordering (e.g., "Joaquin GUZMAN" vs "GUZMAN Joaquin")
 *
 * @param query - Search query name
 * @param name - Primary name
 * @param aliases - Array of alias names
 * @returns Maximum Jaro-Winkler score found (0-1)
 */
export function bestNameScore(
	query: string,
	name: string,
	aliases: string[] | null,
): number {
	const normalizedQuery = normalizeName(query);
	const normalizedName = normalizeName(name);

	// Full-string Jaro-Winkler
	let maxScore = jaroWinkler(normalizedQuery, normalizedName);

	// Token-sorted Jaro-Winkler (handles name reordering)
	const sortedQuery = normalizedQuery.split(" ").sort().join(" ");
	const sortedName = normalizedName.split(" ").sort().join(" ");
	const tokenSortedScore = jaroWinkler(sortedQuery, sortedName);
	maxScore = Math.max(maxScore, tokenSortedScore);

	if (aliases && aliases.length > 0) {
		for (const alias of aliases) {
			const normalizedAlias = normalizeName(alias);
			const fullScore = jaroWinkler(normalizedQuery, normalizedAlias);
			const sortedAlias = normalizedAlias.split(" ").sort().join(" ");
			const tokenScore = jaroWinkler(sortedQuery, sortedAlias);
			maxScore = Math.max(maxScore, fullScore, tokenScore);
		}
	}

	return maxScore;
}

/**
 * Compute metadata score based on birthDate and countries match
 * BirthDate match contributes 0.5, countries overlap contributes 0.5
 *
 * @param queryBirthDate - Query birth date (ISO string)
 * @param queryCountries - Query countries array
 * @param recordBirthDate - Record birth date (ISO string)
 * @param recordCountries - Record countries array
 * @returns Meta score between 0 and 1
 */
export function computeMetaScore(
	queryBirthDate: string | null | undefined,
	queryCountries: string[] | null | undefined,
	recordBirthDate: string | null | undefined,
	recordCountries: string[] | null | undefined,
): number {
	let score = 0;

	// BirthDate match: 0.5 if matches
	if (queryBirthDate && recordBirthDate && queryBirthDate === recordBirthDate) {
		score += 0.5;
	}

	// Countries overlap: 0.5 if any overlap
	if (
		queryCountries &&
		queryCountries.length > 0 &&
		recordCountries &&
		recordCountries.length > 0
	) {
		const querySet = new Set(queryCountries.map((c) => c.toUpperCase().trim()));
		const hasOverlap = recordCountries.some((c) =>
			querySet.has(c.toUpperCase().trim()),
		);
		if (hasOverlap) {
			score += 0.5;
		}
	}

	return score;
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
