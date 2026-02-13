import { describe, expect, it, vi } from "vitest";
import {
	getEnvironmentPrefix,
	generateSdnXmlKey,
	generateSat69bCsvKey,
	generateUnscXmlKey,
	getR2Endpoint,
	validateR2Config,
	generatePresignedDownloadUrl,
	generatePresignedUploadUrl,
	checkFileExistsInR2,
	type R2PresignedConfig,
} from "../../src/lib/r2-presigned";

/**
 * R2 Presigned URL Tests
 *
 * Tests for the R2 presigned URL generation utilities.
 * These tests verify the pure functions and URL generation logic.
 */
describe("R2 Presigned URL Utilities", () => {
	describe("getEnvironmentPrefix", () => {
		it("should return 'prod' for production environment", () => {
			expect(getEnvironmentPrefix("production")).toBe("prod");
		});

		it("should return 'preview' for preview environment", () => {
			expect(getEnvironmentPrefix("preview")).toBe("preview");
		});

		it("should return 'local' for local environment", () => {
			expect(getEnvironmentPrefix("local")).toBe("local");
		});

		it("should return 'test' for test environment", () => {
			expect(getEnvironmentPrefix("test")).toBe("test");
		});

		it("should return 'dev' for dev environment", () => {
			expect(getEnvironmentPrefix("dev")).toBe("dev");
		});

		it("should return 'dev' for undefined environment", () => {
			expect(getEnvironmentPrefix(undefined)).toBe("dev");
		});

		it("should return 'dev' for unknown environment", () => {
			expect(getEnvironmentPrefix("unknown")).toBe("dev");
		});
	});

	describe("generateSdnXmlKey", () => {
		it("should generate key with correct format for production", () => {
			const key = generateSdnXmlKey("production");
			expect(key).toMatch(/^prod\/sdn-xml\/\d+-[a-z0-9]+\.xml$/);
		});

		it("should generate key with correct format for dev", () => {
			const key = generateSdnXmlKey("dev");
			expect(key).toMatch(/^dev\/sdn-xml\/\d+-[a-z0-9]+\.xml$/);
		});

		it("should generate unique keys", () => {
			const key1 = generateSdnXmlKey("dev");
			const key2 = generateSdnXmlKey("dev");
			expect(key1).not.toBe(key2);
		});
	});

	describe("generateSat69bCsvKey", () => {
		it("should generate key with correct format for production", () => {
			const key = generateSat69bCsvKey("production");
			expect(key).toMatch(/^prod\/sat-69b\/\d+-[a-z0-9]+\.csv$/);
		});

		it("should generate key with correct format for dev", () => {
			const key = generateSat69bCsvKey("dev");
			expect(key).toMatch(/^dev\/sat-69b\/\d+-[a-z0-9]+\.csv$/);
		});

		it("should generate unique keys", () => {
			const key1 = generateSat69bCsvKey("dev");
			const key2 = generateSat69bCsvKey("dev");
			expect(key1).not.toBe(key2);
		});
	});

	describe("generateUnscXmlKey", () => {
		it("should generate key with correct format for production", () => {
			const key = generateUnscXmlKey("production");
			expect(key).toMatch(/^prod\/unsc-xml\/\d+-[a-z0-9]+\.xml$/);
		});

		it("should generate key with correct format for dev", () => {
			const key = generateUnscXmlKey("dev");
			expect(key).toMatch(/^dev\/unsc-xml\/\d+-[a-z0-9]+\.xml$/);
		});

		it("should generate unique keys", () => {
			const key1 = generateUnscXmlKey("dev");
			const key2 = generateUnscXmlKey("dev");
			expect(key1).not.toBe(key2);
		});
	});

	describe("getR2Endpoint", () => {
		it("should generate correct R2 endpoint URL", () => {
			const endpoint = getR2Endpoint("test-account-id");
			expect(endpoint).toBe("https://test-account-id.r2.cloudflarestorage.com");
		});
	});

	describe("validateR2Config", () => {
		it("should return config when all credentials are present", () => {
			const env = {
				R2_ACCESS_KEY_ID: "test-key-id",
				R2_SECRET_ACCESS_KEY: "test-secret",
				CLOUDFLARE_ACCOUNT_ID: "test-account",
				R2_BUCKET_NAME: "test-bucket",
			};

			const config = validateR2Config(env);

			expect(config).not.toBeNull();
			expect(config?.accountId).toBe("test-account");
			expect(config?.accessKeyId).toBe("test-key-id");
			expect(config?.secretAccessKey).toBe("test-secret");
			expect(config?.bucketName).toBe("test-bucket");
		});

		it("should return null when R2_ACCESS_KEY_ID is missing", () => {
			const env = {
				R2_SECRET_ACCESS_KEY: "test-secret",
				CLOUDFLARE_ACCOUNT_ID: "test-account",
				R2_BUCKET_NAME: "test-bucket",
			};

			expect(validateR2Config(env)).toBeNull();
		});

		it("should return null when R2_SECRET_ACCESS_KEY is missing", () => {
			const env = {
				R2_ACCESS_KEY_ID: "test-key-id",
				CLOUDFLARE_ACCOUNT_ID: "test-account",
				R2_BUCKET_NAME: "test-bucket",
			};

			expect(validateR2Config(env)).toBeNull();
		});

		it("should return null when CLOUDFLARE_ACCOUNT_ID is missing", () => {
			const env = {
				R2_ACCESS_KEY_ID: "test-key-id",
				R2_SECRET_ACCESS_KEY: "test-secret",
				R2_BUCKET_NAME: "test-bucket",
			};

			expect(validateR2Config(env)).toBeNull();
		});

		it("should return null when R2_BUCKET_NAME is missing", () => {
			const env = {
				R2_ACCESS_KEY_ID: "test-key-id",
				R2_SECRET_ACCESS_KEY: "test-secret",
				CLOUDFLARE_ACCOUNT_ID: "test-account",
			};

			expect(validateR2Config(env)).toBeNull();
		});
	});

	describe("generatePresignedDownloadUrl", () => {
		const testConfig: R2PresignedConfig = {
			accountId: "test-account-id",
			accessKeyId: "test-access-key",
			secretAccessKey: "test-secret-key",
			bucketName: "test-bucket",
		};

		it("should generate a valid presigned URL for download", async () => {
			const result = await generatePresignedDownloadUrl(
				testConfig,
				"test/file.xml",
				3600,
			);

			expect(result.key).toBe("test/file.xml");
			expect(result.url).toContain("test-account-id.r2.cloudflarestorage.com");
			expect(result.url).toContain("test-bucket");
			expect(result.url).toContain("test/file.xml");
			expect(result.url).toContain("X-Amz-Expires=3600");
			expect(result.url).toContain("X-Amz-Signature=");
			expect(result.expiresAt).toBeInstanceOf(Date);
		});

		it("should use default expiration of 2 hours (7200 seconds)", async () => {
			const result = await generatePresignedDownloadUrl(
				testConfig,
				"test/file.xml",
			);

			expect(result.url).toContain("X-Amz-Expires=7200");
		});

		it("should set correct expiration time", async () => {
			const beforeTime = Date.now();
			const result = await generatePresignedDownloadUrl(
				testConfig,
				"test/file.xml",
				3600,
			);
			const afterTime = Date.now();

			// Expiration should be approximately 1 hour from now
			const expectedMin = beforeTime + 3600 * 1000;
			const expectedMax = afterTime + 3600 * 1000;

			expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
			expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expectedMax);
		});
	});

	describe("generatePresignedUploadUrl", () => {
		const testConfig: R2PresignedConfig = {
			accountId: "test-account-id",
			accessKeyId: "test-access-key",
			secretAccessKey: "test-secret-key",
			bucketName: "test-bucket",
		};

		it("should generate a valid presigned URL for upload", async () => {
			const result = await generatePresignedUploadUrl(
				testConfig,
				"test/upload.xml",
				"application/xml",
				600,
			);

			expect(result.key).toBe("test/upload.xml");
			expect(result.url).toContain("test-account-id.r2.cloudflarestorage.com");
			expect(result.url).toContain("test-bucket");
			expect(result.url).toContain("test/upload.xml");
			expect(result.url).toContain("X-Amz-Expires=600");
			expect(result.url).toContain("X-Amz-Signature=");
			expect(result.expiresAt).toBeInstanceOf(Date);
		});

		it("should use default expiration of 10 minutes (600 seconds)", async () => {
			const result = await generatePresignedUploadUrl(
				testConfig,
				"test/upload.xml",
				"application/xml",
			);

			expect(result.url).toContain("X-Amz-Expires=600");
		});
	});

	describe("checkFileExistsInR2", () => {
		const testConfig: R2PresignedConfig = {
			accountId: "test-account-id",
			accessKeyId: "test-access-key",
			secretAccessKey: "test-secret-key",
			bucketName: "test-bucket",
		};

		it("should return exists true with size and etag when response is ok", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: true,
					headers: {
						get: (name: string) => {
							if (name === "content-length") return "1024";
							if (name === "etag") return '"abc123"';
							if (name === "last-modified")
								return "Mon, 10 Feb 2025 12:00:00 GMT";
							return null;
						},
					},
				}),
			);

			const result = await checkFileExistsInR2(testConfig, "test/file.xml");

			expect(result.exists).toBe(true);
			expect(result.size).toBe(1024);
			expect(result.etag).toBe('"abc123"');
			expect(result.lastModified).toEqual(
				new Date("Mon, 10 Feb 2025 12:00:00 GMT"),
			);

			vi.unstubAllGlobals();
		});

		it("should return exists false when response is not ok", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({ ok: false, headers: { get: () => null } }),
			);

			const result = await checkFileExistsInR2(testConfig, "test/missing.xml");

			expect(result.exists).toBe(false);

			vi.unstubAllGlobals();
		});

		it("should return exists false when fetch throws", async () => {
			vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network")));

			const result = await checkFileExistsInR2(testConfig, "test/file.xml");

			expect(result.exists).toBe(false);

			vi.unstubAllGlobals();
		});
	});
});
