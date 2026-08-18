/**
 * spotTerminalStream — Real-time Spot engine terminal over WebSocket.
 *
 * Responsibilities:
 *   - In-memory ring buffer of last RING_BUFFER_SIZE lines (no DB).
 *   - emitSpotTerminal() called from SpotEngine scan, supervisor, readiness.
 *   - WebSocket server on /ws/spot-terminal.
 *   - Backfill last BACKFILL_LINES on connect.
 *   - Secret sanitization before any line reaches the wire.
 *   - Token auth via TERMINAL_TOKEN (same env var as /ws/logs).
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { log } from "../../utils/logger";

const WS_PATH = "/ws/spot-terminal";
const RING_BUFFER_SIZE = 500;
const BACKFILL_LINES = 100;
const HEARTBEAT_INTERVAL = 30_000;

// ── Sanitizer ─────────────────────────────────────────────────────────────────

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/[A-Za-z0-9+/]{40,}={0,2}/g, "***REDACTED_B64***"],
  [/(api[_-]?key|apikey|api[_-]?secret|secret|token|private[_-]?key)[=:\s"']+[^\s"',;&\]}{]+/gi, "$1=***"],
  [/([Rr][Pp][Aa][-\w]{20,})/g, "***REDACTED_KEY***"],
  [/([A-Z0-9]{20,})/g, "***REDACTED***"],
];

function sanitize(msg: string): string {
  let out = msg;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
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
    ts: Date.now(),
    level,
    source,
    msg: sanitize(rawMsg),
    pair: meta?.pair ?? null,
    mode: meta?.mode ?? null,
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

    this.wss.on("connection", (ws: WebSocket, req: any) => {
      const client = ws as WsClient;
      const clientIp: string = req.socket?.remoteAddress ?? "unknown";

      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const queryToken = url.searchParams.get("token");
      const authHeader: string | undefined = req.headers.authorization;
      const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      const token = queryToken ?? headerToken;

      const expectedToken = process.env.TERMINAL_TOKEN;

      if (!expectedToken) {
        log(`[WS-SPOT-TERMINAL] TERMINAL_TOKEN not configured — rejecting (ip: ${clientIp})`, "websocket");
        this.send(client, { type: "TERMINAL_ERROR", payload: { message: "TERMINAL_TOKEN not configured", reason: "TOKEN_NOT_CONFIGURED" } });
        client.close(4001, "Unauthorized");
        return;
      }

      if (!token || token !== expectedToken) {
        log(`[WS-SPOT-TERMINAL] Invalid or missing token — rejecting (ip: ${clientIp})`, "websocket");
        this.send(client, { type: "TERMINAL_ERROR", payload: { message: "Invalid or missing token", reason: "INVALID_TOKEN" } });
        client.close(4001, "Unauthorized");
        return;
      }

      client.isAlive = true;
      this.clients.add(client);

      log(`[WS-SPOT-TERMINAL] Client connected (ip: ${clientIp}). Total: ${this.clients.size}`, "websocket");

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

      client.on("pong", () => { client.isAlive = true; });
      client.on("close", () => {
        this.clients.delete(client);
        log(`[WS-SPOT-TERMINAL] Client disconnected. Total: ${this.clients.size}`, "websocket");
      });
      client.on("error", () => { this.clients.delete(client); });
    });

    this.startHeartbeat();
    log(`[WS-SPOT-TERMINAL] Initialized on ${WS_PATH}`, "websocket");
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
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss!.emit("connection", ws, req);
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
  }

  shutdown(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    for (const client of this.clients) {
      try { client.close(1001, "Server shutting down"); } catch { /* ignore */ }
    }
    if (this.wss) this.wss.close();
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
