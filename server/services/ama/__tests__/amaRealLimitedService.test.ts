/**
 * Tests for AMA Real Limited Service — pre-trade gate validation logic.
 * Tests are pure (no DB) — they test gate logic via mocked repositories.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { runPreTradeGates, isAuthorized, type PreTradeGateContext } from "../amaRealLimitedService";

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
