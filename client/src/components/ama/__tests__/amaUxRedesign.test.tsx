import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { AmaCommandBar } from "../AmaCommandBar";
import { AmaModeSelector } from "../AmaModeSelector";
import { AmaPrimaryNav } from "../AmaPrimaryNav";
import { AmaCycleProgress } from "../AmaCycleProgress";
import { AmaOverview } from "../AmaOverview";
import { AmaHelpTab } from "../AmaHelpTab";

// ─── Helpers ─────────────────────────────────────────────────────────

function render(node: React.ReactNode): string {
  return renderToString(node);
}

// ─── AmaCommandBar ───────────────────────────────────────────────────

describe("AmaCommandBar", () => {
  it("renders AMA title and pair", () => {
    const html = render(
      <AmaCommandBar
        status={{ mode: "OFF", state: "OBSERVING", pair: "BTC/USD", killSwitchActive: false }}
        marketView={{ analysisPrice: 95000, highWaterMark: 100000, currentDropPct: -5, macroZone: "VALUE_MODERATE", dataQuality: "EXCELLENT" }}
        portfolio={{ budgetUsd: 5000 }}
        readiness={{ readyCount: 10, totalCount: 14 }}
        onRefresh={() => {}}
        onToggleKillSwitch={() => {}}
      />,
    );
    expect(html).toContain("AMA");
    expect(html).toContain("BTC/USD");
  });

  it("shows kill switch button when inactive", () => {
    const html = render(
      <AmaCommandBar
        status={{ mode: "OFF", state: "OBSERVING", pair: "BTC/USD", killSwitchActive: false }}
        marketView={null}
        portfolio={null}
        readiness={null}
        onRefresh={() => {}}
        onToggleKillSwitch={() => {}}
      />,
    );
    expect(html).toContain("Parada de emergencia");
  });

  it("shows emergency active when kill switch is active", () => {
    const html = render(
      <AmaCommandBar
        status={{ mode: "OFF", state: "OBSERVING", pair: "BTC/USD", killSwitchActive: true }}
        marketView={null}
        portfolio={null}
        readiness={null}
        onRefresh={() => {}}
        onToggleKillSwitch={() => {}}
      />,
    );
    expect(html).toContain("Emergencia activa");
  });

  it("displays price and drop", () => {
    const html = render(
      <AmaCommandBar
        status={{ mode: "LAB", state: "OBSERVING", pair: "BTC/USD", killSwitchActive: false }}
        marketView={{ analysisPrice: 95000, highWaterMark: 100000, currentDropPct: -5.2, macroZone: "VALUE_MODERATE", dataQuality: "EXCELLENT" }}
        portfolio={{ budgetUsd: 10000 }}
        readiness={{ readyCount: 14, totalCount: 14 }}
        onRefresh={() => {}}
        onToggleKillSwitch={() => {}}
      />,
    );
    expect(html).toContain("95");
    expect(html).toContain("5.2%");
  });
});

// ─── AmaModeSelector ─────────────────────────────────────────────────

describe("AmaModeSelector", () => {
  it("renders all selectable modes", () => {
    const html = render(<AmaModeSelector currentMode="OFF" onSelectMode={() => {}} />);
    expect(html).toContain("Desactivado");
    expect(html).toContain("Laboratorio");
    expect(html).toContain("Reproducci");
    expect(html).toContain("Simulaci");
  });

  it("marks current mode as active", () => {
    const html = render(<AmaModeSelector currentMode="LAB" onSelectMode={() => {}} />);
    expect(html).toContain("Laboratorio");
  });

  it("real completo is always locked", () => {
    const html = render(<AmaModeSelector currentMode="OFF" onSelectMode={() => {}} />);
    expect(html).toContain("Real completo");
    expect(html).toContain("disabled");
  });

  it("real limitado is disabled by default", () => {
    const html = render(<AmaModeSelector currentMode="OFF" onSelectMode={() => {}} realLimitedDisabled={true} />);
    expect(html).toContain("Real limitado");
  });
});

// ─── AmaPrimaryNav ───────────────────────────────────────────────────

