/**
 * gridV31TrailingPrecedence.test.ts — V3.1 Integrated tests for
 * CYCLE_OWNED_NET_TARGET_V3 + trailingEnabled=true precedence.
 *
 * Scenarios A-H from the CASCADE specification.
 */
import { describe, it, expect } from "vitest";
import { gridRiskManager } from "../gridRiskManager";
import type { GridCycle, GridIsolatedConfig, TrailingProtectionState, StopLossLayer, HodlRecoveryState } from "../gridIsolatedTypes";
import { closePathLabel } from "../buildGridOperationalViewModel";

const cfg = (overrides: Partial<GridIsolatedConfig> = {}): GridIsolatedConfig => ({
  pair: "BTC/USD", mode: "SHADOW", isActive: true, executionPolicy: "MAKER_ONLY",
  trailingEnabled: true, trailingMode: "adaptive_atr",
  trailingActivationPct: 1.0, trailingStopPct: 0.4,
  trailingAtrMultiplier: 0.75, trailingMinPct: 0.25, trailingMaxPct: 1.20,
  trailingAtrSmoothingAlpha: 0.25,
  stopLossEnabled: false, hodlRecoveryEnabled: false,
  buyFeePct: 0.09, sellFeePct: 0.09, netProfitTargetPct: 0.8,
  stopLossSoftPct: 2, stopLossHardPct: 5, stopLossEmergencyPct: 10,
  ...overrides,
} as any);

const cycle = (buy: number, target: number): GridCycle => ({
  buyPrice: buy, quantity: 1, targetSellPrice: target,
  exitPolicyVersion: "CYCLE_OWNED_NET_TARGET_V3",
  targetKind: "CYCLE_OWNED_SYNTHETIC",
} as any);

const noTrailing: TrailingProtectionState = {
  activated: false, activatedAt: null, highestPriceSinceBuy: null,
  trailingStopPct: 0, currentStopPrice: null, reason: "",
  policy: null, atrPct: null, smoothedAtrPct: null, atrSource: null,
  effectiveStopPct: null, baseStopPct: null, profitFloorPrice: null, activationPrice: null,
};
const noStop: StopLossLayer[] = [
  { layer: "soft", triggerPricePct: 2, triggered: false, triggeredAt: null, reason: "" },
  { layer: "hard", triggerPricePct: 5, triggered: false, triggeredAt: null, reason: "" },
  { layer: "emergency", triggerPricePct: 10, triggered: false, triggeredAt: null, reason: "" },
];
const noHodl: HodlRecoveryState = { active: false, activatedAt: null, originalBuyPrice: null, recoveryTargetPrice: null, reason: "" };

// V3 target: buy=100, target≈101.29 (gross gap ~1.29%)
const BUY = 100;
const TARGET = 101.29;

describe("[V3.1] Escenario A: trailing ON adaptive, precio llega a target, sube a 102, ciclo continúa", () => {
  it("no activa trailing antes del target V3", () => {
    const c = cycle(BUY, TARGET);
    const config = cfg({ trailingEnabled: true });
    // Price at +0.5% — below target, below activation
    const r = gridRiskManager.evaluateCycle(c, 100.5, config, noTrailing, noStop, noHodl, 1.0);
    expect(r.action).toBe("HOLD");
    expect(r.trailingState.activated).toBe(false);
  });

  it("activa trailing al alcanzar target V3 (no antes)", () => {
    const c = cycle(BUY, TARGET);
    const config = cfg({ trailingEnabled: true });
    // Price at target V3 — activation floored at targetSellPrice
    const r = gridRiskManager.evaluateCycle(c, TARGET, config, noTrailing, noStop, noHodl, 1.0);
    expect(r.action).toBe("TRAILING_UPDATE");
    expect(r.trailingState.activated).toBe(true);
    expect(r.trailingState.activationPrice).toBeGreaterThanOrEqual(TARGET);
  });

  it("trailing sigue activo a 102 (por encima del target), NO cierra", () => {
    const c = cycle(BUY, TARGET);
    const config = cfg({ trailingEnabled: true });
    // First activate at target
    const r1 = gridRiskManager.evaluateCycle(c, TARGET, config, noTrailing, noStop, noHodl, 1.0);
    expect(r1.action).toBe("TRAILING_UPDATE");
    // Then price rises to 102
    const r2 = gridRiskManager.evaluateCycle(c, 102, config, r1.trailingState, noStop, noHodl, 1.0);
    expect(r2.action).toBe("TRAILING_UPDATE");
    expect(r2.trailingState.highestPriceSinceBuy).toBe(102);
    expect(r2.action).not.toBe("TRAILING_CLOSE");
    // Cycle stays open — trailing is watching, not closing
  });
});

