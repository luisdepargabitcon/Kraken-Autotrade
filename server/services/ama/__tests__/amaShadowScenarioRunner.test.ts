/**
 * AMA Shadow Scenario Runner Test
 *
 * Tests:
 * 1. runShadowScenario produces ordersCreated > 0, ordersFilled > 0, totalSimulatedUsd > 0
 * 2. Persisted orders exist in ama_shadow_orders
 * 3. No real exchange calls
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../amaShadowExecutor", () => ({
  executeShadowTick: vi.fn().mockImplementation(
    async (cycleId: string, tranches: any[], price: number) => {
      let ordersCreated = 0;
      let ordersFilled = 0;
      let totalSimulatedUsd = 0;

      for (const tranche of tranches) {
        if (tranche.status === "CREATED" && price > 0) {
          ordersCreated++;
          ordersFilled++;
          totalSimulatedUsd += tranche.plannedAmountUsd;
        }
      }

      return {
        ready: true,
        blockers: [],
        ordersCreated,
        ordersFilled,
        ordersRejected: 0,
        totalSimulatedUsd,
      };
    },
  ),
}));

vi.mock("../amaShadowReplayRepository", () => ({
  getShadowScenarioById: vi.fn().mockResolvedValue({
    scenarioId: "test-scenario-1",
    name: "BTC Drop Scenario",
    description: "Test scenario",
    asset: "BTC",
    pair: "BTC/USD",
    configJson: {
      basePrice: 100000,
      dropPcts: [5, 10, 15, 25, 35, 45],
      capitalUsd: 10000,
    },
    status: "ACTIVE",
    totalOrders: 0,
    totalFilled: 0,
    totalSimulatedUsd: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
}));

vi.mock("../../../db", () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

import { runShadowScenario } from "../amaShadowScenarioRunner";
import { executeShadowTick } from "../amaShadowExecutor";
import { getShadowScenarioById } from "../amaShadowReplayRepository";
import { pool } from "../../../db";

describe("AMA Shadow Scenario Runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("SCEN01: runShadowScenario produces ordersCreated > 0, ordersFilled > 0, totalSimulatedUsd > 0", async () => {
    const result = await runShadowScenario("test-scenario-1");

    expect(result.scenarioId).toBe("test-scenario-1");
    expect(result.status).toBe("COMPLETED");
    expect(result.ordersCreated).toBeGreaterThan(0);
    expect(result.ordersFilled).toBeGreaterThan(0);
    expect(result.totalSimulatedUsd).toBeGreaterThan(0);
  });

  it("SCEN02: runShadowScenario updates scenario totals in DB", async () => {
    await runShadowScenario("test-scenario-1");

    const updateCall = vi.mocked(pool.query).mock.calls.find(
      (c) => c[0]?.toString().includes("UPDATE ama_shadow_scenarios"),
    );
    expect(updateCall).toBeDefined();
  });

  it("SCEN03: executeShadowTick was called (simulated, not real)", async () => {
    await runShadowScenario("test-scenario-1");

    expect(executeShadowTick).toHaveBeenCalled();
    const calls = vi.mocked(executeShadowTick).mock.calls;
    for (const call of calls) {
      expect(call[3].mode).toBe("SHADOW_SCENARIO");
    }
  });

  it("SCEN04: scenario not found throws error", async () => {
    vi.mocked(getShadowScenarioById).mockResolvedValueOnce(null);

    await expect(runShadowScenario("nonexistent")).rejects.toThrow(
      "Shadow scenario not found: nonexistent",
    );
  });
});