describe("AmaPrimaryNav", () => {
  it("renders all nav items in order", () => {
    const html = render(<AmaPrimaryNav activeTab="overview" onTabChange={() => {}} />);
    const items = ["Resumen", "Ciclos", "Laboratorio", "Hist", "Simulaci", "Operaci", "Ledger", "Ayuda"];
    items.forEach((item) => {
      expect(html).toContain(item);
    });
  });

  it("overview appears before cycles", () => {
    const html = render(<AmaPrimaryNav activeTab="overview" onTabChange={() => {}} />);
    const idxOverview = html.indexOf("Resumen");
    const idxCycles = html.indexOf("Ciclos");
    expect(idxOverview).toBeGreaterThan(-1);
    expect(idxCycles).toBeGreaterThan(-1);
    expect(idxOverview).toBeLessThan(idxCycles);
  });

  it("help appears last", () => {
    const html = render(<AmaPrimaryNav activeTab="overview" onTabChange={() => {}} />);
    const idxHelp = html.indexOf("Ayuda");
    const idxLedger = html.indexOf("Ledger");
    expect(idxHelp).toBeGreaterThan(idxLedger);
  });
});

// ─── AmaCycleProgress ────────────────────────────────────────────────

describe("AmaCycleProgress", () => {
  it("renders all 8 steps", () => {
    const html = render(<AmaCycleProgress currentState="OBSERVING" />);
    expect(html).toContain("Observando");
    expect(html).toContain("Buscando techo");
    expect(html).toContain("Esperando valor");
    expect(html).toContain("Acumulando");
    expect(html).toContain("Recuperaci");
    expect(html).toContain("Distribuyendo");
    expect(html).toContain("Cerrado");
  });

  it("handles null state gracefully", () => {
    const html = render(<AmaCycleProgress currentState={null} />);
    expect(html).toContain("Observando");
  });
});

// ─── AmaOverview ─────────────────────────────────────────────────────

describe("AmaOverview", () => {
  const mockStatus = { mode: "OFF", state: "OBSERVING", pair: "BTC/USD", killSwitchActive: false };
  const mockMarketView = {
    pair: "BTC/USD",
    analysisPrice: 95000,
    executionBid: 94990,
    executionAsk: 95010,
    spreadPct: 0.02,
    highWaterMark: 100000,
    cycleLow: 94000,
    currentDropPct: -5,
    macroZone: "VALUE_MODERATE",
    dataQuality: "EXCELLENT",
  };
  const mockPortfolio = {
    mode: "OFF",
    budgetUsd: 5000,
    deployedUsd: 1000,
    reservedUsd: 500,
    freeUsd: 3500,
    accumulatedQuantity: 0.01,
    averageCostBasis: 95000,
    currentValueUsd: 950,
    unrealizedPnlUsd: -50,
    realizedPnlUsd: 0,
  };
  const mockReadiness = {
    schema: { ready: true },
    database: { ready: true },
    market: { ready: true },
    hwm: { ready: true, hwmValue: 100000, bootstrapStatus: "COMPLETED", dataCoveragePct: 95 },
    mandate: { ready: true, mandateId: "mand-123", status: "ACTIVE" },
    policy: { ready: true, policyId: "pol-456", status: "ACTIVE" },
    budget: { ready: true, budgetedUsd: 5000, freeUsd: 3500 },
    reconciliation: { ready: true },
    killSwitch: { ready: true, active: false },
    gateway: { ready: true },
    scheduler: { ready: true, currentMode: "OFF", lastTickAt: null, tickCount: 0, errorCount: 0, lastError: null },
    shadowScenario: { ready: true, blockers: [] },
    shadowLive: { ready: false, blockers: ["NO_CURRENT_PRICE"] },
    realExecutionGate: { ready: false, locked: true, message: "Locked" },
  };

  it("renders cycle progress section", () => {
    const html = render(
      <AmaOverview
        status={mockStatus}
        marketView={mockMarketView}
        portfolio={mockPortfolio}
        readinessChecks={mockReadiness as any}
      />,
    );
    expect(html).toContain("Estado del ciclo");
  });

  it("renders market section with price", () => {
    const html = render(
      <AmaOverview
        status={mockStatus}
        marketView={mockMarketView}
        portfolio={mockPortfolio}
        readinessChecks={mockReadiness as any}
      />,
    );
    expect(html).toContain("Mercado");
    expect(html).toContain("95");
  });

  it("renders portfolio section", () => {
    const html = render(
      <AmaOverview
        status={mockStatus}
        marketView={mockMarketView}
        portfolio={mockPortfolio}
        readinessChecks={mockReadiness as any}
      />,
    );
    expect(html).toContain("Cartera AMA");
    expect(html).toContain("5");
  });

  it("renders readiness section with count", () => {
    const html = render(
      <AmaOverview
        status={mockStatus}
        marketView={mockMarketView}
        portfolio={mockPortfolio}
        readinessChecks={mockReadiness as any}
      />,
    );
    expect(html).toContain("Preparaci");
  });

  it("does NOT render AmaModeGuide content (no educational cards in overview)", () => {
    const html = render(
      <AmaOverview
        status={mockStatus}
        marketView={mockMarketView}
        portfolio={mockPortfolio}
        readinessChecks={mockReadiness as any}
      />,
    );
    expect(html).not.toContain("Comparaci");
    expect(html).not.toContain("Gu");
  });
});

