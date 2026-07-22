import { describe, it, expect } from "vitest";
import {
  safeParseRiskStateJsonForensic,
  safeParseMakerExitStateJsonForensic,
  safeParseTargetCalculationJsonForensic,
} from "../gridJsonbValidators";

describe("Grid JSONB forensic parsers", () => {
  it("preserves raw risk_state_json when invalid and sets review fields", () => {
    const raw = { stateVersion: 99, protectiveExit: { state: "NONE" } };
    const result = safeParseRiskStateJsonForensic(raw);
    expect(result.valid).toBe(false);
    expect(result.value).toBeNull();
    expect(result.raw).toBe(raw);
    expect(result.reason).toBeTruthy();
    expect(result.code).toBe("RISK_UNKNOWN_VERSION");
  });

  it("preserves raw maker_exit_state_json when state is invalid", () => {
    const raw = { state: "BOGUS", route: null };
    const result = safeParseMakerExitStateJsonForensic(raw);
    expect(result.valid).toBe(false);
    expect(result.value).toBeNull();
    expect(result.raw).toBe(raw);
    expect(result.code).toBe("MAKER_EXIT_STATE_INVALID");
  });

  it("preserves raw target_calculation_json when stateVersion is missing", () => {
    const raw = { selected: true, targetKind: "SYNTHETIC_RUNG" };
    const result = safeParseTargetCalculationJsonForensic(raw);
    expect(result.valid).toBe(false);
    expect(result.value).toBeNull();
    expect(result.raw).toBe(raw);
    expect(result.code).toBe("TARGET_UNKNOWN_VERSION");
  });

  it("returns typed value for valid targetCalculationJson", () => {
    const raw = {
      selected: true,
      stateVersion: 1,
      targetKind: "SYNTHETIC_RUNG",
      targetSellLevelId: "lvl-1",
      targetSellPrice: 110,
      targetSellQuantity: 0.1,
      rejectedCandidates: [],
      explanation: "ok",
    };
    const result = safeParseTargetCalculationJsonForensic(raw);
    expect(result.valid).toBe(true);
    expect(result.value?.selected).toBe(true);
    expect(result.value?.targetSellPrice).toBe(110);
    expect(result.raw).toBe(raw);
  });

  it("treats null JSONB as valid and preserves null raw", () => {
    expect(safeParseRiskStateJsonForensic(null)).toEqual({ valid: true, value: null, raw: null });
    expect(safeParseTargetCalculationJsonForensic(null)).toEqual({ valid: true, value: null, raw: null });
  });
});
