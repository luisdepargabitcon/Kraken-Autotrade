import { describe, expect, it } from "vitest";
import { computeOpenInterestDelta24hPct } from "../openInterestDelta";

const NOW = Date.UTC(2026, 0, 2, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
function snap(value: number, offsetMs: number, overrides: Record<string, unknown> = {}) {
  return { value, tsProviderMs: NOW - offsetMs, source: "binance", asset: "BTC", unit: "USDT", ...overrides } as any;
}
function evaluate(snaps: any[]) {
  return computeOpenInterestDelta24hPct(snaps, { nowMs: NOW, source: "binance", asset: "BTC", unit: "USDT" });
}

describe("computeOpenInterestDelta24hPct", () => {
  it("calcula +20%, -5% y 0% de forma determinista", () => {
    for (const [past, current, expected] of [[100, 120, 20], [100, 95, -5], [100, 100, 0]]) {
      const snaps = [snap(current, 0), snap(past, DAY)];
      const a = evaluate(snaps);
      const b = evaluate(snaps);
      expect(a.deltaPct).toBeCloseTo(expected, 8);
      expect(a).toEqual(b);
    }
  });
  it("usa el snapshot más cercano dentro de tolerancia y rechaza fuera de tolerancia", () => {
    const inside = evaluate([snap(120, 0), snap(90, DAY - 90 * 60_000)]);
    expect(inside.deltaPct).toBeCloseTo(33.33333333, 6);
    const outside = evaluate([snap(120, 0), snap(100, DAY + 3 * 60 * 60_000)]);
    expect(outside.state).toBe("missing");
  });
  it("missing sin histórico suficiente", () => {
    expect(evaluate([snap(100, 0)]).state).toBe("missing");
  });
  it("denominador cero o no finito no produce señal", () => {
    expect(evaluate([snap(100, 0), snap(0, DAY)]).state).toBe("invalid");
  });
  it("no mezcla fuente, activo ni unidad", () => {
    const mixed = [snap(120, 0), snap(100, DAY, { unit: "BTC" }), snap(100, DAY, { source: "coinglass" }), snap(100, DAY, { asset: "ETH" })];
    expect(evaluate(mixed).state).toBe("missing");
  });
});
