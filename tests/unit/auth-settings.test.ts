import { describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src";
import {
	extractBrowserHints,
	getDefaultSettings,
	getResolvedSettings,
	getSettingsWithFallback,
	type ResolvedSettings,
} from "../../src/lib/auth-settings";

const resolvedSettings: ResolvedSettings = {
	theme: "dark",
	timezone: "America/Mexico_City",
	language: "es",
	dateFormat: "DD/MM/YYYY",
	avatarUrl: "https://example.com/avatar.png",
	paymentMethods: [
		{ id: "pm_1", type: "card", label: "Visa", last4: "4242", isDefault: true },
	],
	sources: {
		theme: "user",
		timezone: "organization",
		language: "browser",
		dateFormat: "user",
	},
};

function envWithAuth(getResolvedSettingsImpl?: unknown): Bindings {
	return {
		AUTH_SERVICE: getResolvedSettingsImpl
			? { getResolvedSettings: getResolvedSettingsImpl }
			: undefined,
	} as unknown as Bindings;
}

describe("auth-settings", () => {
	it("returns null when AUTH_SERVICE is missing", async () => {
		await expect(
			getResolvedSettings(envWithAuth(), "user-1"),
		).resolves.toBeNull();
	});

	it("decodes auth-svc success and failure envelopes", async () => {
		const success = vi.fn(async () => ({
			success: true,
			data: resolvedSettings,
		}));
		await expect(
			getResolvedSettings(envWithAuth(success), "user-1", "org-1", {
				"accept-language": "es-MX",
				"x-timezone": "America/Mexico_City",
			}),
		).resolves.toEqual(resolvedSettings);
		expect(success).toHaveBeenCalledWith("user-1", "org-1", expect.any(String));

		const failure = vi.fn(async () => ({ success: false }));
		await expect(
			getResolvedSettings(envWithAuth(failure), "user-1"),
		).resolves.toBeNull();
	});

	it("accepts direct resolved settings objects from auth-svc", async () => {
		const direct = vi.fn(async () => resolvedSettings);

		await expect(
			getResolvedSettings(envWithAuth(direct), "user-1"),
		).resolves.toEqual(resolvedSettings);
	});

	it("returns null when auth-svc throws or returns a non-object", async () => {
		const throwing = vi.fn(async () => {
			throw new Error("auth down");
		});
		await expect(
			getResolvedSettings(envWithAuth(throwing), "user-1"),
		).resolves.toBeNull();

		const invalid = vi.fn(async () => null);
		await expect(
			getResolvedSettings(envWithAuth(invalid), "user-1"),
		).resolves.toBeNull();
	});

	it("extracts browser hints from headers", () => {
		const headers = new Headers({
			"Accept-Language": "es-MX",
			"X-Timezone": "America/Mexico_City",
			"X-Preferred-Theme": "dark",
		});

		expect(extractBrowserHints(headers)).toEqual({
			"accept-language": "es-MX",
			"x-timezone": "America/Mexico_City",
			"x-preferred-theme": "dark",
		});
		expect(extractBrowserHints(new Headers())).toEqual({
			"accept-language": undefined,
			"x-timezone": undefined,
			"x-preferred-theme": undefined,
		});
	});

	it("returns defaults and fallback settings", async () => {
		const defaults = getDefaultSettings();
		expect(defaults).toMatchObject({
			theme: "system",
			timezone: "UTC",
			language: "en",
			dateFormat: "YYYY-MM-DD",
			avatarUrl: null,
			paymentMethods: [],
		});

		await expect(
			getSettingsWithFallback(envWithAuth(), "user-1"),
		).resolves.toEqual(defaults);

		const direct = vi.fn(async () => resolvedSettings);
		await expect(
			getSettingsWithFallback(envWithAuth(direct), "user-1"),
		).resolves.toEqual(resolvedSettings);
	});
});
