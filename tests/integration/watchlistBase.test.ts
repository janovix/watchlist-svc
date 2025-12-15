import { describe, expect, it } from "vitest";
import {
	parseJsonField,
	serializeJsonField,
} from "../../src/endpoints/watchlist/base";

describe("Watchlist Base Utilities", () => {
	describe("parseJsonField", () => {
		it("should parse valid JSON string", () => {
			const result = parseJsonField<string[]>('["item1", "item2"]');
			expect(result).toEqual(["item1", "item2"]);
		});

		it("should return null for null input", () => {
			const result = parseJsonField<string[]>(null);
			expect(result).toBeNull();
		});

		it("should return null for empty string", () => {
			const result = parseJsonField<string[]>("");
			expect(result).toBeNull();
		});

		it("should return null for invalid JSON", () => {
			const result = parseJsonField<string[]>("invalid json");
			expect(result).toBeNull();
		});
	});

	describe("serializeJsonField", () => {
		it("should serialize array to JSON string", () => {
			const result = serializeJsonField(["item1", "item2"]);
			expect(result).toBe('["item1","item2"]');
		});

		it("should return null for null input", () => {
			const result = serializeJsonField(null);
			expect(result).toBeNull();
		});

		it("should return null for undefined input", () => {
			const result = serializeJsonField(undefined);
			expect(result).toBeNull();
		});

		it("should serialize object to JSON string", () => {
			const result = serializeJsonField({ key: "value" });
			expect(result).toBe('{"key":"value"}');
		});
	});
});
