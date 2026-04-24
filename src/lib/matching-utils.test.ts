import { describe, expect, it } from "vitest";
import {
	normalizeIdentifier,
	normalizeIdentifierType,
	normalizeName,
	jaroWinkler,
	bestNameScore,
	computeMetaScore,
	computeMetaSignal,
	computeHybridScore,
	passesMatchFilter,
	parseRfcBirthDate,
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

		it("should handle name reordering with token-sorted matching", () => {
			// "Joaquin GUZMAN LOERA" vs "GUZMAN LOERA Joaquin" should score high
			const score = bestNameScore(
				"Joaquin GUZMAN LOERA",
				"GUZMAN LOERA Joaquin",
				null,
			);
			expect(score).toBe(1.0); // Tokens are the same, just reordered
		});

		it("should handle partial name reordering", () => {
			// "LOERA GUZMAN" vs "GUZMAN LOERA" should score high with token-sorted
			const score = bestNameScore("LOERA GUZMAN", "GUZMAN LOERA", null);
			expect(score).toBe(1.0);
		});

		it("should still find best match with reordered aliases", () => {
			const score = bestNameScore("Carlos Juan Perez", "Juan Carlos Perez", [
				"Perez Juan Carlos",
				"JC Perez",
			]);
			expect(score).toBe(1.0); // Should match via token-sorted
		});

		it("should not over-match when only generic term overlaps (INMOBILIARIA)", () => {
			// Query: INMOBILIARIA MORALES; target: different company with same generic prefix
			const score = bestNameScore(
				"INMOBILIARIA MORALES",
				"INMOBILIARIA EL ESCORPION DEL NORTE S.A. DE C.V.",
				null,
			);
			expect(score).toBeLessThan(0.7); // So hybrid score stays below default threshold
		});

		it("should still match same entity when discriminative token matches (INMOBILIARIA MORALES)", () => {
			const score = bestNameScore(
				"INMOBILIARIA MORALES",
				"INMOBILIARIA MORALES SA DE CV",
				null,
			);
			expect(score).toBeGreaterThan(0.85);
		});

		it("should not cap person names (no generic-term-only overlap)", () => {
			const score1 = bestNameScore("Juan García", "Juan García López", null);
			expect(score1).toBeGreaterThan(0.85);

			const score2 = bestNameScore("José García", "José García", null);
			expect(score2).toBe(1.0);
		});

		it("should allow subset query to match full legal name (Joaquin Guzman vs Chapo)", () => {
			const s = bestNameScore(
				"JOAQUIN GUZMAN",
				"JOAQUIN ARCHIVALDO GUZMAN LOERA",
				null,
			);
			expect(s).toBeGreaterThanOrEqual(0.9);
		});

		it("should not match a homonym with an extra paternal-style token (Guzman Perez vs Chapo)", () => {
			const s = bestNameScore(
				"JOAQUIN GUZMAN PEREZ",
				"JOAQUIN ARCHIVALDO GUZMAN LOERA",
				null,
			);
			expect(s).toBeLessThan(0.75);
		});

		it("should not treat different paternal surnames as a match (Carlos Lopez Morales)", () => {
			const s = bestNameScore(
				"CARLOS LOPEZ MORALES",
				"GONZALEZ MORALES CARLOS",
				null,
			);
			expect(s).toBeLessThan(0.75);
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
			const score = computeMetaScore(
				"1980-01-15",
				undefined,
				"1980-01-15",
				undefined,
			);
			expect(score).toBe(0.5);
		});

		it("should return 0.5 for countries overlap only", () => {
			const score = computeMetaScore(null, ["MX", "US"], null, ["US", "CO"]);
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

	describe("computeMetaSignal", () => {
		it("returns mismatch when birth dates disagree", () => {
			const r = computeMetaSignal("1962-03-03", ["MX"], "1958-07-12", ["MX"]);
			expect(r.mismatch).toBe(true);
			expect(r.score).toBe(0);
		});
	});

	describe("parseRfcBirthDate", () => {
		it("returns ISO date for 13-char natural person RFC (example: GOMC620303H45)", () => {
			expect(parseRfcBirthDate("GOMC620303H45")).toBe("1962-03-03");
		});

		it("returns null for 12-char legal-entity style RFC", () => {
			expect(parseRfcBirthDate("ABC850101XYZ1")).toBeNull();
		});
	});

	describe("computeHybridScore", () => {
		it("should apply correct weights: 0.35v + 0.55n + 0.10m", () => {
			const score = computeHybridScore(1.0, 1.0, 1.0);
			expect(score).toBe(1.0);

			const score2 = computeHybridScore(0.9, 0.8, 0.5);
			const expected = 0.35 * 0.9 + 0.55 * 0.8 + 0.1 * 0.5;
			expect(score2).toBeCloseTo(expected);
		});

		it("should handle all-zero inputs", () => {
			const score = computeHybridScore(0, 0, 0);
			expect(score).toBe(0.0);
		});

		it("should prioritize name score (55%)", () => {
			const score1 = computeHybridScore(1.0, 0.0, 0.0);
			expect(score1).toBe(0.35);

			const score2 = computeHybridScore(0.0, 1.0, 0.0);
			expect(score2).toBe(0.55);

			const score3 = computeHybridScore(0.0, 0.0, 1.0);
			expect(score3).toBe(0.1);
		});

		it("should handle edge case scenarios", () => {
			// High vector, low name/meta
			const score1 = computeHybridScore(0.95, 0.3, 0.0);
			expect(score1).toBeCloseTo(0.35 * 0.95 + 0.55 * 0.3);

			// Low vector, high name/meta
			const score2 = computeHybridScore(0.3, 0.95, 1.0);
			expect(score2).toBeCloseTo(0.35 * 0.3 + 0.55 * 0.95 + 0.1 * 1.0);
		});

		it("should allow GUZMAN LOERA case to pass threshold 0.7", () => {
			// nameScore = 1.0 (exact match after normalization)
			// vectorScore = 0.65 (estimated from real case)
			// metaScore = 0 (no metadata provided)
			const score = computeHybridScore(0.65, 1.0, 0.0);
			expect(score).toBeCloseTo(0.35 * 0.65 + 0.55 * 1.0); // ~0.7775
			expect(score).toBeGreaterThan(0.7); // Should pass threshold
		});
	});

	describe("passesMatchFilter", () => {
		const threshold = 0.875;
		const ok = { corroborated: true as const, mismatch: false as const };

		it("returns true when hybrid >= threshold", () => {
			expect(passesMatchFilter(0.9, 0.5, threshold, ok)).toBe(true);
			expect(passesMatchFilter(0.875, 0, threshold, ok)).toBe(true);
			expect(passesMatchFilter(1.0, 0, threshold, ok)).toBe(true);
		});

		it("returns true when hybrid < threshold but name >= 0.9 and hybrid >= 0.7 and corroborated", () => {
			expect(passesMatchFilter(0.78, 0.95, threshold, ok)).toBe(true);
			expect(passesMatchFilter(0.788, 1.0, threshold, ok)).toBe(true); // Oseguera case
			expect(passesMatchFilter(0.74, 0.91, threshold, ok)).toBe(true); // Guzman case
			expect(passesMatchFilter(0.7, 0.9, threshold, ok)).toBe(true);
		});

		it("returns false on metadata mismatch even with high hybrid and name", () => {
			expect(
				passesMatchFilter(0.95, 1.0, threshold, {
					corroborated: true,
					mismatch: true,
				}),
			).toBe(false);
		});

		it("returns false when override would apply but not corroborated and user gave metadata", () => {
			expect(
				passesMatchFilter(0.75, 0.95, threshold, {
					corroborated: false,
					mismatch: false,
				}),
			).toBe(false);
		});

		it("returns false when hybrid < threshold and name < 0.9", () => {
			expect(passesMatchFilter(0.78, 0.87, threshold, ok)).toBe(false);
			expect(passesMatchFilter(0.71, 0.87, threshold, ok)).toBe(false); // CONSTRUCTORA CASTILLO case
		});

		it("returns false when hybrid < 0.7 even with name >= 0.9", () => {
			expect(passesMatchFilter(0.65, 0.95, threshold, ok)).toBe(false);
			expect(passesMatchFilter(0.69, 1.0, threshold, ok)).toBe(false);
		});
	});
});
