import { describe, expect, it, vi } from "vitest";
import { logError } from "../../src/endpoints/tasks/logging";

describe("Tasks logging helper", () => {
	it("uses request logger when present", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const errorSpy = vi.fn();

		const c = { logger: { error: errorSpy } } as any;
		logError(c, "msg", { a: 1 }, new Error("boom"));

		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy).not.toHaveBeenCalled();

		warnSpy.mockRestore();
	});
});
