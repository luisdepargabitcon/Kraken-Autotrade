import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const exchange = {
    exchangeName: "revolutx",
    takerFeePct: 0.09,
    makerFeePct: 0,
    isInitialized: vi.fn(() => true),
    getBalance: vi.fn(),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    getTicker: vi.fn(),
    getOHLC: vi.fn(),
    loadPairMetadata: vi.fn(),
    getPairMetadata: vi.fn(() => null),
    getStepSize: vi.fn(() => null),
    getOrderMin: vi.fn(() => null),
    hasMetadata: vi.fn(() => false),
    formatPair: vi.fn((pair: string) => pair),
    normalizePairFromExchange: vi.fn((pair: string) => pair),
    initialize: vi.fn(),
  };
  return {
    exchange,
    repo: {
      getIdcaConfig: vi.fn(),
      getCycleById: vi.fn(),
      getAllActiveCycles: vi.fn(),
      updateCycle: vi.fn(async () => ({})),
      createOrder: vi.fn(async () => ({})),
      createEvent: vi.fn(async () => ({})),
      getSimulationWallet: vi.fn(),
      updateSimulationWallet: vi.fn(async () => ({})),
    },
    exitRepo: {
      getExitInstructionById: vi.fn(),
      getActiveExitInstruction: vi.fn(async () => null),
      cancelActiveExitInstructionForCycle: vi.fn(async () => undefined),
      markExecuting: vi.fn(async () => true),
      markExecuted: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
      markFailedRequiresReview: vi.fn(async () => undefined),
      getStaleExecutingInstructions: vi.fn(async () => []),
      getPendingImmediateInstructions: vi.fn(async () => []),
      getPendingPriceTargetInstructions: vi.fn(async () => []),
      getPendingTimeInstructions: vi.fn(async () => []),
    },
    telegram: {
      sendRawMessage: vi.fn(async () => undefined),
      alertEmergencyClose: vi.fn(async () => undefined),
      alertFailSafeTriggered: vi.fn(async () => undefined),
      alertTakeProfitReached: vi.fn(async () => undefined),
      alertTrailingStopTriggered: vi.fn(async () => undefined),
      alertBreakEvenTriggered: vi.fn(async () => undefined),
    },
    liveGuard: {
      validateSellQuantity: vi.fn(),
      validateLiveBuyIntention: vi.fn(),
      confirmOrderFill: vi.fn(),
    },
    marketData: {
      getPrice: vi.fn(async () => 100),
      getCandles: vi.fn(async () => []),
      getTicker: vi.fn(async () => null),
    },
    exitManager: { clearExitState: vi.fn() },
    trailingBuyManager: { isArmed: vi.fn(() => false), disarm: vi.fn() },
    tbState: {
      resetTrailingBuyTelegramState: vi.fn(),
      loadStateFromDb: vi.fn(async () => undefined),
    },
    snapshots: { onIdcaEvent: vi.fn() },
    metrics: { onIdcaSample: vi.fn() },
    reconciler: {
      submitAndReconcile: vi.fn(),
      reconcilePendingIntents: vi.fn(async () => []),
    },
  };
});

vi.mock("../IdcaRepository", () => mocks.repo);
vi.mock("../IdcaExitInstructionRepository", () => mocks.exitRepo);
vi.mock("../../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getTradingExchange: vi.fn(() => mocks.exchange),
    getDataExchange: vi.fn(() => mocks.exchange),
    getTradingExchangeType: vi.fn(() => "revolutx"),
  },
}));
vi.mock("../IdcaTelegramNotifier", () => ({
  ...mocks.telegram,
  getNearZoneThresholdPct: vi.fn(() => 1),
}));
vi.mock("../IdcaLiveExecutionGuard", () => mocks.liveGuard);
vi.mock("../../MarketDataService", () => ({ MarketDataService: mocks.marketData }));
vi.mock("../IdcaExitManager", () => ({ idcaExitManager: mocks.exitManager }));
vi.mock("../TrailingBuyManager", () => ({ TrailingBuyManager: mocks.trailingBuyManager }));
vi.mock("../IdcaTrailingBuyTelegramState", () => mocks.tbState);
vi.mock("../../TradeSnapshotService", () => ({ tradeSnapshotService: mocks.snapshots }));
vi.mock("../../TradeMetricsTracker", () => ({ tradeMetricsTracker: mocks.metrics }));
vi.mock("../IdcaExecutionManager", () => ({ idcaExecutionManager: {} }));
vi.mock("../IdcaLiveOrderReconciler", () => mocks.reconciler);
vi.mock("../IdcaMigrationService", () => ({ idcaMigrationService: {} }));
vi.mock("../IdcaHybridDecisionService", () => ({ idcaHybridDecisionService: {} }));

