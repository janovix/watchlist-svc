import { XaiPepClient, type PepScreeningResponse } from "./xaiPepClient";
import { PepScreeningsRepo } from "../db/pepScreeningsRepo";

export interface PepScreeningServiceConfig {
	xaiApiKey: string;
	xaiBaseUrl?: string;
	xaiModel?: string;
	xaiMaxTurns?: number;
	db: D1Database;
}

export interface ScreeningResult {
	response: PepScreeningResponse;
	screeningId: string;
	latencyMs: number;
}

export class PepScreeningService {
	private xaiClient: XaiPepClient;
	private repo: PepScreeningsRepo;

	constructor(config: PepScreeningServiceConfig) {
		this.xaiClient = new XaiPepClient({
			apiKey: config.xaiApiKey,
			baseUrl: config.xaiBaseUrl,
			model: config.xaiModel,
			maxTurns: config.xaiMaxTurns,
		});
		this.repo = new PepScreeningsRepo(config.db);
	}

	/**
	 * Screen a person for PEP status
	 */
	async screen(
		fullName: string,
		birthDate: string | null,
	): Promise<ScreeningResult> {
		const startTime = Date.now();

		console.log("[PepScreeningService] Starting screening", {
			fullName,
			birthDate,
		});

		try {
			// Call XAI API
			const { response, raw } = await this.xaiClient.screen(
				fullName,
				birthDate,
			);

			const latencyMs = Date.now() - startTime;

			// Prepare result JSON (excluding raw if too large)
			const resultJson = JSON.stringify({
				...response,
				raw: undefined, // Exclude raw from result_json
			});

			// Prepare raw JSON (limit size to avoid D1 limits)
			const rawJsonStr = JSON.stringify(raw);
			const rawJson =
				rawJsonStr.length > 100000
					? rawJsonStr.substring(0, 100000) + '..." (truncated)'
					: rawJsonStr;

			// Store in D1 for audit
			const screeningId = await this.repo.insert({
				created_at: new Date().toISOString(),
				full_name: fullName,
				birth_date: birthDate,
				provider: "xai",
				model: response.model,
				is_pep: response.is_pep ? 1 : 0,
				confidence: response.confidence,
				needs_disambiguation: response.needs_disambiguation ? 1 : 0,
				result_json: resultJson,
				raw_json: rawJson,
				error: null,
				latency_ms: latencyMs,
			});

			console.log("[PepScreeningService] Screening completed", {
				screeningId,
				isPep: response.is_pep,
				confidence: response.confidence,
				latencyMs,
			});

			return {
				response,
				screeningId,
				latencyMs,
			};
		} catch (error) {
			const latencyMs = Date.now() - startTime;
			const errorMessage =
				error instanceof Error ? error.message : String(error);

			console.error("[PepScreeningService] Screening failed", {
				fullName,
				error: errorMessage,
				latencyMs,
			});

			// Store error in D1 for audit
			try {
				await this.repo.insert({
					created_at: new Date().toISOString(),
					full_name: fullName,
					birth_date: birthDate,
					provider: "xai",
					model: "unknown", // Model unknown on error
					is_pep: 0,
					confidence: 0.0,
					needs_disambiguation: 0,
					result_json: JSON.stringify({ error: errorMessage }),
					raw_json: null,
					error: errorMessage,
					latency_ms: latencyMs,
				});
			} catch (dbError) {
				console.error(
					"[PepScreeningService] Failed to store error in D1",
					dbError,
				);
			}

			throw error;
		}
	}

	/**
	 * Get a stored screening by ID
	 */
	async getScreening(id: string): Promise<PepScreeningResponse | null> {
		const record = await this.repo.findById(id);
		if (!record) {
			return null;
		}

		try {
			const result = JSON.parse(record.result_json) as PepScreeningResponse;
			// Restore raw if available
			if (record.raw_json) {
				try {
					result.raw = JSON.parse(record.raw_json);
				} catch {
					// Ignore parse errors for raw_json
				}
			}
			return result;
		} catch {
			return null;
		}
	}
}
