/**
 * spotTerminalStream — Real-time Spot engine terminal over WebSocket.
 *
 * R10.9 hardening (SAME_ORIGIN_EPHEMERAL_TICKET):
 *   - UUID v4 line IDs via randomUUID() for deduplication.
 *   - Recursive secret sanitization via buildSanitizedLine() — single entry point.
 *   - Ephemeral ticket-based WS auth — no permanent token in browser.
 *   - Ticket bound to fingerprint: client IP + User-Agent.
 *   - Same-origin verification on ticket issuance.
 *   - Rate-limit: max 5 tickets per IP per 60s window.
 *   - Max 3 live tickets per IP.
 *   - TTL 30s, single-use, expired ticket cleanup.
 *   - In-memory ring buffer of last RING_BUFFER_SIZE lines (no DB).
 *   - WebSocket server on /ws/spot-terminal.
 *   - Backfill last BACKFILL_LINES on connect.
 *   - Read-only: client messages are ignored (no action, no execution).
 *
 * TERMINAL_TICKET_AUTH=SAME_ORIGIN_EPHEMERAL_TICKET
 * No application-level user authentication exists in this codebase.
 */

import { randomUUID } from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";
import { log } from "../../utils/logger";

const WS_PATH = "/ws/spot-terminal";
const RING_BUFFER_SIZE = 500;
const BACKFILL_LINES = 100;
const HEARTBEAT_INTERVAL = 30_000;
const TICKET_TTL_MS = 30_000; // 30 seconds

// ── Same-origin ephemeral ticket store ─────────────────────────────────────────

interface TicketEntry {
  ticket: string;
  ip: string;
  fingerprint: string; // hash of IP + User-Agent
  origin: string; // validated same-origin
  createdAt: number;
  expiresAt: number;
}

const ticketStore = new Map<string, TicketEntry>();

// Rate-limit: max tickets per IP per window
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_TICKETS = 5;
const MAX_LIVE_TICKETS_PER_IP = 3;

const ipRateLimit = new Map<string, number[]>(); // IP -> timestamps of ticket issuances

// ── IP resolver — shared between HTTP ticket issuance and WS upgrade ───────────

/**
 * Resolve client IP consistently for both HTTP ticket issuance and WS upgrade.
 * Uses socket.remoteAddress directly — does NOT trust X-Forwarded-For without
 * explicit proxy configuration. Normalizes localhost variants.
 */
export function resolveTerminalClientIp(req: IncomingMessage): string {
  // If trust proxy is explicitly configured via env, use X-Forwarded-For
  const trustProxy = process.env.TRUST_PROXY === "true";
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.length > 0) {
      return xff.split(",")[0].trim();
    }
  }
  const raw = req.socket?.remoteAddress ?? "unknown";
  return normalizeIp(raw);
}

/**
 * Normalize localhost IP variants to a canonical form.
 */
export function normalizeIp(ip: string): string {
  if (ip === "::1" || ip === "::ffff:127.0.0.1" || ip === "127.0.0.1") {
    return "127.0.0.1";
  }
  return ip;
}

// ── Origin validation ─────────────────────────────────────────────────────────

/**
 * Validate that the Origin header matches the expected same-origin.
 * If PUBLIC_URL env is set, use it as the canonical allowed origin.
 * Otherwise, construct expected origin from the request's protocol + host.
 * Rejects null, undefined, and foreign origins.
 */
export function validateOrigin(origin: string | undefined, req: IncomingMessage): string | null {
  if (!origin || origin === "null") return null;

  // If PUBLIC_URL is configured, use it as the canonical allowed origin
  const publicUrl = process.env.PUBLIC_URL;
  if (publicUrl) {
    try {
      const parsed = new URL(publicUrl);
      const expectedOrigin = `${parsed.protocol}//${parsed.host}`;
      if (origin === expectedOrigin) return origin;
      return null;
    } catch {
      // Invalid PUBLIC_URL — fall through to request-based validation
    }
  }

  // Fallback: construct expected origin from request protocol + host
  const host = req.headers.host;
  if (!host) return null;

  // Determine protocol: trust X-Forwarded-Proto if trust proxy, else use socket
  const trustProxy = process.env.TRUST_PROXY === "true";
  const xForwardedProto = req.headers["x-forwarded-proto"];
  const protocol = (trustProxy && typeof xForwardedProto === "string" && xForwardedProto)
    ? xForwardedProto.split(",")[0].trim()
    : ((req.socket as any)?.encrypted ? "https" : "http");

  const expectedOrigin = `${protocol}://${host}`;
  if (origin === expectedOrigin) return origin;
  return null;
}

