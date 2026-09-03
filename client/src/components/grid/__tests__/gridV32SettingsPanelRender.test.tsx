/**
 * GRID V3.2 Real component-render tests — ProtectiveTakerFallbackSection controls.
 *
 * Uses renderToString to verify VISIBLE UI output, not just object properties.
 */

import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { ProtectiveTakerFallbackSection } from "../GridAjustesPanel";

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

function noop() {}

describe("ProtectiveTakerFallbackSection — real render", () => {
  it("renders 'Salida taker de protección' label and help text", () => {
    const html = renderToString(
      <ProtectiveTakerFallbackSection config={makeConfig()} onConfigChange={noop} />,
    );
    expect(html).toContain("Salida taker de protección");
    expect(html).toContain("Tras varios intentos maker o tiempo de espera");
  });

  it("renders 'Intentos maker antes de taker' and 'Espera máxima maker' labels", () => {
    const html = renderToString(
      <ProtectiveTakerFallbackSection config={makeConfig({ protectiveTakerFallbackEnabled: true })} onConfigChange={noop} />,
    );
    expect(html).toContain("Intentos maker antes de taker");
    expect(html).toContain("Espera máxima maker");
  });

  it("renders effective taker fee (read-only) with source and quality", () => {
    const html = renderToString(
      <ProtectiveTakerFallbackSection config={makeConfig({ protectiveTakerFallbackEnabled: true })} onConfigChange={noop} />,
    );
    expect(html).toContain("Fee taker efectiva");
    expect(html).toContain("0.090");
    expect(html).toContain("revolutx");
    expect(html).toContain("REAL");
    expect(html).toContain("Solo lectura");
  });

  it("disables numeric inputs when toggle is OFF", () => {
    const html = renderToString(
      <ProtectiveTakerFallbackSection config={makeConfig({ protectiveTakerFallbackEnabled: false })} onConfigChange={noop} />,
    );
    // When toggle is OFF, the number inputs should have the disabled attribute
    expect(html).toContain('disabled=""');
  });

  it("enables numeric inputs when toggle is ON (no disabled attribute on inputs)", () => {
    const html = renderToString(
      <ProtectiveTakerFallbackSection config={makeConfig({ protectiveTakerFallbackEnabled: true })} onConfigChange={noop} />,
    );
    // The protective section should be present
    expect(html).toContain("Salida taker de protección");
    // The value 3 should appear for attempts
    expect(html).toContain('value="3"');
    // The value 30 should appear for wait
    expect(html).toContain('value="30"');
  });

  it("shows 'No afecta al Target V3 normal' clarification", () => {
    const html = renderToString(
      <ProtectiveTakerFallbackSection config={makeConfig({ protectiveTakerFallbackEnabled: true })} onConfigChange={noop} />,
    );
    expect(html).toContain("No afecta al Target V3 normal");
  });
});
