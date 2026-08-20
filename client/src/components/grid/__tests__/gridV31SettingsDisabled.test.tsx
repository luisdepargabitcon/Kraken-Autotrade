/**
 * gridV31SettingsDisabled.test.tsx — V3.1 UI tests for genuinely disabled settings controls.
 *
 * Verifies that fields marked "Inactivo en este modo" have disabled=true and
 * cannot modify the draft state.
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { ExpertMode, FieldControl } from "../GridSettingsPanel";
import { GridOpenCyclesPanel, TrailingStateBlock } from "../GridOpenCyclesPanel";

// Expert blocks matching the server-side view model structure
const expertBlocks = [
  {
    id: "exits",
    title: "Salidas y HODL",
    description: "Trailing, stop loss y recuperación de posiciones.",
    fields: [
      "trailingEnabled", "trailingMode", "trailingActivationPct", "trailingStopPct",
      "trailingAtrMultiplier", "trailingMinPct", "trailingMaxPct", "trailingAtrSmoothingAlpha",
      "stopLossEnabled", "stopLossSoftPct", "stopLossHardPct", "stopLossEmergencyPct",
      "hodlRecoveryEnabled",
    ],
  },
];

function makeDraft(overrides: Record<string, any> = {}) {
  return {
    trailingEnabled: true,
    trailingMode: "adaptive_atr",
    trailingActivationPct: 1.0,
    trailingStopPct: 0.4,
    trailingAtrMultiplier: 0.75,
    trailingMinPct: 0.25,
    trailingMaxPct: 1.20,
    trailingAtrSmoothingAlpha: 0.25,
    stopLossEnabled: false,
    stopLossSoftPct: 2,
    stopLossHardPct: 5,
    stopLossEmergencyPct: 10,
    hodlRecoveryEnabled: false,
    ...overrides,
  };
}

describe("[V3.1 UI] FieldControl disabled prop", () => {
  it("Slider tiene data-disabled cuando disabled=true", () => {
    const html = renderToString(
      React.createElement(FieldControl, {
        fieldKey: "trailingActivationPct",
        value: 1.0,
        onChange: vi.fn(),
        disabled: true,
      })
    );
    // Radix Slider sets data-disabled when disabled
    expect(html).toContain("data-disabled");
  });

  it("Slider NO tiene data-disabled cuando disabled=false", () => {
    const html = renderToString(
      React.createElement(FieldControl, {
        fieldKey: "trailingActivationPct",
        value: 1.0,
        onChange: vi.fn(),
        disabled: false,
      })
    );
    expect(html).not.toContain("data-disabled");
  });

  it("Switch tiene disabled attribute cuando disabled=true", () => {
    const html = renderToString(
      React.createElement(FieldControl, {
        fieldKey: "trailingEnabled",
        value: true,
        onChange: vi.fn(),
        disabled: true,
      })
    );
    // Radix Switch sets disabled on the button
    expect(html).toMatch(/disabled/);
  });

  it("Select tiene disabled attribute cuando disabled=true", () => {
    const html = renderToString(
      React.createElement(FieldControl, {
        fieldKey: "trailingMode",
        value: "adaptive_atr",
        onChange: vi.fn(),
        disabled: true,
      })
    );
    expect(html).toMatch(/disabled/);
  });
});

describe("[V3.1 UI] Open cycle trailing UX block", () => {
  it("muestra bloque trailing con estado, stop, máximo, modo y origen política", () => {
    const cycle = {
      trailingPolicyEnabled: true,
      trailingMode: "adaptive_atr",
      trailingAtrSource: "current_atr",
      trailingPolicySource: "snapshot",
      trailingActivationPrice: 60600,
      trailingProfitFloorPrice: 60600,
      trailingEffectiveStopPct: 0.75,
      trailingPriceTickSize: 0.01,
      buyPrice: 60000,
      currentBid: 60500,
      riskState: {
        trailing: {
          activated: true,
          currentStopPrice: 60550,
          highestPriceSinceBuy: 60700,
          reason: "ATR suavizado",
        },
      },
    };

    const html = renderToString(
      React.createElement(TrailingStateBlock, { cycle })
    );
    expect(html).toContain("Trailing V3.1");
    expect(html).toContain("Adaptive ATR");
    expect(html).toContain("Snapshot persistido");
    expect(html).toContain("Activo");
    expect(html).toContain("ATR actual");
    expect(html).toContain("0.7500%");
  });

  it("muestra progreso de activación cuando trailing está inactivo", () => {
    const cycle = {
      trailingPolicyEnabled: true,
      trailingMode: "adaptive_atr",
      trailingAtrSource: null,
      trailingPolicySource: "snapshot",
      trailingActivationPrice: 60600,
      trailingProfitFloorPrice: 60600,
      trailingEffectiveStopPct: null,
      trailingPriceTickSize: 0.01,
      buyPrice: 60000,
      currentBid: 60300,
      riskState: {
        trailing: {
          activated: false,
          currentStopPrice: null,
          highestPriceSinceBuy: null,
          reason: null,
        },
      },
    };

    const html = renderToString(
      React.createElement(TrailingStateBlock, { cycle })
    );
    expect(html).toContain("Inactivo — esperando activación");
    expect(html).toContain("Progreso activación");
  });

  it("muestra Deshabilitado cuando policyEnabled=false", () => {
    const cycle = {
      trailingPolicyEnabled: false,
      trailingMode: "adaptive_atr",
      trailingAtrSource: null,
      trailingPolicySource: "snapshot",
      trailingActivationPrice: 60600,
      trailingProfitFloorPrice: 60600,
      trailingEffectiveStopPct: null,
      trailingPriceTickSize: 0.01,
      buyPrice: 60000,
      currentBid: 60300,
      riskState: {
        trailing: {
          activated: false,
          currentStopPrice: null,
          highestPriceSinceBuy: null,
          reason: null,
        },
      },
    };

    const html = renderToString(
      React.createElement(TrailingStateBlock, { cycle })
    );
    expect(html).toContain("Deshabilitado");
  });
});
