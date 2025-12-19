export interface PepScreeningRecord {
	id: string;
	created_at: string; // ISO 8601
	full_name: string;
	birth_date: string | null;
	provider: string;
	model: string;
	is_pep: number; // 0 or 1
	confidence: number; // 0.0 to 1.0
	needs_disambiguation: number; // 0 or 1
	result_json: string; // stringified response JSON
	raw_json: string | null; // stringified raw provider payload
	error: string | null;
	latency_ms: number;
}

export class PepScreeningsRepo {
	constructor(private db: D1Database) {}

	/**
	 * Insert a new PEP screening record
	 */
	async insert(record: Omit<PepScreeningRecord, "id">): Promise<string> {
		const id = this.generateId();
		const now = new Date().toISOString();

		await this.db
			.prepare(
				`INSERT INTO pep_screenings (
        id, created_at, full_name, birth_date, provider, model,
        is_pep, confidence, needs_disambiguation, result_json, raw_json, error, latency_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				id,
				now,
				record.full_name,
				record.birth_date,
				record.provider,
				record.model,
				record.is_pep,
				record.confidence,
				record.needs_disambiguation,
				record.result_json,
				record.raw_json,
				record.error,
				record.latency_ms,
			)
			.run();

		return id;
	}

	/**
	 * Find a screening by ID
	 */
	async findById(id: string): Promise<PepScreeningRecord | null> {
		const result = await this.db
			.prepare("SELECT * FROM pep_screenings WHERE id = ?")
			.bind(id)
			.first<PepScreeningRecord>();

		return result || null;
	}

	/**
	 * Generate a deterministic ID (UUID-like)
	 */
	private generateId(): string {
		const hex = "0123456789abcdef";
		let uuid = "";
		for (let i = 0; i < 36; i++) {
			if (i === 8 || i === 13 || i === 18 || i === 23) {
				uuid += "-";
			} else {
				uuid += hex[Math.floor(Math.random() * 16)];
			}
		}
		return uuid;
	}
}
