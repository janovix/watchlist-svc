/**
 * KV namespace used to cache Tasks reads.
 * Bound via `wrangler*.jsonc` as `TASKS_KV`.
 */
declare namespace Cloudflare {
	interface Env {
		TASKS_KV: KVNamespace;
		/**
		 * Optional override for tasks cache TTL (seconds).
		 * Must be >= 60. Defaults to 60.
		 */
		TASKS_CACHE_TTL_SECONDS?: string;
	}
}
