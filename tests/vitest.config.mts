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
				wrangler: {
					configPath: "../wrangler.test.jsonc",
					environment: undefined,
				},
				miniflare: {
					compatibilityFlags: ["experimental", "nodejs_compat"],
					bindings: {
						MIGRATIONS: migrations,
					},
				},
			},
		},
	},
});
