import { describe, it, expect } from "vitest";
import { buildGridOperationalViewModel } from "../buildGridOperationalViewModel";

function makeInput(overrides?: any) {
  const base = {
    mode: "SHADOW",
    config: {
      pair: "BTC/USD",
      isActive: true,
      executionPolicy: "MAKER_ONLY",
      gridWalletMaxUsd: "5000",
      netProfitTargetPct: "0.80",
      adaptiveRangeProfile: "balanced",
      adaptiveRangeMinViableLevels: 8,
      hodlRecoveryEnabled: false,
      gridWalletCompoundProfits: true,
    },
    status: {
      isRunning: true,
      activeRangeVersionId: "range-active-v1",
      totalNetPnlUsd: 123.45,
      realOpenOrdersCount: 2,
    },
    levels: [
      {
        id: "buy-active-1",
        rangeVersionId: "range-active-v1",
        side: "BUY",
        price: "90000",
        quantity: "0.01",
        status: "planned",
        levelIndex: 0,
      },
      {
        id: "rung-active-1",
        rangeVersionId: "range-active-v1",
        side: "SELL",
        price: "95000",
        quantity: "0.01",
        status: "planned",
        levelIndex: 5,
      },
      {
        id: "legacy-sell-1",
        rangeVersionId: "range-old-v0",
        side: "SELL",
        price: "96000",
        quantity: "0.01",
        status: "open",
        levelIndex: 6,
      },
    ],
    cycles: [
      {
        id: "cycle-27",
        cycleNumber: 27,
        pair: "BTC/USD",
        status: "buy_filled",
        rangeVersionId: "range-active-v1",
        buyLevelId: "buy-active-1",
        targetSellLevelId: null,
        targetRungLevelId: null,
        buyPrice: "92000",
        targetSellPrice: "97000",
        quantity: "0.01",
        exitPolicyVersion: "CYCLE_OWNED_NET_TARGET_V3",
        targetKind: "CYCLE_OWNED_SYNTHETIC",
        targetCalculationJson: {
          selected: true,
          stateVersion: 2,
          policyVersion: "CYCLE_OWNED_NET_TARGET_V3",
          targetKind: "CYCLE_OWNED_SYNTHETIC",
          targetSellLevelId: null,
          targetRungLevelId: null,
          targetSellPrice: 97000,
          targetSellQuantity: 0.01,
          grossExitGapPct: 1.0,
          actualGrossGapPct: 1.0,
          grossPnlUsd: 5,
          buyFeePct: 0,
          sellFeePct: 0.09,
          spreadBufferPct: 0.01,
          safetyBufferPct: 0.10,
          taxReservePct: 20,
          buyFeeUsd: 0,
          sellFeeUsd: 0.0873,
          exchangeFeesUsd: 0.0873,
          operationalCostsUsd: 0.1012,
          netBeforeTaxUsd: 4.8115,
          netBeforeTaxPct: 0.523,
          taxReserveUsd: 0.9623,
          availablePnlAfterTaxUsd: 3.8492,
          availablePnlAfterTaxPct: 0.4185,
          netProfitTargetPct: 0.4,
          priceTickSize: 0.1,
          quantityStep: 0.00001,
          minOrderBase: 0.0001,
          minOrderQuote: 1,
          minOrderUsd: 1,
          maxOrderBase: 100,
          baseCurrency: "BTC",
          quoteCurrency: "USD",
          constraintsSource: "revolut_x_authenticated_configuration_pairs",
          constraintsFetchedAt: new Date().toISOString(),
          explanation: "target V3",
          rejectedCandidates: [],
        },
        openedAt: new Date(Date.now() - 1800000).toISOString(),
      },
      {
        id: "cycle-25",
        cycleNumber: 25,
        pair: "BTC/USD",
        status: "open",
        rangeVersionId: "range-old-v0",
        buyLevelId: "buy-old-1",
        targetSellLevelId: "legacy-sell-1",
        buyPrice: "90000",
        targetSellPrice: "96000",
        quantity: "0.01",
        exitPolicyVersion: "FIRST_PROFITABLE_HIGHER_RUNG_V2",
        targetKind: "PERSISTED_SELL",
        openedAt: new Date(Date.now() - 3600000).toISOString(),
      },
    ],
    events: [],
    marketContext: {
      currentPrice: 94000,
      bid: 93950,
      ask: 94050,
      priceFresh: true,
    },
    currentOperationalState: {
      status: "ok",
      title: "Grid operativo",
      plainSummary: "Resumen",
      plainProblem: null,
      plainNextAction: "Esperando",
      hasActiveRange: true,
      canAnalyzeNow: true,
    },
    recommendations: [],
  };

  if (!overrides) return base;
  return { ...base, ...overrides };
}

describe("buildGridOperationalViewModel V3", () => {
  it("expone entryLevels, referenceRungs y legacyTargetLevels", () => {
    const vm = buildGridOperationalViewModel(makeInput());
    expect(vm.levels.entryLevels.length).toBe(1);
    expect(vm.levels.entryLevels[0].side).toBe("BUY");
    expect(vm.levels.referenceRungs.length).toBe(1);
    expect(vm.levels.referenceRungs[0].side).toBe("SELL");
    expect(vm.levels.legacyTargetLevels.length).toBe(1);
    expect(vm.levels.legacyTargetLevels[0].side).toBe("SELL");
    expect(vm.levels.legacyTargetLevels[0].id).toBe("legacy-sell-1");
  });

  it("expone cycleOwnedExits para V3", () => {
    const vm = buildGridOperationalViewModel(makeInput());
    expect(vm.cycleOwnedExits.length).toBe(1);
    const exit = vm.cycleOwnedExits[0];
    expect(exit.cycleNumber).toBe(27);
    expect(exit.policyVersion).toBe("CYCLE_OWNED_NET_TARGET_V3");
    expect(exit.targetKind).toBe("CYCLE_OWNED_SYNTHETIC");
    expect(exit.targetOwner).toBe("cycle-27");
    expect(exit.targetSellLevelId).toBeNull();
    expect(exit.targetRungLevelId).toBeNull();
    expect(exit.buyPrice).toBe(92000);
    expect(exit.targetSellPrice).toBe(97000);
    expect(exit.quantity).toBe(0.01);
    expect(exit.exchangeFeesUsd).toBeCloseTo(0.0873, 4);
    expect(exit.operationalCostsUsd).toBeCloseTo(0.1012, 4);
    expect(exit.taxReserveUsd).toBeCloseTo(0.9623, 4);
    expect(exit.expectedNetUsd).toBeCloseTo(3.8492, 4);
    expect(exit.constraintsSource).toBe("revolut_x_authenticated_configuration_pairs");
  });

  it("no expone cycleOwnedExits para V1/V2", () => {
    const vm = buildGridOperationalViewModel(makeInput({ cycles: [makeInput().cycles[1]] }));
    expect(vm.cycleOwnedExits.length).toBe(0);
  });

  it("distancia desde buy a target es coherente", () => {
    const vm = buildGridOperationalViewModel(makeInput());
    const exit = vm.cycleOwnedExits[0];
    expect(exit.targetDistancePctFromBuy).toBeCloseTo((97000 - 92000) / 92000 * 100, 6);
  });
});
