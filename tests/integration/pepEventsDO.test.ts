import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import eventsRouter from "../../src/endpoints/watchlist/events";

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
});