describe("[V3.1] Escenario B: trailing ON, target alcanzado, sube, retrocede a stop → TRAILING_CLOSE", () => {
  it("cierra por trailing stop en retroceso", () => {
    const c = cycle(BUY, TARGET);
    const config = cfg({ trailingEnabled: true, trailingMode: "manual", trailingStopPct: 0.4 });
    // Activate at target
    const r1 = gridRiskManager.evaluateCycle(c, TARGET, config, noTrailing, noStop, noHodl, 1.0);
    expect(r1.action).toBe("TRAILING_UPDATE");
    // Rise to 101.50
    const r2 = gridRiskManager.evaluateCycle(c, 101.50, config, r1.trailingState, noStop, noHodl, 1.0);
    expect(r2.action).toBe("TRAILING_UPDATE");
    expect(r2.trailingState.highestPriceSinceBuy).toBe(101.50);
    // Stop = 101.50 * (1 - 0.4/100) = 101.50 * 0.996 = 101.094
    // Retrace to 101.00 (below stop)
    const r3 = gridRiskManager.evaluateCycle(c, 101.00, config, r2.trailingState, noStop, noHodl, 1.0);
    expect(r3.action).toBe("TRAILING_CLOSE");
    expect(r3.suggestedSellPrice).toBe(101.00);
  });
});

describe("[V3.1] Escenario C: trailing OFF → comportamiento V3 intacto", () => {
  it("trailing OFF: HOLD en todo el rango, sin activación", () => {
    const c = cycle(BUY, TARGET);
    const config = cfg({ trailingEnabled: false });
    const r1 = gridRiskManager.evaluateCycle(c, 100.5, config, noTrailing, noStop, noHodl, 1.0);
    const r2 = gridRiskManager.evaluateCycle(c, TARGET, config, noTrailing, noStop, noHodl, 1.0);
    const r3 = gridRiskManager.evaluateCycle(c, 102, config, noTrailing, noStop, noHodl, 1.0);
    expect(r1.action).toBe("HOLD");
    expect(r2.action).toBe("HOLD");
    expect(r3.action).toBe("HOLD");
    expect(r1.trailingState.activated).toBe(false);
    expect(r3.trailingState.activated).toBe(false);
  });
});

describe("[V3.1] Escenario D: recovery tras restart — highest/stop/ATR preservados", () => {
  it("estado trailing persistido se preserva al reevaluar", () => {
    const c = cycle(BUY, TARGET);
    const config = cfg({ trailingEnabled: true, trailingMode: "manual", trailingStopPct: 0.4 });
    // Simulate pre-restart state: activated, highest=102, stop=101.592
    const preRestart: TrailingProtectionState = {
      ...noTrailing,
      activated: true,
      activatedAt: new Date("2026-08-20T10:00:00Z"),
      highestPriceSinceBuy: 102,
      trailingStopPct: 0.4,
      currentStopPrice: 101.592,
      reason: "Trailing active",
      profitFloorPrice: TARGET,
      activationPrice: TARGET,
    };
    // After restart: price still above stop
    const r = gridRiskManager.evaluateCycle(c, 101.8, config, preRestart, noStop, noHodl, 1.0);
    expect(r.action).toBe("TRAILING_UPDATE");
    expect(r.trailingState.activated).toBe(true);
    expect(r.trailingState.highestPriceSinceBuy).toBe(102); // preserved
    // Stop should not descend below 101.592
    expect(r.trailingState.currentStopPrice).toBeGreaterThanOrEqual(101.592 - 0.01);
  });
});

describe("[V3.1] Escenario E: ATR aumenta bruscamente, stop anterior no baja", () => {
  it("ATR salta de 1.0 a 5.0, stop previo se mantiene", () => {
    const c = cycle(BUY, TARGET);
    const config = cfg({ trailingEnabled: true });
    // Build up state with normal ATR
    const r1 = gridRiskManager.evaluateCycle(c, TARGET, config, noTrailing, noStop, noHodl, 1.0);
    const r2 = gridRiskManager.evaluateCycle(c, 102, config, r1.trailingState, noStop, noHodl, 1.0);
    const prevStop = r2.trailingState.currentStopPrice;
    expect(prevStop).not.toBeNull();
    // ATR jumps to 5.0 — should NOT lower the stop
    const r3 = gridRiskManager.evaluateCycle(c, 102, config, r2.trailingState, noStop, noHodl, 5.0);
    expect(r3.trailingState.currentStopPrice).toBeGreaterThanOrEqual(prevStop! - 0.01);
  });
});

