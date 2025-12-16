/**
 * CSV parser for watchlist ingestion
 * Handles streaming CSV parsing with soft-failing for invalid fields
 */

export interface WatchlistCSVRow {
	id: string;
	schema: string | null;
	name: string | null;
	aliases: string[] | null;
	birthDate: string | null;
	countries: string[] | null;
	addresses: string[] | null;
	identifiers: string[] | null;
	sanctions: string[] | null;
	phones: string[] | null;
	emails: string[] | null;
	programIds: string[] | null;
	dataset: string | null;
	firstSeen: string | null;
	lastSeen: string | null;
	lastChange: string | null;
}

export interface ParseError {
	rowId: string;
	field: string;
	error: string;
}

/**
 * Parse a CSV value that might be a JSON array or comma-separated string
 */
function parseArrayField(value: string | null | undefined): string[] | null {
	if (!value || value.trim() === "") return null;
	try {
		// Try parsing as JSON first
		const parsed = JSON.parse(value);
		if (Array.isArray(parsed)) {
			return parsed.filter((v) => typeof v === "string" && v.trim() !== "");
		}
	} catch {
		// Not JSON, try comma-separated
	}
	// Split by comma and clean up
	return value
		.split(",")
		.map((v) => v.trim())
		.filter((v) => v !== "");
}

/**
 * Parse a single CSV row with soft-failing
 */
export function parseCSVRow(
	row: Record<string, string>,
	errors: ParseError[],
): WatchlistCSVRow | null {
	const id = row.id?.trim();
	if (!id) {
		errors.push({
			rowId: "unknown",
			field: "id",
			error: "Missing required id",
		});
		return null;
	}

	const parseField = (
		fieldName: string,
		parser: (value: string | null | undefined) => unknown,
	): unknown => {
		try {
			return parser(row[fieldName]);
		} catch (error) {
			errors.push({
				rowId: id,
				field: fieldName,
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	};

	return {
		id,
		schema: parseField("schema", (v) => v?.trim() || null) as string | null,
		name: parseField("name", (v) => v?.trim() || null) as string | null,
		aliases: parseField("aliases", parseArrayField) as string[] | null,
		birthDate: parseField("birth_date", (v) => v?.trim() || null) as
			| string
			| null,
		countries: parseField("countries", parseArrayField) as string[] | null,
		addresses: parseField("addresses", parseArrayField) as string[] | null,
		identifiers: parseField("identifiers", parseArrayField) as string[] | null,
		sanctions: parseField("sanctions", parseArrayField) as string[] | null,
		phones: parseField("phones", parseArrayField) as string[] | null,
		emails: parseField("emails", parseArrayField) as string[] | null,
		programIds: parseField("program_ids", parseArrayField) as string[] | null,
		dataset: parseField("dataset", (v) => v?.trim() || null) as string | null,
		firstSeen: parseField("first_seen", (v) => v?.trim() || null) as
			| string
			| null,
		lastSeen: parseField("last_seen", (v) => v?.trim() || null) as
			| string
			| null,
		lastChange: parseField("last_change", (v) => v?.trim() || null) as
			| string
			| null,
	};
}

/**
 * Parse CSV text into rows
 * Simple CSV parser - handles quoted fields and escapes
 */
export function parseCSV(csvText: string): Record<string, string>[] {
	const lines = csvText.split("\n").filter((line) => line.trim() !== "");
	if (lines.length === 0) return [];

	const headers = parseCSVLine(lines[0]);
	const rows: Record<string, string>[] = [];

	for (let i = 1; i < lines.length; i++) {
		const values = parseCSVLine(lines[i]);
		if (values.length === 0) continue;

		const row: Record<string, string> = {};
		for (let j = 0; j < headers.length; j++) {
			row[headers[j]] = values[j] || "";
		}
		rows.push(row);
	}

	return rows;
}

/**
 * Parse a single CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
	const values: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		const nextChar = line[i + 1];

		if (char === '"') {
			if (inQuotes && nextChar === '"') {
				// Escaped quote
				current += '"';
				i++; // Skip next quote
			} else {
				// Toggle quote state
				inQuotes = !inQuotes;
			}
		} else if (char === "," && !inQuotes) {
			values.push(current);
			current = "";
		} else {
			current += char;
		}
	}
	values.push(current); // Add last value

	return values.map((v) => v.trim());
}

/**
 * Stream CSV parsing - processes CSV line by line without loading entire file into memory
 * This is memory-efficient for large CSV files in Cloudflare Workers
 */
export async function* streamCSV(
	response: Response,
): AsyncGenerator<Record<string, string>, void, unknown> {
	if (!response.body) {
		throw new Error("Response body is null");
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let headers: string[] | null = null;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() || ""; // Keep incomplete line in buffer

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;

				if (!headers) {
					// First line is headers
					headers = parseCSVLine(trimmed);
					continue;
				}

				const values = parseCSVLine(trimmed);
				if (values.length === 0) continue;

				const row: Record<string, string> = {};
				for (let j = 0; j < headers.length; j++) {
					row[headers[j]] = values[j] || "";
				}
				yield row;
			}
		}

		// Process remaining buffer
		if (buffer.trim() && headers) {
			const values = parseCSVLine(buffer.trim());
			if (values.length > 0) {
				const row: Record<string, string> = {};
				for (let j = 0; j < headers.length; j++) {
					row[headers[j]] = values[j] || "";
				}
				yield row;
			}
		}
	} finally {
		reader.releaseLock();
	}
}
