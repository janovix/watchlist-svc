/**
 * Internal Vectorize endpoints for container callbacks.
 *
 * These endpoints are called by thread-worker-container during vectorization
 * to index records in Cloudflare Vectorize.
 *
 * These are INTERNAL endpoints - not exposed to public API.
 * They should be secured via service binding authentication or internal tokens.
 */

import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { createPrismaClient } from "../../lib/prisma";
import type { Bindings } from "../../index";
import {
	composeOfacVectorText,
	composeOfacVectorMetadata,
	getOfacVectorId,
} from "../../lib/ofac-vectorize-service";
import {
	composeSat69bVectorText,
	composeSat69bVectorMetadata,
	getSat69bVectorId,
} from "../../lib/sat69b-vectorize-service";
import {
	composeUnscVectorText,
	composeUnscVectorMetadata,
	getUnscVectorId,
} from "../../lib/unsc-vectorize-service";

// =============================================================================
// Constants
// =============================================================================

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const EMBEDDING_BATCH_SIZE = 50; // Workers AI limit per call
const VECTORIZE_BATCH_SIZE = 100; // Vectorize upsert batch size
const DELETE_BATCH_SIZE = 1000; // Vectorize delete batch size

// =============================================================================
// Count Endpoint
// =============================================================================

/**
 * GET /internal/vectorize/count
 * Returns count of records by dataset in D1
 */
export class InternalVectorizeCountEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Get record count by dataset (internal)",
		description:
			"Returns the count of records for a given dataset. Used to calculate total batches for indexing.",
		security: [],
		request: {
			query: z.object({
				dataset: z
					.string()
					.describe("The dataset to count records for (e.g., ofac_sdn)"),
			}),
		},
		responses: {
			"200": {
				description: "Count retrieved successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							dataset: z.string(),
							count: z.number().int(),
						}),
					},
				},
			},
		},
	};

	async handle(c: { env: Bindings; req: Request }) {
		const url = new URL(c.req.url);
		const dataset = url.searchParams.get("dataset") || "ofac_sdn";

		console.log(`[InternalVectorize] Counting records for dataset: ${dataset}`);

		const prisma = createPrismaClient(c.env.DB);

		let count = 0;

		switch (dataset) {
			case "ofac_sdn":
				count = await prisma.ofacSdnEntry.count();
				break;
			case "sat_69b":
				count = await prisma.sat69bEntry.count();
				break;
			case "unsc":
				count = await prisma.unscEntry.count();
				break;
			// Add more datasets here as needed
			default:
				return Response.json(
					{
						success: false,
						error: `Unknown dataset: ${dataset}`,
					},
					{ status: 400 },
				);
		}

		console.log(`[InternalVectorize] Dataset ${dataset} has ${count} records`);

		return Response.json({
			success: true,
			dataset,
			count,
		});
	}
}

// =============================================================================
// Delete by Dataset Endpoint
// =============================================================================

/**
 * POST /internal/vectorize/delete-by-dataset
 * Deletes all vectors for a given dataset from Vectorize
 */
export class InternalVectorizeDeleteByDatasetEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Delete vectors by dataset (internal)",
		description:
			"Deletes all vectors for a given dataset from Vectorize. Used before re-indexing.",
		security: [],
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							dataset: z
								.string()
								.describe("The dataset to delete vectors for (e.g., ofac_sdn)"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Vectors deleted successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							dataset: z.string(),
							deleted_count: z.number().int(),
						}),
					},
				},
			},
		},
	};

	async handle(c: { env: Bindings; req: Request }) {
		const body = await c.req.json();
		const { dataset } = body as { dataset: string };

		console.log(`[InternalVectorize] Deleting vectors for dataset: ${dataset}`);

		// Validate dataset first
		const validDatasets = ["ofac_sdn", "sat_69b", "unsc"];
		if (!validDatasets.includes(dataset)) {
			return Response.json(
				{
					success: false,
					error: `Unknown dataset: ${dataset}`,
				},
				{ status: 400 },
			);
		}

		const prisma = createPrismaClient(c.env.DB);
		const vectorize = c.env.WATCHLIST_VECTORIZE;

		if (!vectorize) {
			return Response.json(
				{
					success: false,
					error: "Vectorize binding not configured",
				},
				{ status: 500 },
			);
		}

		// Get all IDs from the dataset in D1
		let ids: string[] = [];

		switch (dataset) {
			case "ofac_sdn": {
				const entries = await prisma.ofacSdnEntry.findMany({
					select: { id: true },
				});
				ids = entries.map((e) => getOfacVectorId(e.id));
				break;
			}
			case "sat_69b": {
				const entries = await prisma.sat69bEntry.findMany({
					select: { id: true },
				});
				ids = entries.map((e) => getSat69bVectorId(e.id));
				break;
			}
			case "unsc": {
				const entries = await prisma.unscEntry.findMany({
					select: { id: true },
				});
				ids = entries.map((e) => getUnscVectorId(e.id));
				break;
			}
		}

		console.log(
			`[InternalVectorize] Found ${ids.length} vectors to delete for ${dataset}`,
		);

		// Delete in batches
		let deletedCount = 0;
		for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
			const batch = ids.slice(i, i + DELETE_BATCH_SIZE);
			try {
				await vectorize.deleteByIds(batch);
				deletedCount += batch.length;
				console.log(
					`[InternalVectorize] Deleted batch ${Math.floor(i / DELETE_BATCH_SIZE) + 1}, total: ${deletedCount}`,
				);
			} catch (error) {
				console.error(
					`[InternalVectorize] Error deleting batch: ${error instanceof Error ? error.message : error}`,
				);
				// Continue with next batch even if one fails
			}
		}

		console.log(
			`[InternalVectorize] Deleted ${deletedCount} vectors for ${dataset}`,
		);

		return Response.json({
			success: true,
			dataset,
			deleted_count: deletedCount,
		});
	}
}

// =============================================================================
// Index Batch Endpoint
// =============================================================================

/**
 * POST /internal/vectorize/index-batch
 * Indexes a batch of records from D1 into Vectorize
 */
export class InternalVectorizeIndexBatchEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Index a batch of records (internal)",
		description:
			"Reads a batch of records from D1, generates embeddings, and upserts to Vectorize.",
		security: [],
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							dataset: z
								.string()
								.describe("The dataset to index (e.g., ofac_sdn)"),
							offset: z.number().int().describe("Offset for pagination"),
							limit: z.number().int().describe("Number of records to process"),
							batch_number: z
								.number()
								.int()
								.optional()
								.describe("Current batch number for progress tracking"),
							total_batches: z
								.number()
								.int()
								.optional()
								.describe("Total number of batches"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Batch indexed successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							dataset: z.string(),
							indexed_count: z.number().int(),
							errors: z.array(z.string()),
						}),
					},
				},
			},
		},
	};

	async handle(c: { env: Bindings; req: Request }) {
		const body = await c.req.json();
		const { dataset, offset, limit, batch_number, total_batches } = body as {
			dataset: string;
			offset: number;
			limit: number;
			batch_number?: number;
			total_batches?: number;
		};

		console.log(
			`[InternalVectorize] Indexing batch for ${dataset}: offset=${offset}, limit=${limit}`,
		);

		// Validate dataset first
		const validDatasets = ["ofac_sdn", "sat_69b", "unsc"];
		if (!validDatasets.includes(dataset)) {
			return Response.json(
				{
					success: false,
					error: `Unknown dataset: ${dataset}`,
				},
				{ status: 400 },
			);
		}

		const prisma = createPrismaClient(c.env.DB);
		const vectorize = c.env.WATCHLIST_VECTORIZE;
		const ai = c.env.AI;

		if (!vectorize) {
			return Response.json(
				{
					success: false,
					error: "Vectorize binding not configured",
				},
				{ status: 500 },
			);
		}

		if (!ai) {
			return Response.json(
				{
					success: false,
					error: "AI binding not configured",
				},
				{ status: 500 },
			);
		}

		const errors: string[] = [];
		let indexedCount = 0;

		try {
			switch (dataset) {
				case "ofac_sdn": {
					// Fetch records from D1
					const entries = await prisma.ofacSdnEntry.findMany({
						skip: offset,
						take: limit,
						orderBy: { id: "asc" },
					});

					if (entries.length === 0) {
						console.log(
							`[InternalVectorize] No records found at offset ${offset}`,
						);
						return Response.json({
							success: true,
							dataset,
							indexed_count: 0,
							errors: [],
						});
					}

					console.log(
						`[InternalVectorize] Processing ${entries.length} OFAC entries`,
					);

					// Process in embedding batches
					for (let i = 0; i < entries.length; i += EMBEDDING_BATCH_SIZE) {
						const embeddingBatch = entries.slice(i, i + EMBEDDING_BATCH_SIZE);

						// Compose texts for embedding
						const texts = embeddingBatch.map((entry) =>
							composeOfacVectorText(entry),
						);

						// Generate embeddings
						let embeddings: number[][];
						try {
							const result = await ai.run(EMBEDDING_MODEL, { text: texts });
							// Type guard: check if result has data property (not async response)
							if (
								!result ||
								!("data" in result) ||
								!Array.isArray(result.data)
							) {
								throw new Error("Invalid embedding response format");
							}
							embeddings = result.data as number[][];
						} catch (error) {
							const errorMsg = `Failed to generate embeddings: ${error instanceof Error ? error.message : error}`;
							console.error(`[InternalVectorize] ${errorMsg}`);
							errors.push(errorMsg);
							continue;
						}

						// Prepare vectors for upsert
						const vectors = embeddingBatch.map((entry, idx) => ({
							id: getOfacVectorId(entry.id),
							values: embeddings[idx],
							metadata: composeOfacVectorMetadata(entry),
						}));

						// Upsert to Vectorize in smaller batches
						for (let j = 0; j < vectors.length; j += VECTORIZE_BATCH_SIZE) {
							const vectorBatch = vectors.slice(j, j + VECTORIZE_BATCH_SIZE);
							try {
								await vectorize.upsert(vectorBatch);
								indexedCount += vectorBatch.length;
							} catch (error) {
								const errorMsg = `Failed to upsert vectors: ${error instanceof Error ? error.message : error}`;
								console.error(`[InternalVectorize] ${errorMsg}`);
								errors.push(errorMsg);
							}
						}
					}
					break;
				}
				case "sat_69b": {
					// Fetch records from D1
					const entries = await prisma.sat69bEntry.findMany({
						skip: offset,
						take: limit,
						orderBy: { id: "asc" },
					});

					if (entries.length === 0) {
						console.log(
							`[InternalVectorize] No records found at offset ${offset}`,
						);
						return Response.json({
							success: true,
							dataset,
							indexed_count: 0,
							errors: [],
						});
					}

					console.log(
						`[InternalVectorize] Processing ${entries.length} SAT 69-B entries`,
					);

					// Process in embedding batches
					for (let i = 0; i < entries.length; i += EMBEDDING_BATCH_SIZE) {
						const embeddingBatch = entries.slice(i, i + EMBEDDING_BATCH_SIZE);

						// Compose texts for embedding
						const texts = embeddingBatch.map((entry) =>
							composeSat69bVectorText(entry),
						);

						// Generate embeddings
						let embeddings: number[][];
						try {
							const result = await ai.run(EMBEDDING_MODEL, { text: texts });
							// Type guard: check if result has data property (not async response)
							if (
								!result ||
								!("data" in result) ||
								!Array.isArray(result.data)
							) {
								throw new Error("Invalid embedding response format");
							}
							embeddings = result.data as number[][];
						} catch (error) {
							const errorMsg = `Failed to generate embeddings: ${error instanceof Error ? error.message : error}`;
							console.error(`[InternalVectorize] ${errorMsg}`);
							errors.push(errorMsg);
							continue;
						}

						// Prepare vectors for upsert
						const vectors = embeddingBatch.map((entry, idx) => ({
							id: getSat69bVectorId(entry.id),
							values: embeddings[idx],
							metadata: composeSat69bVectorMetadata(entry),
						}));

						// Upsert to Vectorize in smaller batches
						for (let j = 0; j < vectors.length; j += VECTORIZE_BATCH_SIZE) {
							const vectorBatch = vectors.slice(j, j + VECTORIZE_BATCH_SIZE);
							try {
								await vectorize.upsert(vectorBatch);
								indexedCount += vectorBatch.length;
							} catch (error) {
								const errorMsg = `Failed to upsert vectors: ${error instanceof Error ? error.message : error}`;
								console.error(`[InternalVectorize] ${errorMsg}`);
								errors.push(errorMsg);
							}
						}
					}
					break;
				}
				case "unsc": {
					// Fetch records from D1
					const entries = await prisma.unscEntry.findMany({
						skip: offset,
						take: limit,
						orderBy: { id: "asc" },
					});

					if (entries.length === 0) {
						console.log(
							`[InternalVectorize] No records found at offset ${offset}`,
						);
						return Response.json({
							success: true,
							dataset,
							indexed_count: 0,
							errors: [],
						});
					}

					console.log(
						`[InternalVectorize] Processing ${entries.length} UNSC entries`,
					);

					// Process in embedding batches
					for (let i = 0; i < entries.length; i += EMBEDDING_BATCH_SIZE) {
						const embeddingBatch = entries.slice(i, i + EMBEDDING_BATCH_SIZE);

						// Compose texts for embedding
						const texts = embeddingBatch.map((entry) =>
							composeUnscVectorText(entry),
						);

						// Generate embeddings
						let embeddings: number[][];
						try {
							const result = await ai.run(EMBEDDING_MODEL, { text: texts });
							// Type guard: check if result has data property (not async response)
							if (
								!result ||
								!("data" in result) ||
								!Array.isArray(result.data)
							) {
								throw new Error("Invalid embedding response format");
							}
							embeddings = result.data as number[][];
						} catch (error) {
							const errorMsg = `Failed to generate embeddings: ${error instanceof Error ? error.message : error}`;
							console.error(`[InternalVectorize] ${errorMsg}`);
							errors.push(errorMsg);
							continue;
						}

						// Prepare vectors for upsert
						const vectors = embeddingBatch.map((entry, idx) => ({
							id: getUnscVectorId(entry.id),
							values: embeddings[idx],
							metadata: composeUnscVectorMetadata(entry),
						}));

						// Upsert to Vectorize in smaller batches
						for (let j = 0; j < vectors.length; j += VECTORIZE_BATCH_SIZE) {
							const vectorBatch = vectors.slice(j, j + VECTORIZE_BATCH_SIZE);
							try {
								await vectorize.upsert(vectorBatch);
								indexedCount += vectorBatch.length;
							} catch (error) {
								const errorMsg = `Failed to upsert vectors: ${error instanceof Error ? error.message : error}`;
								console.error(`[InternalVectorize] ${errorMsg}`);
								errors.push(errorMsg);
							}
						}
					}
					break;
				}
			}
		} catch (error) {
			const errorMsg = `Batch processing failed: ${error instanceof Error ? error.message : error}`;
			console.error(`[InternalVectorize] ${errorMsg}`);
			errors.push(errorMsg);
		}

		const batchInfo =
			batch_number && total_batches
				? ` (batch ${batch_number}/${total_batches})`
				: "";
		console.log(
			`[InternalVectorize] Indexed ${indexedCount} vectors for ${dataset}${batchInfo}`,
		);

		return Response.json({
			success: errors.length === 0,
			dataset,
			indexed_count: indexedCount,
			errors,
		});
	}
}

