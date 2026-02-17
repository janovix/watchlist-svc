/**
 * PEP Events SSE Endpoint
 * GET /pep/events/:searchId
 *
 * Establishes Server-Sent Events connection for real-time PEP search results
 */

import { Hono } from "hono";
import type { Bindings } from "../../index";

const app = new Hono<{ Bindings: Bindings }>();

/**
 * GET /pep/events/:searchId
 * Subscribe to SSE stream for PEP search results
 */
app.get("/:searchId", async (c) => {
	const searchId = c.req.param("searchId");

	if (!searchId) {
		return c.json({ error: "Missing searchId" }, 400);
	}

	if (!c.env.PEP_EVENTS_DO) {
		console.error("[PepEvents] PEP_EVENTS_DO binding not found");
		return c.json({ error: "PEP Events service not configured" }, 500);
	}

	try {
		// Get Durable Object instance for this searchId
		const id = c.env.PEP_EVENTS_DO.idFromName(searchId);
		const stub = c.env.PEP_EVENTS_DO.get(id);

		// Forward request to DO
		const url = new URL(c.req.url);
		url.pathname = "/subscribe";

		const response = await stub.fetch(url.toString(), {
			method: "GET",
			headers: c.req.raw.headers,
			signal: c.req.raw.signal,
		});

		// Return SSE stream
		return response;
	} catch (error) {
		console.error("[PepEvents] Error establishing SSE connection:", error);
		return c.json(
			{
				error: "Failed to establish SSE connection",
				details: String(error),
			},
			500,
		);
	}
});

export default app;
