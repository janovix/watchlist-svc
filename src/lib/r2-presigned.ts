/**
 * R2 Presigned URL generation using AWS4 signatures
 * R2 is S3-compatible, so we use the standard AWS signature v4 process
 */
import { AwsV4Signer } from "aws4fetch";

export interface R2PresignedConfig {
	accountId: string;
	accessKeyId: string;
	secretAccessKey: string;
	bucketName: string;
}

export interface PresignedUrlResult {
	url: string;
	key: string;
	expiresAt: Date;
}

/**
 * Get environment prefix for upload storage
 * This ensures different environments don't collide when using a single bucket
 */
export function getEnvironmentPrefix(environment: string | undefined): string {
	switch (environment) {
		case "production":
			return "prod";
		case "preview":
			return "preview";
		case "local":
			return "local";
		case "test":
			return "test";
		default:
			return "dev";
	}
}

/**
 * Generate a unique key for SDN XML storage
 * Format: {env}/sdn-xml/{timestamp}-{random}.xml
 */
export function generateSdnXmlKey(environment: string | undefined): string {
	const envPrefix = getEnvironmentPrefix(environment);
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 8);
	return `${envPrefix}/sdn-xml/${timestamp}-${random}.xml`;
}

/**
 * Get the R2 S3-compatible endpoint URL
 */
export function getR2Endpoint(accountId: string): string {
	return `https://${accountId}.r2.cloudflarestorage.com`;
}

/**
 * Generate a presigned URL for uploading a file to R2
 *
 * @param config R2 configuration with credentials
 * @param key The object key (path) in the bucket
 * @param _contentType The expected content type of the upload (not enforced, for reference only)
 * @param expiresInSeconds How long the URL should be valid (default: 10 minutes)
 * @returns Presigned URL and metadata
 */
export async function generatePresignedUploadUrl(
	config: R2PresignedConfig,
	key: string,
	_contentType: string,
	expiresInSeconds: number = 600,
): Promise<PresignedUrlResult> {
	const endpoint = getR2Endpoint(config.accountId);

	// Build URL with X-Amz-Expires BEFORE signing
	const urlObj = new URL(`${endpoint}/${config.bucketName}/${key}`);
	urlObj.searchParams.set("X-Amz-Expires", expiresInSeconds.toString());

	const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

	// Use AwsV4Signer directly for more control
	const signer = new AwsV4Signer({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		service: "s3",
		region: "auto",
		method: "PUT",
		url: urlObj.toString(),
		signQuery: true,
	});

	const signed = await signer.sign();

	return {
		url: signed.url.toString(),
		key,
		expiresAt,
	};
}

/**
 * Result of checking if a file exists in R2
 */
export interface R2FileInfo {
	exists: boolean;
	size?: number;
	etag?: string;
	lastModified?: Date;
}

/**
 * Check if a file exists in R2 using S3-compatible API
 * This is useful for local development where R2 bindings use local storage
 * but presigned URLs upload to the real R2 bucket
 *
 * @param config R2 configuration with credentials
 * @param key The object key (path) in the bucket
 * @returns File info if exists, or { exists: false }
 */
export async function checkFileExistsInR2(
	config: R2PresignedConfig,
	key: string,
): Promise<R2FileInfo> {
	const endpoint = getR2Endpoint(config.accountId);
	const url = `${endpoint}/${config.bucketName}/${key}`;

	// Use AwsV4Signer for HEAD request
	const signer = new AwsV4Signer({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		service: "s3",
		region: "auto",
		method: "HEAD",
		url: url,
	});

	const signed = await signer.sign();

	try {
		const response = await fetch(signed.url.toString(), {
			method: "HEAD",
			headers: signed.headers,
		});

		if (response.ok) {
			const contentLength = response.headers.get("content-length");
			const etag = response.headers.get("etag");
			const lastModified = response.headers.get("last-modified");

			return {
				exists: true,
				size: contentLength ? parseInt(contentLength, 10) : undefined,
				etag: etag ?? undefined,
				lastModified: lastModified ? new Date(lastModified) : undefined,
			};
		}

		return { exists: false };
	} catch {
		return { exists: false };
	}
}

/**
 * Validate that R2 credentials are configured
 */
export function validateR2Config(env: {
	R2_ACCESS_KEY_ID?: string;
	R2_SECRET_ACCESS_KEY?: string;
	CLOUDFLARE_ACCOUNT_ID?: string;
	R2_BUCKET_NAME?: string;
	WATCHLIST_UPLOADS_BUCKET?: R2Bucket;
}): R2PresignedConfig | null {
	if (
		!env.R2_ACCESS_KEY_ID ||
		!env.R2_SECRET_ACCESS_KEY ||
		!env.CLOUDFLARE_ACCOUNT_ID ||
		!env.R2_BUCKET_NAME
	) {
		return null;
	}

	return {
		accountId: env.CLOUDFLARE_ACCOUNT_ID,
		accessKeyId: env.R2_ACCESS_KEY_ID,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY,
		bucketName: env.R2_BUCKET_NAME,
	};
}
