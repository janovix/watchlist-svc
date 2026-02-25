import { env, SELF } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";

/**
 * Internal Grok PEP Endpoint Tests
 *
 * Tests for the container callback endpoints used by pep_grok
 * to stream AI-powered PEP detection results back to watchlist-svc.
 */
describe("Internal Grok PEP Endpoints", () => {
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
	// POST /internal/grok-pep/results
	// =========================================================================
	describe("POST /internal/grok-pep/results", () => {
		it("should accept Grok PEP results and return success", async () => {
			const payload = {
				search_id: "test-query-uuid-123",
				query: "Juan Perez",
				probability: 0.85,
				summary: {
					es: "Alta probabilidad de ser PEP basado en fuentes públicas",
					en: "High probability of being PEP based on public sources",
				},
				sources: [
					"https://example.com/news1",
					"https://example.com/news2",
					"https://example.com/news3",
				],
			};

			const response = await SELF.fetch(
				"http://local.test/internal/grok-pep/results",
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

		it("should handle low probability results", async () => {
			const payload = {
				search_id: "test-low-prob",
				query: "Unknown Person",
				probability: 0.15,
				summary: {
					es: "Baja probabilidad de ser PEP",
					en: "Low probability of being PEP",
				},
				sources: [],
			};

			const response = await SELF.fetch(
				"http://local.test/internal/grok-pep/results",
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

		it("should handle empty sources array", async () => {
			const payload = {
				search_id: "test-no-sources",
				query: "Person With No Sources",
				probability: 0.5,
				summary: {
					es: "Probabilidad media",
					en: "Medium probability",
				},
				sources: [],
			};

			const response = await SELF.fetch(
				"http://local.test/internal/grok-pep/results",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				},
			);

			expect(response.status).toBe(200);
		});

		it("should handle many sources", async () => {
			const sources = Array.from(
				{ length: 20 },
				(_, i) => `https://example.com/source${i}`,
			);
			const payload = {
				search_id: "test-many-sources",
				query: "Well Known Person",
				probability: 0.95,
				summary: {
					es: "Muy alta probabilidad",
					en: "Very high probability",
				},
				sources,
			};

			const response = await SELF.fetch(
				"http://local.test/internal/grok-pep/results",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				},
			);

			expect(response.status).toBe(200);
		});

		it("should handle bilingual summaries with special characters", async () => {
			const payload = {
				search_id: "test-special-chars",
				query: "José García",
				probability: 0.75,
				summary: {
					es: "Probabilidad alta. Información encontrada en múltiples fuentes públicas: periódicos, sitios gubernamentales, etc.",
					en: "High probability. Information found in multiple public sources: newspapers, government sites, etc.",
				},
				sources: ["https://example.com/article1"],
			};

			const response = await SELF.fetch(
				"http://local.test/internal/grok-pep/results",
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
	// POST /internal/grok-pep/failed
	// =========================================================================
	describe("POST /internal/grok-pep/failed", () => {
		it("should accept failure notification", async () => {
			const payload = {
				search_id: "test-failed-uuid",
				error: "Grok API timeout after 3 retries",
			};

			const response = await SELF.fetch(
				"http://local.test/internal/grok-pep/failed",
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

		it("should handle API key errors", async () => {
			const payload = {
				search_id: "test-api-key-error",
				error: "Invalid API key: XAI_API_KEY not configured",
			};

			const response = await SELF.fetch(
				"http://local.test/internal/grok-pep/failed",
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
				error: "Failed to parse Grok response as JSON",
			};

			const response = await SELF.fetch(
				"http://local.test/internal/grok-pep/failed",
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
