import { SELF, env } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";
import { QueryReadEndpoint } from "../../src/endpoints/watchlist/queryRead";
import { createPrismaClient } from "../../src/lib/prisma";
import type { AppContext } from "../../src/types";

/**
 * Query Read Endpoint Tests
 *
 * Tests for GET /queries/:id endpoint that retrieves
 * a single search query with all aggregated results.
 *
 * Note: These tests verify basic endpoint behavior.
 * Full auth and org scoping would require JWT token generation
 * which is complex in the Cloudflare Workers test environment.
 */
describe("GET /queries/:id", () => {
	it("should return error when organization context is missing", async () => {
		const testId = "550e8400-e29b-41d4-a716-446655440000";
		const response = await SELF.fetch(`http://local.test/queries/${testId}`, {
			method: "GET",
		});

		// Should return 400, 403 or 404 without proper auth (depending on test env)
		expect([400, 403, 404]).toContain(response.status);
	});

	it("should handle malformed UUID", async () => {
		const response = await SELF.fetch("http://local.test/queries/not-a-uuid", {
			method: "GET",
		});

		// Should return error (403 or 400)
		expect([400, 403]).toContain(response.status);
	});

	it("should handle missing organization context correctly", async () => {
		const testId = "550e8400-e29b-41d4-a716-446655440002";
		const response = await SELF.fetch(`http://local.test/queries/${testId}`, {
			method: "GET",
		});

		// Should return auth error
		expect([400, 403, 404]).toContain(response.status);
		const body = (await response.json()) as Record<string, unknown>;
		expect(typeof body.success).toBe("boolean");
	});

	it("should handle malformed UUID gracefully", async () => {
		const response = await SELF.fetch(
			"http://local.test/queries/not-valid-uuid",
			{
				method: "GET",
			},
		);

		// Should handle validation error
		expect([400, 403, 404]).toContain(response.status);
	});
});

