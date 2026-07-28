import { beforeEach, describe, expect, it, vi } from "vitest";

const rows: any[] = [];
const updates: any[] = [];

vi.mock("../../../db", () => ({
  db: {
    select: () => ({ from: () => ({ orderBy: async () => rows.map(row => ({ ...row })) }) }),
    insert: () => ({ values: async () => [] }),
    update: () => ({
      set: (payload: any) => ({
        where: async () => {
          updates.push(payload);
          const row = rows[0];
          if (row) Object.assign(row, payload);
          return [];
        },
      }),
    }),
  },
}));

import { GridIsolatedEngine } from "../gridIsolatedEngine";

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cycle-recovery", rangeVersionId: "range-1", cycleNumber: 1, pair: "BTC/USD", status: "buy_filled",
    buyLevelId: null, sellLevelId: null, targetSellLevelId: null, targetRungLevelId: null,
    buyPrice: "100.00000000", sellPrice: null, targetSellPrice: "101.00000000", targetSellQuantity: "1.00000000", quantity: "1.00000000",
    grossPnlUsd: "0", feeTotalUsd: "0", taxReserveUsd: "0", netPnlUsd: "0", netPnlPct: "0",
    exitPolicyVersion: "CYCLE_OWNED_NET_TARGET_V3", targetKind: "CYCLE_OWNED_SYNTHETIC",
    targetCalculationJson: { stateVersion: 2 }, riskStateJson: null, makerExitStateJson: null,
    buyClientOrderId: null, sellClientOrderId: null, buyFilledAt: new Date(), sellFilledAt: null, holdTimeMinutes: 0,
    requiresReview: false, reviewReason: null, reviewCode: null, reviewDetectedAt: null, reviewSource: null,
    createdAt: new Date(), completedAt: null, ...overrides,
  };
}

describe("GridIsolatedEngine V3 recovery", () => {
  beforeEach(() => { rows.length = 0; updates.length = 0; });

  it("R1 marca mismatch V3 para revisión sin reemplazar su snapshot ni campos financieros", async () => {
    const row = baseRow(); const original = structuredClone(row.targetCalculationJson); rows.push(row);
    await (new GridIsolatedEngine() as any).loadCycles();
    expect(row).toMatchObject({ requiresReview: true, reviewSource: "target_calculation_json" });
    expect(row.reviewCode).toBeTruthy(); expect(row.reviewReason).toBeTruthy(); expect(row.reviewDetectedAt).toBeTruthy();
    expect(row.targetCalculationJson).toEqual(original);
    for (const payload of updates) expect(Object.keys(payload)).not.toEqual(expect.arrayContaining(["buyPrice", "quantity", "targetSellPrice", "targetSellQuantity", "targetCalculationJson", "exitPolicyVersion", "targetKind"]));
  });

  it("R2 carga el ciclo protegido #26 sin backfill ni mutación financiera", async () => {
    const row = baseRow({
      id: "a2a0b7ca-a710-4402-8a11-54222bf98455", buyPrice: "62532.30", quantity: "0.00383786", targetSellPrice: "65692.19591410",
      targetSellQuantity: null, exitPolicyVersion: null, targetKind: null, targetCalculationJson: null,
    });
    const original = structuredClone(row); rows.push(row);
    const engine = new GridIsolatedEngine(); await (engine as any).loadCycles();
    const cycle = (engine as any).cycles[0];
    expect(cycle).toMatchObject({ id: original.id, buyPrice: 62532.3, quantity: 0.00383786, targetSellPrice: 65692.1959141, exitPolicyVersion: null, targetKind: null, targetCalculationJson: null });
    expect(row).toMatchObject({ buyPrice: original.buyPrice, quantity: original.quantity, targetSellPrice: original.targetSellPrice, targetCalculationJson: null });
    expect(updates).toEqual([]);
  });
});
