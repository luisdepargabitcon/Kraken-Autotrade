import { describe, expect, it } from "vitest";
import { MarketMetricsEngine } from "../MarketMetricsEngine";
import { DEFAULT_METRICS_CONFIG, METRIC_NAMES } from "../MarketMetricsTypes";
import { convertFundingRateFractionToPct } from "../providers/BinanceFuturesProvider";

const config = {
  ...DEFAULT_METRICS_CONFIG,
  enabled: true,
  mode: "activo" as const,
};
const context = { pair: "ETH/USD", side: "buy" as const };
const engine = new MarketMetricsEngine();

function evaluate(metrics: Record<string, number | null>, stale: Record<string, number>) {
  return engine.evaluate(context, metrics, config, stale);
}

describe("MarketMetricsEngine data quality", () => {
  it("sin métricas ok devuelve UNKNOWN y nunca texto favorable", () => {
    const decision = evaluate({}, {});
    expect(decision.status).toBe("UNKNOWN");
    expect(decision.available).toBe(false);
    expect(decision.reasons[0]).toBe("Datos de mercado insuficientes (no se evalúa)");
    expect(decision.reasons.join(" ")).not.toContain("favorables");
    expect(decision.score).toBe(0);
  });

  it("frescura desconocida nunca se trata como fresca", () => {
    const key = `${METRIC_NAMES.FUNDING_RATE}:ETH`;
    const decision = evaluate({ [key]: 0.2 }, {});
    expect(decision.status).toBe("UNKNOWN");
    expect(decision.dataQuality[key].state).toBe("unknown_age");
    expect(decision.score).toBe(0);
  });

  it("dato caducado no puntúa y queda stale", () => {
    const key = `${METRIC_NAMES.FUNDING_RATE}:ETH`;
    const decision = evaluate({ [key]: 0.2 }, { [key]: (config.stalenessMaxMs.funding ?? 9 * 60 * 60 * 1000) + 1 });
    expect(decision.dataQuality[key].state).toBe("stale");
    expect(decision.score).toBe(0);
  });

  it("NaN y ausencia son missing", () => {
    const key = `${METRIC_NAMES.FUNDING_RATE}:ETH`;
    const decision = evaluate({ [key]: Number.NaN }, { [key]: 1 });
    expect(decision.dataQuality[key].state).toBe("missing");
  });

  it("no usa fallback silencioso de BTC para funding ni netflow de ETH", () => {
    const metrics = {
      [`${METRIC_NAMES.FUNDING_RATE}:BTC`]: 0.2,
      [`${METRIC_NAMES.EXCHANGE_NETFLOW}:BTC`]: 500_000_000,
    };
    const stale = {
      [`${METRIC_NAMES.FUNDING_RATE}:BTC`]: 1,
      [`${METRIC_NAMES.EXCHANGE_NETFLOW}:BTC`]: 1,
    };
    const decision = evaluate(metrics, stale);
    expect(decision.status).toBe("UNKNOWN");
    expect(decision.details.scoreBreakdown.some(b => b.points > 0)).toBe(false);
  });

  it("usa solo variación derivada de open interest, nunca OI absoluto", () => {
    const absoluteKey = `${METRIC_NAMES.OPEN_INTEREST}:ETH`;
    const derivedKey = `${METRIC_NAMES.OPEN_INTEREST_DELTA_24H_PCT}:ETH`;
    const absoluteOnly = evaluate({ [absoluteKey]: 10_000_000_000 }, { [absoluteKey]: 1 });
    expect(absoluteOnly.score).toBe(0);
    const derived = evaluate({ [derivedKey]: 20 }, { [derivedKey]: 1 });
    expect(derived.dataQuality[derivedKey].state).toBe("ok");
    expect(derived.details.scoreBreakdown.find(b => b.metric === "open_interest_delta_24h_pct")?.points).toBe(1);
  });

  it("funding se compara en porcentaje y conserva signo en la razón", () => {
    expect(convertFundingRateFractionToPct(0.0001)).toBe(0.01);
    expect(convertFundingRateFractionToPct(0.0005)).toBe(0.05);
    expect(convertFundingRateFractionToPct(0.001)).toBe(0.1);
    const key = `${METRIC_NAMES.FUNDING_RATE}:ETH`;
    for (const [raw, expected] of [[0.0001, 0], [0.0005, 1], [0.001, 2]] as const) {
      const pct = convertFundingRateFractionToPct(raw);
      const decision = evaluate({ [key]: -pct }, { [key]: 1 });
      const row = decision.details.scoreBreakdown.find(b => b.metric === "funding_rate");
      expect(row?.points).toBe(expected);
      expect(row?.reason).toContain("negativo (shorts pagan)");
    }
  });

  it("liquidaciones BTC quedan marcadas como contexto de mercado", () => {
    const key = `${METRIC_NAMES.LIQUIDATIONS_1H_USD}:BTC`;
    const decision = evaluate({ [key]: 200_000_000 }, { [key]: 1 });
    const row = decision.details.scoreBreakdown.find(b => b.metric === "liquidations_1h_usd");
    expect(row?.scope).toBe("BTC_MARKET_CONTEXT");
  });

  it("extremo de stablecoins es invalid y no puntúa", () => {
    const key = `${METRIC_NAMES.STABLECOIN_SUPPLY_DELTA_24H}:ALL`;
    const decision = evaluate({ [key]: -15 }, { [key]: 1 });
    expect(decision.dataQuality[key].state).toBe("invalid");
    expect(decision.score).toBe(0);
  });
});
