# Watchlist Ingestion + Search Service

Watchlist ingestion and search service using Hono + Chanfana + D1 + Vectorize.

## Features

- CSV ingestion with idempotent upsert
- Semantic search using Cloudflare Vectorize
- Vector indexing with automatic sync
- Admin endpoints for ingestion and reindexing
- OpenAPI documentation
- Authentication via better-auth session validation
- Service binding support for worker-to-worker communication

## Setup Steps

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create D1 databases for each environment:

   ```bash
   # Dev (already configured in wrangler.jsonc)
   # Preview (already configured in wrangler.preview.jsonc)
   # Prod (already configured in wrangler.prod.jsonc)
   ```

3. Create Vectorize indexes:

   ```bash
   # Dev index
   wrangler vectorize create watchlist-dev --dimensions=768 --metric=cosine --description="Watchlist semantic search index for dev"

   # Preview index
   wrangler vectorize create watchlist-preview --dimensions=768 --metric=cosine --description="Watchlist semantic search index for preview"

   # Prod index
   wrangler vectorize create watchlist --dimensions=768 --metric=cosine --description="Watchlist semantic search index for production"
   ```

4. Run migrations:

   ```bash
   pnpm run seedLocalDb  # For local development
   pnpm run predeploy:dev  # For remote dev
   ```

5. Generate Prisma client:

   ```bash
   pnpm exec prisma generate
   ```

6. Start development server:
   ```bash
   pnpm run dev
   ```

## Environment Variables

- `ADMIN_API_KEY` - Admin API key for protected admin endpoints
- `GROK_API_KEY` - API key for Grok API (used for PEP search fallback)
- `CORS_ALLOWED_DOMAIN` - Base domain for CORS configuration (e.g., `janovix.workers.dev`). If not set, all origins are allowed (development mode).
- `AUTH_SERVICE_URL` - (Optional) Fallback URL for auth service when service binding is not available (for local dev or HTTP fallback)

## Authentication

The service supports two authentication methods:

1. **Session-based authentication (better-auth)**: Most API endpoints require a valid session from the auth-svc service. The session is validated via:

   - Service binding to `auth-svc` worker (preferred, configured in wrangler.jsonc)
   - HTTP fallback to `AUTH_SERVICE_URL` if service binding is not available

2. **Admin API key**: Admin endpoints (`/admin/*`) use the `x-admin-api-key` header with the `ADMIN_API_KEY` environment variable.

### Protected Endpoints

The following endpoints require session authentication:

- `POST /search` - Semantic search
- `POST /pep/search` - PEP search
- `GET /targets/:id` - Get target by ID
- `GET /ingestion/runs` - List ingestion runs
- `GET /ingestion/runs/:runId` - Get ingestion run details

### Service Binding

This service can be used from other Cloudflare Workers via service binding. The service binding is configured in `wrangler.jsonc`:

```jsonc
"services": [
  {
    "binding": "AUTH_SERVICE",
    "service": "auth-svc",
  },
]
```

Other workers can bind to this service and call it directly:

```typescript
// In another worker's wrangler.jsonc
"services": [
  {
    "binding": "WATCHLIST_SERVICE",
    "service": "watchlist-svc",
  },
]

// In the worker code
const response = await env.WATCHLIST_SERVICE.fetch(
  new Request("https://watchlist-svc.internal/search", {
    method: "POST",
    headers: { Cookie: request.headers.get("Cookie") || "" },
    body: JSON.stringify({ query: "search term" }),
  })
);
```

**Note**: The auth-svc must expose a `/api/auth/session` endpoint that accepts session cookies and returns session data. If your better-auth configuration uses a different endpoint, you may need to update the `validateSession` function in `src/lib/auth.ts`.

## API Endpoints

- `GET /healthz` - Health check (public)
- `POST /search` - Semantic search for watchlist targets (requires authentication)
- `POST /pep/search` - PEP (Politically Exposed Person) search with match confidence (requires authentication)
- `GET /targets/:id` - Get target by ID (requires authentication)
- `GET /ingestion/runs` - List ingestion runs (requires authentication)
- `GET /ingestion/runs/:runId` - Get ingestion run details (requires authentication)
- `POST /admin/ingest` - Trigger CSV ingestion (requires ADMIN_API_KEY)
- `POST /admin/reindex` - Reindex all vectors (requires ADMIN_API_KEY)

## Testing

Run tests with coverage:

```bash
pnpm run test
pnpm run vitest:coverage
```

## Deployment

Deploy to different environments:

```bash
pnpm run deploy:dev      # Deploy to dev
pnpm run deploy:prod     # Deploy to production
```

## Ingestion

Ingest CSV files via GitHub Actions workflow or admin endpoint:

- GitHub Actions: Use the manual workflow with `csv_url` input
- Admin endpoint: `POST /admin/ingest` with `x-admin-api-key` header

### GitHub Actions Setup

The ingest workflow requires the following to be configured in your repository:

- `WORKER_URL` (variable) - The deployed Cloudflare Worker URL (e.g., `https://your-worker.your-subdomain.workers.dev`)
- `ADMIN_API_KEY` (secret) - The admin API key used to authenticate requests to the `/admin/ingest` endpoint

To set these:

- For variables: Go to Settings → Secrets and variables → Actions → Variables tab → New repository variable
- For secrets: Go to Settings → Secrets and variables → Actions → Secrets tab → New repository secret
