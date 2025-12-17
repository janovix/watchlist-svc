/**
 * Watchlist ingestion service
 * Handles CSV download, parsing, D1 upsert, and Vectorize indexing
 */

import { PrismaClient } from "@prisma/client";
import {
	parseCSVRow,
	streamCSV,
	type WatchlistCSVRow,
	type ParseError,
} from "./csv-parser";
import {
	composeVectorText,
	composeVectorMetadata,
	upsertVectors,
} from "./vectorize-service";
import { serializeJsonField } from "../endpoints/watchlist/base";

export interface IngestionStats {
	totalRows: number;
	parsedRows: number;
	insertedRows: number;
	updatedRows: number;
	indexedRows: number;
	errors: ParseError[];
	parseErrors: number;
	indexErrors: number;
}

export interface IngestionRun {
	id: number;
	sourceUrl: string;
	status: "running" | "completed" | "failed";
	startedAt: Date;
	finishedAt: Date | null;
	stats: IngestionStats | null;
	errorMessage: string | null;
}

/**
 * Generate embedding for text using Cloudflare AI
 */
async function generateEmbedding(
	ai:
		| {
				run: (
					model: string,
					input: { text: string[] },
				) => Promise<{ data: number[][] }>;
		  }
		| undefined,
	text: string,
): Promise<number[]> {
	if (!ai) {
		throw new Error("AI binding not available for embedding generation");
	}

	// Use Cloudflare AI's text embedding model
	const response = await ai.run("@cf/baai/bge-base-en-v1.5", {
		text: [text],
	});

	if (
		!response ||
		!Array.isArray(response.data) ||
		response.data.length === 0
	) {
		throw new Error("Invalid embedding response");
	}

	return response.data[0] as number[];
}

/**
 * Upsert a watchlist target to D1
 */
async function upsertTarget(
	prisma: PrismaClient,
	row: WatchlistCSVRow,
): Promise<{ inserted: boolean }> {
	const existing = await prisma.watchlistTarget.findUnique({
		where: { id: row.id },
	});

	const data = {
		id: row.id,
		schema: row.schema,
		name: row.name,
		aliases: serializeJsonField(row.aliases),
		birthDate: row.birthDate,
		countries: serializeJsonField(row.countries),
		addresses: serializeJsonField(row.addresses),
		identifiers: serializeJsonField(row.identifiers),
		sanctions: serializeJsonField(row.sanctions),
		phones: serializeJsonField(row.phones),
		emails: serializeJsonField(row.emails),
		programIds: serializeJsonField(row.programIds),
		dataset: row.dataset,
		firstSeen: row.firstSeen,
		lastSeen: row.lastSeen,
		lastChange: row.lastChange,
	};

	if (existing) {
		// Update if lastChange is newer or if fields changed
		if (
			!existing.lastChange ||
			!row.lastChange ||
			row.lastChange > existing.lastChange
		) {
			await prisma.watchlistTarget.update({
				where: { id: row.id },
				data,
			});
			return { inserted: false };
		}
		return { inserted: false };
	} else {
		await prisma.watchlistTarget.create({ data });
		return { inserted: true };
	}
}

/**
 * Check if target needs re-indexing
 */
async function needsReindexing(
	prisma: PrismaClient,
	targetId: string,
	lastChange: string | null,
): Promise<boolean> {
	const vectorState = await prisma.watchlistVectorState.findUnique({
		where: { targetId },
	});

	if (!vectorState) return true;
	if (!lastChange) return false;
	if (!vectorState.lastIndexedChange) return true;

	return lastChange > vectorState.lastIndexedChange;
}

/**
 * Update vector state after indexing
 */
async function updateVectorState(
	prisma: PrismaClient,
	targetId: string,
	lastChange: string | null,
): Promise<void> {
	await prisma.watchlistVectorState.upsert({
		where: { targetId },
		create: {
			targetId,
			vectorId: targetId,
			lastIndexedChange: lastChange,
		},
		update: {
			lastIndexedChange: lastChange,
		},
	});
}

/**
 * Memory-efficient streaming ingestion function
 * Processes CSV in chunks without loading entire file into memory
 * Suitable for Cloudflare Workers with limited memory
 */
