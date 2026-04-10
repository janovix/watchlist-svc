/**
 * Flag keys in flags-svc for watchlist /config features.
 * Seeded in flags-svc migration; override via admin UI.
 */
export const WATCHLIST_FEATURE_FLAG_KEYS = {
	pepSearch: "watchlist-pep-search",
	pepGrok: "watchlist-pep-grok",
	adverseMedia: "watchlist-adverse-media",
} as const;
