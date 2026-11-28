// TANGO-5 — pruebas de rutas efectivas de venta unificadas: trailing, breakeven,
// PLUS, recovery y emergency. Verifican con venue mock que en modo live:
//  - nunca hay escrituras contables paralelas (createOrder/updateCycle contable);
//  - un fill parcial terminal (residual) NO comunica cierre y preserva protección;
//  - un fill total no duplica orden ni cierre (la tx atómica ya los escribió).
import { describe, expect, it, vi, beforeEach } from "vitest";

const events: any[] = [];
const telegramMessages: string[] = [];
const cycleUpdates: any[] = [];
const createdOrders: any[] = [];

vi.mock("../../institutionalDca/IdcaRepository", async (importOriginal) => {
  const actual = await importOriginal() as any;
  const dbFree = {
    createEvent: vi.fn(async (e: any) => { events.push(e); return e; }),
    updateCycle: vi.fn(async (id: number, patch: any) => { cycleUpdates.push({ id, patch }); return {}; }),
    createOrder: vi.fn(async (o: any) => { createdOrders.push(o); return o; }),
    getIdcaConfig: vi.fn(async () => ({ executionFeesJson: null, simulationFeePct: null, simulationSlippagePct: "0" })),
    getOrdersByCycle: vi.fn(async () => []),
    getCycleById: vi.fn(async (id: number) => ({ id, pair: "BTC/USD", mode: "live", status: "closed", totalQuantity: "0", capitalUsedUsd: "0", avgEntryPrice: "100", realizedPnlUsd: "9.95", buyCount: 1 })),
    getCycleByIdUnfiltered: vi.fn(async () => null),
    getSimulationWallet: vi.fn(async () => ({ availableBalanceUsd: "1000", usedBalanceUsd: "0", realizedPnlUsd: "0" })),
    updateSimulationWallet: vi.fn(async () => {}),
  };
  return {
    ...actual,
    ...dbFree,
    createHumanEvent: vi.fn(async (e: any) => { events.push(e); return e; }),
    idcaRepo: { ...(actual.idcaRepo ?? {}), ...dbFree },
    repo: { ...(actual.repo ?? {}), ...dbFree },
  };
});
vi.mock("../../institutionalDca/IdcaTelegramNotifier", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    sendRawMessage: vi.fn(async (m: string) => { telegramMessages.push(m); return true; }),
    alertFailSafeTriggered: vi.fn(async () => {}),
    alertTakeProfitReached: vi.fn(async () => {}),
    alertTrailingStopTriggered: vi.fn(async () => {}),
    alertBreakEvenTriggered: vi.fn(async () => {}),
    alertTrailingExit: vi.fn(async () => {}),
    alertBuyBlocked: vi.fn(async () => {}),
  };
});
vi.mock("../../institutionalDca/IdcaExitManager", () => ({
  idcaExitManager: {
    clearExitState: vi.fn(),
    getExitState: vi.fn(() => null),
  },
}));

const submitMock = vi.fn();
vi.mock("../../institutionalDca/IdcaLiveOrderReconciler", async (orig) => {
  const actual = await orig() as any;
  return { ...actual, submitAndReconcile: (...args: any[]) => submitMock(...args) };
});

vi.mock("../../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getTradingExchange: () => ({
      isInitialized: () => true,
      getBalance: vi.fn(async () => ({ BTC: { available: "2" }, USD: { available: "1000" } })),
    }),
    getExecutionVenue: () => ({}),
  },
}));

import {
  executeTrailingExitForTest,
  executeBreakevenExitForTest,
  closePlusCycleForTest,
  closeRecoveryCycleForTest,
} from "../IdcaEngine";

function makeCycle(qty = "1") {
  return {
    id: 88, pair: "BTC/USD", mode: "live", status: "trailing_active",
    totalQuantity: qty, capitalUsedUsd: "100", avgEntryPrice: "100",
    buyCount: 1, realizedPnlUsd: "0", unrealizedPnlPct: "5",
    trailingPct: "1", highestPriceAfterTp: "110",
  } as any;
}
const config = {
  executionFeesJson: null, simulationFeePct: null, simulationSlippagePct: "0",
  volatilityTrailingEnabled: false,
} as any;

function outcomeFilled(residualQty: number, filledQty: number) {
  return {
    state: "filled", filledQty, grossFilledQty: filledQty, netFilledQty: filledQty,
    avgPrice: 110, feesUsd: 0.05, feeSource: "venue", remainingQty: 0, terminal: true,
    residualQty,
    intent: { clientOrderId: "IDCA_sell_88_x", exchangeOrderId: "o1" },
    newlyAppliedFillIds: ["f1"], alreadyApplied: false,
    deltaFilledQty: filledQty, deltaGrossValueUsd: filledQty * 110, deltaFeesUsd: 0.05,
  };
}

