export const TASKS_CACHE_VERSION_KEY = "tasks:cache:version";
export const TASKS_CACHE_TTL_SECONDS = 60;

export function getTasksCacheTtlSeconds(env: {
	TASKS_CACHE_TTL_SECONDS?: string;
}): number {
	const raw = env.TASKS_CACHE_TTL_SECONDS;
	if (raw === undefined) return TASKS_CACHE_TTL_SECONDS;

	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) return TASKS_CACHE_TTL_SECONDS;
	if (parsed < 60) return TASKS_CACHE_TTL_SECONDS;

	return Math.floor(parsed);
}

export function canonicalizeUrlForCache(url: string): string {
	const u = new URL(url);
	const entries = Array.from(u.searchParams.entries()).sort((a, b) => {
		const byKey = a[0].localeCompare(b[0]);
		if (byKey !== 0) return byKey;
		return a[1].localeCompare(b[1]);
	});

	const sp = new URLSearchParams();
	for (const [k, v] of entries) sp.append(k, v);
	const qs = sp.toString();
	return qs ? `${u.pathname}?${qs}` : u.pathname;
}

export function buildTasksListCacheKey(version: string, url: string): string {
	return `tasks:cache:${version}:list:${canonicalizeUrlForCache(url)}`;
}

export function buildTasksReadCacheKey(
	version: string,
	id: number | string,
): string {
	return `tasks:cache:${version}:read:${id}`;
}

export async function getTasksCacheVersion(kv: KVNamespace): Promise<string> {
	const existing = await kv.get(TASKS_CACHE_VERSION_KEY);
	if (existing) return existing;

	const created = crypto.randomUUID();
	await kv.put(TASKS_CACHE_VERSION_KEY, created);
	// Read-back reduces the impact of concurrent initializers.
	return (await kv.get(TASKS_CACHE_VERSION_KEY)) ?? created;
}

export async function invalidateTasksCache(kv: KVNamespace): Promise<void> {
	await kv.put(TASKS_CACHE_VERSION_KEY, crypto.randomUUID());
}

export async function kvGetJson<T>(
	kv: KVNamespace,
	key: string,
	{ validate }: { validate?: (value: unknown) => T } = {},
): Promise<T | null> {
	const raw = (await kv.get(key, { type: "json" })) as unknown;
	if (raw === null) return null;
	return validate ? validate(raw) : (raw as T);
}

export async function kvPutJson(
	kv: KVNamespace,
	key: string,
	value: unknown,
	{ expirationTtl }: { expirationTtl: number },
): Promise<void> {
	let serialized: string;
	try {
		serialized = JSON.stringify(value);
	} catch (error) {
		throw new Error(`Failed to serialize KV value for key "${key}"`, {
			cause: error,
		});
	}

	await kv.put(key, serialized, { expirationTtl });
}
