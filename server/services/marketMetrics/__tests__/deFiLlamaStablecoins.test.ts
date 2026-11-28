import { describe, expect, it } from "vitest";
import { buildStablecoinMetricRecords } from "../providers/DeFiLlamaProvider";

const NOW = new Date("2026-01-02T00:00:00Z");
function asset(symbol: string, now: number, day: number, week = day) {
  return {
    symbol,
    circulating: { peggedUSD: now },
    circulatingPrevDay: { peggedUSD: day },
    circulatingPrevWeek: { peggedUSD: week },
  };
}

describe("buildStablecoinMetricRecords", () => {
  it("deduplica por activo y no suma dos veces la misma stablecoin", () => {
    const records = buildStablecoinMetricRecords([
      asset("USDT", 110, 100),
      asset("USDT", 110, 100),
      asset("USDC", 105, 100),
    ], NOW);
    const usdt = records.filter(r => r.asset === "USDT" && r.metric === "stablecoin_supply_delta_24h");
    const all = records.find(r => r.asset === "ALL" && r.metric === "stablecoin_supply_delta_24h");
    expect(usdt).toHaveLength(1);
    expect(usdt[0].value).toBeCloseTo(10, 6);
    expect(all?.meta.trackedCount).toBe(2);
    expect(all?.meta.totalCircNow).toBe(215);
  });

  it("marca extremos absolutos mayores que 10% como sospechosos sin lenguaje causal", () => {
    const records = buildStablecoinMetricRecords([asset("USDT", 120, 100)], NOW);
    const row = records.find(r => r.asset === "USDT" && r.metric === "stablecoin_supply_delta_24h");
    expect(row?.value).toBeCloseTo(20, 6);
    expect(row?.meta.suspiciousExtreme).toBe(true);
  });

  it("misma entrada produce misma salida", () => {
    const input = [asset("USDT", 101, 100), asset("USDC", 99, 100)];
    expect(buildStablecoinMetricRecords(input, NOW)).toEqual(buildStablecoinMetricRecords(input, NOW));
  });
});
