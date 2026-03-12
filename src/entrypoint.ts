import { WorkerEntrypoint } from "cloudflare:workers";
import { performSearch } from "./lib/search-core";
import { normalizeAmlSource, QUERY_SOURCE } from "./lib/query-source";
import type { Bindings } from "./index";

// =============================================================================
// RPC TYPES
// =============================================================================

export interface WatchlistSearchInput {
	q: string;
	entityType?: "person" | "organization";
	source?: string;
	birthDate?: string;
	countries?: string[];
	identifiers?: string[];
	topK?: number;
	threshold?: number;
}

export interface WatchlistSearchResult {
	queryId: string;
	ofacCount: number;
	unscCount: number;
	sat69bCount: number;
}

// =============================================================================
// RPC ENTRYPOINT
// =============================================================================

/**
 * RPC entrypoint for watchlist-svc.
 *
 * Exposes typed methods for inter-service communication via Cloudflare Service
 * Bindings. Callers must declare `"entrypoint": "WatchlistEntrypoint"` in their
 * wrangler config service binding.
 *
 * @example wrangler.jsonc (caller)
 * ```jsonc
 * {
 *   "services": [{
 *     "binding": "WATCHLIST_SERVICE",
 *     "service": "watchlist-svc",
 *     "entrypoint": "WatchlistEntrypoint"
 *   }]
 * }
 * ```
 *
 * @example caller worker
 * ```typescript
 * const result = await env.WATCHLIST_SERVICE.search(
 *   { q: "John Doe", entityType: "person" },
 *   organizationId,
 *   userId
 * );
 * ```
 */
export class WatchlistEntrypoint extends WorkerEntrypoint<Bindings> {
	/**
	 * Required stub — this entrypoint is RPC-only.
	 * Direct HTTP access returns 404.
	 */
	async fetch(): Promise<Response> {
		return new Response(null, { status: 404 });
	}

	/**
	 * Trigger an automated watchlist search (all datasets) for a given entity.
	 *
	 * Bypasses usage rights checks (internal call from aml-svc) and returns
	 * match counts by dataset. PEP and adverse media searches run asynchronously
	 * via the thread-svc pipeline.
	 *
	 * @param input - Search parameters (query, entity type, birth date, etc.)
	 * @param organizationId - Organization that owns the search
	 * @param userId - User who triggered the search
	 */
	async search(
		input: WatchlistSearchInput,
		organizationId: string,
		userId: string,
	): Promise<WatchlistSearchResult> {
		const normalizedSource = input.source
			? normalizeAmlSource(input.source)
			: QUERY_SOURCE.AML;
		const result = await performSearch({
			env: this.env,
			executionCtx: this.ctx,
			organizationId,
			userId,
			source: normalizedSource,
			query: input.q,
			entityType: input.entityType ?? "person",
			birthDate: input.birthDate,
			countries: input.countries,
			identifiers: input.identifiers,
			topK: input.topK ?? 50,
			threshold: input.threshold ?? 0.875,
		});

		return {
			queryId: result.queryId,
			ofacCount: result.ofac.count,
			unscCount: result.unsc.count,
			sat69bCount: result.sat69b.count,
		};
	}
}