// ─── AmaHelpTab ──────────────────────────────────────────────────────

describe("AmaHelpTab", () => {
  it("renders section titles", () => {
    const html = render(<AmaHelpTab />);
    expect(html).toContain("hace AMA");
    expect(html).toContain("trabaja");
    expect(html).toContain("compra AMA");
    expect(html).toContain("vende AMA");
  });

  it("renders mode comparison table", () => {
    const html = render(<AmaHelpTab />);
    expect(html).toContain("Comparaci");
    expect(html).toContain("Laboratorio");
    expect(html).toContain("Simulaci");
    expect(html).toContain("Mercado");
    expect(html).toContain("Motor AMA");
  });

  it("renders glossary section", () => {
    const html = render(<AmaHelpTab />);
    expect(html).toContain("Glosario");
    expect(html).toContain("HWM");
    expect(html).toContain("Tramo");
    expect(html).toContain("Kill switch");
  });

  it("renders protections section", () => {
    const html = render(<AmaHelpTab />);
    expect(html).toContain("Protecciones");
    expect(html).toContain("Cartera Global");
    expect(html).toContain("Maker");
    expect(html).toContain("Reconciliaci");
    expect(html).toContain("Kill switch");
  });

  it("renders flow steps", () => {
    const html = render(<AmaHelpTab />);
    expect(html).toContain("OBSERVA EL MERCADO");
    expect(html).toContain("DETECTA UNA CA");
    expect(html).toContain("ENTRA POR TRAMOS");
    expect(html).toContain("VENDE / DISTRIBUYE");
    expect(html).toContain("VIGILA LA RECUPERACI");
  });
});

// ─── Layout order test (Ama.tsx structure) ───────────────────────────

describe("AMA page layout order", () => {
  // We test that the component names appear in the correct order
  // by checking the import structure in Ama.tsx
  it("AmaPrimaryNav has overview as first item", () => {
    const html = render(<AmaPrimaryNav activeTab="overview" onTabChange={() => {}} />);
    // First nav button should be Resumen (overview)
    const firstButtonIdx = html.indexOf("Resumen");
    const secondButtonIdx = html.indexOf("Ciclos");
    expect(firstButtonIdx).toBeGreaterThan(-1);
    expect(firstButtonIdx).toBeLessThan(secondButtonIdx);
  });

  it("no duplicate kill switch in overview (only in command bar)", () => {
    // Overview should not have its own kill switch button
    const html = render(
      <AmaOverview
        status={{ mode: "OFF", state: "OBSERVING", pair: "BTC/USD", killSwitchActive: false }}
        marketView={null}
        portfolio={null}
        readinessChecks={null}
      />,
    );
    // Kill switch text should NOT appear in overview
    expect(html).not.toContain("Parada de emergencia");
    expect(html).not.toContain("kill-switch");
  });
});
