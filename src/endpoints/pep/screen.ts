import { OpenAPIRoute, ApiException, contentJson } from "chanfana";
import { z } from "zod";
import { AppContext } from "../../types";
import { PepScreeningService } from "../../services/pepScreeningService";

const pepScreeningRequestSchema = z.object({
	full_name: z.string().min(3, "full_name must be at least 3 characters"),
	birth_date: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "birth_date must be in YYYY-MM-DD format")
		.nullable()
		.optional()
		.transform((val) => val || null),
});

const pepBasisSchema = z.object({
	rule_code: z.string(),
	description: z.string(),
});

const positionSchema = z.object({
	title: z.string(),
	organization: z.string(),
	jurisdiction: z.string(),
	start_date: z.string().nullable(),
	end_date: z.string().nullable(),
});

const negativeInfoSchema = z.object({
	summary: z.string(),
	evidence: z.array(z.string()),
});

const matchSchema = z.object({
	candidate_name: z.string(),
	candidate_birth_date: z.string().nullable(),
	why_match: z.string(),
	pep_basis: z.array(pepBasisSchema),
	positions: z.array(positionSchema),
	negative_info: z.array(negativeInfoSchema),
	evidence: z.array(z.string()),
});

const pepScreeningResponseSchema = z.object({
	request_id: z.string(),
	provider: z.literal("xai"),
	model: z.string(),
	query: z.object({
		full_name: z.string(),
		birth_date: z.string().nullable(),
	}),
	is_pep: z.boolean(),
	confidence: z.number().min(0).max(1),
	needs_disambiguation: z.boolean(),
	matches: z.array(matchSchema),
	search_audit: z.object({
		sources_consulted: z.array(z.string()),
	}),
	raw: z.record(z.unknown()),
});

export class PepScreenEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["PEP"],
		summary: "Screen a person for PEP (Politically Exposed Person) status",
		description:
			"Performs exhaustive PEP screening using Grok 4.1 with web/X search. Follows Lista PEPS 2020 official rules.",
		operationId: "screenPEP",
		request: {
			body: contentJson(pepScreeningRequestSchema),
		},
		responses: {
			"200": {
				description: "PEP screening result",
				...contentJson(pepScreeningResponseSchema),
			},
			"400": {
				description: "Bad request - invalid input",
				...contentJson({
					success: z.literal(false),
					errors: z.array(
						z.object({
							code: z.number(),
							message: z.string(),
						}),
					),
				}),
			},
			"502": {
				description: "Bad gateway - provider error or invalid response",
				...contentJson({
					success: z.literal(false),
					errors: z.array(
						z.object({
							code: z.number(),
							message: z.string(),
						}),
					),
				}),
			},
			"503": {
				description: "Service unavailable - XAI API not configured",
				...contentJson({
					success: z.literal(false),
					errors: z.array(
						z.object({
							code: z.number(),
							message: z.string(),
						}),
					),
				}),
			},
		},
	};

	public async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();

		console.log("[PepScreen] Starting PEP screening request", {
			fullName: data.body.full_name,
			hasBirthDate: !!data.body.birth_date,
		});

		// Validate environment variables
		if (!c.env.XAI_API_KEY) {
			console.error("[PepScreen] XAI_API_KEY not configured");
			const error = new ApiException(
				"XAI API key not configured. Please ensure XAI_API_KEY is set in your environment.",
			);
			error.status = 503;
			error.code = 503;
			throw error;
		}

		if (!c.env.DB) {
			console.error("[PepScreen] DB not configured");
			const error = new ApiException(
				"Database not configured. Please ensure DB binding is set.",
			);
			error.status = 503;
			error.code = 503;
			throw error;
		}

		try {
			// Create screening service
			const screeningService = new PepScreeningService({
				xaiApiKey: c.env.XAI_API_KEY,
				xaiBaseUrl: c.env.XAI_BASE_URL,
				xaiModel: c.env.XAI_MODEL,
				xaiMaxTurns: c.env.XAI_MAX_TURNS
					? parseInt(c.env.XAI_MAX_TURNS, 10)
					: undefined,
				db: c.env.DB,
			});

			// Perform screening
			const result = await screeningService.screen(
				data.body.full_name,
				data.body.birth_date || null,
			);

			console.log("[PepScreen] Screening completed successfully", {
				requestId: result.response.request_id,
				screeningId: result.screeningId,
				isPep: result.response.is_pep,
				confidence: result.response.confidence,
			});

			return result.response;
		} catch (error) {
			console.error("[PepScreen] Error during screening", {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});

			// Re-throw ApiException as-is
			if (error instanceof ApiException) {
				throw error;
			}

			// For JSON parsing errors or provider errors, return 502
			if (
				error instanceof Error &&
				(error.message.includes("JSON") ||
					error.message.includes("parse") ||
					error.message.includes("XAI API"))
			) {
				const apiError = new ApiException(
					`Provider error: ${error.message}. The screening request has been logged for audit.`,
				);
				apiError.status = 502;
				apiError.code = 502;
				throw apiError;
			}

			// Wrap other errors as 500
			const apiError = new ApiException(
				error instanceof Error
					? error.message
					: "An unexpected error occurred during PEP screening",
			);
			apiError.status = 500;
			apiError.code = 500;
			throw apiError;
		}
	}
}

export class PepScreenReadEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["PEP"],
		summary: "Get a stored PEP screening result by ID",
		description:
			"Retrieves a previously stored PEP screening result from the audit log",
		operationId: "getPepScreen",
		request: {
			params: z.object({
				id: z.string().min(1, "id is required"),
			}),
		},
		responses: {
			"200": {
				description: "PEP screening result",
				...contentJson(pepScreeningResponseSchema),
			},
			"404": {
				description: "Screening not found",
				...contentJson({
					success: z.literal(false),
					errors: z.array(
						z.object({
							code: z.number(),
							message: z.string(),
						}),
					),
				}),
			},
		},
	};

	public async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();

		if (!c.env.DB) {
			const error = new ApiException("Database not configured");
			error.status = 503;
			error.code = 503;
			throw error;
		}

		const screeningService = new PepScreeningService({
			xaiApiKey: "", // Not needed for read
			db: c.env.DB,
		});

		const result = await screeningService.getScreening(data.params.id);

		if (!result) {
			const error = new ApiException("Screening not found");
			error.status = 404;
			error.code = 404;
			throw error;
		}

		return result;
	}
}
