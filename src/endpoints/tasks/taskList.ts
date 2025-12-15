import { D1ListEndpoint } from "chanfana";
import { HandleArgs } from "../../types";
import { TaskModel } from "./base";
import {
	buildTasksListCacheKey,
	getTasksCacheTtlSeconds,
	getTasksCacheVersion,
	kvGetJson,
	kvPutJson,
} from "./kvCache";
import { logError } from "./logging";

type BaseHandleReturn = Awaited<
	ReturnType<D1ListEndpoint<HandleArgs>["handle"]>
>;

export class TaskList extends D1ListEndpoint<HandleArgs> {
	_meta = {
		model: TaskModel,
	};

	searchFields = ["name", "slug", "description"];
	defaultOrderBy = "id DESC";

	public override async handle(...args: HandleArgs): Promise<BaseHandleReturn> {
		const [c] = args;
		const kv = c.env.TASKS_KV;

		let version: string | null = null;
		let cacheKey: string | null = null;
		try {
			version = await getTasksCacheVersion(kv);
			cacheKey = buildTasksListCacheKey(version, c.req.url);

			const cached = await kvGetJson<BaseHandleReturn>(kv, cacheKey, {
				validate: (value) => {
					if (!value || typeof value !== "object") {
						throw new Error("Invalid cached list payload");
					}
					const v = value as Record<string, unknown>;
					if (typeof v.success !== "boolean") {
						throw new Error("Invalid cached list payload: success");
					}
					if (!Array.isArray(v.result)) {
						throw new Error("Invalid cached list payload: result");
					}
					return value as BaseHandleReturn;
				},
			});
			if (cached !== null) return cached;
		} catch (error) {
			logError(
				c,
				"Tasks KV cache read failed (list). Returning fresh.",
				{ url: c.req.url, version, cacheKey },
				error,
			);
		}

		const fresh = await super.handle(...args);
		if (version !== null && cacheKey !== null) {
			try {
				await kvPutJson(kv, cacheKey, fresh, {
					expirationTtl: getTasksCacheTtlSeconds(c.env),
				});
			} catch (error) {
				logError(
					c,
					"Tasks KV cache write failed (list). Returning fresh.",
					{ url: c.req.url, version, cacheKey },
					error,
				);
			}
		}

		return fresh;
	}
}
