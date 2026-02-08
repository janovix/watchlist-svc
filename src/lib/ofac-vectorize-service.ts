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
 */
export function composeOfacVectorText(entry: OfacSdnEntry): string {
	const parts: string[] = [entry.primaryName];

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

	if (entry.birthDate) {
		parts.push(`Born: ${entry.birthDate}`);
	}

	if (entry.birthPlace) {
		parts.push(entry.birthPlace);
	}

	if (entry.addresses) {
		try {
			const addresses = JSON.parse(entry.addresses) as string[];
			if (addresses.length > 0) {
				parts.push(...addresses);
			}
		} catch {
			// Invalid JSON, skip addresses
		}
	}

	parts.push(entry.partyType, entry.sourceList);

	return parts.join(" ");
}

/**
 * Compose metadata for filtering in Vectorize.
 * This metadata is stored alongside the vector and can be used for filtering queries.
 */
export function composeOfacVectorMetadata(
	entry: OfacSdnEntry,
): Record<string, string | number | boolean | string[]> {
	return {
		dataset: "ofac_sdn",
		partyType: entry.partyType,
		sourceList: entry.sourceList,
	};
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
