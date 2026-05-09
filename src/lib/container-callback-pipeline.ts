/**
 * Shared post-processing for internal container callbacks:
 * optional KV write → persist SearchQuery → completion check → AML RPC → SSE broadcast.
 */

import type { PrismaClient } from "@prisma/client";
import type { Bindings } from "../index";
import { createPrismaClient } from "./prisma";
import { QUERY_SOURCE } from "./query-source";
import {
	checkAndUpdateQueryCompletion,
	RESEARCH_CACHE_TTL_SECONDS_NEGATIVE,
} from "./search-query-utils";
import { broadcastPepEvent } from "./pep-events-broadcast";

export async function runWatchlistContainerSuccessPipeline(options: {
	env: Bindings;
	searchId: string;
	logPrefix: string;
	/** When set, writes JSON to PEP_CACHE; TTL defaults to long negative-result window unless overridden */
	cacheWrite?: {
		kv: KVNamespace;
		key: string;
		value: unknown;
		/** KV expiration in seconds */
		ttlSeconds?: number;
	};
	persist: (prisma: PrismaClient) => Promise<{ source: string }>;
	aml?: { type: string; matched: boolean };
	broadcast: { event: string; payload: Record<string, unknown> };
}): Promise<{ broadcastSent: number; cacheWritten: boolean }> {
	const { env, searchId, logPrefix, cacheWrite, persist, aml, broadcast } =
		options;

	let cacheWritten = false;
	if (cacheWrite) {
		const ttl = cacheWrite.ttlSeconds ?? RESEARCH_CACHE_TTL_SECONDS_NEGATIVE;
		try {
			await cacheWrite.kv.put(
				cacheWrite.key,
				JSON.stringify(cacheWrite.value),
				{ expirationTtl: ttl },
			);
			cacheWritten = true;
			console.log(
				`${logPrefix} Wrote KV cache (key: ${cacheWrite.key}, TTL: ${ttl}s)`,
			);
		} catch (error) {
			console.error(`${logPrefix} Failed to write cache:`, error);
		}
	}

	let broadcastSent = 0;

	try {
		const prisma = createPrismaClient(env.DB);
		const searchQuery = await persist(prisma);
		console.log(`${logPrefix} Persisted SearchQuery ${searchId}`);

		await checkAndUpdateQueryCompletion(prisma, searchId);

		if (searchQuery.source === QUERY_SOURCE.AML && env.AML_SERVICE && aml) {
			try {
				await env.AML_SERVICE.processScreeningCallback({
					queryId: searchId,
					type: aml.type,
					status: "completed",
					matched: aml.matched,
				});
				console.log(`${logPrefix} AML callback sent for query ${searchId}`);
			} catch (callbackError) {
				console.error(
					`${logPrefix} Failed to send AML callback:`,
					callbackError,
				);
			}
		}
	} catch (error) {
		console.error(`${logPrefix} Failed to persist to SearchQuery:`, error);
	}

	const { sent } = await broadcastPepEvent(
		env,
		searchId,
		broadcast.event,
		broadcast.payload,
	);
	broadcastSent = sent;
	if (sent > 0) {
		console.log(
			`${logPrefix} Broadcast sent to ${sent} clients for search ${searchId}`,
		);
	}

	return { broadcastSent, cacheWritten };
}

export async function runWatchlistContainerFailurePipeline(options: {
	env: Bindings;
	searchId: string;
	logPrefix: string;
	persist: (prisma: PrismaClient) => Promise<{ source: string }>;
	aml?: { type: string };
	broadcast: { event: string; payload: Record<string, unknown> };
}): Promise<void> {
	const { env, searchId, logPrefix, persist, aml, broadcast } = options;

	try {
		const prisma = createPrismaClient(env.DB);
		const searchQuery = await persist(prisma);
		console.log(`${logPrefix} Persisted failure to SearchQuery ${searchId}`);

		await checkAndUpdateQueryCompletion(prisma, searchId);

		if (searchQuery.source === QUERY_SOURCE.AML && env.AML_SERVICE && aml) {
			try {
				await env.AML_SERVICE.processScreeningCallback({
					queryId: searchId,
					type: aml.type,
					status: "failed",
					matched: false,
				});
				console.log(
					`${logPrefix} AML callback sent for failed query ${searchId}`,
				);
			} catch (callbackError) {
				console.error(
					`${logPrefix} Failed to send AML callback:`,
					callbackError,
				);
			}
		}
	} catch (persistError) {
		console.error(
			`${logPrefix} Failed to persist failure to SearchQuery:`,
			persistError,
		);
	}

	await broadcastPepEvent(env, searchId, broadcast.event, broadcast.payload);
}
