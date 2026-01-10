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
				"src/queue-consumer.ts", // Queue consumer requires queue infrastructure setup
				"src/endpoints/watchlist/pepSearch.ts", // Requires AI/Vectorize bindings difficult to mock
				"src/endpoints/watchlist/search.ts", // Requires AI/Vectorize bindings difficult to mock
			],
			thresholds: {
				lines: 70,
				functions: 70,
				branches: 60,
				statements: 70,
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
