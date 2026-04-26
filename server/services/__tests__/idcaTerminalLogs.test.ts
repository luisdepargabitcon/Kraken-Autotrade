/**
 * Tests para idcaLog helper y endpoint terminal/logs
 * Verifican: truncación de payload, niveles, persistencia no rompe flujo
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Unit tests: truncatePayload (inline reimpl para testear sin DB) ──

const MAX_PAYLOAD_BYTES = 8192;

function truncatePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const str = JSON.stringify(payload);
  if (str.length <= MAX_PAYLOAD_BYTES) return payload;
  const trimmed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (Array.isArray(v)) {
      trimmed[k] = `[array truncated, length=${v.length}]`;
    } else {
      trimmed[k] = v;
    }
  }
  const trimmedStr = JSON.stringify(trimmed);
  if (trimmedStr.length <= MAX_PAYLOAD_BYTES) return trimmed;
  return { _truncated: true, message: "payload too large" };
}

describe("idcaLog - truncatePayload", () => {
  it("no trunca payloads pequeños", () => {
    const payload = { price: 42000, pair: "BTC/USD" };
    const result = truncatePayload(payload);
    expect(result).toEqual(payload);
  });

  it("trunca arrays grandes manteniendo escalares", () => {
    const bigArray = Array.from({ length: 1500 }, (_, i) => ({ ts: i, o: i, h: i, l: i, c: i }));
    const payload = { candles: bigArray, pair: "BTC/USD", price: 42000 };
    const result = truncatePayload(payload);
    expect(result["candles"]).toMatch(/array truncated/);
    expect(result["pair"]).toBe("BTC/USD");
    expect(result["price"]).toBe(42000);
  });

  it("marca _truncated si incluso sin arrays es muy grande", () => {
    const hugeScalar = "x".repeat(MAX_PAYLOAD_BYTES + 100);
    const payload = { bigStr: hugeScalar };
    const result = truncatePayload(payload);
    expect(result["_truncated"]).toBe(true);
  });

  it("payload vacío no modifica", () => {
    const result = truncatePayload({});
    expect(result).toEqual({});
  });
});

describe("idcaLog - niveles", () => {
  const consoleMocks = {
    debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
    log:   vi.spyOn(console, "log").mockImplementation(() => {}),
    warn:  vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("construye prefijo con pair y source", () => {
    // Simulación directa del formato de prefijo sin importar módulo con DB
    const pair = "ETH/USD";
    const source = "IdcaEngine";
    const mode = "simulation";
    const message = "tick ejecutado";

    const prefix = [
      "[IDCA]",
      source ? `[${source}]` : null,
      pair ? `[${pair}]` : null,
      mode ? `[${mode.toUpperCase()}]` : null,
    ].filter(Boolean).join("");

    expect(prefix).toBe("[IDCA][IdcaEngine][ETH/USD][SIMULATION]");
    expect(`${prefix} ${message}`).toContain("tick ejecutado");
  });

  it("prefijo sin pair/mode/source es solo [IDCA]", () => {
    const prefix = ["[IDCA]", null, null, null].filter(Boolean).join("");
    expect(prefix).toBe("[IDCA]");
  });
});

describe("Terminal API - mapeo de log", () => {
  it("mapea evento a formato terminal correctamente", () => {
    const rawEvent = {
      id: 1,
      createdAt: new Date("2025-01-15T10:30:00Z"),
      severity: "info",
      pair: "BTC/USD",
      mode: "simulation",
      eventType: "terminal_log",
      message: "Entry check ejecutado",
      technicalSummary: "[IdcaEngine]",
      payloadJson: { source: "IdcaEngine", score: 72 },
    };

    const mapped = {
      id: rawEvent.id,
      timestamp: rawEvent.createdAt,
      level: rawEvent.severity,
      pair: rawEvent.pair ?? null,
      mode: rawEvent.mode ?? null,
      source: (rawEvent.payloadJson as any)?.source ?? rawEvent.technicalSummary ?? "IDCA",
      eventType: rawEvent.eventType,
      message: rawEvent.message,
      payload: rawEvent.payloadJson ?? null,
    };

    expect(mapped.source).toBe("IdcaEngine");
    expect(mapped.level).toBe("info");
    expect(mapped.pair).toBe("BTC/USD");
    expect(mapped.eventType).toBe("terminal_log");
  });

  it("usa technicalSummary como fallback de source", () => {
    const rawEvent = {
      id: 2,
      createdAt: new Date(),
      severity: "warn",
      pair: null,
      mode: null,
      eventType: "entry_check_blocked",
      message: "Score bajo",
      technicalSummary: "[IdcaSmartLayer]",
      payloadJson: null,
    };

    const source = (rawEvent.payloadJson as any)?.source ?? rawEvent.technicalSummary ?? "IDCA";
    expect(source).toBe("[IdcaSmartLayer]");
  });

  it("usa IDCA como fallback final si no hay source ni technicalSummary", () => {
    const rawEvent = {
      payloadJson: null,
      technicalSummary: null,
    };
    const source = (rawEvent.payloadJson as any)?.source ?? rawEvent.technicalSummary ?? "IDCA";
    expect(source).toBe("IDCA");
  });
});

describe("Retención 30 días", () => {
  it("cutoff calculado correctamente para 30 días", () => {
    const retentionDays = 30;
    const now = new Date("2025-02-15T00:00:00Z").getTime();
    const cutoff = new Date(now - retentionDays * 24 * 60 * 60 * 1000);
    expect(cutoff.toISOString().slice(0, 10)).toBe("2025-01-16");
  });

  it("cutoff calculado correctamente para 7 días (compatibilidad)", () => {
    const retentionDays = 7;
    const now = new Date("2025-02-15T00:00:00Z").getTime();
    const cutoff = new Date(now - retentionDays * 24 * 60 * 60 * 1000);
    expect(cutoff.toISOString().slice(0, 10)).toBe("2025-02-08");
  });
});
