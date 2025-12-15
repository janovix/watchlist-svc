import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { invalidateTasksCacheAfterWrite } from "../../src/endpoints/tasks/invalidation";
import { TASKS_CACHE_VERSION_KEY } from "../../src/endpoints/tasks/kvCache";

describe("Tasks cache invalidation scheduling", () => {
	it("uses executionCtx.waitUntil when available", async () => {
		const promises: Promise<unknown>[] = [];
		const waitUntil = vi.fn((p: Promise<unknown>) => {
			promises.push(p);
		});
		const c = { env, executionCtx: { waitUntil } } as any;

		await invalidateTasksCacheAfterWrite(c, "tasks.create");

		expect(waitUntil).toHaveBeenCalledTimes(1);
		// Ensure any background storage ops finish within the test.
		await Promise.allSettled(promises);
	});

	it("awaits invalidation when waitUntil is not available", async () => {
		await env.TASKS_KV.delete(TASKS_CACHE_VERSION_KEY);
		const c = { env } as any;

		await invalidateTasksCacheAfterWrite(c, "tasks.create");

		const stored = await env.TASKS_KV.get(TASKS_CACHE_VERSION_KEY);
		expect(stored).toBeTruthy();
	});
});
