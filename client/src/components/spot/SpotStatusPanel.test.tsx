import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { SpotStatusPanel } from "./SpotStatusPanel";

const baseStatus = {
  executionMode: "OFF",
  activeIntents: 0,
  trackedPositions: 0,
  feeModel: { exchange: "REVOLUT_X", quality: "OK", makerFeePct: 0.1, takerFeePct: 0.2 },
  policyVersion: "R10.9",
  realActivationAllowed: true,
};

const noop = () => Promise.resolve(true);

describe("SpotStatusPanel — SPOT_UI render tests", () => {

  // SPOT_UI_01: OFF mode with mode buttons
  it("SPOT_UI_01 — renders OFF mode with mode buttons", () => {
    const html = renderToString(
      <SpotStatusPanel status={baseStatus as any} onModeChange={noop} />
    );
    expect(html).toContain("OFF");
    expect(html).toContain("SHADOW");
    expect(html).toContain("REAL");
  });

  // SPOT_UI_02: SHADOW mode badge
  it("SPOT_UI_02 — renders SHADOW mode badge", () => {
    const html = renderToString(
      <SpotStatusPanel status={{ ...baseStatus, executionMode: "SHADOW" } as any} onModeChange={noop} />
    );
    expect(html).toContain("SHADOW");
  });

  // SPOT_UI_03: REAL mode with warning text
  it("SPOT_UI_03 — renders REAL mode with warning text", () => {
    const html = renderToString(
      <SpotStatusPanel status={{ ...baseStatus, executionMode: "REAL" } as any} onModeChange={noop} />
    );
    expect(html).toContain("REAL");
    expect(html).toContain("órdenes reales");
  });

  // SPOT_UI_04: Fee maker and taker percentages
  it("SPOT_UI_04 — displays fee maker and taker percentages", () => {
    const html = renderToString(
      <SpotStatusPanel status={baseStatus as any} onModeChange={noop} />
    );
    expect(html).toContain("0.100%");
    expect(html).toContain("0.200%");
  });

  // SPOT_UI_05: Exchange name from feeModel
  it("SPOT_UI_05 — displays exchange name from feeModel", () => {
    const html = renderToString(
      <SpotStatusPanel status={baseStatus as any} onModeChange={noop} />
    );
    expect(html).toContain("REVOLUT_X");
  });

  // SPOT_UI_06: Policy version
  it("SPOT_UI_06 — displays policy version", () => {
    const html = renderToString(
      <SpotStatusPanel status={baseStatus as any} onModeChange={noop} />
    );
    expect(html).toContain("R10.9");
  });

  // SPOT_UI_07: REAL PERMITIDO
  it("SPOT_UI_07 — shows REAL PERMITIDO when realActivationAllowed is true", () => {
    const html = renderToString(
      <SpotStatusPanel status={baseStatus as any} onModeChange={noop} />
    );
    expect(html).toContain("PERMITIDO");
  });

  // SPOT_UI_08: REAL BLOQUEADO
  it("SPOT_UI_08 — shows REAL BLOQUEADO when realActivationAllowed is false", () => {
    const html = renderToString(
      <SpotStatusPanel status={{ ...baseStatus, realActivationAllowed: false } as any} onModeChange={noop} />
    );
    expect(html).toContain("BLOQUEADO");
  });

  // SPOT_UI_09: Stats grid with intents and positions
  it("SPOT_UI_09 — renders stats grid with intents and positions", () => {
    const html = renderToString(
      <SpotStatusPanel status={{ ...baseStatus, activeIntents: 3, trackedPositions: 2 } as any} onModeChange={noop} />
    );
    expect(html).toContain("Intents activos");
    expect(html).toContain("Posiciones trackeadas");
  });

  // SPOT_UI_10: REAL button disabled when not allowed
  it("SPOT_UI_10 — REAL button disabled when realActivationAllowed is false", () => {
    const html = renderToString(
      <SpotStatusPanel status={{ ...baseStatus, realActivationAllowed: false } as any} onModeChange={noop} />
    );
    expect(html).toContain("disabled");
  });
});
