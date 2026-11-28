// TANGO 10.1 — caller-level integration: executeExit with a terminal partial
// fill (residual) must NOT emit full-close semantics. Assertions on events,
// exit-state cleanup and snapshot behaviour, not only computeSellApplication.
import { describe, expect, it, vi, beforeEach } from "vitest";

const events: any[] = [];
const telegramMessages: string[] = [];
const clearedCycles: number[] = [];
const cycleUpdates: any[] = [];
const createdOrders: any[] = [];

vi.mock("../../institutionalDca/IdcaRepository", async (importOriginal) => {
  const actual = await importOriginal() as any;
  const dbFree = {
    createEvent: vi.fn(async (e: any) => { events.push(e); return e; }),
    updateCycle: vi.fn(async (id: number, patch: any) => { cycleUpdates.push({ id, patch }); return {}; }),
    createOrder: vi.fn(async (o: any) => { createdOrders.push(o); return o; }),
    getIdcaConfig: vi.fn(async () => ({ executionFeesJson: null, simulationFeePct: null })),
    getOrdersByCycle: vi.fn(async () => []),
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
    sendRawMessage: vi.fn(async (m: string) => { telegramMessages.push(m); }),
    alertFailSafeTriggered: vi.fn(async () => {}),
    alertTakeProfitReached: vi.fn(async () => {}),
    alertTrailingStopTriggered: vi.fn(async () => {}),
    alertBreakEvenTriggered: vi.fn(async () => {}),
  };
});
vi.mock("../../institutionalDca/IdcaExitManager", () => ({
  idcaExitManager: {
    clearExitState: vi.fn((id: number) => { clearedCycles.push(id); }),
    getExitState: vi.fn(() => null),
  },
}));

// Mock the reconciler: submitAndReconcile returns a FILLED outcome WITH residual.
const submitMock = vi.fn();
vi.mock("../../institutionalDca/IdcaLiveOrderReconciler", async (orig) => {
  const actual = await orig() as any;
  return {
    ...actual,
    submitAndReconcile: (...args: any[]) => submitMock(...args),
  };
});

// Exchange balance mock: sufficient BTC so dust logic passes.
vi.mock("../../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getTradingExchange: () => ({
      getBalance: vi.fn(async () => ({ BTC: { available: "2" }, USD: { available: "1000" } })),
    }),
    getExecutionVenue: () => ({}),
  },
}));

import { executeExit } from "../IdcaEngine";

function makeCycle(qty = "1") {
  return {
    id: 77, pair: "BTC/USD", mode: "live", status: "active",
    totalQuantity: qty, capitalUsedUsd: "100", avgEntryPrice: "100",
    buyCount: 1, realizedPnlUsd: "0", unrealizedPnlPct: "5",
  } as any;
}
function makeSignal() {
  return {
    exitType: "take_profit", exitPrice: 110, exitReason: "tp test", urgency: "normal",
    metadata: { currentState: { unrealizedPnlPct: 10 } },
  } as any;
}
const config = { executionFeesJson: null, simulationFeePct: null } as any;
const assetConfig = {} as any;

function filledOutcomeWithResidual(residualQty: number, filledQty: number) {
  return {
    state: "filled", filledQty, grossFilledQty: filledQty, netFilledQty: filledQty,
    avgPrice: 110, feesUsd: 0.05, feeSource: "venue", remainingQty: 0, terminal: true,
    residualQty,
    intent: { clientOrderId: "IDCA_sell_77_x", exchangeOrderId: "o1" },
    newlyAppliedFillIds: ["f1"], alreadyApplied: false,
    deltaFilledQty: filledQty, deltaGrossValueUsd: filledQty * 110, deltaFeesUsd: 0.05,
  };
}

describe("executeExit caller-level: salida con residual NO es cierre (TANGO 10.1)", () => {
  beforeEach(() => {
    events.length = 0; telegramMessages.length = 0; clearedCycles.length = 0;
    cycleUpdates.length = 0; createdOrders.length = 0;
    submitMock.mockReset();
  });

  it("fill 0.999/1 con residual: evento parcial, sin cierre, sin limpieza de estado, sin snapshot de cierre", async () => {
    submitMock.mockResolvedValue(filledOutcomeWithResidual(0.001, 0.999));
    await executeExit(makeCycle("1"), makeSignal(), config, assetConfig, "live");

    const types = events.map(e => e.eventType);
    // Evento de salida parcial explícito con cantidades proporcionales.
    expect(types).toContain("exit_partial_executed");
    expect(types).not.toContain("exit_executed");
    const partial = events.find(e => e.eventType === "exit_partial_executed");
    expect(partial.severity).toBe("warn");
    expect(partial.payloadJson.cycleClosed).toBe(false);
    expect(partial.payloadJson.residualQty).toBeCloseTo(0.001, 8);
    expect(partial.payloadJson.quantitySold).toBeCloseTo(0.999, 8);
    // El estado de salida NO se limpia: la protección sigue activa.
    expect(clearedCycles).toHaveLength(0);
    // La contabilidad live la aplica el reconciliador atómico: el engine no
    // escribe ni cierre ni orden duplicada.
    expect(cycleUpdates).toHaveLength(0);
    expect(createdOrders).toHaveLength(0);
    // Telegram comunica salida parcial, no venta total.
    expect(telegramMessages.some(m => /SALIDA PARCIAL/i.test(m))).toBe(true);
    expect(telegramMessages.some(m => /TAKE PROFIT alcanzado|CICLO CERRADO/i.test(m))).toBe(false);
  });

  it("fill 1/1 exacto sin residual: flujo de cierre normal (control)", async () => {
    submitMock.mockResolvedValue(filledOutcomeWithResidual(0, 1));
    await executeExit(makeCycle("1"), makeSignal(), config, assetConfig, "live");
    const types = events.map(e => e.eventType);
    expect(types).not.toContain("exit_partial_executed");
    expect(types).toContain("exit_executed");
    expect(clearedCycles).toContain(77);
  });

  it("estado no filled (uncertain): excepción, ciclo intacto, sin eventos de salida", async () => {
    submitMock.mockResolvedValue({ ...filledOutcomeWithResidual(0, 0), state: "uncertain", filledQty: 0 });
    await executeExit(makeCycle("1"), makeSignal(), config, assetConfig, "live");
    const types = events.map(e => e.eventType);
    expect(types).not.toContain("exit_executed");
    expect(types).not.toContain("exit_partial_executed");
    expect(clearedCycles).toHaveLength(0);
  });
});
