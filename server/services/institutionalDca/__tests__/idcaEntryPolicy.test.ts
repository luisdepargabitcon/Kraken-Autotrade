import { describe, expect, it, vi } from "vitest";
import { resolveIdcaEntryPolicy } from "../IdcaEntryPolicy";

function configWith(entryPolicy?: unknown) {
  return { entryUiJson: entryPolicy === undefined ? {} : { entryPolicy } };
}

describe("resolveIdcaEntryPolicy", () => {
  it("default sin entryPolicy es legacy/legacy", () => {
    expect(resolveIdcaEntryPolicy({}, "simulation", () => {})).toEqual({
      version: "legacy",
      reboundVariant: "legacy",
    });
    expect(resolveIdcaEntryPolicy(null, "simulation", () => {})).toEqual({
      version: "legacy",
      reboundVariant: "legacy",
    });
  });

  it.each([
    ["a1a_wick_geometry"],
    ["a1b_slowing_real_fall"],
    ["a1c_combined"],
  ] as const)("simulation respeta variante candidata %s", reboundVariant => {
    expect(resolveIdcaEntryPolicy(
      configWith({ version: "v2_candidate", reboundVariant }),
      "simulation",
      () => {},
    )).toEqual({ version: "v2_candidate", reboundVariant });
  });

  it.each(["shadow", "replay"] as const)("harness %s puede respetar variante candidata", mode => {
    expect(resolveIdcaEntryPolicy(
      configWith({ version: "v2_candidate", reboundVariant: "a1c_combined" }),
      mode,
      () => {},
    )).toEqual({ version: "v2_candidate", reboundVariant: "a1c_combined" });
  });

  it.each(["live", "disabled", "unknown_mode"] as const)("mode %s fuerza legacy y avisa", mode => {
    const warn = vi.fn();
    expect(resolveIdcaEntryPolicy(
      configWith({ version: "v2_candidate", reboundVariant: "a1c_combined" }),
      mode,
      warn,
    )).toEqual({ version: "legacy", reboundVariant: "legacy" });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("usando legacy");
  });

  it("variant experimental sin version v2_candidate no se activa", () => {
    const warn = vi.fn();
    expect(resolveIdcaEntryPolicy(
      configWith({ reboundVariant: "a1c_combined" }),
      "simulation",
      warn,
    )).toEqual({ version: "legacy", reboundVariant: "legacy" });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("valores inválidos caen a legacy con warning", () => {
    const warn = vi.fn();
    expect(resolveIdcaEntryPolicy(
      configWith({ version: "experimental", reboundVariant: "a9" }),
      "simulation",
      warn,
    )).toEqual({ version: "legacy", reboundVariant: "legacy" });
    expect(warn).toHaveBeenCalled();
  });

  it("legacy explícito es válido y no emite warning", () => {
    const warn = vi.fn();
    expect(resolveIdcaEntryPolicy(
      configWith({ version: "legacy", reboundVariant: "legacy" }),
      "live",
      warn,
    )).toEqual({ version: "legacy", reboundVariant: "legacy" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("no muta la configuración de entrada", () => {
    const entryPolicy = { version: "v2_candidate", reboundVariant: "a1c_combined" };
    const config = configWith(entryPolicy);
    resolveIdcaEntryPolicy(config, "simulation", () => {});
    expect(config.entryUiJson.entryPolicy).toEqual(entryPolicy);
  });
});