function computeFingerprint(ip: string, userAgent: string): string {
  // Simple hash — not cryptographic, just for binding ticket to client
  let hash = 0;
  const str = ip + "|" + userAgent;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

function countLiveTicketsForIp(ip: string): number {
  const now = Date.now();
  let count = 0;
  for (const entry of ticketStore.values()) {
    if (entry.ip === ip && entry.expiresAt > now) {
      count++;
    }
  }
  return count;
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = ipRateLimit.get(ip) ?? [];
  const recent = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_TICKETS) {
    ipRateLimit.set(ip, recent);
    return true;
  }
  recent.push(now);
  ipRateLimit.set(ip, recent);
  return false;
}

function cleanupExpiredRateLimits(): void {
  const now = Date.now();
  for (const [ip, timestamps] of ipRateLimit) {
    const recent = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
    if (recent.length === 0) {
      ipRateLimit.delete(ip);
    } else {
      ipRateLimit.set(ip, recent);
    }
  }
}

/**
 * Typed ticket generation result — distinguishes NOT_CONFIGURED from rate-limit.
 */
export type TicketResult =
  | { ok: true; ticket: string }
  | { ok: false; reason: "NOT_CONFIGURED" }
  | { ok: false; reason: "RATE_LIMITED" }
  | { ok: false; reason: "MAX_LIVE_TICKETS" }
  | { ok: false; reason: "ORIGIN_REJECTED" };

/**
 * Generate an ephemeral ticket for WS authentication.
 * The ticket is bound to the client's IP + User-Agent fingerprint AND validated origin.
 * The browser never sees the permanent TERMINAL_TOKEN.
 *
 * TERMINAL_TICKET_AUTH=SAME_ORIGIN_EPHEMERAL_TICKET
 */
export function generateTerminalTicket(clientIp: string, userAgent: string, origin?: string): string | null {
  const result = generateTerminalTicketTyped(clientIp, userAgent, origin);
  return result.ok ? result.ticket : null;
}

/**
 * Typed ticket generation — returns structured result for proper HTTP status codes.
 */
export function generateTerminalTicketTyped(clientIp: string, userAgent: string, origin?: string): TicketResult {
  const permanentToken = process.env.TERMINAL_TOKEN;
  if (!permanentToken) return { ok: false, reason: "NOT_CONFIGURED" };

  // Origin must be provided and valid (same-origin check)
  if (!origin || origin === "null") {
    log(`[WS-SPOT-TERMINAL] Origin missing or null — rejecting (ip: ${clientIp})`, "websocket");
    return { ok: false, reason: "ORIGIN_REJECTED" };
  }

  // Rate-limit check
  if (isRateLimited(clientIp)) {
    log(`[WS-SPOT-TERMINAL] Rate limit exceeded for IP: ${clientIp}`, "websocket");
    return { ok: false, reason: "RATE_LIMITED" };
  }

  // Max live tickets per IP
  if (countLiveTicketsForIp(clientIp) >= MAX_LIVE_TICKETS_PER_IP) {
    log(`[WS-SPOT-TERMINAL] Max live tickets exceeded for IP: ${clientIp}`, "websocket");
    return { ok: false, reason: "MAX_LIVE_TICKETS" };
  }

  const ticket = randomUUID();
  const fingerprint = computeFingerprint(clientIp, userAgent);
  const now = Date.now();
  ticketStore.set(ticket, { ticket, ip: clientIp, fingerprint, origin, createdAt: now, expiresAt: now + TICKET_TTL_MS });
  return { ok: true, ticket };
}

function validateAndConsumeTicket(ticket: string, clientIp: string, userAgent: string, origin?: string): boolean {
  const entry = ticketStore.get(ticket);
  if (!entry) return false;

  // Verify fingerprint matches
  const expectedFingerprint = computeFingerprint(clientIp, userAgent);
  if (entry.fingerprint !== expectedFingerprint) return false;

  // Verify origin matches (same-origin enforcement)
  if (origin !== entry.origin) {
    log(`[WS-SPOT-TERMINAL] Origin mismatch — ticket origin=${entry.origin}, ws origin=${origin}`, "websocket");
    return false;
  }

  // Check expiry
  if (Date.now() >= entry.expiresAt) {
    ticketStore.delete(ticket);
    return false;
  }

  // Single-use: consume the ticket
  ticketStore.delete(ticket);
  return true;
}

// Cleanup expired tickets periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ticketStore) {
    if (now >= entry.expiresAt) ticketStore.delete(key);
  }
  cleanupExpiredRateLimits();
}, 60_000).unref();

