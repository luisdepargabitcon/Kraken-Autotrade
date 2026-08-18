/**
 * spotTerminalStream — Real-time Spot engine terminal over WebSocket.
 *
 * R10.9 hardening:
 *   - UUID v4 line IDs via randomUUID() for deduplication.
 *   - Recursive secret sanitization (objects, arrays, nested strings).
 *   - Ephemeral ticket-based WS auth — no permanent token in browser.
 *   - In-memory ring buffer of last RING_BUFFER_SIZE lines (no DB).
 *   - emitSpotTerminal() called from SpotEngine scan, supervisor, readiness.
 *   - WebSocket server on /ws/spot-terminal.
 *   - Backfill last BACKFILL_LINES on connect.
 */

import { randomUUID } from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { log } from "../../utils/logger";

const WS_PATH = "/ws/spot-terminal";
const RING_BUFFER_SIZE = 500;
const BACKFILL_LINES = 100;
const HEARTBEAT_INTERVAL = 30_000;
const TICKET_TTL_MS = 30_000; // 30 seconds

// ── Ephemeral ticket store ────────────────────────────────────────────────────

const ticketStore = new Map<string, { createdAt: number; expiresAt: number }>();

/**
 * Generate an ephemeral ticket for WS authentication.
 * The ticket is valid for TICKET_TTL_MS and can only be used once.
 * The browser never sees the permanent TERMINAL_TOKEN.
 */
export function generateTerminalTicket(): string | null {
  const permanentToken = process.env.TERMINAL_TOKEN;
  if (!permanentToken) return null;

  const ticket = randomUUID();
  const now = Date.now();
  ticketStore.set(ticket, { createdAt: now, expiresAt: now + TICKET_TTL_MS });
  return ticket;
}

function validateAndConsumeTicket(ticket: string): boolean {
  const entry = ticketStore.get(ticket);
  if (!entry) return false;
  ticketStore.delete(ticket); // single-use
  return Date.now() < entry.expiresAt;
}

// Cleanup expired tickets periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ticketStore) {
    if (now >= entry.expiresAt) ticketStore.delete(key);
  }
}, 60_000).unref();

