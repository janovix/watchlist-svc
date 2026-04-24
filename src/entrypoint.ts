import { WorkerEntrypoint } from "cloudflare:workers";
import { performSearch } from "./lib/search-core";
import { createPrismaClient } from "./lib/prisma";
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
	/** Deployment environment for data isolation (defaults to "production") */
	environment?: string;
	/** AML client or beneficial controller ID */
	entityId?: string;
	entityKind?: "client" | "beneficial_controller";
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
		if (typeof organizationId !== "string" || !organizationId.trim()) {
			throw new Error(
				"RPC search: organizationId is required and must be a non-empty string",
			);
		}
		if (typeof userId !== "string" || !userId.trim()) {
			throw new Error(
				"RPC search: userId is required and must be a non-empty string",
			);
		}
		if (typeof input?.q !== "string" || !input.q.trim()) {
			throw new Error(
				"RPC search: input.q is required and must be a non-empty string",
			);
		}
		const entityType = input.entityType ?? "person";
		if (entityType !== "person" && entityType !== "organization") {
			throw new Error(
				`RPC search: input.entityType must be "person" or "organization", got ${JSON.stringify(entityType)}`,
			);
		}
		const topK = Math.min(
			1000,
			Math.max(1, Math.floor(Number(input.topK) || 50)),
		);
		const rawThreshold = Number(input.threshold);
		const threshold = Number.isFinite(rawThreshold)
			? Math.min(1, Math.max(0, rawThreshold))
			: 0.875;

		const normalizedSource = input.source
			? normalizeAmlSource(input.source)
			: QUERY_SOURCE.AML;
		const environment = input.environment || "production";
		const result = await performSearch({
			env: this.env,
			executionCtx: this.ctx,
			organizationId: organizationId.trim(),
			userId: userId.trim(),
			source: normalizedSource,
			query: input.q.trim(),
			entityType,
			birthDate: input.birthDate,
			countries: input.countries,
			identifiers: input.identifiers,
			topK,
			threshold,
			environment,
			entityId: input.entityId,
			entityKind: input.entityKind,
		});

		return {
			queryId: result.queryId,
			ofacCount: result.ofac.count,
			unscCount: result.unsc.count,
			sat69bCount: result.sat69b.count,
		};
	}

	/**
	 * List stored search queries for a linked AML entity (newest first).
	 */
	async listByEntity(
		organizationId: string,
		entityId: string,
		options?: { limit?: number; offset?: number },
	) {
		if (typeof organizationId !== "string" || !organizationId.trim()) {
			throw new Error("listByEntity: organizationId is required");
		}
		if (typeof entityId !== "string" || !entityId.trim()) {
			throw new Error("listByEntity: entityId is required");
		}
		const take = Math.min(200, Math.max(1, Math.floor(options?.limit ?? 50)));
		const skip = Math.max(0, Math.floor(options?.offset ?? 0));
		const prisma = createPrismaClient(this.env.DB);
		const [rows, total] = await Promise.all([
			prisma.searchQuery.findMany({
				where: {
					organizationId: organizationId.trim(),
					entityId: entityId.trim(),
				},
				orderBy: { createdAt: "desc" },
				take,
				skip,
			}),
			prisma.searchQuery.count({
				where: {
					organizationId: organizationId.trim(),
					entityId: entityId.trim(),
				},
			}),
		]);
		return { data: rows, total, limit: take, offset: skip };
	}
}
