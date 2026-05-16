/**
 * Shared helpers for composing identity-focused vector text from watchlist rows.
 */

export function appendAliasesFromJson(
	parts: string[],
	aliasesJson: string | null,
): void {
	if (!aliasesJson) return;
	try {
		const aliases = JSON.parse(aliasesJson) as string[];
		if (aliases.length > 0) {
			parts.push(...aliases);
		}
	} catch {
		// Invalid JSON, skip aliases
	}
}

export function appendIdentifierNumbersFromJson(
	parts: string[],
	identifiersJson: string | null,
): void {
	if (!identifiersJson) return;
	try {
		const identifiers = JSON.parse(identifiersJson) as Array<{
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
