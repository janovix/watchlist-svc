import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src";
import eventsRouter from "../../src/endpoints/watchlist/events";
import { broadcastPepEvent } from "../../src/lib/pep-events-broadcast";

/**
 * Covers {@link PepEventsDO} via the mounted `/events` Hono router (stub.fetch → DO).
 * Avoids `runInDurableObject` here — nested DO RPC in the Vitest pool timed out and broke isolated storage teardown.
 */
describe("PEP events / PEP_EVENTS_DO", () => {
	it("GET returns SSE stream when binding is configured", async () => {
		expect(env.PEP_EVENTS_DO).toBeDefined();

		const res = await eventsRouter.request(
			`http://localhost/pep-route-${crypto.randomUUID()}`,
			{ method: "GET" },
			env,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("event-stream");
		await res.body?.cancel();
	});

	it("events route handles missing search id and missing DO binding", async () => {
		const missingSearchId = await eventsRouter.request(
			"http://localhost/",
			{ method: "GET" },
			env,
		);
		expect(missingSearchId.status).toBe(404);

		const missingBinding = await eventsRouter.request(
			"http://localhost/search-without-binding",
			{ method: "GET" },
			{ ...(env as unknown as Bindings), PEP_EVENTS_DO: undefined },
		);
		expect(missingBinding.status).toBe(500);
		await expect(missingBinding.json()).resolves.toMatchObject({
			error: "PEP Events service not configured",
		});
	});

	it("events route returns 500 when Durable Object lookup throws", async () => {
		const brokenNamespace = {
			idFromName: vi.fn(() => {
				throw new Error("bad id");
			}),
		} as unknown as DurableObjectNamespace;

		const res = await eventsRouter.request(
			"http://localhost/search-broken-do",
			{ method: "GET" },
			{
				...(env as unknown as Bindings),
				PEP_EVENTS_DO: brokenNamespace,
			},
		);

		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toMatchObject({
			error: "Failed to establish SSE connection",
		});
	});

	it("broadcastPepEvent handles missing, failing, throwing, and successful namespaces", async () => {
		await expect(
			broadcastPepEvent({} as Bindings, "missing", "pep_results", {}),
		).resolves.toEqual({ ok: false, sent: 0 });

		const nonOkNamespace = {
			idFromName: vi.fn(() => "id"),
			get: vi.fn(() => ({
				fetch: vi.fn(async () => new Response("nope", { status: 500 })),
			})),
		} as unknown as DurableObjectNamespace;
		await expect(
			broadcastPepEvent(
				{ PEP_EVENTS_DO: nonOkNamespace } as Bindings,
				"non-ok",
				"pep_results",
				{},
			),
		).resolves.toEqual({ ok: false, sent: 0 });

		const throwingNamespace = {
			idFromName: vi.fn(() => "id"),
			get: vi.fn(() => {
				throw new Error("do unavailable");
			}),
		} as unknown as DurableObjectNamespace;
		await expect(
			broadcastPepEvent(
				{ PEP_EVENTS_DO: throwingNamespace } as Bindings,
				"throws",
				"pep_results",
				{},
			),
		).resolves.toEqual({ ok: false, sent: 0 });

		const successNamespace = {
			idFromName: vi.fn(() => "id"),
			get: vi.fn(() => ({
				fetch: vi.fn(
					async () =>
						new Response(JSON.stringify({ sent: 3 }), {
							headers: { "content-type": "application/json" },
						}),
				),
			})),
		} as unknown as DurableObjectNamespace;
		await expect(
			broadcastPepEvent(
				{ PEP_EVENTS_DO: successNamespace } as Bindings,
				"ok",
				"pep_results",
				{ result: true },
			),
		).resolves.toEqual({ ok: true, sent: 3 });
	});
});
