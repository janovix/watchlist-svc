import type { Context } from "hono";
import type { Bindings } from "./index";

/**
 * Extended context with organization info from auth middleware
 */
export type AppContext = Context<{
	Bindings: Bindings;
	Variables: {
		organization?: { id: string } | null;
		user?: { id: string; email?: string; name?: string };
		token?: string;
		tokenPayload?: {
			sub: string;
			organizationId?: string | null;
			environment?: string | null;
			role?: string;
			[key: string]: unknown;
		};
		environment?: string;
	};
}>;
