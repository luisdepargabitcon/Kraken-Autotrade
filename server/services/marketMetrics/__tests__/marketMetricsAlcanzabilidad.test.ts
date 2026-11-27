import { describe, expect, it } from "vitest";
import { analyzeMarketMetricsAchievability } from "../marketMetricsAlcanzabilidad";

describe("analyzeMarketMetricsAchievability", () => {
  it("calcula score máximo y alcanzabilidad por conjunto y sensibilidad", () => {
    const rows = analyzeMarketMetricsAchievability();
    const row = (set: string, sensitivity: string) => rows.find(r => r.providerSet === set && r.sensitivity === sensitivity);
    expect(row("Binance Futures + DeFiLlama", "conservador")).toMatchObject({ maxRawScore: 5, maxScore: 4, bloquearReachable: false });
    expect(row("Binance Futures + DeFiLlama", "normal")).toMatchObject({ maxRawScore: 5, maxScore: 5, bloquearReachable: true });
    expect(row("Binance Futures", "agresivo")).toMatchObject({ maxRawScore: 3, maxScore: 4, bloquearReachable: false });
    expect(row("DeFiLlama", "agresivo")).toMatchObject({ maxRawScore: 2, maxScore: 3, bloquearReachable: false });
    expect(row("Todos los proveedores", "conservador")).toMatchObject({ maxRawScore: 11, maxScore: 8, bloquearReachable: true });
  });
});
