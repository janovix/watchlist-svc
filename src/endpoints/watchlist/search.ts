import { OpenAPIRoute, ApiException } from "chanfana";
import { AppContext } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import { createPrismaClient } from "../../lib/prisma";
import { watchlistTarget } from "./base";
import { parseJsonField } from "./base";

export class SearchEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Search"],
		summary: "Semantic search for watchlist targets",
		operationId: "searchTargets",
		request: {
			body: contentJson(
				z.object({
					query: z.string().min(1),
					schema: z.string().optional(),
					dataset: z.string().optional(),
					country: z.string().optional(),
					programId: z.string().optional(),
					topK: z.number().int().min(1).max(100).optional().default(10),
				}),
			),
		},
		responses: {
			"200": {
				description: "Search results",
				...contentJson({
					success: Boolean,
					result: z.object({
						matches: z.array(
							z.object({
								target: watchlistTarget,
								score: z.number(),
							}),
						),
						count: z.number(),
					}),
				}),
			},
		},
	};

	public async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const prisma = createPrismaClient(c.env.DB);

		// Generate embedding for query
		// Workers AI binding should be automatically available
		// If not available, it may need to be enabled in the Cloudflare dashboard
		if (!c.env.AI) {
			const error = new ApiException(
				"AI binding not available. Please ensure Workers AI is enabled for your account.",
			);
			error.status = 503;
			error.code = 503;
			throw error;
		}

		const queryResponse = (await c.env.AI.run("@cf/baai/bge-base-en-v1.5", {
			text: [data.body.query],
		})) as { data: number[][] };

		if (
			!queryResponse ||
			!Array.isArray(queryResponse.data) ||
			queryResponse.data.length === 0
		) {
			throw new Error("Failed to generate query embedding");
		}

		const embedding = queryResponse.data[0] as number[];

		// Build metadata filter
		const filter: Record<string, string | { $in: string[] }> = {};
		if (data.body.schema) {
			filter.schema = data.body.schema;
		}
		if (data.body.dataset) {
			filter.dataset = data.body.dataset;
		}
		if (data.body.country) {
			filter.countries = { $in: [data.body.country] };
		}
		// Note: programId filtering would need to be handled differently
		// as Vectorize metadata filters work on top-level fields

		// Query Vectorize
		const vectorizeResults = await c.env.WATCHLIST_VECTORIZE.query(embedding, {
			topK: data.body.topK,
			returnMetadata: true,
			filter:
				Object.keys(filter).length > 0
					? (filter as Record<string, string | { $in: string[] }>)
					: undefined,
		});

		// Fetch full records from D1
		const targetIds = vectorizeResults.matches.map((m) => m.id);
		const targets = await prisma.watchlistTarget.findMany({
			where: {
				id: { in: targetIds },
			},
		});

		// Create a map for quick lookup
		const targetMap = new Map(
			targets.map((t: (typeof targets)[number]) => [t.id, t]),
		);

		// Combine results
		const matches = vectorizeResults.matches
			.map((match: { id: string; score?: number }) => {
				const target = targetMap.get(match.id);
				if (!target) return null;

				const targetData = {
					id: target.id,
					schema: target.schema,
					name: target.name,
					aliases: parseJsonField<string[]>(target.aliases),
					birthDate: target.birthDate,
					countries: parseJsonField<string[]>(target.countries),
					addresses: parseJsonField<string[]>(target.addresses),
					identifiers: parseJsonField<string[]>(target.identifiers),
					sanctions: parseJsonField<string[]>(target.sanctions),
					phones: parseJsonField<string[]>(target.phones),
					emails: parseJsonField<string[]>(target.emails),
					programIds: parseJsonField<string[]>(target.programIds),
					dataset: target.dataset,
					firstSeen: target.firstSeen,
					lastSeen: target.lastSeen,
					lastChange: target.lastChange,
					createdAt: target.createdAt.toISOString(),
					updatedAt: target.updatedAt.toISOString(),
				};

				return {
					target: targetData,
					score: match.score || 0,
				};
			})
			.filter(
				(
					m: { target: unknown; score: number } | null,
				): m is { target: unknown; score: number } => m !== null,
			);

		return {
			success: true,
			result: {
				matches,
				count: matches.length,
			},
		};
	}
}
