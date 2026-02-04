# Watchlist Ingestion + Search Service

Watchlist ingestion and search service using Hono + Chanfana + D1 + Vectorize.

## Features

- CSV ingestion with idempotent upsert
- Semantic search using Cloudflare Vectorize
- Vector indexing with automatic sync
- Admin endpoints for ingestion and reindexing
- OpenAPI documentation

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

- `GROK_API_KEY` - API key for Grok API (used for PEP search fallback)

- `AUTH_SERVICE` - Service binding to auth-svc for JWT validation
- `AUTH_SERVICE_URL` - URL for auth-svc JWKS endpoint
- `AUTH_JWKS_CACHE_TTL` - Cache TTL for JWKS (default: 3600 seconds)
- `TRUSTED_ORIGINS` - Comma-separated list of allowed origin patterns for CORS (e.g., `*.janovix.workers.dev,http://localhost:*`). If not set, all CORS requests are denied (security-first).

## API Endpoints

- `GET /healthz` - Health check
- `POST /search` - Semantic search for watchlist targets (requires auth)
- `POST /pep/search` - PEP (Politically Exposed Person) search with match confidence (requires auth)
- `GET /targets/:id` - Get target by ID (requires auth)
- `GET /ingestion/runs` - List ingestion runs
- `GET /ingestion/runs/:runId` - Get ingestion run details
- `POST /admin/ingest` - Trigger CSV ingestion (requires admin role)
- `POST /admin/ingest/sdn-xml` - Trigger SDN XML ingestion from R2 (requires admin role)
- `POST /admin/reindex` - Reindex all vectors (requires admin role)
- `POST /api/upload/sdn-xml/prepare` - Prepare SDN XML upload (requires admin role)
- `POST /api/upload/sdn-xml` - Upload SDN XML file (requires admin role)
- `DELETE /api/upload/sdn-xml/:key` - Delete uploaded SDN XML file (requires admin role)

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

## Authentication

This service uses JWT-based authentication via auth-svc (better-auth).

- **Regular endpoints** (`/search`, `/pep/search`, `/targets/*`): Require a valid JWT token
- **Admin endpoints** (`/admin/*`, `/api/upload/*`): Require a valid JWT token with `role: "admin"`

To authenticate, include the JWT token in the `Authorization` header:

```
Authorization: Bearer <your-jwt-token>
```

## Ingestion

Ingest CSV files via GitHub Actions workflow or admin endpoint:

- GitHub Actions: Use the manual workflow with `csv_url` input
- Admin endpoint: `POST /admin/ingest` with JWT Bearer token (requires admin role)

### GitHub Actions Setup

The ingest workflow requires the following to be configured in your repository:

- `WORKER_URL` (variable) - The deployed Cloudflare Worker URL (e.g., `https://your-worker.your-subdomain.workers.dev`)
- `AUTH_TOKEN` (secret) - A JWT token with admin role from auth-svc

To set these:

- For variables: Go to Settings → Secrets and variables → Actions → Variables tab → New repository variable
- For secrets: Go to Settings → Secrets and variables → Actions → Secrets tab → New repository secret
