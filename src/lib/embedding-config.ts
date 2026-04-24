/**
 * Workers AI embedding model for watchlist vector search and indexing.
 * bge-m3 is multilingual (Spanish + English) and uses 1024-dim dense vectors;
 * the Vectorize index dimensions must match (see WATCHLIST_VECTORIZE binding).
 */
export const WATCHLIST_EMBEDDING_MODEL = "@cf/baai/bge-m3" as const;

export const WATCHLIST_EMBEDDING_DIMENSIONS = 1024 as const;
