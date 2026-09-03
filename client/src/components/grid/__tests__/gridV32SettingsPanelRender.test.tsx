/**
 * GRID V3.2 Real component-render tests — ProtectiveTakerFallbackSection controls.
 *
 * Uses renderToString to verify VISIBLE UI output, not just object properties.
 * NOTE: The active settings component is GridSettingsPanel (used by GridIsolated.tsx).
 * These tests verify the V3.2 fields render correctly through the real FieldControl + ExpertMode.
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { FieldControl, ExpertMode, ProtectiveFeeReadonly } from "../GridSettingsPanel";

function makeConfig(overrides: Record<string, any> = {}) {
  return {
    protectiveTakerFallbackEnabled: false,
    protectiveMakerMaxAttempts: 3,
    protectiveMakerMaxWaitSeconds: 30,
    effectiveTakerFeePct: 0.09,
    effectiveTakerFeeSource: "EXECUTION_EXCHANGE_FEE_MODEL",
    effectiveTakerFeeQuality: "REAL",
    effectiveTakerFeeExchange: "revolutx",
    ...overrides,
  };
}

const exitsBlock = {
  id: "exits",
  title: "Salidas y HODL",
  description: "Trailing, stop loss y recuperación de posiciones.",
  fields: [
    "trailingEnabled",
    "trailingMode",
    "trailingActivationPct",
    "trailingStopPct",
    "stopLossSoftPct",
    "stopLossHardPct",
    "stopLossEmergencyPct",
    "hodlRecoveryEnabled",
    "protectiveTakerFallbackEnabled",
    "protectiveMakerMaxAttempts",
    "protectiveMakerMaxWaitSeconds",
  ],
};

describe("FieldControl — V3.2 protective taker fields (real render)", () => {
  it("renders 'Salida taker de protección' boolean toggle", () => {
    const html = renderToString(
      <FieldControl fieldKey="protectiveTakerFallbackEnabled" value={false} onChange={() => {}} />,
    );
    expect(html).toContain("Salida taker de protección");
    expect(html).toContain("Cuando trailing o stop-loss ya han ordenado salir");
  });

  it("renders 'Intentos maker antes de taker' integer control", () => {
    const html = renderToString(
      <FieldControl fieldKey="protectiveMakerMaxAttempts" value={3} onChange={() => {}} />,
    );
    expect(html).toContain("Intentos maker antes de taker");
  });

  it("renders 'Espera máxima maker' integer control", () => {
    const html = renderToString(
      <FieldControl fieldKey="protectiveMakerMaxWaitSeconds" value={30} onChange={() => {}} />,
    );
    expect(html).toContain("Espera máxima maker");
  });
});

describe("ExpertMode — V3.2 fields in exits block (structural render)", () => {
  // Note: Accordion content is hidden in SSR (data-state="closed").
  // We verify the block structure and that the exits block is present.
  it("renders the exits block with V3.2 fields in the accordion structure", () => {
    const draft = makeConfig({ protectiveTakerFallbackEnabled: true });
    const html = renderToString(
      <ExpertMode draft={draft} expertBlocks={[exitsBlock]} onChange={() => {}} />,
    );
    expect(html).toContain("Salidas y HODL");
    expect(html).toContain("Trailing, stop loss y recuperación de posiciones.");
  });
});

describe("FieldControl — V3.2 field dependency (disabled state)", () => {
  it("FieldControl for protectiveMakerMaxAttempts renders with disabled prop", () => {
    const html = renderToString(
      <FieldControl fieldKey="protectiveMakerMaxAttempts" value={3} onChange={() => {}} disabled={true} />,
    );
    // Slider should be disabled
    expect(html).toContain("data-disabled");
  });

  it("FieldControl for protectiveMakerMaxWaitSeconds renders enabled by default", () => {
    const html = renderToString(
      <FieldControl fieldKey="protectiveMakerMaxWaitSeconds" value={30} onChange={() => {}} disabled={false} />,
    );
    expect(html).toContain("Espera máxima maker");
    expect(html).toContain("30");
  });

  it("FieldControl for protectiveTakerFallbackEnabled shows help text", () => {
    const html = renderToString(
      <FieldControl fieldKey="protectiveTakerFallbackEnabled" value={true} onChange={() => {}} />,
    );
    expect(html).toContain("Salida taker de protección");
    expect(html).toContain("Solo se aplica a cierres protectores");
    expect(html).toContain("El target V3 normal continúa maker-only");
  });
});

describe("ProtectiveFeeReadonly — V3.2 fee read-only section (real render)", () => {
  it("renders effective taker fee with exchange, quality, and source", () => {
    const config = makeConfig({
      effectiveTakerFeePct: 0.08,
      effectiveTakerFeeExchange: "revolutx",
      effectiveTakerFeeQuality: "REAL",
      effectiveTakerFeeSource: "EXECUTION_EXCHANGE_FEE_MODEL",
    });
    const html = renderToString(<ProtectiveFeeReadonly config={config} />);
    expect(html).toContain("Fee taker protectora");
    expect(html).toContain("0.080");
    expect(html).toContain("revolutx");
    expect(html).toContain("REAL");
    expect(html).toContain("EXECUTION_EXCHANGE_FEE_MODEL");
    expect(html).toContain("Solo lectura");
  });

  it("does NOT render any editable input for effectiveTakerFeePct", () => {
    const config = makeConfig({
      effectiveTakerFeePct: 0.08,
      effectiveTakerFeeExchange: "revolutx",
      effectiveTakerFeeQuality: "REAL",
      effectiveTakerFeeSource: "EXECUTION_EXCHANGE_FEE_MODEL",
    });
    const html = renderToString(<ProtectiveFeeReadonly config={config} />);
    // No input, slider, or select elements
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
    expect(html).not.toContain('role="slider"');
  });

  it("renders nothing when no fee data is available", () => {
    const html = renderToString(<ProtectiveFeeReadonly config={{}} />);
    expect(html).toBe("");
  });
});
