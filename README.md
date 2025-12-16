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

## API Endpoints

- `GET /healthz` - Health check
- `POST /search` - Semantic search for watchlist targets
- `GET /targets/:id` - Get target by ID
- `GET /ingestion/runs` - List ingestion runs
- `GET /ingestion/runs/:runId` - Get ingestion run details
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

The ingest workflow requires the following secret to be configured in your repository:

- `ADMIN_API_KEY` - The admin API key used to authenticate requests to the `/admin/ingest` endpoint

The `WORKER_URL` is automatically determined from the wrangler configuration files based on the selected environment:
- Dev: `https://watchlist-svc.algtools.workers.dev` (from `wrangler.jsonc`)
- Preview: `https://watchlist-svc.algtools.workers.dev` (from `wrangler.preview.jsonc`)
- Prod: `https://watchlist-svc.algenium.tools` (from `wrangler.prod.jsonc`)

To set the secret, go to your repository Settings → Secrets and variables → Actions → New repository secret.
