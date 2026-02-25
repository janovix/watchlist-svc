/**
 * Upload routes for watchlist file uploads using R2 storage
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { Bindings } from "../index";
import { z } from "zod";

type UploadBindings = {
	Bindings: Bindings;
};

type UploadContext = Context<UploadBindings>;

const uploadRoutes = new Hono<UploadBindings>();

// Allowed MIME types for SDN XML uploads
const ALLOWED_MIME_TYPES = ["application/xml", "text/xml"] as const;

// Max file size: 150MB (SDN XML can be ~122MB)
const MAX_FILE_SIZE = 150 * 1024 * 1024;

/**
 * Get environment prefix for upload storage
 * This ensures different environments don't collide when using a single bucket
 */
function getEnvironmentPrefix(env: Bindings): string {
	const environment = String(env.ENVIRONMENT || "dev");
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
function generateSdnXmlKey(env: Bindings): string {
	const envPrefix = getEnvironmentPrefix(env);
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(2, 8);
	return `${envPrefix}/sdn-xml/${timestamp}-${random}.xml`;
}

/**
 * Schema for requesting a signed upload URL
 */
const prepareUploadRequestSchema = z.object({
	contentType: z.enum(ALLOWED_MIME_TYPES, {
		errorMap: () => ({
			message: `Content type must be one of: ${ALLOWED_MIME_TYPES.join(", ")}`,
		}),
	}),
	contentLength: z
		.number()
		.int()
		.positive()
		.max(
			MAX_FILE_SIZE,
			`File size must be less than ${MAX_FILE_SIZE / 1024 / 1024}MB`,
		),
	fileName: z.string().optional(),
});

/**
 * POST /api/upload/sdn-xml/prepare
 * Prepare an SDN XML upload by generating the key and validating the request.
 * Returns the upload URL and the key to use for the upload.
 */
uploadRoutes.post("/sdn-xml/prepare", async (c: UploadContext) => {
	// Check if R2 bucket is configured
	if (!c.env.WATCHLIST_UPLOADS_BUCKET) {
		console.error("[Upload] WATCHLIST_UPLOADS_BUCKET not configured");
		return c.json(
			{ success: false, error: "File uploads not configured" },
			503,
		);
	}

	const body = await c.req.json();
	const parseResult = prepareUploadRequestSchema.safeParse(body);

	if (!parseResult.success) {
		return c.json(
			{
				success: false,
				error: "Invalid input",
				details: parseResult.error.errors,
			},
			400,
		);
	}

	// Generate a unique key for this upload (with environment prefix)
	const key = generateSdnXmlKey(c.env);

	// Return the upload endpoint and key
	return c.json({
		success: true,
		data: {
			key,
			uploadUrl: `/api/upload/sdn-xml`,
			maxSize: MAX_FILE_SIZE,
			allowedTypes: ALLOWED_MIME_TYPES,
			expiresIn: 600, // 10 minutes to complete upload
		},
	});
});

/**
 * POST /api/upload/sdn-xml
 * Upload an SDN XML file directly.
 * Expects multipart/form-data with:
 * - file: The XML file
 * - key: The pre-generated key from /sdn-xml/prepare (optional, will generate if not provided)
 */
uploadRoutes.post("/sdn-xml", async (c: UploadContext) => {
	// Check if R2 bucket is configured
	if (!c.env.WATCHLIST_UPLOADS_BUCKET) {
		console.error("[Upload] WATCHLIST_UPLOADS_BUCKET not configured");
		return c.json(
			{ success: false, error: "File uploads not configured" },
			503,
		);
	}

	try {
		const formData = await c.req.formData();
		const file = formData.get("file");
		const providedKey = formData.get("key");

		if (!file || !(file instanceof File)) {
			return c.json({ success: false, error: "No file provided" }, 400);
		}

		// Validate file type
		const fileType = file.type || "application/xml";
		if (
			!ALLOWED_MIME_TYPES.includes(
				fileType as (typeof ALLOWED_MIME_TYPES)[number],
			)
		) {
			return c.json(
				{
					success: false,
					error: `Invalid file type: ${fileType}. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`,
				},
				400,
			);
		}

		// Validate file size
		if (file.size > MAX_FILE_SIZE) {
			return c.json(
				{
					success: false,
					error: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
				},
				400,
			);
		}

		// Use provided key or generate a new one (with environment prefix)
		const envPrefix = getEnvironmentPrefix(c.env);
		const expectedKeyPrefix = `${envPrefix}/sdn-xml/`;
		const key =
			typeof providedKey === "string" &&
			providedKey.startsWith(expectedKeyPrefix)
				? providedKey
				: generateSdnXmlKey(c.env);

		// Upload to R2
		const arrayBuffer = await file.arrayBuffer();
		await c.env.WATCHLIST_UPLOADS_BUCKET.put(key, arrayBuffer, {
			httpMetadata: {
				contentType: fileType,
			},
			customMetadata: {
				uploadedAt: new Date().toISOString(),
				originalName: file.name || "sdn_advanced.xml",
			},
		});

		console.log(`[Upload] SDN XML uploaded: ${key} (${file.size} bytes)`);

		return c.json({
			success: true,
			data: {
				key,
				size: file.size,
				contentType: fileType,
			},
		});
	} catch (error) {
		console.error("[Upload] Error uploading SDN XML:", error);
		return c.json({ success: false, error: "Failed to upload file" }, 500);
	}
});

/**
 * DELETE /api/upload/sdn-xml/:key
 * Delete an uploaded SDN XML file (admin only)
 */
uploadRoutes.delete("/sdn-xml/*", async (c: UploadContext) => {
	// Check if R2 bucket is configured
	if (!c.env.WATCHLIST_UPLOADS_BUCKET) {
		console.error("[Upload] WATCHLIST_UPLOADS_BUCKET not configured");
		return c.json(
			{ success: false, error: "File uploads not configured" },
			503,
		);
	}

	// Extract the key from the path (everything after /sdn-xml/)
	const path = c.req.path;
	const keyMatch = path.match(/\/api\/upload\/sdn-xml\/(.+)/);
	if (!keyMatch) {
		return c.json({ success: false, error: "Invalid key" }, 400);
	}

	const key = decodeURIComponent(keyMatch[1]);

	// Verify the key is an SDN XML key
	const envPrefix = getEnvironmentPrefix(c.env);
	const expectedKeyPrefix = `${envPrefix}/sdn-xml/`;
	if (!key.startsWith(expectedKeyPrefix)) {
		return c.json(
			{
				success: false,
				error: "Forbidden: Invalid file key",
			},
			403,
		);
	}

	try {
		await c.env.WATCHLIST_UPLOADS_BUCKET.delete(key);
		console.log(`[Upload] SDN XML deleted: ${key}`);

		return c.json({
			success: true,
			data: { key },
		});
	} catch (error) {
		console.error("[Upload] Error deleting SDN XML:", error);
		return c.json({ success: false, error: "Failed to delete file" }, 500);
	}
});

export { uploadRoutes };
