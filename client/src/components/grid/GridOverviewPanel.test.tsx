import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { GridOverviewPanel } from "./GridOverviewPanel";

const baseOperational = {
  overview: {
    summary: "Resumen de prueba",
    nextAction: "Revisa recomendación",
    hasActiveRange: true,
    primaryRecommendation: null,
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
  market: {
    entryRange: {
      actualLevels: 4,
      requestedLevels: 4,
    },
    levelDiagnostic: { reason: "spacing too wide" },
  },
};

describe("GridOverviewPanel render", () => {
  it("renders review and manual buttons when recommendation is applicable", () => {
    const onReview = vi.fn();
    const onManual = vi.fn();
    const html = renderToString(
      <GridOverviewPanel
        operational={baseOperational}
        onReviewProposal={onReview}
        onConfigureManually={onManual}
        hasApplicableRecommendation={true}
        hasConfigurationDiagnostic={true}
      />
    );
    expect(html).toContain("Revisar propuesta");
    expect(html).toContain("Configurar manualmente");
  });

  it("renders manual config button when only diagnostic is present", () => {
    const onManual = vi.fn();
    const html = renderToString(
      <GridOverviewPanel
        operational={baseOperational}
        onConfigureManually={onManual}
        hasApplicableRecommendation={false}
        hasConfigurationDiagnostic={true}
      />
    );
    expect(html).not.toContain("Revisar propuesta");
    expect(html).toContain("Configurar manualmente");
  });

  it("renders primary recommendation title when provided", () => {
    const onReview = vi.fn();
    const onManual = vi.fn();
    const op = {
      ...baseOperational,
      overview: {
        ...baseOperational.overview,
        primaryRecommendation: {
          title: "Ajustar objetivo",
          explanation: "Baja el objetivo",
          ctaLabel: "Probar ajuste",
        },
      },
    };
    const html = renderToString(
      <GridOverviewPanel
        operational={op}
        onReviewProposal={onReview}
        onConfigureManually={onManual}
        hasApplicableRecommendation={true}
        hasConfigurationDiagnostic={true}
      />
    );
    expect(html).toContain("Ajustar objetivo");
    expect(html).toContain("Baja el objetivo");
    expect(html).toContain("Revisar propuesta");
  });
});
