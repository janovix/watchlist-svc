/**
 * OFAC Vectorize Service
 *
 * Functions for composing text and metadata for OFAC SDN entries
 * to be indexed in Cloudflare Vectorize.
 */

import type { OfacSdnEntry } from "@prisma/client";

/**
 * Compose the text representation for semantic search embedding.
 * Concatenates key fields from OFAC SDN entry for embedding generation.
 * Identity-focused: includes name, aliases, and ID-prefixed identifiers.
 * Excludes noise fields like addresses, birthPlace, partyType, sourceList.
 */
export function composeOfacVectorText(entry: OfacSdnEntry): string {
	const parts: string[] = [entry.primaryName];

	// Add aliases
	if (entry.aliases) {
		try {
			const aliases = JSON.parse(entry.aliases) as string[];
			if (aliases.length > 0) {
				parts.push(...aliases);
			}
		} catch {
			// Invalid JSON, skip aliases
		}
	}

	// Add identifiers with ID: prefix
	if (entry.identifiers) {
		try {
			const identifiers = JSON.parse(entry.identifiers) as Array<{
				type?: string;
				number?: string;
			}>;
			for (const identifier of identifiers) {
				if (identifier.number) {
					parts.push(`ID:${identifier.number}`);
				}
			}
		} catch {
			// Invalid JSON, skip identifiers
		}
	}

	return parts.join(" ");
}

/**
 * Compose metadata for filtering in Vectorize.
 * This metadata is stored alongside the vector and can be used for filtering queries.
 * Enriched with recordId and birthDate for hybrid search.
 */
export function composeOfacVectorMetadata(
	entry: OfacSdnEntry,
): Record<string, string | number | boolean | string[]> {
	const metadata: Record<string, string | number | boolean | string[]> = {
		dataset: "ofac_sdn",
		recordId: entry.id,
		partyType: entry.partyType,
		sourceList: entry.sourceList,
	};

	if (entry.birthDate) {
		metadata.birthDate = entry.birthDate;
	}

	return metadata;
}

/**
 * Generate the vector ID for an OFAC SDN entry.
 * Format: {dataset}:{id}
 */
export function getOfacVectorId(entryId: string): string {
	return `ofac_sdn:${entryId}`;
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

/**
 * Get the callback URL for the current environment.
 */
export function getCallbackUrl(environment: string | undefined): string {
	switch (environment) {
		case "local":
			return "http://localhost:8787";
		case "dev":
			return "https://watchlist-svc.janovix.workers.dev";
		case "preview":
			return "https://watchlist-svc-preview.janovix.workers.dev";
		case "production":
			return "https://watchlist-prod.janovix.ai";
		default:
			// Default to dev for unknown environments
			return "https://watchlist-svc.janovix.workers.dev";
	}
}
