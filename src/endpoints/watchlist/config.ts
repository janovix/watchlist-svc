import { OpenAPIRoute } from "chanfana";
import { contentJson } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../../types";

export class ConfigEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Config"],
		summary: "Service feature flags",
		operationId: "config",
		responses: {
			"200": {
				description: "Current feature flags",
				...contentJson({
					success: Boolean,
					result: z.object({
						features: z.object({
							pepSearch: z.boolean(),
							pepGrok: z.boolean(),
							adverseMedia: z.boolean(),
						}),
					}),
				}),
			},
		},
	};

	public async handle(c: AppContext) {
		const env = c.env;
		return {
			success: true,
			result: {
				features: {
					pepSearch: env.PEP_SEARCH_ENABLED !== "false",
					pepGrok: env.PEP_GROK_ENABLED !== "false",
					adverseMedia: env.ADVERSE_MEDIA_ENABLED !== "false",
				},
			},
		};
	}
}
