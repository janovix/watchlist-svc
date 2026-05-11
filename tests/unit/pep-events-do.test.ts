import { describe, expect, it } from "vitest";
import { PepEventsDO } from "../../src/durable-objects/pep-events";

function makeDo(): PepEventsDO {
	return new PepEventsDO({} as DurableObjectState, {} as Env);
}

describe("PepEventsDO direct fetch handling", () => {
	it("returns 404 for unknown paths", async () => {
		const res = await makeDo().fetch(new Request("http://pep-events/missing"));
		expect(res.status).toBe(404);
	});

	it("broadcasts zero sent when no subscribers exist", async () => {
		const res = await makeDo().fetch(
			new Request("http://pep-events/broadcast", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ event: "pep_results", payload: { ok: true } }),
			}),
		);
		const body = (await res.json()) as {
			success: boolean;
			sent: number;
			failed: number;
			total_connections: number;
		};

		expect(res.status).toBe(200);
		expect(body).toMatchObject({
			success: true,
			sent: 0,
			failed: 0,
			total_connections: 0,
		});
	});

	it("returns 500 for malformed broadcast JSON", async () => {
		const res = await makeDo().fetch(
			new Request("http://pep-events/broadcast", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{",
			}),
		);

		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toMatchObject({ success: false });
	});
});
