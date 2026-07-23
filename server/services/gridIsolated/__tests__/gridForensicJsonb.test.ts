import { describe, it, expect } from "vitest";
import {
  safeParseRiskStateJsonForensic,
  safeParseMakerExitStateJsonForensic,
  safeParseTargetCalculationJsonForensic,
  validateTargetCalculationJson,
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

describe("REV-C11 FASE 2 — D8: validateTargetCalculationJson no lanza", () => {
  it("rejectedCandidate con side null → retorna objeto con INVALID_CANDIDATE", () => {
    const raw = {
      selected: true,
      stateVersion: 1,
      targetKind: "SYNTHETIC_RUNG",
      targetSellLevelId: "lvl-1",
      targetSellPrice: 110,
      targetSellQuantity: 0.1,
      rejectedCandidates: [
        { levelId: "r1", side: null, price: 100, reasonCode: "BELOW_MIN", reason: "test" },
      ],
      explanation: "ok",
    };
    expect(() => validateTargetCalculationJson(raw)).not.toThrow();
    const result = validateTargetCalculationJson(raw) as any;
    expect(result.valid).toBe(true);
    expect(result.value?.rejectedCandidates[0].reasonCode).toBe("INVALID_CANDIDATE");
  });

  it("rejectedCandidate con side undefined → retorna objeto con INVALID_CANDIDATE", () => {
    const raw = {
      selected: true,
      stateVersion: 1,
      targetKind: "SYNTHETIC_RUNG",
      targetSellLevelId: "lvl-1",
      targetSellPrice: 110,
      targetSellQuantity: 0.1,
      rejectedCandidates: [
        { levelId: "r1", price: 100, reasonCode: "BELOW_MIN", reason: "test" },
      ],
      explanation: "ok",
    };
    expect(() => validateTargetCalculationJson(raw)).not.toThrow();
    const result = validateTargetCalculationJson(raw) as any;
    expect(result.valid).toBe(true);
    expect(result.value?.rejectedCandidates[0].reasonCode).toBe("INVALID_CANDIDATE");
  });

  it("rejectedCandidate con side 'BOGUS' → retorna objeto con INVALID_CANDIDATE", () => {
    const raw = {
      selected: true,
      stateVersion: 1,
      targetKind: "SYNTHETIC_RUNG",
      targetSellLevelId: "lvl-1",
      targetSellPrice: 110,
      targetSellQuantity: 0.1,
      rejectedCandidates: [
        { levelId: "r1", side: "BOGUS", price: 100, reasonCode: "BELOW_MIN", reason: "test" },
      ],
      explanation: "ok",
    };
    expect(() => validateTargetCalculationJson(raw)).not.toThrow();
    const result = validateTargetCalculationJson(raw) as any;
    expect(result.valid).toBe(true);
    expect(result.value?.rejectedCandidates[0].reasonCode).toBe("INVALID_CANDIDATE");
  });

  it("rejectedCandidate null → retorna objeto con INVALID_CANDIDATE", () => {
    const raw = {
      selected: true,
      stateVersion: 1,
      targetKind: "SYNTHETIC_RUNG",
      targetSellLevelId: "lvl-1",
      targetSellPrice: 110,
      targetSellQuantity: 0.1,
      rejectedCandidates: [null],
      explanation: "ok",
    };
    expect(() => validateTargetCalculationJson(raw)).not.toThrow();
    const result = validateTargetCalculationJson(raw) as any;
    expect(result.valid).toBe(true);
    expect(result.value?.rejectedCandidates[0].reasonCode).toBe("INVALID_CANDIDATE");
  });

  it("rejectedCandidates válido con side BUY → pasa sin INVALID_CANDIDATE", () => {
    const raw = {
      selected: true,
      stateVersion: 1,
      targetKind: "SYNTHETIC_RUNG",
      targetSellLevelId: "lvl-1",
      targetSellPrice: 110,
      targetSellQuantity: 0.1,
      rejectedCandidates: [
        { levelId: "r1", side: "BUY", price: 100, reasonCode: "BELOW_MIN", reason: "test" },
      ],
      explanation: "ok",
    };
    const result = validateTargetCalculationJson(raw) as any;
    expect(result.valid).toBe(true);
    expect(result.value?.rejectedCandidates[0].reasonCode).toBe("BELOW_MIN");
    expect(result.value?.rejectedCandidates[0].side).toBe("BUY");
  });

  it("rejectedCandidates válido con side SELL → pasa sin INVALID_CANDIDATE", () => {
    const raw = {
      selected: true,
      stateVersion: 1,
      targetKind: "SYNTHETIC_RUNG",
      targetSellLevelId: "lvl-1",
      targetSellPrice: 110,
      targetSellQuantity: 0.1,
      rejectedCandidates: [
        { levelId: "r1", side: "SELL", price: 200, reasonCode: "ABOVE_MAX", reason: "test" },
      ],
      explanation: "ok",
    };
    const result = validateTargetCalculationJson(raw) as any;
    expect(result.valid).toBe(true);
    expect(result.value?.rejectedCandidates[0].reasonCode).toBe("ABOVE_MAX");
    expect(result.value?.rejectedCandidates[0].side).toBe("SELL");
  });

  it("rejectedCandidates vacío → array vacío", () => {
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
    const result = validateTargetCalculationJson(raw) as any;
    expect(result.valid).toBe(true);
    expect(result.value?.rejectedCandidates).toEqual([]);
  });

  it("rejectedCandidates no es array → valid:false con code TARGET_REJECTED_CANDIDATES_INVALID", () => {
    const raw = {
      selected: true,
      stateVersion: 1,
      targetKind: "SYNTHETIC_RUNG",
      targetSellLevelId: "lvl-1",
      targetSellPrice: 110,
      targetSellQuantity: 0.1,
      rejectedCandidates: "not-an-array",
      explanation: "ok",
    };
    const result = validateTargetCalculationJson(raw) as any;
    expect(result.valid).toBe(false);
    expect(result.code).toBe("TARGET_REJECTED_CANDIDATES_INVALID");
  });

  it("forensic parser con rejectedCandidate inválido preserva raw", () => {
    const raw = {
      selected: true,
      stateVersion: 1,
      targetKind: "SYNTHETIC_RUNG",
      targetSellLevelId: "lvl-1",
      targetSellPrice: 110,
      targetSellQuantity: 0.1,
      rejectedCandidates: [{ side: "BOGUS" }],
      explanation: "ok",
    };
    const result = safeParseTargetCalculationJsonForensic(raw);
    expect(result.valid).toBe(true);
    expect(result.value?.rejectedCandidates[0].reasonCode).toBe("INVALID_CANDIDATE");
    expect(result.raw).toBe(raw);
  });
});

describe("REV-C11 FASE 2 — D6: parseJsonSafe en audit VM", () => {
  it("parseJsonSafe con string JSON válido retorna objeto", async () => {
    const { buildGridAuditViewModel } = await import("../buildGridAuditViewModel");
    const vm = buildGridAuditViewModel("SHADOW", {
      pair: "BTC/USD", isActive: true, executionPolicy: "MAKER_ONLY",
      gridWalletMaxUsd: "5000", netProfitTargetPct: "0.80",
    }, {
      isRunning: true, activeRangeVersionId: "range-1",
    }, [], [], [], { id: "range-1", pair: "BTC/USD", status: "active" }, null, { at: null, result: null }, { at: null, result: null });
    expect(vm).toBeDefined();
    expect(vm.counters).toBeDefined();
  });

  it("parseJsonSafe con string JSON no-objeto retorna objeto vacío", async () => {
    const { buildGridAuditViewModel } = await import("../buildGridAuditViewModel");
    const vm = buildGridAuditViewModel("SHADOW", {
      pair: "BTC/USD", isActive: true, executionPolicy: "MAKER_ONLY",
      gridWalletMaxUsd: "5000", netProfitTargetPct: "0.80",
      rawConfigJson: '"a-string"',
    }, {
      isRunning: true, activeRangeVersionId: "range-1",
    }, [], [], [], { id: "range-1", pair: "BTC/USD", status: "active" }, null, { at: null, result: null }, { at: null, result: null });
    expect(vm).toBeDefined();
  });

  it("parseJsonSafe con number JSON retorna objeto vacío", async () => {
    const { buildGridAuditViewModel } = await import("../buildGridAuditViewModel");
    const vm = buildGridAuditViewModel("SHADOW", {
      pair: "BTC/USD", isActive: true, executionPolicy: "MAKER_ONLY",
      gridWalletMaxUsd: "5000", netProfitTargetPct: "0.80",
      rawConfigJson: '42',
    }, {
      isRunning: true, activeRangeVersionId: "range-1",
    }, [], [], [], { id: "range-1", pair: "BTC/USD", status: "active" }, null, { at: null, result: null }, { at: null, result: null });
    expect(vm).toBeDefined();
  });

  it("parseJsonSafe con JSON inválido retorna objeto vacío", async () => {
    const { buildGridAuditViewModel } = await import("../buildGridAuditViewModel");
    const vm = buildGridAuditViewModel("SHADOW", {
      pair: "BTC/USD", isActive: true, executionPolicy: "MAKER_ONLY",
      gridWalletMaxUsd: "5000", netProfitTargetPct: "0.80",
      rawConfigJson: '{invalid json',
    }, {
      isRunning: true, activeRangeVersionId: "range-1",
    }, [], [], [], { id: "range-1", pair: "BTC/USD", status: "active" }, null, { at: null, result: null }, { at: null, result: null });
    expect(vm).toBeDefined();
  });

  it("parseJsonSafe con null retorna objeto vacío", async () => {
    const { buildGridAuditViewModel } = await import("../buildGridAuditViewModel");
    const vm = buildGridAuditViewModel("SHADOW", {
      pair: "BTC/USD", isActive: true, executionPolicy: "MAKER_ONLY",
      gridWalletMaxUsd: "5000", netProfitTargetPct: "0.80",
      rawConfigJson: null,
    }, {
      isRunning: true, activeRangeVersionId: "range-1",
    }, [], [], [], { id: "range-1", pair: "BTC/USD", status: "active" }, null, { at: null, result: null }, { at: null, result: null });
    expect(vm).toBeDefined();
  });

  it("D4: buildCounters incluye hodl_recovery en openCycles", async () => {
    const { buildGridAuditViewModel } = await import("../buildGridAuditViewModel");
    const cycles = [
      { status: "open", rangeVersionId: "range-1" },
      { status: "hodl_recovery", rangeVersionId: "range-1" },
      { status: "completed", rangeVersionId: "range-1" },
    ];
    const vm = buildGridAuditViewModel("SHADOW", {
      pair: "BTC/USD", isActive: true, executionPolicy: "MAKER_ONLY",
      gridWalletMaxUsd: "5000", netProfitTargetPct: "0.80",
    }, {
      isRunning: true, activeRangeVersionId: "range-1",
    }, [], cycles, [], { id: "range-1", pair: "BTC/USD", status: "active" }, null, { at: null, result: null }, { at: null, result: null });
    expect(vm.counters.openCycles).toBe(2);
  });

  it("D4: buildCounters incluye stop_loss_hit y trailing_closed en historicalCycles", async () => {
    const { buildGridAuditViewModel } = await import("../buildGridAuditViewModel");
    const cycles = [
      { status: "completed", rangeVersionId: "range-1" },
      { status: "stop_loss_hit", rangeVersionId: "range-1" },
      { status: "trailing_closed", rangeVersionId: "range-1" },
      { status: "open", rangeVersionId: "range-1" },
    ];
    const vm = buildGridAuditViewModel("SHADOW", {
      pair: "BTC/USD", isActive: true, executionPolicy: "MAKER_ONLY",
      gridWalletMaxUsd: "5000", netProfitTargetPct: "0.80",
    }, {
      isRunning: true, activeRangeVersionId: "range-1",
    }, [], cycles, [], { id: "range-1", pair: "BTC/USD", status: "active" }, null, { at: null, result: null }, { at: null, result: null });
    expect(vm.counters.historicalCycles).toBe(3);
  });
});
