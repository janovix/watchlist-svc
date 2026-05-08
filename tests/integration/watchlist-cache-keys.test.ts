import { describe, expect, it } from "vitest";
import {
	generateSyncCacheKey,
	normalizeQueryForCache,
	type SyncCacheKeyInput,
} from "../../src/lib/watchlist-cache";

describe("normalizeQueryForCache", () => {
	it("lowercases, trims, collapses whitespace, strips diacritics", () => {
		expect(normalizeQueryForCache("  José   María  ")).toBe("jose maria");
		expect(normalizeQueryForCache("ÀÇÉ")).toBe("ace");
		expect(normalizeQueryForCache(" Foo\tbar\nbaz ")).toBe("foo bar baz");
	});
});

describe("generateSyncCacheKey", () => {
	const base: SyncCacheKeyInput = {
		query: "Test Person",
		entityType: "person",
		birthDate: null,
		countries: null,
		identifiers: null,
		topK: 50,
		threshold: 0.875,
		environment: "production",
	};

	it("is stable for equivalent queries and unordered arrays", () => {
		const k1 = generateSyncCacheKey({
			...base,
			query: "  Test   Person  ",
			countries: ["MX", "us"],
			identifiers: ["id-b", "id-a"],
		});
		const k2 = generateSyncCacheKey({
			...base,
			query: "test person",
			countries: ["US", "mx"],
			identifiers: ["ID-A", "id-b"],
		});
		expect(k1).toBe(k2);
		expect(k1.startsWith("watchlist_sync:")).toBe(true);
	});

	it("changes when ordering-sensitive scalar inputs differ", () => {
		const kTop = generateSyncCacheKey({ ...base, topK: 10 });
		const kTop50 = generateSyncCacheKey({ ...base, topK: 50 });
		expect(kTop).not.toBe(kTop50);

		const kProd = generateSyncCacheKey({ ...base, environment: "production" });
		const kDev = generateSyncCacheKey({ ...base, environment: "development" });
		expect(kProd).not.toBe(kDev);
	});
});
