import { OpenAPIRoute, ApiException } from "chanfana";
import { AppContext } from "../../types";
import { contentJson } from "chanfana";
import { z } from "zod";
import { createPrismaClient } from "../../lib/prisma";
import { watchlistTarget } from "./base";
import { parseJsonField } from "./base";

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
			result: {
				id: target.id,
				schema: target.schema,
				name: target.name,
				aliases: parseJsonField<string[]>(target.aliases),
				birthDate: target.birthDate,
				countries: parseJsonField<string[]>(target.countries),
				addresses: parseJsonField<string[]>(target.addresses),
				identifiers: parseJsonField<string[]>(target.identifiers),
				sanctions: parseJsonField<string[]>(target.sanctions),
				phones: parseJsonField<string[]>(target.phones),
				emails: parseJsonField<string[]>(target.emails),
				programIds: parseJsonField<string[]>(target.programIds),
				dataset: target.dataset,
				firstSeen: target.firstSeen,
				lastSeen: target.lastSeen,
				lastChange: target.lastChange,
				createdAt: target.createdAt.toISOString(),
				updatedAt: target.updatedAt.toISOString(),
			},
		};
	}
}
