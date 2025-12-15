import type { D1Migration } from "cloudflare:test";

export type TestEnv = Env & { MIGRATIONS: D1Migration[] };

declare module "cloudflare:test" {
	interface ProvidedEnv extends TestEnv {}
}
