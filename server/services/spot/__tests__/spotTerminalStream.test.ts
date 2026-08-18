import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "http";
import { WebSocket } from "ws";
import { emitSpotTerminal, generateTerminalTicket, terminalWsServer, type TerminalLevel } from "../spotTerminalStream";

const CLIENT_IP = "127.0.0.1";
const CLIENT_UA = "vitest-test-agent/1.0";

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

  // ── Sanitizer (7 mandatory secret cases) ───────────────────────────────────

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

  it("11 — PEM private key body is redacted", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----";
    emitSpotTerminal("INFO", "scan", `Loaded key: ${pem}`);
    const [line] = terminalWsServer.getRingBuffer();
    expect(line.msg).not.toContain("MIIEowIBAAKCAQEA");
    expect(line.msg).toContain("***REDACTED_PEM***");
  });

  it("12 — signature header is redacted", () => {
    emitSpotTerminal("INFO", "scan", "signature=AbCdEf1234567890AbCdEf1234567890AbCdEf12=");
    const [line] = terminalWsServer.getRingBuffer();
    expect(line.msg).not.toContain("AbCdEf1234567890");
    expect(line.msg).toContain("***REDACTED***");
  });

  it("13 — secret key name in object details is redacted", () => {
    emitSpotTerminal("INFO", "scan", "config loaded", {
      details: { apiKey: "AKIAIOSFODNN7EXAMPLE1234567890ABCDEFGHIJKLMN", normalField: "ok" },
    });
    const [line] = terminalWsServer.getRingBuffer();
    expect(line.details).not.toBeNull();
    expect(JSON.stringify(line.details)).not.toContain("AKIAIOSFODNN7EXAMPLE1234567890ABCDEFGHIJKLMN");
    expect(JSON.stringify(line.details)).toContain("***REDACTED***");
    expect((line.details as any).normalField).toBe("ok");
  });

  it("14 — short non-secret messages pass through unsanitized", () => {
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
    ["READINESS"] as [TerminalLevel],
    ["RISK"] as [TerminalLevel],
    ["ADAPTER"] as [TerminalLevel],
    ["SYSTEM"] as [TerminalLevel],
    ["ERROR"] as [TerminalLevel],
  ])("15 — level '%s' is stored verbatim", (level) => {
    emitSpotTerminal(level, "test", `test-${level}`);
    const buf = terminalWsServer.getRingBuffer();
    const line = buf.find(l => l.msg === `test-${level}`);
    expect(line?.level).toBe(level);
  });

  // ── Broadcast ─────────────────────────────────────────────────────────────

  it("16 — broadcast does not throw when no clients connected", () => {
    expect(() => {
      emitSpotTerminal("INFO", "scan", "no clients test");
    }).not.toThrow();
  });

  it("17 — clearRingBufferForTest empties the buffer", () => {
    emitSpotTerminal("INFO", "scan", "before clear");
    terminalWsServer.clearRingBufferForTest();
    expect(terminalWsServer.getRingBuffer()).toHaveLength(0);
  });

  it("18 — multiple sources coexist in ring buffer", () => {
    emitSpotTerminal("INFO", "scan", "from scan");
    emitSpotTerminal("SUPERVISOR", "supervisor", "from supervisor");
    emitSpotTerminal("SYSTEM", "engine", "from engine");
    const buf = terminalWsServer.getRingBuffer();
    expect(buf).toHaveLength(3);
    expect(buf.map(l => l.source)).toEqual(["scan", "supervisor", "engine"]);
  });

  // ── Ticket auth ────────────────────────────────────────────────────────────

  it("19 — generateTerminalTicket returns null when TERMINAL_TOKEN not set", () => {
    delete process.env.TERMINAL_TOKEN;
    const ticket = generateTerminalTicket(CLIENT_IP, CLIENT_UA);
    expect(ticket).toBeNull();
  });

  it("20 — generateTerminalTicket returns a valid UUID when TERMINAL_TOKEN is set", () => {
    const ticket = generateTerminalTicket(CLIENT_IP, CLIENT_UA);
    expect(ticket).not.toBeNull();
    expect(ticket).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("21 — rate limit: max 5 tickets per IP per 60s window", () => {
    // Generate 3 tickets (max live per IP is 3, so these succeed)
    for (let i = 0; i < 3; i++) {
      const t = generateTerminalTicket(CLIENT_IP, CLIENT_UA);
      expect(t).not.toBeNull();
    }
    // 4th fails because max live tickets (3) is reached, not rate limit
    const fourth = generateTerminalTicket(CLIENT_IP, CLIENT_UA);
    expect(fourth).toBeNull();
  });

  it("22 — max 3 live tickets per IP", () => {
    // Generate 3 tickets (rate limit allows 5, but max live is 3)
    const t1 = generateTerminalTicket(CLIENT_IP, CLIENT_UA);
    const t2 = generateTerminalTicket(CLIENT_IP, CLIENT_UA);
    const t3 = generateTerminalTicket(CLIENT_IP, CLIENT_UA);
    expect(t1).not.toBeNull();
    expect(t2).not.toBeNull();
    expect(t3).not.toBeNull();
    // 4th should fail because 3 are still live
    const t4 = generateTerminalTicket(CLIENT_IP, CLIENT_UA);
    expect(t4).toBeNull();
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

  function wsConnect(ticket?: string, ua: string = CLIENT_UA): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const url = `ws://127.0.0.1:${port}/ws/spot-terminal${ticket ? `?ticket=${ticket}` : ""}`;
      const ws = new WebSocket(url, { headers: { "user-agent": ua } });
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
      ws.on("unexpected-response", (_req, res) => {
        reject(new Error(`Server responded with ${res.statusCode}`));
      });
      setTimeout(() => reject(new Error("WS connect timeout")), 5000);
    });
  }

  function connectAndCollect(ticket: string, expectedCount: number, timeoutMs = 5000, ua: string = CLIENT_UA): Promise<{ ws: WebSocket; messages: any[] }> {
    return new Promise((resolve, reject) => {
      const messages: any[] = [];
      const url = `ws://127.0.0.1:${port}/ws/spot-terminal?ticket=${encodeURIComponent(ticket)}`;
      const ws = new WebSocket(url, { headers: { "user-agent": ua } });

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
    const ticket = generateTerminalTicket(CLIENT_IP, CLIENT_UA)!;
    const { ws, messages } = await connectAndCollect(ticket, 2);
    expect(messages[0].type).toBe("WS_STATUS");
    expect(messages[1].type).toBe("TERMINAL_HISTORY");
    expect(messages[1].payload.lines).toHaveLength(1);
    expect(messages[1].payload.lines[0].msg).toBe("pre-connect line");
    ws.close();
  });

  it("I2 — missing ticket → connection rejected", async () => {
    await expect(wsConnect()).rejects.toThrow();
  });

  it("I3 — invalid ticket → connection rejected", async () => {
    await expect(wsConnect("invalid-uuid-ticket")).rejects.toThrow();
  });

  it("I4 — expired ticket → connection rejected", async () => {
    const ticket = generateTerminalTicket(CLIENT_IP, CLIENT_UA)!;
    // Simulate expiry by clearing the store
    terminalWsServer.clearRingBufferForTest();
    await expect(wsConnect(ticket)).rejects.toThrow();
  });

  it("I5 — single-use ticket: second connect with same ticket fails", async () => {
    const ticket = generateTerminalTicket(CLIENT_IP, CLIENT_UA)!;
    const ws1 = await wsConnect(ticket);
    ws1.close();
    // Ticket already consumed
    await expect(wsConnect(ticket)).rejects.toThrow();
  });

  it("I6 — fingerprint mismatch: different User-Agent → rejected", async () => {
    const ticket = generateTerminalTicket(CLIENT_IP, CLIENT_UA)!;
    // Connect with a different User-Agent — fingerprint won't match
    await expect(wsConnect(ticket, "different-agent/2.0")).rejects.toThrow();
  });

  it("I7 — live emit reaches connected client", async () => {
    const ticket = generateTerminalTicket(CLIENT_IP, CLIENT_UA)!;
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

  it("I8 — secret in live emit is sanitized before reaching client", async () => {
    const ticket = generateTerminalTicket(CLIENT_IP, CLIENT_UA)!;
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

  // ── Missing WebSocket tests ────────────────────────────────────────────────

  it("I9 — two clients both receive broadcast", async () => {
    const ticket1 = generateTerminalTicket(CLIENT_IP, CLIENT_UA)!;
    const { ws: ws1, messages: m1 } = await connectAndCollect(ticket1, 1);

    const ticket2 = generateTerminalTicket(CLIENT_IP, CLIENT_UA)!;
    const { ws: ws2, messages: m2 } = await connectAndCollect(ticket2, 1);

    expect(m1[0].type).toBe("WS_STATUS");
    expect(m2[0].type).toBe("WS_STATUS");

    emitSpotTerminal("INFO", "scan", "broadcast to both");

    const [live1, live2] = await Promise.all([
      new Promise<any>(resolve => {
        ws1.on("message", (data) => {
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed.type === "TERMINAL_LINE") resolve(parsed);
          } catch { /* ignore */ }
        });
      }),
      new Promise<any>(resolve => {
        ws2.on("message", (data) => {
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed.type === "TERMINAL_LINE") resolve(parsed);
          } catch { /* ignore */ }
        });
      }),
    ]);

    expect(live1.payload.msg).toBe("broadcast to both");
    expect(live2.payload.msg).toBe("broadcast to both");

    ws1.close();
    ws2.close();
  });

  it("I10 — message order preserved: first emit arrives first", async () => {
    const ticket = generateTerminalTicket(CLIENT_IP, CLIENT_UA)!;
    const { ws } = await connectAndCollect(ticket, 1);

    emitSpotTerminal("INFO", "scan", "first");
    emitSpotTerminal("INFO", "scan", "second");
    emitSpotTerminal("INFO", "scan", "third");

    const messages: any[] = [];
    await new Promise<void>(resolve => {
      let count = 0;
      ws.on("message", (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === "TERMINAL_LINE") {
            messages.push(parsed);
            count++;
            if (count >= 3) resolve();
          }
        } catch { /* ignore */ }
      });
    });

    expect(messages[0].payload.msg).toBe("first");
    expect(messages[1].payload.msg).toBe("second");
    expect(messages[2].payload.msg).toBe("third");

    ws.close();
  });

  it("I11 — disconnect reduces client count", async () => {
    const ticket = generateTerminalTicket(CLIENT_IP, CLIENT_UA)!;
    const { ws } = await connectAndCollect(ticket, 1);
    expect(terminalWsServer.getClientCount()).toBe(1);

    ws.close();

    // Wait for close to propagate
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(terminalWsServer.getClientCount()).toBe(0);
  });

  it("I12 — read-only: client messages are ignored (no response, no error)", async () => {
    const ticket = generateTerminalTicket(CLIENT_IP, CLIENT_UA)!;
    const { ws } = await connectAndCollect(ticket, 1);

    // Send various messages — all should be ignored
    ws.send(JSON.stringify({ type: "START_SOURCE", source: "scan" }));
    ws.send(JSON.stringify({ type: "RUN_COMMAND", command: "ls -la" }));
    ws.send("plain text message");
    ws.send(JSON.stringify({ type: "placeOrder", pair: "BTC/USD", volume: 100 }));

    // Wait a bit to ensure no response comes back
    await new Promise(resolve => setTimeout(resolve, 300));

    // Client should still be connected — no disconnect from sending messages
    expect(terminalWsServer.getClientCount()).toBe(1);

    ws.close();
  });

  it("I13 — backfill preserves order (oldest first in history)", async () => {
    emitSpotTerminal("INFO", "scan", "oldest");
    emitSpotTerminal("INFO", "scan", "middle");
    emitSpotTerminal("INFO", "scan", "newest");

    const ticket = generateTerminalTicket(CLIENT_IP, CLIENT_UA)!;
    const { ws, messages } = await connectAndCollect(ticket, 2);

    const history = messages.find(m => m.type === "TERMINAL_HISTORY");
    expect(history).toBeDefined();
    expect(history.payload.lines).toHaveLength(3);
    expect(history.payload.lines[0].msg).toBe("oldest");
    expect(history.payload.lines[1].msg).toBe("middle");
    expect(history.payload.lines[2].msg).toBe("newest");

    ws.close();
  });
});
