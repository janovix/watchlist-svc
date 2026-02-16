/**
 * GET /queries/:queryId
 * Fetch a single search query by UUID with full results.
 * Requires JWT authentication and organization scoping.
 */

import { OpenAPIRoute, ApiException } from "chanfana";
import { z } from "zod";
import { AppContext } from "../../types";
import { createPrismaClient } from "../../lib/prisma";

export class QueryReadEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Queries"],
		summary: "Fetch search query by ID",
		description:
			"Retrieve a single search query with all aggregated results. Requires authentication and organization access.",
		security: [{ bearerAuth: [] }],
		request: {
			params: z.object({
				queryId: z.string().uuid().describe("Query UUID"),
			}),
		},
		responses: {
			"200": {
				description: "Query found and returned",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							query: z.object({
								id: z.string(),
								organizationId: z.string(),
								userId: z.string(),
								query: z.string(),
								entityType: z.string(),
								birthDate: z.string().nullable(),
								countries: z.array(z.string()).nullable(),
								status: z.string(),
								// OFAC Sanctions
								ofacStatus: z.string(),
								ofacResult: z.any().nullable(),
								ofacCount: z.number(),
								// SAT 69B Sanctions
								sat69bStatus: z.string(),
								sat69bResult: z.any().nullable(),
								sat69bCount: z.number(),
								// UN Sanctions
								unStatus: z.string(),
								unResult: z.any().nullable(),
								unCount: z.number(),
								// PEP Official
								pepOfficialStatus: z.string(),
								pepOfficialResult: z.any().nullable(),
								pepOfficialCount: z.number(),
								// PEP AI
								pepAiStatus: z.string(),
								pepAiResult: z.any().nullable(),
								// Adverse Media
								adverseMediaStatus: z.string(),
								adverseMediaResult: z.any().nullable(),
								// Timestamps
								createdAt: z.string(),
								updatedAt: z.string(),
							}),
						}),
					},
				},
			},
			"403": {
				description: "Forbidden - organization access denied",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							error: z.string(),
						}),
					},
				},
			},
			"404": {
				description: "Query not found",
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
		const queryId = data.params.queryId;

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
			// Fetch query
			const searchQuery = await prisma.searchQuery.findUnique({
				where: { id: queryId },
			});

			if (!searchQuery) {
				const error = new ApiException("Query not found");
				error.status = 404;
				error.code = 404;
				throw error;
			}

			// Verify organization access
			if (searchQuery.organizationId !== organization.id) {
				const error = new ApiException(
					"Access denied: query belongs to a different organization",
				);
				error.status = 403;
				error.code = 403;
				throw error;
			}

			// Parse JSON fields
			const countries = searchQuery.countries
				? JSON.parse(searchQuery.countries)
				: null;
			const ofacResult = searchQuery.ofacResult
				? JSON.parse(searchQuery.ofacResult)
				: null;
			const sat69bResult = searchQuery.sat69bResult
				? JSON.parse(searchQuery.sat69bResult)
				: null;
			const unResult = searchQuery.unResult
				? JSON.parse(searchQuery.unResult)
				: null;
			const pepOfficialResult = searchQuery.pepOfficialResult
				? JSON.parse(searchQuery.pepOfficialResult)
				: null;
			const pepAiResult = searchQuery.pepAiResult
				? JSON.parse(searchQuery.pepAiResult)
				: null;
			const adverseMediaResult = searchQuery.adverseMediaResult
				? JSON.parse(searchQuery.adverseMediaResult)
				: null;

			return {
				success: true,
				query: {
					id: searchQuery.id,
					organizationId: searchQuery.organizationId,
					userId: searchQuery.userId,
					query: searchQuery.query,
					entityType: searchQuery.entityType,
					birthDate: searchQuery.birthDate,
					countries,
					status: searchQuery.status,
					// OFAC Sanctions
					ofacStatus: searchQuery.ofacStatus,
					ofacResult,
					ofacCount: searchQuery.ofacCount,
					// SAT 69B Sanctions
					sat69bStatus: searchQuery.sat69bStatus,
					sat69bResult,
					sat69bCount: searchQuery.sat69bCount,
					// UN Sanctions
					unStatus: searchQuery.unStatus,
					unResult,
					unCount: searchQuery.unCount,
					// PEP Official
					pepOfficialStatus: searchQuery.pepOfficialStatus,
					pepOfficialResult,
					pepOfficialCount: searchQuery.pepOfficialCount,
					// PEP AI
					pepAiStatus: searchQuery.pepAiStatus,
					pepAiResult,
					// Adverse Media
					adverseMediaStatus: searchQuery.adverseMediaStatus,
					adverseMediaResult,
					// Timestamps
					createdAt: searchQuery.createdAt.toISOString(),
					updatedAt: searchQuery.updatedAt.toISOString(),
				},
			};
		} catch (error) {
			// Re-throw ApiException as-is
			if (error instanceof ApiException) {
				throw error;
			}

			// Wrap other errors
			const apiError = new ApiException(
				error instanceof Error ? error.message : "Failed to fetch query",
			);
			apiError.status = 500;
			apiError.code = 500;
			throw apiError;
		}
	}
}