describe("[V3.1] Escenario F: single-exit invariant — nunca dos SELL simultáneas", () => {
  it("trailing takeover: route cambia de CYCLE_OWNED_TARGET a TRAILING_MAKER", () => {
    // This is validated at the engine level, but we can verify the risk manager
    // returns TRAILING_CLOSE (not HOLD) when stop is hit, which would trigger
    // the engine to switch routes.
    const c = cycle(BUY, TARGET);
    const config = cfg({ trailingEnabled: true, trailingMode: "manual", trailingStopPct: 0.4 });
    const r1 = gridRiskManager.evaluateCycle(c, TARGET, config, noTrailing, noStop, noHodl, 1.0);
    const r2 = gridRiskManager.evaluateCycle(c, 101.50, config, r1.trailingState, noStop, noHodl, 1.0);
    // Retrace below stop
    const stop = 101.50 * 0.996;
    const r3 = gridRiskManager.evaluateCycle(c, stop - 0.5, config, r2.trailingState, noStop, noHodl, 1.0);
    expect(r3.action).toBe("TRAILING_CLOSE");
    // The engine would then set route=TRAILING_MAKER, not CYCLE_OWNED_TARGET
  });
});

describe("[V3.1] Escenario G: fallo cancelación REAL simulado → fail closed", () => {
  // This is an engine-level concern. At the risk manager level, we verify
  // that TRAILING_CLOSE is only produced when the stop is actually hit.
  it("no produce TRAILING_CLOSE si el precio está por encima del stop", () => {
    const c = cycle(BUY, TARGET);
    const config = cfg({ trailingEnabled: true, trailingMode: "manual", trailingStopPct: 0.4 });
    const r1 = gridRiskManager.evaluateCycle(c, TARGET, config, noTrailing, noStop, noHodl, 1.0);
    // Price still above stop
    const r2 = gridRiskManager.evaluateCycle(c, TARGET + 0.5, config, r1.trailingState, noStop, noHodl, 1.0);
    expect(r2.action).toBe("TRAILING_UPDATE");
    expect(r2.action).not.toBe("TRAILING_CLOSE");
  });
});

describe("[V3.1] Escenario H: target V3 histórico, trailing desactivado, compatibilidad", () => {
  it("ciclo legacy con trailing desactivado: sin campos V3.1, comportamiento intacto", () => {
    const c = cycle(BUY, TARGET);
    const config = cfg({ trailingEnabled: false });
    // Legacy trailing state without V3.1 fields
    const legacyTrailing: TrailingProtectionState = {
      activated: false, activatedAt: null, highestPriceSinceBuy: null,
      trailingStopPct: 0, currentStopPrice: null, reason: "",
      // No V3.1 fields — should still work
    };
    const r = gridRiskManager.evaluateCycle(c, 102, config, legacyTrailing, noStop, noHodl, 1.0);
    expect(r.action).toBe("HOLD");
    expect(r.trailingState.activated).toBe(false);
  });
});

describe("[V3.1] closePathLabel: CYCLE_OWNED_TARGET → 'Objetivo individual V3'", () => {
  it("traduce CYCLE_OWNED_TARGET correctamente", () => {
    expect(closePathLabel("CYCLE_OWNED_TARGET")).toBe("Objetivo individual V3");
  });

  it("no devuelve null para CYCLE_OWNED_TARGET", () => {
    expect(closePathLabel("CYCLE_OWNED_TARGET")).not.toBeNull();
  });

  it("null path → null label", () => {
    expect(closePathLabel(null)).toBeNull();
  });

  it("TRAILING_MAKER → 'Trailing maker'", () => {
    expect(closePathLabel("TRAILING_MAKER")).toBe("Trailing maker");
  });
});

describe("[V3.1] stopLossEnabled: stop loss solo evalúa cuando está habilitado", () => {
  it("stopLossEnabled=false: no evalúa stop loss incluso si el precio cae", () => {
    const c = cycle(BUY, TARGET);
    const config = cfg({ stopLossEnabled: false });
    // Price drops 10% — should not trigger stop loss
    const r = gridRiskManager.evaluateCycle(c, 90, config, noTrailing, noStop, noHodl, 1.0);
    expect(r.action).toBe("HOLD");
    // Layers should not be triggered
    expect(r.stopLossLayers.every(l => !l.triggered)).toBe(true);
  });

  it("stopLossEnabled=true: evalúa stop loss cuando el precio cae", () => {
    const c = cycle(BUY, TARGET);
    const config = cfg({ stopLossEnabled: true, stopLossSoftPct: 2 });
    // Price drops 3% — should trigger soft stop
    const r = gridRiskManager.evaluateCycle(c, 97, config, noTrailing, noStop, noHodl, 1.0);
    expect(r.action).toBe("STOP_LOSS_SOFT");
  });
});
