/**
 * spotTerminalUiEs.test.ts — Tests for Spanish terminal formatter and UI labels.
 */
import { describe, it, expect } from "vitest";
import {
  formatLevelEs,
  formatSourceEs,
  formatTerminalLineEs,
  formatRawDetails,
  decisionStateEs,
  reasonCodeShortEs,
} from "../../../../client/src/components/spot/spotTerminalSpanishFormatter";

describe("Terminal Spanish formatter", () => {
  it("ES-1: formatLevelEs maps all known levels to Spanish", () => {
    expect(formatLevelEs("INFO")).toBe("Info");
    expect(formatLevelEs("MARKET")).toBe("Mercado");
    expect(formatLevelEs("SIGNAL")).toBe("Señal");
    expect(formatLevelEs("DECISION")).toBe("Decisión");
    expect(formatLevelEs("EXECUTION")).toBe("Ejecución");
    expect(formatLevelEs("SYSTEM")).toBe("Sistema");
    expect(formatLevelEs("ERROR")).toBe("Error");
  });

  it("ES-2: formatSourceEs maps known sources to Spanish", () => {
    expect(formatSourceEs("scan")).toBe("Scan");
    expect(formatSourceEs("strategy")).toBe("Estrategia");
    expect(formatSourceEs("intent")).toBe("Intención");
    expect(formatSourceEs("supervisor")).toBe("Supervisor");
    expect(formatSourceEs("exit")).toBe("Salida");
  });

  it("ES-3: formatTerminalLineEs produces natural Spanish line", () => {
    const line = formatTerminalLineEs({
      level: "MARKET",
      source: "scan",
      msg: "BTC/USD regime=BULLISH dir=UP",
      pair: "BTC/USD",
      mode: "SHADOW",
    });
    expect(line).toContain("Mercado");
    expect(line).toContain("Scan");
    expect(line).toContain("BTC/USD");
  });

  it("ES-4: formatRawDetails preserves original English technical details", () => {
    const raw = formatRawDetails({
      id: "line-001",
      ts: 1700000000000,
      level: "EXECUTION",
      source: "adapter",
      msg: "Entry executed for BTC/USD",
      pair: "BTC/USD",
      mode: "REAL",
    });
    expect(raw).toContain("EXECUTION");
    expect(raw).toContain("adapter");
    expect(raw).toContain("Entry executed");
  });
});

describe("Decision state and reason code Spanish mapping", () => {
  it("ES-5: decisionStateEs maps all states", () => {
    expect(decisionStateEs("WAITING")).toBe("En espera");
    expect(decisionStateEs("BLOCKED")).toBe("Bloqueado");
    expect(decisionStateEs("APPROVED")).toBe("Aprobado");
    expect(decisionStateEs("DISABLED")).toBe("Desactivado");
  });

  it("ES-6: reasonCodeShortEs maps common reason codes", () => {
    expect(reasonCodeShortEs("DATA_STALE")).toBe("Datos obsoletos");
    expect(reasonCodeShortEs("MACRO_BEARISH")).toBe("Macro bajista");
    expect(reasonCodeShortEs("REGIME_NOT_BULLISH_TREND")).toBe("Régimen no alcista");
    expect(reasonCodeShortEs("SIZING_REJECTED")).toBe("Sizing rechazado");
    expect(reasonCodeShortEs("PAIR_DISABLED_RACE_BLOCKED")).toBe("Par desactivado durante scan");
  });

  it("ES-7: reasonCodeShortEs returns original code for unknown", () => {
    expect(reasonCodeShortEs("UNKNOWN_CODE")).toBe("UNKNOWN_CODE");
  });

  it("ES-8: reasonCodeShortEs returns 'Sin señal' for null", () => {
    expect(reasonCodeShortEs(null)).toBe("Sin señal");
    expect(reasonCodeShortEs(undefined)).toBe("Sin señal");
  });
});
