/**
 * Vitest `@cloudflare/vitest-pool-workers` runs HTTP handlers in isolates whose `env`
 * comes from Miniflare/wrangler bindings only — mutations in `tests/apply-migrations.ts`
 * on `cloudflare:test`'s `env` are not visible to `SELF.fetch`.
 *
 * When `ENVIRONMENT` is `test`, mirror the lightweight AI + Vectorize stubs from
 * `tests/apply-migrations.ts` so search routes and `performSearch` default adapters work.
 */
export function installVitestPoolBindings(env: Cloudflare.Env): void {
	if (String(env.ENVIRONMENT ?? "") !== "test") {
		return;
	}

	if (!env.AI) {
		env.AI = {
			run: async (_model: string, _input: { text: string[] }) => ({
				data: [new Array(1024).fill(0.1)],
			}),
		} as Cloudflare.Env["AI"];
	}

	if (!env.WATCHLIST_VECTORIZE) {
		(
			env as unknown as {
				WATCHLIST_VECTORIZE: VectorizeIndex;
			}
		).WATCHLIST_VECTORIZE = {
			query: async () => ({ matches: [] }),
		} as unknown as VectorizeIndex;
	}
}
