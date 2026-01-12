import { describe, it, expect, beforeEach } from "vitest";
import { ApiException } from "chanfana";
import { checkAdminAuth } from "../../src/lib/auth";
import type { AppContext } from "../../src/types";

describe("checkAdminAuth", () => {
	let mockContext: AppContext;

	beforeEach(() => {
		mockContext = {
			req: {
				header: (name: string) => {
					if (name === "x-admin-api-key") {
						return "test-api-key";
					}
					return undefined;
				},
			},
			env: {
				ADMIN_API_KEY: "test-api-key",
			},
		} as unknown as AppContext;
	});

	it("should throw 500 error when ADMIN_API_KEY is not configured", () => {
		mockContext.env.ADMIN_API_KEY = undefined;

		expect(() => checkAdminAuth(mockContext)).toThrow(ApiException);
		try {
			checkAdminAuth(mockContext);
		} catch (error) {
			expect(error).toBeInstanceOf(ApiException);
			const apiError = error as ApiException;
			expect(apiError.status).toBe(500);
			expect(apiError.code).toBe(500);
			expect(apiError.message).toBe("Admin API key not configured");
		}
	});

	it("should throw 401 error when api key is missing", () => {
		mockContext.req.header = ((name: string) => {
			if (name === "x-admin-api-key") return undefined;
			return undefined;
		}) as typeof mockContext.req.header;

		expect(() => checkAdminAuth(mockContext)).toThrow(ApiException);
		try {
			checkAdminAuth(mockContext);
		} catch (error) {
			expect(error).toBeInstanceOf(ApiException);
			const apiError = error as ApiException;
			expect(apiError.status).toBe(401);
			expect(apiError.code).toBe(401);
			expect(apiError.message).toBe("Unauthorized");
		}
	});

	it("should throw 401 error when api key does not match", () => {
		mockContext.req.header = ((name: string) => {
			if (name === "x-admin-api-key") return "wrong-key";
			return undefined;
		}) as typeof mockContext.req.header;

		expect(() => checkAdminAuth(mockContext)).toThrow(ApiException);
		try {
			checkAdminAuth(mockContext);
		} catch (error) {
			expect(error).toBeInstanceOf(ApiException);
			const apiError = error as ApiException;
			expect(apiError.status).toBe(401);
			expect(apiError.code).toBe(401);
			expect(apiError.message).toBe("Unauthorized");
		}
	});

	it("should not throw when api key matches", () => {
		expect(() => checkAdminAuth(mockContext)).not.toThrow();
	});
});
