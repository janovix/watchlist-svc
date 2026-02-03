#!/usr/bin/env node
/**
 * CSV ingestion script for watchlist service
 * Can be run locally or in CI to ingest CSV files
 *
 * Usage:
 *   node scripts/ingest-csv.mjs --csv-url <URL> [--env dev|preview|prod] [--reindex-all]
 *
 * Authentication:
 *   Requires a JWT token with admin role from auth-svc.
 *   Set AUTH_TOKEN environment variable with a valid Bearer token.
 */

import { parseArgs } from "util";

const args = parseArgs({
	options: {
		"csv-url": {
			type: "string",
			required: true,
		},
		env: {
			type: "string",
			default: "dev",
		},
		"reindex-all": {
			type: "boolean",
			default: false,
		},
	},
});

const csvUrl = args.values["csv-url"];
const env = args.values.env || "dev";
const reindexAll = args.values["reindex-all"] || false;

if (!csvUrl) {
	console.error("Error: --csv-url is required");
	process.exit(1);
}

if (!["dev", "preview", "prod"].includes(env)) {
	console.error("Error: --env must be one of: dev, preview, prod");
	process.exit(1);
}

// Determine wrangler config file
const configFile =
	env === "prod"
		? "wrangler.prod.jsonc"
		: env === "preview"
			? "wrangler.preview.jsonc"
			: "wrangler.jsonc";

console.log(`Ingesting CSV from: ${csvUrl}`);
console.log(`Environment: ${env}`);
console.log(`Config file: ${configFile}`);
console.log(`Reindex all: ${reindexAll}`);

// Use wrangler to trigger ingestion via the admin endpoint
// This requires a JWT token with admin role from auth-svc
const authToken = process.env.AUTH_TOKEN;
if (!authToken) {
	console.error("Error: AUTH_TOKEN environment variable is required");
	console.error("Get a JWT token with admin role from auth-svc");
	process.exit(1);
}

// Get the worker URL (for local testing, you might use wrangler dev)
// For remote, we'd need to know the deployed URL
// For now, this script assumes you'll use the admin API endpoint
// In CI, you can use wrangler tail or the deployed URL

console.log("\nNote: This script is a placeholder.");
console.log("For actual ingestion, use one of:");
console.log(
	"1. Deploy the worker and call POST /admin/ingest with JWT Bearer token",
);
console.log("2. Use wrangler dev and call the endpoint locally");
console.log("3. Use GitHub Actions workflow (recommended)");

// Example: If you have a deployed worker URL
const workerUrl = process.env.WORKER_URL;
if (workerUrl) {
	console.log(`\nCalling ingestion endpoint at: ${workerUrl}/admin/ingest`);
	try {
		const response = await fetch(`${workerUrl}/admin/ingest`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${authToken}`,
			},
			body: JSON.stringify({
				csvUrl,
				reindexAll,
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			console.error(`Error: ${response.status} ${error}`);
			process.exit(1);
		}

		const result = await response.json();
		console.log("Ingestion started:", JSON.stringify(result, null, 2));
	} catch (error) {
		console.error("Failed to trigger ingestion:", error);
		process.exit(1);
	}
} else {
	console.log(
		"\nSet WORKER_URL environment variable to trigger ingestion remotely",
	);
	console.log("Or use the GitHub Actions workflow for automated ingestion");
}
