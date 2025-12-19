import { describe, expect, it, vi, beforeEach } from "vitest";
import { XaiPepClient } from "../../src/services/xaiPepClient";
import { PepScreeningService } from "../../src/services/pepScreeningService";
import type { PepScreeningResponse } from "../../src/services/xaiPepClient";

// Mock fetch globally
global.fetch = vi.fn();

describe("XaiPepClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("screen", () => {
		it("should return PEP screening response when API call succeeds", async () => {
			const mockResponse: PepScreeningResponse = {
				request_id: "test-request-id",
				provider: "xai",
				model: "grok-4.1-fast-reasoning",
				query: {
					full_name: "Juan Pérez",
					birth_date: "1980-01-01",
				},
				is_pep: true,
				confidence: 0.95,
				needs_disambiguation: false,
				matches: [
					{
						candidate_name: "Juan Pérez",
						candidate_birth_date: "1980-01-01",
						why_match: "Exact name match",
						pep_basis: [
							{
								rule_code: "SECCION_I_FEDERAL_EXECUTIVE",
								description: "Secretario de Estado",
							},
						],
						positions: [
							{
								title: "Secretario de Estado",
								organization: "Secretaría de Hacienda",
								jurisdiction: "federal",
								start_date: "2020-01-01",
								end_date: null,
							},
						],
						negative_info: [],
						evidence: ["https://www.gob.mx/shcp"],
					},
				],
				search_audit: {
					sources_consulted: ["https://www.gob.mx/shcp"],
				},
				raw: {},
			};

			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					model: "grok-4.1-fast-reasoning",
					choices: [
						{
							message: {
								content: JSON.stringify(mockResponse),
							},
						},
					],
				}),
			});

			const client = new XaiPepClient({
				apiKey: "test-key",
			});
			const result = await client.screen("Juan Pérez", "1980-01-01");

			expect(result.response.is_pep).toBe(true);
			expect(result.response.confidence).toBe(0.95);
			expect(result.response.matches).toHaveLength(1);
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

		it("should retry on non-JSON response", async () => {
			const invalidResponse = "This is not JSON";
			const validResponse: PepScreeningResponse = {
				request_id: "test-request-id",
				provider: "xai",
				model: "grok-4.1-fast-reasoning",
				query: {
					full_name: "Test Person",
					birth_date: null,
				},
				is_pep: false,
				confidence: 0.1,
				needs_disambiguation: false,
				matches: [],
				search_audit: {
					sources_consulted: [],
				},
				raw: {},
			};

			// First call returns non-JSON
			(global.fetch as ReturnType<typeof vi.fn>)
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						choices: [
							{
								message: {
									content: invalidResponse,
								},
							},
						],
					}),
				})
				// Retry call returns valid JSON
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({
						model: "grok-4.1-fast-reasoning",
						choices: [
							{
								message: {
									content: JSON.stringify(validResponse),
								},
							},
						],
					}),
				});

			const client = new XaiPepClient({
				apiKey: "test-key",
			});
			const result = await client.screen("Test Person", null);

			expect(result.response.is_pep).toBe(false);
			expect(global.fetch).toHaveBeenCalledTimes(2); // Initial + retry
		});

		it("should handle API errors", async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
				text: async () => "Server error",
			});

			const client = new XaiPepClient({
				apiKey: "test-key",
			});

			await expect(client.screen("Test Person", null)).rejects.toThrow(
				"XAI API error",
			);
		});
	});
});

describe("PepScreeningService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should screen a person and store result in D1", async () => {
		const mockResponse: PepScreeningResponse = {
			request_id: "test-request-id",
			provider: "xai",
			model: "grok-4.1-fast-reasoning",
			query: {
				full_name: "Test Person",
				birth_date: null,
			},
			is_pep: false,
			confidence: 0.2,
			needs_disambiguation: false,
			matches: [],
			search_audit: {
				sources_consulted: [],
			},
			raw: {},
		};

		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				model: "grok-4.1-fast-reasoning",
				choices: [
					{
						message: {
							content: JSON.stringify(mockResponse),
						},
					},
				],
			}),
		});

		// Mock D1 database
		const mockDb = {
			prepare: vi.fn().mockReturnValue({
				bind: vi.fn().mockReturnThis(),
				run: vi.fn().mockResolvedValue({ success: true }),
			}),
		} as unknown as D1Database;

		const service = new PepScreeningService({
			xaiApiKey: "test-key",
			db: mockDb,
		});

		const result = await service.screen("Test Person", null);

		expect(result.response.is_pep).toBe(false);
		expect(result.screeningId).toBeDefined();
		expect(mockDb.prepare).toHaveBeenCalled();
	});
});
