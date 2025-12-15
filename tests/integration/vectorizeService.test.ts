import { describe, expect, it } from "vitest";
import {
	composeVectorText,
	composeVectorMetadata,
} from "../../src/lib/vectorize-service";
import type { WatchlistCSVRow } from "../../src/lib/csv-parser";

describe("Vectorize Service", () => {
	describe("composeVectorText", () => {
		it("should compose text from all fields", () => {
			const row: WatchlistCSVRow = {
				id: "test-id",
				name: "John Doe",
				aliases: ["Johnny", "JD"],
				identifiers: ["passport:123", "ssn:456"],
				countries: ["US", "CA"],
				addresses: ["123 Main St"],
				sanctions: ["sanction1"],
				dataset: "test-dataset",
				programIds: ["program1"],
				schema: null,
				birthDate: null,
				emails: null,
				phones: null,
				firstSeen: null,
				lastSeen: null,
				lastChange: null,
			};

			const result = composeVectorText(row);

			expect(result).toContain("John Doe");
			expect(result).toContain("Johnny");
			expect(result).toContain("JD");
			expect(result).toContain("passport:123");
			expect(result).toContain("US, CA");
			expect(result).toContain("123 Main St");
			expect(result).toContain("sanction1");
			expect(result).toContain("test-dataset");
			expect(result).toContain("program1");
		});

		it("should handle minimal data", () => {
			const row: WatchlistCSVRow = {
				id: "test-id",
				name: "Test",
				aliases: null,
				identifiers: null,
				countries: null,
				addresses: null,
				sanctions: null,
				dataset: null,
				programIds: null,
				schema: null,
				birthDate: null,
				emails: null,
				phones: null,
				firstSeen: null,
				lastSeen: null,
				lastChange: null,
			};

			const result = composeVectorText(row);
			expect(result).toBe("Test");
		});

		it("should return empty string for empty row", () => {
			const row: WatchlistCSVRow = {
				id: "test-id",
				name: null,
				aliases: null,
				identifiers: null,
				countries: null,
				addresses: null,
				sanctions: null,
				dataset: null,
				programIds: null,
				schema: null,
				birthDate: null,
				emails: null,
				phones: null,
				firstSeen: null,
				lastSeen: null,
				lastChange: null,
			};

			const result = composeVectorText(row);
			expect(result).toBe("");
		});
	});

	describe("composeVectorMetadata", () => {
		it("should compose metadata from row", () => {
			const row: WatchlistCSVRow = {
				id: "test-id",
				schema: "Person",
				dataset: "test-dataset",
				countries: ["US", "CA"],
				birthDate: "1990-01-01",
				lastChange: "2025-01-01T00:00:00Z",
				name: null,
				aliases: null,
				identifiers: null,
				addresses: null,
				sanctions: null,
				programIds: null,
				emails: null,
				phones: null,
				firstSeen: null,
				lastSeen: null,
			};

			const result = composeVectorMetadata(row);

			expect(result.schema).toBe("Person");
			expect(result.dataset).toBe("test-dataset");
			expect(result.countries).toEqual(["US", "CA"]);
			expect(result.birthDate).toBe("1990-01-01");
			expect(result.lastChange).toBe("2025-01-01T00:00:00Z");
		});

		it("should handle minimal metadata", () => {
			const row: WatchlistCSVRow = {
				id: "test-id",
				schema: null,
				dataset: null,
				countries: null,
				birthDate: null,
				lastChange: null,
				name: null,
				aliases: null,
				identifiers: null,
				addresses: null,
				sanctions: null,
				programIds: null,
				emails: null,
				phones: null,
				firstSeen: null,
				lastSeen: null,
			};

			const result = composeVectorMetadata(row);

			expect(result).toEqual({});
		});
	});
});
