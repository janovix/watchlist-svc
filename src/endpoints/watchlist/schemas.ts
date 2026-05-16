/**
 * Shared Zod schemas for watchlist HTTP/OpenAPI routes.
 */

import { z } from "zod";
import { ofacMatch } from "./searchOfac";
import { sat69bMatch } from "./searchSat69b";
import { unscMatch } from "./searchUnsc";

/** Identity document shape emitted by ingestion containers (OFAC / UNSC). */
export const identityDocumentSchema = z.object({
	type: z.string(),
	number: z.string(),
	country: z.string().nullable().optional(),
	issue_date: z.string().nullable().optional(),
	expiration_date: z.string().nullable().optional(),
});

/** Progress streaming payload from Grok containers → PEP_EVENTS_DO. */
export const containerProgressPayloadSchema = z.object({
	search_id: z.string().describe("Search ID for tracking"),
	phase: z
		.string()
		.optional()
		.describe("Phase identifier e.g. searching, thinking"),
	message: z.string().optional().describe("Human-readable progress message"),
	progress: z.number().min(0).max(1).optional().describe("Progress 0-1"),
});

/** Combined hybrid search API result (public + internal search endpoints). */
export const hybridWatchlistSearchResultSchema = z.object({
	queryId: z.string().describe("Persistent query ID for result aggregation"),
	ofac: z.object({
		matches: z.array(ofacMatch),
		count: z.number(),
	}),
	unsc: z.object({
		matches: z.array(unscMatch),
		count: z.number(),
	}),
	sat69b: z.object({
		matches: z.array(sat69bMatch),
		count: z.number(),
	}),
	pepSearch: z
		.object({
			searchId: z.string(),
			status: z.enum(["completed", "pending", "disabled"]),
			results: z.any().nullable(),
		})
		.optional(),
	pepAiSearch: z
		.object({
			searchId: z.string(),
			status: z.enum(["completed", "pending", "skipped", "disabled", "failed"]),
			result: z.any().nullable(),
		})
		.optional(),
	adverseMediaSearch: z
		.object({
			searchId: z.string(),
			status: z.enum(["completed", "pending", "disabled", "failed"]),
			result: z.any().nullable(),
		})
		.optional(),
});
