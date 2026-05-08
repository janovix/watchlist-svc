/**
 * Testable adapters for Workers AI embeddings + Vectorize queries used by {@link performSearch}.
 */

import type { Bindings } from "../index";

export interface EmbeddingsAdapter {
	embed(text: string, model: string): Promise<number[]>;
}

export interface VectorIndexAdapter {
	query(
		vector: number[],
		opts: {
			topK: number;
			returnMetadata: boolean;
			filter?: VectorizeVectorMetadataFilter;
		},
	): Promise<{
		matches: Array<{
			id: string;
			score: number;
			metadata?: Record<string, unknown> | null;
		}>;
	}>;
}

export function defaultEmbeddings(env: Bindings): EmbeddingsAdapter {
	return {
		async embed(text: string, model: string): Promise<number[]> {
			const ai = env.AI;
			if (!ai) {
				throw new Error("[SearchCore] AI binding not available");
			}
			type AiEmbedRunner = {
				run: (
					m: string,
					input: { text: string[] },
				) => Promise<{ data: number[][] }>;
			};
			const queryResponse = await (ai as unknown as AiEmbedRunner).run(model, {
				text: [text],
			});
			const row = queryResponse?.data?.[0];
			return Array.isArray(row) ? row : [];
		},
	};
}

export function defaultVectorIndex(env: Bindings): VectorIndexAdapter {
	return {
		async query(vector, opts) {
			const index = env.WATCHLIST_VECTORIZE;
			if (!index) {
				throw new Error("[SearchCore] WATCHLIST_VECTORIZE not available");
			}
			return index.query(vector, opts);
		},
	};
}