// ── Recursive Sanitizer ───────────────────────────────────────────────────────

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Authorization headers
  [/Authorization:\s*Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Authorization: Bearer ***REDACTED***"],
  [/Authorization:\s*[A-Za-z]+\s+[A-Za-z0-9\-._~+/]+=*/gi, "Authorization: ***REDACTED***"],
  // API keys, secrets, tokens, private keys, passphrases, passwords
  [/(api[_-]?key|apikey|api[_-]?secret|secret|token|private[_-]?key|passphrase|password)[=:\s"']+[^\s"',;&\]}{]+/gi, "$1=***REDACTED***"],
  // Revolut RPA keys
  [/([Rr][Pp][Aa][-\w]{20,})/g, "***REDACTED_KEY***"],
  // Revolut X signature headers
  [/(signature[=:\s]+[A-Za-z0-9+/=]{20,})/gi, "signature=***REDACTED***"],
  // PEM private key bodies
  [/(-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----)/g, "***REDACTED_PEM***"],
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
      // Also sanitize keys that look like secret field names
      const sanitizedKey = /secret|password|token|key|signature|credential/i.test(key) ? "***REDACTED***" : key;
      result[sanitizedKey] = sanitizeDeep((value as Record<string, unknown>)[key]);
    }
    return result as T;
  }
  return value;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type TerminalLevel =
  | "INFO"
  | "MARKET"
  | "SIGNAL"
  | "DECISION"
  | "EXECUTION"
  | "SUPERVISOR"
  | "METADATA"
  | "READINESS"
  | "RISK"
  | "ADAPTER"
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
  details?: Record<string, unknown> | null;
}

interface WsMessage {
  type: "TERMINAL_LINE" | "TERMINAL_HISTORY" | "WS_STATUS" | "TERMINAL_ERROR";
  payload: unknown;
}

interface WsClient extends WebSocket {
  isAlive: boolean;
}

// ── buildSanitizedLine — single entry point for sanitization ──────────────────

/**
 * Build a fully sanitized TerminalLine. This is the ONLY function that should
 * be used to construct lines for the ring buffer and broadcast.
 * Sanitization happens BEFORE ring buffer and broadcast — no bypass.
 */
function buildSanitizedLine(
  level: TerminalLevel,
  source: string,
  rawMsg: string,
  meta?: { pair?: string | null; mode?: string | null; details?: Record<string, unknown> | null },
): TerminalLine {
  return {
    id: randomUUID(),
    ts: Date.now(),
    level,
    source: sanitizeString(source),
    msg: sanitizeString(rawMsg),
    pair: meta?.pair ? sanitizeString(meta.pair) : null,
    mode: meta?.mode ? sanitizeString(meta.mode) : null,
    details: meta?.details ? sanitizeDeep(meta.details) : null,
  };
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
  meta?: { pair?: string | null; mode?: string | null; details?: Record<string, unknown> | null },
): void {
  const line = buildSanitizedLine(level, source, rawMsg, meta);
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
    log(`[WS-SPOT-TERMINAL] Initialized on ${WS_PATH} (SAME_ORIGIN_EPHEMERAL_TICKET auth)`, "websocket");
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const client = ws as WsClient;
    const clientIp = resolveTerminalClientIp(req);

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

    // Read-only: ignore all client messages (no action, no execution, no response)
    client.on("message", () => {
      // Intentionally empty — terminal is read-only.
      // Commands like START_SOURCE, RUN_COMMAND, placeOrder are ignored.
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

  handleUpgrade(req: IncomingMessage, socket: any, head: any): void {
    if (!this.wss) return;

    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const queryTicket = url.searchParams.get("ticket");
    const authHeader: string | undefined = req.headers.authorization;
    const headerTicket = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const ticket = queryTicket ?? headerTicket;
    const clientIp = resolveTerminalClientIp(req);
    const userAgent: string = req.headers["user-agent"] ?? "unknown";
    const wsOrigin: string | undefined = req.headers.origin as string | undefined;

    if (!ticket) {
      log(`[WS-SPOT-TERMINAL] No ticket provided — rejecting (ip: ${clientIp})`, "websocket");
      socket.write("HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n\r\n{\"error\":\"MISSING_TICKET\"}");
      socket.destroy();
      return;
    }

    if (!validateAndConsumeTicket(ticket, clientIp, userAgent, wsOrigin)) {
      log(`[WS-SPOT-TERMINAL] Invalid/expired/fingerprint/origin-mismatch ticket — rejecting (ip: ${clientIp})`, "websocket");
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
    ipRateLimit.clear();
  }

  clearTicketStoreOnlyForTest(): void {
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
