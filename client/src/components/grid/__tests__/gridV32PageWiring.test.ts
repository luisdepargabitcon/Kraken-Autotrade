/**
 * GRID V3.2 Page wiring test — ensures GridIsolated.tsx uses GridSettingsPanel
 * and that the V3.2 controls are in the active component, not a dead duplicate.
 *
 * This test fails if someone moves V3.2 controls to a component that
 * GridIsolated does not render.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("GridIsolated page wiring — V3.2 controls in active component", () => {
  it("GridIsolated.tsx imports GridSettingsPanel (not GridAjustesPanel)", () => {
    const pagePath = resolve(__dirname, "../../../pages/GridIsolated.tsx");
    const pageSource = readFileSync(pagePath, "utf-8");
    expect(pageSource).toContain("GridSettingsPanel");
    expect(pageSource).not.toContain("GridAjustesPanel");
  });

  it("GridIsolated.tsx renders <GridSettingsPanel", () => {
    const pagePath = resolve(__dirname, "../../../pages/GridIsolated.tsx");
    const pageSource = readFileSync(pagePath, "utf-8");
    expect(pageSource).toMatch(/<GridSettingsPanel/);
  });

  it("GridSettingsPanel.tsx contains V3.2 FIELD_META entries", () => {
    const settingsPath = resolve(__dirname, "../GridSettingsPanel.tsx");
    const settingsSource = readFileSync(settingsPath, "utf-8");
    expect(settingsSource).toContain("protectiveTakerFallbackEnabled");
    expect(settingsSource).toContain("protectiveMakerMaxAttempts");
    expect(settingsSource).toContain("protectiveMakerMaxWaitSeconds");
    expect(settingsSource).toContain("Salida taker de protección");
    expect(settingsSource).toContain("Intentos maker antes de taker");
    expect(settingsSource).toContain("Espera máxima maker");
  });

  it("GridSettingsPanel.tsx renders ProtectiveFeeReadonly", () => {
    const settingsPath = resolve(__dirname, "../GridSettingsPanel.tsx");
    const settingsSource = readFileSync(settingsPath, "utf-8");
    expect(settingsSource).toContain("ProtectiveFeeReadonly");
    expect(settingsSource).toContain("effectiveTakerFeePct");
  });

  it("GridAjustesPanel.tsx does NOT exist (dead duplicate removed)", () => {
    const ajustesPath = resolve(__dirname, "../GridAjustesPanel.tsx");
    expect(existsSync(ajustesPath)).toBe(false);
  });

  it("buildGridOperationalViewModel exposes V3.2 fields in exits expert block", () => {
    const vmPath = resolve(
      __dirname,
      "../../../../../server/services/gridIsolated/buildGridOperationalViewModel.ts",
    );
    const vmSource = readFileSync(vmPath, "utf-8");
    expect(vmSource).toContain("protectiveTakerFallbackEnabled");
    expect(vmSource).toContain("protectiveMakerMaxAttempts");
    expect(vmSource).toContain("protectiveMakerMaxWaitSeconds");
  });
});
