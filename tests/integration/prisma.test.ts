import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";

describe("Prisma Client", () => {
	it("should create Prisma client with D1 adapter", () => {
		const prisma = createPrismaClient(env.DB);
		expect(prisma).toBeDefined();
		expect(prisma.ofacSdnEntry).toBeDefined();
		expect(prisma.unscEntry).toBeDefined();
		expect(prisma.sat69bEntry).toBeDefined();
		expect(prisma.watchlistIngestionRun).toBeDefined();
		expect(prisma.watchlistIdentifier).toBeDefined();
	});

	it("should be able to query database", async () => {
		const prisma = createPrismaClient(env.DB);
		const count = await prisma.watchlistIngestionRun.count();
		expect(typeof count).toBe("number");
		expect(count).toBeGreaterThanOrEqual(0);
	});
});
