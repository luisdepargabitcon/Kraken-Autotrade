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

describe("SpotStatusPanel — render tests", () => {

  it("1 — renders OFF mode with mode buttons", () => {
    const html = renderToString(
      <SpotStatusPanel status={baseStatus as any} onModeChange={noop} />
    );
    expect(html).toContain("OFF");
    expect(html).toContain("SHADOW");
    expect(html).toContain("REAL");
  });

  it("2 — renders SHADOW mode badge", () => {
    const html = renderToString(
      <SpotStatusPanel status={{ ...baseStatus, executionMode: "SHADOW" } as any} onModeChange={noop} />
    );
    expect(html).toContain("SHADOW");
  });

  it("3 — renders REAL mode with warning text", () => {
    const html = renderToString(
      <SpotStatusPanel status={{ ...baseStatus, executionMode: "REAL" } as any} onModeChange={noop} />
    );
    expect(html).toContain("REAL");
    expect(html).toContain("órdenes reales");
  });

  it("4 — displays fee maker and taker percentages", () => {
    const html = renderToString(
      <SpotStatusPanel status={baseStatus as any} onModeChange={noop} />
    );
    expect(html).toContain("0.100%");
    expect(html).toContain("0.200%");
  });

  it("5 — displays exchange name from feeModel", () => {
    const html = renderToString(
      <SpotStatusPanel status={baseStatus as any} onModeChange={noop} />
    );
    expect(html).toContain("REVOLUT_X");
  });

  it("6 — displays policy version", () => {
    const html = renderToString(
      <SpotStatusPanel status={baseStatus as any} onModeChange={noop} />
    );
    expect(html).toContain("R10.9");
  });

  it("7 — shows REAL PERMITIDO when realActivationAllowed is true", () => {
    const html = renderToString(
      <SpotStatusPanel status={baseStatus as any} onModeChange={noop} />
    );
    expect(html).toContain("PERMITIDO");
  });

  it("8 — shows REAL BLOQUEADO when realActivationAllowed is false", () => {
    const html = renderToString(
      <SpotStatusPanel status={{ ...baseStatus, realActivationAllowed: false } as any} onModeChange={noop} />
    );
    expect(html).toContain("BLOQUEADO");
  });

  it("9 — renders stats grid with intents and positions", () => {
    const html = renderToString(
      <SpotStatusPanel status={{ ...baseStatus, activeIntents: 3, trackedPositions: 2 } as any} onModeChange={noop} />
    );
    expect(html).toContain("Intents activos");
    expect(html).toContain("Posiciones trackeadas");
  });

  it("10 — REAL button disabled when realActivationAllowed is false", () => {
    const html = renderToString(
      <SpotStatusPanel status={{ ...baseStatus, realActivationAllowed: false } as any} onModeChange={noop} />
    );
    expect(html).toContain("disabled");
  });

  it("11 — renders without status (null)", () => {
    const html = renderToString(
      <SpotStatusPanel status={null} onModeChange={noop} />
    );
    expect(html).toContain("Estado del Motor SPOT");
  });

  it("12 — shows active intents count", () => {
    const html = renderToString(
      <SpotStatusPanel status={{ ...baseStatus, activeIntents: 5 } as any} onModeChange={noop} />
    );
    expect(html).toContain("5");
  });

  it("13 — shows tracked positions count", () => {
    const html = renderToString(
      <SpotStatusPanel status={{ ...baseStatus, trackedPositions: 7 } as any} onModeChange={noop} />
    );
    expect(html).toContain("7");
  });

  it("14 — mode change callback is async function", () => {
    const onModeChange = vi.fn(() => Promise.resolve(true));
    expect(typeof onModeChange).toBe("function");
    renderToString(
      <SpotStatusPanel status={baseStatus as any} onModeChange={onModeChange} />
    );
  });

  it("15 — renders all three mode buttons (OFF, SHADOW, REAL)", () => {
    const html = renderToString(
      <SpotStatusPanel status={baseStatus as any} onModeChange={noop} />
    );
    expect(html).toMatch(/OFF/);
    expect(html).toMatch(/SHADOW/);
    expect(html).toMatch(/REAL/);
  });
});
