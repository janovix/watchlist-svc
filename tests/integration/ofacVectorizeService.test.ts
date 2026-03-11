import { describe, expect, it } from "vitest";
import {
	composeOfacVectorText,
	composeOfacVectorMetadata,
	getOfacVectorId,
	parseVectorId,
} from "../../src/lib/ofac-vectorize-service";
import { getCallbackUrl } from "../../src/lib/callback-utils";
import type { OfacSdnEntry } from "@prisma/client";

describe("OFAC Vectorize Service", () => {
	// Helper to create a mock OFAC entry
	const createMockEntry = (
		overrides: Partial<OfacSdnEntry> = {},
	): OfacSdnEntry => ({
		id: "12345",
		partyType: "Individual",
		primaryName: "JOHN DOE",
		aliases: JSON.stringify(["Johnny", "JD"]),
		birthDate: "1980-01-15",
		birthPlace: "New York, USA",
		addresses: JSON.stringify(["123 Main St, NY", "456 Oak Ave, CA"]),
		identifiers: JSON.stringify([
			{ type: "Passport", number: "ABC123", country: "US" },
		]),
		remarks: "Test remark",
		sourceList: "SDN List",
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	});

	describe("composeOfacVectorText", () => {
		it("should compose identity-focused text from all fields", () => {
			const entry = createMockEntry();
			const result = composeOfacVectorText(entry);

			expect(result).toContain("JOHN DOE");
			expect(result).toContain("Johnny");
			expect(result).toContain("JD");
			// Should include identifiers with ID: prefix
			expect(result).toContain("ID:ABC123");
			// Should NOT include birthDate with "Born:" prefix
			expect(result).not.toContain("Born:");
			// Should NOT include birthPlace, addresses, partyType, sourceList
			expect(result).not.toContain("New York, USA");
			expect(result).not.toContain("123 Main St");
			expect(result).not.toContain("Individual");
			expect(result).not.toContain("SDN List");
		});

		it("should handle entry with minimal data", () => {
			const entry = createMockEntry({
				aliases: null,
				birthDate: null,
				birthPlace: null,
				addresses: null,
				identifiers: null,
				remarks: null,
			});

			const result = composeOfacVectorText(entry);

			expect(result).toContain("JOHN DOE");
			// Should NOT include partyType and sourceList in new version
			expect(result).not.toContain("Individual");
			expect(result).not.toContain("SDN List");
			expect(result).not.toContain("Born:");
		});

		it("should handle empty aliases array", () => {
			const entry = createMockEntry({
				aliases: JSON.stringify([]),
			});

			const result = composeOfacVectorText(entry);

			expect(result).toContain("JOHN DOE");
			expect(result).not.toContain("Johnny");
		});

		it("should handle invalid JSON in aliases gracefully", () => {
			const entry = createMockEntry({
				aliases: "not valid json",
			});

			const result = composeOfacVectorText(entry);

			// Should not throw, just skip aliases
			expect(result).toContain("JOHN DOE");
		});

		it("should handle Entity type", () => {
			const entry = createMockEntry({
				partyType: "Entity",
				primaryName: "EVIL CORP",
				birthDate: null,
				birthPlace: null,
			});

			const result = composeOfacVectorText(entry);

			expect(result).toContain("EVIL CORP");
			// Entity type should NOT be in text in new version
			expect(result).not.toContain("Entity");
		});

		it("should include identifiers with ID: prefix", () => {
			const entry = createMockEntry({
				identifiers: JSON.stringify([
					{ type: "Passport", number: "ABC123" },
					{ type: "RFC", number: "HEMA-621127" },
				]),
			});

			const result = composeOfacVectorText(entry);

			expect(result).toContain("ID:ABC123");
			expect(result).toContain("ID:HEMA-621127");
		});
	});

	describe("composeOfacVectorMetadata", () => {
		it("should compose enriched metadata from entry", () => {
			const entry = createMockEntry();
			const result = composeOfacVectorMetadata(entry);

			expect(result.dataset).toBe("ofac_sdn");
			expect(result.recordId).toBe("12345");
			expect(result.partyType).toBe("Individual");
			expect(result.sourceList).toBe("SDN List");
			expect(result.birthDate).toBe("1980-01-15");
		});

		it("should handle different party types", () => {
			const entry = createMockEntry({ partyType: "Vessel" });
			const result = composeOfacVectorMetadata(entry);

			expect(result.partyType).toBe("Vessel");
			expect(result.recordId).toBe("12345");
		});

		it("should handle missing birthDate", () => {
			const entry = createMockEntry({ birthDate: null });
			const result = composeOfacVectorMetadata(entry);

			expect(result.birthDate).toBeUndefined();
			expect(result.recordId).toBe("12345");
		});
	});

	describe("getOfacVectorId", () => {
		it("should format vector ID with dataset prefix", () => {
			expect(getOfacVectorId("12345")).toBe("ofac_sdn:12345");
			expect(getOfacVectorId("ABC-123")).toBe("ofac_sdn:ABC-123");
		});
	});

	describe("parseVectorId", () => {
		it("should parse vector ID into dataset and id", () => {
			const result = parseVectorId("ofac_sdn:12345");

			expect(result.dataset).toBe("ofac_sdn");
			expect(result.id).toBe("12345");
		});

		it("should handle IDs with colons", () => {
			const result = parseVectorId("ofac_sdn:ABC:123:XYZ");

			expect(result.dataset).toBe("ofac_sdn");
			expect(result.id).toBe("ABC:123:XYZ");
		});

		it("should handle different datasets", () => {
			const result = parseVectorId("un:UN-2024-001");

			expect(result.dataset).toBe("un");
			expect(result.id).toBe("UN-2024-001");
		});
	});

	describe("getCallbackUrl", () => {
		it("should return localhost for local environment", () => {
			expect(getCallbackUrl("local")).toBe("http://localhost:8787");
		});

		it("should return dev URL for dev environment", () => {
			expect(getCallbackUrl("dev")).toBe(
				"https://watchlist-svc.janovix.workers.dev",
			);
		});

		it("should return dev URL for preview environment", () => {
			expect(getCallbackUrl("preview")).toBe(
				"https://watchlist-svc.janovix.workers.dev",
			);
		});

		it("should return prod URL for production environment", () => {
			expect(getCallbackUrl("production")).toBe(
				"https://watchlist-svc.janovix.com",
			);
		});

		it("should default to dev URL for unknown environment", () => {
			expect(getCallbackUrl(undefined)).toBe(
				"https://watchlist-svc.janovix.workers.dev",
			);
			expect(getCallbackUrl("unknown")).toBe(
				"https://watchlist-svc.janovix.workers.dev",
			);
		});
	});
});
