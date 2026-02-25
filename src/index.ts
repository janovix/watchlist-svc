import { ApiException, fromHono } from "chanfana";
import { Hono } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import * as Sentry from "@sentry/cloudflare";
import pkg from "../package.json";
import { getOpenApiInfo, getScalarHtml, type AppMeta } from "./app-meta";
import { authMiddleware, adminMiddleware } from "./lib/auth-middleware";
import { corsMiddleware } from "./middleware/cors";
import { HealthEndpoint } from "./endpoints/watchlist/health";
import { ConfigEndpoint } from "./endpoints/watchlist/config";
import { SearchEndpoint } from "./endpoints/watchlist/search";
import { SearchOfacEndpoint } from "./endpoints/watchlist/searchOfac";
import { SearchUnscEndpoint } from "./endpoints/watchlist/searchUnsc";
import { SearchSat69bEndpoint } from "./endpoints/watchlist/searchSat69b";
import {
	IngestionRunsListEndpoint,
	IngestionRunReadEndpoint,
} from "./endpoints/watchlist/ingestionRuns";
import { IngestionProgressEndpoint } from "./endpoints/watchlist/ingestionProgress";
import {
	IngestionStartEndpoint,
	IngestionCompleteEndpoint,
	IngestionFailedEndpoint,
} from "./endpoints/watchlist/ingestionUpload";
import { uploadRoutes } from "./routes/upload";
import {
	InternalOfacTruncateEndpoint,
	InternalOfacBatchEndpoint,
	InternalOfacCompleteEndpoint,
	InternalOfacFailedEndpoint,
} from "./endpoints/watchlist/internalOfac";
import {
	InternalSat69bTruncateEndpoint,
	InternalSat69bBatchEndpoint,
	InternalSat69bCompleteEndpoint,
	InternalSat69bFailedEndpoint,
} from "./endpoints/watchlist/internalSat69b";
import {
	InternalUnscTruncateEndpoint,
	InternalUnscBatchEndpoint,
	InternalUnscCompleteEndpoint,
	InternalUnscFailedEndpoint,
} from "./endpoints/watchlist/internalUnsc";
import {
	InternalPepResultsEndpoint,
	InternalPepFailedEndpoint,
} from "./endpoints/watchlist/internalPep";
import {
	InternalAdverseMediaResultsEndpoint,
	InternalAdverseMediaFailedEndpoint,
} from "./endpoints/watchlist/internalAdverseMedia";
import {
	InternalGrokPepResultsEndpoint,
	InternalGrokPepFailedEndpoint,
} from "./endpoints/watchlist/internalGrokPep";
import { InternalSearchEndpoint } from "./endpoints/watchlist/internalSearch";
import { QueryListEndpoint } from "./endpoints/watchlist/queryList";
import { QueryReadEndpoint } from "./endpoints/watchlist/queryRead";
import eventsRouter from "./endpoints/watchlist/events";
import {
	InternalVectorizeCountEndpoint,
	InternalVectorizeDeleteByDatasetEndpoint,
	InternalVectorizeIndexBatchEndpoint,
	InternalVectorizeCompleteEndpoint,
	InternalVectorizeSearchEndpoint,
	InternalVectorizeSearchHydratedEndpoint,
} from "./endpoints/watchlist/internalVectorize";
import { AdminVectorizeReindexEndpoint } from "./endpoints/watchlist/adminVectorize";

// Export Durable Objects
export { PepEventsDO } from "./durable-objects/pep-events";

/**
 * Extended environment bindings with Sentry support.
 */
