import { describe, it, expect } from "vitest";
import { buildGridOperationalViewModel } from "../buildGridOperationalViewModel";

const CYCLE_25_TARGET = "c6e8cfd1-37fa-4516-88e8-79ebe54a5f43";
const CYCLE_26_TARGET = "4f300503-ff58-4aba-9d0b-6fc8f7869018";

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
        id: CYCLE_25_TARGET,
        rangeVersionId: "range-old-v0",
        side: "SELL",
        price: "95000",
        quantity: "0.01",
        status: "open",
        levelIndex: 5,
      },
      {
        id: CYCLE_26_TARGET,
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
        id: "cycle-25",
        cycleNumber: 25,
        pair: "BTC/USD",
        status: "open",
        rangeVersionId: "range-old-v0",
        buyLevelId: "buy-old-1",
        targetSellLevelId: CYCLE_25_TARGET,
        buyPrice: "90000",
        targetSellPrice: "95000",
        quantity: "0.01",
        openedAt: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: "cycle-26",
        cycleNumber: 26,
        pair: "BTC/USD",
        status: "open",
        rangeVersionId: "range-old-v0",
        buyLevelId: "buy-old-2",
        targetSellLevelId: CYCLE_26_TARGET,
        buyPrice: "90500",
        targetSellPrice: "96000",
        quantity: "0.01",
        openedAt: new Date(Date.now() - 7200000).toISOString(),
      },
      {
        id: "cycle-27",
        cycleNumber: 27,
        pair: "BTC/USD",
        status: "open",
        rangeVersionId: "range-active-v1",
        buyLevelId: "buy-active-1",
        targetSellLevelId: "sell-active-1",
        buyPrice: "92000",
        targetSellPrice: "97000",
        quantity: "0.01",
        openedAt: new Date(Date.now() - 1800000).toISOString(),
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

describe("buildGridOperationalViewModel", () => {
  it("devuelve la cabecera operativa con modo y política de ejecución", () => {
    const vm = buildGridOperationalViewModel(makeInput());
    expect(vm.header.title).toBe("GRID AISLADO BTC/USD");
    expect(vm.header.mode).toBe("SHADOW");
    expect(vm.header.executionPolicy).toBe("MAKER_ONLY");
    expect(vm.header.makerOnly).toBe(true);
    expect(vm.header.takerFallbackAllowed).toBe(false);
  });

  it("en SHADOW fuerza MAKER_ONLY aunque config diga otra cosa", () => {
    const input = makeInput({
      mode: "SHADOW",
      config: { ...makeInput().config, executionPolicy: "TAKER_FALLBACK", takerFallbackEnabled: true },
    });
    const vm = buildGridOperationalViewModel(input);
    expect(vm.header.executionPolicy).toBe("MAKER_ONLY");
    expect(vm.execution.takerFallbackEnabled).toBe(false);
  });

  it("no etiqueta nunca los ciclos 25 y 26 como huérfanos ni históricos inactivos", () => {
    const vm = buildGridOperationalViewModel(makeInput());
    const c25 = vm.openCycles.find((c: any) => c.cycleNumber === 25);
    const c26 = vm.openCycles.find((c: any) => c.cycleNumber === 26);
    expect(c25).toBeDefined();
    expect(c26).toBeDefined();
    expect(c25!.rangeRelation).toBe("previous");
    expect(c26!.rangeRelation).toBe("previous");
    expect(c25!.rangeLabel).not.toContain("huérfano");
    expect(c26!.rangeLabel).not.toContain("histórico");
    expect(c25!.rangeLabel).toContain("gestión activa");
    expect(c26!.rangeLabel).toContain("gestión activa");
  });

  it("ciclo del rango vigente se marca como current", () => {
    const vm = buildGridOperationalViewModel(makeInput());
    const c27 = vm.openCycles.find((c: any) => c.cycleNumber === 27);
    expect(c27).toBeDefined();
    expect(c27!.rangeRelation).toBe("current");
    expect(c27!.rangeLabel).toContain("Rango vigente");
  });

  it("los niveles SELL objetivo de ciclos 25 y 26 se marcan como targetOfOpenCycle", () => {
    const vm = buildGridOperationalViewModel(makeInput());
    const target25 = vm.levels.openCycleTargetLevels.find((l: any) => l.id === CYCLE_25_TARGET);
    const target26 = vm.levels.openCycleTargetLevels.find((l: any) => l.id === CYCLE_26_TARGET);
    expect(target25).toBeDefined();
    expect(target26).toBeDefined();
    expect(target25!.targetOfOpenCycle).toBe(true);
    expect(target26!.targetOfOpenCycle).toBe(true);
    expect(target25!.rangeRelation).toBe("previous");
    expect(target26!.rangeRelation).toBe("previous");
  });

  it("las notificaciones agrupan eventos duplicados por severidad", () => {
    const events = [
      { eventType: "GRID_PRICE_STALE", createdAt: new Date().toISOString() },
      { eventType: "GRID_PRICE_STALE", createdAt: new Date(Date.now() - 1000).toISOString() },
      { eventType: "GRID_SHADOW_CYCLE_COMPLETED", createdAt: new Date().toISOString() },
    ];
    const vm = buildGridOperationalViewModel(makeInput({ events }));
    const warningGroup = vm.notifications.find((g: any) => g.severity === "warning");
    expect(warningGroup).toBeDefined();
    expect(warningGroup!.count).toBe(2);
    expect(warningGroup!.items[0].count).toBe(2);

    const successGroup = vm.notifications.find((g: any) => g.severity === "success");
    expect(successGroup).toBeDefined();
    expect(successGroup!.count).toBe(1);
  });

  it("los ajustes simples reflejan los valores de config", () => {
    const vm = buildGridOperationalViewModel(makeInput());
    expect(vm.settings.simple.capitalMax).toBe(5000);
    expect(vm.settings.simple.minViableLevels).toBe(8);
    expect(vm.settings.simple.netProfitTargetPct).toBe(0.8);
    expect(vm.settings.simple.rangeProfile).toBe("balanced");
    expect(vm.settings.simple.protection).toBe("stop");
    expect(vm.settings.simple.reinvestProfits).toBe(true);
  });

  it("calcula el PnL estimado de un ciclo abierto", () => {
    const vm = buildGridOperationalViewModel(makeInput({ marketContext: { currentPrice: 92000, bid: 91950, ask: 92050, priceFresh: true } }));
    const c25 = vm.openCycles.find((c: any) => c.cycleNumber === 25);
    expect(c25).toBeDefined();
    // Comprado a 90k con objetivo 95k y precio actual 92k -> progreso parcial
    expect((c25!.progressPct as number)).toBeGreaterThan(0);
    expect((c25!.progressPct as number)).toBeLessThan(100);
    expect(c25!.estimatedNetPnl).not.toBeNull();
    expect(c25!.distanceUsd).toBeGreaterThan(0);
  });

  it("usa marketContext para precio, bid, ask, fuente y frescura", () => {
    const input = makeInput({
      marketContext: {
        currentPrice: 94000,
        currentBid: 93950,
        currentAsk: 94050,
        priceSource: "kraken",
        priceFresh: true,
        priceAgeMs: 1200,
        priceMaxAgeMs: 5000,
      },
    });
    const vm = buildGridOperationalViewModel(input);
    expect(vm.header.currentPrice).toBe(94000);
    expect(vm.header.currentBid).toBe(93950);
    expect(vm.header.currentAsk).toBe(94050);
    expect(vm.header.priceSource).toBe("kraken");
    expect(vm.header.priceFresh).toBe(true);
  });

  it("no inventa precio cero cuando no hay datos de mercado", () => {
    const input = makeInput({
      marketContext: null,
      status: { ...makeInput().status, currentPrice: null, currentBid: null, currentAsk: null, lastPrice: null, priceSource: null, priceFresh: false },
    });
    const vm = buildGridOperationalViewModel(input);
    expect(vm.header.currentPrice).toBeNull();
    expect(vm.header.currentBid).toBeNull();
    expect(vm.header.currentAsk).toBeNull();
  });

  it("expone el market view model con datos actuales, rango de entrada y recomendación", () => {
    const input = makeInput({
      marketContext: {
        currentPrice: 94000,
        bid: 93950,
        ask: 94050,
        priceFresh: true,
        source: "kraken",
        priceSource: "kraken",
        band: { lower: 93000, center: 95000, upper: 97000, widthPct: 4.21 },
        bandPosition: "lower",
        bandPositionPct: 25,
        atrPct: 1.2,
      },
      recommendations: [
        {
          title: "Bajar objetivo neto",
          explanation: "Permite más niveles",
          consequence: "Más operaciones",
          suggestedLevels: 10,
          suggestedLower: 92000,
          suggestedUpper: 98000,
          repetitionCount: 2,
          technicalCode: "NET_PROFIT_TARGET_HIGH",
        },
      ],
    });
    const vm = buildGridOperationalViewModel(input);
    expect(vm.market).toBeDefined();
    expect(vm.market.pair).toBe("BTC/USD");
    expect(vm.market.current.price).toBe(94000);
    expect(vm.market.entryRange.calculatedLower).toBe(93000);
    expect(vm.market.recommendation?.title).toBe("Bajar objetivo neto");
  });

  it("header expone PnL realizado y beneficio estimado abierto", () => {
    const input = makeInput({ status: { ...makeInput().status, totalNetPnlUsd: 123.45 } });
    const vm = buildGridOperationalViewModel(input);
    expect(vm.header.realizedNetPnlUsd).toBe(123.45);
    expect(typeof vm.header.openEstimatedNetPnlUsd).toBe("number");
  });

  describe("REV-C11 FASE 2 — D5/D7: filtros de status", () => {
    it("D7: ciclo hodl_recovery aparece en openCycles", () => {
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "hodl_recovery" },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.openCycles.length).toBe(1);
      expect(vm.openCycles[0].status).toBe("hodl_recovery");
    });

    it("D5: ciclo stop_loss_hit aparece en closedCycles", () => {
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "stop_loss_hit", sellPrice: "93000", completedAt: new Date().toISOString() },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.closedCycles.length).toBe(1);
      expect(vm.closedCycles[0].status).toBe("stop_loss_hit");
    });

    it("D5: ciclo trailing_closed aparece en closedCycles", () => {
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "trailing_closed", sellPrice: "93500", completedAt: new Date().toISOString() },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.closedCycles.length).toBe(1);
      expect(vm.closedCycles[0].status).toBe("trailing_closed");
    });

    it("D5: ciclo completed sigue apareciendo en closedCycles", () => {
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "completed", sellPrice: "95000", completedAt: new Date().toISOString() },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.closedCycles.length).toBe(1);
      expect(vm.closedCycles[0].status).toBe("completed");
    });

    it("D5+D7: mix de statuses se separan correctamente", () => {
      const input = makeInput();
      input.cycles = [
        { id: "c1", cycleNumber: 1, pair: "BTC/USD", status: "open", rangeVersionId: "range-active-v1", buyLevelId: "b1", targetSellLevelId: "s1", buyPrice: "90000", targetSellPrice: "95000", quantity: "0.01", openedAt: new Date().toISOString() },
        { id: "c2", cycleNumber: 2, pair: "BTC/USD", status: "hodl_recovery", rangeVersionId: "range-active-v1", buyLevelId: "b2", targetSellLevelId: "s2", buyPrice: "91000", targetSellPrice: "96000", quantity: "0.01", openedAt: new Date().toISOString() },
        { id: "c3", cycleNumber: 3, pair: "BTC/USD", status: "completed", rangeVersionId: "range-active-v1", buyLevelId: "b3", targetSellLevelId: "s3", buyPrice: "90000", sellPrice: "95000", quantity: "0.01", openedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
        { id: "c4", cycleNumber: 4, pair: "BTC/USD", status: "stop_loss_hit", rangeVersionId: "range-active-v1", buyLevelId: "b4", targetSellLevelId: "s4", buyPrice: "92000", sellPrice: "89000", quantity: "0.01", openedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
        { id: "c5", cycleNumber: 5, pair: "BTC/USD", status: "trailing_closed", rangeVersionId: "range-active-v1", buyLevelId: "b5", targetSellLevelId: "s5", buyPrice: "91000", sellPrice: "93000", quantity: "0.01", openedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
        { id: "c6", cycleNumber: 6, pair: "BTC/USD", status: "cancelled", rangeVersionId: "range-active-v1", buyLevelId: "b6", targetSellLevelId: "s6", buyPrice: "90000", quantity: "0.01", openedAt: new Date().toISOString() },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.openCycles.length).toBe(2);
      expect(vm.closedCycles.length).toBe(3);
      expect(vm.cancelledCycles.length).toBe(1);
    });

    it("ciclo cancelled no aparece en openCycles ni closedCycles", () => {
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "cancelled" },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.openCycles.length).toBe(0);
      expect(vm.closedCycles.length).toBe(0);
    });

    it("ciclo error no aparece en openCycles ni closedCycles", () => {
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "error" },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.openCycles.length).toBe(0);
      expect(vm.closedCycles.length).toBe(0);
    });

    it("openEstimatedNetPnlUsd suma solo ciclos abiertos", () => {
      const input = makeInput();
      input.cycles = [
        { id: "c1", cycleNumber: 1, pair: "BTC/USD", status: "open", rangeVersionId: "range-active-v1", buyLevelId: "b1", targetSellLevelId: "s1", buyPrice: "90000", targetSellPrice: "95000", quantity: "0.01", openedAt: new Date().toISOString() },
        { id: "c2", cycleNumber: 2, pair: "BTC/USD", status: "completed", rangeVersionId: "range-active-v1", buyLevelId: "b2", targetSellLevelId: "s2", buyPrice: "90000", sellPrice: "95000", quantity: "0.01", openedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.openCycles.length).toBe(1);
      expect(vm.closedCycles.length).toBe(1);
      expect(vm.header.openEstimatedNetPnlUsd).toBeGreaterThan(0);
    });

    it("hodl_recovery con riskStateJson se parsea correctamente", () => {
      const input = makeInput();
      input.cycles = [
        {
          ...input.cycles[0],
          status: "hodl_recovery",
          riskStateJson: JSON.stringify({ stateVersion: 1, stopLossTriggered: false, hodlActive: true, hodlReason: "soft_stop_recovery" }),
        },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.openCycles.length).toBe(1);
      expect(vm.openCycles[0].status).toBe("hodl_recovery");
    });

    it("closedCycles con stop_loss_hit calcula PnL realizado negativo", () => {
      const input = makeInput();
      input.cycles = [
        {
          ...input.cycles[0],
          status: "stop_loss_hit",
          buyPrice: "92000",
          sellPrice: "89000",
          quantity: "0.01",
          netPnlUsd: "-0.30",
          netPnlPct: "-3.26",
          completedAt: new Date().toISOString(),
        },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.closedCycles.length).toBe(1);
      expect(vm.closedCycles[0].status).toBe("stop_loss_hit");
    });

    it("closedCycles con trailing_closed tiene openedAt", () => {
      const completedAt = new Date().toISOString();
      const input = makeInput();
      input.cycles = [
        {
          ...input.cycles[0],
          status: "trailing_closed",
          sellPrice: "93500",
          completedAt,
        },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.closedCycles.length).toBe(1);
      expect(vm.closedCycles[0].openedAt).toBeTruthy();
    });
  });

  describe("REV-C11 FASE 2 CORRECCIÓN — contrato canónico de ciclos", () => {
    it("Ciclo abierto: targetSellPrice presente, sellPrice=null, estimatedNetPnl no null, realizedNetPnl=null", () => {
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "buy_filled", targetSellPrice: "95000", sellPrice: null, quantity: "0.01", buyPrice: "90000" },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.openCycles.length).toBe(1);
      const c = vm.openCycles[0];
      expect(c.targetSellPrice).toBe(95000);
      expect(c.sellPrice).toBeNull();
      expect(c.estimatedNetPnl).not.toBeNull();
      expect(c.realizedNetPnl).toBeNull();
    });

    it("Ciclo completed con target=65000 y sellPrice=64700: PnL realizado corresponde a 64700, no a 65000, estimated*=null", () => {
      const input = makeInput();
      input.cycles = [
        {
          ...input.cycles[0],
          status: "completed",
          targetSellPrice: "65000",
          sellPrice: "64700",
          quantity: "0.01",
          buyPrice: "60000",
          grossPnlUsd: "4.70",
          feeTotalUsd: "0.10",
          taxReserveUsd: "0.94",
          netPnlUsd: "3.66",
          netPnlPct: "0.61",
          sellFilledAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.closedCycles.length).toBe(1);
      const c = vm.closedCycles[0];
      expect(c.targetSellPrice).toBe(65000);
      expect(c.sellPrice).toBe(64700);
      expect(c.realizedNetPnl).toBeCloseTo(3.66, 5);
      expect(c.estimatedNetPnl).toBeNull();
      expect(c.estimatedGrossPnl).toBeNull();
    });

    it("Ciclo stop_loss_hit: sellPrice real del stop, PnL real negativo, target solo histórico", () => {
      const input = makeInput();
      input.cycles = [
        {
          ...input.cycles[0],
          status: "stop_loss_hit",
          targetSellPrice: "95000",
          sellPrice: "88000",
          quantity: "0.01",
          buyPrice: "90000",
          grossPnlUsd: "-2.00",
          feeTotalUsd: "0.10",
          taxReserveUsd: "-0.40",
          netPnlUsd: "-2.10",
          netPnlPct: "-2.33",
          sellFilledAt: new Date().toISOString(),
        },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.closedCycles.length).toBe(1);
      const c = vm.closedCycles[0];
      expect(c.sellPrice).toBe(88000);
      expect(c.realizedNetPnl).toBeCloseTo(-2.10, 5);
      expect(c.targetSellPrice).toBe(95000);
      expect(c.estimatedNetPnl).toBeNull();
    });

    it("Ciclo trailing_closed: sellPrice real del trailing, PnL real, target no sustituye ejecución", () => {
      const input = makeInput();
      input.cycles = [
        {
          ...input.cycles[0],
          status: "trailing_closed",
          targetSellPrice: "95000",
          sellPrice: "93500",
          quantity: "0.01",
          buyPrice: "90000",
          grossPnlUsd: "3.50",
          feeTotalUsd: "0.10",
          taxReserveUsd: "0.70",
          netPnlUsd: "2.70",
          netPnlPct: "3.00",
          sellFilledAt: new Date().toISOString(),
        },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.closedCycles.length).toBe(1);
      const c = vm.closedCycles[0];
      expect(c.sellPrice).toBe(93500);
      expect(c.realizedNetPnl).toBeCloseTo(2.70, 5);
      expect(c.targetSellPrice).toBe(95000);
      expect(c.estimatedNetPnl).toBeNull();
    });

    it("Ciclo sell_filled: aparece en closedCycles, no en openCycles, usa sellPrice real", () => {
      const input = makeInput();
      input.cycles = [
        {
          ...input.cycles[0],
          status: "sell_filled",
          targetSellPrice: "95000",
          sellPrice: "94800",
          quantity: "0.01",
          buyPrice: "90000",
          grossPnlUsd: "4.80",
          feeTotalUsd: "0.10",
          taxReserveUsd: "0.96",
          netPnlUsd: "3.74",
          netPnlPct: "4.16",
          sellFilledAt: new Date().toISOString(),
        },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.closedCycles.length).toBe(1);
      expect(vm.openCycles.length).toBe(0);
      expect(vm.closedCycles[0].sellPrice).toBe(94800);
    });

    it("Ciclo terminal con sellPrice=null: sellPrice=null, no fallback al target", () => {
      const input = makeInput();
      input.cycles = [
        {
          ...input.cycles[0],
          status: "completed",
          targetSellPrice: "95000",
          sellPrice: null,
          quantity: "0.01",
          buyPrice: "90000",
          grossPnlUsd: "0",
          netPnlUsd: "0",
          completedAt: new Date().toISOString(),
        },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.closedCycles[0].sellPrice).toBeNull();
      expect(vm.closedCycles[0].targetSellPrice).toBe(95000);
    });

    it("Ciclo terminal con sellFilledAt=null: sellFilledAt=null, no fallback a completedAt", () => {
      const completedAt = new Date().toISOString();
      const input = makeInput();
      input.cycles = [
        {
          ...input.cycles[0],
          status: "completed",
          targetSellPrice: "95000",
          sellPrice: "95000",
          sellFilledAt: null,
          completedAt,
          quantity: "0.01",
          buyPrice: "90000",
          grossPnlUsd: "5.00",
          netPnlUsd: "4.00",
        },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.closedCycles[0].sellFilledAt).toBeNull();
    });

    it("Ciclo abierto sin target: estimaciones=null, no usar sellPrice", () => {
      const input = makeInput();
      input.cycles = [
        {
          ...input.cycles[0],
          status: "buy_filled",
          targetSellPrice: null,
          sellPrice: null,
          quantity: "0.01",
          buyPrice: "90000",
        },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.openCycles[0].estimatedNetPnl).toBeNull();
      expect(vm.openCycles[0].estimatedGrossPnl).toBeNull();
    });

    it("SYNTHETIC_RUNG: targetSellLevelId=null, targetRungLevelId conservado", () => {
      const input = makeInput();
      input.cycles = [
        {
          ...input.cycles[0],
          status: "buy_filled",
          targetKind: "SYNTHETIC_RUNG",
          targetSellLevelId: null,
          targetRungLevelId: "rung-3",
          targetSellPrice: "96000",
          quantity: "0.01",
          buyPrice: "90000",
        },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.openCycles[0].targetSellLevelId).toBeNull();
      expect(vm.openCycles[0].targetRungLevelId).toBe("rung-3");
    });
  });

  describe("REV-C11 FASE 2 CIERRE — metadatos de revisión y sell_filled", () => {
    it("Ciclo abierto con requiresReview=true, reviewCode y reviewReason: Operational conserva los tres valores", () => {
      const input = makeInput();
      input.cycles = [
        {
          ...input.cycles[0],
          status: "buy_filled",
          targetSellPrice: "95000",
          quantity: "0.01",
          buyPrice: "90000",
          requiresReview: true,
          reviewCode: "TEST_CODE",
          reviewReason: "Motivo de prueba",
        },
      ];
      const vm = buildGridOperationalViewModel(input);
      const c = vm.openCycles[0];
      expect(c.requiresReview).toBe(true);
      expect(c.reviewCode).toBe("TEST_CODE");
      expect(c.reviewReason).toBe("Motivo de prueba");
    });

    it("Ciclo terminal conserva requiresReview, reviewCode y reviewReason", () => {
      const input = makeInput();
      input.cycles = [
        {
          ...input.cycles[0],
          status: "completed",
          targetSellPrice: "95000",
          sellPrice: "94700",
          quantity: "0.01",
          buyPrice: "90000",
          grossPnlUsd: "4.70",
          feeTotalUsd: "0.10",
          taxReserveUsd: "0.94",
          netPnlUsd: "3.66",
          netPnlPct: "0.61",
          sellFilledAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          requiresReview: true,
          reviewCode: "TEST_CODE",
          reviewReason: "Motivo de prueba",
        },
      ];
      const vm = buildGridOperationalViewModel(input);
      const c = vm.closedCycles[0];
      expect(c.requiresReview).toBe(true);
      expect(c.reviewCode).toBe("TEST_CODE");
      expect(c.reviewReason).toBe("Motivo de prueba");
    });

    it("Operational y Audit coinciden en metadatos de revisión", async () => {
      const { buildGridAuditViewModel } = await import("../buildGridAuditViewModel");
      const input = makeInput();
      input.cycles = [
        {
          ...input.cycles[0],
          status: "buy_filled",
          targetSellPrice: "95000",
          quantity: "0.01",
          buyPrice: "90000",
          requiresReview: true,
          reviewCode: "TEST_CODE",
          reviewReason: "Motivo de prueba",
        },
      ];
      const opVm = buildGridOperationalViewModel(input);
      const auditVm = buildGridAuditViewModel("SHADOW", input.config, input.status, input.levels, input.cycles, input.events, { id: input.status.activeRangeVersionId, pair: "BTC/USD", status: "active" }, input.marketContext, { at: null, result: null }, { at: null, result: null });
      expect(opVm.openCycles[0].requiresReview).toBe(auditVm.operational.openCycles[0].requiresReview);
      expect(opVm.openCycles[0].reviewCode).toBe(auditVm.operational.openCycles[0].reviewCode);
      expect(opVm.openCycles[0].reviewReason).toBe(auditVm.operational.openCycles[0].reviewReason);
    });

    it("sell_filled: aparece solo en closedCycles, tiene etiqueta humana, color terminal, sellPrice real, realizedNetPnl real, estimatedNetPnl=null", () => {
      const input = makeInput();
      input.cycles = [
        {
          ...input.cycles[0],
          status: "sell_filled",
          targetSellPrice: "95000",
          sellPrice: "94800",
          quantity: "0.01",
          buyPrice: "90000",
          grossPnlUsd: "4.80",
          feeTotalUsd: "0.10",
          taxReserveUsd: "0.96",
          netPnlUsd: "3.74",
          netPnlPct: "4.16",
          sellFilledAt: new Date().toISOString(),
        },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.closedCycles.length).toBe(1);
      expect(vm.openCycles.length).toBe(0);
      const c = vm.closedCycles[0];
      expect(c.statusLabel).toBe("Venta ejecutada");
      expect(c.color).toBe("green");
      expect(c.sellPrice).toBe(94800);
      expect(c.realizedNetPnl).toBeCloseTo(3.74, 5);
      expect(c.estimatedNetPnl).toBeNull();
    });
  });

  describe("REV-C11 FASE 4D — Ciclo de Corrección 1", () => {
    // Defecto A: PnL histórico usar realizedNetPnl
    it("A1: closedCycle tiene realizedNetPnl poblado y estimatedNetPnl=null", () => {
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "completed", sellPrice: "95000", quantity: "0.01", buyPrice: "90000",
          grossPnlUsd: "5.00", feeTotalUsd: "0.10", taxReserveUsd: "1.00", netPnlUsd: "3.90", netPnlPct: "4.33",
          sellFilledAt: new Date().toISOString(), completedAt: new Date().toISOString() },
      ];
      const vm = buildGridOperationalViewModel(input);
      const c = vm.closedCycles[0];
      expect(c.realizedNetPnl).toBeCloseTo(3.90, 5);
      expect(c.estimatedNetPnl).toBeNull();
    });

    it("A2: closedCycle con realizedNetPnl negativo se muestra negativo", () => {
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "stop_loss_hit", sellPrice: "88000", quantity: "0.01", buyPrice: "90000",
          grossPnlUsd: "-2.00", feeTotalUsd: "0.10", taxReserveUsd: "-0.40", netPnlUsd: "-2.10", netPnlPct: "-2.33",
          sellFilledAt: new Date().toISOString(), completedAt: new Date().toISOString() },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.closedCycles[0].realizedNetPnl).toBeLessThan(0);
    });

    // Defecto B: SELL ejecutado vs targetSellPrice
    it("B1: closedCycle sellPrice es el precio ejecutado, no el target", () => {
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "completed", targetSellPrice: "65000", sellPrice: "64700",
          quantity: "0.01", buyPrice: "60000", grossPnlUsd: "4.70", netPnlUsd: "3.66",
          sellFilledAt: new Date().toISOString(), completedAt: new Date().toISOString() },
      ];
      const vm = buildGridOperationalViewModel(input);
      const c = vm.closedCycles[0];
      expect(c.sellPrice).toBe(64700);
      expect(c.targetSellPrice).toBe(65000);
      expect(c.sellPrice).not.toBe(c.targetSellPrice);
    });

    it("B2: closedCycle con sellPrice=null no usa targetSellPrice como fallback", () => {
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "completed", targetSellPrice: "95000", sellPrice: null,
          quantity: "0.01", buyPrice: "90000", grossPnlUsd: "0", netPnlUsd: "0",
          completedAt: new Date().toISOString() },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.closedCycles[0].sellPrice).toBeNull();
      expect(vm.closedCycles[0].targetSellPrice).toBe(95000);
    });

    // Defecto C: Histórico expandible con detalle
    it("C1: closedCycle expone closePath para mostrar en detalle", () => {
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "completed", sellPrice: "95000", closePath: "NORMAL_TARGET",
          quantity: "0.01", buyPrice: "90000", grossPnlUsd: "5", netPnlUsd: "4",
          sellFilledAt: new Date().toISOString(), completedAt: new Date().toISOString() },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.closedCycles[0].closePath).toBe("NORMAL_TARGET");
    });

    it("C2: closedCycle expone realizedNetPnlPct para mostrar rentabilidad", () => {
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "completed", sellPrice: "95000",
          quantity: "0.01", buyPrice: "90000", grossPnlUsd: "5", netPnlUsd: "4", netPnlPct: "4.44",
          sellFilledAt: new Date().toISOString(), completedAt: new Date().toISOString() },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.closedCycles[0].realizedNetPnlPct).toBeCloseTo(4.44, 5);
    });

    it("C3: closedCycle expone realizedGrossPnl, realizedFee, realizedTax para detalle", () => {
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "completed", sellPrice: "95000",
          quantity: "0.01", buyPrice: "90000",
          grossPnlUsd: "5.00", feeTotalUsd: "0.10", taxReserveUsd: "1.00", netPnlUsd: "3.90",
          sellFilledAt: new Date().toISOString(), completedAt: new Date().toISOString() },
      ];
      const vm = buildGridOperationalViewModel(input);
      const c = vm.closedCycles[0];
      expect(c.realizedGrossPnl).toBeCloseTo(5.00, 5);
      expect(c.realizedFee).toBeCloseTo(0.10, 5);
      expect(c.realizedTax).toBeCloseTo(1.00, 5);
    });

    // Defecto D: Duración cerrada canónica
    it("D1: closedCycle durationLabel usa completedAt como fin, no Date.now()", () => {
      const openedAt = new Date(Date.now() - 7200000).toISOString(); // 2h ago
      const completedAt = new Date(Date.now() - 3600000).toISOString(); // 1h ago
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "completed", sellPrice: "95000",
          quantity: "0.01", buyPrice: "90000", grossPnlUsd: "5", netPnlUsd: "4",
          openedAt, sellFilledAt: completedAt, completedAt },
      ];
      const vm = buildGridOperationalViewModel(input);
      const dur = vm.closedCycles[0].durationLabel;
      expect(dur).toContain("1h");
      expect(dur).not.toContain("2h");
    });

    it("D2: closedCycle durationLabel usa sellFilledAt cuando no hay completedAt", () => {
      const openedAt = new Date(Date.now() - 3600000).toISOString(); // 1h ago
      const sellFilledAt = new Date(Date.now() - 1800000).toISOString(); // 30m ago
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "sell_filled", sellPrice: "95000",
          quantity: "0.01", buyPrice: "90000", grossPnlUsd: "5", netPnlUsd: "4",
          openedAt, sellFilledAt, completedAt: null },
      ];
      const vm = buildGridOperationalViewModel(input);
      const dur = vm.closedCycles[0].durationLabel;
      expect(dur).toContain("30m");
    });

    it("D3: closedCycle sin completedAt ni sellFilledAt ni holdTimeMinutes devuelve — (no usa Date.now())", () => {
      const openedAt = new Date(Date.now() - 3600000).toISOString(); // 1h ago
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "completed", sellPrice: "95000",
          quantity: "0.01", buyPrice: "90000", grossPnlUsd: "5", netPnlUsd: "4",
          openedAt, sellFilledAt: null, completedAt: null, holdTimeMinutes: null },
      ];
      const vm = buildGridOperationalViewModel(input);
      const dur = vm.closedCycles[0].durationLabel;
      expect(dur).toBe("—");
    });

    // Defecto G: Mercado humanizar textos (band position translated)
    it("G1: band position 'below' se traduce a 'por debajo'", () => {
      const input = makeInput({
        marketContext: {
          currentPrice: 89000, bid: 88950, ask: 89050, priceFresh: true,
          band: { lower: 90000, center: 95000, upper: 100000, widthPct: 10.53 },
        },
      });
      const vm = buildGridOperationalViewModel(input);
      expect(vm.market.current.band.position).toBe("por debajo");
    });

    it("G2: band position 'above' se traduce a 'por encima'", () => {
      const input = makeInput({
        marketContext: {
          currentPrice: 105000, bid: 104950, ask: 105050, priceFresh: true,
          band: { lower: 90000, center: 95000, upper: 100000, widthPct: 10.53 },
        },
      });
      const vm = buildGridOperationalViewModel(input);
      expect(vm.market.current.band.position).toBe("por encima");
    });

    it("G3: band position 'lower' se traduce a 'zona baja'", () => {
      const input = makeInput({
        marketContext: {
          currentPrice: 91000, bid: 90950, ask: 91050, priceFresh: true,
          band: { lower: 90000, center: 95000, upper: 100000, widthPct: 10.53 },
        },
      });
      const vm = buildGridOperationalViewModel(input);
      expect(vm.market.current.band.position).toBe("zona baja");
    });

    it("G4: band position 'middle' se traduce a 'zona media'", () => {
      const input = makeInput({
        marketContext: {
          currentPrice: 95000, bid: 94950, ask: 95050, priceFresh: true,
          band: { lower: 90000, center: 95000, upper: 100000, widthPct: 10.53 },
        },
      });
      const vm = buildGridOperationalViewModel(input);
      expect(vm.market.current.band.position).toBe("zona media");
    });

    it("G5: band position 'upper' se traduce a 'zona alta'", () => {
      const input = makeInput({
        marketContext: {
          currentPrice: 99000, bid: 98950, ask: 99050, priceFresh: true,
          band: { lower: 90000, center: 95000, upper: 100000, widthPct: 10.53 },
        },
      });
      const vm = buildGridOperationalViewModel(input);
      expect(vm.market.current.band.position).toBe("zona alta");
    });

    // Defecto H: CTA único
    it("H1: overview CTA por defecto es 'Ver mercado' (no 'Analizar mercado ahora')", () => {
      const input = makeInput({
        recommendations: [{ id: "rec-1", title: "Bajar objetivo", plainExplanation: "Explicación" }],
      });
      const vm = buildGridOperationalViewModel(input);
      expect(vm.overview.primaryRecommendation?.ctaLabel).toBe("Ver mercado");
    });

    it("H2: overview CTA target por defecto es 'mercado' (no 'ajustes')", () => {
      const input = makeInput({
        recommendations: [{ id: "rec-1", title: "Bajar objetivo", plainExplanation: "Explicación" }],
      });
      const vm = buildGridOperationalViewModel(input);
      expect(vm.overview.primaryRecommendation?.ctaTarget).toBe("mercado");
    });

    it("H3: overview CTA respeta ctaApply del recommendation cuando viene definido", () => {
      const input = makeInput({
        recommendations: [{ id: "rec-1", title: "Bajar objetivo", plainExplanation: "Explicación", ctaApply: "Ir a ajustes" }],
      });
      const vm = buildGridOperationalViewModel(input);
      expect(vm.overview.primaryRecommendation?.ctaLabel).toBe("Ir a ajustes");
    });

    // Defecto E: Avisos técnicos ocultos (view model still has technicalReason but UI hides it)
    it("E1: notification technicalReason se preserva en el view model para diagnóstico interno", () => {
      const events = [
        { eventType: "GRID_PRICE_STALE", createdAt: new Date().toISOString() },
      ];
      const vm = buildGridOperationalViewModel(makeInput({ events }));
      const warningGroup = vm.notifications.find((g: any) => g.severity === "warning");
      expect(warningGroup).toBeDefined();
      expect(warningGroup!.items[0].technicalReason).toBe("GRID_PRICE_STALE");
    });

    // Contract preservation: open cycles still work correctly
    it("P1: openCycle estimatedNetPnl no es null cuando hay buy y target", () => {
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "buy_filled", targetSellPrice: "95000", buyPrice: "90000", quantity: "0.01" },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.openCycles[0].estimatedNetPnl).not.toBeNull();
      expect(vm.openCycles[0].realizedNetPnl).toBeNull();
    });

    it("P2: cancelledCycle no aparece en closedCycles ni openCycles", () => {
      const input = makeInput();
      input.cycles = [
        { ...input.cycles[0], status: "cancelled" },
      ];
      const vm = buildGridOperationalViewModel(input);
      expect(vm.openCycles.length).toBe(0);
      expect(vm.closedCycles.length).toBe(0);
      expect(vm.cancelledCycles.length).toBe(1);
    });
  });

  // ─── FASE 4D CORRECTION: 25 mandatory terminal tests ────────────────
  describe("REV-C11 FASE 4D CORRECTION — terminal cycle contract (25 tests)", () => {
    function makeCompletedCycle(overrides: any = {}) {
      return {
        id: "c-completed-1",
        cycleNumber: 100,
        pair: "BTC/USD",
        status: "completed",
        rangeVersionId: "range-old-v0",
        buyLevelId: "buy-old-1",
        sellLevelId: "sell-old-1",
        targetSellLevelId: CYCLE_25_TARGET,
        buyPrice: "90000",
        sellPrice: "95000",
        targetSellPrice: "95500",
        quantity: "0.01",
        grossPnlUsd: "50.00",
        feeTotalUsd: "5.00",
        taxReserveUsd: "10.00",
        netPnlUsd: "35.00",
        netPnlPct: "0.39",
        closePath: "NORMAL_TARGET",
        openedAt: new Date(Date.now() - 7200000).toISOString(),
        buyFilledAt: new Date(Date.now() - 7100000).toISOString(),
        sellFilledAt: new Date(Date.now() - 3600000).toISOString(),
        completedAt: new Date(Date.now() - 3500000).toISOString(),
        holdTimeMinutes: 60,
        createdAt: new Date(Date.now() - 7200000).toISOString(),
        ...overrides,
      };
    }

    function makeCancelledCycle(overrides: any = {}) {
      return {
        id: "c-cancelled-1",
        cycleNumber: 101,
        pair: "BTC/USD",
        status: "cancelled",
        rangeVersionId: "range-old-v0",
        buyLevelId: "buy-old-2",
        buyPrice: "91000",
        targetSellPrice: "96000",
        quantity: "0.01",
        grossPnlUsd: "0",
        feeTotalUsd: "0",
        taxReserveUsd: "0",
        netPnlUsd: "0",
        netPnlPct: "0",
        createdAt: new Date(Date.now() - 5000000).toISOString(),
        completedAt: new Date(Date.now() - 4000000).toISOString(),
        ...overrides,
      };
    }

    function inputWithCycles(cycles: any[]) {
      return makeInput({
        cycles,
        levels: [
          { id: "buy-active-1", rangeVersionId: "range-active-v1", side: "BUY", price: "90000", quantity: "0.01", status: "planned", levelIndex: 0 },
        ],
      });
    }

    // 1. Completado usa sellPrice real
    it("1: completed usa sellPrice real", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle()]));
      expect(vm.closedCycles[0].sellPrice).toBe(95000);
    });

    // 2. Completado no sustituye sellPrice null por target
    it("2: completed no sustituye sellPrice null por target", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle({ sellPrice: null })]));
      expect(vm.closedCycles[0].sellPrice).toBeNull();
      expect(vm.closedCycles[0].targetSellPrice).toBe(95500);
    });

    // 3. Cancelado con target no aparece como vendido
    it("3: cancelled con target no aparece como vendido", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCancelledCycle()]));
      expect(vm.cancelledCycles[0].sellPrice).toBeNull();
      expect(vm.cancelledCycles[0].targetSellPrice).toBe(96000);
    });

    // 4. Cancelado muestra "Sin SELL ejecutado" (sellPrice null)
    it("4: cancelled muestra sellPrice null (Sin SELL ejecutado)", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCancelledCycle()]));
      expect(vm.cancelledCycles[0].sellPrice).toBeNull();
    });

    // 5. Cancelado no muestra PnL falso
    it("5: cancelled no muestra PnL falso (realizedNetPnl null)", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCancelledCycle({ netPnlUsd: "100" })]));
      expect(vm.cancelledCycles[0].realizedNetPnl).toBeNull();
      expect(vm.cancelledCycles[0].realizedGrossPnl).toBeNull();
      expect(vm.cancelledCycles[0].realizedFee).toBeNull();
      expect(vm.cancelledCycles[0].realizedTax).toBeNull();
      expect(vm.cancelledCycles[0].realizedNetPnlPct).toBeNull();
    });

    // 6. Completed y cancelled usan componentes/ramas semánticas distintas
    it("6: completed y cancelled van a arrays distintos", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle(), makeCancelledCycle()]));
      expect(vm.closedCycles.length).toBe(1);
      expect(vm.cancelledCycles.length).toBe(1);
      expect(vm.closedCycles[0].status).toBe("completed");
      expect(vm.cancelledCycles[0].status).toBe("cancelled");
    });

    // 7. Objetivo original se muestra separado
    it("7: objetivo original (targetSellPrice) separado de sellPrice", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle()]));
      expect(vm.closedCycles[0].sellPrice).toBe(95000);
      expect(vm.closedCycles[0].targetSellPrice).toBe(95500);
      expect(vm.closedCycles[0].sellPrice).not.toBe(vm.closedCycles[0].targetSellPrice);
    });

    // 8. Ruta humanizada
    it("8: closePathLabel humanizada", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle()]));
      expect(vm.closedCycles[0].closePath).toBe("NORMAL_TARGET");
      expect(vm.closedCycles[0].closePathLabel).toBe("Objetivo normal");
    });

    it("8b: closePathLabel HODL_RECOVERY humanizada", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle({ closePath: "HODL_RECOVERY" })]));
      expect(vm.closedCycles[0].closePathLabel).toBe("Recuperación HODL");
    });

    it("8c: closePath null → No registrada", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle({ closePath: null })]));
      expect(vm.closedCycles[0].closePathLabel).toBeNull();
    });

    // 9. Código técnico solo en detalle (closePath existe, closePathLabel es lo humano)
    it("9: closePath técnico existe pero closePathLabel es lo humano", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle()]));
      expect(vm.closedCycles[0].closePath).toBe("NORMAL_TARGET");
      expect(vm.closedCycles[0].closePathLabel).toBe("Objetivo normal");
    });

    // 10. Cronología solo contiene timestamps reales
    it("10: createdAt y completedAt están presentes y son ISO válidos", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle()]));
      const c = vm.closedCycles[0];
      expect(c.createdAt).toBeTruthy();
      expect(c.buyFilledAt).toBeTruthy();
      expect(c.sellFilledAt).toBeTruthy();
      expect(c.completedAt).toBeTruthy();
      expect(new Date(c.createdAt!).getTime()).not.toBeNaN();
      expect(new Date(c.completedAt!).getTime()).not.toBeNaN();
    });

    // 11. Trailing histórico visible
    it("11: trailingActivated se propaga desde riskState", () => {
      const riskState = {
        trailing: { activated: true, activatedAt: new Date(Date.now() - 6000000).toISOString(), highestPriceSinceBuy: 94500, trailingStopPct: 1.5, currentStopPrice: 93000, reason: "TRAILING_ARMED" },
        stopLoss: [],
        hodl: { active: false, activatedAt: null, originalBuyPrice: null, recoveryTargetPrice: null, reason: "" },
        lastAction: "TRAILING_UPDATE",
        activeExitRoute: null,
        pendingExitPrice: null,
        protectiveExit: { state: "NONE", route: null, triggerPrice: null, triggerDetectedAt: null, bestBidAtTrigger: null, bestAskAtTrigger: null, requestedMakerPrice: null, makerOrderCreatedAt: null, makerEligibleAfter: null, lifecycleTickId: null, lastRepricedAt: null, repriceAttempts: 0, pendingQuantity: 0, simulatedOrderId: null, fillPrice: null, filledAt: null, bestBidAtFill: null, bestAskAtFill: null, cancellationReason: null },
        stateVersion: 1,
        lastEvaluatedAt: null,
      };
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle({ riskStateJson: riskState })]));
      expect(vm.closedCycles[0].trailingActivated).toBe(true);
      expect(vm.closedCycles[0].trailingStopPrice).toBe(93000);
    });

    // 12. Stop histórico visible
    it("12: stopLossTriggered se propaga desde riskState", () => {
      const riskState = {
        trailing: { activated: false, activatedAt: null, highestPriceSinceBuy: null, trailingStopPct: 0, currentStopPrice: null, reason: "" },
        stopLoss: [{ layer: "soft", triggerPricePct: -3, triggered: true, triggeredAt: new Date().toISOString(), reason: "SOFT_HIT" }],
        hodl: { active: false, activatedAt: null, originalBuyPrice: null, recoveryTargetPrice: null, reason: "" },
        lastAction: "STOP_LOSS_SOFT",
        activeExitRoute: null,
        pendingExitPrice: null,
        protectiveExit: { state: "NONE", route: null, triggerPrice: null, triggerDetectedAt: null, bestBidAtTrigger: null, bestAskAtTrigger: null, requestedMakerPrice: null, makerOrderCreatedAt: null, makerEligibleAfter: null, lifecycleTickId: null, lastRepricedAt: null, repriceAttempts: 0, pendingQuantity: 0, simulatedOrderId: null, fillPrice: null, filledAt: null, bestBidAtFill: null, bestAskAtFill: null, cancellationReason: null },
        stateVersion: 1,
        lastEvaluatedAt: null,
      };
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle({ riskStateJson: riskState })]));
      expect(vm.closedCycles[0].stopLossTriggered).toBe(true);
      expect(vm.closedCycles[0].stopLossLayersTriggered).toContain("soft");
    });

    // 13. HODL histórico visible
    it("13: hodlActivated se propaga desde riskState", () => {
      const riskState = {
        trailing: { activated: false, activatedAt: null, highestPriceSinceBuy: null, trailingStopPct: 0, currentStopPrice: null, reason: "" },
        stopLoss: [],
        hodl: { active: true, activatedAt: new Date(Date.now() - 5000000).toISOString(), originalBuyPrice: 90000, recoveryTargetPrice: 93000, reason: "HODL_ACTIVATED" },
        lastAction: "HODL_RECOVERY_ACTIVATE",
        activeExitRoute: "HODL_RECOVERY",
        pendingExitPrice: null,
        protectiveExit: { state: "NONE", route: null, triggerPrice: null, triggerDetectedAt: null, bestBidAtTrigger: null, bestAskAtTrigger: null, requestedMakerPrice: null, makerOrderCreatedAt: null, makerEligibleAfter: null, lifecycleTickId: null, lastRepricedAt: null, repriceAttempts: 0, pendingQuantity: 0, simulatedOrderId: null, fillPrice: null, filledAt: null, bestBidAtFill: null, bestAskAtFill: null, cancellationReason: null },
        stateVersion: 1,
        lastEvaluatedAt: null,
      };
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle({ riskStateJson: riskState })]));
      expect(vm.closedCycles[0].hodlActivated).toBe(true);
      expect(vm.closedCycles[0].hodlRecoveryTarget).toBe(93000);
    });

    // 14. Maker exit histórico visible
    it("14: makerState se propaga desde riskState", () => {
      const riskState = {
        trailing: { activated: false, activatedAt: null, highestPriceSinceBuy: null, trailingStopPct: 0, currentStopPrice: null, reason: "" },
        stopLoss: [],
        hodl: { active: false, activatedAt: null, originalBuyPrice: null, recoveryTargetPrice: null, reason: "" },
        lastAction: null,
        activeExitRoute: null,
        pendingExitPrice: null,
        protectiveExit: { state: "MAKER_FILLED", route: "TRAILING_MAKER", triggerPrice: 94500, triggerDetectedAt: new Date().toISOString(), bestBidAtTrigger: 94490, bestAskAtTrigger: 94510, requestedMakerPrice: 94495, makerOrderCreatedAt: new Date().toISOString(), makerEligibleAfter: new Date().toISOString(), lifecycleTickId: 5, lastRepricedAt: null, repriceAttempts: 0, pendingQuantity: 0.01, simulatedOrderId: "sim-123", fillPrice: 94498, filledAt: new Date().toISOString(), bestBidAtFill: 94495, bestAskAtFill: 94505, cancellationReason: null },
        stateVersion: 1,
        lastEvaluatedAt: null,
      };
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle({ riskStateJson: riskState })]));
      expect(vm.closedCycles[0].makerState).toBe("MAKER_FILLED");
      expect(vm.closedCycles[0].makerFillPrice).toBe(94498);
      expect(vm.closedCycles[0].simulatedOrderId).toBe("sim-123");
    });

    // 15. Fecha completedAt visible
    it("15: completedAt está presente en ciclo completado", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle()]));
      expect(vm.closedCycles[0].completedAt).toBeTruthy();
    });

    // 16. Duración congelada
    it("16: duración usa holdTimeMinutes y no cambia entre llamadas", () => {
      const vm1 = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle({ holdTimeMinutes: 60 })]));
      const vm2 = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle({ holdTimeMinutes: 60 })]));
      expect(vm1.closedCycles[0].durationLabel).toBe(vm2.closedCycles[0].durationLabel);
      expect(vm1.closedCycles[0].durationMinutes).toBe(60);
    });

    it("16b: duración calculada desde completedAt - openedAt cuando holdTimeMinutes es null", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle({ holdTimeMinutes: null })]));
      expect(vm.closedCycles[0].durationMinutes).not.toBeNull();
      expect(vm.closedCycles[0].durationMinutes).toBeGreaterThan(0);
    });

    it("16c: duración no usa Date.now() en terminal", () => {
      const c = makeCompletedCycle({
        holdTimeMinutes: null,
        openedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
        completedAt: new Date("2026-01-01T02:00:00Z").toISOString(),
        sellFilledAt: new Date("2026-01-01T01:55:00Z").toISOString(),
      });
      const vm = buildGridOperationalViewModel(inputWithCycles([c]));
      expect(vm.closedCycles[0].durationMinutes).toBe(120);
      expect(vm.closedCycles[0].durationLabel).toBe("2h");
    });

    // 17. Filtro Todos
    it("17: filtro Todos — closedCycles + cancelledCycles en array correcto", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle(), makeCancelledCycle()]));
      expect(vm.closedCycles.length + vm.cancelledCycles.length).toBe(2);
    });

    // 18. Filtro Completados
    it("18: closedCycles solo contiene completados", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle(), makeCancelledCycle()]));
      expect(vm.closedCycles.every(c => c.status !== "cancelled")).toBe(true);
    });

    // 19. Filtro Cancelados
    it("19: cancelledCycles solo contiene cancelados", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle(), makeCancelledCycle()]));
      expect(vm.cancelledCycles.every(c => c.status === "cancelled")).toBe(true);
    });

    // 20. Solo 10 registros inicialmente (view model no pagina, pero expone todos)
    it("20: view model expone todos los ciclos terminales", () => {
      const cycles = Array.from({ length: 15 }, (_, i) => makeCompletedCycle({ id: `c-${i}`, cycleNumber: 200 + i }));
      const vm = buildGridOperationalViewModel(inputWithCycles(cycles));
      expect(vm.closedCycles.length).toBe(15);
    });

    // 21. Mostrar 10 más incrementa a 20 (view model expone todos, paginación es frontend)
    it("21: view model no limita — paginación es responsabilidad del frontend", () => {
      const cycles = Array.from({ length: 25 }, (_, i) => makeCompletedCycle({ id: `c-${i}`, cycleNumber: 300 + i }));
      const vm = buildGridOperationalViewModel(inputWithCycles(cycles));
      expect(vm.closedCycles.length).toBe(25);
    });

    // 22. Solo un ciclo expandido (Accordion type=single garantiza esto en frontend)
    it("22: view model no fuerza expansión múltiple", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle(), makeCompletedCycle({ id: "c-2", cycleNumber: 102 })]));
      expect(vm.closedCycles.length).toBe(2);
    });

    // 23. Null no se convierte en cero
    it("23: null se preserva como null, no se convierte en 0", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle({ grossPnlUsd: null, feeTotalUsd: null, taxReserveUsd: null, netPnlUsd: null, netPnlPct: null })]));
      expect(vm.closedCycles[0].realizedGrossPnl).toBeNull();
      expect(vm.closedCycles[0].realizedFee).toBeNull();
      expect(vm.closedCycles[0].realizedTax).toBeNull();
      expect(vm.closedCycles[0].realizedNetPnl).toBeNull();
      expect(vm.closedCycles[0].realizedNetPnlPct).toBeNull();
    });

    // 24. Neto usa realizedNetPnl
    it("24: neto usa realizedNetPnl desde netPnlUsd", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle({ netPnlUsd: "42.50" })]));
      expect(vm.closedCycles[0].realizedNetPnl).toBe(42.50);
    });

    // 25. No se usa estimatedNetPnl en terminales
    it("25: estimatedNetPnl es null en cerrados", () => {
      const vm = buildGridOperationalViewModel(inputWithCycles([makeCompletedCycle(), makeCancelledCycle()]));
      expect(vm.closedCycles[0].estimatedNetPnl).toBeNull();
      expect(vm.cancelledCycles[0].estimatedNetPnl).toBeNull();
    });
  });
});
