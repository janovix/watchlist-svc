/**
 * Canonical source values for SearchQuery. Used when creating queries
 * so the list API and UI can display consistent origin labels.
 */
export const QUERY_SOURCE = {
	WATCHLIST_QUERY: "watchlist_query",
	AML: "aml",
	CSV_IMPORT: "csv_import",
	API: "api",
} as const;

export type QuerySourceValue = (typeof QUERY_SOURCE)[keyof typeof QUERY_SOURCE];

/**
 * Normalize an incoming source (e.g. from aml-svc) to canonical "aml".
 */
export function normalizeAmlSource(source: string | undefined): string {
	if (!source) return QUERY_SOURCE.AML;
	const s = source.toLowerCase();
	if (s === "aml-screening" || s.startsWith("aml:") || s === "aml")
		return QUERY_SOURCE.AML;
	return source;
}