// =============================================================================
// Complete Endpoint
// =============================================================================

/**
 * POST /internal/vectorize/complete
 * Marks a vectorization job as completed
 */
export class InternalVectorizeCompleteEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Complete vectorization job (internal)",
		description:
			"Marks a vectorization job as completed with final statistics.",
		security: [],
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							dataset: z.string().describe("The dataset that was indexed"),
							total_indexed: z.number().int().describe("Total vectors indexed"),
							total_batches: z
								.number()
								.int()
								.describe("Total batches processed"),
							errors: z
								.array(z.string())
								.optional()
								.describe("Any errors encountered"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Vectorization marked as complete",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
						}),
					},
				},
			},
		},
	};

	async handle(c: { env: Bindings; req: Request }) {
		const body = await c.req.json();
		const { dataset, total_indexed, total_batches, errors } = body as {
			dataset: string;
			total_indexed: number;
			total_batches: number;
			errors?: string[];
		};

		console.log(
			`[InternalVectorize] Completing vectorization for ${dataset}: total_indexed=${total_indexed}, total_batches=${total_batches}, errors=${errors?.length ?? 0}`,
		);

		// Could store vectorization stats in D1 if needed
		// For now, just log and return success

		return Response.json({
			success: true,
		});
	}
}

// =============================================================================
// Debug Search Endpoints
// =============================================================================

/**
 * POST /internal/vectorize/search
 * Raw vector search without D1 rehydration or scoring
 */
