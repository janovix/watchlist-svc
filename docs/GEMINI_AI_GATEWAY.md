# Gemini research + Cloudflare AI Gateway

Watchlist PEP AI and adverse-media screening use **Gemini 2.5 Flash** with **Google Search grounding** (`google_search` tool), routed through **Cloudflare AI Gateway**.

## One-time setup

1. In the Cloudflare dashboard, create an **AI Gateway** (suggested name: `watchlist-research`).
2. Note your **account ID** and gateway **name**. Base URL pattern:

   `https://gateway.ai.cloudflare.com/v1/<ACCOUNT_ID>/<GATEWAY_NAME>`

3. Set Worker vars (see `wrangler*.jsonc`):

   - `AI_GATEWAY_URL` — full base URL above (no trailing slash).

4. Create a **Google AI Studio** API key (Gemini API, paid tier when serving production PII).

   ```bash
   cd watchlist-svc
   wrangler secret put GEMINI_API_KEY
   ```

5. Optional: enable **rate limiting** on the gateway (e.g. 1000 grounded requests/hour) and **request logging** (7-day retention) for audits.

6. Optional **multi-provider failover** (Claude / OpenAI with web search) can be configured on the same gateway; see [AI Gateway docs](https://developers.cloudflare.com/ai-gateway/). No Worker code changes required beyond routing.

## Request path

The Worker calls:

`POST {AI_GATEWAY_URL}/google-ai-studio/v1beta/models/{GEMINI_MODEL}:generateContent`

with header `x-goog-api-key: <GEMINI_API_KEY>`.

Override model with var `GEMINI_MODEL` (default `gemini-2.5-flash`).

## Compliance

Screening payloads may include names and dates of birth. Ensure customer DPAs / LFPDPPP posture allow processing via Google AI Studio paid API (or switch to Vertex AI and point the gateway there).

## Optional multi-provider failover

Cloudflare AI Gateway can route to fallback providers (e.g. Anthropic with web search, OpenAI) when Gemini errors or rate-limits. Configure in the dashboard; Worker code can stay on the same `AI_GATEWAY_URL` entrypoint.
