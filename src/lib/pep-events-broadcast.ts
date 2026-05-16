import type { Bindings } from "../index";

/**
 * Broadcast an event to all SSE subscribers for a search via PEP_EVENTS_DO.
 */
export async function broadcastPepEvent(
	env: Bindings,
	searchId: string,
	event: string,
	payload: Record<string, unknown>,
): Promise<{ ok: boolean; sent: number }> {
	if (!env.PEP_EVENTS_DO) {
		console.warn(`[PepEventsBroadcast] PEP_EVENTS_DO binding not configured`);
		return { ok: false, sent: 0 };
	}

	try {
		const id = env.PEP_EVENTS_DO.idFromName(searchId);
		const stub = env.PEP_EVENTS_DO.get(id);
		const response = await stub.fetch("http://pep-events/broadcast", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ event, payload }),
		});

		if (!response.ok) {
			console.error(
				`[PepEventsBroadcast] Broadcast failed: ${response.status}`,
				await response.text(),
			);
			return { ok: false, sent: 0 };
		}

		const broadcastResult = (await response.json()) as { sent: number };
		return { ok: true, sent: broadcastResult.sent };
	} catch (error) {
		console.error(`[PepEventsBroadcast] Failed to broadcast:`, error);
		return { ok: false, sent: 0 };
	}
}
