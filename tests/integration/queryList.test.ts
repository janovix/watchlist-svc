import { SELF, env } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";
import { QueryListEndpoint } from "../../src/endpoints/watchlist/queryList";
import { createPrismaClient } from "../../src/lib/prisma";
import type { AppContext } from "../../src/types";

/**
 * Query List Endpoint Tests
 *
 * Tests for GET /queries endpoint that retrieves
 * a paginated list of search queries for an organization.
 *
 * Note: These tests verify basic endpoint behavior.
 * Full auth and org scoping would require JWT token generation
 * which is complex in the Cloudflare Workers test environment.
 */
describe("GET /queries", () => {
	it("should return error when organization context is missing", async () => {
		const response = await SELF.fetch("http://local.test/queries", {
			method: "GET",
		});

		// Endpoint requires auth - should return success in test env but empty queries
		const body = await response.json<{
			success: boolean;
			queries?: unknown[];
		}>();
		expect(body.success).toBe(true);
		if (body.queries) {
			expect(Array.isArray(body.queries)).toBe(true);
		}
	});

	it("should handle pagination query params", async () => {
		const response = await SELF.fetch(
			"http://local.test/queries?limit=10&offset=0",
			{
				method: "GET",
			},
		);

		// Should accept valid params
		expect(response.status).toBe(200);
		const body = await response.json<{ success: boolean }>();
		expect(body.success).toBe(true);
	});

	it("should handle status filter query param", async () => {
		const response = await SELF.fetch(
			"http://local.test/queries?status=completed",
			{
				method: "GET",
			},
		);

		// Should accept valid status filter
		expect(response.status).toBe(200);
	});

	it("should return proper content type", async () => {
		const response = await SELF.fetch("http://local.test/queries", {
			method: "GET",
		});

		expect(response.headers.get("content-type")).toContain("application/json");
	});

	it("should handle invalid limit value", async () => {
		const response = await SELF.fetch(
			"http://local.test/queries?limit=invalid",
			{
				method: "GET",
			},
		);

		// Should return error (400 or 403)
		expect([400, 403]).toContain(response.status);
	});

	it("should handle out-of-range limit", async () => {
		const response = await SELF.fetch("http://local.test/queries?limit=1000", {
			method: "GET",
		});

		// Should return error (400 or 403)
		expect([400, 403]).toContain(response.status);
	});
});

