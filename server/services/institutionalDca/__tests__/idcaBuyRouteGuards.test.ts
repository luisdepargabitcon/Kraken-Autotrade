import { beforeEach, describe, expect, it, vi } from "vitest";

const repoMock = vi.hoisted(() => ({
  createEvent: vi.fn(async () => ({})),
  createOrder: vi.fn(async (order: any) => order),
  createCycle: vi.fn(async (cycle: any) => ({ id: 900, ...cycle })),
  updateCycle: vi.fn(async () => undefined),
  getCycleById: vi.fn(async () => null),
  getSimulationWallet: vi.fn(async () => ({ availableBalanceUsd: "10000", usedBalanceUsd: "0", totalOrdersSimulated: 0 })),
  updateSimulationWallet: vi.fn(async () => undefined),
  getClosedPlusCyclesCount: vi.fn(async () => 0),
  getAllActiveBotCycles: vi.fn(async () => []),
  getClosedRecoveryCyclesCount: vi.fn(async () => 0),
  getActiveRecoveryCycles: vi.fn(async () => []),
  getTotalBotPairExposureUsd: vi.fn(async () => 0),
  getTotalPairExposureUsd: vi.fn(async () => 0),
  getAllActiveBotCyclesForPair: vi.fn(async () => []),
  getLastClosedRecoveryCycle: vi.fn(async () => null),
}));

const exitRepoMock = vi.hoisted(() => ({
  hasPendingExitInstruction: vi.fn(async () => false),
}));

const liveGuardMock = vi.hoisted(() => ({
  validateLiveBuyIntention: vi.fn(async () => ({ allowed: true, reduced: false })),
  validateSellQuantity: vi.fn(async () => ({ allowed: true })),
}));

const reconcilerMock = vi.hoisted(() => ({
  submitAndReconcile: vi.fn(),
  reconcilePendingIntents: vi.fn(async () => []),
}));

vi.mock("../IdcaRepository", () => repoMock);
vi.mock("../IdcaExitInstructionRepository", () => exitRepoMock);
vi.mock("../IdcaLiveExecutionGuard", () => liveGuardMock);
vi.mock("../IdcaLiveOrderReconciler", () => reconcilerMock);
vi.mock("../IdcaTelegramNotifier", () => ({
  alertBuyBlocked: vi.fn(async () => undefined),
  alertApproachingBuy: vi.fn(async () => undefined),
  alertOrderFailed: vi.fn(async () => undefined),
  alertSafetyBuy: vi.fn(async () => undefined),
  alertCycleStarted: vi.fn(async () => undefined),
  alertBuyExecuted: vi.fn(async () => undefined),
  getNearZoneThresholdPct: vi.fn(() => 1),
}));
vi.mock("../../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getTradingExchange: vi.fn(() => ({ placeOrder: vi.fn(), createOrder: vi.fn() })),
    getDataExchange: vi.fn(() => ({ isInitialized: () => false })),
    getDataExchangeType: vi.fn(() => "kraken"),
  },
}));

import {
  checkPlusActivationForTest,
  checkPlusSafetyBuyForTest,
  checkRecoveryActivationForTest,
  checkRecoverySafetyBuyForTest,
  checkSafetyBuyForTest,
} from "../IdcaEngine";

function config(entryPolicy?: unknown): any {
  return {
    allocatedCapitalUsd: "1000",
    maxModuleExposurePct: "90",
    maxAssetExposurePct: "90",
    simulationFeePct: "0.1",
    simulationSlippagePct: "0",
    adaptiveTpEnabled: false,
    entryUiJson: entryPolicy === undefined ? {} : { entryPolicy },
  };
}

function assetConfig(): any {
  return {
    safetyOrdersJson: [
      { dipPct: 5, sizePctOfAssetBudget: 50 },
      { dipPct: 10, sizePctOfAssetBudget: 50 },
    ],
    maxSafetyOrders: 2,
    cooldownMinutesBetweenBuys: 60,
    requireReboundConfirmation: false,
    takeProfitPct: "2",
    trailingMarginPct: "1",
    entryMode: "assisted_entry",
  };
}

