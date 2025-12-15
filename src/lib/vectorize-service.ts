/**
 * Vectorize indexing service for watchlist targets
 */

import type { WatchlistCSVRow } from "./csv-parser";

export type VectorizeMetadata = Record<
	string,
	string | number | boolean | string[]
> & {
	schema?: string;
	dataset?: string;
	countries?: string[];
	birthDate?: string;
	lastChange?: string;
};

/**
 * Compose the text representation for semantic search
 * Concatenates key fields for embedding
 */
export function composeVectorText(row: WatchlistCSVRow): string {
	const parts: string[] = [];

	if (row.name) parts.push(row.name);
	if (row.aliases && row.aliases.length > 0) {
		parts.push(...row.aliases);
	}
	if (row.identifiers && row.identifiers.length > 0) {
		parts.push(...row.identifiers);
	}
	if (row.countries && row.countries.length > 0) {
		parts.push(row.countries.join(", "));
	}
	if (row.addresses && row.addresses.length > 0) {
		parts.push(...row.addresses);
	}
	if (row.sanctions && row.sanctions.length > 0) {
		parts.push(...row.sanctions);
	}
	if (row.dataset) parts.push(row.dataset);
	if (row.programIds && row.programIds.length > 0) {
		parts.push(...row.programIds);
	}

	return parts.join(" ").trim();
}

/**
 * Compose metadata for filtering
 */
export function composeVectorMetadata(
	row: WatchlistCSVRow,
): Record<string, string | number | boolean | string[]> {
	const metadata: Record<string, string | number | boolean | string[]> = {};

	if (row.schema) metadata.schema = row.schema;
	if (row.dataset) metadata.dataset = row.dataset;
	if (row.countries && row.countries.length > 0) {
		metadata.countries = row.countries;
	}
	if (row.birthDate) metadata.birthDate = row.birthDate;
	if (row.lastChange) metadata.lastChange = row.lastChange;

	return metadata;
}

/**
 * Batch upsert vectors to Vectorize
 */
export async function upsertVectors(
	vectorize: VectorizeIndex,
	vectors: Array<{
		id: string;
		values: number[];
		metadata?: Record<string, string | number | boolean | string[]>;
	}>,
): Promise<void> {
	if (vectors.length === 0) return;

	// Vectorize supports batching, but we'll do it in chunks to be safe
	const BATCH_SIZE = 100;
	for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
		const batch = vectors.slice(i, i + BATCH_SIZE);
		await vectorize.upsert(
			batch.map((v) => ({
				id: v.id,
				values: v.values,
				metadata: (v.metadata || {}) as Record<
					string,
					string | number | boolean | string[]
				>,
			})),
		);
	}
}
