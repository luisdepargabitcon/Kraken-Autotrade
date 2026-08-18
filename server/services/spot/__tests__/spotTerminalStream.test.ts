import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "http";
import { WebSocket } from "ws";
import { emitSpotTerminal, generateTerminalTicket, terminalWsServer, type TerminalLevel } from "../spotTerminalStream";

describe("spotTerminalStream — unit tests", () => {
  beforeEach(() => {
    terminalWsServer.clearRingBufferForTest();
    process.env.TERMINAL_TOKEN = "test-token-for-unit";
  });

  afterEach(() => {
    terminalWsServer.clearRingBufferForTest();
    delete process.env.TERMINAL_TOKEN;
  });

  // ── Ring buffer ────────────────────────────────────────────────────────────

  it("1 — emitSpotTerminal stores line in ring buffer with UUID id", () => {
    emitSpotTerminal("INFO", "scan", "Test message");
    const buf = terminalWsServer.getRingBuffer();
    expect(buf).toHaveLength(1);
    expect(buf[0].level).toBe("INFO");
    expect(buf[0].source).toBe("scan");
    expect(buf[0].msg).toBe("Test message");
    expect(buf[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("2 — ring buffer trims to RING_BUFFER_SIZE (500)", () => {
    for (let i = 0; i < 510; i++) {
      emitSpotTerminal("INFO", "scan", `msg-${i}`);
    }
    const buf = terminalWsServer.getRingBuffer();
    expect(buf.length).toBe(500);
    expect(buf[0].msg).toBe("msg-10");
    expect(buf[buf.length - 1].msg).toBe("msg-509");
  });

  it("3 — each line has a numeric ts close to now", () => {
    const before = Date.now();
    emitSpotTerminal("SIGNAL", "scan", "setup detected", { pair: "BTC/USD" });
    const after = Date.now();
    const [line] = terminalWsServer.getRingBuffer();
    expect(line.ts).toBeGreaterThanOrEqual(before);
    expect(line.ts).toBeLessThanOrEqual(after);
  });

  it("4 — pair and mode metadata attached to line", () => {
    emitSpotTerminal("DECISION", "scan", "entry gated", { pair: "ETH/USD", mode: "SHADOW" });
    const [line] = terminalWsServer.getRingBuffer();
    expect(line.pair).toBe("ETH/USD");
    expect(line.mode).toBe("SHADOW");
  });

  it("5 — null pair / null mode when meta not provided", () => {
    emitSpotTerminal("SYSTEM", "engine", "mode changed");
    const [line] = terminalWsServer.getRingBuffer();
    expect(line.pair).toBeNull();
    expect(line.mode).toBeNull();
  });

  // ── UUID uniqueness ────────────────────────────────────────────────────────

  it("6 — each emitted line gets a unique UUID", () => {
    for (let i = 0; i < 100; i++) {
      emitSpotTerminal("INFO", "scan", `uniq-${i}`);
    }
    const buf = terminalWsServer.getRingBuffer();
    const ids = buf.map(l => l.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(100);
  });

  // ── Sanitizer ──────────────────────────────────────────────────────────────

  it("7 — long base64 strings are redacted", () => {
    const secret = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn";
    emitSpotTerminal("INFO", "scan", `key=${secret} loaded`);
    const [line] = terminalWsServer.getRingBuffer();
    expect(line.msg).not.toContain(secret);
    expect(line.msg).toContain("***");
  });

  it("8 — api_key patterns are sanitized", () => {
    emitSpotTerminal("INFO", "scan", "api_key=mysecretkey123 used");
    const [line] = terminalWsServer.getRingBuffer();
    expect(line.msg).not.toContain("mysecretkey123");
    expect(line.msg).toContain("***");
  });

  it("9 — Authorization Bearer header is redacted", () => {
    emitSpotTerminal("INFO", "scan", "Authorization: Bearer abc123def456ghi789jkl012mno345pqr789stu012");
    const [line] = terminalWsServer.getRingBuffer();
    expect(line.msg).not.toContain("abc123def456");
    expect(line.msg).toContain("***REDACTED***");
  });

  it("10 — password pattern is sanitized", () => {
    emitSpotTerminal("INFO", "scan", "password=supersecret used");
    const [line] = terminalWsServer.getRingBuffer();
    expect(line.msg).not.toContain("supersecret");
    expect(line.msg).toContain("***REDACTED***");
  });

  it("11 — short non-secret messages pass through unsanitized", () => {
    emitSpotTerminal("INFO", "scan", "scan started mode=SHADOW");
    const [line] = terminalWsServer.getRingBuffer();
    expect(line.msg).toBe("scan started mode=SHADOW");
  });

  // ── Level types ────────────────────────────────────────────────────────────

  it.each([
    ["INFO"] as [TerminalLevel],
    ["SIGNAL"] as [TerminalLevel],
    ["DECISION"] as [TerminalLevel],
    ["EXECUTION"] as [TerminalLevel],
    ["SUPERVISOR"] as [TerminalLevel],
    ["METADATA"] as [TerminalLevel],
    ["SYSTEM"] as [TerminalLevel],
    ["ERROR"] as [TerminalLevel],
  ])("12 — level '%s' is stored verbatim", (level) => {
    emitSpotTerminal(level, "test", `test-${level}`);
    const buf = terminalWsServer.getRingBuffer();
    const line = buf.find(l => l.msg === `test-${level}`);
    expect(line?.level).toBe(level);
  });

  // ── Broadcast ─────────────────────────────────────────────────────────────

  it("13 — broadcast does not throw when no clients connected", () => {
    expect(() => {
      emitSpotTerminal("INFO", "scan", "no clients test");
    }).not.toThrow();
  });

  it("14 — clearRingBufferForTest empties the buffer", () => {
    emitSpotTerminal("INFO", "scan", "before clear");
    terminalWsServer.clearRingBufferForTest();
    expect(terminalWsServer.getRingBuffer()).toHaveLength(0);
  });

  it("15 — multiple sources coexist in ring buffer", () => {
    emitSpotTerminal("INFO", "scan", "from scan");
    emitSpotTerminal("SUPERVISOR", "supervisor", "from supervisor");
    emitSpotTerminal("SYSTEM", "engine", "from engine");
    const buf = terminalWsServer.getRingBuffer();
    expect(buf).toHaveLength(3);
    expect(buf.map(l => l.source)).toEqual(["scan", "supervisor", "engine"]);
  });

  // ── Ticket auth ────────────────────────────────────────────────────────────

  it("16 — generateTerminalTicket returns null when TERMINAL_TOKEN not set", () => {
    delete process.env.TERMINAL_TOKEN;
    const ticket = generateTerminalTicket();
    expect(ticket).toBeNull();
  });

  it("17 — generateTerminalTicket returns a valid UUID when TERMINAL_TOKEN is set", () => {
    const ticket = generateTerminalTicket();
    expect(ticket).not.toBeNull();
    expect(ticket).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

// ── Integration tests with real HTTP+WS server ──────────────────────────────

describe("spotTerminalStream — WS integration", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    terminalWsServer.shutdown();
    terminalWsServer.clearRingBufferForTest();
    process.env.TERMINAL_TOKEN = "integration-test-token";
    server = createServer();
    terminalWsServer.initialize(server);

    // Wire upgrade handler BEFORE listening
    server.on("upgrade", (req, socket, head) => {
      const pathname = new URL(req.url || "", `http://${req.headers.host}`).pathname;
      if (pathname === "/ws/spot-terminal") {
        terminalWsServer.handleUpgrade(req, socket, head);
      } else {
        socket.destroy();
      }
    });

    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
  });

  afterEach(async () => {
    terminalWsServer.shutdown();
    await new Promise<void>(resolve => server.close(() => resolve()));
    delete process.env.TERMINAL_TOKEN;
  });

  function wsConnect(ticket?: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const url = `ws://127.0.0.1:${port}/ws/spot-terminal${ticket ? `?ticket=${ticket}` : ""}`;
      const ws = new WebSocket(url);
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
      ws.on("unexpected-response", (_req, res) => {
        reject(new Error(`Server responded with ${res.statusCode}`));
      });
      setTimeout(() => reject(new Error("WS connect timeout")), 5000);
    });
  }

  function connectAndCollect(ticket: string, expectedCount: number, timeoutMs = 5000): Promise<{ ws: WebSocket; messages: any[] }> {
    return new Promise((resolve, reject) => {
      const messages: any[] = [];
      const url = `ws://127.0.0.1:${port}/ws/spot-terminal?ticket=${encodeURIComponent(ticket)}`;
      const ws = new WebSocket(url);

      const handler = (data: any) => {
        try { messages.push(JSON.parse(data.toString())); } catch { /* ignore */ }
        if (messages.length >= expectedCount) {
          ws.off("message", handler);
          resolve({ ws, messages });
        }
      };

      ws.on("message", handler);
      ws.on("error", reject);
      ws.on("unexpected-response", (_req, res) => {
        reject(new Error(`Server responded with ${res.statusCode}`));
      });
      setTimeout(() => {
        ws.off("message", handler);
        if (messages.length > 0) {
          resolve({ ws, messages });
        } else {
          reject(new Error(`Message timeout — got ${messages.length}/${expectedCount} messages`));
        }
      }, timeoutMs);
    });
  }

  it("I1 — valid ticket connects and receives WS_STATUS + backfill", async () => {
    emitSpotTerminal("INFO", "scan", "pre-connect line");
    const ticket = generateTerminalTicket()!;
    const { ws, messages } = await connectAndCollect(ticket, 2);
    expect(messages[0].type).toBe("WS_STATUS");
    expect(messages[1].type).toBe("TERMINAL_HISTORY");
    expect(messages[1].payload.lines).toHaveLength(1);
    expect(messages[1].payload.lines[0].msg).toBe("pre-connect line");
    ws.close();
  });

  it("I2 — missing ticket → connection rejected with 4001", async () => {
    await expect(wsConnect()).rejects.toThrow();
  });

  it("I3 — invalid ticket → connection rejected", async () => {
    await expect(wsConnect("invalid-uuid-ticket")).rejects.toThrow();
  });

  it("I4 — expired ticket → connection rejected", async () => {
    const ticket = generateTerminalTicket()!;
    // Wait 31s? No — we simulate expiry by clearing the store
    terminalWsServer.clearRingBufferForTest(); // clears tickets too
    await expect(wsConnect(ticket)).rejects.toThrow();
  });

  it("I5 — single-use ticket: second connect with same ticket fails", async () => {
    const ticket = generateTerminalTicket()!;
    const ws1 = await wsConnect(ticket);
    ws1.close();
    // Ticket already consumed
    await expect(wsConnect(ticket)).rejects.toThrow();
  });

  it("I6 — live emit reaches connected client", async () => {
    const ticket = generateTerminalTicket()!;
    // Connect and collect initial WS_STATUS (1 message)
    const { ws, messages: initial } = await connectAndCollect(ticket, 1);
    expect(initial[0].type).toBe("WS_STATUS");

    // Emit a new line
    emitSpotTerminal("SIGNAL", "scan", "live signal test", { pair: "BTC/USD" });

    // Wait for the TERMINAL_LINE message
    const liveMsg = await new Promise<any>(resolve => {
      ws.on("message", (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === "TERMINAL_LINE") resolve(parsed);
        } catch { /* ignore */ }
      });
    });

    expect(liveMsg.type).toBe("TERMINAL_LINE");
    expect(liveMsg.payload.level).toBe("SIGNAL");
    expect(liveMsg.payload.msg).toBe("live signal test");
    expect(liveMsg.payload.pair).toBe("BTC/USD");
    expect(liveMsg.payload.id).toMatch(/^[0-9a-f-]{36}$/);

    ws.close();
  });

  it("I7 — secret in live emit is sanitized before reaching client", async () => {
    const ticket = generateTerminalTicket()!;
    const { ws } = await connectAndCollect(ticket, 1);

    const secret = "api_key=AKIAIOSFODNN7EXAMPLE123456";
    emitSpotTerminal("INFO", "scan", `Loaded ${secret}`);

    const liveMsg = await new Promise<any>(resolve => {
      ws.on("message", (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === "TERMINAL_LINE") resolve(parsed);
        } catch { /* ignore */ }
      });
    });

    expect(liveMsg.payload.msg).not.toContain("AKIAIOSFODNN7EXAMPLE123456");
    expect(liveMsg.payload.msg).toContain("***REDACTED***");

    ws.close();
  });
});
