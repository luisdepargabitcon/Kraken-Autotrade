import { describe, it, expect } from "vitest";
import {
  formatNaturalMessageEs,
  reasonCodeShortEs,
  formatLevelEs,
  formatSourceEs,
  formatStatusEs,
} from "./spotTerminalSpanishFormatter";

describe("spotTerminalSpanishFormatter", () => {
  it("formatNaturalMessageEs: regime=TREND dir=BULLISH macro=BULLISH", () => {
    const line = {
      level: "MARKET" as const,
      source: "scan",
      msg: "regime=TREND dir=BULLISH macro=BULLISH dataHealth=GOOD",
      pair: "ETH/USD",
    };
    expect(formatNaturalMessageEs(line)).toBe(
      "ETH/USD: mercado en tendencia, dirección alcista y contexto macro alcista.",
    );
  });

  it("formatNaturalMessageEs: dataHealth=GOOD", () => {
    const line = {
      level: "INFO" as const,
      source: "pipeline",
      msg: "dataHealth=GOOD candles ready",
      pair: "BTC/USD",
    };
    const result = formatNaturalMessageEs(line);
    expect(result).toContain("Estado de datos");
    expect(result).not.toContain("dataHealth");
  });

  it("reasonCodeShortEs: MAX_LOTS_REACHED", () => {
    expect(reasonCodeShortEs("MAX_LOTS_REACHED")).toBe("Máximo de posiciones alcanzado");
  });

  it("reasonCodeShortEs: NO_SETUP_15M", () => {
    expect(reasonCodeShortEs("NO_SETUP_15M")).toBe("Sin configuración 15 min");
  });

  it("reasonCodeShortEs: SIZING_REJECTED", () => {
    expect(reasonCodeShortEs("SIZING_REJECTED")).toBe("Gestión de riesgo rechazada");
  });

  it("formatNaturalMessageEs: falls back to humanized Spanish, never raw English", () => {
    const line = { level: "INFO" as const, source: "engine", msg: "UNKNOWN_EVENT_CODE payload=123" };
    expect(formatNaturalMessageEs(line)).not.toContain("UNKNOWN_EVENT_CODE");
    expect(formatNaturalMessageEs(line)).toContain("Consulta el detalle técnico");
  });

  it("formatLevelEs translates known levels", () => {
    expect(formatLevelEs("EXECUTION")).toBe("Ejecución");
    expect(formatLevelEs("RISK")).toBe("Riesgo");
  });

  it("formatSourceEs translates known sources", () => {
    expect(formatSourceEs("shadow")).toBe("simulación");
    expect(formatSourceEs("supervisor")).toBe("supervisor");
  });

  it("formatStatusEs translates connection statuses", () => {
    expect(formatStatusEs("LIVE")).toBe("EN VIVO");
    expect(formatStatusEs("OFFLINE")).toBe("SIN CONEXIÓN");
  });
});
