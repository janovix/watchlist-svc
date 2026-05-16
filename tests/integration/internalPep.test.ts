import { env, SELF } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";
import type { Bindings } from "../../src/index";
import { isGlobalCacheEnabled } from "../../src/lib/watchlist-cache";
import { clearPepCache, localSelfUrl } from "./_helpers";

/**
 * Internal PEP Endpoint Tests
 *
 * Tests for the container callback endpoints used by pep_search
 * to stream results back to watchlist-svc.
 *
 * These endpoints are internal (no auth) and called by the container
 * during the search flow:
 * 1. POST /internal/pep/results - receive search results
 * 2. POST /internal/pep/failed  - mark search as failed
 */
describe("Internal PEP Endpoints", () => {
	beforeEach(async () => {
		await clearPepCache(env);
	});

	// =========================================================================
	// POST /internal/pep/results
	// =========================================================================
	describe("POST /internal/pep/results", () => {
		it("should accept PEP search results and return success", async () => {
			const payload = {
				search_id: "pep_test123",
				query: "Juan Perez",
				total_results: 2,
				total_pages: 1,
				results_sent: 2,
				results: [
					{
						id: "test-id-1",
						nombre: "Juan Angel Torres Ramirez",
						entidadfederativa: "Jalisco",
						sujetoobligado: "Ayuntamiento Test",
						denominacion: "Especialista",
						areaadscripcion: "Direccion Test",
						periodoreporta: "01/02/2021 - 28/02/2021",
						informacionPrincipal: {
							nombre: "Juan Angel Torres Ramirez",
							institucion: "Ayuntamiento Test",
							cargo: "Especialista",
							area: "Direccion Test",
							telefono: "123456789",
							correo: "test@example.com",
							direccion: "Test Address 123",
							periodoinforma: "01/02/2021 - 28/02/2021",
						},
						complementoPrincipal: {
							nombre: "Juan Angel",
							primerApellido: "Torres",
							segundoApellido: "Ramirez",
							entidadFederativa: "Jalisco",
							sujetoObligado: "Ayuntamiento Test",
							ejercicio: 2021,
							fechaInicioPeriodo: "01/02/2021",
							fechaFinPeriodo: "28/02/2021",
							denominacionCargo: "Especialista",
							areaAdscripcion: "Direccion Test",
							anioFechaInicio: 2021,
						},
					},
					{
						id: "test-id-2",
						nombre: "Juan Carlos Perez Lopez",
						entidadfederativa: "CDMX",
						sujetoobligado: "Gobierno Test",
						denominacion: "Director",
						areaadscripcion: "Administracion",
						periodoreporta: "01/01/2021 - 31/01/2021",
					},
				],
			};

			const response = await SELF.fetch(localSelfUrl("/internal/pep/results"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				success: boolean;
				cached: boolean;
				broadcast_sent: number;
			};
			expect(body.success).toBe(true);
			expect(typeof body.cached).toBe("boolean");
			expect(typeof body.broadcast_sent).toBe("number");
		});

		it("should handle large result sets", async () => {
			// Generate 100 results
			const results = Array.from({ length: 100 }, (_, i) => ({
				id: `test-id-${i}`,
				nombre: `Test Person ${i}`,
				entidadfederativa: "Test State",
				sujetoobligado: "Test Entity",
			}));

			const payload = {
				search_id: "pep_large_test",
				query: "Test Query",
				total_results: 100,
				total_pages: 1,
				results_sent: 100,
				results,
			};

			const response = await SELF.fetch(localSelfUrl("/internal/pep/results"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			expect(response.status).toBe(200);
			const body = (await response.json()) as { success: boolean };
			expect(body.success).toBe(true);
		});

		it("should handle results with missing optional fields", async () => {
			const payload = {
				search_id: "pep_minimal",
				query: "Minimal Data",
				total_results: 1,
				total_pages: 1,
				results_sent: 1,
				results: [
					{
						id: "minimal-1",
						nombre: "Basic Name",
					},
				],
			};

			const response = await SELF.fetch(localSelfUrl("/internal/pep/results"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			expect(response.status).toBe(200);
			const body = (await response.json()) as { success: boolean };
			expect(body.success).toBe(true);
		});

		it("isGlobalCacheEnabled uses CACHE_ENABLED when FLAGS_SERVICE is absent", async () => {
			const merged = {
				...(env as unknown as Bindings),
				CACHE_ENABLED: "true",
			} as unknown as Bindings;
			delete (merged as { FLAGS_SERVICE?: Bindings["FLAGS_SERVICE"] })
				.FLAGS_SERVICE;

			await expect(isGlobalCacheEnabled(merged, {})).resolves.toBe(true);
		});

		it("isGlobalCacheEnabled returns false for CACHE_ENABLED=false when FLAGS_SERVICE is absent", async () => {
			const merged = {
				...(env as unknown as Bindings),
				CACHE_ENABLED: "false",
			} as unknown as Bindings;
			delete (merged as { FLAGS_SERVICE?: Bindings["FLAGS_SERVICE"] })
				.FLAGS_SERVICE;

			await expect(isGlobalCacheEnabled(merged, {})).resolves.toBe(false);
		});

		it("should accept empty results", async () => {
			const payload = {
				search_id: "pep_empty",
				query: "NonExistent Person",
				total_results: 0,
				total_pages: 0,
				results_sent: 0,
				results: [],
			};

			const response = await SELF.fetch(localSelfUrl("/internal/pep/results"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			expect(response.status).toBe(200);
			const body = (await response.json()) as { success: boolean };
			expect(body.success).toBe(true);
		});

		it("should handle results with all fields populated", async () => {
			const payload = {
				search_id: "pep_complete",
				query: "Complete Data",
				total_results: 1,
				total_pages: 1,
				results_sent: 1,
				results: [
					{
						id: "complete-1",
						nombre: "Juan Angel Torres Ramirez",
						entidadfederativa: "Jalisco",
						sujetoobligado: "Ayuntamiento Completo",
						denominacion: "Especialista AA",
						areaadscripcion: "Direccion de Contabilidad",
						periodoreporta: "01/02/2021 - 28/02/2021",
						informacionPrincipal: {
							nombre: "Juan Angel Torres Ramirez",
							institucion: "Ayuntamiento Completo",
							cargo: "Especialista AA",
							area: "Direccion de Contabilidad",
							telefono: "32834400 Ext.:0",
							correo: "test@example.com",
							direccion: "Calle Test 123",
							periodoinforma: "01/02/2021 - 28/02/2021",
						},
						complementoPrincipal: {
							nombre: "Juan Angel",
							primerApellido: "Torres",
							segundoApellido: "Ramirez",
							entidadFederativa: "Jalisco",
							sujetoObligado: "Ayuntamiento Completo",
							denominacionCargo: "Especialista AA",
							areaAdscripcion: "Direccion de Contabilidad",
							ejercicio: 2021,
							anioFechaInicio: 2021,
							fechaInicioPeriodo: "01/02/2021",
							fechaFinPeriodo: "28/02/2021",
						},
					},
				],
			};

			const response = await SELF.fetch(localSelfUrl("/internal/pep/results"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			expect(response.status).toBe(200);
			const body = (await response.json()) as { success: boolean };
			expect(body.success).toBe(true);
		});
	});

	// =========================================================================
	// POST /internal/pep/failed
	// =========================================================================
	describe("POST /internal/pep/failed", () => {
		it("should accept failure notification", async () => {
			const payload = {
				search_id: "pep_failed_test",
				error: "API timeout after 3 retries",
			};

			const response = await SELF.fetch(localSelfUrl("/internal/pep/failed"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			expect(response.status).toBe(200);
			const body = (await response.json()) as { success: boolean };
			expect(body.success).toBe(true);
		});

		it("should handle missing search_id gracefully", async () => {
			const payload = {
				error: "Some error",
			};

			const response = await SELF.fetch(localSelfUrl("/internal/pep/failed"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			// Should accept but log warning
			expect(response.status).toBeLessThanOrEqual(500);
		});

		it("should handle long error messages", async () => {
			const longError = "Error: ".repeat(200);
			const payload = {
				search_id: "pep_long_error",
				error: longError,
			};

			const response = await SELF.fetch(localSelfUrl("/internal/pep/failed"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			expect(response.status).toBe(200);
			const body = (await response.json()) as { success: boolean };
			expect(body.success).toBe(true);
		});

		it("should handle special characters in error message", async () => {
			const payload = {
				search_id: "pep_special_chars",
				error: "Error: <script>alert('xss')</script> & special chars: é, ñ, ü",
			};

			const response = await SELF.fetch(localSelfUrl("/internal/pep/failed"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			expect(response.status).toBe(200);
			const body = (await response.json()) as { success: boolean };
			expect(body.success).toBe(true);
		});
	});
});