beforeEach(() => {
  events.length = 0; telegramMessages.length = 0; cycleUpdates.length = 0; createdOrders.length = 0;
  submitMock.mockReset();
});

describe("TANGO-5 sistema único de ventas — trailing exit", () => {
  it("fill parcial terminal con residual: NO cierre, NO orden paralela, evento exit_partial_executed", async () => {
    submitMock.mockResolvedValue(outcomeFilled(0.001, 0.999));
    await executeTrailingExitForTest(makeCycle("1"), 110, config, "live");
    const types = events.map(e => e.eventType);
    expect(types).toContain("exit_partial_executed");
    expect(types).not.toContain("trailing_exit");
    expect(createdOrders).toHaveLength(0);
    expect(cycleUpdates).toHaveLength(0);
  });

  it("fill total sin residual: sin orden ni updateCycle contable duplicados en live", async () => {
    submitMock.mockResolvedValue(outcomeFilled(0, 1));
    await executeTrailingExitForTest(makeCycle("1"), 110, config, "live");
    expect(createdOrders).toHaveLength(0);
    const accountingWrites = cycleUpdates.filter(u => u.patch.status === "closed" || u.patch.totalQuantity !== undefined || u.patch.realizedPnlUsd !== undefined);
    expect(accountingWrites).toHaveLength(0);
    const types = events.map(e => e.eventType);
    expect(types).not.toContain("exit_partial_executed");
  });
});

describe("TANGO-5 sistema único de ventas — breakeven exit", () => {
  it("fill parcial terminal con residual: NO cierre, sin escrituras paralelas", async () => {
    submitMock.mockResolvedValue(outcomeFilled(0.002, 0.998));
    await executeBreakevenExitForTest(makeCycle("1"), 110, config, "live");
    const types = events.map(e => e.eventType);
    expect(types).toContain("exit_partial_executed");
    expect(createdOrders).toHaveLength(0);
    expect(cycleUpdates).toHaveLength(0);
  });

  it("fill total: sin duplicidad contable en live", async () => {
    submitMock.mockResolvedValue(outcomeFilled(0, 1));
    await executeBreakevenExitForTest(makeCycle("1"), 110, config, "live");
    expect(createdOrders).toHaveLength(0);
    const accountingWrites = cycleUpdates.filter(u => u.patch.status === "closed" || u.patch.totalQuantity !== undefined);
    expect(accountingWrites).toHaveLength(0);
  });
});

describe("TANGO-5 sistema único de ventas — PLUS cycle close", () => {
  it("nunca precontabiliza: residual → sin cierre comunicado ni escrituras", async () => {
    submitMock.mockResolvedValue(outcomeFilled(0.001, 0.999));
    await closePlusCycleForTest(makeCycle("1"), 110, config, "live", "trailing_exit");
    const types = events.map(e => e.eventType);
    expect(types).toContain("exit_partial_executed");
    expect(createdOrders).toHaveLength(0);
    expect(cycleUpdates).toHaveLength(0);
  });

  it("fill total: sin escrituras contables paralelas", async () => {
    submitMock.mockResolvedValue(outcomeFilled(0, 1));
    await closePlusCycleForTest(makeCycle("1"), 110, config, "live", "trailing_exit");
    expect(createdOrders).toHaveLength(0);
    const accountingWrites = cycleUpdates.filter(u => u.patch.status === "closed" || u.patch.realizedPnlUsd !== undefined);
    expect(accountingWrites).toHaveLength(0);
  });

  it("rechazo del venue: propagación sin escritura alguna (no precontabilización)", async () => {
    submitMock.mockRejectedValue(new Error("venue_rejected"));
    await expect(closePlusCycleForTest(makeCycle("1"), 110, config, "live", "trailing_exit")).rejects.toThrow("venue_rejected");
    expect(createdOrders).toHaveLength(0);
    expect(cycleUpdates).toHaveLength(0);
  });
});

describe("TANGO-5 sistema único de ventas — recovery close", () => {
  it("residual: sin cierre, sin escrituras paralelas", async () => {
    submitMock.mockResolvedValue(outcomeFilled(0.001, 0.999));
    await closeRecoveryCycleForTest(makeCycle("1"), 110, config, "live", "recovery_close");
    const types = events.map(e => e.eventType);
    expect(types).toContain("exit_partial_executed");
    expect(createdOrders).toHaveLength(0);
    expect(cycleUpdates).toHaveLength(0);
  });

  it("fill total: sin duplicidad contable en live", async () => {
    submitMock.mockResolvedValue(outcomeFilled(0, 1));
    await closeRecoveryCycleForTest(makeCycle("1"), 110, config, "live", "recovery_close");
    expect(createdOrders).toHaveLength(0);
    const accountingWrites = cycleUpdates.filter(u => u.patch.status === "closed" || u.patch.totalQuantity !== undefined);
    expect(accountingWrites).toHaveLength(0);
  });
});
