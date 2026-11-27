import { describe, expect, it, vi } from "vitest";
import { resolveIdcaEntryPolicy } from "../IdcaEntryPolicy";

function configWith(entryPolicy?: unknown) {
  return { entryUiJson: entryPolicy === undefined ? {} : { entryPolicy } };
}

function legacyResolution() {
  return { version: "legacy", reboundVariant: "legacy", confluenceEnforcement: "diagnostic" };
}

describe("resolveIdcaEntryPolicy", () => {
  it("default sin entryPolicy es legacy/legacy/diagnostic", () => {
    expect(resolveIdcaEntryPolicy({}, "simulation", () => {})).toEqual(legacyResolution());
    expect(resolveIdcaEntryPolicy(null, "simulation", () => {})).toEqual(legacyResolution());
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
    )).toEqual({ version: "v2_candidate", reboundVariant, confluenceEnforcement: "diagnostic" });
  });

  it.each(["shadow", "replay"] as const)("harness %s puede respetar variante candidata", mode => {
    expect(resolveIdcaEntryPolicy(
      configWith({ version: "v2_candidate", reboundVariant: "a1c_combined" }),
      mode,
      () => {},
    )).toEqual({ version: "v2_candidate", reboundVariant: "a1c_combined", confluenceEnforcement: "diagnostic" });
  });

  it.each(["live", "disabled", "unknown_mode"] as const)("mode %s fuerza legacy/diagnostic y avisa", mode => {
    const warn = vi.fn();
    expect(resolveIdcaEntryPolicy(
      configWith({ version: "v2_candidate", reboundVariant: "a1c_combined", confluenceEnforcement: "enforced" }),
      mode,
      warn,
    )).toEqual(legacyResolution());
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("usando legacy");
  });

  it("variant experimental sin version v2_candidate no se activa", () => {
    const warn = vi.fn();
    expect(resolveIdcaEntryPolicy(
      configWith({ reboundVariant: "a1c_combined" }),
      "simulation",
      warn,
    )).toEqual(legacyResolution());
    expect(warn).toHaveBeenCalledOnce();
  });

  it("valores inválidos caen a legacy/diagnostic con warning", () => {
    const warn = vi.fn();
    expect(resolveIdcaEntryPolicy(
      configWith({ version: "experimental", reboundVariant: "a9", confluenceEnforcement: "force" }),
      "simulation",
      warn,
    )).toEqual(legacyResolution());
    expect(warn).toHaveBeenCalled();
  });

  it("legacy explícito es válido y no emite warning", () => {
    const warn = vi.fn();
    expect(resolveIdcaEntryPolicy(
      configWith({ version: "legacy", reboundVariant: "legacy", confluenceEnforcement: "diagnostic" }),
      "live",
      warn,
    )).toEqual(legacyResolution());
    expect(warn).not.toHaveBeenCalled();
  });

  it("simulation+v2_candidate respeta confluenceEnforcement enforced", () => {
    expect(resolveIdcaEntryPolicy(
      configWith({ version: "v2_candidate", confluenceEnforcement: "enforced" }),
      "simulation",
      () => {},
    )).toEqual({
      version: "v2_candidate",
      reboundVariant: "legacy",
      confluenceEnforcement: "enforced",
    });
  });

  it.each(["shadow", "replay"] as const)("harness %s respeta confluenceEnforcement enforced", mode => {
    expect(resolveIdcaEntryPolicy(
      configWith({ version: "v2_candidate", confluenceEnforcement: "enforced" }),
      mode,
      () => {},
    ).confluenceEnforcement).toBe("enforced");
  });

  it("enforced sin version v2_candidate queda diagnostic en simulation", () => {
    const warn = vi.fn();
    expect(resolveIdcaEntryPolicy(
      configWith({ confluenceEnforcement: "enforced" }),
      "simulation",
      warn,
    )).toEqual(legacyResolution());
    expect(warn).toHaveBeenCalledOnce();
  });

  it("live+v2_candidate+enforced fuerza diagnostic", () => {
    const warn = vi.fn();
    expect(resolveIdcaEntryPolicy(
      configWith({ version: "v2_candidate", confluenceEnforcement: "enforced" }),
      "live",
      warn,
    ).confluenceEnforcement).toBe("diagnostic");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("diagnostic explícito con v2_candidate no convierte la política en legacy", () => {
    expect(resolveIdcaEntryPolicy(
      configWith({ version: "v2_candidate", confluenceEnforcement: "diagnostic" }),
      "simulation",
      () => {},
    )).toEqual({
      version: "v2_candidate",
      reboundVariant: "legacy",
      confluenceEnforcement: "diagnostic",
    });
  });

  it("no muta la configuración de entrada", () => {
    const entryPolicy = {
      version: "v2_candidate",
      reboundVariant: "a1c_combined",
      confluenceEnforcement: "enforced",
    };
    const config = configWith(entryPolicy);
    resolveIdcaEntryPolicy(config, "simulation", () => {});
    expect(config.entryUiJson.entryPolicy).toEqual(entryPolicy);
  });
});
