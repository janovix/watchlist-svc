import path from "node:path";
import {
	defineWorkersConfig,
	readD1Migrations,
} from "@cloudflare/vitest-pool-workers/config";
const migrationsPath = path.join(__dirname, "..", "migrations");
const migrations = await readD1Migrations(migrationsPath);

export default defineWorkersConfig({
	esbuild: {
		target: "esnext",
	},
	// Required for @prisma/adapter-d1@7.x which depends on 'ky'
	// See: https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#module-resolution
	ssr: {
		// Force Vite to bundle these modules instead of externalizing them
		noExternal: ["ky", "@prisma/adapter-d1"],
	},
	test: {
		coverage: {
			provider: "istanbul",
			reporter: ["text", "lcov"],
			all: true,
			include: ["src/**/*.ts"],
			exclude: [
				"**/*.d.ts",
				"**/node_modules/**",
				"**/tests/**",
				"**/dist/**",
				"**/coverage/**",
				"src/endpoints/watchlist/internalVectorize.ts", // Heavy AI/Vectorize batch paths; count/delete partially covered via integration tests
				"src/endpoints/watchlist/ingestionUpload.ts", // R2 presign + queue orchestration; partial coverage via upload routes + presign tests
				"src/entrypoint.ts", // RPC entrypoint — service binding / SELF not exercised in Vitest pool
			],
			// Floor sits slightly below measured totals so small edits don't flake.
			// Last measured (full include set): ~78.5% lines, ~77.8% stmts, ~66.9% branches, ~88% funcs.
			thresholds: {
				lines: 77,
				functions: 87,
				branches: 65,
				statements: 77,
			},
		},
		setupFiles: ["./tests/apply-migrations.ts"],
		poolOptions: {
			workers: {
				singleWorker: true,
				main: path.join(__dirname, "..", "src", "index.ts"),
				miniflare: {
					compatibilityDate: "2025-10-08",
					compatibilityFlags: ["experimental", "nodejs_compat"],
					bindings: {
						MIGRATIONS: migrations,
						GROK_API_KEY: "test-grok-api-key",
						ENVIRONMENT: "test",
						E2E_API_KEY: "test-e2e-key",
						RESEARCH_PROVIDER: "grok",
						AI_GATEWAY_URL: "http://localhost",
					},
					durableObjects: {
						PEP_EVENTS_DO: "PepEventsDO",
					},
					r2Buckets: {
						WATCHLIST_UPLOADS_BUCKET: "test-uploads-bucket",
					},
					d1Databases: {
						DB: "test-db",
					},
					kvNamespaces: {
						WATCHLIST_KV: "test-kv",
						PEP_CACHE: "test-pep-cache",
					},
				},
			},
		},
	},
});