export async function ingestCSVStreaming(
	prisma: PrismaClient,
	vectorize: VectorizeIndex,
	ai:
		| {
				run: (
					model: string,
					input: { text: string[] },
				) => Promise<{ data: number[][] }>;
		  }
		| undefined,
	sourceUrl: string,
	runId: number,
	options: {
		reindexAll?: boolean;
		batchSize?: number;
		onProgress?: (stats: IngestionStats) => Promise<void>;
	} = {},
): Promise<IngestionStats> {
	const stats: IngestionStats = {
		totalRows: 0,
		parsedRows: 0,
		insertedRows: 0,
		updatedRows: 0,
		indexedRows: 0,
		errors: [],
		parseErrors: 0,
		indexErrors: 0,
	};

	const batchSize = options.batchSize || 20; // Smaller batch size for memory efficiency
	const vectorsToIndex: Array<{
		id: string;
		values: number[];
		metadata: Record<string, string | number | boolean | string[]>;
		row: WatchlistCSVRow;
	}> = [];

	let processedRows = 0;
	const progressInterval = 100; // Report progress every N rows

	try {
		console.log(`[Ingestion] Starting streaming ingestion for runId: ${runId}`);
		console.log(`[Ingestion] CSV URL: ${sourceUrl}`);

		// Stream CSV download
		const response = await fetch(sourceUrl);
		if (!response.ok) {
			throw new Error(
				`Failed to download CSV: ${response.status} ${response.statusText}`,
			);
		}

		console.log(`[Ingestion] CSV download started, streaming...`);

		// Process CSV row by row
		for await (const csvRow of streamCSV(response)) {
			stats.totalRows++;
			processedRows++;

			const parseErrors: ParseError[] = [];
			const row = parseCSVRow(csvRow, parseErrors);

			if (parseErrors.length > 0) {
				stats.errors.push(...parseErrors);
				stats.parseErrors += parseErrors.length;
			}

			if (!row) continue;
			stats.parsedRows++;

			try {
				// Upsert to D1
				const { inserted } = await upsertTarget(prisma, row);
				if (inserted) {
					stats.insertedRows++;
				} else {
					stats.updatedRows++;
				}

				// Check if needs indexing
				const needsIndex =
					options.reindexAll ||
					(await needsReindexing(prisma, row.id, row.lastChange));

				if (needsIndex) {
					// Generate embedding
					const vectorText = composeVectorText(row);
					if (vectorText) {
						try {
							const embedding = await generateEmbedding(ai, vectorText);
							const metadata = composeVectorMetadata(row);

							vectorsToIndex.push({
								id: row.id,
								values: embedding,
								metadata: metadata as Record<
									string,
									string | number | boolean | string[]
								>,
								row,
							});
						} catch (error) {
							stats.indexErrors++;
							console.warn(
								`[Ingestion] Failed to generate embedding for ${row.id}:`,
								error,
							);
						}
					}
				}
			} catch (error) {
				stats.errors.push({
					rowId: row.id,
					field: "database",
					error: error instanceof Error ? error.message : String(error),
				});
				console.warn(`[Ingestion] Failed to upsert target ${row.id}:`, error);
			}

			// Process vectors in batches to avoid memory buildup
			if (vectorsToIndex.length >= batchSize) {
				try {
					console.log(
						`[Ingestion] Processing batch of ${vectorsToIndex.length} vectors...`,
					);
					await upsertVectors(
						vectorize,
						vectorsToIndex.map((v) => ({
							id: v.id,
							values: v.values,
							metadata: v.metadata,
						})),
					);

					// Update vector states
					for (const v of vectorsToIndex) {
						await updateVectorState(prisma, v.row.id, v.row.lastChange);
					}

					stats.indexedRows += vectorsToIndex.length;
					console.log(
						`[Ingestion] Indexed ${vectorsToIndex.length} vectors (total: ${stats.indexedRows})`,
					);
					vectorsToIndex.length = 0; // Clear batch to free memory
				} catch (error) {
					stats.indexErrors += vectorsToIndex.length;
					console.error(`[Ingestion] Failed to upsert vectors batch:`, error);
					vectorsToIndex.length = 0; // Clear even on error to prevent memory leak
				}
			}

			// Report progress periodically
			if (processedRows % progressInterval === 0 && options.onProgress) {
				console.log(
					`[Ingestion] Progress: ${processedRows} rows processed (${stats.parsedRows} parsed, ${stats.insertedRows} inserted, ${stats.updatedRows} updated, ${stats.indexedRows} indexed)`,
				);
				await options.onProgress({ ...stats });
			}
		}

		// Process any remaining vectors
		if (vectorsToIndex.length > 0) {
			try {
				console.log(
					`[Ingestion] Processing final batch of ${vectorsToIndex.length} vectors...`,
				);
				await upsertVectors(
					vectorize,
					vectorsToIndex.map((v) => ({
						id: v.id,
						values: v.values,
						metadata: v.metadata,
					})),
				);

				for (const v of vectorsToIndex) {
					await updateVectorState(prisma, v.row.id, v.row.lastChange);
				}

				stats.indexedRows += vectorsToIndex.length;
				console.log(
					`[Ingestion] Final batch indexed (total: ${stats.indexedRows})`,
				);
			} catch (error) {
				stats.indexErrors += vectorsToIndex.length;
				console.error(
					`[Ingestion] Failed to upsert final vectors batch:`,
					error,
				);
			}
		}

		// Final progress update
		if (options.onProgress) {
			await options.onProgress({ ...stats });
		}

		console.log(`[Ingestion] Completed ingestion for runId: ${runId}`, {
			totalRows: stats.totalRows,
			parsedRows: stats.parsedRows,
			insertedRows: stats.insertedRows,
			updatedRows: stats.updatedRows,
			indexedRows: stats.indexedRows,
			errors: stats.errors.length,
		});
	} catch (error) {
		// Provide more context about what failed
		const baseMessage = error instanceof Error ? error.message : String(error);
		const errorType =
			error instanceof Error ? error.constructor.name : typeof error;

		console.error(`[Ingestion] Ingestion failed for runId: ${runId}`, {
			error: baseMessage,
			type: errorType,
		});

		throw new Error(`Ingestion failed [${errorType}]: ${baseMessage}`, {
			cause: error,
		});
	}

	return stats;
}
