/**
 * AMA SHADOW, Executor & Security — Fases 23-25: tests
 */

import { describe, it, expect } from "vitest";
import {
  checkShadowReadiness,
  createShadowOrder,
  simulateFill,
  simulateReject,
  expireShadowOrder,
  generateShadowReport,
  validateOrderIntent,
  executeOrderIntent,
  assessSecurity,
  createKillSwitchRecovery,
  createReconciliationRecovery,
  createKeyRotationRecovery,
  type OrderIntent,
} from "../amaShadowExecutorSecurity";
import type { AmaTrancheCandidate } from "../amaTypes";

const makeTranche = (overrides: Partial<AmaTrancheCandidate> = {}): AmaTrancheCandidate => ({
  trancheId: "t1",
  type: "VALUE",
  activationZone: "VALUE",
  activationDropPct: 30,
  amountUsd: 1500,
  spacingPct: 5,
  eligible: true,
  eligibilityReasons: [],
  ...overrides,
});

const makeIntent = (overrides: Partial<OrderIntent> = {}): OrderIntent => ({
  intentId: "intent-1",
  cycleId: "c1",
  trancheId: "t1",
  pair: "BTC/USD",
  side: "BUY",
  type: "LIMIT_MAKER",
  price: 45000,
  quantity: 0.033,
  amountUsd: 1500,
  ...overrides,
});

