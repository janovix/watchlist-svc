declare namespace Cloudflare {
	interface Env {
		TASKS_KV: KVNamespace;
		TASKS_CACHE_TTL_SECONDS?: string;
	}
}
