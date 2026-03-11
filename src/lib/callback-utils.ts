/**
 * Utilities for constructing callback URLs used by async container tasks
 * (thread-svc) to call back to watchlist-svc after completing work.
 */

/**
 * Get the base callback URL for the current environment.
 * Used when spawning containers (PEP, adverse media, OFAC/UNSC/SAT69-B ingestion, etc.).
 */
export function getCallbackUrl(environment: string | undefined): string {
	switch (environment) {
		case "local":
			return "http://localhost:8787";
		case "dev":
		case "preview":
			return "https://watchlist-svc.janovix.workers.dev";
		case "production":
			return "https://watchlist-svc.janovix.com";
		default:
			// Default to dev for unknown environments
			return "https://watchlist-svc.janovix.workers.dev";
	}
}
