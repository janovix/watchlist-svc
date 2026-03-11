import { describe, expect, it } from "vitest";
import {
	composeUnscVectorText,
	composeUnscVectorMetadata,
	getUnscVectorId,
	parseVectorId,
} from "../../src/lib/unsc-vectorize-service";
import { getCallbackUrl } from "../../src/lib/callback-utils";
import type { UnscEntry } from "@prisma/client";

/**
 * Tests for UNSC Vectorize Service
 *
 * Tests the helper functions that compose text and metadata for
 * UNSC entries to be indexed in Vectorize.
 */
describe("UNSC Vectorize Service", () => {
	describe("composeUnscVectorText", () => {
		it("should compose text with primary name only", () => {
			const entry: UnscEntry = {
				id: "1001",
				partyType: "Individual",
				primaryName: "JOHN DOE",
				aliases: null,
				birthDate: null,
				birthPlace: null,
				gender: null,
				addresses: null,
				nationalities: null,
				identifiers: null,
				designations: null,
				remarks: null,
				unListType: "Al-Qaida",
				referenceNumber: null,
				listedOn: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const text = composeUnscVectorText(entry);
			expect(text).toBe("JOHN DOE");
		});

		it("should compose text with primary name and aliases", () => {
			const entry: UnscEntry = {
				id: "1002",
				partyType: "Individual",
				primaryName: "JOHN DOE",
				aliases: JSON.stringify(["J. Doe", "Johnny"]),
				birthDate: null,
				birthPlace: null,
				gender: null,
				addresses: null,
				nationalities: null,
				identifiers: null,
				designations: null,
				remarks: null,
				unListType: "Al-Qaida",
				referenceNumber: null,
				listedOn: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const text = composeUnscVectorText(entry);
			expect(text).toBe("JOHN DOE J. Doe Johnny");
		});

		it("should compose text with identifiers prefixed with ID:", () => {
			const entry: UnscEntry = {
				id: "1003",
				partyType: "Individual",
				primaryName: "JOHN DOE",
				aliases: null,
				birthDate: null,
				birthPlace: null,
				gender: null,
				addresses: null,
				nationalities: null,
				identifiers: JSON.stringify([
					{ type: "Passport", number: "P1234567" },
					{ type: "National ID", number: "ID987654" },
				]),
				designations: null,
				remarks: null,
				unListType: "Al-Qaida",
				referenceNumber: null,
				listedOn: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const text = composeUnscVectorText(entry);
			expect(text).toBe("JOHN DOE ID:P1234567 ID:ID987654");
		});

		it("should compose text with all fields", () => {
			const entry: UnscEntry = {
				id: "1004",
				partyType: "Individual",
				primaryName: "JOHN DOE",
				aliases: JSON.stringify(["J. Doe"]),
				birthDate: null,
				birthPlace: null,
				gender: null,
				addresses: null,
				nationalities: null,
				identifiers: JSON.stringify([{ type: "Passport", number: "P1234567" }]),
				designations: null,
				remarks: null,
				unListType: "Al-Qaida",
				referenceNumber: null,
				listedOn: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const text = composeUnscVectorText(entry);
			expect(text).toBe("JOHN DOE J. Doe ID:P1234567");
		});

		it("should handle invalid JSON in aliases gracefully", () => {
			const entry: UnscEntry = {
				id: "1005",
				partyType: "Individual",
				primaryName: "JOHN DOE",
				aliases: "invalid json {",
				birthDate: null,
				birthPlace: null,
				gender: null,
				addresses: null,
				nationalities: null,
				identifiers: null,
				designations: null,
				remarks: null,
				unListType: "Al-Qaida",
				referenceNumber: null,
				listedOn: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const text = composeUnscVectorText(entry);
			expect(text).toBe("JOHN DOE");
		});

		it("should handle invalid JSON in identifiers gracefully", () => {
			const entry: UnscEntry = {
				id: "1006",
				partyType: "Individual",
				primaryName: "JOHN DOE",
				aliases: null,
				birthDate: null,
				birthPlace: null,
				gender: null,
				addresses: null,
				nationalities: null,
				identifiers: "invalid json [",
				designations: null,
				remarks: null,
				unListType: "Al-Qaida",
				referenceNumber: null,
				listedOn: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const text = composeUnscVectorText(entry);
			expect(text).toBe("JOHN DOE");
		});

		it("should handle empty aliases array", () => {
			const entry: UnscEntry = {
				id: "1007",
				partyType: "Individual",
				primaryName: "JOHN DOE",
				aliases: JSON.stringify([]),
				birthDate: null,
				birthPlace: null,
				gender: null,
				addresses: null,
				nationalities: null,
				identifiers: null,
				designations: null,
				remarks: null,
				unListType: "Al-Qaida",
				referenceNumber: null,
				listedOn: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const text = composeUnscVectorText(entry);
			expect(text).toBe("JOHN DOE");
		});

		it("should skip identifiers without number field", () => {
			const entry: UnscEntry = {
				id: "1008",
				partyType: "Individual",
				primaryName: "JOHN DOE",
				aliases: null,
				birthDate: null,
				birthPlace: null,
				gender: null,
				addresses: null,
				nationalities: null,
				identifiers: JSON.stringify([
					{ type: "Passport", number: "P1234567" },
					{ type: "Unknown" }, // Missing number field
				]),
				designations: null,
				remarks: null,
				unListType: "Al-Qaida",
				referenceNumber: null,
				listedOn: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const text = composeUnscVectorText(entry);
			expect(text).toBe("JOHN DOE ID:P1234567");
		});
	});

	describe("composeUnscVectorMetadata", () => {
		it("should compose basic metadata", () => {
			const entry: UnscEntry = {
				id: "2001",
				partyType: "Individual",
				primaryName: "JOHN DOE",
				aliases: null,
				birthDate: null,
				birthPlace: null,
				gender: null,
				addresses: null,
				nationalities: null,
				identifiers: null,
				designations: null,
				remarks: null,
				unListType: "Al-Qaida",
				referenceNumber: null,
				listedOn: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const metadata = composeUnscVectorMetadata(entry);
			expect(metadata).toEqual({
				dataset: "unsc",
				recordId: "2001",
				partyType: "Individual",
				unListType: "Al-Qaida",
			});
		});

		it("should include birthDate when present", () => {
			const entry: UnscEntry = {
				id: "2002",
				partyType: "Individual",
				primaryName: "JOHN DOE",
				aliases: null,
				birthDate: "1980-01-15",
				birthPlace: null,
				gender: null,
				addresses: null,
				nationalities: null,
				identifiers: null,
				designations: null,
				remarks: null,
				unListType: "Al-Qaida",
				referenceNumber: null,
				listedOn: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const metadata = composeUnscVectorMetadata(entry);
			expect(metadata.birthDate).toBe("1980-01-15");
		});

		it("should include gender when present", () => {
			const entry: UnscEntry = {
				id: "2003",
				partyType: "Individual",
				primaryName: "JOHN DOE",
				aliases: null,
				birthDate: null,
				birthPlace: null,
				gender: "Male",
				addresses: null,
				nationalities: null,
				identifiers: null,
				designations: null,
				remarks: null,
				unListType: "Al-Qaida",
				referenceNumber: null,
				listedOn: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const metadata = composeUnscVectorMetadata(entry);
			expect(metadata.gender).toBe("Male");
		});

		it("should include all optional fields when present", () => {
			const entry: UnscEntry = {
				id: "2004",
				partyType: "Individual",
				primaryName: "JOHN DOE",
				aliases: null,
				birthDate: "1980-01-15",
				birthPlace: null,
				gender: "Male",
				addresses: null,
				nationalities: null,
				identifiers: null,
				designations: null,
				remarks: null,
				unListType: "Al-Qaida",
				referenceNumber: null,
				listedOn: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const metadata = composeUnscVectorMetadata(entry);
			expect(metadata).toEqual({
				dataset: "unsc",
				recordId: "2004",
				partyType: "Individual",
				unListType: "Al-Qaida",
				birthDate: "1980-01-15",
				gender: "Male",
			});
		});

		it("should handle Entity party type", () => {
			const entry: UnscEntry = {
				id: "2005",
				partyType: "Entity",
				primaryName: "ACME CORP",
				aliases: null,
				birthDate: null,
				birthPlace: null,
				gender: null,
				addresses: null,
				nationalities: null,
				identifiers: null,
				designations: null,
				remarks: null,
				unListType: "Al-Qaida",
				referenceNumber: null,
				listedOn: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			const metadata = composeUnscVectorMetadata(entry);
			expect(metadata.partyType).toBe("Entity");
			expect(metadata.birthDate).toBeUndefined();
			expect(metadata.gender).toBeUndefined();
		});
	});

	describe("getUnscVectorId", () => {
		it("should generate vector ID with dataset prefix", () => {
			const vectorId = getUnscVectorId("1001");
			expect(vectorId).toBe("unsc:1001");
		});

		it("should handle IDs with special characters", () => {
			const vectorId = getUnscVectorId("QI.001");
			expect(vectorId).toBe("unsc:QI.001");
		});
	});

	describe("parseVectorId", () => {
		it("should parse simple vector ID", () => {
			const parsed = parseVectorId("unsc:1001");
			expect(parsed).toEqual({
				dataset: "unsc",
				id: "1001",
			});
		});

		it("should parse vector ID with colons in the ID part", () => {
			const parsed = parseVectorId("unsc:QI.001:extra");
			expect(parsed).toEqual({
				dataset: "unsc",
				id: "QI.001:extra",
			});
		});

		it("should handle other dataset prefixes", () => {
			const parsed = parseVectorId("ofac:12345");
			expect(parsed).toEqual({
				dataset: "ofac",
				id: "12345",
			});
		});
	});

	describe("getCallbackUrl", () => {
		it("should return localhost for local environment", () => {
			const url = getCallbackUrl("local");
			expect(url).toBe("http://localhost:8787");
		});

		it("should return dev URL for dev environment", () => {
			const url = getCallbackUrl("dev");
			expect(url).toBe("https://watchlist-svc.janovix.workers.dev");
		});

		it("should return dev URL for preview environment", () => {
			const url = getCallbackUrl("preview");
			expect(url).toBe("https://watchlist-svc.janovix.workers.dev");
		});

		it("should return production URL for production environment", () => {
			const url = getCallbackUrl("production");
			expect(url).toBe("https://watchlist-svc.janovix.com");
		});

		it("should default to dev URL for unknown environment", () => {
			const url = getCallbackUrl("unknown");
			expect(url).toBe("https://watchlist-svc.janovix.workers.dev");
		});

		it("should default to dev URL for undefined environment", () => {
			const url = getCallbackUrl(undefined);
			expect(url).toBe("https://watchlist-svc.janovix.workers.dev");
		});
	});
});