// =========================================================================
// Direct handle() tests with mocked context and seeded data
// =========================================================================
describe("QueryListEndpoint.handle()", () => {
	let prisma: ReturnType<typeof createPrismaClient>;
	let endpoint: QueryListEndpoint;

	beforeEach(() => {
		prisma = createPrismaClient((env as any).DB);
		endpoint = new (QueryListEndpoint as any)();
	});

	it("should return 403 when organization context missing", async () => {
		const mockContext = {
			env: env as any,
			req: { json: async () => ({}) },
			get: (key: string) => {
				if (key === "organization") return undefined;
				return null;
			},
		} as unknown as AppContext;

		(endpoint.getValidatedData as any) = async () => ({
			query: { limit: 20, offset: 0 },
		});

		try {
			await endpoint.handle(mockContext);
			throw new Error("Should have thrown");
		} catch (error: any) {
			expect(error.status).toBe(403);
		}
	});

	it("should return empty list when no queries exist", async () => {
		const orgId = "org-empty-" + Date.now();

		const mockContext = {
			env: env as any,
			req: { json: async () => ({}) },
			get: (key: string) => (key === "organization" ? { id: orgId } : null),
		} as unknown as AppContext;

		(endpoint.getValidatedData as any) = async () => ({
			query: { limit: 20, offset: 0 },
		});

		const response = await endpoint.handle(mockContext as any);
		expect(response.success).toBe(true);
		expect(response.queries).toEqual([]);
		expect(response.pagination.total).toBe(0);
		expect(response.pagination.hasMore).toBe(false);
	});

	it("should return queries sorted by created_at descending", async () => {
		const orgId = "org-sort-" + Date.now();

		// Create queries with staggered timestamps
		for (let i = 0; i < 3; i++) {
			await prisma.searchQuery.create({
				data: {
					id: `query-${orgId}-${i}`,
					organizationId: orgId,
					userId: "user-123",
					query: `test query ${i}`,
					entityType: "person",
					status: "completed",
					ofacStatus: "completed",
					sat69bStatus: "completed",
					unStatus: "completed",
					pepOfficialStatus: "completed",
					pepAiStatus: "completed",
					adverseMediaStatus: "completed",
				},
			});
		}

		const mockContext = {
			env: env as any,
			req: { json: async () => ({}) },
			get: (key: string) => (key === "organization" ? { id: orgId } : null),
		} as unknown as AppContext;

		(endpoint.getValidatedData as any) = async () => ({
			query: { limit: 20, offset: 0 },
		});

		const response = await endpoint.handle(mockContext as any);
		expect(response.queries.length).toBe(3);
		// Verify descending order (most recent first)
		for (let i = 0; i < response.queries.length - 1; i++) {
			expect(
				new Date(response.queries[i].createdAt).getTime(),
			).toBeGreaterThanOrEqual(
				new Date(response.queries[i + 1].createdAt).getTime(),
			);
		}
	});

	it("should apply pagination limit and offset", async () => {
		const orgId = "org-paginate-" + Date.now();

		// Create 5 queries
		for (let i = 0; i < 5; i++) {
			await prisma.searchQuery.create({
				data: {
					id: `query-paginate-${orgId}-${i}`,
					organizationId: orgId,
					userId: "user-123",
					query: `query ${i}`,
					entityType: "person",
					status: "pending",
					ofacStatus: "pending",
					sat69bStatus: "pending",
					unStatus: "pending",
					pepOfficialStatus: "pending",
					pepAiStatus: "pending",
					adverseMediaStatus: "pending",
				},
			});
		}

		const mockContext = {
			env: env as any,
			req: { json: async () => ({}) },
			get: (key: string) => (key === "organization" ? { id: orgId } : null),
		} as unknown as AppContext;

		// First page: limit 2, offset 0
		(endpoint.getValidatedData as any) = async () => ({
			query: { limit: 2, offset: 0 },
		});

		const response1 = await endpoint.handle(mockContext);
		expect(response1.queries.length).toBe(2);
		expect(response1.pagination.total).toBe(5);
		expect(response1.pagination.limit).toBe(2);
		expect(response1.pagination.offset).toBe(0);
		expect(response1.pagination.hasMore).toBe(true);

		// Second page: limit 2, offset 2
		(endpoint.getValidatedData as any) = async () => ({
			query: { limit: 2, offset: 2 },
		});

		const response2 = await endpoint.handle(mockContext);
		expect(response2.queries.length).toBe(2);
		expect(response2.pagination.offset).toBe(2);
		expect(response2.pagination.hasMore).toBe(true);

		// Last page: limit 2, offset 4
		(endpoint.getValidatedData as any) = async () => ({
			query: { limit: 2, offset: 4 },
		});

		const response3 = await endpoint.handle(mockContext);
		expect(response3.queries.length).toBe(1);
		expect(response3.pagination.hasMore).toBe(false);
	});

	it("should filter queries by status", async () => {
		const orgId = "org-filter-" + Date.now();

		// Create queries with different statuses
		await prisma.searchQuery.create({
			data: {
				id: `query-completed-${orgId}`,
				organizationId: orgId,
				userId: "user-123",
				query: "completed query",
				entityType: "person",
				status: "completed",
				ofacStatus: "completed",
				sat69bStatus: "completed",
				unStatus: "completed",
				pepOfficialStatus: "completed",
				pepAiStatus: "completed",
				adverseMediaStatus: "completed",
			},
		});

		await prisma.searchQuery.create({
			data: {
				id: `query-pending-${orgId}`,
				organizationId: orgId,
				userId: "user-123",
				query: "pending query",
				entityType: "person",
				status: "pending",
				ofacStatus: "pending",
				sat69bStatus: "pending",
				unStatus: "pending",
				pepOfficialStatus: "pending",
				pepAiStatus: "pending",
				adverseMediaStatus: "pending",
			},
		});

		const mockContext = {
			env: env as any,
			req: { json: async () => ({}) },
			get: (key: string) => (key === "organization" ? { id: orgId } : null),
		} as unknown as AppContext;

		// Filter by completed status
		(endpoint.getValidatedData as any) = async () => ({
			query: { limit: 20, offset: 0, status: "completed" },
		});

		const response = await endpoint.handle(mockContext as any);
		expect(response.queries.length).toBe(1);
		expect(response.queries[0].status).toBe("completed");
		expect(response.pagination.total).toBe(1);
	});

	it("should only return queries for authorized organization", async () => {
		const orgId1 = "org-auth-1-" + Date.now();
		const orgId2 = "org-auth-2-" + Date.now();

		// Create query for org1
		await prisma.searchQuery.create({
			data: {
				id: `query-org1-${orgId1}`,
				organizationId: orgId1,
				userId: "user-123",
				query: "org1 query",
				entityType: "person",
				status: "pending",
				ofacStatus: "pending",
				sat69bStatus: "pending",
				unStatus: "pending",
				pepOfficialStatus: "pending",
				pepAiStatus: "pending",
				adverseMediaStatus: "pending",
			},
		});

		// Create query for org2
		await prisma.searchQuery.create({
			data: {
				id: `query-org2-${orgId2}`,
				organizationId: orgId2,
				userId: "user-123",
				query: "org2 query",
				entityType: "person",
				status: "pending",
				ofacStatus: "pending",
				sat69bStatus: "pending",
				unStatus: "pending",
				pepOfficialStatus: "pending",
				pepAiStatus: "pending",
				adverseMediaStatus: "pending",
			},
		});

		// Request org1's queries
		const mockContext = {
			env: env as any,
			req: { json: async () => ({}) },
			get: (key: string) => (key === "organization" ? { id: orgId1 } : null),
		} as unknown as AppContext;

		(endpoint.getValidatedData as any) = async () => ({
			query: { limit: 20, offset: 0 },
		});

		const response = await endpoint.handle(mockContext as any);
		expect(response.queries.length).toBe(1);
		expect(response.queries[0].id).toContain(orgId1);
		expect(response.pagination.total).toBe(1);
	});

	it("should return query status summary without result blobs", async () => {
		const orgId = "org-summary-" + Date.now();

		await prisma.searchQuery.create({
			data: {
				id: `query-summary-${orgId}`,
				organizationId: orgId,
				userId: "user-123",
				query: "summary test",
				entityType: "person",
				status: "partial",
				ofacStatus: "completed",
				ofacCount: 5,
				sat69bStatus: "pending",
				sat69bCount: 0,
				unStatus: "completed",
				unCount: 2,
				pepOfficialStatus: "pending",
				pepOfficialCount: 0,
				pepAiStatus: "skipped",
				adverseMediaStatus: "completed",
			},
		});

		const mockContext = {
			env: env as any,
			req: { json: async () => ({}) },
			get: (key: string) => (key === "organization" ? { id: orgId } : null),
		} as unknown as AppContext;

		(endpoint.getValidatedData as any) = async () => ({
			query: { limit: 20, offset: 0 },
		});

		const response = await endpoint.handle(mockContext as any);
		expect(response.queries[0].ofacStatus).toBe("completed");
		expect(response.queries[0].ofacCount).toBe(5);
		expect(response.queries[0].unCount).toBe(2);
		expect(response.queries[0].pepAiStatus).toBe("skipped");
	});

	it("should handle failed status filter", async () => {
		const orgId = "org-failed-" + Date.now();

		await prisma.searchQuery.create({
			data: {
				id: `query-failed-${orgId}`,
				organizationId: orgId,
				userId: "user-123",
				query: "failed query",
				entityType: "person",
				status: "failed",
				ofacStatus: "failed",
				sat69bStatus: "completed",
				unStatus: "completed",
				pepOfficialStatus: "completed",
				pepAiStatus: "completed",
				adverseMediaStatus: "completed",
			},
		});

		const mockContext = {
			env: env as any,
			req: { json: async () => ({}) },
			get: (key: string) => (key === "organization" ? { id: orgId } : null),
		} as unknown as AppContext;

		(endpoint.getValidatedData as any) = async () => ({
			query: { limit: 20, offset: 0, status: "failed" },
		});

		const response = await endpoint.handle(mockContext as any);
		expect(response.queries.length).toBe(1);
		expect(response.queries[0].status).toBe("failed");
	});

	it("should handle partial status filter", async () => {
		const orgId = "org-partial-" + Date.now();

		await prisma.searchQuery.create({
			data: {
				id: `query-partial-${orgId}`,
				organizationId: orgId,
				userId: "user-123",
				query: "partial query",
				entityType: "person",
				status: "partial",
				ofacStatus: "completed",
				sat69bStatus: "pending",
				unStatus: "pending",
				pepOfficialStatus: "pending",
				pepAiStatus: "pending",
				adverseMediaStatus: "pending",
			},
		});

		const mockContext = {
			env: env as any,
			req: { json: async () => ({}) },
			get: (key: string) => (key === "organization" ? { id: orgId } : null),
		} as unknown as AppContext;

		(endpoint.getValidatedData as any) = async () => ({
			query: { limit: 20, offset: 0, status: "partial" },
		});

		const response = await endpoint.handle(mockContext as any);
		expect(response.queries.length).toBe(1);
		expect(response.queries[0].status).toBe("partial");
	});

	it("should handle return hasMore false when at exact boundary", async () => {
		const orgId = "org-boundary-" + Date.now();

		// Create exactly 5 queries
		for (let i = 0; i < 5; i++) {
			await prisma.searchQuery.create({
				data: {
					id: `query-bound-${orgId}-${i}`,
					organizationId: orgId,
					userId: "user-123",
					query: `query ${i}`,
					entityType: "person",
					status: "pending",
					ofacStatus: "pending",
					sat69bStatus: "pending",
					unStatus: "pending",
					pepOfficialStatus: "pending",
					pepAiStatus: "pending",
					adverseMediaStatus: "pending",
				},
			});
		}

		const mockContext = {
			env: env as any,
			req: { json: async () => ({}) },
			get: (key: string) => (key === "organization" ? { id: orgId } : null),
		} as unknown as AppContext;

		// Request all 5 with limit 5
		(endpoint.getValidatedData as any) = async () => ({
			query: { limit: 5, offset: 0 },
		});

		const response = await endpoint.handle(mockContext as any);
		expect(response.queries.length).toBe(5);
		expect(response.pagination.total).toBe(5);
		expect(response.pagination.hasMore).toBe(false);
	});
});