export type Bindings = Env & {
	/**
	 * Cloudflare Worker version metadata.
	 * Used for Sentry release tracking.
	 */
	CF_VERSION_METADATA?: WorkerVersionMetadata;
	/**
	 * Sentry DSN for error tracking.
	 * If not set, Sentry will be disabled.
	 * Configured via Cloudflare Dashboard secrets or wrangler vars.
	 */
	SENTRY_DSN?: string;
	/**
	 * Environment identifier (e.g., "dev", "production").
	 */
	ENVIRONMENT?: string;
	/**
	 * Grok API key for AI-powered features.
	 */
	GROK_API_KEY?: string;
	/**
	 * R2 bucket for storing uploaded watchlist files (XML, etc.)
	 */
	WATCHLIST_UPLOADS_BUCKET?: R2Bucket;
	/**
	 * R2 Access Key ID for generating presigned URLs.
	 * Create via Cloudflare Dashboard > R2 > Manage R2 API Tokens
	 */
	R2_ACCESS_KEY_ID?: string;
	/**
	 * R2 Secret Access Key for generating presigned URLs.
	 * Create via Cloudflare Dashboard > R2 > Manage R2 API Tokens
	 */
	R2_SECRET_ACCESS_KEY?: string;
	/**
	 * Cloudflare Account ID for R2 endpoint URL.
	 * Find in Cloudflare Dashboard URL or Overview page.
	 */
	CLOUDFLARE_ACCOUNT_ID?: string;
	/**
	 * R2 bucket name (optional, defaults to 'watchlist-uploads').
	 * Override if using different bucket names per environment.
	 */
	R2_BUCKET_NAME?: string;
	/**
	 * Thread service binding for creating and tracking threads.
	 */
	THREAD_SVC?: Fetcher;
	/**
	 * AML service binding for screening result callbacks.
	 */
	AML_SERVICE?: Fetcher;
	/**
	 * PEP cache KV namespace for temporary 24h result caching.
	 */
	PEP_CACHE?: KVNamespace;
	/**
	 * Enable/disable PEP cache (default: "false").
	 */
	PEP_CACHE_ENABLED?: string;
	/**
	 * PEP Events Durable Object for SSE streaming.
	 */
	PEP_EVENTS_DO?: DurableObjectNamespace;
	/**
	 * Enable/disable PEP official search (default: "true").
	 * Set to "false" to skip the pepsearch container lookup.
	 */
	PEP_SEARCH_ENABLED?: string;
	/**
	 * Enable/disable PEP AI (Grok) search (default: "true").
	 * Set to "false" to skip the pep_grok container lookup.
	 */
	PEP_GROK_ENABLED?: string;
	/**
	 * Enable/disable Adverse Media search (default: "true").
	 * Set to "false" to skip the adverse_media_grok container lookup.
	 */
	ADVERSE_MEDIA_ENABLED?: string;
};

// Start a Hono app
const app = new Hono<{ Bindings: Bindings }>();

// CORS middleware using TRUSTED_ORIGINS environment variable
app.use("*", corsMiddleware());

const appMeta: AppMeta = {
	name: pkg.name,
	version: pkg.version,
	description: pkg.description,
};

app.onError((err, c) => {
	if (err instanceof ApiException) {
		// If it's a Chanfana ApiException, let Chanfana handle the response
		return c.json(
			{ success: false, errors: err.buildResponse() },
			err.status as ContentfulStatusCode,
		);
	}

	console.error("Global error handler caught:", err); // Log the error if it's not known

	// For other errors, return a generic 500 response
	return c.json(
		{
			success: false,
			errors: [{ code: 7000, message: "Internal Server Error" }],
		},
		500,
	);
});

// Setup OpenAPI registry
const openapi = fromHono(app, {
	// Keep the autogenerated docs available; serve Scalar at `/docsz`.
	docs_url: "/docs",
	schema: {
		info: getOpenApiInfo(appMeta),
	},
});

app.get("/", (c) => {
	if (c.req.header("x-force-error") === "1") {
		throw new Error("Forced error");
	}

	return c.json({ name: appMeta.name, version: appMeta.version });
});

app.get("/docsz", (c) => {
	return c.html(getScalarHtml(appMeta));
});

// Apply auth middleware to protected routes
// Pattern: Apply middleware to specific paths before registering endpoints
app.use("/search", authMiddleware());
app.use("/search/ofac", authMiddleware());
app.use("/search/unsc", authMiddleware());
app.use("/search/sat69b", authMiddleware());
app.use("/queries", authMiddleware());
app.use("/queries/:queryId", authMiddleware());

// Admin routes require authentication + admin role
// All admin-facing endpoints are served under /admin with admin JWT validation
app.use("/admin/*", authMiddleware());
app.use("/admin/*", adminMiddleware());
app.use("/api/upload/*", authMiddleware());
app.use("/api/upload/*", adminMiddleware());

// Register watchlist endpoints
openapi.get("/healthz", HealthEndpoint);
openapi.get("/config", ConfigEndpoint);
openapi.post("/search", SearchEndpoint);
openapi.post("/search/ofac", SearchOfacEndpoint);
openapi.post("/search/unsc", SearchUnscEndpoint);
openapi.post("/search/sat69b", SearchSat69bEndpoint);

// Query management endpoints (authenticated)
openapi.get("/queries", QueryListEndpoint);
openapi.get("/queries/:queryId", QueryReadEndpoint);

