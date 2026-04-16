import type { ServerResponse } from 'node:http';

/**
 * Server-Sent Events (SSE) broadcaster for real-time visualizer updates.
 *
 * Events emitted:
 *   task:created, task:updated, task:deleted,
 *   comment:created, comment:updated, comment:deleted,
 *   memory:created, memory:updated,
 *   spec:created, spec:updated
 */
export class EventBroadcaster {
  private clients: Set<ServerResponse> = new Set();

  /** Number of currently connected SSE clients. */
  get clientCount(): number {
    return this.clients.size;
  }

  /** Register an SSE client response and set up proper headers. */
  addClient(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send an initial comment to keep the connection alive
    res.write(':ok\n\n');

    this.clients.add(res);

    // Clean up when the client disconnects
    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  /** Remove an SSE client (called externally if needed). */
  removeClient(res: ServerResponse): void {
    this.clients.delete(res);
  }

  /**
   * Broadcast an event to all connected SSE clients.
   *
   * @param event - The event name (e.g. "task:created")
   * @param data  - The payload object; will be JSON-serialized
   */
  broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch {
        // Client probably disconnected; remove it
        this.clients.delete(client);
      }
    }
  }
}

/** Singleton broadcaster instance shared across the application. */
let _instance: EventBroadcaster | null = null;

export function getEventBroadcaster(): EventBroadcaster {
  if (!_instance) {
    _instance = new EventBroadcaster();
  }
  return _instance;
}

/**
 * Reset the singleton (useful for tests).
 */
export function resetEventBroadcaster(): void {
  _instance = null;
}
