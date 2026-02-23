/**
 * GET /queries
 * List search queries for an organization with pagination.
 * Requires JWT authentication and organization scoping.
 */

import { OpenAPIRoute, ApiException } from "chanfana";
import { z } from "zod";
import { AppContext } from "../../types";
import { createPrismaClient } from "../../lib/prisma";

export class QueryListEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Queries"],
		summary: "List search queries",
		description:
			"Retrieve paginated list of search queries for the authenticated organization. " +
			"Results are sorted by creation time (newest first) and can be filtered by status.",
		security: [{ bearerAuth: [] }],
		request: {
			query: z.object({
				limit: z
					.string()
					.optional()
					.transform((val) => (val ? parseInt(val, 10) : 20))
					.pipe(z.number().int().min(1).max(100))
					.describe("Number of results per page (1-100, default: 20)"),
				offset: z
					.string()
					.optional()
					.transform((val) => (val ? parseInt(val, 10) : 0))
					.pipe(z.number().int().min(0))
					.describe("Number of results to skip (default: 0)"),
				status: z
					.enum(["pending", "partial", "completed", "failed"])
					.optional()
					.describe("Filter by query status"),
			}),
		},
		responses: {
			"200": {
				description: "List of queries returned",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							queries: z.array(
								z.object({
									id: z.string(),
									query: z.string(),
									entityType: z.string(),
									userId: z.string(),
									source: z.string(),
									status: z.string(),
									// Status summary (without full result blobs)
									ofacStatus: z.string(),
									ofacCount: z.number(),
									sat69bStatus: z.string(),
									sat69bCount: z.number(),
									unStatus: z.string(),
									unCount: z.number(),
									pepOfficialStatus: z.string(),
									pepOfficialCount: z.number(),
									pepAiStatus: z.string(),
									adverseMediaStatus: z.string(),
									// Timestamps
									createdAt: z.string(),
									updatedAt: z.string(),
								}),
							),
							pagination: z.object({
								limit: z.number(),
								offset: z.number(),
								total: z.number(),
								hasMore: z.boolean(),
							}),
						}),
					},
				},
			},
			"403": {
				description: "Forbidden - organization context required",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							error: z.string(),
						}),
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const { limit, offset, status } = data.query;

		// Require authentication
		const organization = c.get("organization");
		if (!organization) {
			const error = new ApiException("Organization context required");
			error.status = 403;
			error.code = 403;
			throw error;
		}

		const prisma = createPrismaClient(c.env.DB);

		try {
			// Build query filter
			const where: {
				organizationId: string;
				status?: string;
			} = {
				organizationId: organization.id,
			};

			if (status) {
				where.status = status;
			}

			// Count total matching queries
			const total = await prisma.searchQuery.count({ where });

			// Fetch paginated queries (without full result blobs for performance)
			const searchQueries = await prisma.searchQuery.findMany({
				where,
				select: {
					id: true,
					query: true,
					entityType: true,
					userId: true,
					source: true,
					status: true,
					// Status summaries only (no result blobs)
					ofacStatus: true,
					ofacCount: true,
					sat69bStatus: true,
					sat69bCount: true,
					unStatus: true,
					unCount: true,
					pepOfficialStatus: true,
					pepOfficialCount: true,
					pepAiStatus: true,
					adverseMediaStatus: true,
					// Timestamps
					createdAt: true,
					updatedAt: true,
				},
				orderBy: {
					createdAt: "desc",
				},
				take: limit,
				skip: offset,
			});

			return {
				success: true,
				queries: searchQueries.map((q) => ({
					id: q.id,
					query: q.query,
					entityType: q.entityType,
					userId: q.userId,
					source: q.source,
					status: q.status,
					ofacStatus: q.ofacStatus,
					ofacCount: q.ofacCount,
					sat69bStatus: q.sat69bStatus,
					sat69bCount: q.sat69bCount,
					unStatus: q.unStatus,
					unCount: q.unCount,
					pepOfficialStatus: q.pepOfficialStatus,
					pepOfficialCount: q.pepOfficialCount,
					pepAiStatus: q.pepAiStatus,
					adverseMediaStatus: q.adverseMediaStatus,
					createdAt: q.createdAt.toISOString(),
					updatedAt: q.updatedAt.toISOString(),
				})),
				pagination: {
					limit,
					offset,
					total,
					hasMore: offset + limit < total,
				},
			};
		} catch (error) {
			// Re-throw ApiException as-is
			if (error instanceof ApiException) {
				throw error;
			}

			// Wrap other errors
			const apiError = new ApiException(
				error instanceof Error ? error.message : "Failed to fetch queries",
			);
			apiError.status = 500;
			apiError.code = 500;
			throw apiError;
		}
	}
}
