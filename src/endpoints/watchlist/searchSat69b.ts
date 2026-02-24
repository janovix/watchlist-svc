import { OpenAPIRoute, ApiException } from "chanfana";
import { AppContext } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import { createPrismaClient } from "../../lib/prisma";
import { parseVectorId } from "../../lib/ofac-vectorize-service";
import {
	normalizeIdentifier,
	bestNameScore,
	computeHybridScore,
} from "../../lib/matching-utils";

// SAT 69-B phase schema
export const sat69bPhase = z.object({
	satNotice: z.string().nullable(),
	satDate: z.string().nullable(),
	dofNotice: z.string().nullable(),
	dofDate: z.string().nullable(),
});

// SAT 69-B target schema - all fields from Sat69bEntry
export const sat69bTarget = z.object({
	id: z.string(),
	rfc: z.string(),
	taxpayerName: z.string(),
	taxpayerStatus: z.string(),
	presumptionPhase: sat69bPhase.nullable(),
	rebuttalPhase: sat69bPhase.nullable(),
	definitivePhase: sat69bPhase.nullable(),
	favorablePhase: sat69bPhase.nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

// Score breakdown
export const sat69bScoreBreakdown = z.object({
	vectorScore: z.number(),
	nameScore: z.number(),
	metaScore: z.number(),
	identifierMatch: z.boolean(),
});

// SAT 69-B match
export const sat69bMatch = z.object({
	target: sat69bTarget,
	score: z.number(),
	breakdown: sat69bScoreBreakdown,
});

export class SearchSat69bEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Search"],
		summary: "Search SAT 69-B list using hybrid search",
		operationId: "searchSat69b",
		request: {
			body: contentJson(
				z.object({
					q: z.string().min(1, "Query string is required"),
					rfc: z.string().optional(),
					topK: z.number().int().min(1).max(100).optional().default(50),
					threshold: z.number().min(0).max(1).optional().default(0.7),
				}),
			),
		},
		responses: {
			"200": {
				description: "SAT 69-B search results",
				...contentJson({
					success: Boolean,
					result: z.object({
						matches: z.array(sat69bMatch),
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

		console.log("[SearchSat69b] Starting SAT 69-B search", {
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

			// Step A: Exact identifier lookup (if RFC provided)
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

			if (data.body.rfc) {
				console.log("[SearchSat69b] Step A: RFC lookup");

				const normalizedRfc = normalizeIdentifier(data.body.rfc);

				const identifierMatches = await prisma.$queryRaw<
					Array<{ dataset: string; record_id: string }>
				>`
					SELECT dataset, record_id
					FROM watchlist_identifier
					WHERE dataset = 'sat_69b'
					AND identifier_norm = ${normalizedRfc}
				`;

				console.log("[SearchSat69b] RFC matches:", {
					count: identifierMatches.length,
				});

				if (identifierMatches.length > 0) {
					const sat69bIds = identifierMatches.map((row) => row.record_id);

					const sat69bRecords = await prisma.sat69bEntry.findMany({
						where: { id: { in: sat69bIds } },
					});

					for (const record of sat69bRecords) {
						const target = {
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

						candidateMap.set(record.id, {
							target,
							vectorScore: 0,
							identifierMatch: true,
							dataset: "sat_69b",
						});
					}
				}
			}

			// Step B: Vector search
			console.log("[SearchSat69b] Step B: Vector search");

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
					filter: { dataset: "sat_69b" },
				},
			);

			console.log("[SearchSat69b] Vectorize matches:", {
				count: vectorizeResults.matches.length,
			});

			// Step C: Fetch and hydrate SAT 69-B records
			const sat69bIdsToFetch: string[] = [];

			for (const match of vectorizeResults.matches) {
				const { dataset, id: recordId } = parseVectorId(match.id);

				if (dataset === "sat_69b" && !candidateMap.has(recordId)) {
					sat69bIdsToFetch.push(recordId);
					candidateMap.set(recordId, {
						target: null,
						vectorScore: match.score || 0,
						identifierMatch: false,
						dataset,
					});
				}
			}

			if (sat69bIdsToFetch.length > 0) {
				const sat69bRecords = await prisma.sat69bEntry.findMany({
					where: { id: { in: sat69bIdsToFetch } },
				});

				for (const record of sat69bRecords) {
					const candidate = candidateMap.get(record.id);
					if (candidate) {
						candidate.target = {
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
				}
			}

			// Step D: Hybrid scoring
			console.log("[SearchSat69b] Step D: Computing hybrid scores");

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
					candidate.target.taxpayerName,
					null, // SAT 69-B doesn't have aliases
				);

				const hybridScore = computeHybridScore(
					candidate.vectorScore,
					nameScore,
					0, // SAT 69-B doesn't have birth date
				);

				if (hybridScore >= data.body.threshold) {
					matches.push({
						target: candidate.target,
						score: hybridScore,
						breakdown: {
							vectorScore: candidate.vectorScore,
							nameScore,
							metaScore: 0,
							identifierMatch: candidate.identifierMatch,
						},
					});
				}
			}

			// Sort by score descending
			matches.sort((a, b) => b.score - a.score);

			console.log("[SearchSat69b] Search completed", {
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
			console.error("[SearchSat69b] Error during search", {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});

			if (error instanceof ApiException) {
				throw error;
			}

			const apiError = new ApiException(
				error instanceof Error
					? error.message
					: "An unexpected error occurred during SAT 69-B search",
			);
			apiError.status = 500;
			apiError.code = 500;
			throw apiError;
		}
	}
}
