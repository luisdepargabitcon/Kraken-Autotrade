import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchange: {
    exchangeName: "revolutx",
    takerFeePct: 0.09,
    makerFeePct: 0,
    isInitialized: vi.fn(() => true),
    placeOrder: vi.fn(),
    getBalance: vi.fn(async () => ({})),
    getTicker: vi.fn(),
    getOHLC: vi.fn(),
    cancelOrder: vi.fn(),
    loadPairMetadata: vi.fn(),
    getPairMetadata: vi.fn(() => null),
    getStepSize: vi.fn(() => null),
    getOrderMin: vi.fn(() => null),
    hasMetadata: vi.fn(() => false),
    formatPair: vi.fn((pair: string) => pair),
    normalizePairFromExchange: vi.fn((pair: string) => pair),
    initialize: vi.fn(),
  },
  repo: {
    getCycleById: vi.fn(),
  },
}));

vi.mock("../IdcaRepository", () => mocks.repo);
vi.mock("../../exchanges/ExchangeFactory", () => ({
  ExchangeFactory: {
    getTradingExchange: vi.fn(() => mocks.exchange),
  },
}));

import { idcaExecutionManager } from "../IdcaExecutionManager";

function request(mode: unknown): any {
  return {
    cycleId: 1,
    pair: "BTC/USD",
    side: "sell",
    totalQuantity: 0.001,
    totalValueUsd: 100,
    urgency: "high",
    reason: "scope_test",
    mode,
    config: {
      ...idcaExecutionManager.createExecutionConfig({} as any),
      maxRetries: 0,
      retryDelayMs: 1,
    },
  };
}

describe("IdcaExecutionManager execution scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("NETWORK_FORBIDDEN_IN_TEST");
    }));
    mocks.repo.getCycleById.mockResolvedValue({ id: 1, pair: "BTC/USD", mode: "live" });
    mocks.exchange.isInitialized.mockReturnValue(true);
    mocks.exchange.placeOrder.mockResolvedValue({
      id: "order-1",
      filled: 0.001,
      price: 100000,
      value: 100,
      fees: 0.09,
      status: "filled",
    });
  });

  it("live válido con scope persistido live envía exactamente una orden", async () => {
    const result = await idcaExecutionManager.executeOrder(request("live"));
    expect(result.success).toBe(true);
    expect(mocks.exchange.placeOrder).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, "", "LIVE", "simulation", "disabled", "bogus"])("modo solicitado inválido/no-live %s no contacta el venue", async (badMode) => {
    await expect(idcaExecutionManager.executeOrder(request(badMode))).rejects.toThrow("IDCA_EXECUTION_MODE_GUARD");
    expect(mocks.exchange.placeOrder).not.toHaveBeenCalled();
  });

  it.each(["simulation", undefined, null, "", "LIVE", "disabled", "bogus"])("scope persistido inválido/discrepante %s no contacta el venue", async (persisted) => {
    mocks.repo.getCycleById.mockResolvedValue({ id: 1, pair: "BTC/USD", mode: persisted });
    await expect(idcaExecutionManager.executeOrder(request("live"))).rejects.toThrow("IDCA_EXECUTION_MODE_GUARD");
    expect(mocks.exchange.placeOrder).not.toHaveBeenCalled();
  });
});
