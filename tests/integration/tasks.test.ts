import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildTasksListCacheKey,
	buildTasksReadCacheKey,
	TASKS_CACHE_VERSION_KEY,
} from "../../src/endpoints/tasks/kvCache";

// Helper function to create a task and return its ID
async function createTask(taskData: any) {
	const response = await SELF.fetch(`http://local.test/tasks`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(taskData),
	});
	const body = await response.json<{
		success: boolean;
		result: { id: number };
	}>();
	return body.result.id;
}

async function waitFor(
	fn: () => Promise<boolean>,
	{ attempts, delayMs }: { attempts: number; delayMs: number },
): Promise<void> {
	for (let i = 0; i < attempts; i++) {
		if (await fn()) return;
		await new Promise((r) => setTimeout(r, delayMs));
	}
	throw new Error("Condition not met in time");
}

describe("Task API Integration Tests", () => {
	beforeEach(async () => {
		// This is a good place to clear any test data if your test runner doesn't do it automatically.
		// Since the prompt mentions rows are deleted after each test, we can rely on that.
		vi.clearAllMocks();
	});

	// Tests for GET /tasks
	describe("GET /tasks", () => {
		it("should get an empty list of tasks", async () => {
			const response = await SELF.fetch(`http://local.test/tasks`);
			const body = await response.json<{ success: boolean; result: any[] }>();

			expect(response.status).toBe(200);
			expect(body.success).toBe(true);
			expect(body.result).toEqual([]);
		});

		it("should get a list with one task", async () => {
			await createTask({
				name: "Test Task",
				slug: "test-task",
				description: "A task for testing",
				completed: false,
				due_date: "2025-01-01T00:00:00.000Z",
			});

			const response = await SELF.fetch(`http://local.test/tasks`);
			const body = await response.json<{ success: boolean; result: any[] }>();

			expect(response.status).toBe(200);
			expect(body.success).toBe(true);
			expect(body.result.length).toBe(1);
			expect(body.result[0]).toEqual(
				expect.objectContaining({
					name: "Test Task",
					slug: "test-task",
				}),
			);
		});
	});

	describe("KV cache integration", () => {
		it("caches GET /tasks responses in KV", async () => {
			await env.TASKS_KV.delete(TASKS_CACHE_VERSION_KEY);

			const res1 = await SELF.fetch("http://local.test/tasks");
			expect(res1.status).toBe(200);

			const version = await env.TASKS_KV.get(TASKS_CACHE_VERSION_KEY);
			expect(version).toBeTruthy();

			const key = buildTasksListCacheKey(version!, "http://local.test/tasks");
			const cached = await env.TASKS_KV.get(key);
			expect(cached).toBeTruthy();

			// Second request should hit the KV cache branch.
			const res2 = await SELF.fetch("http://local.test/tasks");
			expect(res2.status).toBe(200);
		});

		it("caches GET /tasks/:id responses in KV", async () => {
			await env.TASKS_KV.delete(TASKS_CACHE_VERSION_KEY);

			const taskId = await createTask({
				name: "Cache Read Task",
				slug: "cache-read-task",
				description: "A task for read caching test",
				completed: false,
				due_date: "2025-01-01T00:00:00.000Z",
			});

			const res1 = await SELF.fetch(`http://local.test/tasks/${taskId}`);
			expect(res1.status).toBe(200);

			const version = await env.TASKS_KV.get(TASKS_CACHE_VERSION_KEY);
			expect(version).toBeTruthy();

			const key = buildTasksReadCacheKey(version!, taskId);
			const cached = await env.TASKS_KV.get(key);
			expect(cached).toBeTruthy();

			// Second request should hit the KV cache branch.
			const res2 = await SELF.fetch(`http://local.test/tasks/${taskId}`);
			expect(res2.status).toBe(200);
		});

		it("invalidates cache version on task writes", async () => {
			await env.TASKS_KV.delete(TASKS_CACHE_VERSION_KEY);

			await SELF.fetch("http://local.test/tasks");
			const v1 = await env.TASKS_KV.get(TASKS_CACHE_VERSION_KEY);
			expect(v1).toBeTruthy();

			await createTask({
				name: "Invalidate Cache Task",
				slug: "invalidate-cache-task",
				description: "A task that should invalidate cache",
				completed: false,
				due_date: "2025-01-01T00:00:00.000Z",
			});

			await waitFor(
				async () => {
					const v2 = await env.TASKS_KV.get(TASKS_CACHE_VERSION_KEY);
					return Boolean(v2) && v2 !== v1;
				},
				{ attempts: 30, delayMs: 10 },
			);
		});

		it("returns fresh data when KV get fails", async () => {
			try {
				const getSpy = vi
					.spyOn(env.TASKS_KV, "get")
					.mockImplementation((..._args: any[]) => {
						throw new Error("forced kv get failure");
					});

				const res = await SELF.fetch("http://local.test/tasks");
				const body = await res.json<{ success: boolean }>();
				expect(res.status).toBe(200);
				expect(body.success).toBe(true);
				getSpy.mockRestore();
			} finally {
				vi.restoreAllMocks();
			}
		});

		it("returns fresh data when KV put fails", async () => {
			try {
				const putSpy = vi
					.spyOn(env.TASKS_KV, "put")
					.mockImplementation((..._args: any[]) => {
						throw new Error("forced kv put failure");
					});

				const res = await SELF.fetch("http://local.test/tasks");
				const body = await res.json<{ success: boolean }>();
				expect(res.status).toBe(200);
				expect(body.success).toBe(true);
				putSpy.mockRestore();
			} finally {
				vi.restoreAllMocks();
			}
		});

		it("treats invalid cached payload as cache-miss", async () => {
			await env.TASKS_KV.delete(TASKS_CACHE_VERSION_KEY);

			// Ensure version exists.
			await SELF.fetch("http://local.test/tasks");
			const version = await env.TASKS_KV.get(TASKS_CACHE_VERSION_KEY);
			expect(version).toBeTruthy();

			const key = buildTasksListCacheKey(version!, "http://local.test/tasks");
			await env.TASKS_KV.put(key, JSON.stringify({ nope: true }));

			const res = await SELF.fetch("http://local.test/tasks");
			expect(res.status).toBe(200);
		});

		it("treats non-object cached payload as cache-miss", async () => {
			await env.TASKS_KV.delete(TASKS_CACHE_VERSION_KEY);
			await SELF.fetch("http://local.test/tasks");
			const version = await env.TASKS_KV.get(TASKS_CACHE_VERSION_KEY);
			expect(version).toBeTruthy();

			const key = buildTasksListCacheKey(version!, "http://local.test/tasks");
			await env.TASKS_KV.put(key, JSON.stringify("not-an-object"));

			const res = await SELF.fetch("http://local.test/tasks");
			expect(res.status).toBe(200);
		});

		it("treats cached payload with non-array result as cache-miss", async () => {
			await env.TASKS_KV.delete(TASKS_CACHE_VERSION_KEY);
			await SELF.fetch("http://local.test/tasks");
			const version = await env.TASKS_KV.get(TASKS_CACHE_VERSION_KEY);
			expect(version).toBeTruthy();

			const key = buildTasksListCacheKey(version!, "http://local.test/tasks");
			await env.TASKS_KV.put(
				key,
				JSON.stringify({ success: true, result: "nope" }),
			);

			const res = await SELF.fetch("http://local.test/tasks");
			expect(res.status).toBe(200);
		});

		it("returns fresh data when KV cache entry write fails (list)", async () => {
			await env.TASKS_KV.delete(TASKS_CACHE_VERSION_KEY);
			await SELF.fetch("http://local.test/tasks");

			const originalPut = env.TASKS_KV.put.bind(env.TASKS_KV);
			const putSpy = vi.spyOn(env.TASKS_KV, "put").mockImplementation(((
				...args: any[]
			) => {
				const [key] = args as [string, unknown, unknown?];
				if (typeof key === "string" && key.includes(":list:")) {
					throw new Error("forced cache entry put failure");
				}
				return originalPut(...(args as Parameters<KVNamespace["put"]>));
			}) as any);

			try {
				const res = await SELF.fetch("http://local.test/tasks");
				const body = await res.json<{ success: boolean }>();
				expect(res.status).toBe(200);
				expect(body.success).toBe(true);
			} finally {
				putSpy.mockRestore();
			}
		});
	});

	// Tests for POST /tasks
	describe("POST /tasks", () => {
		it("should create a new task successfully", async () => {
			const taskData = {
				name: "New Task",
				slug: "new-task",
				description: "A brand new task",
				completed: false,
				due_date: "2025-12-31T23:59:59.000Z",
			};
			const response = await SELF.fetch(`http://local.test/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(taskData),
			});

			const body = await response.json<{ success: boolean; result: any }>();

			expect(response.status).toBe(201);
			expect(body.success).toBe(true);
			expect(body.result).toEqual(
				expect.objectContaining({
					id: expect.any(Number),
					...taskData,
				}),
			);
		});

		it("should return a 400 error for invalid input", async () => {
			const invalidTaskData = {
				// Missing required fields 'name', 'slug', etc.
				description: "This is an invalid task",
			};
			const response = await SELF.fetch(`http://local.test/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(invalidTaskData),
			});
			const body = await response.json<{
				success: boolean;
				errors: unknown[];
			}>();

			expect(response.status).toBe(400);
			expect(body.success).toBe(false);
			expect(body.errors).toBeInstanceOf(Array);
		});

		it("still returns success if cache invalidation fails", async () => {
			try {
				const originalPut = env.TASKS_KV.put.bind(env.TASKS_KV);
				const putSpy = vi.spyOn(env.TASKS_KV, "put").mockImplementation(((
					...args: any[]
				) => {
					const [key] = args as [string, unknown, unknown?];
					if (key === TASKS_CACHE_VERSION_KEY) {
						throw new Error("forced invalidate failure");
					}
					return originalPut(...(args as Parameters<KVNamespace["put"]>));
				}) as any);

				const response = await SELF.fetch(`http://local.test/tasks`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						name: "KV Failure Create Task",
						slug: "kv-failure-create-task",
						description: "Create should succeed even if KV fails",
						completed: false,
						due_date: "2025-12-31T23:59:59.000Z",
					}),
				});
				expect(response.status).toBe(201);
				putSpy.mockRestore();
			} finally {
				vi.restoreAllMocks();
			}
		});
	});

	// Tests for GET /tasks/{id}
	describe("GET /tasks/{id}", () => {
		it("should get a single task by its ID", async () => {
			const taskData = {
				name: "Specific Task",
				slug: "specific-task",
				description: "A task to be fetched by ID",
				completed: false,
				due_date: "2025-06-01T12:00:00.000Z",
			};
			const taskId = await createTask(taskData);

			const response = await SELF.fetch(`http://local.test/tasks/${taskId}`);
			const body = await response.json<{ success: boolean; result: any }>();

			expect(response.status).toBe(200);
			expect(body.success).toBe(true);
			expect(body.result).toEqual(
				expect.objectContaining({
					id: taskId,
					...taskData,
				}),
			);
		});

		it("treats invalid cached read payload as cache-miss", async () => {
			await env.TASKS_KV.delete(TASKS_CACHE_VERSION_KEY);

			const taskId = await createTask({
				name: "Invalid Cache Read Task",
				slug: "invalid-cache-read-task",
				description: "For invalid read cache test",
				completed: false,
				due_date: "2025-06-01T12:00:00.000Z",
			});

			await SELF.fetch(`http://local.test/tasks/${taskId}`);
			const version = await env.TASKS_KV.get(TASKS_CACHE_VERSION_KEY);
			expect(version).toBeTruthy();

			const key = buildTasksReadCacheKey(version!, taskId);
			await env.TASKS_KV.put(key, JSON.stringify("bad"));

			const res = await SELF.fetch(`http://local.test/tasks/${taskId}`);
			expect(res.status).toBe(200);
		});

		it("treats cached read payload missing success as cache-miss", async () => {
			await env.TASKS_KV.delete(TASKS_CACHE_VERSION_KEY);

			const taskId = await createTask({
				name: "Invalid Cache Read Task 2",
				slug: "invalid-cache-read-task-2",
				description: "For invalid read cache test",
				completed: false,
				due_date: "2025-06-01T12:00:00.000Z",
			});

			await SELF.fetch(`http://local.test/tasks/${taskId}`);
			const version = await env.TASKS_KV.get(TASKS_CACHE_VERSION_KEY);
			expect(version).toBeTruthy();

			const key = buildTasksReadCacheKey(version!, taskId);
			await env.TASKS_KV.put(key, JSON.stringify({ result: { id: taskId } }));

			const res = await SELF.fetch(`http://local.test/tasks/${taskId}`);
			expect(res.status).toBe(200);
		});

		it("treats cached read payload missing result as cache-miss", async () => {
			await env.TASKS_KV.delete(TASKS_CACHE_VERSION_KEY);

			const taskId = await createTask({
				name: "Invalid Cache Read Task 3",
				slug: "invalid-cache-read-task-3",
				description: "For invalid read cache test",
				completed: false,
				due_date: "2025-06-01T12:00:00.000Z",
			});

			await SELF.fetch(`http://local.test/tasks/${taskId}`);
			const version = await env.TASKS_KV.get(TASKS_CACHE_VERSION_KEY);
			expect(version).toBeTruthy();

			const key = buildTasksReadCacheKey(version!, taskId);
			await env.TASKS_KV.put(key, JSON.stringify({ success: true }));

			const res = await SELF.fetch(`http://local.test/tasks/${taskId}`);
			expect(res.status).toBe(200);
		});

		it("returns fresh data when KV cache entry write fails (read)", async () => {
			await env.TASKS_KV.delete(TASKS_CACHE_VERSION_KEY);

			const taskId = await createTask({
				name: "Write Fail Read Task",
				slug: "write-fail-read-task",
				description: "For write-fail read cache test",
				completed: false,
				due_date: "2025-06-01T12:00:00.000Z",
			});

			// Ensure version exists.
			await SELF.fetch(`http://local.test/tasks/${taskId}`);

			const originalPut = env.TASKS_KV.put.bind(env.TASKS_KV);
			const putSpy = vi.spyOn(env.TASKS_KV, "put").mockImplementation(((
				...args: any[]
			) => {
				const [key] = args as [string, unknown, unknown?];
				if (typeof key === "string" && key.includes(":read:")) {
					throw new Error("forced cache entry put failure");
				}
				return originalPut(...(args as Parameters<KVNamespace["put"]>));
			}) as any);

			try {
				const res = await SELF.fetch(`http://local.test/tasks/${taskId}`);
				expect(res.status).toBe(200);
			} finally {
				putSpy.mockRestore();
			}
		});

		it("should return a 404 error if task is not found", async () => {
			const nonExistentId = 9999;
			const response = await SELF.fetch(
				`http://local.test/tasks/${nonExistentId}`,
			);
			const body = await response.json<{
				success: boolean;
				errors: Array<{ message: string }>;
			}>();

			expect(response.status).toBe(404);
			expect(body.success).toBe(false);
			expect(body.errors[0].message).toBe("Not Found");
		});
	});

	// Tests for PUT /tasks/{id}
	describe("PUT /tasks/{id}", () => {
		it("should update a task successfully", async () => {
			const taskData = {
				name: "Task to Update",
				slug: "task-to-update",
				description: "This task will be updated",
				completed: false,
				due_date: "2025-07-01T00:00:00.000Z",
			};
			const taskId = await createTask(taskData);

			const updatedData = {
				name: "Updated Task",
				slug: "updated-task",
				description: "This task has been updated",
				completed: true,
				due_date: "2025-07-15T10:00:00.000Z",
			};

			const response = await SELF.fetch(`http://local.test/tasks/${taskId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(updatedData),
			});
			const body = await response.json<{ success: boolean; result: any }>();

			expect(response.status).toBe(200);
			expect(body.success).toBe(true);
			expect(body.result).toEqual(
				expect.objectContaining({
					id: taskId,
					...updatedData,
				}),
			);
		});

		it("still returns success if cache invalidation fails", async () => {
			const taskId = await createTask({
				name: "KV Failure Update Task",
				slug: "kv-failure-update-task",
				description: "Update should succeed even if KV fails",
				completed: false,
				due_date: "2025-07-01T00:00:00.000Z",
			});

			try {
				const originalPut = env.TASKS_KV.put.bind(env.TASKS_KV);
				const putSpy = vi.spyOn(env.TASKS_KV, "put").mockImplementation(((
					...args: any[]
				) => {
					const [key] = args as [string, unknown, unknown?];
					if (key === TASKS_CACHE_VERSION_KEY) {
						throw new Error("forced invalidate failure");
					}
					return originalPut(...(args as Parameters<KVNamespace["put"]>));
				}) as any);

				const response = await SELF.fetch(`http://local.test/tasks/${taskId}`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						name: "KV Failure Update Task (updated)",
						slug: "kv-failure-update-task-updated",
						description: "Updated with KV failure",
						completed: true,
						due_date: "2025-07-15T10:00:00.000Z",
					}),
				});
				expect(response.status).toBe(200);
				putSpy.mockRestore();
			} finally {
				vi.restoreAllMocks();
			}
		});

		it("should return 404 when trying to update a non-existent task", async () => {
			const nonExistentId = 9999;
			const updatedData = {
				name: "Updated Task",
				slug: "updated-task",
				description: "This task has been updated",
				completed: true,
				due_date: "2025-07-15T10:00:00.000Z",
			};
			const response = await SELF.fetch(
				`http://local.test/tasks/${nonExistentId}`,
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(updatedData),
				},
			);

			expect(response.status).toBe(404);
		});

		it("should return 400 for invalid update data", async () => {
			const taskId = await createTask({
				name: "Task",
				slug: "task",
				description: "...",
				completed: false,
				due_date: "2025-01-01T00:00:00.000Z",
			});
			const invalidUpdateData = { name: "" }; // Invalid name
			const response = await SELF.fetch(`http://local.test/tasks/${taskId}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(invalidUpdateData),
			});

			expect(response.status).toBe(400);
		});
	});

	// Tests for DELETE /tasks/{id}
	describe("DELETE /tasks/{id}", () => {
		it("should delete a task successfully", async () => {
			const taskData = {
				name: "Task to Delete",
				slug: "task-to-delete",
				description: "This task will be deleted",
				completed: false,
				due_date: "2025-08-01T00:00:00.000Z",
			};
			const taskId = await createTask(taskData);

			const deleteResponse = await SELF.fetch(
				`http://local.test/tasks/${taskId}`,
				{
					method: "DELETE",
				},
			);
			const deleteBody = await deleteResponse.json<{
				success: boolean;
				result: any;
			}>();

			expect(deleteResponse.status).toBe(200);
			expect(deleteBody.success).toBe(true);
			expect(deleteBody.result.id).toBe(taskId);

			// Verify the task is actually deleted
			const getResponse = await SELF.fetch(`http://local.test/tasks/${taskId}`);
			expect(getResponse.status).toBe(404);
		});

		it("should return 404 when trying to delete a non-existent task", async () => {
			const nonExistentId = 9999;
			const response = await SELF.fetch(
				`http://local.test/tasks/${nonExistentId}`,
				{
					method: "DELETE",
				},
			);
			const body = await response.json<{
				success: boolean;
				errors: Array<{ message: string }>;
			}>();

			expect(response.status).toBe(404);
			expect(body.success).toBe(false);
			expect(body.errors[0].message).toBe("Not Found");
		});

		it("still returns success if cache invalidation fails", async () => {
			const taskId = await createTask({
				name: "KV Failure Delete Task",
				slug: "kv-failure-delete-task",
				description: "Delete should succeed even if KV fails",
				completed: false,
				due_date: "2025-08-01T00:00:00.000Z",
			});

			try {
				const originalPut = env.TASKS_KV.put.bind(env.TASKS_KV);
				const putSpy = vi.spyOn(env.TASKS_KV, "put").mockImplementation(((
					...args: any[]
				) => {
					const [key] = args as [string, unknown, unknown?];
					if (key === TASKS_CACHE_VERSION_KEY) {
						throw new Error("forced invalidate failure");
					}
					return originalPut(...(args as Parameters<KVNamespace["put"]>));
				}) as any);

				const response = await SELF.fetch(`http://local.test/tasks/${taskId}`, {
					method: "DELETE",
				});
				expect(response.status).toBe(200);
				putSpy.mockRestore();
			} finally {
				vi.restoreAllMocks();
			}
		});
	});
});
