/**
 * GET /queries/by-entity?entityId=... — list search queries linked to an AML client or BC.
 */

import { OpenAPIRoute, ApiException } from "chanfana";
import { z } from "zod";
import { AppContext } from "../../types";
import { createPrismaClient } from "../../lib/prisma";
import { computePepAiIndicatesMatch } from "../../lib/search-query-utils";

export class QueryListByEntityEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Queries"],
		summary: "List queries by linked AML entity",
		description:
			"Returns search queries that were created with entity_id set (e.g. from aml-svc).",
		security: [{ bearerAuth: [] }],
		request: {
			query: z.object({
				entityId: z
					.string()
					.min(1)
					.describe("Client or beneficial controller UUID"),
				limit: z
					.string()
					.optional()
					.transform((val) => (val ? parseInt(val, 10) : 50))
					.pipe(z.number().int().min(1).max(200)),
				offset: z
					.string()
					.optional()
					.transform((val) => (val ? parseInt(val, 10) : 0))
					.pipe(z.number().int().min(0)),
			}),
		},
		responses: {
			"200": {
				description: "List returned",
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const { entityId, limit, offset } = data.query;

		const organization = c.get("organization");
		if (!organization) {
			const err = new ApiException("Organization context required");
			err.status = 403;
			err.code = 403;
			throw err;
		}
		const environment = c.get("environment") || "production";
		const prisma = createPrismaClient(c.env.DB);
		const where = {
			organizationId: organization.id,
			environment,
			entityId,
		};
		const [raw, total] = await Promise.all([
			prisma.searchQuery.findMany({
				where,
				orderBy: { createdAt: "desc" },
				take: limit,
				skip: offset,
			}),
			prisma.searchQuery.count({ where }),
		]);

		const queries = raw.map((row) => ({
			id: row.id,
			query: row.query,
			entityType: row.entityType,
			entityId: row.entityId,
			entityKind: row.entityKind,
			userId: row.userId,
			source: row.source,
			status: row.status,
			ofacStatus: row.ofacStatus,
			ofacCount: row.ofacCount,
			sat69bStatus: row.sat69bStatus,
			sat69bCount: row.sat69bCount,
			unStatus: row.unStatus,
			unCount: row.unCount,
			pepOfficialStatus: row.pepOfficialStatus,
			pepOfficialCount: row.pepOfficialCount,
			pepAiStatus: row.pepAiStatus,
			pepAiIndicatesMatch: computePepAiIndicatesMatch(
				row.pepAiStatus,
				row.pepAiResult,
			),
			adverseMediaStatus: row.adverseMediaStatus,
			adverseMediaHasRisk: row.adverseMediaHasRisk,
			adverseMediaRiskLevel: row.adverseMediaRiskLevel,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
		}));

		return {
			success: true,
			queries,
			pagination: {
				limit,
				offset,
				total,
				hasMore: offset + queries.length < total,
			},
		};
	}
}