// ── Recursive Sanitizer ───────────────────────────────────────────────────────

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Authorization headers
  [/Authorization:\s*Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Authorization: Bearer ***REDACTED***"],
  [/Authorization:\s*[A-Za-z]+\s+[A-Za-z0-9\-._~+/]+=*/gi, "Authorization: ***REDACTED***"],
  // API keys, secrets, tokens, private keys (key=value or key: value patterns)
  [/(api[_-]?key|apikey|api[_-]?secret|secret|token|private[_-]?key|passphrase|password)[=:\s"']+[^\s"',;&\]}{]+/gi, "$1=***REDACTED***"],
  // Revolut RPA keys
  [/([Rr][Pp][Aa][-\w]{20,})/g, "***REDACTED_KEY***"],
  // Base64-encoded private keys (40+ chars)
  [/[A-Za-z0-9+/]{40,}={0,2}/g, "***REDACTED_B64***"],
  // Long uppercase hex strings (potential API secrets)
  [/([A-F0-9]{32,})/g, "***REDACTED***"],
];

function sanitizeString(msg: string): string {
  let out = msg;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Recursively sanitize any value: strings, objects, arrays, nested structures.
 * Returns a deep-sanitized copy — never mutates the original.
 */
function sanitizeDeep<T>(value: T): T {
  if (typeof value === "string") return sanitizeString(value) as T;
  if (Array.isArray(value)) return value.map(sanitizeDeep) as T;
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      result[key] = sanitizeDeep((value as Record<string, unknown>)[key]);
    }
    return result as T;
  }
  return value;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type TerminalLevel =
  | "INFO"
  | "SIGNAL"
  | "DECISION"
  | "EXECUTION"
  | "SUPERVISOR"
  | "METADATA"
  | "SYSTEM"
  | "ERROR";

export interface TerminalLine {
  id: string;
  ts: number;
  level: TerminalLevel;
  source: string;
  msg: string;
  pair?: string | null;
  mode?: string | null;
}

interface WsMessage {
  type: "TERMINAL_LINE" | "TERMINAL_HISTORY" | "WS_STATUS" | "TERMINAL_ERROR";
  payload: unknown;
}

interface WsClient extends WebSocket {
  isAlive: boolean;
}

// ── Ring Buffer ───────────────────────────────────────────────────────────────

const ringBuffer: TerminalLine[] = [];

function pushLine(line: TerminalLine): void {
  ringBuffer.push(line);
  if (ringBuffer.length > RING_BUFFER_SIZE) ringBuffer.shift();
}

function getBackfill(): TerminalLine[] {
  return ringBuffer.slice(-BACKFILL_LINES);
}

// ── Public emitter (called from SpotEngine, readiness, etc.) ─────────────────

export function emitSpotTerminal(
  level: TerminalLevel,
  source: string,
  rawMsg: string,
  meta?: { pair?: string | null; mode?: string | null },
): void {
  const line: TerminalLine = {
    id: randomUUID(),
    ts: Date.now(),
    level,
    source,
    msg: sanitizeString(rawMsg),
    pair: meta?.pair ? sanitizeString(meta.pair) : null,
    mode: meta?.mode ? sanitizeString(meta.mode) : null,
  };

  pushLine(line);
  terminalWsServer.broadcast(line);
}

// ── WebSocket Server ──────────────────────────────────────────────────────────

class SpotTerminalWsServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WsClient> = new Set();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  initialize(server: Server): void {
    this.wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
    this.startHeartbeat();
    log(`[WS-SPOT-TERMINAL] Initialized on ${WS_PATH} (ephemeral ticket auth)`, "websocket");
  }

  private onConnection(ws: WebSocket, req: any): void {
    const client = ws as WsClient;
    const clientIp: string = req.socket?.remoteAddress ?? "unknown";

    client.isAlive = true;
    this.clients.add(client);

    log(`[WS-SPOT-TERMINAL] Client connected (ip: ${clientIp}). Total: ${this.clients.size}`, "websocket");

    // Defer status + backfill to next tick so client has time to attach message handlers
    process.nextTick(() => {
      if (client.readyState !== WebSocket.OPEN) return;

      // Status frame
      this.send(client, {
        type: "WS_STATUS",
        payload: { connectedAt: new Date().toISOString(), serverTime: new Date().toISOString(), path: WS_PATH },
      });

      // Backfill
      const history = getBackfill();
      if (history.length > 0) {
        this.send(client, { type: "TERMINAL_HISTORY", payload: { lines: history } });
      }
    });

    client.on("pong", () => { client.isAlive = true; });
    client.on("close", () => {
      this.clients.delete(client);
      log(`[WS-SPOT-TERMINAL] Client disconnected. Total: ${this.clients.size}`, "websocket");
    });
    client.on("error", () => { this.clients.delete(client); });
  }

  broadcast(line: TerminalLine): void {
    if (this.clients.size === 0) return;
    const msg = JSON.stringify({ type: "TERMINAL_LINE", payload: line });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(msg); } catch { /* ignore */ }
      }
    }
  }

  handleUpgrade(req: any, socket: any, head: any): void {
    if (!this.wss) return;

    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const queryTicket = url.searchParams.get("ticket");
    const authHeader: string | undefined = req.headers.authorization;
    const headerTicket = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const ticket = queryTicket ?? headerTicket;
    const clientIp: string = req.socket?.remoteAddress ?? "unknown";

    if (!ticket) {
      log(`[WS-SPOT-TERMINAL] No ticket provided — rejecting (ip: ${clientIp})`, "websocket");
      socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n\r\n{\"error\":\"MISSING_TICKET\"}");
      socket.destroy();
      return;
    }

    if (!validateAndConsumeTicket(ticket)) {
      log(`[WS-SPOT-TERMINAL] Invalid or expired ticket — rejecting (ip: ${clientIp})`, "websocket");
      socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n\r\n{\"error\":\"INVALID_TICKET\"}");
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.onConnection(ws, req);
    });
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getRingBuffer(): TerminalLine[] {
    return ringBuffer.slice();
  }

  clearRingBufferForTest(): void {
    ringBuffer.length = 0;
    ticketStore.clear();
  }

  shutdown(): void {
    if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = null; }
    for (const client of this.clients) {
      try { client.close(1001, "Server shutting down"); } catch { /* ignore */ }
    }
    this.clients.clear();
    if (this.wss) { this.wss.close(); this.wss = null; }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const client of this.clients) {
        if (!client.isAlive) {
          client.terminate();
          this.clients.delete(client);
          continue;
        }
        client.isAlive = false;
        client.ping();
      }
    }, HEARTBEAT_INTERVAL);
  }

  private send(client: WsClient, msg: WsMessage): void {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(JSON.stringify(msg)); } catch { /* ignore */ }
    }
  }
}

export const terminalWsServer = new SpotTerminalWsServer();
