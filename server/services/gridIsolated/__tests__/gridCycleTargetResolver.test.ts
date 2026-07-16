import { describe, it, expect } from "vitest";
import {
  resolveTargetSellForCycle,
  buildClaimedSellIds,
  type ResolveTargetSellInput,
} from "../gridCycleTargetResolver";
import type { GridCycle, GridLevel, GridRangeVersion } from "../gridIsolatedTypes";

const RANGE_ID = "range-btc-001";
const PAIR = "BTC/USD";

const makeRange = (overrides: Partial<GridRangeVersion> = {}): GridRangeVersion => ({
  id: RANGE_ID,
  versionNumber: 1,
  pair: PAIR,
  status: "replaced",
  midPrice: 64000,
  upperPrice: 66000,
  lowerPrice: 62000,
  bandUpper: 66000,
  bandMiddle: 64000,
  bandLower: 62000,
  bandWidthPct: 3,
  atrPct: 1.5,
  regime: "normal",
  levelsCount: 10,
  geometricRatio: 1.05,
  capitalBudgetUsd: 2000,
  capitalPerLevelUsd: 200,
  netProfitTargetPct: 0.8,
  createdAt: new Date(),
  activatedAt: new Date(),
  closedAt: new Date(),
  ...overrides,
});

const makeLevel = (overrides: Partial<GridLevel> = {}): GridLevel => ({
  id: "sell-1",
  rangeVersionId: RANGE_ID,
  levelIndex: 1,
  side: "SELL",
  price: 64893.12322364,
  notionalUsd: 246,
  quantity: 0.00379061,
  status: "planned",
  filledQuantity: 0,
  filledPrice: null,
  clientOrderId: "sell-client-1",
  exchangeOrderId: null,
  postOnlyAttempts: 0,
  usedTakerFallback: false,
  netProfitTargetUsd: 1.72,
  feeEstimateUsd: 0.22,
  taxReserveUsd: 0.34,
  createdAt: new Date(),
  placedAt: null,
  filledAt: null,
  cancelledAt: null,
  ...overrides,
});

const makeCycle = (overrides: Partial<GridCycle> = {}): GridCycle => ({
  id: "cycle-a",
  rangeVersionId: RANGE_ID,
  cycleNumber: 1,
  pair: PAIR,
  status: "buy_filled",
  buyLevelId: "buy-1",
  sellLevelId: null,
  targetSellLevelId: null,
  buyPrice: 63264.4,
  sellPrice: null,
  targetSellPrice: null,
  targetSellQuantity: null,
  quantity: 0.00379061,
  grossPnlUsd: 0,
  feeTotalUsd: 0,
  taxReserveUsd: 0,
  netPnlUsd: 0,
  netPnlPct: 0,
  buyClientOrderId: "buy-client-1",
  sellClientOrderId: null,
  buyFilledAt: new Date(),
  sellFilledAt: null,
  holdTimeMinutes: null,
  createdAt: new Date(),
  completedAt: null,
  ...overrides,
});

const makeInput = (overrides: Partial<ResolveTargetSellInput> = {}): ResolveTargetSellInput => ({
  cycle: makeCycle(),
  levels: [makeLevel()],
  rangeVersions: [makeRange()],
  alreadyClaimedSellIds: new Set(),
  ...overrides,
});

describe("gridCycleTargetResolver", () => {
  it("resolves target SELL for cycle A (exact real data)", () => {
    const input = makeInput();
    const result = resolveTargetSellForCycle(input);
    expect(result.resolved).toBe(true);
    expect(result.uniqueMatch).toBe(true);
    expect(result.candidateCount).toBe(1);
    expect(result.targetSellLevelId).toBe("sell-1");
    expect(result.targetSellPrice).toBe(64893.12322364);
    expect(result.targetSellQuantity).toBe(0.00379061);
    expect(result.requiresReview).toBe(false);
  });

  it("resolves target SELL for cycle B with higher price", () => {
    const input = makeInput({
      cycle: makeCycle({ id: "cycle-b", buyPrice: 62532.3, quantity: 0.00383786 }),
      levels: [makeLevel({ id: "sell-b", price: 65692.19591410, quantity: 0.00383786 })],
    });
    const result = resolveTargetSellForCycle(input);
    expect(result.resolved).toBe(true);
    expect(result.targetSellPrice).toBe(65692.19591410);
  });

  it("requires review when two compatible SELL levels exist", () => {
    const input = makeInput({
      levels: [
        makeLevel({ id: "sell-1", price: 64893.12322364 }),
        makeLevel({ id: "sell-2", price: 65000, quantity: 0.00379061 }),
      ],
    });
    const result = resolveTargetSellForCycle(input);
    expect(result.resolved).toBe(false);
    expect(result.uniqueMatch).toBe(false);
    expect(result.candidateCount).toBe(2);
    expect(result.requiresReview).toBe(true);
  });

  it("does not reuse a SELL already claimed by another cycle", () => {
    const input = makeInput({
      alreadyClaimedSellIds: new Set(["sell-1"]),
    });
    const result = resolveTargetSellForCycle(input);
    expect(result.resolved).toBe(false);
    expect(result.candidateCount).toBe(0);
    expect(result.requiresReview).toBe(true);
  });

  it("does not resolve when quantity differs beyond tolerance", () => {
    const input = makeInput({
      levels: [makeLevel({ quantity: 0.005 })],
    });
    const result = resolveTargetSellForCycle(input);
    expect(result.resolved).toBe(false);
    expect(result.candidateCount).toBe(0);
    expect(result.requiresReview).toBe(true);
  });

  it("does not resolve across rangeVersionId", () => {
    const input = makeInput({
      levels: [makeLevel({ rangeVersionId: "range-eth-002" })],
      rangeVersions: [makeRange(), makeRange({ id: "range-eth-002", pair: "ETH/USD" })],
    });
    const result = resolveTargetSellForCycle(input);
    expect(result.resolved).toBe(false);
    expect(result.candidateCount).toBe(0);
    expect(result.requiresReview).toBe(true);
  });

  it("does not resolve when SELL price is below or equal to buyPrice", () => {
    const input = makeInput({
      levels: [makeLevel({ price: 63264.4 })],
    });
    const result = resolveTargetSellForCycle(input);
    expect(result.resolved).toBe(false);
    expect(result.candidateCount).toBe(0);
    expect(result.requiresReview).toBe(true);
  });

  it("rejects when range pair does not match cycle pair", () => {
    const input = makeInput({
      rangeVersions: [makeRange({ pair: "ETH/USD" })],
    });
    const result = resolveTargetSellForCycle(input);
    expect(result.resolved).toBe(false);
    expect(result.requiresReview).toBe(true);
    expect(result.reason).toContain("ETH/USD");
  });

  it("requires review when rangeVersion is missing", () => {
    const input = makeInput({
      rangeVersions: [],
    });
    const result = resolveTargetSellForCycle(input);
    expect(result.resolved).toBe(false);
    expect(result.requiresReview).toBe(true);
  });

  it("buildClaimedSellIds collects target sell ids excluding given cycle", () => {
    const cycles: GridCycle[] = [
      makeCycle({ id: "c1", targetSellLevelId: "sell-1" }),
      makeCycle({ id: "c2", targetSellLevelId: "sell-2" }),
    ];
    const ids = buildClaimedSellIds(cycles, "c1");
    expect(ids.has("sell-2")).toBe(true);
    expect(ids.has("sell-1")).toBe(false);
  });
});
