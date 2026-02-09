import { describe, expect, it } from "vitest";
import {
	composeOfacVectorText,
	composeOfacVectorMetadata,
	getOfacVectorId,
	parseVectorId,
	getCallbackUrl,
} from "../../src/lib/ofac-vectorize-service";
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
		it("should compose text from all fields", () => {
			const entry = createMockEntry();
			const result = composeOfacVectorText(entry);

			expect(result).toContain("JOHN DOE");
			expect(result).toContain("Johnny");
			expect(result).toContain("JD");
			expect(result).toContain("Born: 1980-01-15");
			expect(result).toContain("New York, USA");
			expect(result).toContain("123 Main St, NY");
			expect(result).toContain("456 Oak Ave, CA");
			expect(result).toContain("Individual");
			expect(result).toContain("SDN List");
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
			expect(result).toContain("Individual");
			expect(result).toContain("SDN List");
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
			expect(result).toContain("Entity");
		});
	});

	describe("composeOfacVectorMetadata", () => {
		it("should compose metadata from entry", () => {
			const entry = createMockEntry();
			const result = composeOfacVectorMetadata(entry);

			expect(result.dataset).toBe("ofac_sdn");
			expect(result.partyType).toBe("Individual");
			expect(result.sourceList).toBe("SDN List");
		});

		it("should handle different party types", () => {
			const entry = createMockEntry({ partyType: "Vessel" });
			const result = composeOfacVectorMetadata(entry);

			expect(result.partyType).toBe("Vessel");
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

		it("should return preview URL for preview environment", () => {
			expect(getCallbackUrl("preview")).toBe(
				"https://watchlist-svc-preview.janovix.workers.dev",
			);
		});

		it("should return prod URL for production environment", () => {
			expect(getCallbackUrl("production")).toBe(
				"https://watchlist-prod.janovix.ai",
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
