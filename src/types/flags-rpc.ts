/**
 * Typed RPC surface for flags-svc (matches FlagsSvcEntrypoint).
 */

export type FlagValue = boolean | string | number | Record<string, unknown>;

export interface EvaluationContext {
	organizationId?: string;
	userId?: string;
	plan?: string;
	environment?: string;
	attributes?: Record<string, string | number | boolean>;
}

export interface FlagsSvcBinding {
	fetch(request: Request | string, init?: RequestInit): Promise<Response>;
	evaluateFlag(
		key: string,
		context: EvaluationContext,
	): Promise<FlagValue | null>;
	evaluateFlags(
		keys: string[],
		context: EvaluationContext,
	): Promise<Record<string, FlagValue>>;
	evaluateAllFlags(
		context: EvaluationContext,
	): Promise<Record<string, FlagValue>>;
	isFlagEnabled(key: string, context: EvaluationContext): Promise<boolean>;
}
