import { D1ReadEndpoint } from "chanfana";
import { HandleArgs } from "../../types";
import { TaskModel } from "./base";
import {
	buildTasksReadCacheKey,
	getTasksCacheTtlSeconds,
	getTasksCacheVersion,
	kvGetJson,
	kvPutJson,
} from "./kvCache";
import { logError } from "./logging";

type BaseHandleReturn = Awaited<
	ReturnType<D1ReadEndpoint<HandleArgs>["handle"]>
>;

export class TaskRead extends D1ReadEndpoint<HandleArgs> {
	_meta = {
		model: TaskModel,
	};

	public override async handle(...args: HandleArgs): Promise<BaseHandleReturn> {
		const [c] = args;
		const kv = c.env.TASKS_KV;

		const id = c.req.param("id");
		let version: string | null = null;
		let cacheKey: string | null = null;
		try {
			version = await getTasksCacheVersion(kv);
			cacheKey = buildTasksReadCacheKey(version, id);

			const cached = await kvGetJson<BaseHandleReturn>(kv, cacheKey, {
				validate: (value) => {
					if (!value || typeof value !== "object") {
						throw new Error("Invalid cached read payload");
					}
					const v = value as Record<string, unknown>;
					if (typeof v.success !== "boolean") {
						throw new Error("Invalid cached read payload: success");
					}
					if (!("result" in v)) {
						throw new Error("Invalid cached read payload: result");
					}
					return value as BaseHandleReturn;
				},
			});
			if (cached !== null) return cached;
		} catch (error) {
			logError(
				c,
				"Tasks KV cache read failed (read). Returning fresh.",
				{ url: c.req.url, id, version, cacheKey },
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
					"Tasks KV cache write failed (read). Returning fresh.",
					{ url: c.req.url, id, version, cacheKey },
					error,
				);
			}
		}
		return fresh;
	}
}
