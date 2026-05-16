/**
 * UNSC Vectorize Service
 *
 * Functions for composing text and metadata for UN Security Council entries
 * to be indexed in Cloudflare Vectorize.
 */

import type { UnscEntry } from "@prisma/client";
import {
	appendAliasesFromJson,
	appendIdentifierNumbersFromJson,
} from "./vectorize-text-helpers";

/**
 * Compose the text representation for semantic search embedding.
 * Concatenates key fields from UNSC entry for embedding generation.
 * Identity-focused: includes name, aliases, and ID-prefixed identifiers.
 * Excludes noise fields like addresses, birthPlace, partyType.
 */
export function composeUnscVectorText(entry: UnscEntry): string {
	const parts: string[] = [entry.primaryName];
	appendAliasesFromJson(parts, entry.aliases);
	appendIdentifierNumbersFromJson(parts, entry.identifiers);
	return parts.join(" ");
}

/**
 * Compose metadata for filtering in Vectorize.
 * This metadata is stored alongside the vector and can be used for filtering queries.
 * Enriched with recordId and birthDate for hybrid search.
 */
export function composeUnscVectorMetadata(
	entry: UnscEntry,
): Record<string, string | number | boolean | string[]> {
	const metadata: Record<string, string | number | boolean | string[]> = {
		dataset: "unsc",
		recordId: entry.id,
		partyType: entry.partyType,
		unListType: entry.unListType,
	};

	if (entry.birthDate) {
		metadata.birthDate = entry.birthDate;
	}

	if (entry.gender) {
		metadata.gender = entry.gender;
	}

	return metadata;
}

/**
 * Generate the vector ID for a UNSC entry.
 * Format: {dataset}:{id}
 */
export function getUnscVectorId(entryId: string): string {
	return `unsc:${entryId}`;
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
