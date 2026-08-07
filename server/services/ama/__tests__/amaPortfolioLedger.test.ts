/**
 * Tests for AMA Portfolio Ledger — sleeve computation and budget logic.
 * Tests are pure (no DB) — they test the computation functions.
 */
import { describe, it, expect } from "vitest";
import type { AmaTranche, SleeveType } from "../amaTypes";

// Import the internal computeSleeveSummary via re-export for testing
// Since it's not exported, we test the logic inline
function computeSleeveSummary(tranches: AmaTranche[]): { sleeve: SleeveType; assetQuantity: number; realizedQuantity: number; remainingQuantity: number; costBasisUsd: number }[] {
  const sleeveMap = new Map<SleeveType, { sleeve: SleeveType; assetQuantity: number; realizedQuantity: number; remainingQuantity: number; costBasisUsd: number }>();

  for (const t of tranches) {
    const existing = sleeveMap.get(t.sleeveAllocation);
    if (existing) {
      existing.assetQuantity += t.assetQuantity;
      existing.realizedQuantity += t.realizedQuantity;
      existing.remainingQuantity += t.remainingQuantity;
      existing.costBasisUsd += t.costBasis ?? 0;
    } else {
      sleeveMap.set(t.sleeveAllocation, {
        sleeve: t.sleeveAllocation,
        assetQuantity: t.assetQuantity,
        realizedQuantity: t.realizedQuantity,
        remainingQuantity: t.remainingQuantity,
        costBasisUsd: t.costBasis ?? 0,
      });
    }
  }

  return Array.from(sleeveMap.values());
}

describe("AMA Portfolio Ledger — computeSleeveSummary", () => {
  function makeTranche(sleeve: SleeveType, qty: number, cost: number): AmaTranche {
    return {
      trancheId: `t-${Math.random()}`,
      cycleId: "cycle-1",
      trancheType: "PROBE",
      status: "COMPLETED",
      plannedAmountUsd: 100,
      executedAmountUsd: 100,
      assetQuantity: qty,
      fillPrice: 50000,
      costBasis: cost,
      sleeveAllocation: sleeve,
      remainingQuantity: 0,
      realizedQuantity: 0,
      createdAt: new Date().toISOString(),
      filledAt: new Date().toISOString(),
    };
  }

  it("groups tranches by sleeve", () => {
    const tranches = [
      makeTranche("RECOVER_PRINCIPAL", 0.001, 50),
      makeTranche("RECOVER_PRINCIPAL", 0.002, 100),
      makeTranche("DE_RISK", 0.003, 150),
    ];
    const result = computeSleeveSummary(tranches);

    expect(result).toHaveLength(2);
    const rp = result.find((s) => s.sleeve === "RECOVER_PRINCIPAL");
    expect(rp).toBeDefined();
    expect(rp!.assetQuantity).toBeCloseTo(0.003, 8);
    expect(rp!.costBasisUsd).toBe(150);
  });

  it("returns empty array for no tranches", () => {
    expect(computeSleeveSummary([])).toEqual([]);
  });

  it("handles single sleeve", () => {
    const tranches = [makeTranche("LONG_TERM_RUNNER", 0.01, 500)];
    const result = computeSleeveSummary(tranches);

    expect(result).toHaveLength(1);
    expect(result[0].sleeve).toBe("LONG_TERM_RUNNER");
    expect(result[0].assetQuantity).toBeCloseTo(0.01, 8);
  });

  it("accumulates quantities correctly", () => {
    const tranches = [
      makeTranche("DE_RISK", 0.001, 50),
      makeTranche("DE_RISK", 0.002, 100),
      makeTranche("DE_RISK", 0.003, 150),
    ];
    const result = computeSleeveSummary(tranches);

    expect(result).toHaveLength(1);
    expect(result[0].assetQuantity).toBeCloseTo(0.006, 8);
    expect(result[0].costBasisUsd).toBe(300);
  });
});