function safetyCycle(overrides: Record<string, unknown> = {}): any {
  return {
    id: 41,
    pair: "BTC/USD",
    mode: "simulation",
    buyCount: 1,
    lastBuyAt: null,
    nextBuyPrice: "95",
    capitalUsedUsd: "100",
    totalCostBasisUsd: "100",
    capitalReservedUsd: "1000",
    totalQuantity: "1",
    avgEntryPrice: "100",
    marketScore: "60",
    status: "active",
    isImported: false,
    ...overrides,
  };
}

function liveFill(qty: number, price: number): any {
  return {
    state: "filled",
    terminal: true,
    filledQty: qty,
    grossFilledQty: qty,
    netFilledQty: qty,
    avgPrice: price,
    feesUsd: 0.1,
    feeSource: "venue",
    remainingQty: 0,
    intent: { exchangeOrderId: "venue-order-1", clientOrderId: "client-order-1" },
    newlyAppliedFillIds: ["fill-1"],
    alreadyApplied: false,
    deltaFilledQty: qty,
    deltaGrossValueUsd: qty * price,
    deltaFeesUsd: 0.1,
  };
}

function plusCfg(overrides: Record<string, unknown> = {}): any {
  return {
    enabled: true,
    activationExtraDipPct: 2,
    requireMainExhausted: true,
    requireReboundConfirmation: false,
    capitalAllocationPct: 20,
    maxExposurePctPerAsset: 80,
    maxPlusCyclesPerMain: 1,
    maxPlusEntries: 3,
    cooldownMinutesBetweenBuys: 60,
    entryDipSteps: [2, 3.5, 5],
    baseTpPctBtc: 4,
    baseTpPctEth: 4.5,
    trailingPctBtc: 1,
    trailingPctEth: 1.2,
    ...overrides,
  };
}

function recoveryCfg(overrides: Record<string, unknown> = {}): any {
  return {
    activationDrawdownPct: 10,
    maxRecoveryCyclesPerMain: 1,
    maxTotalCyclesPerPair: 3,
    capitalAllocationPct: 20,
    maxRecoveryCapitalUsd: 500,
    maxPairExposurePct: 80,
    cooldownMinutesAfterMainBuy: 60,
    cooldownMinutesBetweenRecovery: 60,
    minMarketScoreForRecovery: 40,
    requireReboundConfirmation: false,
    recoveryEntryDipSteps: [2, 3.5, 5],
    maxRecoveryEntries: 3,
    recoveryTpPctBtc: 3,
    recoveryTpPctEth: 3.5,
    ...overrides,
  };
}

