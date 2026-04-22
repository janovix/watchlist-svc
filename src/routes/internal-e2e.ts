import { Hono } from "hono";
import { z } from "zod";
import { createPrismaClient } from "../lib/prisma";

const PurgeBodySchema = z.object({
	organizationIds: z.array(z.string().min(1)),
});

export const internalE2eRouter = new Hono();

internalE2eRouter.use("*", async (c, next) => {
	const env = c.env as { E2E_API_KEY?: string };
	const expected = env.E2E_API_KEY;
	if (!expected || c.req.header("x-e2e-api-key") !== expected) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	await next();
});

internalE2eRouter.post("/purge", async (c) => {
	const parsed = PurgeBodySchema.safeParse(
		await c.req.json().catch(() => ({})),
	);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid body", details: parsed.error.flatten() },
			400,
		);
	}
	const env = c.env as { DB: D1Database };
	const prisma = createPrismaClient(env.DB);
	const r = await prisma.searchQuery.deleteMany({
		where: { organizationId: { in: parsed.data.organizationIds } },
	});
	return c.json({ purgedSearchQueries: r.count, errors: [] as string[] });
});
