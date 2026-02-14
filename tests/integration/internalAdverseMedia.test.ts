import { env, SELF } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";

/**
 * Internal Adverse Media Endpoint Tests
 *
 * Tests for the container callback endpoints used by adverse_media_grok
 * to stream adverse media search results back to watchlist-svc.
 */
describe("Internal Adverse Media Endpoints", () => {
	beforeEach(async () => {
		// Clear KV cache if exists
		const pepCache = (env as { PEP_CACHE?: KVNamespace }).PEP_CACHE;
		if (pepCache) {
			try {
				const keys = await pepCache.list();
				for (const key of keys.keys) {
					await pepCache.delete(key.name);
				}
			} catch {
				// Ignore if KV not configured
			}
		}
	});

	// =========================================================================
	// POST /internal/adverse-media/results
	// =========================================================================
	describe("POST /internal/adverse-media/results", () => {
		it("should accept adverse media results for person entity", async () => {
			const payload = {
				search_id: "test-adverse-uuid-123",
				query: "Juan Perez",
				entity_type: "person" as const,
				risk_level: "medium" as const,
				findings: {
					es: "Se encontraron artículos relacionados con investigaciones fiscales",
					en: "Found articles related to tax investigations",
				},
				sources: ["https://example.com/news1", "https://example.com/news2"],
			};

			const response = await SELF.fetch(
				"http://local.test/internal/adverse-media/results",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				},
			);

			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				success: boolean;
				broadcast_sent: number;
			};
			expect(body.success).toBe(true);
			expect(typeof body.broadcast_sent).toBe("number");
		});

		it("should accept adverse media results for organization entity", async () => {
			const payload = {
				search_id: "test-org-adverse",
				query: "ACME Corporation",
				entity_type: "organization" as const,
				risk_level: "high" as const,
				findings: {
					es: "Múltiples sanciones regulatorias y demandas pendientes",
					en: "Multiple regulatory sanctions and pending lawsuits",
				},
				sources: [
					"https://example.com/regulatory",
					"https://example.com/lawsuit",
					"https://example.com/news",
				],
			};

			const response = await SELF.fetch(
				"http://local.test/internal/adverse-media/results",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				},
			);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { success: boolean };
			expect(body.success).toBe(true);
		});

		it("should handle no risk found", async () => {
			const payload = {
				search_id: "test-no-risk",
				query: "Clean Company",
				entity_type: "organization" as const,
				risk_level: "none" as const,
				findings: {
					es: "No se encontraron medios adversos",
					en: "No adverse media found",
				},
				sources: [],
			};

			const response = await SELF.fetch(
				"http://local.test/internal/adverse-media/results",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				},
			);

			expect(response.status).toBe(200);
		});

		it("should handle low risk level", async () => {
			const payload = {
				search_id: "test-low-risk",
				query: "Minor Issue Person",
				entity_type: "person" as const,
				risk_level: "low" as const,
				findings: {
					es: "Una mención menor en un artículo antiguo",
					en: "One minor mention in an old article",
				},
				sources: ["https://example.com/old-article"],
			};

			const response = await SELF.fetch(
				"http://local.test/internal/adverse-media/results",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				},
			);

			expect(response.status).toBe(200);
		});

		it("should handle high risk with many sources", async () => {
			const sources = Array.from(
				{ length: 15 },
				(_, i) => `https://example.com/source${i}`,
			);
			const payload = {
				search_id: "test-high-risk",
				query: "Problematic Entity",
				entity_type: "organization" as const,
				risk_level: "high" as const,
				findings: {
					es: "Extenso historial de violaciones regulatorias, demandas y escándalos",
					en: "Extensive history of regulatory violations, lawsuits and scandals",
				},
				sources,
			};

			const response = await SELF.fetch(
				"http://local.test/internal/adverse-media/results",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				},
			);

			expect(response.status).toBe(200);
		});

		it("should handle bilingual findings with special characters", async () => {
			const payload = {
				search_id: "test-special-chars",
				query: "Empresa José García S.A.",
				entity_type: "organization" as const,
				risk_level: "medium" as const,
				findings: {
					es: "Investigación en curso por posible evasión fiscal. Múltiples denuncias de empleados.",
					en: "Ongoing investigation for possible tax evasion. Multiple employee complaints.",
				},
				sources: ["https://example.com/investigation"],
			};

			const response = await SELF.fetch(
				"http://local.test/internal/adverse-media/results",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				},
			);

			expect(response.status).toBe(200);
		});
	});

	// =========================================================================
	// POST /internal/adverse-media/failed
	// =========================================================================
	describe("POST /internal/adverse-media/failed", () => {
		it("should accept failure notification", async () => {
			const payload = {
				search_id: "test-failed-uuid",
				error: "Grok API timeout after 3 retries",
			};

			const response = await SELF.fetch(
				"http://local.test/internal/adverse-media/failed",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				},
			);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { success: boolean };
			expect(body.success).toBe(true);
		});

		it("should handle API errors", async () => {
			const payload = {
				search_id: "test-api-error",
				error: "Grok API returned 429: Rate limit exceeded",
			};

			const response = await SELF.fetch(
				"http://local.test/internal/adverse-media/failed",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				},
			);

			expect(response.status).toBe(200);
		});

		it("should handle parsing errors", async () => {
			const payload = {
				search_id: "test-parse-error",
				error: "Failed to parse Grok response: Invalid JSON structure",
			};

			const response = await SELF.fetch(
				"http://local.test/internal/adverse-media/failed",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				},
			);

			expect(response.status).toBe(200);
		});
	});
});
