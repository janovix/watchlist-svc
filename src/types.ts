import type { Context } from "hono";

// Extend Env with additional bindings
interface Env extends Cloudflare.Env {
	AI?: {
		run: (
			model: string,
			input: { text: string[] },
		) => Promise<{ data: number[][] }>;
	};
	ADMIN_API_KEY?: string;
}

export type AppContext = Context<{ Bindings: Env }>;
export type HandleArgs = [AppContext];
