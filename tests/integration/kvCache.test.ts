import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
	buildTasksListCacheKey,
	buildTasksReadCacheKey,
	canonicalizeUrlForCache,
	getTasksCacheTtlSeconds,
	getTasksCacheVersion,
	invalidateTasksCache,
	TASKS_CACHE_VERSION_KEY,
} from "../../src/endpoints/tasks/kvCache";

describe("Tasks KV cache helpers", () => {
	it("canonicalizeUrlForCache sorts query params deterministically", () => {
		expect(canonicalizeUrlForCache("http://local.test/tasks?b=2&a=1&a=0")).toBe(
			"/tasks?a=0&a=1&b=2",
		);

		// No query string stays as the path.
		expect(canonicalizeUrlForCache("http://local.test/tasks")).toBe("/tasks");
	});

	it("builds stable cache keys", () => {
		const v = "v1";
		expect(buildTasksListCacheKey(v, "http://local.test/tasks?b=2&a=1")).toBe(
			"tasks:cache:v1:list:/tasks?a=1&b=2",
		);
		expect(buildTasksReadCacheKey(v, 123)).toBe("tasks:cache:v1:read:123");
	});

	it("getTasksCacheTtlSeconds reads override and clamps invalid values", () => {
		expect(getTasksCacheTtlSeconds({})).toBe(60);
		expect(getTasksCacheTtlSeconds({ TASKS_CACHE_TTL_SECONDS: "120" })).toBe(
			120,
		);
		expect(getTasksCacheTtlSeconds({ TASKS_CACHE_TTL_SECONDS: "59" })).toBe(60);
		expect(getTasksCacheTtlSeconds({ TASKS_CACHE_TTL_SECONDS: "nope" })).toBe(
			60,
		);
	});

	it("getTasksCacheVersion returns existing version when present", async () => {
		await env.TASKS_KV.put(TASKS_CACHE_VERSION_KEY, "existing");
		await expect(getTasksCacheVersion(env.TASKS_KV)).resolves.toBe("existing");
	});

	it("getTasksCacheVersion creates a version when missing", async () => {
		await env.TASKS_KV.delete(TASKS_CACHE_VERSION_KEY);
		const version = await getTasksCacheVersion(env.TASKS_KV);
		expect(version).toBeTruthy();
		expect(version).toMatch(/^[0-9a-f-]{36}$/i);

		const stored = await env.TASKS_KV.get(TASKS_CACHE_VERSION_KEY);
		expect(stored).toBe(version);
	});

	it("invalidateTasksCache rotates the version key", async () => {
		await env.TASKS_KV.put(TASKS_CACHE_VERSION_KEY, "before");
		await invalidateTasksCache(env.TASKS_KV);
		const after = await env.TASKS_KV.get(TASKS_CACHE_VERSION_KEY);
		expect(after).toBeTruthy();
		expect(after).not.toBe("before");
	});
});
