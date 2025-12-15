import { D1DeleteEndpoint } from "chanfana";
import { HandleArgs } from "../../types";
import { TaskModel } from "./base";
import { invalidateTasksCacheAfterWrite } from "./invalidation";

export class TaskDelete extends D1DeleteEndpoint<HandleArgs> {
	_meta = {
		model: TaskModel,
	};

	public override async handle(...args: HandleArgs) {
		const [c] = args;
		const res = await super.handle(...args);
		await invalidateTasksCacheAfterWrite(c, "tasks.delete");

		return res;
	}
}
