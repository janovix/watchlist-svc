import { OpenAPIRoute, ApiException } from "chanfana";
import { AppContext } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import { createPrismaClient } from "../../lib/prisma";
import { parseVectorId } from "../../lib/ofac-vectorize-service";
import {
	normalizeIdentifier,
	bestNameScore,
	computeMetaScore,
	computeHybridScore,
} from "../../lib/matching-utils";

// Identifier schema
export const unscIdentifierSchema = z.object({
	type: z.string().optional(),
	number: z.string().optional(),
});

// UNSC target schema - all fields from UnscEntry
export const unscTarget = z.object({
	id: z.string(),
	partyType: z.string(),
	primaryName: z.string(),
	aliases: z.array(z.string()).nullable(),
	birthDate: z.string().nullable(),
	birthPlace: z.string().nullable(),
	gender: z.string().nullable(),
	nationalities: z.array(z.string()).nullable(),
	addresses: z.array(z.string()).nullable(),
	identifiers: z.array(unscIdentifierSchema).nullable(),
	designations: z.array(z.string()).nullable(),
	remarks: z.string().nullable(),
	unListType: z.string(),
	referenceNumber: z.string().nullable(),
	listedOn: z.string().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

// Score breakdown
export const unscScoreBreakdown = z.object({
	vectorScore: z.number(),
	nameScore: z.number(),
	metaScore: z.number(),
	identifierMatch: z.boolean(),
});

// UNSC match
export const unscMatch = z.object({
	target: unscTarget,
	score: z.number(),
	breakdown: unscScoreBreakdown,
});

export class SearchUnscEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Search"],
		summary: "Search UN Security Council sanctions list using hybrid search",
		operationId: "searchUnsc",
		request: {
			body: contentJson(
				z.object({
					q: z.string().min(1, "Query string is required"),
					birthDate: z.string().optional(),
					identifiers: z.array(z.string()).optional(),
					topK: z.number().int().min(1).max(100).optional().default(20),
					threshold: z.number().min(0).max(1).optional().default(0.85),
				}),
			),
		},
		responses: {
			"200": {
				description: "UNSC search results",
				...contentJson({
					success: Boolean,
					result: z.object({
						matches: z.array(unscMatch),
						count: z.number(),
					}),
				}),
			},
			"400": {
				description: "Bad request",
				...contentJson({
					success: Boolean,
					errors: z.array(
						z.object({
							code: z.number(),
							message: z.string(),
						}),
					),
				}),
			},
			"503": {
				description: "Service unavailable",
				...contentJson({
					success: Boolean,
					errors: z.array(
						z.object({
							code: z.number(),
							message: z.string(),
						}),
					),
				}),
			},
		},
	};

	public async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const prisma = createPrismaClient(c.env.DB);

		console.log("[SearchUnsc] Starting UNSC search", {
			q: data.body.q,
			topK: data.body.topK,
			threshold: data.body.threshold,
		});

		try {
			// Check required services
			if (!c.env.AI) {
				const error = new ApiException("AI binding not available");
				error.status = 503;
				error.code = 503;
				throw error;
			}

			if (!c.env.WATCHLIST_VECTORIZE) {
				const error = new ApiException("WATCHLIST_VECTORIZE not available");
				error.status = 503;
				error.code = 503;
				throw error;
			}

			// Step A: Exact identifier lookup (if provided)
			const candidateMap = new Map<
				string,
				{
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					target: any;
					vectorScore: number;
					identifierMatch: boolean;
					dataset: string;
				}
			>();

			if (data.body.identifiers && data.body.identifiers.length > 0) {
				console.log("[SearchUnsc] Step A: Identifier lookup");

				const normalizedIdentifiers = data.body.identifiers.map((id) =>
					normalizeIdentifier(id),
				);

				const identifierMatches = await prisma.$queryRaw<
					Array<{ dataset: string; record_id: string }>
				>`
					SELECT dataset, record_id
					FROM watchlist_identifier
					WHERE dataset = 'unsc'
					AND identifier_norm IN (${normalizedIdentifiers.join(",")})
				`;

				console.log("[SearchUnsc] Identifier matches:", {
					count: identifierMatches.length,
				});

				if (identifierMatches.length > 0) {
					const unscIds = identifierMatches.map((row) => row.record_id);

					const unscRecords = await prisma.unscEntry.findMany({
						where: { id: { in: unscIds } },
					});

					for (const record of unscRecords) {
						const target = {
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
							identifiers: record.identifiers
								? JSON.parse(record.identifiers)
								: null,
							designations: record.designations
								? JSON.parse(record.designations)
								: null,
							remarks: record.remarks,
							unListType: record.unListType,
							referenceNumber: record.referenceNumber,
							listedOn: record.listedOn,
							createdAt: record.createdAt.toISOString(),
							updatedAt: record.updatedAt.toISOString(),
						};

						candidateMap.set(record.id, {
							target,
							vectorScore: 0,
							identifierMatch: true,
							dataset: "unsc",
						});
					}
				}
			}

			// Step B: Vector search
			console.log("[SearchUnsc] Step B: Vector search");

			const queryResponse = (await c.env.AI.run("@cf/baai/bge-base-en-v1.5", {
				text: [data.body.q],
			})) as { data: number[][] };

			if (
				!queryResponse ||
				!Array.isArray(queryResponse.data) ||
				queryResponse.data.length === 0
			) {
				const error = new ApiException("Failed to generate embedding");
				error.status = 500;
				error.code = 500;
				throw error;
			}

			const embedding = queryResponse.data[0] as number[];

			const vectorizeResults = await c.env.WATCHLIST_VECTORIZE.query(
				embedding,
				{
					topK: data.body.topK,
					returnMetadata: true,
					filter: { dataset: "unsc" },
				},
			);

			console.log("[SearchUnsc] Vectorize matches:", {
				count: vectorizeResults.matches.length,
			});

			// Step C: Fetch and hydrate UNSC records
			const unscIdsToFetch: string[] = [];

			for (const match of vectorizeResults.matches) {
				const { dataset, id: recordId } = parseVectorId(match.id);

				if (dataset === "unsc" && !candidateMap.has(recordId)) {
					unscIdsToFetch.push(recordId);
					candidateMap.set(recordId, {
						target: null,
						vectorScore: match.score || 0,
						identifierMatch: false,
						dataset,
					});
				}
			}

			if (unscIdsToFetch.length > 0) {
				const unscRecords = await prisma.unscEntry.findMany({
					where: { id: { in: unscIdsToFetch } },
				});

				for (const record of unscRecords) {
					const candidate = candidateMap.get(record.id);
					if (candidate) {
						candidate.target = {
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
							identifiers: record.identifiers
								? JSON.parse(record.identifiers)
								: null,
							designations: record.designations
								? JSON.parse(record.designations)
								: null,
							remarks: record.remarks,
							unListType: record.unListType,
							referenceNumber: record.referenceNumber,
							listedOn: record.listedOn,
							createdAt: record.createdAt.toISOString(),
							updatedAt: record.updatedAt.toISOString(),
						};
					}
				}
			}

			// Step D: Hybrid scoring
			console.log("[SearchUnsc] Step D: Computing hybrid scores");

			const matches: Array<{
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				target: any;
				score: number;
				breakdown: {
					vectorScore: number;
					nameScore: number;
					metaScore: number;
					identifierMatch: boolean;
				};
			}> = [];

			for (const [, candidate] of candidateMap) {
				if (!candidate.target) continue;

				const nameScore = bestNameScore(
					data.body.q,
					candidate.target.primaryName,
					candidate.target.aliases,
				);

				const metaScore = computeMetaScore(
					data.body.birthDate,
					undefined,
					candidate.target.birthDate,
					undefined,
				);

				const hybridScore = computeHybridScore(
					candidate.vectorScore,
					nameScore,
					metaScore,
				);

				if (hybridScore >= data.body.threshold) {
					matches.push({
						target: candidate.target,
						score: hybridScore,
						breakdown: {
							vectorScore: candidate.vectorScore,
							nameScore,
							metaScore,
							identifierMatch: candidate.identifierMatch,
						},
					});
				}
			}

			// Sort by score descending
			matches.sort((a, b) => b.score - a.score);

			console.log("[SearchUnsc] Search completed", {
				totalMatches: matches.length,
				threshold: data.body.threshold,
			});

			return {
				success: true,
				result: {
					matches,
					count: matches.length,
				},
			};
		} catch (error) {
			console.error("[SearchUnsc] Error during search", {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});

			if (error instanceof ApiException) {
				throw error;
			}

			const apiError = new ApiException(
				error instanceof Error
					? error.message
					: "An unexpected error occurred during UNSC search",
			);
			apiError.status = 500;
			apiError.code = 500;
			throw apiError;
		}
	}
}