export class InternalVectorizeSearchEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Raw vector search (internal debug)",
		description:
			"Returns raw vector search results without D1 rehydration or hybrid scoring. For debugging.",
		security: [],
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							query: z.string().describe("Search query text"),
							topK: z
								.number()
								.int()
								.optional()
								.default(10)
								.describe("Top K results"),
							dataset: z
								.string()
								.optional()
								.describe("Optional dataset filter"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Raw vector search results",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							results: z.array(
								z.object({
									id: z.string(),
									score: z.number(),
									metadata: z.record(z.unknown()).nullable(),
								}),
							),
							count: z.number(),
						}),
					},
				},
			},
		},
	};

	async handle(c: { env: Bindings; req: Request }) {
		const body = await c.req.json();
		const {
			query,
			topK = 10,
			dataset,
		} = body as {
			query: string;
			topK?: number;
			dataset?: string;
		};

		console.log(
			`[InternalVectorize] Debug search: query="${query}", topK=${topK}`,
		);

		const ai = c.env.AI;
		const vectorize = c.env.WATCHLIST_VECTORIZE;

		if (!ai) {
			return Response.json(
				{ success: false, error: "AI binding not configured" },
				{ status: 500 },
			);
		}

		if (!vectorize) {
			return Response.json(
				{ success: false, error: "Vectorize binding not configured" },
				{ status: 500 },
			);
		}

		try {
			// Generate embedding
			const result = await ai.run(EMBEDDING_MODEL, { text: [query] });
			if (!result || !("data" in result) || !Array.isArray(result.data)) {
				throw new Error("Invalid embedding response format");
			}
			const embedding = (result.data as number[][])[0];

			// Query vectorize
			const vectorizeOptions: {
				topK: number;
				returnMetadata: true;
				filter?: VectorizeVectorMetadataFilter;
			} = {
				topK,
				returnMetadata: true,
			};

			if (dataset) {
				vectorizeOptions.filter = { dataset };
			}

			const vectorizeResults = await vectorize.query(
				embedding,
				vectorizeOptions,
			);

			const results = vectorizeResults.matches.map((match) => ({
				id: match.id,
				score: match.score || 0,
				metadata: match.metadata || null,
			}));

			return Response.json({
				success: true,
				results,
				count: results.length,
			});
		} catch (error) {
			const errorMsg = `Debug search failed: ${error instanceof Error ? error.message : error}`;
			console.error(`[InternalVectorize] ${errorMsg}`);
			return Response.json(
				{ success: false, error: errorMsg },
				{ status: 500 },
			);
		}
	}
}

/**
 * POST /internal/vectorize/search-hydrated
 * Full hybrid search pipeline with detailed scoring breakdown
 */
export class InternalVectorizeSearchHydratedEndpoint extends OpenAPIRoute {
	schema = {
		tags: ["Internal"],
		summary: "Hydrated search with scoring breakdown (internal debug)",
		description:
			"Returns full hybrid search results with D1 rehydration and detailed scoring breakdown. For debugging.",
		security: [],
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							query: z.string().describe("Search query text"),
							topK: z
								.number()
								.int()
								.optional()
								.default(10)
								.describe("Top K results"),
							dataset: z
								.string()
								.optional()
								.describe("Optional dataset filter"),
							identifiers: z
								.array(z.string())
								.optional()
								.describe("Optional identifiers for exact matching"),
							birthDate: z
								.string()
								.optional()
								.describe("Optional birth date for meta scoring"),
							countries: z
								.array(z.string())
								.optional()
								.describe("Optional countries for meta scoring"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Hydrated search results with scoring breakdown",
				content: {
					"application/json": {
						schema: z.object({
							success: z.boolean(),
							matches: z.array(
								z.object({
									recordId: z.string(),
									dataset: z.string(),
									name: z.string().nullable(),
									finalScore: z.number(),
									breakdown: z.object({
										vectorScore: z.number(),
										nameScore: z.number(),
										metaScore: z.number(),
										identifierMatch: z.boolean(),
									}),
								}),
							),
							count: z.number(),
						}),
					},
				},
			},
		},
	};

	async handle(c: { env: Bindings; req: Request }) {
		const body = await c.req.json();
		const { query } = body as {
			query: string;
			topK?: number;
			dataset?: string;
			identifiers?: string[];
			birthDate?: string;
			countries?: string[];
		};

		console.log(`[InternalVectorize] Debug hydrated search: query="${query}"`);

		// This endpoint basically duplicates the logic from SearchEndpoint but with simpler response format
		// In production you might want to extract the logic into a shared function
		// For now, we'll keep it simple and return a debug-friendly format

		return Response.json({
			success: true,
			matches: [],
			count: 0,
			message:
				"This endpoint would implement full hybrid search with debug output. For now, use POST /search directly.",
		});
	}
}
