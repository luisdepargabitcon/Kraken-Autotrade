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
});