import { executeExit, manualCloseCycle, emergencyCloseAll } from "../IdcaEngine";
import { executeExitInstruction } from "../IdcaExitExecutor";

function makeCycle(mode: unknown, overrides: Record<string, unknown> = {}): any {
  return {
    id: 1,
    pair: "BTC/USD",
    mode,
    status: "active",
    totalQuantity: "0.01",
    capitalUsedUsd: "100",
    totalCostBasisUsd: "100",
    realizedCostBasisUsd: "0",
    realizedPnlUsd: "0",
    unrealizedPnlUsd: "0",
    unrealizedPnlPct: "0",
    avgEntryPrice: "90",
    buyCount: 1,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeConfig(mode: unknown): any {
  return {
    mode,
    executionFeesJson: { takerFeePct: 0.09 },
    simulationFeePct: "0.09",
    simulationSlippagePct: "0",
  };
}

function makeSignal(): any {
  return {
    exitType: "take_profit",
    exitPrice: 100,
    exitReason: "test_exit",
    urgency: "high",
    metadata: { currentState: { unrealizedPnlPct: 10 } },
  };
}

function makeInstruction(mode: unknown): any {
  return {
    id: 7,
    cycleId: 1,
    pair: "BTC/USD",
    mode,
    status: "pending",
    type: "immediate",
    closePct: "100",
  };
}

function resetAll() {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("NETWORK_FORBIDDEN_IN_TEST");
  }));

  mocks.exchange.isInitialized.mockReturnValue(true);
  mocks.exchange.getBalance.mockResolvedValue({ BTC: { available: 1 }, USD: 10_000 });
  mocks.exchange.placeOrder.mockResolvedValue({ success: true, orderId: "venue-order-1" });

  mocks.repo.getIdcaConfig.mockResolvedValue(makeConfig("live"));
  mocks.repo.getCycleById.mockResolvedValue(makeCycle("live"));
  mocks.repo.getAllActiveCycles.mockResolvedValue([]);
  mocks.repo.getSimulationWallet.mockResolvedValue({
    availableBalanceUsd: "1000",
    usedBalanceUsd: "100",
    realizedPnlUsd: "0",
    totalOrdersSimulated: 0,
  });

  mocks.reconciler.submitAndReconcile.mockImplementation(async (params: any) => {
    await mocks.exchange.placeOrder({ pair: params.pair, type: params.side, volume: params.requestedQty.toFixed(8) });
    await mocks.repo.updateCycle(params.cycleId, { status: "closed" });
    await mocks.repo.createOrder({ cycleId: params.cycleId, side: params.side });
    return {
      state: "filled", filledQty: params.requestedQty, avgPrice: 100, feesUsd: 0.09,
      feeSource: "venue", remainingQty: 0, terminal: true,
      intent: { clientOrderId: "test-intent", exchangeOrderId: "venue-order-1" },
      newlyAppliedFillIds: [], alreadyApplied: false,
    };
  });

  mocks.exitRepo.getExitInstructionById.mockResolvedValue(makeInstruction("live"));
  mocks.exitRepo.getActiveExitInstruction.mockResolvedValue(null);
  mocks.exitRepo.markExecuting.mockResolvedValue(true);

  mocks.liveGuard.validateSellQuantity.mockResolvedValue({ valid: true, availableQty: 1 });
}

