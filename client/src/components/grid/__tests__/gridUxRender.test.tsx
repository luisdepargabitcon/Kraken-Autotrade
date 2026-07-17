import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { GridOperationalHeader } from "../GridOperationalHeader";
import { GridOverviewPanel } from "../GridOverviewPanel";
import { GridNotificationCenter } from "../GridNotificationCenter";
import { GridLevelsCompactPanel } from "../GridLevelsCompactPanel";
import { GridOpenCyclesPanel } from "../GridOpenCyclesPanel";
import { GridSettingsPanel, FIELD_META } from "../GridSettingsPanel";

const headerOperational = {
  header: {
    title: "GRID AISLADO BTC/USD",
    mode: "SHADOW",
    isActive: true,
    isRunning: true,
    makerOnly: true,
    currentPrice: 95000,
    currentBid: 94990,
    currentAsk: 95010,
    priceSource: "kraken",
    priceFresh: true,
    openCycles: 2,
    totalNetPnlUsd: 12.34,
    realOpenOrdersCount: 0,
  },
};

const overviewOperational = {
  overview: {
    summary: "Rango activo en simulación",
    problem: null,
    nextAction: "Revisa los niveles generados",
    canAnalyzeNow: true,
    hasActiveRange: true,
    primaryRecommendation: {
      title: "Ajustar objetivo neto",
      explanation: "Baja el objetivo para encajar más niveles.",
      ctaLabel: "Probar ajuste",
    },
  },
  capital: {
    configuredMax: 5000,
    reservedUsd: 1200,
    freeUsd: 3800,
    accumulatedProfit: 12.34,
  },
  openCycles: [],
  currentRange: {
    exists: true,
    lowerPrice: 93000,
    centerPrice: 95000,
    upperPrice: 97000,
  },
};

const notificationOperational = {
  notifications: [
    {
      severity: "warning",
      count: 2,
      items: [
        { id: "1", title: "Rango compacto", shortText: "La banda es muy estrecha", count: 1 },
        { id: "2", title: "Objetivo exigente", shortText: "Pocos niveles caben", count: 1 },
      ],
    },
    {
      severity: "info",
      count: 1,
      items: [{ id: "3", title: "Modo SHADOW", shortText: "Sin órdenes reales", count: 1 }],
    },
  ],
};

const levelsOperational = {
  levels: {
    activeRangeLevels: [
      { id: "l1", side: "BUY", price: 94000, quantity: 0.01, status: "planned", statusLabel: "Planificado", targetOfOpenCycle: false, rangeRelation: "current", rangeLabel: "Rango vigente" },
      { id: "l1s", side: "SELL", price: 96000, quantity: 0.01, status: "open", statusLabel: "Objetivo", targetOfOpenCycle: true, cycleNumber: 1, rangeRelation: "current", rangeLabel: "Rango vigente" },
    ],
    openCycleTargetLevels: [
      { id: "l2", side: "SELL", price: 96000, quantity: 0.01, status: "open", statusLabel: "Objetivo", targetOfOpenCycle: true, cycleNumber: 1, rangeRelation: "current", rangeLabel: "Ciclo 1" },
    ],
    historicalLevels: [
      { id: "l3", side: "BUY", price: 90000, quantity: 0.01, status: "replaced", statusLabel: "Reemplazado", targetOfOpenCycle: false, rangeRelation: "previous", rangeLabel: "Histórico" },
    ],
  },
};

const cyclesOperational = {
  openCycles: [
    {
      id: "c25",
      cycleNumber: 25,
      pair: "BTC/USD",
      status: "buy_filled",
      color: "cyan",
      statusLabel: "Compra ejecutada",
      buyPrice: 93000,
      targetSellPrice: 95000,
      currentBid: 94000,
      currentPrice: 94000,
      progressPct: 35,
      estimatedNetPnl: 5.5,
      rangeRelation: "previous",
      durationLabel: "2 h",
    },
  ],
  closedCycles: [
    {
      id: "c10",
      cycleNumber: 10,
      pair: "BTC/USD",
      status: "completed",
      color: "green",
      statusLabel: "Completado",
      buyPrice: 90000,
      targetSellPrice: 92000,
      estimatedNetPnl: 10,
    },
  ],
  cancelledCycles: [
    {
      id: "c5",
      cycleNumber: 5,
      pair: "BTC/USD",
      status: "cancelled",
      color: "red",
      statusLabel: "Cancelado",
      buyPrice: 91000,
      targetSellPrice: 93000,
      estimatedNetPnl: -1,
    },
  ],
};