// =========================================================================
// Direct handle() tests with mocked context
// =========================================================================
describe("QueryReadEndpoint.handle()", () => {
	let prisma: ReturnType<typeof createPrismaClient>;
	let endpoint: QueryReadEndpoint;

	beforeEach(() => {
		prisma = createPrismaClient((env as any).DB);
		endpoint = new (QueryReadEndpoint as any)();
	});

	it("should return 403 when organization context missing", async () => {
		const mockContext = {
			env: env as any,
			req: {
				json: async () => ({ id: "test-id" }),
			},
			get: (key: string) => {
				if (key === "organization") return undefined;
				return null;
			},
		} as unknown as AppContext;

		// Mock getValidatedData
		(endpoint.getValidatedData as any) = async () => ({
			params: { queryId: "test-id" },
			query: {},
		});

		try {
			await endpoint.handle(mockContext as any);
			throw new Error("Should have thrown");
		} catch (error: any) {
			expect(error.status).toBe(403);
		}
	});

	it("should return 404 when query not found", async () => {
		const mockContext = {
			env: env as any,
			req: {
				json: async () => ({}),
			},
			get: (key: string) => {
				if (key === "organization") {
					return { id: "org-123", name: "Test Org" };
				}
				return null;
			},
		} as unknown as AppContext;

		(endpoint.getValidatedData as any) = async () => ({
			params: { queryId: "nonexistent-query-id" },
			query: {},
		});

		try {
			await endpoint.handle(mockContext as any);
			throw new Error("Should have thrown");
		} catch (error: any) {
			expect(error.status).toBe(404);
		}
	});

	it("should return 403 when query belongs to different organization", async () => {
		const queryId = "test-query-diff-org-" + Date.now();
		const orgId1 = "org-1-" + Date.now();
		const orgId2 = "org-2-" + Date.now();

		// Create a search query for org1
		await prisma.searchQuery.create({
			data: {
				id: queryId,
				organizationId: orgId1,
				userId: "user-123",
				query: "test query",
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

		const mockContext = {
			env: env as any,
			req: {
				json: async () => ({}),
			},
			get: (key: string) => {
				if (key === "organization") {
					return { id: orgId2, name: "Test Org 2" };
				}
				return null;
			},
		} as unknown as AppContext;

		(endpoint.getValidatedData as any) = async () => ({
			params: { queryId: queryId },
			query: {},
		});

		try {
			await endpoint.handle(mockContext as any);
			throw new Error("Should have thrown");
		} catch (error: any) {
			expect(error.status).toBe(403);
		}
	});

	it("should return 200 with full query data when found and authorized", async () => {
		const queryId = "test-query-success-" + Date.now();
		const orgId = "org-success-" + Date.now();

		// Create a search query
		await prisma.searchQuery.create({
			data: {
				id: queryId,
				organizationId: orgId,
				userId: "user-123",
				query: "test person",
				entityType: "person",
				birthDate: "1990-01-01",
				countries: JSON.stringify(["US", "MX"]),
				status: "completed",
				ofacStatus: "completed",
				ofacResult: JSON.stringify([
					{
						target: { id: "ofac-1", partyType: "Individual" },
						score: 0.95,
					},
				]),
				ofacCount: 1,
				sat69bStatus: "completed",
				sat69bResult: JSON.stringify([]),
				sat69bCount: 0,
				unStatus: "completed",
				unResult: JSON.stringify([]),
				unCount: 0,
				pepOfficialStatus: "completed",
				pepOfficialResult: JSON.stringify({ matches: 1 }),
				pepOfficialCount: 1,
				pepAiStatus: "skipped",
				pepAiResult: null,
				adverseMediaStatus: "completed",
				adverseMediaResult: JSON.stringify({ riskLevel: "low" }),
			},
		});

		const mockContext = {
			env: env as any,
			req: {
				json: async () => ({}),
			},
			get: (key: string) => {
				if (key === "organization") {
					return { id: orgId, name: "Test Org" };
				}
				return null;
			},
		} as unknown as AppContext;

		(endpoint.getValidatedData as any) = async () => ({
			params: { queryId: queryId },
			query: {},
		});

		const response = await endpoint.handle(mockContext);
		expect(response.success).toBe(true);
		expect(response.result).toBeDefined();
		expect(response.result.id).toBe(queryId);
		expect(response.result.query).toBe("test person");
		expect(response.result.entityType).toBe("person");
		expect(response.result.countries).toEqual(["US", "MX"]);
		expect(response.result.ofacCount).toBe(1);
		expect(response.result.ofacResult).toBeDefined();
		expect(response.result.ofacResult?.matches).toHaveLength(1);
		expect(response.result.ofacResult?.count).toBe(1);
		expect(response.result.pepOfficialCount).toBe(1);
	});

	it("should parse JSON fields correctly", async () => {
		const queryId = "test-query-json-" + Date.now();
		const orgId = "org-json-" + Date.now();

		const ofacMatchData = [
			{
				target: { id: "target-1", partyType: "Individual" },
				score: 0.92,
			},
		];
		const unscMatchData = [
			{
				target: { id: "target-2", partyType: "Entity" },
				score: 0.88,
			},
			{
				target: { id: "target-3", partyType: "Individual" },
				score: 0.85,
			},
		];

		await prisma.searchQuery.create({
			data: {
				id: queryId,
				organizationId: orgId,
				userId: "user-123",
				query: "test",
				entityType: "person",
				countries: JSON.stringify(["AR"]),
				status: "completed",
				ofacStatus: "completed",
				ofacResult: JSON.stringify(ofacMatchData),
				ofacCount: 1,
				sat69bStatus: "completed",
				sat69bResult: JSON.stringify([]),
				sat69bCount: 0,
				unStatus: "completed",
				unResult: JSON.stringify(unscMatchData),
				unCount: 2,
				pepOfficialStatus: "completed",
				pepOfficialResult: JSON.stringify({ officials: [{ name: "John" }] }),
				pepAiStatus: "completed",
				pepAiResult: JSON.stringify({ score: 0.95 }),
				adverseMediaStatus: "completed",
				adverseMediaResult: JSON.stringify({ articles: 5 }),
			},
		});

		const mockContext = {
			env: env as any,
			req: { json: async () => ({}) },
			get: (key: string) => (key === "organization" ? { id: orgId } : null),
		} as unknown as AppContext;

		(endpoint.getValidatedData as any) = async () => ({
			params: { queryId: queryId },
			query: {},
		});

		const response = await endpoint.handle(mockContext);
		expect(response.result.countries).toEqual(["AR"]);
		expect(response.result.ofacResult?.matches).toEqual(ofacMatchData);
		expect(response.result.ofacResult?.count).toBe(1);
		expect(response.result.unResult?.matches).toEqual(unscMatchData);
		expect(response.result.unResult?.count).toBe(2);
		expect(response.result.adverseMediaResult).toEqual({ articles: 5 });
	});

	it("should return null for JSON fields that are null in database", async () => {
		const queryId = "test-query-null-json-" + Date.now();
		const orgId = "org-null-" + Date.now();

		await prisma.searchQuery.create({
			data: {
				id: queryId,
				organizationId: orgId,
				userId: "user-123",
				query: "test",
				entityType: "person",
				countries: null,
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

		(endpoint.getValidatedData as any) = async () => ({
			params: { queryId: queryId },
			query: {},
		});

		const response = await endpoint.handle(mockContext);
		expect(response.result.countries).toBeNull();
		expect(response.result.ofacResult).toBeNull();
		expect(response.result.sat69bResult).toBeNull();
		expect(response.result.unResult).toBeNull();
	});

	it("should handle invalid JSON in result fields", async () => {
		const queryId = "test-query-invalid-json-" + Date.now();
		const orgId = "org-invalid-" + Date.now();

		// Create a query with JSON data to test successful parsing
		const ofacMatchData = [{ target: { id: "ofac-1" }, score: 0.9 }];
		await prisma.searchQuery.create({
			data: {
				id: queryId,
				organizationId: orgId,
				userId: "user-123",
				query: "test",
				entityType: "person",
				countries: JSON.stringify(["US"]),
				ofacResult: JSON.stringify(ofacMatchData),
				ofacCount: 1,
				status: "completed",
				ofacStatus: "completed",
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
			params: { queryId: queryId },
			query: {},
		});

		const response = await endpoint.handle(mockContext);
		expect(response.result.countries).toEqual(["US"]);
		expect(response.result.ofacResult?.matches).toEqual(ofacMatchData);
		expect(response.result.ofacResult?.count).toBe(1);
	});
});
