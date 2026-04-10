import { OpenAPIRoute } from "chanfana";
import { contentJson } from "chanfana";
import { z } from "zod";
import { WATCHLIST_FEATURE_FLAG_KEYS } from "../../lib/watchlist-feature-flags";
import type { FlagsSvcBinding } from "../../types/flags-rpc";
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

		let pepSearch = String(env.PEP_SEARCH_ENABLED ?? "") !== "false";
		let pepGrok = String(env.PEP_GROK_ENABLED ?? "") !== "false";
		let adverseMedia = String(env.ADVERSE_MEDIA_ENABLED ?? "") !== "false";

		const flagsBinding = env.FLAGS_SERVICE as unknown as
			| FlagsSvcBinding
			| undefined;
		if (flagsBinding) {
			try {
				const ctx = {
					environment: env.ENVIRONMENT ?? "production",
				};
				const keys = [
					WATCHLIST_FEATURE_FLAG_KEYS.pepSearch,
					WATCHLIST_FEATURE_FLAG_KEYS.pepGrok,
					WATCHLIST_FEATURE_FLAG_KEYS.adverseMedia,
				];
				const resolved = await flagsBinding.evaluateFlags(keys, ctx);
				const ps = resolved[WATCHLIST_FEATURE_FLAG_KEYS.pepSearch];
				const pg = resolved[WATCHLIST_FEATURE_FLAG_KEYS.pepGrok];
				const am = resolved[WATCHLIST_FEATURE_FLAG_KEYS.adverseMedia];
				if (typeof ps === "boolean") pepSearch = ps;
				if (typeof pg === "boolean") pepGrok = pg;
				if (typeof am === "boolean") adverseMedia = am;
			} catch (err) {
				console.warn(
					"[config] FLAGS_SERVICE evaluateFlags failed, using env defaults",
					err,
				);
			}
		}

		return {
			success: true,
			result: {
				features: {
					pepSearch,
					pepGrok,
					adverseMedia,
				},
			},
		};
	}
}
