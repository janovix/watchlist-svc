/**
 * SAT 69-B Vectorize Service
 *
 * Functions for composing text and metadata for SAT 69-B entries
 * to be indexed in Cloudflare Vectorize.
 */

import type { Sat69bEntry } from "@prisma/client";

/**
 * Compose the text representation for semantic search embedding.
 * Concatenates key fields from SAT 69-B entry for embedding generation.
 * Identity-focused: includes taxpayer name, RFC, and status.
 * Excludes noise fields like notices and dates.
 */
export function composeSat69bVectorText(entry: Sat69bEntry): string {
	const parts: string[] = [entry.taxpayerName];

	// Add RFC with prefix for better semantic matching
	parts.push(`RFC:${entry.rfc}`);

	// Add taxpayer status for context
	parts.push(`Situacion:${entry.taxpayerStatus}`);

	return parts.join(" ");
}

/**
 * Compose metadata for filtering in Vectorize.
 * This metadata is stored alongside the vector and can be used for filtering queries.
 * Enriched with recordId, RFC, and taxpayer status for hybrid search.
 */
export function composeSat69bVectorMetadata(
	entry: Sat69bEntry,
): Record<string, string | number | boolean | string[]> {
	const metadata: Record<string, string | number | boolean | string[]> = {
		dataset: "sat_69b",
		recordId: entry.id,
		rfc: entry.rfc,
		taxpayerStatus: entry.taxpayerStatus,
	};

	return metadata;
}

/**
 * Generate the vector ID for a SAT 69-B entry.
 * Format: {dataset}:{id}
 */
export function getSat69bVectorId(entryId: string): string {
	return `sat_69b:${entryId}`;
}

/**
 * Parse a vector ID to extract the dataset and original ID.
 */
export function parseVectorId(vectorId: string): {
	dataset: string;
	id: string;
} {
	const [dataset, ...idParts] = vectorId.split(":");
	return {
		dataset,
		id: idParts.join(":"),
	};
}
