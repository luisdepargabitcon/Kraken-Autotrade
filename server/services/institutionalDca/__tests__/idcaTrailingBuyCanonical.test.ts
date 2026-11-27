import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalReboundTriggerPrice,
  isCanonicalTrailingBuyExpired,
  resolveTrailingBuyCanonicalParams,
} from "../IdcaTrailingBuyCanonical";
import { TrailingBuyManager } from "../TrailingBuyManager";

const NOW = 1_699_999_200_000;

function staticInput(overrides: Record<string, unknown> = {}): any {
  return {
    pair: "BTC/USD",
    referencePrice: 111,
    referenceType: "test_reference",
    activationPrice: 106.68,
    currentPrice: 100,
    staticTrailingPct: 1,
    entryMode: "assisted_entry",
    requiredDistancePct: 4,
    drawdownFromReferencePct: 9.9,
    atrPct: 2,
    maxDurationMs: 60_000,
    nowMs: NOW,
    reason: "test",
    ...overrides,
  };
}

function armCanonical(params = resolveTrailingBuyCanonicalParams(staticInput())) {
  TrailingBuyManager.arm("BTC/USD", 111, 100, {
    trailingPct: 99,
    activationPrice: 106.68,
    canonicalParams: params,
  });
  return params;
}

describe("trailing buy canonical params", () => {
  beforeEach(() => {
    TrailingBuyManager.clearAll();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    TrailingBuyManager.clearAll();
  });

  it("static calcula una sola fuente coherentemente reutilizada", () => {
    const params = resolveTrailingBuyCanonicalParams(staticInput());
    expect(params).toEqual({
      minPrice: 100,
      effectiveThresholdPct: 1,
      mode: "static",
      reference: { price: 111, type: "test_reference" },
      maxExecutablePrice: 107.74680000000001,
      validUntil: NOW + 60_000,
      reason: "test",
    });
    expect(canonicalReboundTriggerPrice(params, 95)).toBeCloseTo(95.95);
    expect(isCanonicalTrailingBuyExpired(params, NOW + 59_999)).toBe(false);
    expect(isCanonicalTrailingBuyExpired(params, NOW + 60_000)).toBe(true);
  });

  it("rechaza referencias, umbrales o parámetros dinámicos inválidos", () => {
    expect(() => resolveTrailingBuyCanonicalParams(staticInput({ referencePrice: 0 }))).toThrow("invalid_trailing_buy_reference");
    expect(() => resolveTrailingBuyCanonicalParams(staticInput({ staticTrailingPct: NaN }))).toThrow("invalid_trailing_buy_threshold");
    expect(() => resolveTrailingBuyCanonicalParams(staticInput({ maxDurationMs: 0 }))).toThrow("invalid_trailing_buy_duration");
    expect(() => resolveTrailingBuyCanonicalParams(staticInput({ maxExecutablePrice: 0 }))).toThrow("invalid_trailing_buy_max_executable");
    expect(() => resolveTrailingBuyCanonicalParams(staticInput({
      entryMode: "dynamic_intelligent_entry",
      dynamicReboundConfig: { enabled: true },
    }))).toThrow("invalid_dynamic_trailing_buy_parameters");
  });

  it("dynamic usa modo dynamic y congela maxExecutablePrice del resolvedor dinámico", () => {
    const params = resolveTrailingBuyCanonicalParams(staticInput({
      entryMode: "dynamic_intelligent_entry",
      dynamicReboundConfig: {
        enabled: true,
        minReboundPct: 0.1,
        maxReboundPct: 1.2,
        reboundAtrMultiplier: 0.4,
        minRequiredDropRetentionRatio: 1,
        minActualDrawdownRetentionRatio: 0.5,
        antiOverextendedEnabled: true,
      },
    }));
    expect(params.mode).toBe("dynamic");
    expect(params.effectiveThresholdPct).toBeGreaterThan(0);
    expect(params.maxExecutablePrice).toBeLessThan(111);
    expect(params.validUntil).toBe(NOW + 60_000);
  });

  it("armar reutiliza los mismos parámetros y no crea contradicción estático/dinámico", () => {
    const params = armCanonical();
    const state = TrailingBuyManager.getState("BTC/USD")!;
    expect(state.trailingPct).toBe(params.effectiveThresholdPct);
    expect(state.maxExecutionPrice).toBe(params.maxExecutablePrice);
    expect(state.localLow).toBe(params.minPrice);
    expect(state.buyThreshold).toBe(106.68);
    expect(state.canonicalParams).toBe(params);
  });

  it("armLevel reutiliza canonicalParams sin mezclar el trailing técnico legado", () => {
    const params = resolveTrailingBuyCanonicalParams(staticInput({
      staticTrailingPct: 2,
      maxExecutablePrice: 108,
      forceStatic: true,
    }));
    TrailingBuyManager.armLevel("BTC/USD", 111, 106.68, 100, 1, {
      trailingMode: "rebound_pct",
      trailingValue: 99,
      maxExecutionPrice: 200,
      canonicalParams: params,
    });
    const state = TrailingBuyManager.getState("BTC/USD")!;
    expect(state.triggerLevel).toBe(1);
    expect(state.trailingPct).toBe(2);
    expect(state.maxExecutionPrice).toBe(108);
    expect(state.localLow).toBe(100);
    expect(state.canonicalParams).toBe(params);
  });

  it("armar dos veces es idempotente y no resetea el estado", () => {
    const params = armCanonical();
    const first = TrailingBuyManager.getState("BTC/USD")!;
    TrailingBuyManager.arm("BTC/USD", 111, 99, {
      activationPrice: 106.68,
      canonicalParams: params,
    });
    const second = TrailingBuyManager.getState("BTC/USD")!;
    expect(second.armedAt).toBe(first.armedAt);
    expect(second.localLow).toBe(first.localLow);
    expect(TrailingBuyManager.getAllStates()).toHaveLength(1);
  });

  it("precio por encima del máximo ejecutable rechaza sin desarmar", () => {
    armCanonical();
    TrailingBuyManager.update("BTC/USD", 95);
    const result = TrailingBuyManager.update("BTC/USD", 108);
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("price_above_max_executable");
    expect(TrailingBuyManager.isArmed("BTC/USD")).toBe(true);
  });

  it("disparo válido reserva un único trigger y confirmación lo consume una vez", () => {
    armCanonical();
    const first = TrailingBuyManager.update("BTC/USD", 101.5);
    const second = TrailingBuyManager.update("BTC/USD", 101.5);
    expect(first.triggered).toBe(true);
    expect(second.triggered).toBe(false);
    expect(second.reason).toBe("trigger_in_progress");
    TrailingBuyManager.confirmPendingTrigger("BTC/USD");
    expect(TrailingBuyManager.isArmed("BTC/USD")).toBe(false);
    expect(TrailingBuyManager.update("BTC/USD", 101.5).triggered).toBe(false);
  });

  it("rechazo temporal libera la reserva conservando el estado armado", () => {
    armCanonical();
    expect(TrailingBuyManager.update("BTC/USD", 101.5).triggered).toBe(true);
    TrailingBuyManager.releasePendingTrigger("BTC/USD");
    expect(TrailingBuyManager.isArmed("BTC/USD")).toBe(true);
    expect(TrailingBuyManager.update("BTC/USD", 101.5).triggered).toBe(true);
  });

  it("expiración cancela el trailing armado", () => {
    armCanonical();
    vi.setSystemTime(NOW + 60_000);
    const result = TrailingBuyManager.update("BTC/USD", 100);
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("expired");
    expect(TrailingBuyManager.isArmed("BTC/USD")).toBe(false);
  });

  it("reinicio simulado restaura estado válido y descarta expirado", () => {
    armCanonical();
    const snapshot = TrailingBuyManager.serializeState("BTC/USD")!;
    TrailingBuyManager.clearAll();
    expect(TrailingBuyManager.restoreState("BTC/USD", snapshot, NOW + 30_000)).toBe(true);
    expect(TrailingBuyManager.isArmed("BTC/USD")).toBe(true);

    TrailingBuyManager.clearAll();
    expect(TrailingBuyManager.restoreState("BTC/USD", snapshot, NOW + 60_000)).toBe(false);
    expect(TrailingBuyManager.isArmed("BTC/USD")).toBe(false);
  });

  it("legacy sin canonical conserva el golden: disparar desarma inmediatamente", () => {
    TrailingBuyManager.arm("BTC/USD", 111, 100, { trailingPct: 1 });
    const result = TrailingBuyManager.update("BTC/USD", 101.5);
    expect(result.triggered).toBe(true);
    expect(TrailingBuyManager.isArmed("BTC/USD")).toBe(false);
  });
});
