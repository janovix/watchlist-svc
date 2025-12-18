import { applyD1Migrations, env } from "cloudflare:test";

// Setup files run outside isolated storage, and may be run multiple times.
// `applyD1Migrations()` only applies migrations that haven't already been
// applied, therefore it is safe to call this function here.
//
// Note: env.DB is an in-memory D1 database created by miniflare for testing.
// No real database connections are made - everything is mocked.
await applyD1Migrations(env.DB, env.MIGRATIONS);

// Mock AI binding if not provided by miniflare
// This ensures tests don't try to connect to real Workers AI
if (!("AI" in env) || !env.AI) {
	// @ts-expect-error - Adding mock AI binding for tests
	env.AI = {
		run: async () => ({
			data: [new Array(768).fill(0.1)], // Mock embedding vector (768 dimensions for bge-base-en-v1.5)
		}),
	};
}

// Mock Vectorize binding if not provided by miniflare
if (!("WATCHLIST_VECTORIZE" in env) || !env.WATCHLIST_VECTORIZE) {
	env.WATCHLIST_VECTORIZE = {
		query: async (_embedding: number[], _options?: { topK?: number }) => ({
			matches: [],
		}),
	} as unknown as typeof env.WATCHLIST_VECTORIZE;
}
