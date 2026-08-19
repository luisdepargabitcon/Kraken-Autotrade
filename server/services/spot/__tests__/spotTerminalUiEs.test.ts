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
  formatStatusEs,
  formatNaturalMessageEs,
} from "../../../../client/src/components/spot/spotTerminalSpanishFormatter";

describe("Terminal Spanish formatter", () => {
  it("ES-1: formatLevelEs maps all known levels to Spanish", () => {
    expect(formatLevelEs("INFO")).toBe("Información");
    expect(formatLevelEs("MARKET")).toBe("Mercado");
    expect(formatLevelEs("SIGNAL")).toBe("Señal");
    expect(formatLevelEs("DECISION")).toBe("Decisión");
    expect(formatLevelEs("EXECUTION")).toBe("Ejecución");
    expect(formatLevelEs("ADAPTER")).toBe("Adaptador");
    expect(formatLevelEs("READINESS")).toBe("Preparación REAL");
    expect(formatLevelEs("SYSTEM")).toBe("Sistema");
    expect(formatLevelEs("ERROR")).toBe("Error");
  });

  it("ES-2: formatSourceEs maps known sources to Spanish", () => {
    expect(formatSourceEs("scan")).toBe("análisis");
    expect(formatSourceEs("strategy")).toBe("estrategia");
    expect(formatSourceEs("intent")).toBe("intención");
    expect(formatSourceEs("supervisor")).toBe("supervisor");
    expect(formatSourceEs("exit")).toBe("salida");
    expect(formatSourceEs("shadow")).toBe("simulación");
    expect(formatSourceEs("real")).toBe("real");
    expect(formatSourceEs("toggle")).toBe("configuración de activo");
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
    expect(line).toContain("análisis");
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
    expect(reasonCodeShortEs("SIZING_REJECTED")).toBe("Gestión de riesgo rechazada");
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

describe("formatStatusEs: connection status Spanish mapping", () => {
  it("ES-9: formatStatusEs maps all known statuses", () => {
    expect(formatStatusEs("CONNECTING")).toBe("CONECTANDO");
    expect(formatStatusEs("LIVE")).toBe("EN VIVO");
    expect(formatStatusEs("PAUSED")).toBe("PAUSADO");
    expect(formatStatusEs("RECONNECTING")).toBe("RECONECTANDO");
    expect(formatStatusEs("NO_TOKEN")).toBe("NO DISPONIBLE");
    expect(formatStatusEs("OFFLINE")).toBe("SIN CONEXIÓN");
  });

  it("ES-10: formatStatusEs falls back to original for unknown", () => {
    expect(formatStatusEs("UNKNOWN" as any)).toBe("UNKNOWN");
  });
});

describe("formatNaturalMessageEs: natural Spanish message transformation", () => {
  it("ES-11: HOLD no setup → natural Spanish", () => {
    const msg = formatNaturalMessageEs({
      level: "DECISION", source: "strategy", msg: "HOLD — No setup detected",
      pair: "BTC/USD", mode: "SHADOW",
    });
    expect(msg).toContain("No compra BTC/USD");
    expect(msg).toContain("configuración válida");
  });

  it("ES-12: Entry executed → natural Spanish", () => {
    const msg = formatNaturalMessageEs({
      level: "EXECUTION", source: "adapter", msg: "Entry executed for BTC/USD",
      pair: "BTC/USD", mode: "REAL",
    });
    expect(msg).toContain("Entrada ejecutada");
    expect(msg).toContain("Posición abierta");
  });

  it("ES-13: regime/dir/macro → natural Spanish", () => {
    const msg = formatNaturalMessageEs({
      level: "MARKET", source: "scan", msg: "regime=TREND dir=BULLISH macro=BULLISH",
      pair: "BTC/USD", mode: "SHADOW",
    });
    expect(msg).toContain("tendencia");
    expect(msg).toContain("dirección");
    expect(msg).toContain("macro");
  });

  it("ES-14: Entry blocked → natural Spanish", () => {
    const msg = formatNaturalMessageEs({
      level: "DECISION", source: "intent", msg: "BLOCKED by gate",
      pair: "SOL/USD", mode: "SHADOW",
    });
    expect(msg).toContain("bloqueada");
    expect(msg).toContain("SOL/USD");
  });

  it("ES-15: Pending fill → natural Spanish", () => {
    const msg = formatNaturalMessageEs({
      level: "EXECUTION", source: "real", msg: "PENDING_FILL waiting",
      pair: "BTC/USD", mode: "REAL",
    });
    expect(msg).toContain("esperando confirmación");
  });

  it("ES-16: Supervisor completed with positions → natural Spanish", () => {
    const msg = formatNaturalMessageEs({
      level: "SUPERVISOR", source: "supervisor", msg: "supervisor completed positions=3",
      pair: null, mode: null,
    });
    expect(msg).toContain("supervisor");
    expect(msg).toContain("3 posiciones");
  });

  it("ES-17: Supervisor completed with 0 positions → natural Spanish", () => {
    const msg = formatNaturalMessageEs({
      level: "SUPERVISOR", source: "supervisor", msg: "supervisor completed positions=0",
      pair: null, mode: null,
    });
    expect(msg).toContain("No hay posiciones abiertas");
  });

  it("ES-18: Fallback returns humanized Spanish, never raw English", () => {
    const msg = formatNaturalMessageEs({
      level: "INFO", source: "system", msg: "Custom unknown event",
      pair: "BTC/USD", mode: null,
    });
    expect(msg).not.toBe("Custom unknown event");
    expect(msg).toContain("Evento del motor SPOT");
    expect(msg).toContain("BTC/USD");
    expect(msg).toContain("detalle técnico");
  });

  it("ES-18b: Fallback without pair returns generic Spanish", () => {
    const msg = formatNaturalMessageEs({
      level: "INFO", source: "system", msg: "Custom unknown event",
      pair: null, mode: null,
    });
    expect(msg).not.toBe("Custom unknown event");
    expect(msg).toContain("Evento del motor SPOT");
  });
});

describe("Market enum translation in formatNaturalMessageEs", () => {
  it("TERM_ES_MARKET_ENUMS_TRANSLATED: TREND/RANGE/TRANSITION/BULLISH/BEARISH/NEUTRAL translated", () => {
    const trend = formatNaturalMessageEs({
      level: "MARKET", source: "scan", msg: "regime=TREND dir=BULLISH macro=BULLISH",
      pair: "BTC/USD", mode: "SHADOW",
    });
    expect(trend).toContain("tendencia");
    expect(trend).toContain("alcista");
    expect(trend).not.toContain("TREND");
    expect(trend).not.toContain("BULLISH");

    const range = formatNaturalMessageEs({
      level: "MARKET", source: "scan", msg: "regime=RANGE dir=NEUTRAL macro=NEUTRAL",
      pair: "ETH/USD", mode: "SHADOW",
    });
    expect(range).toContain("rango");
    expect(range).toContain("neutral");

    const transition = formatNaturalMessageEs({
      level: "MARKET", source: "scan", msg: "regime=TRANSITION dir=BEARISH macro=BEARISH",
      pair: "SOL/USD", mode: "SHADOW",
    });
    expect(transition).toContain("transición");
    expect(transition).toContain("bajista");
    expect(transition).not.toContain("TRANSITION");
    expect(transition).not.toContain("BEARISH");
  });

  it("TERM_ES_NO_STREAM_VISIBLE: no 'Stream' or 'stream' in natural messages", () => {
    const scanMsg = formatNaturalMessageEs({
      level: "MARKET", source: "scan", msg: "scan started mode=SHADOW",
      pair: "BTC/USD", mode: "SHADOW",
    });
    expect(scanMsg.toLowerCase()).not.toContain("stream");
  });

  it("TERM_ES_UNKNOWN_EVENT_NO_RAW_ENGLISH: unrecognized event does not show raw English", () => {
    const msg = formatNaturalMessageEs({
      level: "INFO", source: "system", msg: "Some completely unknown technical event xyz",
      pair: "BTC/USD", mode: "REAL",
    });
    expect(msg).not.toContain("Some completely unknown");
    expect(msg).not.toContain("xyz");
    expect(msg).toContain("Evento");
  });

  it("TERM_ES_TECHNICAL_RAW_PRESERVED: formatRawDetails preserves original English", () => {
    const raw = formatRawDetails({
      id: "raw-001",
      ts: 1700000000000,
      level: "MARKET",
      source: "scan",
      msg: "regime=TREND dir=BULLISH macro=BULLISH",
      pair: "BTC/USD",
      mode: "SHADOW",
    });
    expect(raw).toContain("regime=TREND");
    expect(raw).toContain("dir=BULLISH");
    expect(raw).toContain("macro=BULLISH");
  });
});
