import type { AppContext } from "../../types";
import { invalidateTasksCache } from "./kvCache";
import { logError } from "./logging";

type ExecutionCtxLike = {
	waitUntil?: (promise: Promise<unknown>) => void;
};

export async function invalidateTasksCacheAfterWrite(
	c: AppContext,
	operation: string,
): Promise<void> {
	const p = invalidateTasksCache(c.env.TASKS_KV).catch((error) => {
		logError(
			c,
			"Failed to invalidate tasks cache after write",
			{ operation },
			error,
		);
	});

	const waitUntil = (c as unknown as { executionCtx?: ExecutionCtxLike })
		.executionCtx?.waitUntil;
	if (typeof waitUntil === "function") waitUntil(p);
	else await p;
}
