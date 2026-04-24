# Re-indexing after `bge-m3` (1024-dim) migration

Watchlist search uses Cloudflare Vectorize with **`@cf/baai/bge-m3`**, which produces **1024-dimensional** vectors. The previous `bge-base-en-v1.5` index used 768 dimensions — they are not compatible.

## 1. Create Vectorize indexes (per environment)

From `watchlist-svc/` (requires `wrangler` and Cloudflare auth):

```bash
npx wrangler vectorize create watchlist-m3-dev     --dimensions=1024 --metric=cosine
npx wrangler vectorize create watchlist-m3-preview --dimensions=1024 --metric=cosine
npx wrangler vectorize create watchlist-m3         --dimensions=1024 --metric=cosine
```

Optional metadata index on `recordId` / `dataset` is configured in the Vectorize setup your team uses; align with the existing `watchlist-*` pattern.

## 2. Re-ingest datasets

Use the internal `internalVectorize` indexing flow (e.g. thread-worker / container) to re-embed and upsert **ofac_sdn**, **unsc**, and **sat_69b** into the new index **before** or **in parallel** with cutover, then point workers at the new `index_name` in `wrangler.*.jsonc` (see `WATCHLIST_VECTORIZE`).

## 3. Cutover

- Deploy with bindings pointing to `watchlist-m3*`.
- Keep the old 768-dim index briefly for rollback if needed.
- Delete the old index after sign-off.
