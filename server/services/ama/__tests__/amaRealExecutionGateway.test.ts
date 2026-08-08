/**
 * Tests for AMA Real Execution Gateway — R2.32
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../db", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("../amaFunctionalClosure", () => ({
  amaRealStateService: {
    canExecute: vi.fn(),
    getState: vi.fn(),
  },
}));

vi.mock("../amaRealLimitedService", () => ({
  isAuthorized: vi.fn(),
  runPreTradeGates: vi.fn(),
}));

vi.mock("../amaRepository", () => ({
  insertAuditEvent: vi.fn(),
}));

vi.mock("../../portfolio/PortfolioIntegrationAdapter", () => ({
  portfolioIntegrationAdapter: {
    beforeOrder: vi.fn(),
  },
}));

import { amaRealStateService } from "../amaFunctionalClosure";
import { isAuthorized, runPreTradeGates } from "../amaRealLimitedService";
import { insertAuditEvent } from "../amaRepository";
import { portfolioIntegrationAdapter } from "../../portfolio/PortfolioIntegrationAdapter";
import { amaRealExecutionGateway } from "../amaRealExecutionGateway";

describe("AmaRealExecutionGateway", () => {
  beforeEach(() => vi.clearAllMocks());

  it("isFeatureEnabled returns false by default", () => {
    expect(amaRealExecutionGateway.isFeatureEnabled()).toBe(false);
  });

  it("blocks execution when feature flag is disabled", async () => {
    const result = await amaRealExecutionGateway.executeRealOrder({
      cycleId: "cycle-1",
      trancheId: "tranche-1",
      pair: "BTC/USD",
      asset: "BTC",
      exchange: "kraken",
      amountUsd: 1000,
      orderType: "maker",
      isPostOnly: true,
      currentPrice: 100000,
      cycleDeployedUsd: 0,
      cycleBudgetUsd: 10000,
      cycleTrancheCount: 0,
    });

    expect(result.executed).toBe(false);
    expect(result.reason).toBe("FEATURE_FLAG_DISABLED");
    expect(insertAuditEvent).toHaveBeenCalledWith(
      "REAL_EXEC_BLOCKED",
      "INFO",
      expect.objectContaining({ reason: "FEATURE_FLAG_DISABLED" }),
    );
  });

  it("blocks when real state is not ACTIVE", async () => {
    // Temporarily enable feature flag
    const original = process.env.AMA_REAL_EXECUTION_ENABLED;
    process.env.AMA_REAL_EXECUTION_ENABLED = "true";

    vi.mocked(amaRealStateService.canExecute).mockResolvedValue(false);

    const result = await amaRealExecutionGateway.executeRealOrder({
      cycleId: "cycle-1",
      trancheId: "tranche-1",
      pair: "BTC/USD",
      asset: "BTC",
      exchange: "kraken",
      amountUsd: 1000,
      orderType: "maker",
      isPostOnly: true,
      currentPrice: 100000,
      cycleDeployedUsd: 0,
      cycleBudgetUsd: 10000,
      cycleTrancheCount: 0,
    });

    expect(result.executed).toBe(false);
    expect(result.reason).toBe("REAL_STATE_NOT_ACTIVE");

    process.env.AMA_REAL_EXECUTION_ENABLED = original;
  });

  it("blocks when not authorized", async () => {
    const original = process.env.AMA_REAL_EXECUTION_ENABLED;
    process.env.AMA_REAL_EXECUTION_ENABLED = "true";

    vi.mocked(amaRealStateService.canExecute).mockResolvedValue(true);
    vi.mocked(isAuthorized).mockResolvedValue(false);

    const result = await amaRealExecutionGateway.executeRealOrder({
      cycleId: "cycle-1",
      trancheId: "tranche-1",
      pair: "BTC/USD",
      asset: "BTC",
      exchange: "kraken",
      amountUsd: 1000,
      orderType: "maker",
      isPostOnly: true,
      currentPrice: 100000,
      cycleDeployedUsd: 0,
      cycleBudgetUsd: 10000,
      cycleTrancheCount: 0,
    });

    expect(result.executed).toBe(false);
    expect(result.reason).toBe("NOT_AUTHORIZED");

    process.env.AMA_REAL_EXECUTION_ENABLED = original;
  });

  it("blocks when pre-trade gates fail", async () => {
    const original = process.env.AMA_REAL_EXECUTION_ENABLED;
    process.env.AMA_REAL_EXECUTION_ENABLED = "true";

    vi.mocked(amaRealStateService.canExecute).mockResolvedValue(true);
    vi.mocked(isAuthorized).mockResolvedValue(true);
    vi.mocked(amaRealStateService.getState).mockResolvedValue({
      operationalState: "ACTIVE",
      previousState: null,
      transitionReason: null,
      transitionedAt: null,
      transitionedBy: null,
      requiresManualResume: false,
      autoBlockReason: null,
      killSwitchActive: false,
      killSwitchReason: null,
      killSwitchAt: null,
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(runPreTradeGates).mockResolvedValue({
      passed: false,
      gates: [],
      blockers: ["KILL_SWITCH_ACTIVE"],
    });

    const result = await amaRealExecutionGateway.executeRealOrder({
      cycleId: "cycle-1",
      trancheId: "tranche-1",
      pair: "BTC/USD",
      asset: "BTC",
      exchange: "kraken",
      amountUsd: 1000,
      orderType: "maker",
      isPostOnly: true,
      currentPrice: 100000,
      cycleDeployedUsd: 0,
      cycleBudgetUsd: 10000,
      cycleTrancheCount: 0,
    });

    expect(result.executed).toBe(false);
    expect(result.reason).toContain("PRE_TRADE_GATE_FAILED");

    process.env.AMA_REAL_EXECUTION_ENABLED = original;
  });

  it("blocks when portfolio reservation fails", async () => {
    const original = process.env.AMA_REAL_EXECUTION_ENABLED;
    process.env.AMA_REAL_EXECUTION_ENABLED = "true";

    vi.mocked(amaRealStateService.canExecute).mockResolvedValue(true);
    vi.mocked(isAuthorized).mockResolvedValue(true);
    vi.mocked(amaRealStateService.getState).mockResolvedValue({
      operationalState: "ACTIVE",
      previousState: null,
      transitionReason: null,
      transitionedAt: null,
      transitionedBy: null,
      requiresManualResume: false,
      autoBlockReason: null,
      killSwitchActive: false,
      killSwitchReason: null,
      killSwitchAt: null,
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(runPreTradeGates).mockResolvedValue({
      passed: true,
      gates: [],
      blockers: [],
    });
    vi.mocked(portfolioIntegrationAdapter.beforeOrder).mockResolvedValue(null);

    const result = await amaRealExecutionGateway.executeRealOrder({
      cycleId: "cycle-1",
      trancheId: "tranche-1",
      pair: "BTC/USD",
      asset: "BTC",
      exchange: "kraken",
      amountUsd: 1000,
      orderType: "maker",
      isPostOnly: true,
      currentPrice: 100000,
      cycleDeployedUsd: 0,
      cycleBudgetUsd: 10000,
      cycleTrancheCount: 0,
    });

    expect(result.executed).toBe(false);
    expect(result.reason).toBe("PORTFOLIO_RESERVATION_FAILED");

    process.env.AMA_REAL_EXECUTION_ENABLED = original;
  });

  it("passes all gates and returns executed=true", async () => {
    const original = process.env.AMA_REAL_EXECUTION_ENABLED;
    process.env.AMA_REAL_EXECUTION_ENABLED = "true";

    vi.mocked(amaRealStateService.canExecute).mockResolvedValue(true);
    vi.mocked(isAuthorized).mockResolvedValue(true);
    vi.mocked(amaRealStateService.getState).mockResolvedValue({
      operationalState: "ACTIVE",
      previousState: null,
      transitionReason: null,
      transitionedAt: null,
      transitionedBy: null,
      requiresManualResume: false,
      autoBlockReason: null,
      killSwitchActive: false,
      killSwitchReason: null,
      killSwitchAt: null,
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(runPreTradeGates).mockResolvedValue({
      passed: true,
      gates: [],
      blockers: [],
    });
    vi.mocked(portfolioIntegrationAdapter.beforeOrder).mockResolvedValue({
      reservationId: "res-1",
      lockId: "lock-1",
    });

    const result = await amaRealExecutionGateway.executeRealOrder({
      cycleId: "cycle-1",
      trancheId: "tranche-1",
      pair: "BTC/USD",
      asset: "BTC",
      exchange: "kraken",
      amountUsd: 1000,
      orderType: "maker",
      isPostOnly: true,
      currentPrice: 100000,
      cycleDeployedUsd: 0,
      cycleBudgetUsd: 10000,
      cycleTrancheCount: 0,
    });

    expect(result.executed).toBe(true);
    expect(result.reason).toBe(null);
    expect(result.reservationId).toBe("res-1");
    expect(result.orderId).toBe(null); // No exchange order placed yet

    process.env.AMA_REAL_EXECUTION_ENABLED = original;
  });
});
