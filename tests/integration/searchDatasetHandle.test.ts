import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/index";
import { SearchOfacEndpoint } from "../../src/endpoints/watchlist/searchOfac";
import { SearchSat69bEndpoint } from "../../src/endpoints/watchlist/searchSat69b";
import { SearchUnscEndpoint } from "../../src/endpoints/watchlist/searchUnsc";
import { createPrismaClient } from "../../src/lib/prisma";
import { normalizeIdentifier } from "../../src/lib/matching-utils";
import type { AppContext } from "../../src/types";

const prisma = createPrismaClient(env.DB);
const TEST_PREFIX = "search-handle-";

type SearchEndpoint =
	| SearchOfacEndpoint
	| SearchSat69bEndpoint
	| SearchUnscEndpoint;

function makeEndpoint(
	Endpoint: new (...args: any[]) => SearchEndpoint,
	body: Record<string, unknown>,
): SearchEndpoint {
	const endpoint = new (Endpoint as unknown as new () => SearchEndpoint)();
	(
		endpoint as unknown as { getValidatedData: () => Promise<unknown> }
	).getValidatedData = async () => ({ body });
	return endpoint;
}

function makeContext(overrides: Partial<Bindings> = {}): AppContext {
	return {
		env: {
			...(env as unknown as Bindings),
			...overrides,
		},
	} as unknown as AppContext;
}

function aiWithEmbedding(data: number[][] = [[0.1, 0.2, 0.3]]): Bindings["AI"] {
	return {
		run: vi.fn(async () => ({ data })),
	} as unknown as Bindings["AI"];
}

function vectorWithMatches(
	matches: Array<{ id: string; score?: number }> = [],
): Bindings["WATCHLIST_VECTORIZE"] {
	return {
		query: vi.fn(async () => ({ matches })),
	} as unknown as Bindings["WATCHLIST_VECTORIZE"];
}

async function seedIdentifierMatch(
	dataset: "ofac_sdn" | "sat_69b" | "unsc",
	recordId: string,
	raw: string,
): Promise<void> {
	await prisma.watchlistIdentifier.create({
		data: {
			dataset,
			recordId,
			identifierRaw: raw,
			identifierNorm: normalizeIdentifier(raw),
		},
	});
}

async function seedOfac(recordId: string, primaryName: string): Promise<void> {
	await prisma.ofacSdnEntry.create({
		data: {
			id: recordId,
			partyType: "Individual",
			primaryName,
			aliases: JSON.stringify([`${primaryName} Alias`]),
			birthDate: "1980-01-01",
			addresses: JSON.stringify(["Mexico"]),
			identifiers: JSON.stringify([{ type: "PASSPORT", number: "AB-123" }]),
			sourceList: "SDN",
		},
	});
}

async function seedSat69b(
	recordId: string,
	taxpayerName: string,
): Promise<void> {
	await prisma.sat69bEntry.create({
		data: {
			id: recordId,
			rfc: recordId,
			taxpayerName,
			taxpayerStatus: "Definitivo",
		},
	});
}

async function seedUnsc(recordId: string, primaryName: string): Promise<void> {
	await prisma.unscEntry.create({
		data: {
			id: recordId,
			partyType: "Individual",
			primaryName,
			aliases: JSON.stringify([`${primaryName} Alias`]),
			birthDate: "1975-05-05",
			nationalities: JSON.stringify(["MX"]),
			identifiers: JSON.stringify([{ type: "PASSPORT", number: "UN-123" }]),
			unListType: "TAL",
		},
	});
}

