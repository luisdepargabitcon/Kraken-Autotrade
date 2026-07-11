import { describe, it, expect } from "vitest";
import { getNaturalGridMessage, getNaturalGridTitle } from "../gridIsolated/gridActivityFormatter";

describe("gridActivityFormatter", () => {
  describe("getNaturalGridTitle", () => {
    it("devuelve título en español para eventos conocidos", () => {
      expect(getNaturalGridTitle("GRID_RANGE_PROPOSED")).toBe("Banda propuesta");
      expect(getNaturalGridTitle("GRID_RANGE_ACTIVATED")).toBe("Banda activada");
      expect(getNaturalGridTitle("GRID_SHADOW_NO_VIABLE_RANGE")).toBe("Rango no viable");
      expect(getNaturalGridTitle("GRID_LEVEL_FILLED")).toBe("Nivel ejecutado");
    });

    it("genera título legible para eventos GRID no mapeados", () => {
      expect(getNaturalGridTitle("GRID_UNKNOWN_EVENT")).toBe("Unknown event");
    });

    it("devuelve el eventType original para eventos no GRID", () => {
      expect(getNaturalGridTitle("SOME_OTHER")).toBe("SOME_OTHER");
    });
  });

  describe("getNaturalGridMessage", () => {
    it("procesa metadatos de GRID_RANGE_PROPOSED", () => {
      const msg = getNaturalGridMessage(
        "GRID_RANGE_PROPOSED",
        null,
        { levelsGenerated: 8, centerPrice: 94000, pair: "BTC/USD", regime: "lateral" }
      );
      expect(msg).toContain("8 niveles");
      expect(msg).toContain("94.000,00");
      expect(msg).toContain("BTC/USD");
      expect(msg).toContain("lateral");
    });

    it("devuelve mensaje humano para GRID_SHADOW_NO_VIABLE_RANGE", () => {
      const msg = getNaturalGridMessage(
        "GRID_SHADOW_NO_VIABLE_RANGE",
        null,
        { reason: "no_viable_range" }
      );
      expect(msg).toContain("no pudo generar un rango viable");
    });

    it("devuelve mensaje humano para eventos no mapeados", () => {
      const msg = getNaturalGridMessage("GRID_UNMAPPED", null, {});
      expect(msg).toContain("Evento Grid registrado");
    });
  });
});
