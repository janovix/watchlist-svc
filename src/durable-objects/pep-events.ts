/**
 * PepEventsDO - Durable Object for streaming PEP search results via Server-Sent Events (SSE)
 *
 * This DO manages SSE connections for real-time PEP search results.
 * Unlike ThreadEventsDO (which uses WebSocket), this uses HTTP streaming for simpler
 * unidirectional server-to-client communication.
 */

export class PepEventsDO implements DurableObject {
	private connections: Map<
		string,
		{
			writer: WritableStreamDefaultWriter<Uint8Array>;
			clientId: string;
		}
	> = new Map();

	constructor(
		private state: DurableObjectState,
		private env: Env,
	) {}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// Subscribe to SSE stream
		if (url.pathname === "/subscribe" && request.method === "GET") {
			return this.handleSSESubscription(request);
		}

		// Broadcast event to all connected clients
		if (url.pathname === "/broadcast" && request.method === "POST") {
			return this.handleBroadcast(request);
		}

		return new Response("Not found", { status: 404 });
	}

	/**
	 * Handle SSE subscription from client
	 */
	private handleSSESubscription(request: Request): Response {
		const { readable, writable } = new TransformStream<Uint8Array>();
		const writer = writable.getWriter();
		const encoder = new TextEncoder();

		// Generate unique client ID
		const clientId = crypto.randomUUID();

		// Send initial connection message
		writer
			.write(encoder.encode(": connected\n\n"))
			.catch((e) => console.error("Failed to send connection message:", e));

		// Store connection
		this.connections.set(clientId, { writer, clientId });

		console.log(
			`[PepEventsDO] Client ${clientId} connected. Total connections: ${this.connections.size}`,
		);

		// Clean up on disconnect (handle client closing connection)
		request.signal.addEventListener("abort", () => {
			this.connections.delete(clientId);
			writer.close().catch(() => {
				/* ignore */
			});
			console.log(
				`[PepEventsDO] Client ${clientId} disconnected. Remaining: ${this.connections.size}`,
			);
		});

		return new Response(readable, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"Access-Control-Allow-Origin": "*",
			},
		});
	}

	/**
	 * Broadcast event to all connected clients
	 */
	private async handleBroadcast(request: Request): Promise<Response> {
		try {
			const data = (await request.json()) as {
				event?: string;
				payload?: unknown;
			};
			const encoder = new TextEncoder();

			// Format SSE message
			// event: pep_results
			// data: {...}
			const eventType = data.event || "pep_results";
			const payload = data.payload || data;
			const message = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;

			let sent = 0;
			let failed = 0;

			// Broadcast to all connections
			const promises = Array.from(this.connections.entries()).map(
				async ([clientId, conn]) => {
					try {
						await conn.writer.write(encoder.encode(message));
						sent++;
					} catch (error) {
						console.error(
							`[PepEventsDO] Failed to send to ${clientId}:`,
							error,
						);
						// Remove dead connection
						this.connections.delete(clientId);
						failed++;
					}
				},
			);

			await Promise.all(promises);

			console.log(
				`[PepEventsDO] Broadcast complete. Sent: ${sent}, Failed: ${failed}, Remaining: ${this.connections.size}`,
			);

			return new Response(
				JSON.stringify({
					success: true,
					sent,
					failed,
					total_connections: this.connections.size,
				}),
				{
					headers: { "Content-Type": "application/json" },
				},
			);
		} catch (error) {
			console.error("[PepEventsDO] Broadcast error:", error);
			return new Response(
				JSON.stringify({
					success: false,
					error: String(error),
				}),
				{
					status: 500,
					headers: { "Content-Type": "application/json" },
				},
			);
		}
	}
}
