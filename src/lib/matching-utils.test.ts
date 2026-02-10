import { describe, expect, it } from "vitest";
import {
	normalizeIdentifier,
	normalizeIdentifierType,
	normalizeName,
	jaroWinkler,
	bestNameScore,
	computeMetaScore,
	computeHybridScore,
} from "./matching-utils";

describe("matching-utils", () => {
	describe("normalizeIdentifier", () => {
		it("should normalize real OFAC identifier examples", () => {
			// RFC examples
			expect(normalizeIdentifier("HEMA-621127")).toBe("HEMA621127");
			expect(normalizeIdentifier("MOML-530526-ED4")).toBe("MOML530526ED4");

			// NIT examples
			expect(normalizeIdentifier("800113437-2")).toBe("8001134372");

			// Passport examples with spaces
			expect(normalizeIdentifier("B 960789")).toBe("B960789");
			expect(normalizeIdentifier("G 649385")).toBe("G649385");

			// Already clean
			expect(normalizeIdentifier("96020025125")).toBe("96020025125");

			// Mixed case
			expect(normalizeIdentifier("abc-123-xyz")).toBe("ABC123XYZ");
		});

		it("should handle empty and edge cases", () => {
			expect(normalizeIdentifier("")).toBe("");
			expect(normalizeIdentifier("---")).toBe("");
			expect(normalizeIdentifier("   ")).toBe("");
		});

		it("should strip all non-alphanumeric characters", () => {
			expect(normalizeIdentifier("A/B/C-123.456#789")).toBe("ABC123456789");
			expect(normalizeIdentifier("(123) 456-7890")).toBe("1234567890");
		});
	});

	describe("normalizeIdentifierType", () => {
		it("should normalize real OFAC type examples", () => {
			expect(normalizeIdentifierType("R.F.C.")).toBe("RFC");
			expect(normalizeIdentifierType("NIT #")).toBe("NIT");
			expect(normalizeIdentifierType("Passport")).toBe("PASSPORT");
			expect(normalizeIdentifierType("Cedula No.")).toBe("CEDULANO");
			expect(normalizeIdentifierType("National ID")).toBe("NATIONALID");
		});

		it("should handle mixed case and extra whitespace", () => {
			expect(normalizeIdentifierType("  r.f.c.  ")).toBe("RFC");
			expect(normalizeIdentifierType("NIT-#")).toBe("NIT");
		});
	});

	describe("normalizeName", () => {
		it("should normalize names with diacritics", () => {
			expect(normalizeName("José García")).toBe("JOSE GARCIA");
			expect(normalizeName("María González Fernández")).toBe(
				"MARIA GONZALEZ FERNANDEZ",
			);
			expect(normalizeName("Müller")).toBe("MULLER");
			expect(normalizeName("François")).toBe("FRANCOIS");
		});

		it("should handle punctuation and multiple spaces", () => {
			expect(normalizeName("María  González-Fernández")).toBe(
				"MARIA GONZALEZ FERNANDEZ",
			);
			expect(normalizeName("O'Brien")).toBe("O BRIEN");
			expect(normalizeName("Jean-Paul")).toBe("JEAN PAUL");
		});

		it("should collapse whitespace", () => {
			expect(normalizeName("Juan    Carlos     Perez")).toBe(
				"JUAN CARLOS PEREZ",
			);
			expect(normalizeName("  Name  ")).toBe("NAME");
		});
	});

	describe("jaroWinkler", () => {
		it("should return 1.0 for exact matches", () => {
			expect(jaroWinkler("MARTHA", "MARTHA")).toBe(1.0);
			expect(jaroWinkler("DWAYNE", "DWAYNE")).toBe(1.0);
			expect(jaroWinkler("", "")).toBe(1.0);
		});

		it("should return 0.0 for empty strings", () => {
			expect(jaroWinkler("MARTHA", "")).toBe(0.0);
			expect(jaroWinkler("", "DWAYNE")).toBe(0.0);
		});

		it("should return high scores for similar names", () => {
			// Known Jaro-Winkler examples
			const score1 = jaroWinkler("MARTHA", "MARHTA");
			expect(score1).toBeGreaterThan(0.9);

			const score2 = jaroWinkler("DWAYNE", "DUANE");
			expect(score2).toBeGreaterThan(0.8);

			const score3 = jaroWinkler("DIXON", "DICKSONX");
			expect(score3).toBeGreaterThan(0.7);
		});

		it("should return low scores for different names", () => {
			const score = jaroWinkler("JOHN", "MARY");
			expect(score).toBeLessThan(0.5);
		});

		it("should handle case sensitivity", () => {
			// Jaro-Winkler is case-sensitive, so should be used with normalized names
			const score1 = jaroWinkler("MARTHA", "martha");
			expect(score1).toBeLessThan(1.0);

			const score2 = jaroWinkler("MARTHA", "MARTHA");
			expect(score2).toBe(1.0);
		});
	});

	describe("bestNameScore", () => {
		it("should return score for primary name", () => {
			const score = bestNameScore("José García", "José García", null);
			expect(score).toBe(1.0);
		});

		it("should return max score from name and aliases", () => {
			const score = bestNameScore("JP Perez", "Juan Carlos Perez", [
				"JP Perez",
				"JC Perez",
			]);
			expect(score).toBe(1.0); // Exact match with alias
		});

		it("should handle diacritics via normalization", () => {
			const score = bestNameScore("Jose Garcia", "José García", null);
			expect(score).toBe(1.0); // After normalization, they match
		});

		it("should find best match among aliases", () => {
			const score = bestNameScore(
				"Roberto Fernandez",
				"Roberto Fernández Díaz",
				["R. Fernández", "Roberto F. Díaz", "El Ministro"],
			);
			// Should find good match with primary name or aliases
			expect(score).toBeGreaterThan(0.8);
		});

		it("should handle null aliases", () => {
			const score = bestNameScore("Juan Perez", "Juan Perez Lopez", null);
			expect(score).toBeGreaterThan(0.8);
		});

		it("should handle empty aliases array", () => {
			const score = bestNameScore("Juan Perez", "Juan Perez Lopez", []);
			expect(score).toBeGreaterThan(0.8);
		});
	});

	describe("computeMetaScore", () => {
		it("should return 1.0 for birthDate and countries match", () => {
			const score = computeMetaScore("1980-01-15", ["MX", "US"], "1980-01-15", [
				"MX",
				"CO",
			]);
			expect(score).toBe(1.0); // 0.5 for birthDate + 0.5 for country overlap
		});

		it("should return 0.5 for birthDate match only", () => {
			const score = computeMetaScore("1980-01-15", ["MX"], "1980-01-15", [
				"CO",
			]);
			expect(score).toBe(0.5);
		});

		it("should return 0.5 for countries overlap only", () => {
			const score = computeMetaScore("1980-01-15", ["MX", "US"], "1985-03-20", [
				"US",
				"CO",
			]);
			expect(score).toBe(0.5);
		});

		it("should return 0.0 for no match", () => {
			const score = computeMetaScore("1980-01-15", ["MX"], "1985-03-20", [
				"CO",
			]);
			expect(score).toBe(0.0);
		});

		it("should handle null/undefined inputs", () => {
			expect(computeMetaScore(null, null, null, null)).toBe(0.0);
			expect(computeMetaScore(undefined, undefined, undefined, undefined)).toBe(
				0.0,
			);
			expect(computeMetaScore("1980-01-15", null, "1980-01-15", null)).toBe(
				0.5,
			);
		});

		it("should handle case-insensitive country matching", () => {
			const score = computeMetaScore(null, ["mx"], null, ["MX"]);
			expect(score).toBe(0.5);
		});
	});

	describe("computeHybridScore", () => {
		it("should apply correct weights: 0.55v + 0.35n + 0.10m", () => {
			const score = computeHybridScore(1.0, 1.0, 1.0);
			expect(score).toBe(1.0);

			const score2 = computeHybridScore(0.9, 0.8, 0.5);
			const expected = 0.55 * 0.9 + 0.35 * 0.8 + 0.1 * 0.5;
			expect(score2).toBeCloseTo(expected);
		});

		it("should handle all-zero inputs", () => {
			const score = computeHybridScore(0, 0, 0);
			expect(score).toBe(0.0);
		});

		it("should prioritize vector score (55%)", () => {
			const score1 = computeHybridScore(1.0, 0.0, 0.0);
			expect(score1).toBe(0.55);

			const score2 = computeHybridScore(0.0, 1.0, 0.0);
			expect(score2).toBe(0.35);

			const score3 = computeHybridScore(0.0, 0.0, 1.0);
			expect(score3).toBe(0.1);
		});

		it("should handle edge case scenarios", () => {
			// High vector, low name/meta
			const score1 = computeHybridScore(0.95, 0.3, 0.0);
			expect(score1).toBeCloseTo(0.55 * 0.95 + 0.35 * 0.3);

			// Low vector, high name/meta
			const score2 = computeHybridScore(0.3, 0.95, 1.0);
			expect(score2).toBeCloseTo(0.55 * 0.3 + 0.35 * 0.95 + 0.1 * 1.0);
		});
	});
});