describe("IDCA execution scope flow (P0)", () => {
  beforeEach(resetAll);

  describe("executeExit", () => {
    it("live válido envía exactamente una orden y escribe contabilidad", async () => {
      await executeExit(makeCycle("live"), makeSignal(), makeConfig("live"), {} as any, "live");
      expect(mocks.exchange.placeOrder).toHaveBeenCalledTimes(1);
      expect(mocks.reconciler.submitAndReconcile).toHaveBeenCalledTimes(1);
      expect(mocks.repo.updateCycle).toHaveBeenCalledTimes(1);
      expect(mocks.repo.createOrder).toHaveBeenCalledTimes(1);
    });

    it("simulation válida no contacta el venue y escribe contabilidad simulada", async () => {
      await executeExit(makeCycle("simulation"), makeSignal(), makeConfig("simulation"), {} as any, "simulation");
      expect(mocks.exchange.placeOrder).not.toHaveBeenCalled();
      expect(mocks.repo.updateCycle).toHaveBeenCalledTimes(1);
      expect(mocks.repo.createOrder).toHaveBeenCalledTimes(1);
    });

    it.each([undefined, null, "", "LIVE", "disabled", "bogus"])("modo corrupto %s bloquea antes de orden y contabilidad", async (badMode) => {
      await executeExit(makeCycle("live"), makeSignal(), makeConfig("live"), {} as any, badMode as any);
      expect(mocks.exchange.placeOrder).not.toHaveBeenCalled();
      expect(mocks.repo.updateCycle).not.toHaveBeenCalled();
      expect(mocks.repo.createOrder).not.toHaveBeenCalled();
      expect(mocks.repo.updateSimulationWallet).not.toHaveBeenCalled();
      expect(mocks.repo.createEvent).toHaveBeenCalled();
    });

    it.each([
      ["live", "simulation"],
      ["simulation", "live"],
    ])("discrepancia requested=%s persistido=%s bloquea todo", async (requested, persisted) => {
      await executeExit(makeCycle(persisted), makeSignal(), makeConfig(requested), {} as any, requested as any);
      expect(mocks.exchange.placeOrder).not.toHaveBeenCalled();
      expect(mocks.repo.updateCycle).not.toHaveBeenCalled();
      expect(mocks.repo.createOrder).not.toHaveBeenCalled();
      expect(mocks.repo.updateSimulationWallet).not.toHaveBeenCalled();
    });
  });

  describe("manualCloseCycle", () => {
    it("live válido envía exactamente una orden y cierra contabilidad", async () => {
      await manualCloseCycle(1);
      expect(mocks.exchange.placeOrder).toHaveBeenCalledTimes(1);
      expect(mocks.reconciler.submitAndReconcile).toHaveBeenCalledTimes(1);
      expect(mocks.repo.createOrder).toHaveBeenCalledTimes(1);
      expect(mocks.repo.updateCycle).toHaveBeenCalledTimes(1);
    });

    it("simulation válida no contacta el venue y actualiza contabilidad simulada", async () => {
      mocks.repo.getCycleById.mockResolvedValue(makeCycle("simulation"));
      mocks.repo.getIdcaConfig.mockResolvedValue(makeConfig("simulation"));
      await manualCloseCycle(1);
      expect(mocks.exchange.placeOrder).not.toHaveBeenCalled();
      expect(mocks.repo.createOrder).toHaveBeenCalledTimes(1);
      expect(mocks.repo.updateCycle).toHaveBeenCalledTimes(1);
      expect(mocks.repo.updateSimulationWallet).toHaveBeenCalledTimes(1);
    });

    it.each([undefined, null, "", "LIVE", "disabled", "bogus"])("modo persistido corrupto %s bloquea antes de escribir", async (badMode) => {
      mocks.repo.getCycleById.mockResolvedValue(makeCycle(badMode));
      await expect(manualCloseCycle(1)).rejects.toThrow("IDCA_EXECUTION_SCOPE_GUARD");
      expect(mocks.exchange.placeOrder).not.toHaveBeenCalled();
      expect(mocks.repo.createOrder).not.toHaveBeenCalled();
      expect(mocks.repo.updateCycle).not.toHaveBeenCalled();
      expect(mocks.repo.updateSimulationWallet).not.toHaveBeenCalled();
    });

    it.each([
      ["live", "simulation"],
      ["simulation", "live"],
    ])("discrepancia solicitada=%s persistida=%s bloquea antes de escribir", async (requested, persisted) => {
      mocks.repo.getCycleById.mockResolvedValue(makeCycle(persisted));
      mocks.repo.getIdcaConfig.mockResolvedValue(makeConfig(requested));
      await expect(manualCloseCycle(1)).rejects.toThrow("IDCA_EXECUTION_SCOPE_GUARD");
      expect(mocks.exchange.placeOrder).not.toHaveBeenCalled();
      expect(mocks.repo.createOrder).not.toHaveBeenCalled();
      expect(mocks.repo.updateCycle).not.toHaveBeenCalled();
      expect(mocks.repo.updateSimulationWallet).not.toHaveBeenCalled();
    });
  });

  describe("emergencyCloseAll", () => {
    it("live válido envía una orden por ciclo y cierra el ciclo", async () => {
      const cycle = makeCycle("live");
      mocks.repo.getAllActiveCycles.mockResolvedValue([cycle]);
      const closed = await emergencyCloseAll();
      expect(closed).toBe(1);
      expect(mocks.exchange.placeOrder).toHaveBeenCalledTimes(1);
      expect(mocks.reconciler.submitAndReconcile).toHaveBeenCalledTimes(1);
      expect(mocks.repo.updateCycle).toHaveBeenCalledTimes(1);
    });

    it("simulation válida no contacta el venue y cierra contabilidad del ciclo", async () => {
      const cycle = makeCycle("simulation");
      mocks.repo.getIdcaConfig.mockResolvedValue(makeConfig("simulation"));
      mocks.repo.getAllActiveCycles.mockResolvedValue([cycle]);
      const closed = await emergencyCloseAll();
      expect(closed).toBe(1);
      expect(mocks.exchange.placeOrder).not.toHaveBeenCalled();
      expect(mocks.repo.updateCycle).toHaveBeenCalledTimes(1);
    });

    it.each([undefined, null, "", "LIVE", "disabled", "bogus"])("modo global corrupto %s no muta ciclos ni envía órdenes", async (badMode) => {
      mocks.repo.getIdcaConfig.mockResolvedValue(makeConfig(badMode));
      mocks.repo.getAllActiveCycles.mockResolvedValue([makeCycle("live")]);
      const closed = await emergencyCloseAll();
      expect(closed).toBe(0);
      expect(mocks.exchange.placeOrder).not.toHaveBeenCalled();
      expect(mocks.repo.updateCycle).not.toHaveBeenCalled();
      expect(mocks.repo.createOrder).not.toHaveBeenCalled();
      expect(mocks.repo.updateSimulationWallet).not.toHaveBeenCalled();
    });

    it.each([
      ["live", "simulation"],
      ["simulation", "live"],
    ])("discrepancia config=%s ciclo=%s excluye el ciclo sin mutarlo", async (requested, persisted) => {
      mocks.repo.getIdcaConfig.mockResolvedValue(makeConfig(requested));
      mocks.repo.getAllActiveCycles.mockResolvedValue([makeCycle(persisted)]);
      const closed = await emergencyCloseAll();
      expect(closed).toBe(0);
      expect(mocks.exchange.placeOrder).not.toHaveBeenCalled();
      expect(mocks.repo.updateCycle).not.toHaveBeenCalled();
      expect(mocks.repo.createOrder).not.toHaveBeenCalled();
      expect(mocks.repo.updateSimulationWallet).not.toHaveBeenCalled();
    });
  });

  describe("executeExitInstruction", () => {
    it("live válido envía exactamente una orden y ejecuta contabilidad", async () => {
      await executeExitInstruction(7, 100);
      expect(mocks.exchange.placeOrder).toHaveBeenCalledTimes(1);
      expect(mocks.reconciler.submitAndReconcile).toHaveBeenCalledTimes(1);
      expect(mocks.repo.updateCycle).toHaveBeenCalledTimes(1);
      expect(mocks.repo.createOrder).toHaveBeenCalledTimes(1);
      expect(mocks.exitRepo.markExecuted).toHaveBeenCalledTimes(1);
    });

    it("simulation válida no contacta el venue y actualiza wallet simulada", async () => {
      mocks.exitRepo.getExitInstructionById.mockResolvedValue(makeInstruction("simulation"));
      mocks.repo.getCycleById.mockResolvedValue(makeCycle("simulation"));
      mocks.repo.getIdcaConfig.mockResolvedValue(makeConfig("simulation"));
      await executeExitInstruction(7, 100);
      expect(mocks.exchange.placeOrder).not.toHaveBeenCalled();
      expect(mocks.repo.updateSimulationWallet).toHaveBeenCalledTimes(1);
      expect(mocks.repo.updateCycle).toHaveBeenCalledTimes(1);
      expect(mocks.repo.createOrder).toHaveBeenCalledTimes(1);
      expect(mocks.exitRepo.markExecuted).toHaveBeenCalledTimes(1);
    });

    it.each([undefined, null, "", "LIVE", "disabled", "bogus"])("modo de instrucción corrupto %s bloquea antes de markExecuting", async (badMode) => {
      mocks.exitRepo.getExitInstructionById.mockResolvedValue(makeInstruction(badMode));
      await executeExitInstruction(7, 100);
      expect(mocks.exitRepo.markExecuting).not.toHaveBeenCalled();
      expect(mocks.exchange.placeOrder).not.toHaveBeenCalled();
      expect(mocks.repo.updateCycle).not.toHaveBeenCalled();
      expect(mocks.repo.createOrder).not.toHaveBeenCalled();
      expect(mocks.repo.updateSimulationWallet).not.toHaveBeenCalled();
    });

    it.each([
      ["live", "simulation"],
      ["simulation", "live"],
    ])("discrepancia instrucción=%s ciclo=%s bloquea antes de markExecuting", async (requested, persisted) => {
      mocks.exitRepo.getExitInstructionById.mockResolvedValue(makeInstruction(requested));
      mocks.repo.getCycleById.mockResolvedValue(makeCycle(persisted));
      await executeExitInstruction(7, 100);
      expect(mocks.exitRepo.markExecuting).not.toHaveBeenCalled();
      expect(mocks.exchange.placeOrder).not.toHaveBeenCalled();
      expect(mocks.repo.updateCycle).not.toHaveBeenCalled();
      expect(mocks.repo.createOrder).not.toHaveBeenCalled();
      expect(mocks.repo.updateSimulationWallet).not.toHaveBeenCalled();
    });
  });
});
