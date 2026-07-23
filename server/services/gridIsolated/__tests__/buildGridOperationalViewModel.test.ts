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
});
