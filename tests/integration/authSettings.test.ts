import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { Bindings } from "../../src/index";
import {
	getDefaultSettings,
	extractBrowserHints,
	getResolvedSettings,
	type ResolvedSettings,
} from "../../src/lib/auth-settings";

describe("auth-settings", () => {
	describe("getDefaultSettings", () => {
		it("returns default settings with correct values", () => {
			const defaults = getDefaultSettings();

			expect(defaults).toEqual<ResolvedSettings>({
				theme: "system",
				timezone: "UTC",
				language: "en",
				dateFormat: "YYYY-MM-DD",
				avatarUrl: null,
				paymentMethods: [],
				sources: {
					theme: "default",
					timezone: "default",
					language: "default",
					dateFormat: "default",
				},
			});
		});
	});

	describe("extractBrowserHints", () => {
		it("extracts browser hints from headers", () => {
			const headers = new Headers({
				"Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
				"X-Timezone": "America/Mexico_City",
				"X-Preferred-Theme": "dark",
			});

			const hints = extractBrowserHints(headers);

			expect(hints).toEqual({
				"accept-language": "es-MX,es;q=0.9,en;q=0.8",
				"x-timezone": "America/Mexico_City",
				"x-preferred-theme": "dark",
			});
		});

		it("handles missing headers gracefully", () => {
			const headers = new Headers();

			const hints = extractBrowserHints(headers);

			expect(hints).toEqual({
				"accept-language": undefined,
				"x-timezone": undefined,
				"x-preferred-theme": undefined,
			});
		});

		it("handles partial headers", () => {
			const headers = new Headers({
				"Accept-Language": "en-US",
			});

			const hints = extractBrowserHints(headers);

			expect(hints).toEqual({
				"accept-language": "en-US",
				"x-timezone": undefined,
				"x-preferred-theme": undefined,
			});
		});
	});

	describe("getResolvedSettings", () => {
		it("returns settings from a plain-object AUTH_SERVICE stub (no ServiceStub)", async () => {
			const authStub = {
				getResolvedSettings: async () => ({
					success: true,
					data: {
						theme: "dark" as const,
						timezone: "America/Mexico_City",
						language: "es" as const,
						dateFormat: "DD/MM/YYYY" as const,
						avatarUrl: null as string | null,
						paymentMethods: [] as Array<unknown>,
						sources: {
							theme: "user" as const,
							timezone: "organization" as const,
							language: "browser" as const,
							dateFormat: "default" as const,
						},
					},
				}),
			};

			const merged = {
				...(env as unknown as Bindings),
				AUTH_SERVICE: authStub as unknown as Bindings["AUTH_SERVICE"],
			};

			const resolved = await getResolvedSettings(
				merged,
				"user-1",
				"org-1",
				extractBrowserHints(
					new Headers({ "Accept-Language": "es-MX", "X-Timezone": "UTC" }),
				),
			);

			expect(resolved?.theme).toBe("dark");
			expect(resolved?.language).toBe("es");
			expect(resolved?.timezone).toBe("America/Mexico_City");
		});
	});
});
