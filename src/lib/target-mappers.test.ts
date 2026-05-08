import type { OfacSdnEntry, Sat69bEntry, UnscEntry } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { toOfacTarget, toSat69bTarget, toUnscTarget } from "./target-mappers";

describe("target-mappers", () => {
	const fixed = new Date("2024-06-01T12:00:00.000Z");

	it("toOfacTarget parses JSON fields and ISO dates", () => {
		const row: OfacSdnEntry = {
			id: "ofac-1",
			partyType: "Individual",
			primaryName: "Jane Example",
			aliases: JSON.stringify(["J. Example"]),
			birthDate: "1980-05-05",
			birthPlace: "US",
			addresses: JSON.stringify(["Line 1"]),
			identifiers: JSON.stringify([
				{ type: "PASSPORT", number: "P1", country: "US" },
			]),
			remarks: "note",
			sourceList: "SDN",
			createdAt: fixed,
			updatedAt: fixed,
		};

		const t = toOfacTarget(row);
		expect(t.id).toBe(row.id);
		expect(t.aliases).toEqual(["J. Example"]);
		expect(t.identifiers?.[0]?.number).toBe("P1");
		expect(t.createdAt).toBe(fixed.toISOString());
		expect(toOfacTarget({ ...row, aliases: null }).aliases).toBeNull();
	});

	it("toUnscTarget parses JSON arrays", () => {
		const row: UnscEntry = {
			id: "unsc-1",
			partyType: "Individual",
			primaryName: "John UNSC",
			aliases: JSON.stringify(["J. U."]),
			birthDate: null,
			birthPlace: null,
			gender: null,
			addresses: JSON.stringify(["Addr"]),
			nationalities: JSON.stringify(["MX"]),
			identifiers: JSON.stringify([{ type: "NIT", number: "N1" }]),
			designations: JSON.stringify(["Officer"]),
			remarks: null,
			unListType: "DRC",
			referenceNumber: "REF-1",
			listedOn: "2020-01-01",
			createdAt: fixed,
			updatedAt: fixed,
		};

		const t = toUnscTarget(row);
		expect(t.id).toBe("unsc-1");
		expect(t.nationalities).toEqual(["MX"]);
		expect(t.designations).toEqual(["Officer"]);
		expect(
			toUnscTarget({ ...row, nationalities: null }).nationalities,
		).toBeNull();
	});

	it("toSat69bTarget maps phase columns", () => {
		const row: Sat69bEntry = {
			id: "RFC123456ABC",
			rowNumber: 1,
			rfc: "RFC123456ABC",
			taxpayerName: "Acme SA",
			taxpayerStatus: "Presunto",
			presumptionSatNotice: "PSN",
			presumptionSatDate: "2021-01-01",
			presumptionDofNotice: null,
			presumptionDofDate: null,
			rebuttalSatNotice: null,
			rebuttalSatDate: null,
			rebuttalDofNotice: null,
			rebuttalDofDate: null,
			definitiveSatNotice: null,
			definitiveSatDate: null,
			definitiveDofNotice: null,
			definitiveDofDate: null,
			favorableSatNotice: null,
			favorableSatDate: null,
			favorableDofNotice: null,
			favorableDofDate: null,
			createdAt: fixed,
			updatedAt: fixed,
		};

		const t = toSat69bTarget(row);
		expect(t.id).toBe(row.id);
		expect(t.taxpayerName).toBe("Acme SA");
		expect(t.presumptionPhase?.satNotice).toBe("PSN");
		expect(t.presumptionPhase?.dofNotice).toBeNull();
	});
});
