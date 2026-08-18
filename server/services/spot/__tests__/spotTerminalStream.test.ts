import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitSpotTerminal, terminalWsServer, type TerminalLevel } from "../spotTerminalStream";

describe("spotTerminalStream", () => {
  beforeEach(() => {
    terminalWsServer.clearRingBufferForTest();
  });

  afterEach(() => {
    terminalWsServer.clearRingBufferForTest();
  });

  // ── Ring buffer ────────────────────────────────────────────────────────────

  it("1 — emitSpotTerminal stores line in ring buffer", () => {
    emitSpotTerminal("INFO", "scan", "Test message");
    const buf = terminalWsServer.getRingBuffer();
    expect(buf).toHaveLength(1);
    expect(buf[0].level).toBe("INFO");
    expect(buf[0].source).toBe("scan");
    expect(buf[0].msg).toBe("Test message");
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

  // ── Sanitizer ──────────────────────────────────────────────────────────────

  it("6 — long base64 strings are redacted", () => {
    const secret = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn";
    emitSpotTerminal("INFO", "scan", `key=${secret} loaded`);
    const [line] = terminalWsServer.getRingBuffer();
    expect(line.msg).not.toContain(secret);
    expect(line.msg).toContain("***");
  });

  it("7 — api_key patterns are sanitized", () => {
    emitSpotTerminal("INFO", "scan", "api_key=mysecretkey123 used");
    const [line] = terminalWsServer.getRingBuffer();
    expect(line.msg).not.toContain("mysecretkey123");
    expect(line.msg).toContain("***");
  });

  it("8 — short non-secret messages pass through unsanitized", () => {
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
  ])("9 — level '%s' is stored verbatim", (level) => {
    emitSpotTerminal(level, "test", `test-${level}`);
    const buf = terminalWsServer.getRingBuffer();
    const line = buf.find(l => l.msg === `test-${level}`);
    expect(line?.level).toBe(level);
  });

  // ── Broadcast ─────────────────────────────────────────────────────────────

  it("10 — broadcast does not throw when no clients connected", () => {
    expect(() => {
      emitSpotTerminal("INFO", "scan", "no clients test");
    }).not.toThrow();
  });

  it("11 — clearRingBufferForTest empties the buffer", () => {
    emitSpotTerminal("INFO", "scan", "before clear");
    terminalWsServer.clearRingBufferForTest();
    expect(terminalWsServer.getRingBuffer()).toHaveLength(0);
  });

  it("12 — multiple sources coexist in ring buffer", () => {
    emitSpotTerminal("INFO", "scan", "from scan");
    emitSpotTerminal("SUPERVISOR", "supervisor", "from supervisor");
    emitSpotTerminal("SYSTEM", "engine", "from engine");
    const buf = terminalWsServer.getRingBuffer();
    expect(buf).toHaveLength(3);
    expect(buf.map(l => l.source)).toEqual(["scan", "supervisor", "engine"]);
  });
});
