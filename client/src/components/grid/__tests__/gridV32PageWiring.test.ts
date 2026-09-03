/**
 * GRID V3.2 Page wiring test — ensures GridIsolated.tsx uses GridSettingsPanel
 * and that the V3.2 controls are in the active component, not a dead duplicate.
 *
 * This test fails if someone moves V3.2 controls to a component that
 * GridIsolated does not render.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("GridIsolated page wiring — V3.2 controls in active component", () => {
  it("GridIsolated.tsx imports GridSettingsPanel (not GridAjustesPanel)", () => {
    const pagePath = path.resolve(process.cwd(), "client/src/pages/GridIsolated.tsx");
    const pageSource = fs.readFileSync(pagePath, "utf-8");
    expect(pageSource).toContain("GridSettingsPanel");
    expect(pageSource).not.toContain("GridAjustesPanel");
  });

  it("GridIsolated.tsx renders <GridSettingsPanel", () => {
    const pagePath = path.resolve(process.cwd(), "client/src/pages/GridIsolated.tsx");
    const pageSource = fs.readFileSync(pagePath, "utf-8");
    expect(pageSource).toMatch(/<GridSettingsPanel/);
  });

  it("GridSettingsPanel.tsx contains V3.2 FIELD_META entries", () => {
    const settingsPath = path.resolve(process.cwd(), "client/src/components/grid/GridSettingsPanel.tsx");
    const settingsSource = fs.readFileSync(settingsPath, "utf-8");
    expect(settingsSource).toContain("protectiveTakerFallbackEnabled");
    expect(settingsSource).toContain("protectiveMakerMaxAttempts");
    expect(settingsSource).toContain("protectiveMakerMaxWaitSeconds");
    expect(settingsSource).toContain("Salida taker de protección");
    expect(settingsSource).toContain("Intentos maker antes de taker");
    expect(settingsSource).toContain("Espera máxima maker");
  });

  it("GridSettingsPanel.tsx renders ProtectiveFeeReadonly", () => {
    const settingsPath = path.resolve(process.cwd(), "client/src/components/grid/GridSettingsPanel.tsx");
    const settingsSource = fs.readFileSync(settingsPath, "utf-8");
    expect(settingsSource).toContain("ProtectiveFeeReadonly");
    expect(settingsSource).toContain("effectiveTakerFeePct");
  });

  it("GridAjustesPanel.tsx does NOT exist (dead duplicate removed)", () => {
    const ajustesPath = path.resolve(process.cwd(), "client/src/components/grid/GridAjustesPanel.tsx");
    expect(fs.existsSync(ajustesPath)).toBe(false);
  });

  it("buildGridOperationalViewModel exposes V3.2 fields in exits expert block", () => {
    const vmPath = path.resolve(process.cwd(), "server/services/gridIsolated/buildGridOperationalViewModel.ts");
    const vmSource = fs.readFileSync(vmPath, "utf-8");
    expect(vmSource).toContain("protectiveTakerFallbackEnabled");
    expect(vmSource).toContain("protectiveMakerMaxAttempts");
    expect(vmSource).toContain("protectiveMakerMaxWaitSeconds");
  });
});
