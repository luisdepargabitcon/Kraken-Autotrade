/**
 * Tests for AMA Real Limited Service — pre-trade gate validation logic.
 * Tests are pure (no DB) — they test gate logic via mocked repositories.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the real authorization repository
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
  insertPreTradeGate: vi.fn().mockResolvedValue(undefined),
  getPreTradeGatesByCycle: vi.fn().mockResolvedValue([]),
  insertReconciliation: vi.fn().mockResolvedValue(undefined),
  resolveReconciliation: vi.fn().mockResolvedValue(undefined),
  getUnresolvedReconciliations: vi.fn().mockResolvedValue([]),
}));

vi.mock("../amaRepository", () => ({
  insertAuditEvent: vi.fn().mockResolvedValue(undefined),
  pool: { query: vi.fn() },
}));

vi.mock("../amaRuntimeService", () => ({
  isKillSwitchActive: vi.fn().mockReturnValue(false),
  getMode: vi.fn().mockReturnValue("OFF"),
  setMode: vi.fn().mockResolvedValue(undefined),
  initializeRuntime: vi.fn().mockResolvedValue(undefined),
  getState: vi.fn().mockReturnValue("OBSERVING"),
}));

vi.mock("../amaFunctionalClosure", () => ({
  amaRealStateService: {
    getState: vi.fn().mockResolvedValue({ operationalState: "NOT_READY", killSwitchActive: false }),
    transition: vi.fn().mockResolvedValue({ operationalState: "ARMED" }),
    activateKillSwitch: vi.fn().mockResolvedValue(undefined),
    canExecute: vi.fn().mockResolvedValue(true),
  },
  amaSchedulerStateService: {
    getState: vi.fn().mockResolvedValue({ schedulerRunning: false }),
    markTickStart: vi.fn().mockResolvedValue(undefined),
    markTickEnd: vi.fn().mockResolvedValue(undefined),
  },
  amaHwmBootstrapService: {
    getState: vi.fn().mockResolvedValue({ bootstrapStatus: "COMPLETED", hwm: 50000 }),
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
