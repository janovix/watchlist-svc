import { describe, expect, it } from "vitest";
import { isOriginAllowed } from "../../src/middleware/cors";

describe("CORS isOriginAllowed", () => {
	describe("exact match", () => {
		it("should allow when origin exactly matches pattern", () => {
			expect(
				isOriginAllowed("https://aml.janovix.com", ["https://aml.janovix.com"]),
			).toBe(true);
		});

		it("should deny when origin does not match any pattern", () => {
			expect(
				isOriginAllowed("https://other.com", ["https://aml.janovix.com"]),
			).toBe(false);
		});
	});

	describe("wildcard subdomain (*.domain)", () => {
		it("should allow valid subdomain origin", () => {
			expect(
				isOriginAllowed("https://aml.janovix.workers.dev", [
					"*.janovix.workers.dev",
				]),
			).toBe(true);
			expect(
				isOriginAllowed("http://watchlist-svc.janovix.workers.dev", [
					"*.janovix.workers.dev",
				]),
			).toBe(true);
		});

		it("should deny root domain when pattern is wildcard subdomain", () => {
			expect(
				isOriginAllowed("https://janovix.workers.dev", [
					"*.janovix.workers.dev",
				]),
			).toBe(false);
		});

		it("should deny when subdomain part has invalid characters", () => {
			// Invalid: protocol + domain must be alphanumeric/hyphens only
			expect(
				isOriginAllowed("https://aml_sub.janovix.workers.dev", [
					"*.janovix.workers.dev",
				]),
			).toBe(false);
		});
	});

	describe("localhost wildcard (http://localhost:*)", () => {
		it("should allow localhost with numeric port", () => {
			expect(
				isOriginAllowed("http://localhost:3000", ["http://localhost:*"]),
			).toBe(true);
			expect(
				isOriginAllowed("http://localhost:8787", ["http://localhost:*"]),
			).toBe(true);
		});

		it("should deny localhost with non-numeric port", () => {
			expect(
				isOriginAllowed("http://localhost:abc", ["http://localhost:*"]),
			).toBe(false);
		});

		it("should deny when pattern is not exactly http://localhost:*", () => {
			expect(
				isOriginAllowed("http://localhost:3000", ["http://localhost:3000"]),
			).toBe(true); // exact match
			expect(
				isOriginAllowed("http://localhost:3000", ["http://localhost:*"]),
			).toBe(true);
		});
	});

	describe("empty patterns", () => {
		it("should deny when patterns array is empty", () => {
			expect(isOriginAllowed("https://aml.janovix.com", [])).toBe(false);
		});
	});
});