describe("guards priorizados de rutas de compra IDCA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exitRepoMock.hasPendingExitInstruction.mockResolvedValue(false);
    liveGuardMock.validateLiveBuyIntention.mockResolvedValue({ allowed: true, reduced: false });
    reconcilerMock.submitAndReconcile.mockImplementation(async (params: any) => liveFill(params.requestedQty, 94));
    repoMock.getCycleById.mockImplementation(async (id: number) => ({ id, mode: "live", isImported: false }));
    repoMock.getSimulationWallet.mockResolvedValue({ availableBalanceUsd: "10000", usedBalanceUsd: "0", totalOrdersSimulated: 0 });
    repoMock.getAllActiveBotCycles.mockResolvedValue([]);
    repoMock.getClosedPlusCyclesCount.mockResolvedValue(0);
    repoMock.getClosedRecoveryCyclesCount.mockResolvedValue(0);
    repoMock.getActiveRecoveryCycles.mockResolvedValue([]);
    repoMock.getTotalBotPairExposureUsd.mockResolvedValue(0);
    repoMock.getTotalPairExposureUsd.mockResolvedValue(0);
    repoMock.getAllActiveBotCyclesForPair.mockResolvedValue([]);
    repoMock.getLastClosedRecoveryCycle.mockResolvedValue(null);
  });

  it("safety: cooldown bloquea antes de cualquier ejecución", async () => {
    const cycle = safetyCycle({ lastBuyAt: new Date() });
    await checkSafetyBuyForTest(cycle, 94, config(), assetConfig(), "simulation");
    expect(repoMock.createOrder).not.toHaveBeenCalled();
    expect(repoMock.updateCycle).not.toHaveBeenCalled();
    expect(reconcilerMock.submitAndReconcile).not.toHaveBeenCalled();
  });

  it("safety: pending-exit bloquea compra", async () => {
    exitRepoMock.hasPendingExitInstruction.mockResolvedValue(true);
    await checkSafetyBuyForTest(safetyCycle(), 94, config(), assetConfig(), "simulation");
    expect(repoMock.createOrder).not.toHaveBeenCalled();
    expect(repoMock.updateCycle).not.toHaveBeenCalled();
  });

  it("safety: simulation no usa reconciler live y persiste orden simulada", async () => {
    await checkSafetyBuyForTest(safetyCycle(), 94, config(), assetConfig(), "simulation");
    expect(reconcilerMock.submitAndReconcile).not.toHaveBeenCalled();
    expect(repoMock.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      orderType: "safety_buy",
      executionStatus: "simulated",
    }));
    expect(repoMock.updateCycle).toHaveBeenCalledWith(41, expect.objectContaining({ buyCount: 2 }));
  });

  it("safety: live pasa por reconciler y solo actualiza con fill confirmado", async () => {
    const cycle = safetyCycle({ mode: "live" });
    await checkSafetyBuyForTest(cycle, 94, config(), assetConfig(), "live");
    expect(liveGuardMock.validateLiveBuyIntention).toHaveBeenCalled();
    expect(reconcilerMock.submitAndReconcile).toHaveBeenCalledTimes(1);
    expect(repoMock.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      executionStatus: "filled",
      exchangeOrderId: "venue-order-1",
    }));
  });

  it("PLUS activation: pending-exit del main bloquea activación", async () => {
    exitRepoMock.hasPendingExitInstruction.mockResolvedValue(true);
    const main = safetyCycle({ id: 10, buyCount: 3, avgEntryPrice: "100", marketScore: "60" });
    await checkPlusActivationForTest(main, 97, config(), assetConfig(), "simulation", plusCfg());
    expect(repoMock.createCycle).not.toHaveBeenCalled();
    expect(repoMock.createOrder).not.toHaveBeenCalled();
  });

  it("PLUS activation: exposición del par en el límite bloquea antes de ejecutar", async () => {
    repoMock.getAllActiveBotCycles.mockResolvedValue([{ pair: "BTC/USD", capitalUsedUsd: "800" }]);
    const main = safetyCycle({ id: 10, buyCount: 3, avgEntryPrice: "100", marketScore: "60" });
    await checkPlusActivationForTest(main, 97, config(), assetConfig(), "simulation", plusCfg());
    expect(repoMock.createCycle).not.toHaveBeenCalled();
  });

  it("PLUS activation simulation crea ciclo sin reconciler; live usa reconciler", async () => {
    const main = safetyCycle({ id: 10, buyCount: 3, avgEntryPrice: "100", marketScore: "60" });
    await checkPlusActivationForTest(main, 97, config(), assetConfig(), "simulation", plusCfg());
    expect(reconcilerMock.submitAndReconcile).not.toHaveBeenCalled();
    expect(repoMock.createCycle).toHaveBeenCalledWith(expect.objectContaining({ cycleType: "plus", mode: "simulation" }));

    vi.clearAllMocks();
    await checkPlusActivationForTest({ ...main, mode: "live" }, 97, config(), assetConfig(), "live", plusCfg());
    expect(reconcilerMock.submitAndReconcile).toHaveBeenCalledTimes(1);
    expect(repoMock.createCycle).toHaveBeenCalledWith(expect.objectContaining({ cycleType: "plus", mode: "live" }));
  });

  it("PLUS safety: cooldown bloquea; v2 pending-exit bloquea", async () => {
    const plusCycle = safetyCycle({ id: 50, cycleType: "plus", lastBuyAt: new Date() });
    await checkPlusSafetyBuyForTest(plusCycle, 94, config(), assetConfig(), "simulation", plusCfg());
    expect(repoMock.createOrder).not.toHaveBeenCalled();

    vi.clearAllMocks();
    exitRepoMock.hasPendingExitInstruction.mockResolvedValue(true);
    const ready = safetyCycle({ id: 50, cycleType: "plus" });
    await checkPlusSafetyBuyForTest(ready, 94, config({ version: "v2_candidate" }), assetConfig(), "simulation", plusCfg());
    expect(repoMock.createOrder).not.toHaveBeenCalled();
  });

  it("PLUS safety simulation ejecuta sin reconciler cuando no hay bloqueos", async () => {
    const plusCycle = safetyCycle({ id: 50, cycleType: "plus" });
    await checkPlusSafetyBuyForTest(plusCycle, 94, config(), assetConfig(), "simulation", plusCfg());
    expect(reconcilerMock.submitAndReconcile).not.toHaveBeenCalled();
    expect(repoMock.createOrder).toHaveBeenCalledWith(expect.objectContaining({ executionStatus: "simulated" }));
  });

  it("recovery activation: cooldown tras compra main produce bloqueo explícito y no ejecuta", async () => {
    const main = safetyCycle({ id: 70, unrealizedPnlPct: "-12", marketScore: "60", lastBuyAt: new Date() });
    await checkRecoveryActivationForTest(main, 88, config(), assetConfig(), "simulation", recoveryCfg());
    expect(repoMock.createCycle).not.toHaveBeenCalled();
    expect(repoMock.createEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "recovery_cycle_blocked",
      payloadJson: expect.objectContaining({
        blockReasons: expect.arrayContaining([expect.stringContaining("cooldown_main_buy")]),
      }),
    }));
  });

  it("recovery activation simulation crea ciclo sin reconciler; live usa reconciler", async () => {
    const main = safetyCycle({ id: 70, unrealizedPnlPct: "-12", marketScore: "60", lastBuyAt: null });
    await checkRecoveryActivationForTest(main, 88, config(), assetConfig(), "simulation", recoveryCfg());
    expect(reconcilerMock.submitAndReconcile).not.toHaveBeenCalled();
    expect(repoMock.createCycle).toHaveBeenCalledWith(expect.objectContaining({ cycleType: "recovery", mode: "simulation" }));

    vi.clearAllMocks();
    reconcilerMock.submitAndReconcile.mockImplementation(async (params: any) => liveFill(params.requestedQty, 88));
    repoMock.getCycleById.mockImplementation(async (id: number) => ({ id, mode: "live", isImported: false }));
    await checkRecoveryActivationForTest({ ...main, mode: "live" }, 88, config(), assetConfig(), "live", recoveryCfg());
    expect(reconcilerMock.submitAndReconcile).toHaveBeenCalledTimes(1);
    expect(repoMock.createCycle).toHaveBeenCalledWith(expect.objectContaining({ cycleType: "recovery", mode: "live" }));
  });

  it("recovery safety: cooldown fijo bloquea; v2 pending-exit bloquea", async () => {
    const recoveryCycle = safetyCycle({ id: 80, cycleType: "recovery", lastBuyAt: new Date() });
    await checkRecoverySafetyBuyForTest(recoveryCycle, 94, config(), "simulation", recoveryCfg());
    expect(repoMock.createOrder).not.toHaveBeenCalled();

    vi.clearAllMocks();
    exitRepoMock.hasPendingExitInstruction.mockResolvedValue(true);
    const ready = safetyCycle({ id: 80, cycleType: "recovery" });
    await checkRecoverySafetyBuyForTest(ready, 94, config({ version: "v2_candidate" }), "simulation", recoveryCfg());
    expect(repoMock.createOrder).not.toHaveBeenCalled();
  });

  it("recovery safety simulation ejecuta sin reconciler cuando no hay bloqueos", async () => {
    const recoveryCycle = safetyCycle({ id: 80, cycleType: "recovery" });
    await checkRecoverySafetyBuyForTest(recoveryCycle, 94, config(), "simulation", recoveryCfg());
    expect(reconcilerMock.submitAndReconcile).not.toHaveBeenCalled();
    expect(repoMock.createOrder).toHaveBeenCalledWith(expect.objectContaining({ executionStatus: "simulated" }));
  });
});
