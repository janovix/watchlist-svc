import { SELF, env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src";
import { uploadRoutes } from "../../src/routes/upload";

function envWithBucket(overrides: Partial<Bindings> = {}): Bindings {
	return {
		...(env as unknown as Bindings),
		WATCHLIST_UPLOADS_BUCKET: {
			put: vi.fn(async () => undefined),
			delete: vi.fn(async () => undefined),
		} as unknown as R2Bucket,
		...overrides,
	} as unknown as Bindings;
}

describe("Upload routes (R2)", () => {
	it("prepare → multipart upload → delete round-trip", async () => {
		const prepareRes = await SELF.fetch(
			"http://local.test/api/upload/sdn-xml/prepare",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contentType: "application/xml",
					contentLength: 32,
				}),
			},
		);
		expect(prepareRes.status).toBe(200);
		const prepareJson = (await prepareRes.json()) as {
			success: boolean;
			data: { key: string };
		};
		expect(prepareJson.success).toBe(true);
		const { key } = prepareJson.data;
		expect(key).toContain("/sdn-xml/");

		const form = new FormData();
		form.append(
			"file",
			new File(["<sdnExport></sdnExport>"], "test.xml", {
				type: "application/xml",
			}),
		);
		form.append("key", key);

		const uploadRes = await SELF.fetch("http://local.test/api/upload/sdn-xml", {
			method: "POST",
			body: form,
		});
		expect(uploadRes.status).toBe(200);

		const deleteRes = await SELF.fetch(
			`http://local.test/api/upload/sdn-xml/${encodeURIComponent(key)}`,
			{ method: "DELETE" },
		);
		expect(deleteRes.status).toBe(200);
	});

	it("rejects invalid prepare requests and reports missing bucket", async () => {
		const invalid = await SELF.fetch(
			"http://local.test/api/upload/sdn-xml/prepare",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contentType: "application/json",
					contentLength: 32,
				}),
			},
		);
		expect(invalid.status).toBe(400);
		await expect(invalid.json()).resolves.toMatchObject({
			success: false,
			error: "Invalid input",
		});

		const tooLargePrepare = await SELF.fetch(
			"http://local.test/api/upload/sdn-xml/prepare",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contentType: "application/xml",
					contentLength: 151 * 1024 * 1024,
				}),
			},
		);
		expect(tooLargePrepare.status).toBe(400);

		const missingBucket = await uploadRoutes.request(
			"http://localhost/sdn-xml/prepare",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contentType: "application/xml",
					contentLength: 32,
				}),
			},
			envWithBucket({ WATCHLIST_UPLOADS_BUCKET: undefined }),
		);
		expect(missingBucket.status).toBe(503);
	});

	it("validates multipart upload file presence, type, and missing bucket", async () => {
		const noFile = await SELF.fetch("http://local.test/api/upload/sdn-xml", {
			method: "POST",
			body: new FormData(),
		});
		expect(noFile.status).toBe(400);

		const invalidTypeForm = new FormData();
		invalidTypeForm.append(
			"file",
			new File(["{}"], "bad.json", { type: "application/json" }),
		);
		const invalidType = await SELF.fetch(
			"http://local.test/api/upload/sdn-xml",
			{
				method: "POST",
				body: invalidTypeForm,
			},
		);
		expect(invalidType.status).toBe(400);
		await expect(invalidType.json()).resolves.toMatchObject({
			success: false,
		});

		const missingBucketForm = new FormData();
		missingBucketForm.append(
			"file",
			new File(["<xml />"], "test.xml", { type: "application/xml" }),
		);
		const missingBucket = await uploadRoutes.request(
			"http://localhost/sdn-xml",
			{ method: "POST", body: missingBucketForm },
			envWithBucket({ WATCHLIST_UPLOADS_BUCKET: undefined }),
		);
		expect(missingBucket.status).toBe(503);
	});

	it("validates delete keys and missing bucket", async () => {
		const forbidden = await SELF.fetch(
			"http://local.test/api/upload/sdn-xml/bad%2Ffile.xml",
			{ method: "DELETE" },
		);
		expect(forbidden.status).toBe(403);

		const invalidKey = await uploadRoutes.request(
			"http://localhost/sdn-xml/test/sdn-xml/file.xml",
			{ method: "DELETE" },
			envWithBucket(),
		);
		expect(invalidKey.status).toBe(400);

		const missingBucket = await uploadRoutes.request(
			"http://localhost/sdn-xml/test/sdn-xml/file.xml",
			{ method: "DELETE" },
			envWithBucket({ WATCHLIST_UPLOADS_BUCKET: undefined }),
		);
		expect(missingBucket.status).toBe(503);
	});
});
