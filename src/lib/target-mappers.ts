/**
 * Map Prisma watchlist rows to API response shapes (OFAC / UNSC / SAT-69-B).
 */

import type { OfacSdnEntry, Sat69bEntry, UnscEntry } from "@prisma/client";

export type OfacTargetType = {
	id: string;
	partyType: string;
	primaryName: string;
	aliases: string[] | null;
	birthDate: string | null;
	birthPlace: string | null;
	addresses: string[] | null;
	identifiers: Array<{
		type?: string;
		number?: string;
		country?: string;
		issueDate?: string;
		expirationDate?: string;
	}> | null;
	remarks: string | null;
	sourceList: string;
	createdAt: string;
	updatedAt: string;
};

export type UnscTargetType = {
	id: string;
	partyType: string;
	primaryName: string;
	aliases: string[] | null;
	birthDate: string | null;
	birthPlace: string | null;
	gender: string | null;
	nationalities: string[] | null;
	addresses: string[] | null;
	identifiers: Array<{ type?: string; number?: string }> | null;
	designations: string[] | null;
	remarks: string | null;
	unListType: string;
	referenceNumber: string | null;
	listedOn: string | null;
	createdAt: string;
	updatedAt: string;
};

export type Sat69bTargetType = {
	id: string;
	rfc: string;
	taxpayerName: string;
	taxpayerStatus: string;
	presumptionPhase: {
		satNotice: string | null;
		satDate: string | null;
		dofNotice: string | null;
		dofDate: string | null;
	} | null;
	rebuttalPhase: {
		satNotice: string | null;
		satDate: string | null;
		dofNotice: string | null;
		dofDate: string | null;
	} | null;
	definitivePhase: {
		satNotice: string | null;
		satDate: string | null;
		dofNotice: string | null;
		dofDate: string | null;
	} | null;
	favorablePhase: {
		satNotice: string | null;
		satDate: string | null;
		dofNotice: string | null;
		dofDate: string | null;
	} | null;
	createdAt: string;
	updatedAt: string;
};

export function toOfacTarget(record: OfacSdnEntry): OfacTargetType {
	return {
		id: record.id,
		partyType: record.partyType,
		primaryName: record.primaryName,
		aliases: record.aliases ? JSON.parse(record.aliases) : null,
		birthDate: record.birthDate,
		birthPlace: record.birthPlace,
		addresses: record.addresses ? JSON.parse(record.addresses) : null,
		identifiers: record.identifiers ? JSON.parse(record.identifiers) : null,
		remarks: record.remarks,
		sourceList: record.sourceList,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}

export function toUnscTarget(record: UnscEntry): UnscTargetType {
	return {
		id: record.id,
		partyType: record.partyType,
		primaryName: record.primaryName,
		aliases: record.aliases ? JSON.parse(record.aliases) : null,
		birthDate: record.birthDate,
		birthPlace: record.birthPlace,
		gender: record.gender,
		nationalities: record.nationalities
			? JSON.parse(record.nationalities)
			: null,
		addresses: record.addresses ? JSON.parse(record.addresses) : null,
		identifiers: record.identifiers ? JSON.parse(record.identifiers) : null,
		designations: record.designations ? JSON.parse(record.designations) : null,
		remarks: record.remarks,
		unListType: record.unListType,
		referenceNumber: record.referenceNumber,
		listedOn: record.listedOn,
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}

export function toSat69bTarget(record: Sat69bEntry): Sat69bTargetType {
	return {
		id: record.id,
		rfc: record.rfc,
		taxpayerName: record.taxpayerName,
		taxpayerStatus: record.taxpayerStatus,
		presumptionPhase: {
			satNotice: record.presumptionSatNotice,
			satDate: record.presumptionSatDate,
			dofNotice: record.presumptionDofNotice,
			dofDate: record.presumptionDofDate,
		},
		rebuttalPhase: {
			satNotice: record.rebuttalSatNotice,
			satDate: record.rebuttalSatDate,
			dofNotice: record.rebuttalDofNotice,
			dofDate: record.rebuttalDofDate,
		},
		definitivePhase: {
			satNotice: record.definitiveSatNotice,
			satDate: record.definitiveSatDate,
			dofNotice: record.definitiveDofNotice,
			dofDate: record.definitiveDofDate,
		},
		favorablePhase: {
			satNotice: record.favorableSatNotice,
			satDate: record.favorableSatDate,
			dofNotice: record.favorableDofNotice,
			dofDate: record.favorableDofDate,
		},
		createdAt: record.createdAt.toISOString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}
