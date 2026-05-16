# E2E internal API (`watchlist-svc`)

Mounted at **`/api/v1/internal/e2e`**.

## Auth

Header **`x-e2e-api-key`** must match worker **`E2E_API_KEY`**.

## `POST /purge`

Body: `{ "organizationIds": string[] }`.

Deletes tenant-scoped watchlist data (e.g. `SearchQuery` rows) for those organizations.

Caller: **`auth-svc`** `POST /api/admin/e2e/purge` fan-out.
