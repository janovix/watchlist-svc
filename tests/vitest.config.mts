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
				"src/lib/ingestion-service.ts", // Hard to test without external dependencies
				"src/lib/auth-middleware.ts", // Requires AUTH_SERVICE binding (service binding to auth-svc)
				"src/lib/auth-settings.ts", // Requires AUTH_SERVICE binding for getResolvedSettings
				"src/queue-consumer.ts", // Queue consumer requires queue infrastructure setup
				"src/endpoints/watchlist/pepSearch.ts", // Requires AI/Vectorize bindings difficult to mock
				"src/endpoints/watchlist/search.ts", // Requires AI/Vectorize bindings difficult to mock
				"src/lib/r2-presigned.ts", // Requires R2 bucket binding with presigned URL support
				"src/endpoints/watchlist/adminIngest.ts", // Requires WATCHLIST_INGEST_QUEUE binding
				"src/endpoints/watchlist/ingestionUpload.ts", // Requires WATCHLIST_INGEST_QUEUE binding
				"src/routes/upload.ts", // Requires R2 bucket binding for file uploads
			],
			thresholds: {
				lines: 85,
				functions: 80,
				branches: 80,
				statements: 85,
			},
		},
		setupFiles: ["./tests/apply-migrations.ts"],
		poolOptions: {
			workers: {
				singleWorker: true,
				main: path.join(__dirname, "..", "src", "index.ts"),
				miniflare: {
					compatibilityFlags: ["experimental", "nodejs_compat"],
					bindings: {
						MIGRATIONS: migrations,
						GROK_API_KEY: "test-grok-api-key",
						ENVIRONMENT: "test",
					},
					// Configure D1 database directly (no wrangler dev needed)
					// This prevents wrangler from trying to use remote mode
					d1Databases: {
						DB: "test-db",
					},
					kvNamespaces: {
						WATCHLIST_KV: "test-kv",
					},
				},
			},
		},
	},
});
