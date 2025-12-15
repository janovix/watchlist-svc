import type { AppContext } from "../../types";

type LoggerLike = {
	error?: (data: Record<string, unknown>, message?: string) => void;
};

export function logError(
	c: AppContext,
	message: string,
	meta: Record<string, unknown>,
	error: unknown,
): void {
	const logger = (c as unknown as { logger?: LoggerLike }).logger;

	if (typeof logger?.error === "function") {
		logger.error({ ...meta, error }, message);
		return;
	}

	// Fallback: avoid console.error by default, but keep some signal.
	console.warn(message, { ...meta, error });
}
