/**
 * Tests for SAT 69-B Vectorize Service
 */

import { describe, it, expect } from "vitest";
import {
	composeSat69bVectorText,
	composeSat69bVectorMetadata,
	getSat69bVectorId,
	parseVectorId,
} from "./sat69b-vectorize-service";

describe("SAT 69-B Vectorize Service", () => {
	const mockEntry = {
		id: "ABC123456XYZ",
		rowNumber: 100,
		rfc: "ABC123456XYZ",
		taxpayerName: "EMPRESA DE PRUEBA SA DE CV",
		taxpayerStatus: "Definitivo",
		presumptionSatNotice: "Oficio 123",
		presumptionSatDate: "2024-01-01",
		presumptionDofNotice: null,
		presumptionDofDate: null,
		rebuttalSatNotice: null,
		rebuttalSatDate: null,
		rebuttalDofNotice: null,
		rebuttalDofDate: null,
		definitiveSatNotice: "Oficio 456",
		definitiveSatDate: "2024-03-01",
		definitiveDofNotice: null,
		definitiveDofDate: null,
		favorableSatNotice: null,
		favorableSatDate: null,
		favorableDofNotice: null,
		favorableDofDate: null,
		createdAt: new Date("2024-03-15T10:00:00Z"),
		updatedAt: new Date("2024-03-15T10:00:00Z"),
	};

	describe("composeSat69bVectorText", () => {
		it("should compose vector text with all key fields", () => {
			const text = composeSat69bVectorText(mockEntry);

			expect(text).toContain("EMPRESA DE PRUEBA SA DE CV");
			expect(text).toContain("RFC:ABC123456XYZ");
			expect(text).toContain("Situacion:Definitivo");
		});

		it("should handle entries with minimal data", () => {
			const minimalEntry = {
				...mockEntry,
				taxpayerStatus: "Presunto",
			};

			const text = composeSat69bVectorText(minimalEntry);

			expect(text).toBeTruthy();
			expect(text).toContain("Presunto");
		});
	});

	describe("composeSat69bVectorMetadata", () => {
		it("should create metadata with correct structure", () => {
			const metadata = composeSat69bVectorMetadata(mockEntry);

			expect(metadata).toEqual({
				dataset: "sat_69b",
				recordId: "ABC123456XYZ",
				rfc: "ABC123456XYZ",
				taxpayerStatus: "Definitivo",
			});
		});

		it("should always include dataset field", () => {
			const metadata = composeSat69bVectorMetadata(mockEntry);

			expect(metadata.dataset).toBe("sat_69b");
		});
	});

	describe("getSat69bVectorId", () => {
		it("should generate vector ID with correct format", () => {
			const vectorId = getSat69bVectorId("ABC123456XYZ");

			expect(vectorId).toBe("sat_69b:ABC123456XYZ");
		});

		it("should handle IDs with special characters", () => {
			const vectorId = getSat69bVectorId("ABC-123_456");

			expect(vectorId).toBe("sat_69b:ABC-123_456");
		});
	});

	describe("parseVectorId", () => {
		it("should parse vector ID correctly", () => {
			const parsed = parseVectorId("sat_69b:ABC123456XYZ");

			expect(parsed).toEqual({
				dataset: "sat_69b",
				id: "ABC123456XYZ",
			});
		});

		it("should handle IDs with colons", () => {
			const parsed = parseVectorId("sat_69b:ABC:123:456");

			expect(parsed).toEqual({
				dataset: "sat_69b",
				id: "ABC:123:456",
			});
		});
	});
});