function cleanHtml(html: string): string {
  return html.replace(/<!--\s*-->/g, "");
}

const settingsConfig = {
  gridWalletMaxUsd: 5000,
  adaptiveRangeMinViableLevels: 4,
  netProfitTargetPct: 0.8,
  adaptiveRangeProfile: "balanced",
  hodlRecoveryEnabled: true,
  gridWalletCompoundProfits: true,
  // legacy taker fallback keys should not be exposed as controls
  takerFallbackEnabled: false,
  takerFallbackAttemptNumber: 4,
  makerAttemptsBeforeTaker: 3,
};

const settingsOperational = {
  settings: {
    expertBlocks: [
      { id: "limits", title: "Límites operativos", description: "Máximos", fields: ["maxOpenCycles", "maxDailyOrders"] },
      { id: "capital", title: "Capital", description: "Cartera", fields: ["gridWalletMaxUsd", "gridWalletUseProfits", "gridWalletCompoundProfits"] },
    ],
  },
};

describe("Grid UX render", () => {
  it("GridOperationalHeader renders SHADOW and maker-only badges", () => {
    const html = renderToString(<GridOperationalHeader operational={headerOperational} />);
    expect(html).toContain("SHADOW");
    expect(html).toContain("Solo maker");
    expect(html).toContain("94.990,00");
    expect(html).toContain("Sin exposición");
  });

  it("GridOverviewPanel renders state summary and active range", () => {
    const html = renderToString(<GridOverviewPanel operational={overviewOperational} onAnalyze={() => {}} onGoToTab={() => {}} />);
    expect(html).toContain("Rango activo en simulación");
    expect(html).toContain("Rango de entrada");
    expect(html).toContain("93.000,00");
    expect(html).toContain("Capital libre");
  });

  it("GridNotificationCenter renders header with total count", () => {
    const html = renderToString(<GridNotificationCenter operational={notificationOperational} />);
    expect(html).toContain("Avisos y diagnóstico");
    expect(html).toContain(">3<");
  });

  it("GridLevelsCompactPanel renders active and target levels with filter counts", () => {
    const html = renderToString(<GridLevelsCompactPanel operational={levelsOperational} />);
    const text = cleanHtml(html);
    expect(text).toContain("Vigentes (2)");
    expect(text).toContain("Ciclos abiertos (1)");
    expect(text).toContain("Histórico (1)");
    expect(text).toContain("Objetivo de venta activo");
  });

  it("GridOpenCyclesPanel renders open cycle and history summary", () => {
    const html = renderToString(<GridOpenCyclesPanel operational={cyclesOperational} />);
    const text = cleanHtml(html);
    expect(text).toContain("Ciclo #25");
    expect(text).toContain("Rango anterior");
    expect(text).toContain("Histórico (2)");
  });

  it("GridSettingsPanel does not call onApply on mount and hides taker fallback fields", () => {
    const onApply = vi.fn();
    const html = renderToString(
      <GridSettingsPanel config={settingsConfig} operational={settingsOperational} onApply={onApply} applyPending={false} />,
    );
    const text = cleanHtml(html);
    expect(onApply).not.toHaveBeenCalled();
    // the legacy keys should not appear as controls (the static "Solo maker" policy message is allowed)
    expect(text).not.toContain("takerFallbackEnabled");
    expect(text).not.toContain("takerFallbackAttemptNumber");
    expect(text).not.toContain("makerAttemptsBeforeTaker");
    expect(text).toContain("Ajustes");
    expect(text).toContain("Capital máximo del Grid");
    expect(text).toContain("Solo maker");
  });
});

describe("GridSettingsPanel field meta security", () => {
  it("hides all taker fallback and execution policy fields", () => {
    for (const key of [
      "takerFallbackEnabled",
      "takerFallbackAttemptNumber",
      "maxTakerFallbackPerCycle",
      "takerFallbackRequiresNetProfit",
      "takerFallbackAuditRequired",
      "makerAttemptsBeforeTaker",
      "executionPolicy",
    ]) {
      expect(FIELD_META[key]?.hidden, `field ${key} should be hidden`).toBe(true);
    }
  });
});
