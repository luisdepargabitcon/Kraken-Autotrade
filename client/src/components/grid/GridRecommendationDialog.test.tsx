import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";

// Mock Radix Dialog so SSR renderToString works in node environment
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children, className }: any) => <div className={className}>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

import { GridRecommendationDialog } from "./GridRecommendationDialog";
import type { ConfigurationRecommendation } from "@shared/gridRecommendationHelper";

function makeRecommendation(overrides: Partial<ConfigurationRecommendation> = {}): ConfigurationRecommendation {
  return {
    id: "rec-dialog-test",
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    snapshotFingerprint: "snap",
    configFingerprint: "cfg",
    marketFingerprint: "mkt",
    activeRangeFingerprint: "range",
    context: {
      pair: "BTC/USD",
      mode: "SHADOW",
      activeRangeVersionId: "rv1",
      regime: "RANGE",
      regimeMaxPct: 5,
      bandPeriod: 20,
      bandStdDevMultiplier: 2,
      atrPeriod: 14,
      atrTimeframe: "1h",
      bandSource: "kraken",
      bandLower: 90000,
      bandCenter: 95000,
      bandUpper: 100000,
      bandWidthPct: 10,
      atrPct: 2,
      referencePrice: 95000,
    },
    referencePrice: 95000,
    fresh: true,
    confidence: 0.85,
    title: "Recomendación",
    explanation: "Diagnóstico de configuración",
    currentConfig: { buyLevels: 1 },
    alternatives: [
      {
        id: "A",
        title: "Mantener",
        explanation: "Mantiene objetivo",
        proposedConfig: { buyLevels: 2 },
        changedFields: ["buyLevels"],
        expectedBefore: { levels: 1, spacingPct: 1, rangePct: 1, netProfitPct: 0.8 },
        expectedAfter: { levels: 2, spacingPct: 1, rangePct: 1, netProfitPct: 0.8 },
        warnings: [],
        safeToApply: true,
        blockingReason: null,
      },
      {
        id: "B",
        title: "Bloqueada",
        explanation: "No aplica",
        proposedConfig: { netProfitTargetPct: 0.5 },
        changedFields: ["netProfitTargetPct"],
        expectedBefore: { levels: 1, spacingPct: 1, rangePct: 1, netProfitPct: 0.8 },
        expectedAfter: { levels: 1, spacingPct: 1, rangePct: 1, netProfitPct: 0.5 },
        warnings: [],
        safeToApply: false,
        blockingReason: "Alternativa de prueba bloqueada",
      },
    ],
    recommendedAlternativeId: "A",
    warnings: [],
    safeToApply: true,
    blockingReason: null,
    ...overrides,
  };
}

describe("GridRecommendationDialog render", () => {
  it("renders nothing when recommendation is null", () => {
    const html = renderToString(
      <GridRecommendationDialog open={true} onOpenChange={() => {}} recommendation={null} onApply={vi.fn()} />
    );
    expect(html).toBe("");
  });

  it("renders recommendation title and explanation", () => {
    const html = renderToString(
      <GridRecommendationDialog
        open={true}
        onOpenChange={() => {}}
        recommendation={makeRecommendation()}
        onApply={vi.fn()}
      />
    );
    expect(html).toContain("Recomendaciones de configuración");
    expect(html).toContain("Diagnóstico de configuración");
  });

  it("renders alternatives including blocked one", () => {
    const html = renderToString(
      <GridRecommendationDialog
        open={true}
        onOpenChange={() => {}}
        recommendation={makeRecommendation()}
        onApply={vi.fn()}
      />
    );
    expect(html).toContain("Mantener");
    expect(html).toContain("Bloqueada");
  });

  it("renders manual config button when provided", () => {
    const html = renderToString(
      <GridRecommendationDialog
        open={true}
        onOpenChange={() => {}}
        recommendation={makeRecommendation()}
        onApply={vi.fn()}
        onConfigureManually={() => {}}
      />
    );
    expect(html).toContain("Configurar manualmente");
  });
});
