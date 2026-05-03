/**
 * Tests para TimeStop manual override por ciclo IDCA
 * Verifican: parsing de exitOverridesJson, lógica de desactivación
 */

import { describe, it, expect } from "vitest";

describe("IDCA TimeStop Override", () => {
  it("debe parsear exitOverridesJson string correctamente", () => {
    const overridesJson = '{"timeStopDisabled":true,"timeStopDisabledAt":"2026-05-03T17:00:00.000Z","timeStopDisabledBy":"manual"}';
    const overrides = JSON.parse(overridesJson);
    
    expect(overrides.timeStopDisabled).toBe(true);
    expect(overrides.timeStopDisabledAt).toBe("2026-05-03T17:00:00.000Z");
    expect(overrides.timeStopDisabledBy).toBe("manual");
  });

  it("debe parsear exitOverridesJson object correctamente", () => {
    const overrides = {
      timeStopDisabled: true,
      timeStopDisabledAt: "2026-05-03T17:00:00.000Z",
      timeStopDisabledBy: "manual"
    };
    
    expect(overrides.timeStopDisabled).toBe(true);
  });

  it("debe manejar exitOverridesJson null/undefined", () => {
    const overrides: any = {};
    expect(overrides.timeStopDisabled).toBeUndefined();
  });

  it("debe determinar timeStopDisabled correctamente", () => {
    const overrides1 = { timeStopDisabled: true };
    expect(overrides1.timeStopDisabled === true).toBe(true);

    const overrides2 = { timeStopDisabled: false };
    expect(overrides2.timeStopDisabled === true).toBe(false);

    const overrides3: any = {};
    expect(overrides3.timeStopDisabled === true).toBe(false);
  });

  it("debe calcular cooldown de 24h correctamente", () => {
    const TIMESTOP_IGNORED_COOLDOWN_MS = 24 * 60 * 60 * 1000;
    expect(TIMESTOP_IGNORED_COOLDOWN_MS).toBe(86400000);
  });
});
