import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ConfigEndpoint } from "../../src/endpoints/watchlist/config";
import type { AppContext } from "../../src/types";

describe("GET /config", () => {
	it("should return 200 with feature flags (default env)", async () => {
		const res = await SELF.fetch("http://local.test/config");
		const body = await res.json<{
			success: boolean;
			result: {
				features: {
					pepSearch: boolean;
					pepGrok: boolean;
					adverseMedia: boolean;
				};
			};
		}>();

		expect(res.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.result.features).toBeDefined();
		expect(body.result.features.pepSearch).toBe(true);
		expect(body.result.features.pepGrok).toBe(true);
		expect(body.result.features.adverseMedia).toBe(true);
	});
});

describe("ConfigEndpoint.handle()", () => {
	it("should return pepSearch false when PEP_SEARCH_ENABLED is false", async () => {
		const endpoint = new (ConfigEndpoint as any)();
		const mockContext = {
			env: { PEP_SEARCH_ENABLED: "false" },
		} as unknown as AppContext;

		const result = await endpoint.handle(mockContext);
		expect(result.success).toBe(true);
		expect(result.result.features.pepSearch).toBe(false);
		expect(result.result.features.pepGrok).toBe(true);
		expect(result.result.features.adverseMedia).toBe(true);
	});

	it("should return pepGrok false when PEP_GROK_ENABLED is false", async () => {
		const endpoint = new (ConfigEndpoint as any)();
		const mockContext = {
			env: { PEP_GROK_ENABLED: "false" },
		} as unknown as AppContext;

		const result = await endpoint.handle(mockContext);
		expect(result.result.features.pepSearch).toBe(true);
		expect(result.result.features.pepGrok).toBe(false);
		expect(result.result.features.adverseMedia).toBe(true);
	});

	it("should return adverseMedia false when ADVERSE_MEDIA_ENABLED is false", async () => {
		const endpoint = new (ConfigEndpoint as any)();
		const mockContext = {
			env: { ADVERSE_MEDIA_ENABLED: "false" },
		} as unknown as AppContext;

		const result = await endpoint.handle(mockContext);
		expect(result.result.features.pepSearch).toBe(true);
		expect(result.result.features.pepGrok).toBe(true);
		expect(result.result.features.adverseMedia).toBe(false);
	});
});
