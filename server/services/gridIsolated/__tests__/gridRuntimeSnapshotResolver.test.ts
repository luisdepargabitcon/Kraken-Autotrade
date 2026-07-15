import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveRuntimeSnapshot,
  type GridRuntimeSnapshotEngineLike,
} from "../gridRuntimeSnapshotResolver";

const RANGE_ID = "range-active";

const baseConfig = {
  id: "cfg-1",
  mode: "SHADOW",
  isActive: true,
  pair: "BTC/USD",
} as any;

const activeRange = {
  id: RANGE_ID,
  versionNumber: 3,
  status: "active",
  createdAt: new Date(),
} as any;

const makeLevel = (overrides: any = {}) => ({
  id: "l1",
  rangeVersionId: RANGE_ID,
  status: "planned",
  side: "BUY",
  price: 60000,
  quantity: 0.001,
  exchangeOrderId: null,
  ...overrides,
});

const makeCycle = (overrides: any = {}) => ({
  id: "c1",
  rangeVersionId: RANGE_ID,
  status: "buy_filled",
  buyLevelId: "l1",
  sellLevelId: null,
  buyPrice: 60000,
  quantity: 0.001,
  netPnlUsd: 0,
  ...overrides,
});

const runtimeEngine = (overrides: any = {}): GridRuntimeSnapshotEngineLike => {
  const state = {
    config: baseConfig,
    activeRangeVersion: activeRange,
    levels: [makeLevel()],
    cycles: [makeCycle()],
    running: false,
    lastTickAt: null,
    lastTickReason: null,
    lastShadowExecutionPrice: { price: 61000 },
    ...overrides,
  };
  return {
    getConfig: () => state.config,
    getLevels: () => state.levels,
    getCycles: () => state.cycles,
    getActiveRangeVersion: () => state.activeRangeVersion,
    getRunning: () => state.running,
    getLastTickAt: () => state.lastTickAt,
    getLastTickReason: () => state.lastTickReason,
    getLastShadowExecutionPrice: () => state.lastShadowExecutionPrice,
  };
};

describe("resolveRuntimeSnapshot", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses runtime data when engine config is loaded", async () => {
    const engine = runtimeEngine();
    const snapshot = await resolveRuntimeSnapshot(engine);
    expect(snapshot.source).toBe("runtime");
    expect(snapshot.mode).toBe("SHADOW");
    expect(snapshot.isActive).toBe(true);
    expect(snapshot.activeRangeVersionId).toBe(RANGE_ID);
    expect(snapshot.openCycles).toBe(1);
    expect(snapshot.currentPrice).toBe(61000);
    expect(snapshot.currentPriceSource).toBe("runtime");
  });

  it("counts orphan cycles when activeRangeVersionId is null", async () => {
    const engine = runtimeEngine({
      activeRangeVersion: null,
      cycles: [
        makeCycle({ id: "c1", status: "buy_filled", rangeVersionId: "range-old" }),
        makeCycle({ id: "c2", status: "buy_filled", rangeVersionId: "range-old" }),
      ],
      levels: [],
    });
    const snapshot = await resolveRuntimeSnapshot(engine);
    expect(snapshot.openCycles).toBe(2);
    expect(snapshot.activeOpenCyclesCount).toBe(0);
    expect(snapshot.orphanOpenCyclesCount).toBe(2);
  });

  it("does not count completed cycles as open", async () => {
    const engine = runtimeEngine({
      cycles: [
        makeCycle({ id: "c1", status: "completed" }),
        makeCycle({ id: "c2", status: "buy_filled" }),
      ],
    });
    const snapshot = await resolveRuntimeSnapshot(engine);
    expect(snapshot.openCycles).toBe(1);
    expect(snapshot.globalOpenCyclesCount).toBe(1);
  });

  it("keeps realOpenOrdersCount at 0 when no exchange orders exist", async () => {
    const engine = runtimeEngine({
      levels: [makeLevel({ exchangeOrderId: null })],
    });
    const snapshot = await resolveRuntimeSnapshot(engine);
    expect(snapshot.realOpenOrdersCount).toBe(0);
  });

  it("does not mutate the engine object", async () => {
    const engine = runtimeEngine();
    const before = JSON.stringify(engine);
    await resolveRuntimeSnapshot(engine);
    expect(JSON.stringify(engine)).toBe(before);
  });
});