describe("Fase 23 — SHADOW Mode (readiness + deterministic IDs)", () => {
  it("checkShadowReadiness blocks when mode is not SHADOW", () => {
    const result = checkShadowReadiness("REPLAY", true, true, true, 95, 90);
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("MODE_IS_NOT_SHADOW");
  });

  it("checkShadowReadiness blocks when no HWM", () => {
    const result = checkShadowReadiness("SHADOW", false, true, true, 95, 90);
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("NO_HIGH_WATER_MARK");
  });

  it("checkShadowReadiness blocks when no budget", () => {
    const result = checkShadowReadiness("SHADOW", true, false, true, 95, 90);
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("NO_BUDGET_ALLOCATED");
  });

  it("checkShadowReadiness blocks when no price", () => {
    const result = checkShadowReadiness("SHADOW", true, true, false, 95, 90);
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("NO_CURRENT_PRICE");
  });

  it("checkShadowReadiness blocks when data coverage below minimum", () => {
    const result = checkShadowReadiness("SHADOW", true, true, true, 80, 90);
    expect(result.ready).toBe(false);
    expect(result.blockers.some((b) => b.startsWith("DATA_COVERAGE_BELOW_MINIMUM"))).toBe(true);
  });

  it("checkShadowReadiness passes when all conditions met", () => {
    const result = checkShadowReadiness("SHADOW", true, true, true, 95, 90);
    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("creates shadow order from tranche", () => {
    const order = createShadowOrder("c1", makeTranche(), "BTC/USD", 45000);
    expect(order.cycleId).toBe("c1");
    expect(order.side).toBe("BUY");
    expect(order.type).toBe("LIMIT_MAKER");
    expect(order.status).toBe("PENDING");
    expect(order.amountUsd).toBe(1500);
    expect(order.quantity).toBeCloseTo(1500 / 45000, 8);
  });

  it("simulates fill", () => {
    const order = createShadowOrder("c1", makeTranche(), "BTC/USD", 45000);
    const filled = simulateFill(order, 44900, "2026-07-29T10:00:00Z");
    expect(filled.status).toBe("SIMULATED_FILLED");
    expect(filled.simulatedFillPrice).toBe(44900);
    expect(filled.simulatedFillTimestamp).toBe("2026-07-29T10:00:00Z");
  });

  it("simulates rejection", () => {
    const order = createShadowOrder("c1", makeTranche(), "BTC/USD", 45000);
    const rejected = simulateReject(order, "INSUFFICIENT_LIQUIDITY");
    expect(rejected.status).toBe("SIMULATED_REJECTED");
    expect(rejected.rejectionReason).toBe("INSUFFICIENT_LIQUIDITY");
  });

  it("expires shadow order", () => {
    const order = createShadowOrder("c1", makeTranche(), "BTC/USD", 45000);
    const expired = expireShadowOrder(order);
    expect(expired.status).toBe("EXPIRED");
  });

  it("generates shadow report", () => {
    const orders = [
      simulateFill(createShadowOrder("c1", makeTranche({ amountUsd: 1500 }), "BTC/USD", 45000), 44900, "2026-07-29T10:00:00Z"),
      simulateReject(createShadowOrder("c1", makeTranche({ trancheId: "t2" }), "BTC/USD", 45000), "REJECTED"),
      expireShadowOrder(createShadowOrder("c1", makeTranche({ trancheId: "t3" }), "BTC/USD", 45000)),
      createShadowOrder("c1", makeTranche({ trancheId: "t4" }), "BTC/USD", 45000),
    ];
    const report = generateShadowReport(orders);
    expect(report.totalOrders).toBe(4);
    expect(report.filled).toBe(1);
    expect(report.rejected).toBe(1);
    expect(report.expired).toBe(1);
    expect(report.pending).toBe(1);
    expect(report.totalSimulatedUsd).toBe(1500);
    expect(report.averageFillPrice).toBe(44900);
  });

  it("computes slippage in report", () => {
    const order = createShadowOrder("c1", makeTranche(), "BTC/USD", 45000);
    const filled = simulateFill(order, 45450, "2026-07-29T10:00:00Z"); // 1% slippage
    const report = generateShadowReport([filled]);
    expect(report.slippagePct).toBeCloseTo(1, 1);
  });
});

describe("Fase 24 — Executor", () => {
  it("validates correct order intent", () => {
    const intent = makeIntent();
    const result = validateOrderIntent(intent, "REPLAY", 0.5, 45000);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("blocks REAL mode", () => {
    const intent = makeIntent();
    const result = validateOrderIntent(intent, "REAL_LIMITED", 0.5, 45000);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("REAL_MODE_NOT_AUTHORIZED_FOR_EXECUTOR");
  });

  it("blocks LIMIT_TAKER — AMA is maker-only", () => {
    const intent = makeIntent({ type: "LIMIT_TAKER" });
    const result = validateOrderIntent(intent, "REPLAY", 0.5, 45000);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("LIMIT_TAKER_NOT_ALLOWED_AMA_MAKER_ONLY");
  });

  it("blocks price outside spread tolerance", () => {
    const intent = makeIntent({ price: 46000 }); // 2.2% from 45000
    const result = validateOrderIntent(intent, "REPLAY", 0.5, 45000);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("PRICE_OUTSIDE_SPREAD_TOLERANCE");
  });

  it("blocks Revolut X", () => {
    const intent = makeIntent({ pair: "REVOLUT_X_BTC" });
    const result = validateOrderIntent(intent, "REPLAY", 0.5, 45000);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("REVOLUT_X_BLOCKED");
  });

  it("blocks invalid values", () => {
    const intent = makeIntent({ price: -1, quantity: -1, amountUsd: -1 });
    const result = validateOrderIntent(intent, "REPLAY", 0.5, 45000);
    expect(result.errors).toContain("INVALID_PRICE");
    expect(result.errors).toContain("INVALID_QUANTITY");
    expect(result.errors).toContain("INVALID_AMOUNT");
  });

  it("executes valid intent in simulation with deterministic ID", () => {
    const intent = makeIntent();
    const result = executeOrderIntent(intent, "REPLAY", 0.5, 45000);
    expect(result.status).toBe("COMPLETED");
    expect(result.exchangeOrderId).not.toBeNull();
    expect(result.exchangeOrderId).toMatch(/^sim-[a-f0-9]{12}$/);
  });

  it("execution ID is deterministic (same input = same ID)", () => {
    const intent = makeIntent();
    const result1 = executeOrderIntent(intent, "REPLAY", 0.5, 45000);
    const result2 = executeOrderIntent(intent, "REPLAY", 0.5, 45000);
    expect(result1.exchangeOrderId).toBe(result2.exchangeOrderId);
  });

  it("fails invalid intent", () => {
    const intent = makeIntent();
    const result = executeOrderIntent(intent, "REAL_LIMITED", 0.5, 45000);
    expect(result.status).toBe("FAILED");
    expect(result.exchangeOrderId).toBeNull();
  });
});

describe("Fase 25 — Security & Recovery", () => {
  it("assesses safe security level", () => {
    const assessment = assessSecurity("REPLAY", false, false, 0);
    expect(assessment.level).toBe("SAFE");
    expect(assessment.requiresAction).toBe(false);
  });

  it("assesses critical for REAL mode", () => {
    const assessment = assessSecurity("REAL_LIMITED", false, false, 0);
    expect(assessment.level).toBe("CRITICAL");
    expect(assessment.issues).toContain("REAL_MODE_ACTIVE");
  });

  it("assesses critical for kill switch", () => {
    const assessment = assessSecurity("REPLAY", true, false, 0);
    expect(assessment.level).toBe("CRITICAL");
    expect(assessment.issues).toContain("KILL_SWITCH_ACTIVE");
  });

  it("assesses elevated for multiple issues", () => {
    const assessment = assessSecurity("REPLAY", false, true, 2);
    expect(assessment.level).toBe("ELEVATED");
    expect(assessment.issues.length).toBe(2);
  });

  it("creates kill switch recovery procedure with deterministic ID", () => {
    const proc = createKillSwitchRecovery();
    expect(proc.type).toBe("KILL_SWITCH");
    expect(proc.requiresAuthorization).toBe(true);
    expect(proc.steps.length).toBeGreaterThan(0);
    expect(proc.procedureId).toBe("recovery-kill-switch");
  });

  it("creates reconciliation recovery procedure", () => {
    const proc = createReconciliationRecovery();
    expect(proc.type).toBe("RECONCILIATION");
    expect(proc.requiresAuthorization).toBe(true);
  });

  it("creates key rotation recovery procedure", () => {
    const proc = createKeyRotationRecovery();
    expect(proc.type).toBe("KEY_ROTATION");
    expect(proc.requiresAuthorization).toBe(true);
    expect(proc.steps.some((s) => s.includes("NEVER"))).toBe(true);
  });
});
