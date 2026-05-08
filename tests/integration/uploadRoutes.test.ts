import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

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
});
