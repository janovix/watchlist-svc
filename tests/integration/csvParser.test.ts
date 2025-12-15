import { describe, expect, it } from "vitest";
import {
	parseCSV,
	parseCSVRow,
	type ParseError,
} from "../../src/lib/csv-parser";

describe("CSV Parser", () => {
	describe("parseCSV", () => {
		it("should parse simple CSV", () => {
			const csv = "id,name\n1,Test\n2,Another";
			const result = parseCSV(csv);

			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({ id: "1", name: "Test" });
			expect(result[1]).toEqual({ id: "2", name: "Another" });
		});

		it("should handle empty CSV", () => {
			const csv = "";
			const result = parseCSV(csv);
			expect(result).toEqual([]);
		});

		it("should handle CSV with only headers", () => {
			const csv = "id,name\n";
			const result = parseCSV(csv);
			expect(result).toEqual([]);
		});

		it("should handle quoted fields", () => {
			const csv = 'id,name\n1,"Test, Name"\n2,"Another"';
			const result = parseCSV(csv);

			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({ id: "1", name: "Test, Name" });
			expect(result[1]).toEqual({ id: "2", name: "Another" });
		});
	});

	describe("parseCSVRow", () => {
		it("should parse valid watchlist row", () => {
			const errors: ParseError[] = [];
			const row = {
				id: "test-id",
				schema: "Person",
				name: "Test Person",
				aliases: '["Alias1", "Alias2"]',
				birth_date: "1990-01-01",
				countries: '["US", "CA"]',
				addresses: '["123 Main St"]',
				identifiers: '["passport:123"]',
				sanctions: '["sanction1"]',
				phones: '["+1234567890"]',
				emails: '["test@example.com"]',
				program_ids: '["program1"]',
				dataset: "test-dataset",
				first_seen: "2025-01-01T00:00:00Z",
				last_seen: "2025-01-01T00:00:00Z",
				last_change: "2025-01-01T00:00:00Z",
			};

			const result = parseCSVRow(row, errors);

			expect(errors).toHaveLength(0);
			expect(result).not.toBeNull();
			expect(result?.id).toBe("test-id");
			expect(result?.name).toBe("Test Person");
			expect(result?.schema).toBe("Person");
			expect(result?.aliases).toEqual(["Alias1", "Alias2"]);
		});

		it("should return null and add error for missing id", () => {
			const errors: ParseError[] = [];
			const row = {
				name: "Test Person",
			};

			const result = parseCSVRow(row, errors);

			expect(errors).toHaveLength(1);
			expect(errors[0].field).toBe("id");
			expect(result).toBeNull();
		});

		it("should handle comma-separated arrays", () => {
			const errors: ParseError[] = [];
			const row = {
				id: "test-id",
				aliases: "Alias1, Alias2, Alias3",
				countries: "US, CA, MX",
			};

			const result = parseCSVRow(row, errors);

			expect(errors).toHaveLength(0);
			expect(result).not.toBeNull();
			expect(result?.aliases).toEqual(["Alias1", "Alias2", "Alias3"]);
			expect(result?.countries).toEqual(["US", "CA", "MX"]);
		});

		it("should handle empty fields", () => {
			const errors: ParseError[] = [];
			const row = {
				id: "test-id",
				name: "",
				aliases: "",
			};

			const result = parseCSVRow(row, errors);

			expect(errors).toHaveLength(0);
			expect(result).not.toBeNull();
			expect(result?.name).toBeNull();
			expect(result?.aliases).toBeNull();
		});
	});
});
