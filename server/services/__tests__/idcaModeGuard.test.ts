import { describe, expect, it } from "vitest";
import { isLiveExecutionMode } from "../institutionalDca/IdcaEngine";
import { idcaExecutionManager } from "../institutionalDca/IdcaExecutionManager";

// STRICT MODE GUARD truth table (P0): only exact "live" may authorize real
// venue interaction. Every other value — including corrupted, empty or
// undefined state — must fail closed.

describe("isLiveExecutionMode truth table", () => {
  const cases: Array<[unknown, boolean]> = [
    ["live", true],
    ["simulation", false],
    ["shadow", false],
    ["dry_run", false],
    ["replay", false],
    ["LIVE", false],        // case corruption must not pass
    [" live", false],       // whitespace corruption must not pass
    ["live ", false],
    ["", false],
    [undefined, false],
    [null, false],
    [0, false],
    [1, false],
    [true, false],
    [{ mode: "live" }, false], // object corruption must not pass
    [["live"], false],         // array corruption must not pass
    ["SIMULATION", false],
    ["unknown", false],
  ];

  for (const [value, expected] of cases) {
    it(`mode ${JSON.stringify(value)} -> ${expected ? "LIVE" : "NOT live"}`, () => {
      expect(isLiveExecutionMode(value)).toBe(expected);
    });
  }
});

describe("IdcaExecutionManager strict mode gate (P0)", () => {
  const baseRequest = {
    cycleId: 1,
    pair: "BTC/USD",
    side: "sell" as const,
    totalQuantity: 0.001,
    totalValueUsd: 100,
    urgency: "high" as const,
    reason: "test",
    config: idcaExecutionManager.createExecutionConfig({} as any),
  };

  it("rejects execution without mode (undefined)", async () => {
    await expect(idcaExecutionManager.executeOrder(baseRequest as any))
      .rejects.toThrow("IDCA_EXECUTION_MODE_GUARD");
  });

  it("rejects execution with simulation mode", async () => {
    await expect(idcaExecutionManager.executeOrder({ ...baseRequest, mode: "simulation" } as any))
      .rejects.toThrow("IDCA_EXECUTION_MODE_GUARD");
  });

  it("rejects execution with corrupted mode values", async () => {
    for (const bad of ["LIVE", " live", "", null, "unknown"]) {
      await expect(idcaExecutionManager.executeOrder({ ...baseRequest, mode: bad } as any))
        .rejects.toThrow("IDCA_EXECUTION_MODE_GUARD");
    }
  });
});
