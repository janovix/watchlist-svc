import pkg from "../package.json";

const { version } = pkg;

/**
 * OpenAPI 3.1 Specification for Watchlist Service API
 * Single consolidated spec (aml-svc style) for documentation and client generation.
 */
export const openAPISpec = {
	openapi: "3.1.0",
	info: {
		title: "watchlist-svc",
		version,
		description:
			"Watchlist ingestion + search service using Hono + Chanfana + D1 + Vectorize.",
		contact: {
			name: "API Support",
			email: "hostmaster@algenium.systems",
		},
	},
	tags: [
		{ name: "Health", description: "Health check endpoints" },
		{ name: "Config", description: "Service feature flags" },
		{ name: "Search", description: "Watchlist and sanctions search" },
		{ name: "Queries", description: "Query management" },
		{ name: "Ingestion", description: "Admin ingestion runs" },
		{ name: "Upload", description: "SDN XML file uploads" },
		{ name: "Admin", description: "Admin management" },
	],
	paths: {
		"/healthz": {
			get: {
				tags: ["Health"],
				summary: "Health check endpoint",
				operationId: "health",
				responses: {
					"200": {
						description: "Service is healthy",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										success: { type: "boolean" },
										result: {
											type: "object",
											properties: {
												ok: { type: "boolean" },
												timestamp: { type: "string", format: "date-time" },
											},
											required: ["ok", "timestamp"],
										},
									},
									required: ["success", "result"],
								},
							},
						},
					},
				},
			},
		},
		"/config": {
			get: {
				tags: ["Config"],
				summary: "Service feature flags",
				operationId: "config",
				responses: {
					"200": {
						description: "Current feature flags",
						content: {
							"application/json": {
								schema: {
									type: "object",
									properties: {
										success: { type: "boolean" },
										result: {
											type: "object",
											properties: {
												features: {
													type: "object",
													properties: {
														pepSearch: { type: "boolean" },
														pepGrok: { type: "boolean" },
														adverseMedia: { type: "boolean" },
													},
												},
											},
										},
									},
									required: ["success", "result"],
								},
							},
						},
					},
				},
			},
		},
		"/search": {
			post: {
				tags: ["Search"],
				summary: "Semantic search for watchlist targets",
				operationId: "searchTargets",
				requestBody: {
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									query: { type: "string", minLength: 1 },
									topK: {
										type: "integer",
										minimum: 1,
										maximum: 100,
										default: 10,
									},
								},
								required: ["query"],
							},
						},
					},
				},
				responses: {
					"200": { description: "Search results" },
					"400": { description: "Bad request" },
					"503": { description: "Service unavailable" },
				},
			},
		},
		"/search/ofac": {
			post: {
				tags: ["Search"],
				summary: "OFAC sanctions search",
				operationId: "searchOfac",
				requestBody: {
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									query: { type: "string", minLength: 1 },
									topK: { type: "integer", minimum: 1, maximum: 100 },
								},
								required: ["query"],
							},
						},
					},
				},
				responses: {
					"200": { description: "OFAC search results" },
					"400": { description: "Bad request" },
					"503": { description: "Service unavailable" },
				},
			},
		},
		"/search/unsc": {
			post: {
				tags: ["Search"],
				summary: "UNSC sanctions search",
				operationId: "searchUnsc",
				requestBody: {
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									query: { type: "string", minLength: 1 },
									topK: { type: "integer", minimum: 1, maximum: 100 },
								},
								required: ["query"],
							},
						},
					},
				},
				responses: {
					"200": { description: "UNSC search results" },
					"400": { description: "Bad request" },
					"503": { description: "Service unavailable" },
				},
			},
		},
		"/search/sat69b": {
			post: {
				tags: ["Search"],
				summary: "SAT 69-B (Mexican tax) search",
				operationId: "searchSat69b",
				requestBody: {
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									query: { type: "string", minLength: 1 },
									topK: { type: "integer", minimum: 1, maximum: 100 },
								},
								required: ["query"],
							},
						},
					},
				},
				responses: {
					"200": { description: "SAT 69-B search results" },
					"400": { description: "Bad request" },
					"503": { description: "Service unavailable" },
				},
			},
		},
		"/queries": {
			get: {
				tags: ["Queries"],
				summary: "List queries",
				operationId: "queryList",
				responses: {
					"200": { description: "List of queries" },
					"401": { description: "Unauthorized" },
				},
			},
		},
		"/queries/{queryId}": {
			get: {
				tags: ["Queries"],
				summary: "Get query by ID",
				operationId: "queryRead",
				parameters: [
					{
						name: "queryId",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
				],
				responses: {
					"200": { description: "Query details" },
					"401": { description: "Unauthorized" },
					"404": { description: "Not found" },
				},
			},
		},
		"/admin/ingestion/runs": {
			get: {
				tags: ["Ingestion"],
				summary: "List ingestion runs",
				operationId: "listIngestionRuns",
				parameters: [
					{
						name: "limit",
						in: "query",
						schema: { type: "integer", minimum: 1, maximum: 100, default: 10 },
					},
				],
				responses: {
					"200": { description: "List of ingestion runs" },
					"401": { description: "Unauthorized" },
				},
			},
		},
		"/admin/ingestion/runs/{runId}": {
			get: {
				tags: ["Ingestion"],
				summary: "Get ingestion run by ID",
				operationId: "getIngestionRun",
				parameters: [
					{
						name: "runId",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
				],
				responses: {
					"200": { description: "Ingestion run details" },
					"401": { description: "Unauthorized" },
					"404": { description: "Not found" },
				},
			},
		},
		"/admin/ingestion/runs/{runId}/progress": {
			get: {
				tags: ["Ingestion"],
				summary: "Get ingestion run progress",
				operationId: "getIngestionProgress",
				parameters: [
					{
						name: "runId",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
				],
				responses: {
					"200": { description: "Progress data" },
					"401": { description: "Unauthorized" },
					"404": { description: "Not found" },
				},
			},
		},
		"/admin/ingestion/start": {
			post: {
				tags: ["Ingestion"],
				summary: "Start ingestion run",
				operationId: "ingestionStart",
				requestBody: {
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									sourceUrl: { type: "string" },
									reindexAll: { type: "boolean", default: false },
								},
								required: ["sourceUrl"],
							},
						},
					},
				},
				responses: {
					"200": { description: "Ingestion started" },
					"401": { description: "Unauthorized" },
				},
			},
		},
		"/admin/ingestion/{runId}/complete": {
			post: {
				tags: ["Ingestion"],
				summary: "Mark ingestion run complete",
				operationId: "ingestionComplete",
				parameters: [
					{
						name: "runId",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
				],
				responses: {
					"200": { description: "Run marked complete" },
					"401": { description: "Unauthorized" },
				},
			},
		},
		"/admin/ingestion/{runId}/failed": {
			post: {
				tags: ["Ingestion"],
				summary: "Mark ingestion run failed",
				operationId: "ingestionFailed",
				parameters: [
					{
						name: "runId",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
				],
				responses: {
					"200": { description: "Run marked failed" },
					"401": { description: "Unauthorized" },
				},
			},
		},
		"/admin/vectorize/reindex": {
			post: {
				tags: ["Admin"],
				summary: "Reindex all targets from D1 to Vectorize",
				operationId: "adminVectorizeReindex",
				requestBody: {
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									batchSize: {
										type: "integer",
										minimum: 1,
										maximum: 100,
										default: 50,
									},
								},
							},
						},
					},
				},
				responses: {
					"200": { description: "Reindexing started" },
					"401": { description: "Unauthorized" },
				},
			},
		},
		"/api/upload/sdn-xml/prepare": {
			post: {
				tags: ["Upload"],
				summary: "Prepare SDN XML upload",
				description:
					"Validates upload parameters and returns the upload URL and key. Use before uploading SDN XML files (max 150MB). Requires admin auth.",
				operationId: "upload-sdn-xml-prepare",
				requestBody: {
					content: {
						"application/json": {
							schema: {
								type: "object",
								properties: {
									contentType: {
										type: "string",
										enum: ["application/xml", "text/xml"],
									},
									contentLength: {
										type: "integer",
										maximum: 150 * 1024 * 1024,
									},
									fileName: { type: "string" },
								},
								required: ["contentType", "contentLength"],
							},
						},
					},
				},
				responses: {
					"200": { description: "Upload prepared successfully" },
					"400": { description: "Invalid input" },
					"503": { description: "File uploads not configured" },
				},
			},
		},
		"/api/upload/sdn-xml": {
			post: {
				tags: ["Upload"],
				summary: "Upload SDN XML file",
				description:
					"Upload an SDN XML file as multipart/form-data. Expects 'file' (required) and optionally 'key' from /sdn-xml/prepare. Requires admin auth.",
				operationId: "upload-sdn-xml",
				responses: {
					"200": { description: "File uploaded successfully" },
					"400": { description: "Invalid input" },
					"500": { description: "Upload failed" },
					"503": { description: "File uploads not configured" },
				},
			},
		},
		"/api/upload/sdn-xml/{key}": {
			delete: {
				tags: ["Upload"],
				summary: "Delete SDN XML file",
				description:
					"Delete an uploaded SDN XML file by its storage key. Requires admin auth.",
				operationId: "upload-sdn-xml-delete",
				parameters: [
					{
						name: "key",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
				],
				responses: {
					"200": { description: "File deleted successfully" },
					"400": { description: "Invalid key" },
					"403": { description: "Forbidden" },
					"500": { description: "Delete failed" },
					"503": { description: "File uploads not configured" },
				},
			},
		},
	},
	components: {
		securitySchemes: {
			BearerAuth: {
				type: "http",
				scheme: "bearer",
				bearerFormat: "JWT",
			},
		},
	},
};
