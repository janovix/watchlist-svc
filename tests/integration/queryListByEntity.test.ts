import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { QueryListByEntityEndpoint } from "../../src/endpoints/watchlist/queryListByEntity";
import { createPrismaClient } from "../../src/lib/prisma";
import type { AppContext } from "../../src/types";

const sampleEntity = "00000000-0000-4000-8000-000000000001";

/**
 * Exercises the OpenAPI/Zod path (optional limit & offset string transforms) so branch
 * coverage includes queryListByEntity schema branches.
 */
describe("GET /queries/by-entity", () => {
	it("should accept request with entityId and default pagination via HTTP", async () => {
		const u = new URL("http://local.test/queries/by-entity");
		u.searchParams.set("entityId", sampleEntity);
		const response = await SELF.fetch(u.toString(), { method: "GET" });
		expect(response.status).toBe(200);
		const body = await response.json<{
			success: boolean;
			pagination?: { limit: number; offset: number };
		}>();
		expect(body.success).toBe(true);
		expect(body.pagination?.limit).toBe(50);
		expect(body.pagination?.offset).toBe(0);
	});

	it("should parse limit and offset query params via HTTP", async () => {
		const u = new URL("http://local.test/queries/by-entity");
		u.searchParams.set("entityId", sampleEntity);
		u.searchParams.set("limit", "10");
		u.searchParams.set("offset", "5");
		const response = await SELF.fetch(u.toString(), { method: "GET" });
		expect(response.status).toBe(200);
		const body = await response.json<{
			success: boolean;
			pagination?: { limit: number; offset: number };
		}>();
		expect(body.success).toBe(true);
		expect(body.pagination?.limit).toBe(10);
		expect(body.pagination?.offset).toBe(5);
	});
});

describe("QueryListByEntityEndpoint.handle()", () => {
	let prisma: ReturnType<typeof createPrismaClient>;
	let endpoint: QueryListByEntityEndpoint;

	beforeEach(() => {
		prisma = createPrismaClient((env as { DB: D1Database }).DB);
		endpoint = new (QueryListByEntityEndpoint as any)();
	});

	it("should return 403 when organization context is missing", async () => {
		const mockContext = {
			env: env as { DB: D1Database },
			get: (key: string) => {
				if (key === "organization") return undefined;
				return null;
			},
		} as unknown as AppContext;

		(endpoint.getValidatedData as any) = async () => ({
			query: { entityId: "ent-1", limit: 20, offset: 0 },
		});

		await expect(endpoint.handle(mockContext)).rejects.toMatchObject({
			status: 403,
		});
	});

	it("should return empty list when no queries exist for entity", async () => {
		const orgId = "org-by-ent-empty-" + Date.now();
		const entityId = "entity-empty-" + Date.now();

		const mockContext = {
			env: env as { DB: D1Database },
			get: (key: string) => (key === "organization" ? { id: orgId } : null),
		} as unknown as AppContext;

		(endpoint.getValidatedData as any) = async () => ({
			query: { entityId, limit: 20, offset: 0 },
		});

		const response = await endpoint.handle(mockContext);
		expect(response.success).toBe(true);
		expect(response.queries).toEqual([]);
		expect(response.pagination.total).toBe(0);
		expect(response.pagination.hasMore).toBe(false);
	});

	it("should return queries for the given entityId only", async () => {
		const orgId = "org-by-ent-" + Date.now();
		const entityA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
		const entityB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

		await prisma.searchQuery.create({
			data: {
				id: `q-entity-a-1-${orgId}`,
				organizationId: orgId,
				userId: "user-1",
				query: "screen a",
				entityType: "person",
				entityId: entityA,
				entityKind: "client",
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
				id: `q-entity-b-1-${orgId}`,
				organizationId: orgId,
				userId: "user-1",
				query: "screen b",
				entityType: "person",
				entityId: entityB,
				entityKind: "client",
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
			env: env as { DB: D1Database },
			get: (key: string) => (key === "organization" ? { id: orgId } : null),
		} as unknown as AppContext;

		(endpoint.getValidatedData as any) = async () => ({
			query: { entityId: entityA, limit: 20, offset: 0 },
		});

		const response = await endpoint.handle(mockContext);
		expect(response.queries.length).toBe(1);
		expect(response.queries[0].entityId).toBe(entityA);
		expect(response.queries[0].query).toBe("screen a");
		expect(response.pagination.total).toBe(1);
	});

	it("should apply limit, offset, and hasMore for entity-scoped list", async () => {
		const orgId = "org-by-ent-pag-" + Date.now();
		const entityId = "entity-pag-" + Date.now();

		for (let i = 0; i < 3; i++) {
			await prisma.searchQuery.create({
				data: {
					id: `q-pag-${orgId}-${i}`,
					organizationId: orgId,
					userId: "user-1",
					query: `q ${i}`,
					entityType: "person",
					entityId,
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
			env: env as { DB: D1Database },
			get: (key: string) => (key === "organization" ? { id: orgId } : null),
		} as unknown as AppContext;

		(endpoint.getValidatedData as any) = async () => ({
			query: { entityId, limit: 2, offset: 0 },
		});

		const p1 = await endpoint.handle(mockContext);
		expect(p1.queries.length).toBe(2);
		expect(p1.pagination.total).toBe(3);
		expect(p1.pagination.hasMore).toBe(true);

		(endpoint.getValidatedData as any) = async () => ({
			query: { entityId, limit: 2, offset: 2 },
		});
		const p2 = await endpoint.handle(mockContext);
		expect(p2.queries.length).toBe(1);
		expect(p2.pagination.hasMore).toBe(false);
	});

	it("should use environment from context when set", async () => {
		const orgId = "org-by-ent-env-" + Date.now();
		const entityId = "entity-env-" + Date.now();

		await prisma.searchQuery.create({
			data: {
				id: `q-env-1-${orgId}`,
				organizationId: orgId,
				environment: "staging",
				userId: "user-1",
				query: "staging q",
				entityType: "person",
				entityId,
				status: "pending",
				ofacStatus: "pending",
				sat69bStatus: "pending",
				unStatus: "pending",
				pepOfficialStatus: "pending",
				pepAiStatus: "pending",
				adverseMediaStatus: "pending",
			},
		});

		const mockContextStaging = {
			env: env as { DB: D1Database },
			get: (key: string) => {
				if (key === "organization") return { id: orgId };
				if (key === "environment") return "staging";
				return null;
			},
		} as unknown as AppContext;

		(endpoint.getValidatedData as any) = async () => ({
			query: { entityId, limit: 20, offset: 0 },
		});

		const r = await endpoint.handle(mockContextStaging);
		expect(r.queries.length).toBe(1);
	});
});
