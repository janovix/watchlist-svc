import { describe, expect, it } from "vitest";
import { QUERY_SOURCE, normalizeAmlSource } from "../../src/lib/query-source";

describe("query-source", () => {
	describe("QUERY_SOURCE", () => {
		it("should export canonical source values", () => {
			expect(QUERY_SOURCE.AML).toBe("aml");
			expect(QUERY_SOURCE.WATCHLIST_QUERY).toBe("watchlist_query");
			expect(QUERY_SOURCE.CSV_IMPORT).toBe("csv_import");
			expect(QUERY_SOURCE.API).toBe("api");
		});
	});

	describe("normalizeAmlSource", () => {
		it("should return aml for undefined input", () => {
			expect(normalizeAmlSource(undefined)).toBe(QUERY_SOURCE.AML);
		});

		it("should return aml for empty string", () => {
			expect(normalizeAmlSource("")).toBe(QUERY_SOURCE.AML);
		});

		it("should return aml for aml-screening", () => {
			expect(normalizeAmlSource("aml-screening")).toBe(QUERY_SOURCE.AML);
		});

		it("should return aml for aml: prefixed source", () => {
			expect(normalizeAmlSource("aml:something")).toBe(QUERY_SOURCE.AML);
		});

		it("should return aml for aml (exact)", () => {
			expect(normalizeAmlSource("aml")).toBe(QUERY_SOURCE.AML);
		});

		it("should return aml for AML (case insensitive)", () => {
			expect(normalizeAmlSource("AML")).toBe(QUERY_SOURCE.AML);
		});

		it("should passthrough non-aml source", () => {
			expect(normalizeAmlSource("csv_import")).toBe("csv_import");
		});

		it("should passthrough arbitrary source", () => {
			expect(normalizeAmlSource("api")).toBe("api");
		});
	});
});