describe("dataset-specific search endpoint handle()", () => {
	afterEach(async () => {
		await prisma.watchlistIdentifier.deleteMany({
			where: { recordId: { startsWith: TEST_PREFIX } },
		});
		await prisma.ofacSdnEntry.deleteMany({
			where: { id: { startsWith: TEST_PREFIX } },
		});
		await prisma.sat69bEntry.deleteMany({
			where: { id: { startsWith: TEST_PREFIX } },
		});
		await prisma.unscEntry.deleteMany({
			where: { id: { startsWith: TEST_PREFIX } },
		});
		vi.restoreAllMocks();
	});

	it("returns an OFAC identifier match even when vector search has no hits", async () => {
		const recordId = `${TEST_PREFIX}ofac-id-${crypto.randomUUID()}`;
		await seedOfac(recordId, "Identifier OFAC Person");
		await seedIdentifierMatch("ofac_sdn", recordId, "AB-123");

		const endpoint = makeEndpoint(SearchOfacEndpoint, {
			q: "unrelated query",
			identifiers: ["AB-123"],
			topK: 10,
			threshold: 0.99,
		});

		const result = await endpoint.handle(
			makeContext({
				AI: aiWithEmbedding(),
				WATCHLIST_VECTORIZE: vectorWithMatches([]),
			}),
		);

		expect(result.result.count).toBe(1);
		expect(result.result.matches[0]?.target.id).toBe(recordId);
		expect(result.result.matches[0]?.breakdown.identifierMatch).toBe(true);
	});

	it("returns a SAT 69-B RFC identifier match", async () => {
		const recordId = `${TEST_PREFIX}RFC${crypto.randomUUID().slice(0, 8)}`;
		await seedSat69b(recordId, "Identifier SAT Taxpayer");
		await seedIdentifierMatch("sat_69b", recordId, recordId);

		const endpoint = makeEndpoint(SearchSat69bEndpoint, {
			q: "unrelated query",
			rfc: recordId,
			topK: 10,
			threshold: 0.99,
		});

		const result = await endpoint.handle(
			makeContext({
				AI: aiWithEmbedding(),
				WATCHLIST_VECTORIZE: vectorWithMatches([]),
			}),
		);

		expect(result.result.count).toBe(1);
		expect(result.result.matches[0]?.target.id).toBe(recordId);
		expect(result.result.matches[0]?.breakdown.identifierMatch).toBe(true);
	});

	it("returns a UNSC identifier match even when vector search has no hits", async () => {
		const recordId = `${TEST_PREFIX}unsc-id-${crypto.randomUUID()}`;
		await seedUnsc(recordId, "Identifier UNSC Person");
		await seedIdentifierMatch("unsc", recordId, "UN-123");

		const endpoint = makeEndpoint(SearchUnscEndpoint, {
			q: "unrelated query",
			identifiers: ["UN-123"],
			topK: 10,
			threshold: 0.99,
		});

		const result = await endpoint.handle(
			makeContext({
				AI: aiWithEmbedding(),
				WATCHLIST_VECTORIZE: vectorWithMatches([]),
			}),
		);

		expect(result.result.count).toBe(1);
		expect(result.result.matches[0]?.target.id).toBe(recordId);
		expect(result.result.matches[0]?.breakdown.identifierMatch).toBe(true);
	});

	it("hydrates and accepts vector-only hits for all datasets", async () => {
		const ofacId = `${TEST_PREFIX}ofac-vector-${crypto.randomUUID()}`;
		const satId = `${TEST_PREFIX}SAT${crypto.randomUUID().slice(0, 8)}`;
		const unscId = `${TEST_PREFIX}unsc-vector-${crypto.randomUUID()}`;
		await seedOfac(ofacId, "Vector OFAC Exact Person");
		await seedSat69b(satId, "Vector SAT Exact Taxpayer");
		await seedUnsc(unscId, "Vector UNSC Exact Person");

		const cases = [
			{
				Endpoint: SearchOfacEndpoint,
				body: { q: "Vector OFAC Exact Person", topK: 10, threshold: 0.75 },
				vectorId: `ofac_sdn:${ofacId}`,
				expectedId: ofacId,
			},
			{
				Endpoint: SearchSat69bEndpoint,
				body: { q: "Vector SAT Exact Taxpayer", topK: 10, threshold: 0.75 },
				vectorId: `sat_69b:${satId}`,
				expectedId: satId,
			},
			{
				Endpoint: SearchUnscEndpoint,
				body: { q: "Vector UNSC Exact Person", topK: 10, threshold: 0.75 },
				vectorId: `unsc:${unscId}`,
				expectedId: unscId,
			},
		] as const;

		for (const c of cases) {
			const endpoint = makeEndpoint(c.Endpoint, c.body);
			const result = await endpoint.handle(
				makeContext({
					AI: aiWithEmbedding(),
					WATCHLIST_VECTORIZE: vectorWithMatches([
						{ id: c.vectorId, score: 0.98 },
					]),
				}),
			);

			expect(result.result.count).toBe(1);
			expect(result.result.matches[0]?.target.id).toBe(c.expectedId);
			expect(result.result.matches[0]?.breakdown.identifierMatch).toBe(false);
		}
	});

	it("rejects vector candidates below the hybrid threshold", async () => {
		const recordId = `${TEST_PREFIX}ofac-low-${crypto.randomUUID()}`;
		await seedOfac(recordId, "Completely Different Person");

		const endpoint = makeEndpoint(SearchOfacEndpoint, {
			q: "No lexical overlap",
			topK: 10,
			threshold: 0.99,
			birthDate: "1900-01-01",
			countries: ["ZZ"],
		});

		const result = await endpoint.handle(
			makeContext({
				AI: aiWithEmbedding(),
				WATCHLIST_VECTORIZE: vectorWithMatches([
					{ id: `ofac_sdn:${recordId}`, score: 0.1 },
				]),
			}),
		);

		expect(result.result.count).toBe(0);
		expect(result.result.matches).toEqual([]);
	});

	it("throws 503 when required bindings are missing", async () => {
		const missingAi = makeEndpoint(SearchOfacEndpoint, {
			q: "missing ai",
			topK: 10,
			threshold: 0.875,
		});
		await expect(
			missingAi.handle(
				makeContext({
					AI: undefined,
					WATCHLIST_VECTORIZE: vectorWithMatches([]),
				}),
			),
		).rejects.toMatchObject({
			status: 503,
			message: "AI binding not available",
		});

		const missingVectorize = makeEndpoint(SearchSat69bEndpoint, {
			q: "missing vector",
			topK: 10,
			threshold: 0.875,
		});
		await expect(
			missingVectorize.handle(
				makeContext({
					AI: aiWithEmbedding(),
					WATCHLIST_VECTORIZE: undefined,
				}),
			),
		).rejects.toMatchObject({
			status: 503,
			message: "WATCHLIST_VECTORIZE not available",
		});
	});

	it("wraps embedding and vector search failures as API errors", async () => {
		const emptyEmbedding = makeEndpoint(SearchUnscEndpoint, {
			q: "empty embedding",
			topK: 10,
			threshold: 0.875,
		});
		await expect(
			emptyEmbedding.handle(
				makeContext({
					AI: aiWithEmbedding([]),
					WATCHLIST_VECTORIZE: vectorWithMatches([]),
				}),
			),
		).rejects.toMatchObject({
			status: 500,
			message: "Failed to generate embedding",
		});

		const vectorFailure = makeEndpoint(SearchOfacEndpoint, {
			q: "vector failure",
			topK: 10,
			threshold: 0.875,
		});
		await expect(
			vectorFailure.handle(
				makeContext({
					AI: aiWithEmbedding(),
					WATCHLIST_VECTORIZE: {
						query: vi.fn(async () => {
							throw new Error("vector exploded");
						}),
					} as unknown as Bindings["WATCHLIST_VECTORIZE"],
				}),
			),
		).rejects.toMatchObject({
			status: 500,
			message: "vector exploded",
		});
	});
});
