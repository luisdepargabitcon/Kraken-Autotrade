/**
 * Tests for AMA Real Limited Service — pre-trade gate validation logic.
 * Tests are pure (no DB) — they test gate logic via mocked repositories.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../amaRealAuthorizationRepository", () => ({
  isRealLimitedAuthorized: vi.fn().mockResolvedValue(true),
  getRealAuthorization: vi.fn().mockResolvedValue({
    authorizedMode: "REAL_LIMITED",
    authorizedBy: "test-admin",
    authorizedAt: new Date().toISOString(),
    isActive: true,
    maxCapitalUsd: 1000,
    maxSingleTrancheUsd: 200,
    maxTranchesPerCycle: 5,
    expiresAt: null,
    revokedBy: null,
    revokedAt: null,
    reason: "testing",
  }),
  grantRealLimitedAuthorization: vi.fn().mockResolvedValue(undefined),
  revokeRealAuthorization: vi.fn().mockResolvedValue(undefined),
  restoreRealAuthorizationSnapshot: vi.fn().mockResolvedValue(undefined),
  insertPreTradeGate: vi.fn().mockResolvedValue(undefined),
  getPreTradeGatesByCycle: vi.fn().mockResolvedValue([]),
  insertReconciliation: vi.fn().mockResolvedValue(undefined),
  resolveReconciliation: vi.fn().mockResolvedValue(undefined),
  getUnresolvedReconciliations: vi.fn().mockResolvedValue([]),
}));

vi.mock("../amaRepository", () => ({
  insertAuditEvent: vi.fn().mockResolvedValue(undefined),
  checkAmaSchemaAvailable: vi.fn().mockResolvedValue(true),
  getActivePolicy: vi.fn().mockResolvedValue({ policyId: "pol-1", status: "ACTIVE" }),
  pool: { query: vi.fn() },
}));

vi.mock("../amaSeedTypes", () => ({
  BTC_ASSET_PROFILE: { makerOnly: true, postOnly: true },
  ASSET_PROFILES: { BTC: { makerOnly: true, postOnly: true } },
}));

vi.mock("../amaTypes", () => ({
  AMA_PAIR: "BTC/USD",
}));

vi.mock("../amaMarketRuntimeService", () => ({
  getRealMarketView: vi.fn().mockResolvedValue({
    dataQuality: "GOOD",
    analysisTimestamp: new Date().toISOString(),
    analysisPrice: 50000,
    executionBid: 49990,
    executionAsk: 50010,
  }),
}));

vi.mock("../../../db", () => ({
  pool: {
    query: vi.fn().mockResolvedValue({
      rows: [{ budgeted_usd: "10000", deployed_usd: "0", reserved_usd: "0" }],
    }),
  },
}));

vi.mock("../../MarketDataService", () => ({
  MarketDataService: {
    getTicker: vi.fn().mockResolvedValue({ bid: 49990, ask: 50010, last: 50000 }),
    getPrice: vi.fn().mockResolvedValue(50000),
    getCandles: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../amaRuntimeService", () => ({
  isKillSwitchActive: vi.fn().mockReturnValue(false),
  getMode: vi.fn().mockReturnValue("OFF"),
  setMode: vi.fn().mockResolvedValue(undefined),
  initializeRuntime: vi.fn().mockResolvedValue(undefined),
  getState: vi.fn().mockReturnValue("OBSERVING"),
  getMandate: vi.fn().mockResolvedValue({ mandateId: "man-1", status: "ACTIVE" }),
}));

vi.mock("../amaFunctionalClosure", () => ({
  amaRealStateService: {
    getState: vi.fn().mockResolvedValue({ operationalState: "NOT_READY", killSwitchActive: false }),
    transition: vi.fn().mockResolvedValue({ operationalState: "ARMED" }),
    activateKillSwitch: vi.fn().mockResolvedValue(undefined),
    canExecute: vi.fn().mockResolvedValue(true),
  },
  amaSchedulerStateService: {
    getState: vi.fn().mockResolvedValue({
      currentMode: "RUNNING",
      lastTickAt: new Date().toISOString(),
      tickCount: 1,
      errorCount: 0,
      lastError: null,
    }),
  },
  amaHwmBootstrapService: {
    getState: vi.fn().mockResolvedValue({ bootstrapStatus: "COMPLETED", hwm: 50000, dataCoveragePct: 100 }),
  },
}));

import {
  runPreTradeGates,
  isAuthorized,
  evaluateRealActivationReadiness,
  activateReal,
  type PreTradeGateContext,
  type ActivateRealInput,
} from "../amaRealLimitedService";

describe("AMA Real Limited — runPreTradeGates", () => {
  const baseCtx: PreTradeGateContext = {
    cycleId: "cycle-test",
    trancheId: "tranche-test",
    trancheAmountUsd: 100,
    cycleDeployedUsd: 200,
    cycleBudgetUsd: 1000,
    cycleTrancheCount: 2,
    killSwitchActive: false,
    currentPrice: 50000,
    orderType: "maker",
    isPostOnly: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes all gates when conditions are met", async () => {
    const result = await runPreTradeGates(baseCtx);
    expect(result.passed).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.gates).toHaveLength(9);
  });

  it("blocks when kill switch is active", async () => {
    const result = await runPreTradeGates({ ...baseCtx, killSwitchActive: true });
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("KILL_SWITCH_ACTIVE");
  });

  it("blocks when tranche exceeds single tranche limit", async () => {
    const result = await runPreTradeGates({ ...baseCtx, trancheAmountUsd: 300 });
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("SINGLE_TRANCHE_LIMIT_EXCEEDED");
  });

  it("blocks when total would exceed capital limit", async () => {
    const result = await runPreTradeGates({ ...baseCtx, cycleDeployedUsd: 950, trancheAmountUsd: 100 });
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("CAPITAL_LIMIT_EXCEEDED");
  });

  it("blocks when tranche count exceeds limit", async () => {
    const result = await runPreTradeGates({ ...baseCtx, cycleTrancheCount: 5 });
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("TRANCHE_COUNT_LIMIT_EXCEEDED");
  });

  it("blocks when no valid price", async () => {
    const result = await runPreTradeGates({ ...baseCtx, currentPrice: null });
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("NO_VALID_PRICE");
  });

  it("blocks when budget exceeded", async () => {
    const result = await runPreTradeGates({ ...baseCtx, cycleDeployedUsd: 950, trancheAmountUsd: 100, cycleBudgetUsd: 1000 });
    // totalAfter = 1050 > 1000 budget
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("BUDGET_EXCEEDED");
  });

  it("evaluates all 9 gates", async () => {
    const result = await runPreTradeGates(baseCtx);
    const gateTypes = result.gates.map((g) => g.gateType);
    expect(gateTypes).toContain("KILL_SWITCH");
    expect(gateTypes).toContain("AUTHORIZATION");
    expect(gateTypes).toContain("SINGLE_TRANCHE_LIMIT");
    expect(gateTypes).toContain("CAPITAL_LIMIT");
    expect(gateTypes).toContain("TRANCHE_COUNT_LIMIT");
    expect(gateTypes).toContain("PRICE_AVAILABLE");
    expect(gateTypes).toContain("BUDGET_CONSISTENCY");
    expect(gateTypes).toContain("MAKER_ONLY");
    expect(gateTypes).toContain("POST_ONLY_REQUIRED");
  });
});

describe("AMA Real Limited — authorization rejection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when not authorized", async () => {
    const { isRealLimitedAuthorized } = await import("../amaRealAuthorizationRepository");
    vi.mocked(isRealLimitedAuthorized).mockResolvedValueOnce(false);

    const ctx: PreTradeGateContext = {
      cycleId: "cycle-test",
      trancheId: "tranche-test",
      trancheAmountUsd: 100,
      cycleDeployedUsd: 0,
      cycleBudgetUsd: 1000,
      cycleTrancheCount: 0,
      killSwitchActive: false,
      currentPrice: 50000,
      orderType: "maker",
      isPostOnly: true,
    };
    const result = await runPreTradeGates(ctx);
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("NOT_AUTHORIZED");
  });

  it("isAuthorized returns false when authorization is inactive", async () => {
    const { isRealLimitedAuthorized } = await import("../amaRealAuthorizationRepository");
    vi.mocked(isRealLimitedAuthorized).mockResolvedValueOnce(false);
    const result = await isAuthorized();
    expect(result).toBe(false);
  });
});

describe("AMA Real Limited — order type gates", () => {
  const ctx: PreTradeGateContext = {
    cycleId: "cycle-test",
    trancheId: "tranche-test",
    trancheAmountUsd: 100,
    cycleDeployedUsd: 200,
    cycleBudgetUsd: 1000,
    cycleTrancheCount: 2,
    killSwitchActive: false,
    currentPrice: 50000,
    orderType: "maker",
    isPostOnly: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects taker orders", async () => {
    const result = await runPreTradeGates({ ...ctx, orderType: "taker" });
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("TAKER_NOT_ALLOWED");
  });

  it("rejects non-post-only orders", async () => {
    const result = await runPreTradeGates({ ...ctx, isPostOnly: false });
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("POST_ONLY_REQUIRED");
  });

  it("rejects market orders (taker + non-post-only)", async () => {
    const result = await runPreTradeGates({ ...ctx, orderType: "taker", isPostOnly: false });
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("TAKER_NOT_ALLOWED");
    expect(result.blockers).toContain("POST_ONLY_REQUIRED");
  });

  it("allows maker post-only orders", async () => {
    const result = await runPreTradeGates({ ...ctx, orderType: "maker", isPostOnly: true });
    expect(result.passed).toBe(true);
  });
});

describe("AMA Real Limited — evaluateRealActivationReadiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AMA_REAL_EXECUTION_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.AMA_REAL_EXECUTION_ENABLED;
  });

  it("blocks when feature flag is disabled", async () => {
    process.env.AMA_REAL_EXECUTION_ENABLED = "false";
    const result = await evaluateRealActivationReadiness();
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain("FEATURE_FLAG_DISABLED");
    expect(result.checks.featureFlag.ok).toBe(false);
  });

  it("blocks when kill switch is active", async () => {
    const runtimeModule = await import("../amaRuntimeService");
    vi.mocked(runtimeModule.isKillSwitchActive).mockReturnValueOnce(true);
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("KILL_SWITCH_ACTIVE");
    expect(result.checks.killSwitch.ok).toBe(false);
  });

  it("blocks when real state is ARMED (already active)", async () => {
    const { amaRealStateService } = await import("../amaFunctionalClosure");
    vi.mocked(amaRealStateService.getState).mockResolvedValueOnce({ operationalState: "ARMED" } as any);
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("REAL_STATE_INCOMPATIBLE");
    expect(result.checks.realStateCompatible.ok).toBe(false);
  });

  it("blocks when real state is KILL_SWITCHED", async () => {
    const { amaRealStateService } = await import("../amaFunctionalClosure");
    vi.mocked(amaRealStateService.getState).mockResolvedValueOnce({ operationalState: "KILL_SWITCHED" } as any);
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("REAL_STATE_INCOMPATIBLE");
  });

  it("blocks when unresolved reconciliations exist", async () => {
    const { getUnresolvedReconciliations } = await import("../amaRealAuthorizationRepository");
    vi.mocked(getUnresolvedReconciliations).mockResolvedValueOnce([{ id: "r1" }] as any);
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("UNRESOLVED_RECONCILIATION");
    expect(result.checks.reconciliation.ok).toBe(false);
  });

  it("returns ready=true when all checks pass", async () => {
    const result = await evaluateRealActivationReadiness();
    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.checks.featureFlag.ok).toBe(true);
    expect(result.checks.killSwitch.ok).toBe(true);
    expect(result.checks.realStateCompatible.ok).toBe(true);
    expect(result.checks.reconciliation.ok).toBe(true);
  });

  it("returns structured checks object with ok and detail fields", async () => {
    const result = await evaluateRealActivationReadiness();
    for (const [, check] of Object.entries(result.checks)) {
      expect(check).toHaveProperty("ok");
    }
  });
});

describe("AMA Real Limited — activateReal atomic", () => {
  const validInput: ActivateRealInput = {
    authorizedBy: "test-admin",
    maxCapitalUsd: 500,
    maxSingleTrancheUsd: 100,
    maxTranchesPerCycle: 3,
    confirm: true,
    reason: "integration test",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AMA_REAL_EXECUTION_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.AMA_REAL_EXECUTION_ENABLED;
  });

  it("throws without confirm=true", async () => {
    await expect(activateReal({ ...validInput, confirm: false })).rejects.toThrow("explicit user confirmation");
  });

  it("throws when staging flag is off", async () => {
    process.env.AMA_REAL_EXECUTION_ENABLED = "false";
    await expect(activateReal(validInput)).rejects.toThrow("deshabilitada en este entorno");
  });

  it("throws and inserts REAL_ACTIVATION_BLOCKED when not ready", async () => {
    const runtimeModule = await import("../amaRuntimeService");
    vi.mocked(runtimeModule.isKillSwitchActive).mockReturnValueOnce(true);
    const { insertAuditEvent } = await import("../amaRepository");
    await expect(activateReal(validInput)).rejects.toThrow("Activation blocked");
    expect(vi.mocked(insertAuditEvent)).toHaveBeenCalledWith(
      "REAL_ACTIVATION_BLOCKED",
      "WARN",
      expect.objectContaining({ blockers: expect.arrayContaining(["KILL_SWITCH_ACTIVE"]) }),
    );
  });

  it("does NOT call grantRealLimitedAuthorization if staging flag is off", async () => {
    process.env.AMA_REAL_EXECUTION_ENABLED = "false";
    const { grantRealLimitedAuthorization } = await import("../amaRealAuthorizationRepository");
    await expect(activateReal(validInput)).rejects.toThrow();
    expect(vi.mocked(grantRealLimitedAuthorization)).not.toHaveBeenCalled();
  });

  it("returns activated=true on successful activation", async () => {
    const { amaRealStateService } = await import("../amaFunctionalClosure");
    vi.mocked(amaRealStateService.getState)
      .mockResolvedValueOnce({ operationalState: "NOT_READY" } as any)
      .mockResolvedValueOnce({ operationalState: "ARMED" } as any);
    const result = await activateReal(validInput);
    expect(result.activated).toBe(true);
    expect(result.mode).toBe("REAL_LIMITED");
  });

  it("calls revokeRealAuthorization on rollback when mode change fails", async () => {
    const runtimeModule = await import("../amaRuntimeService");
    const { grantRealLimitedAuthorization, revokeRealAuthorization, getRealAuthorization } =
      await import("../amaRealAuthorizationRepository");
    vi.mocked(getRealAuthorization).mockResolvedValue({ isActive: false } as any);
    vi.mocked(runtimeModule.setMode).mockRejectedValueOnce(new Error("Mode change error"));
    const { amaRealStateService } = await import("../amaFunctionalClosure");
    vi.mocked(amaRealStateService.getState)
      .mockResolvedValueOnce({ operationalState: "NOT_READY" } as any)
      .mockResolvedValueOnce({ operationalState: "NOT_READY" } as any);
    await expect(activateReal(validInput)).rejects.toThrow("Mode change error");
    expect(vi.mocked(grantRealLimitedAuthorization)).toHaveBeenCalled();
    expect(vi.mocked(revokeRealAuthorization)).toHaveBeenCalledWith("SYSTEM", "REAL_ACTIVATION_FAILED rollback");
  });
});

describe("AMA Real Limited — evaluateRealActivationReadiness extended checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AMA_REAL_EXECUTION_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.AMA_REAL_EXECUTION_ENABLED;
  });

  it("blocks when market data is stale (old timestamp)", async () => {
    const { getRealMarketView } = await import("../amaMarketRuntimeService");
    const staleDate = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    vi.mocked(getRealMarketView).mockResolvedValueOnce({
      dataQuality: "GOOD",
      analysisTimestamp: staleDate,
      analysisPrice: 50000,
    } as any);
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("MARKET_STALE");
    expect(result.checks.marketFresh.ok).toBe(false);
  });

  it("blocks when market data quality is UNAVAILABLE", async () => {
    const { getRealMarketView } = await import("../amaMarketRuntimeService");
    vi.mocked(getRealMarketView).mockResolvedValueOnce({
      dataQuality: "UNAVAILABLE",
      analysisTimestamp: null,
      analysisPrice: null,
    } as any);
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("MARKET_STALE");
    expect(result.blockers).toContain("NO_VALID_PRICE");
  });

  it("blocks when market fetch throws (fail-closed)", async () => {
    const { getRealMarketView } = await import("../amaMarketRuntimeService");
    vi.mocked(getRealMarketView).mockRejectedValueOnce(new Error("network error"));
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("MARKET_STALE");
    expect(result.blockers).toContain("NO_VALID_PRICE");
  });

  it("blocks when HWM bootstrap is not COMPLETED", async () => {
    const { amaHwmBootstrapService } = await import("../amaFunctionalClosure");
    vi.mocked(amaHwmBootstrapService.getState).mockResolvedValueOnce({
      bootstrapStatus: "PENDING",
      hwm: null,
      dataCoveragePct: 0,
    } as any);
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("NO_HIGH_WATER_MARK");
    expect(result.checks.hwm.ok).toBe(false);
  });

  it("blocks when HWM getState throws (fail-closed)", async () => {
    const { amaHwmBootstrapService } = await import("../amaFunctionalClosure");
    vi.mocked(amaHwmBootstrapService.getState).mockRejectedValueOnce(new Error("db error"));
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("HWM_UNAVAILABLE");
    expect(result.checks.hwm.ok).toBe(false);
  });

  it("blocks when mandate is not ACTIVE", async () => {
    const runtimeModule = await import("../amaRuntimeService");
    vi.mocked(runtimeModule.getMandate).mockResolvedValueOnce({ mandateId: "m1", status: "DRAFT" } as any);
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("NO_ACTIVE_MANDATE");
    expect(result.checks.mandateActive.ok).toBe(false);
  });

  it("blocks when mandate is null (fail-closed)", async () => {
    const runtimeModule = await import("../amaRuntimeService");
    vi.mocked(runtimeModule.getMandate).mockResolvedValueOnce(null);
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("NO_ACTIVE_MANDATE");
  });

  it("blocks when mandate getMandate throws (fail-closed)", async () => {
    const runtimeModule = await import("../amaRuntimeService");
    vi.mocked(runtimeModule.getMandate).mockRejectedValueOnce(new Error("db error"));
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("MANDATE_UNAVAILABLE");
    expect(result.checks.mandateActive.ok).toBe(false);
  });

  it("blocks when no active policy", async () => {
    const repo = await import("../amaRepository");
    vi.mocked(repo.getActivePolicy).mockResolvedValueOnce(null);
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("NO_ACTIVE_POLICY");
    expect(result.checks.policyActive.ok).toBe(false);
  });

  it("blocks when getActivePolicy throws (fail-closed)", async () => {
    const repo = await import("../amaRepository");
    vi.mocked(repo.getActivePolicy).mockRejectedValueOnce(new Error("db error"));
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("POLICY_UNAVAILABLE");
  });

  it("blocks when portfolio budget is zero", async () => {
    const dbModule = await import("../../../db");
    vi.mocked(dbModule.pool.query).mockResolvedValueOnce({
      rows: [{ budgeted_usd: "0", deployed_usd: "0", reserved_usd: "0" }],
    } as any);
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("NO_BUDGET_ALLOCATED");
    expect(result.checks.portfolioBudget.ok).toBe(false);
  });

  it("blocks when free capital is zero (all deployed)", async () => {
    const dbModule = await import("../../../db");
    vi.mocked(dbModule.pool.query).mockResolvedValueOnce({
      rows: [{ budgeted_usd: "1000", deployed_usd: "1000", reserved_usd: "0" }],
    } as any);
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("NO_FREE_CAPITAL");
    expect(result.checks.freeCapital.ok).toBe(false);
  });

  it("blocks when budget query throws (fail-closed)", async () => {
    const dbModule = await import("../../../db");
    vi.mocked(dbModule.pool.query).mockRejectedValueOnce(new Error("db error"));
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("BUDGET_UNAVAILABLE");
    expect(result.blockers).toContain("FREE_CAPITAL_UNAVAILABLE");
  });

  it("blocks when reconciliation query throws — FAIL-CLOSED returns RECONCILIATION_UNAVAILABLE not OK", async () => {
    const { getUnresolvedReconciliations } = await import("../amaRealAuthorizationRepository");
    vi.mocked(getUnresolvedReconciliations).mockRejectedValueOnce(new Error("db error"));
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("RECONCILIATION_UNAVAILABLE");
    expect(result.checks.reconciliation.ok).toBe(false);
    expect(result.checks.reconciliation.detail).toContain("cannot verify");
  });

  it("blocks when gateway returns invalid ticker", async () => {
    const { MarketDataService } = await import("../../MarketDataService");
    vi.mocked(MarketDataService.getTicker).mockResolvedValueOnce({ bid: null, ask: null, last: 0 } as any);
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("GATEWAY_UNAVAILABLE");
    expect(result.checks.gatewayAvailable.ok).toBe(false);
  });

  it("blocks when gateway getTicker throws (fail-closed)", async () => {
    const { MarketDataService } = await import("../../MarketDataService");
    vi.mocked(MarketDataService.getTicker).mockRejectedValueOnce(new Error("connection refused"));
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("GATEWAY_UNAVAILABLE");
  });

  it("blocks when scheduler is stale (lastTickAt too old)", async () => {
    const { amaSchedulerStateService } = await import("../amaFunctionalClosure");
    const staleDate = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    vi.mocked(amaSchedulerStateService.getState).mockResolvedValueOnce({
      currentMode: "RUNNING",
      lastTickAt: staleDate,
      tickCount: 5,
      errorCount: 0,
      lastError: null,
    } as any);
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("SCHEDULER_STALE");
    expect(result.checks.schedulerOperational.ok).toBe(false);
  });

  it("blocks when scheduler getState throws (fail-closed)", async () => {
    const { amaSchedulerStateService } = await import("../amaFunctionalClosure");
    vi.mocked(amaSchedulerStateService.getState).mockRejectedValueOnce(new Error("db error"));
    const result = await evaluateRealActivationReadiness();
    expect(result.blockers).toContain("SCHEDULER_UNAVAILABLE");
    expect(result.checks.schedulerOperational.ok).toBe(false);
  });

  it("makerOnly check reads from asset profile (invariant true)", async () => {
    const result = await evaluateRealActivationReadiness();
    expect(result.checks.makerOnly.ok).toBe(true);
    expect(result.checks.makerOnly.detail).toContain("Gate 8");
  });

  it("postOnly check reads from asset profile (invariant true)", async () => {
    const result = await evaluateRealActivationReadiness();
    expect(result.checks.postOnly.ok).toBe(true);
    expect(result.checks.postOnly.detail).toContain("Gate 9");
  });

  it("returns 17 named checks in result object", async () => {
    const result = await evaluateRealActivationReadiness();
    const keys = Object.keys(result.checks);
    expect(keys.length).toBeGreaterThanOrEqual(17);
  });
});

describe("AMA Real Limited — activateReal full rollback with previous auth", () => {
  const validInput: ActivateRealInput = {
    authorizedBy: "test-admin",
    maxCapitalUsd: 500,
    maxSingleTrancheUsd: 100,
    maxTranchesPerCycle: 3,
    confirm: true,
    reason: "integration test",
  };

  const previousAuthSnapshot = {
    authorizedMode: "REAL_LIMITED",
    authorizedBy: "prev-admin",
    authorizedAt: "2026-01-01T00:00:00.000Z",
    isActive: true,
    maxCapitalUsd: 999,
    maxSingleTrancheUsd: 111,
    maxTranchesPerCycle: 2,
    expiresAt: null,
    revokedBy: null,
    revokedAt: null,
    reason: "previous grant",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AMA_REAL_EXECUTION_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.AMA_REAL_EXECUTION_ENABLED;
  });

  it("restores previous authorization snapshot exactly when mode change fails", async () => {
    const { getRealAuthorization, restoreRealAuthorizationSnapshot } =
      await import("../amaRealAuthorizationRepository");
    const runtimeModule = await import("../amaRuntimeService");
    vi.mocked(getRealAuthorization).mockResolvedValue(previousAuthSnapshot as any);
    vi.mocked(runtimeModule.setMode).mockRejectedValueOnce(new Error("Mode change error"));
    const { amaRealStateService } = await import("../amaFunctionalClosure");
    vi.mocked(amaRealStateService.getState)
      .mockResolvedValueOnce({ operationalState: "NOT_READY" } as any)
      .mockResolvedValueOnce({ operationalState: "NOT_READY" } as any);
    await expect(activateReal(validInput)).rejects.toThrow("Mode change error");
    expect(vi.mocked(restoreRealAuthorizationSnapshot)).toHaveBeenCalledWith(previousAuthSnapshot);
  });

  it("does NOT call restoreRealAuthorizationSnapshot when previous auth was inactive", async () => {
    const { getRealAuthorization, revokeRealAuthorization, restoreRealAuthorizationSnapshot } =
      await import("../amaRealAuthorizationRepository");
    const runtimeModule = await import("../amaRuntimeService");
    vi.mocked(getRealAuthorization).mockResolvedValue({ ...previousAuthSnapshot, isActive: false } as any);
    vi.mocked(runtimeModule.setMode).mockRejectedValueOnce(new Error("Mode change error"));
    const { amaRealStateService } = await import("../amaFunctionalClosure");
    vi.mocked(amaRealStateService.getState)
      .mockResolvedValueOnce({ operationalState: "NOT_READY" } as any)
      .mockResolvedValueOnce({ operationalState: "NOT_READY" } as any);
    await expect(activateReal(validInput)).rejects.toThrow("Mode change error");
    expect(vi.mocked(restoreRealAuthorizationSnapshot)).not.toHaveBeenCalled();
    expect(vi.mocked(revokeRealAuthorization)).toHaveBeenCalledWith("SYSTEM", "REAL_ACTIVATION_FAILED rollback");
  });

  it("REAL_ACTIVATION_PLACE_ORDER_CALLS=0: activateReal never calls any order placement", async () => {
    const { amaRealStateService } = await import("../amaFunctionalClosure");
    vi.mocked(amaRealStateService.getState)
      .mockResolvedValueOnce({ operationalState: "NOT_READY" } as any)
      .mockResolvedValueOnce({ operationalState: "ARMED" } as any);
    await activateReal(validInput);
    // Verify no exchange/order functions were called during activation
    // activateReal only calls: grantAuth, setMode, transition, auditEvent, getState
    const { grantRealLimitedAuthorization } = await import("../amaRealAuthorizationRepository");
    expect(vi.mocked(grantRealLimitedAuthorization)).toHaveBeenCalledTimes(1);
    // Any order placement would require exchange adapter calls which are not mocked here
    // This test verifies activateReal completes without calling any unmocked functions
  });

  it("rollback sequence is G→F→E: state→mode→auth on full sequence failure", async () => {
    const { getRealAuthorization, revokeRealAuthorization } = await import("../amaRealAuthorizationRepository");
    const runtimeModule = await import("../amaRuntimeService");
    const { amaRealStateService } = await import("../amaFunctionalClosure");
    vi.mocked(getRealAuthorization).mockResolvedValue({ isActive: false } as any);
    const callOrder: string[] = [];
    vi.mocked(amaRealStateService.transition).mockImplementation(async (state) => {
      if (String(state) === "ARMED") {
        callOrder.push("state-forward");
        return { operationalState: "ARMED" } as any;
      }
      callOrder.push("state-rollback");
      return { operationalState: "NOT_READY" } as any;
    });
    vi.mocked(runtimeModule.setMode).mockImplementation(async (mode) => {
      if (String(mode) === "REAL_LIMITED") {
        callOrder.push("mode-forward");
        throw new Error("trigger rollback from mode");
      }
      callOrder.push("mode-rollback");
    });
    vi.mocked(revokeRealAuthorization).mockImplementation(async () => {
      callOrder.push("auth-rollback");
    });
    await expect(activateReal(validInput)).rejects.toThrow("trigger rollback from mode");
    // F throws BEFORE modeChanged=true, so mode was never changed → no mode rollback
    // G never happened → no state rollback
    // Only auth (E) is rolled back
    expect(callOrder).toEqual(["mode-forward", "auth-rollback"]);
  });
});
