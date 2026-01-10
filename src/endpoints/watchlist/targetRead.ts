import { OpenAPIRoute, ApiException } from "chanfana";
import { AppContext } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import { createPrismaClient } from "../../lib/prisma";
import { watchlistTarget } from "./base";
import { transformWatchlistTarget } from "../../lib/transformers";

export class TargetReadEndpoint extends OpenAPIRoute {
	public schema = {
		tags: ["Targets"],
		summary: "Get a watchlist target by ID",
		operationId: "getTarget",
		request: {
			params: z.object({
				id: z.string(),
			}),
		},
		responses: {
			"200": {
				description: "Target found",
				...contentJson({
					success: Boolean,
					result: watchlistTarget,
				}),
			},
			"404": {
				description: "Target not found",
				...contentJson({
					success: Boolean,
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
		const prisma = createPrismaClient(c.env.DB);

		const target = await prisma.watchlistTarget.findUnique({
			where: { id: data.params.id },
		});

		if (!target) {
			const error = new ApiException("Target not found");
			error.status = 404;
			error.code = 404;
			throw error;
		}

		// Transform Prisma model to API response format
		return {
			success: true,
			result: transformWatchlistTarget(target),
		};
	}
}
