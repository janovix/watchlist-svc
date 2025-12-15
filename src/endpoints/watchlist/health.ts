import { OpenAPIRoute } from "chanfana";
import { AppContext } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";

export class HealthEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Health"],
		summary: "Health check endpoint",
		operationId: "health",
		responses: {
			"200": {
				description: "Service is healthy",
				...contentJson({
					success: Boolean,
					result: z.object({
						ok: z.boolean(),
						timestamp: z.string().datetime(),
					}),
				}),
			},
		},
	};

	public async handle(_c: AppContext) {
		return {
			success: true,
			result: {
				ok: true,
				timestamp: new Date().toISOString(),
			},
		};
	}
}
