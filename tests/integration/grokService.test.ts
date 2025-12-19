import { describe, expect, it, vi, beforeEach } from "vitest";
import { GrokService, type GrokPEPResponse } from "../../src/lib/grok-service";

// Mock fetch globally
global.fetch = vi.fn();

describe("GrokService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("queryPEPStatus", () => {
		it("should return PEP response when API call succeeds", async () => {
			const mockResponse: GrokPEPResponse = {
				name: "John Doe",
				aliases: ["Johnny", "JD"],
				birthDate: "1980-01-01",
				countries: ["US", "CA"],
				addresses: ["123 Main St"],
				identifiers: ["passport:123456"],
				sanctions: ["OFAC"],
				phones: ["+1234567890"],
				emails: ["john@example.com"],
				programIds: ["program1"],
				dataset: "test-dataset",
				pepStatus: true,
				pepDetails: "PEP status confirmed",
			};

			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [
						{
							message: {
								content: JSON.stringify(mockResponse),
							},
						},
					],
				}),
			});

			const service = new GrokService({ apiKey: "test-key" });
			const result = await service.queryPEPStatus("John Doe");

			expect(result).toEqual(mockResponse);
			expect(global.fetch).toHaveBeenCalledWith(
				"https://api.x.ai/v1/chat/completions",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						Authorization: "Bearer test-key",
					}),
				}),
			);
		});

		it("should return null when API call fails", async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 500,
				text: async () => "Internal Server Error",
			});

			const service = new GrokService({ apiKey: "test-key" });
			const result = await service.queryPEPStatus("John Doe");

			expect(result).toBeNull();
		});

		it("should return null when API returns no content", async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [{}],
				}),
			});

			const service = new GrokService({ apiKey: "test-key" });
			const result = await service.queryPEPStatus("John Doe");

			expect(result).toBeNull();
		});

		it("should return null when API returns empty choices", async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [],
				}),
			});

			const service = new GrokService({ apiKey: "test-key" });
			const result = await service.queryPEPStatus("John Doe");

			expect(result).toBeNull();
		});

		it("should handle PEP status false correctly", async () => {
			const mockResponse: GrokPEPResponse = {
				name: "Jane Smith",
				aliases: null,
				birthDate: null,
				countries: null,
				addresses: null,
				identifiers: null,
				sanctions: null,
				phones: null,
				emails: null,
				programIds: null,
				dataset: null,
				pepStatus: false,
			};

			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [
						{
							message: {
								content: JSON.stringify(mockResponse),
							},
						},
					],
				}),
			});

			const service = new GrokService({ apiKey: "test-key" });
			const result = await service.queryPEPStatus("Jane Smith");

			expect(result).toEqual(mockResponse);
			expect(result?.pepStatus).toBe(false);
		});

		it("should normalize array fields correctly", async () => {
			const mockResponse = {
				name: "Test Person",
				aliases: "not-an-array", // Invalid format
				countries: ["US"],
				pepStatus: true,
			};

			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [
						{
							message: {
								content: JSON.stringify(mockResponse),
							},
						},
					],
				}),
			});

			const service = new GrokService({ apiKey: "test-key" });
			const result = await service.queryPEPStatus("Test Person");

			expect(result).not.toBeNull();
			expect(result?.aliases).toBeNull(); // Should normalize invalid array
			expect(result?.countries).toEqual(["US"]);
		});

		it("should handle fetch errors gracefully", async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
				new Error("Network error"),
			);

			const service = new GrokService({ apiKey: "test-key" });
			const result = await service.queryPEPStatus("John Doe");

			expect(result).toBeNull();
		});

		it("should use custom baseUrl when provided", async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [
						{
							message: {
								content: JSON.stringify({
									name: "Test",
									pepStatus: true,
								}),
							},
						},
					],
				}),
			});

			const service = new GrokService({
				apiKey: "test-key",
				baseUrl: "https://custom-api.example.com/v1",
			});
			await service.queryPEPStatus("Test");

			expect(global.fetch).toHaveBeenCalledWith(
				"https://custom-api.example.com/v1/chat/completions",
				expect.any(Object),
			);
		});

		it("should include Mexico PEP list in the system prompt", async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [
						{
							message: {
								content: JSON.stringify({
									name: "Test",
									pepStatus: true,
								}),
							},
						},
					],
				}),
			});

			const service = new GrokService({ apiKey: "test-key" });
			await service.queryPEPStatus("Test Person");

			const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock
				.calls[0][1] as { body: string };
			const requestBody = JSON.parse(fetchCall.body);
			const systemPrompt = requestBody.messages[0].content;
			const listaPepsMessage = requestBody.messages[1].content;
			const queryMessage = requestBody.messages[2].content;

			// Verify we have 3 messages: system, lista PEPS document, and query
			expect(requestBody.messages).toHaveLength(3);
			expect(requestBody.messages[0].role).toBe("system");
			expect(requestBody.messages[1].role).toBe("user");
			expect(requestBody.messages[2].role).toBe("user");

			// Verify Mexico PEP information is included (Spanish official prompt)
			expect(systemPrompt).toContain(
				"verificador oficial de Personas Políticamente Expuestas",
			);
			expect(systemPrompt).toContain(
				"Lista de Personas Políticamente Expuestas Nacionales 2020",
			);
			expect(systemPrompt).toContain("SHCP");
			expect(systemPrompt).toContain("últimos 5 años");
			expect(systemPrompt).toContain("diciembre 2025");

			// Verify exhaustive search methodology is included
			expect(systemPrompt).toContain("BÚSQUEDA EXHAUSTIVA");
			expect(systemPrompt).toContain("NIVEL FEDERAL");
			expect(systemPrompt).toContain("NIVEL ESTATAL");
			expect(systemPrompt).toContain("NIVEL MUNICIPAL");
			expect(systemPrompt).toContain("FUENTES MÚLTIPLES");
			expect(systemPrompt).toContain("VARIACIONES DE NOMBRE");

			// Verify strict matching criteria are included
			expect(systemPrompt).toContain("CRITERIOS ESTRICTOS DE MATCHING");
			expect(systemPrompt).toContain("COINCIDENCIA DE NOMBRES");
			expect(systemPrompt).toContain("coincidencia parcial");

			// Verify Lista PEPS document is included in second message
			expect(listaPepsMessage).toContain(
				"Lista de Personas Políticamente Expuestas Nacionales 2020",
			);
			expect(listaPepsMessage).toContain("SHCP");
			expect(listaPepsMessage).toContain("LISTA DE PERSONAS");
			expect(listaPepsMessage).toContain("POLÍTICAMENTE EXPUESTAS");
			expect(listaPepsMessage).toContain("SECCIÓN I");
			expect(listaPepsMessage).toContain("SECCIÓN II");
			expect(listaPepsMessage).toContain("SECCIÓN III");
			expect(listaPepsMessage).toContain("SECCIÓN IV");

			// Verify query message includes exhaustive search instructions
			expect(queryMessage).toContain("BÚSQUEDA EXHAUSTIVA");
			expect(queryMessage).toContain("Test Person");
			expect(queryMessage).toContain("últimos 5 años");
			expect(queryMessage).toContain("diciembre 2025");
			expect(queryMessage).toContain("NIVEL FEDERAL");
			expect(queryMessage).toContain("NIVEL ESTATAL");
			expect(queryMessage).toContain("NIVEL MUNICIPAL");
			expect(queryMessage).toContain("VARIACIONES DE BÚSQUEDA");
			expect(queryMessage).toContain("coincidencia parcial");
		});
	});

	describe("convertToWatchlistTarget", () => {
		it("should convert Grok response to WatchlistTarget format", () => {
			const grokResponse: GrokPEPResponse = {
				name: "John Doe",
				aliases: ["Johnny"],
				birthDate: "1980-01-01",
				countries: ["US"],
				addresses: ["123 Main St"],
				identifiers: ["passport:123"],
				sanctions: ["OFAC"],
				phones: ["+1234567890"],
				emails: ["john@example.com"],
				programIds: ["program1"],
				dataset: "test-dataset",
				pepStatus: true,
				pepDetails: "PEP confirmed",
			};

			const service = new GrokService({ apiKey: "test-key" });
			const result = service.convertToWatchlistTarget(grokResponse, "John Doe");

			expect(result).toMatchObject({
				schema: "PEP",
				name: "John Doe",
				aliases: ["Johnny"],
				birthDate: "1980-01-01",
				countries: ["US"],
				addresses: ["123 Main St"],
				identifiers: ["passport:123"],
				sanctions: ["OFAC"],
				phones: ["+1234567890"],
				emails: ["john@example.com"],
				programIds: ["program1"],
				dataset: "test-dataset",
			});

			expect(result.id).toMatch(/^grok_/);
			expect(result.createdAt).toBeDefined();
			expect(result.updatedAt).toBeDefined();
			expect(result.firstSeen).toBeDefined();
			expect(result.lastSeen).toBeDefined();
			expect(result.lastChange).toBeDefined();
		});

		it("should use default dataset when not provided", () => {
			const grokResponse: GrokPEPResponse = {
				name: "Test Person",
				aliases: null,
				birthDate: null,
				countries: null,
				addresses: null,
				identifiers: null,
				sanctions: null,
				phones: null,
				emails: null,
				programIds: null,
				dataset: null,
				pepStatus: true,
			};

			const service = new GrokService({ apiKey: "test-key" });
			const result = service.convertToWatchlistTarget(
				grokResponse,
				"Test Person",
			);

			expect(result.dataset).toBe("grok-api");
		});

		it("should generate deterministic IDs from query", () => {
			const grokResponse: GrokPEPResponse = {
				name: "Test",
				aliases: null,
				birthDate: null,
				countries: null,
				addresses: null,
				identifiers: null,
				sanctions: null,
				phones: null,
				emails: null,
				programIds: null,
				dataset: null,
				pepStatus: true,
			};

			const service = new GrokService({ apiKey: "test-key" });
			const result1 = service.convertToWatchlistTarget(
				grokResponse,
				"Same Query",
			);
			const result2 = service.convertToWatchlistTarget(
				grokResponse,
				"Same Query",
			);

			expect(result1.id).toBe(result2.id);
		});
	});
});
