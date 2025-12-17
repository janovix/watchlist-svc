import { describe, expect, it } from "vitest";
import worker from "../../src/index";

describe("Worker module exports", () => {
	it("exposes fetch and queue handlers", () => {
		expect(worker).toBeDefined();
		expect(worker).toHaveProperty("fetch");
		expect(typeof (worker as unknown as { fetch: unknown }).fetch).toBe(
			"function",
		);

		expect(worker).toHaveProperty("queue");
		expect(typeof (worker as unknown as { queue: unknown }).queue).toBe(
			"function",
		);
	});
});