// Ingestion endpoints under /admin (require admin JWT)
openapi.get("/admin/ingestion/runs", IngestionRunsListEndpoint);
openapi.get("/admin/ingestion/runs/:runId", IngestionRunReadEndpoint);
openapi.get("/admin/ingestion/runs/:runId/progress", IngestionProgressEndpoint);
openapi.post("/admin/ingestion/start", IngestionStartEndpoint);
openapi.post("/admin/ingestion/:runId/complete", IngestionCompleteEndpoint);
openapi.post("/admin/ingestion/:runId/failed", IngestionFailedEndpoint);

// Admin management endpoints
openapi.post("/admin/vectorize/reindex", AdminVectorizeReindexEndpoint);

// Mount upload routes (for file uploads to R2)
app.route("/api/upload", uploadRoutes);

// Internal endpoints for container callbacks (no auth - secured via service binding)
openapi.post("/internal/ofac/truncate", InternalOfacTruncateEndpoint);
openapi.post("/internal/ofac/batch", InternalOfacBatchEndpoint);
openapi.post("/internal/ofac/complete", InternalOfacCompleteEndpoint);
openapi.post("/internal/ofac/failed", InternalOfacFailedEndpoint);

// Internal SAT 69-B endpoints for container callbacks
openapi.post("/internal/sat69b/truncate", InternalSat69bTruncateEndpoint);
openapi.post("/internal/sat69b/batch", InternalSat69bBatchEndpoint);
openapi.post("/internal/sat69b/complete", InternalSat69bCompleteEndpoint);
openapi.post("/internal/sat69b/failed", InternalSat69bFailedEndpoint);

// Internal UNSC endpoints for container callbacks
openapi.post("/internal/unsc/truncate", InternalUnscTruncateEndpoint);
openapi.post("/internal/unsc/batch", InternalUnscBatchEndpoint);
openapi.post("/internal/unsc/complete", InternalUnscCompleteEndpoint);
openapi.post("/internal/unsc/failed", InternalUnscFailedEndpoint);

// Internal search endpoint for aml-svc (no auth, secured via service binding)
openapi.post("/internal/search", InternalSearchEndpoint);

// Internal PEP endpoints for container callbacks
openapi.post("/internal/pep/results", InternalPepResultsEndpoint);
openapi.post("/internal/pep/failed", InternalPepFailedEndpoint);

// Internal Grok PEP endpoints for AI-powered PEP search
openapi.post("/internal/grok-pep/results", InternalGrokPepResultsEndpoint);
openapi.post("/internal/grok-pep/failed", InternalGrokPepFailedEndpoint);

// Internal Adverse Media endpoints for AI-powered adverse media search
openapi.post(
	"/internal/adverse-media/results",
	InternalAdverseMediaResultsEndpoint,
);
openapi.post(
	"/internal/adverse-media/failed",
	InternalAdverseMediaFailedEndpoint,
);

// Events SSE endpoint for all async search results (public, authenticated via query param or JWT)
app.route("/events", eventsRouter);

// Internal vectorize endpoints for indexing
openapi.get("/internal/vectorize/count", InternalVectorizeCountEndpoint);
openapi.post(
	"/internal/vectorize/delete-by-dataset",
	InternalVectorizeDeleteByDatasetEndpoint,
);
openapi.post(
	"/internal/vectorize/index-batch",
	InternalVectorizeIndexBatchEndpoint,
);
openapi.post("/internal/vectorize/complete", InternalVectorizeCompleteEndpoint);

// Internal vectorize debug endpoints
openapi.post("/internal/vectorize/search", InternalVectorizeSearchEndpoint);
openapi.post(
	"/internal/vectorize/search-hydrated",
	InternalVectorizeSearchHydratedEndpoint,
);

// Sentry is enabled only when SENTRY_DSN environment variable is set.
// Configure it via wrangler secrets: `wrangler secret put SENTRY_DSN`
export default Sentry.withSentry((env: Bindings) => {
	const versionId = env.CF_VERSION_METADATA?.id;
	return {
		// When DSN is undefined/empty, Sentry SDK is disabled (no events sent)
		dsn: env.SENTRY_DSN,
		release: versionId,
		environment: env.ENVIRONMENT,
		// Adds request headers and IP for users, for more info visit:
		// https://docs.sentry.io/platforms/javascript/guides/cloudflare/configuration/options/#sendDefaultPii
		sendDefaultPii: true,
	};
}, app);
