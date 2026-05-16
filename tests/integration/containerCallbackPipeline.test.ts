import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src";
import {
	runWatchlistContainerFailurePipeline,
	runWatchlistContainerSuccessPipeline,
} from "../../src/lib/container-callback-pipeline";
import { QUERY_SOURCE } from "../../src/lib/query-source";

function makeEnv(overrides: Partial<Bindings> = {}): Bindings {
	return {
		...(env as unknown as Bindings),
		PEP_EVENTS_DO: undefined,
		...overrides,
	} as unknown as Bindings;
}

function makeKv(put: ReturnType<typeof vi.fn>): KVNamespace {
	return {
		put,
	} as unknown as KVNamespace;
}

describe("container-callback-pipeline", () => {
	it("writes cache, persists, sends AML callback, and tolerates missing event DO", async () => {
		const kvPut = vi.fn(async () => undefined);
		const amlCallback = vi.fn(async () => undefined);
		const persist = vi.fn(async () => ({ source: QUERY_SOURCE.AML }));

		const result = await runWatchlistContainerSuccessPipeline({
			env: makeEnv({
				AML_SERVICE: {
					processScreeningCallback: amlCallback,
				} as unknown as Bindings["AML_SERVICE"],
			}),
			searchId: "pipeline-success",
			logPrefix: "[test]",
			cacheWrite: {
				kv: makeKv(kvPut),
				key: "pipeline-key",
				value: { ok: true },
				ttlSeconds: 123,
			},
			persist,
			aml: { type: "pep_ai", matched: true },
			broadcast: { event: "pep_results", payload: { ok: true } },
		});

		expect(result).toEqual({ broadcastSent: 0, cacheWritten: true });
		expect(kvPut).toHaveBeenCalledWith(
			"pipeline-key",
			JSON.stringify({ ok: true }),
			{ expirationTtl: 123 },
		);
		expect(persist).toHaveBeenCalledTimes(1);
		expect(amlCallback).toHaveBeenCalledWith({
			queryId: "pipeline-success",
			type: "pep_ai",
			status: "completed",
			matched: true,
		});
	});

	it("continues when cache writes fail", async () => {
		const kvPut = vi.fn(async () => {
			throw new Error("kv down");
		});
		const persist = vi.fn(async () => ({
			source: QUERY_SOURCE.WATCHLIST_QUERY,
		}));

		const result = await runWatchlistContainerSuccessPipeline({
			env: makeEnv(),
			searchId: "pipeline-cache-fail",
			logPrefix: "[test]",
			cacheWrite: {
				kv: makeKv(kvPut),
				key: "pipeline-key",
				value: { ok: false },
			},
			persist,
			broadcast: { event: "pep_results", payload: { ok: false } },
		});

		expect(result.cacheWritten).toBe(false);
		expect(persist).toHaveBeenCalledTimes(1);
	});

	it("continues to broadcast when persist fails", async () => {
		await expect(
			runWatchlistContainerSuccessPipeline({
				env: makeEnv(),
				searchId: "pipeline-persist-fail",
				logPrefix: "[test]",
				persist: async () => {
					throw new Error("persist down");
				},
				broadcast: { event: "pep_results", payload: { ok: false } },
			}),
		).resolves.toEqual({ broadcastSent: 0, cacheWritten: false });
	});

	it("swallows AML callback failures after persistence", async () => {
		const amlCallback = vi.fn(async () => {
			throw new Error("aml down");
		});

		await expect(
			runWatchlistContainerSuccessPipeline({
				env: makeEnv({
					AML_SERVICE: {
						processScreeningCallback: amlCallback,
					} as unknown as Bindings["AML_SERVICE"],
				}),
				searchId: "pipeline-aml-fail",
				logPrefix: "[test]",
				persist: async () => ({ source: QUERY_SOURCE.AML }),
				aml: { type: "adverse_media", matched: false },
				broadcast: { event: "adverse_media_results", payload: { ok: true } },
			}),
		).resolves.toEqual({ broadcastSent: 0, cacheWritten: false });
		expect(amlCallback).toHaveBeenCalledTimes(1);
	});

	it("sends failed AML callback in the failure pipeline", async () => {
		const amlCallback = vi.fn(async () => undefined);

		await runWatchlistContainerFailurePipeline({
			env: makeEnv({
				AML_SERVICE: {
					processScreeningCallback: amlCallback,
				} as unknown as Bindings["AML_SERVICE"],
			}),
			searchId: "pipeline-failure",
			logPrefix: "[test]",
			persist: async () => ({ source: QUERY_SOURCE.AML }),
			aml: { type: "pep_ai" },
			broadcast: { event: "pep_error", payload: { error: "failed" } },
		});

		expect(amlCallback).toHaveBeenCalledWith({
			queryId: "pipeline-failure",
			type: "pep_ai",
			status: "failed",
			matched: false,
		});
	});
});
