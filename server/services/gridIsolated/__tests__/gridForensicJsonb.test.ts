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

  describe("REV-C11 FASE 2 CORRECCIÓN — audit y JSON forense", () => {
    it("Operational y Audit coinciden para un mismo ciclo cerrado cuyo target y ejecución son distintos", async () => {
      const { buildGridOperationalViewModel } = await import("../buildGridOperationalViewModel");
      const { buildGridAuditViewModel } = await import("../buildGridAuditViewModel");
      const cycles = [
        {
          id: "c1", cycleNumber: 1, pair: "BTC/USD", status: "completed",
          rangeVersionId: "range-1", buyLevelId: "b1",
          targetSellLevelId: "s1", targetSellPrice: "65000",
          sellPrice: "64700", sellFilledAt: new Date().toISOString(),
          quantity: "0.01", buyPrice: "60000",
          grossPnlUsd: "4.70", feeTotalUsd: "0.10", taxReserveUsd: "0.94",
          netPnlUsd: "3.66", netPnlPct: "0.61",
          completedAt: new Date().toISOString(),
          openedAt: new Date().toISOString(),
        },
      ];
      const baseInput = {
        mode: "SHADOW",
        config: { pair: "BTC/USD", isActive: true, executionPolicy: "MAKER_ONLY", gridWalletMaxUsd: "5000", netProfitTargetPct: "0.80" },
        status: { isRunning: true, activeRangeVersionId: "range-1" },
        levels: [], cycles, events: [],
        marketContext: { currentPrice: 64000, bid: 63950, ask: 64050, priceFresh: true },
        currentOperationalState: { status: "ok", title: "Grid", plainSummary: "", plainProblem: null, plainNextAction: "", hasActiveRange: true, canAnalyzeNow: true },
        recommendations: [],
      };
      const opVm = buildGridOperationalViewModel(baseInput as any);
      const auditVm = buildGridAuditViewModel("SHADOW", baseInput.config, baseInput.status, baseInput.levels, baseInput.cycles, baseInput.events, { id: "range-1", pair: "BTC/USD", status: "active" }, baseInput.marketContext, { at: null, result: null }, { at: null, result: null });
      const opCycle = opVm.closedCycles[0];
      const auditOpCycle = auditVm.operational.closedCycles[0];
      expect(opCycle.targetSellPrice).toBe(65000);
      expect(auditOpCycle.targetSellPrice).toBe(65000);
      expect(opCycle.sellPrice).toBe(64700);
      expect(auditOpCycle.sellPrice).toBe(64700);
      expect(opCycle.realizedNetPnl).toBeCloseTo(3.66, 5);
      expect(auditOpCycle.realizedNetPnl).toBeCloseTo(3.66, 5);
    });

    it("Operational y Audit coinciden para sell_filled", async () => {
      const { buildGridOperationalViewModel } = await import("../buildGridOperationalViewModel");
      const { buildGridAuditViewModel } = await import("../buildGridAuditViewModel");
      const cycles = [
        {
          id: "c2", cycleNumber: 2, pair: "BTC/USD", status: "sell_filled",
          rangeVersionId: "range-1", buyLevelId: "b2",
          targetSellLevelId: "s2", targetSellPrice: "95000",
          sellPrice: "94800", sellFilledAt: new Date().toISOString(),
          quantity: "0.01", buyPrice: "90000",
          grossPnlUsd: "4.80", feeTotalUsd: "0.10", taxReserveUsd: "0.96",
          netPnlUsd: "3.74", netPnlPct: "4.16",
          openedAt: new Date().toISOString(),
        },
      ];
      const baseInput = {
        mode: "SHADOW",
        config: { pair: "BTC/USD", isActive: true, executionPolicy: "MAKER_ONLY", gridWalletMaxUsd: "5000", netProfitTargetPct: "0.80" },
        status: { isRunning: true, activeRangeVersionId: "range-1" },
        levels: [], cycles, events: [],
        marketContext: { currentPrice: 94000, bid: 93950, ask: 94050, priceFresh: true },
        currentOperationalState: { status: "ok", title: "Grid", plainSummary: "", plainProblem: null, plainNextAction: "", hasActiveRange: true, canAnalyzeNow: true },
        recommendations: [],
      };
      const opVm = buildGridOperationalViewModel(baseInput as any);
      const auditVm = buildGridAuditViewModel("SHADOW", baseInput.config, baseInput.status, baseInput.levels, baseInput.cycles, baseInput.events, { id: "range-1", pair: "BTC/USD", status: "active" }, baseInput.marketContext, { at: null, result: null }, { at: null, result: null });
      expect(opVm.closedCycles[0].status).toBe("sell_filled");
      expect(auditVm.operational.closedCycles[0].status).toBe("sell_filled");
      expect(opVm.closedCycles[0].sellPrice).toBe(94800);
      expect(auditVm.operational.closedCycles[0].sellPrice).toBe(94800);
    });

    it("Operational y Audit coinciden para SYNTHETIC_RUNG", async () => {
      const { buildGridOperationalViewModel } = await import("../buildGridOperationalViewModel");
      const { buildGridAuditViewModel } = await import("../buildGridAuditViewModel");
      const cycles = [
        {
          id: "c3", cycleNumber: 3, pair: "BTC/USD", status: "buy_filled",
          rangeVersionId: "range-1", buyLevelId: "b3",
          targetKind: "SYNTHETIC_RUNG", targetSellLevelId: null,
          targetRungLevelId: "rung-5", targetSellPrice: "96000",
          sellPrice: null, quantity: "0.01", buyPrice: "90000",
          openedAt: new Date().toISOString(),
        },
      ];
      const baseInput = {
        mode: "SHADOW",
        config: { pair: "BTC/USD", isActive: true, executionPolicy: "MAKER_ONLY", gridWalletMaxUsd: "5000", netProfitTargetPct: "0.80" },
        status: { isRunning: true, activeRangeVersionId: "range-1" },
        levels: [], cycles, events: [],
        marketContext: { currentPrice: 94000, bid: 93950, ask: 94050, priceFresh: true },
        currentOperationalState: { status: "ok", title: "Grid", plainSummary: "", plainProblem: null, plainNextAction: "", hasActiveRange: true, canAnalyzeNow: true },
        recommendations: [],
      };
      const opVm = buildGridOperationalViewModel(baseInput as any);
      const auditVm = buildGridAuditViewModel("SHADOW", baseInput.config, baseInput.status, baseInput.levels, baseInput.cycles, baseInput.events, { id: "range-1", pair: "BTC/USD", status: "active" }, baseInput.marketContext, { at: null, result: null }, { at: null, result: null });
      expect(opVm.openCycles[0].targetSellLevelId).toBeNull();
      expect(auditVm.operational.openCycles[0].targetSellLevelId).toBeNull();
      expect(opVm.openCycles[0].targetRungLevelId).toBe("rung-5");
      expect(auditVm.operational.openCycles[0].targetRungLevelId).toBe("rung-5");
    });
  });

  describe("REV-C11 FASE 2 CIERRE — contrato forense del audit VM", () => {
    async function makeAuditVm(events: any[]) {
      const { buildGridAuditViewModel } = await import("../buildGridAuditViewModel");
      return buildGridAuditViewModel("SHADOW", {
        pair: "BTC/USD", isActive: true, executionPolicy: "MAKER_ONLY",
        gridWalletMaxUsd: "5000", netProfitTargetPct: "0.80",
      }, {
        isRunning: true, activeRangeVersionId: "range-1",
      }, [], [], events, { id: "range-1", pair: "BTC/USD", status: "active" }, null, { at: null, result: null }, { at: null, result: null });
    }

    it("1. JSON sintácticamente inválido: available=false, status=invalid, reviewCode=PARSE_ERROR, raw conservado, no defaults", async () => {
      const vm = await makeAuditVm([{ eventType: "GRID_PROFESSIONAL_GENERATOR_USED", metadataJson: "{invalid json", rangeVersionId: "range-1" }]);
      const d = vm.latestGridDiagnostic;
      expect(d.professionalGeneratorAvailable).toBe(false);
      expect(d.professionalGeneratorForensics.status).toBe("invalid");
      expect(d.professionalGeneratorForensics.requiresReview).toBe(true);
      expect(d.professionalGeneratorForensics.reviewCode).toBe("PARSE_ERROR");
      expect(d.professionalGeneratorForensics.raw).toBe("{invalid json");
      expect(d.professionalGeneratorGeneratedLevels).toBe(0);
      expect(d.professionalGeneratorReason).toContain("inválida");
    });

    it("2. Array JSON: available=false, reviewCode=INVALID_JSON_SHAPE, raw exacto", async () => {
      const vm = await makeAuditVm([{ eventType: "GRID_PROFESSIONAL_GENERATOR_USED", metadataJson: "[1, 2, 3]", rangeVersionId: "range-1" }]);
      const d = vm.latestGridDiagnostic;
      expect(d.professionalGeneratorAvailable).toBe(false);
      expect(d.professionalGeneratorForensics.status).toBe("invalid");
      expect(d.professionalGeneratorForensics.reviewCode).toBe("INVALID_JSON_SHAPE");
      expect(d.professionalGeneratorForensics.raw).toBe("[1, 2, 3]");
      expect(d.professionalGeneratorForensics.requiresReview).toBe(true);
    });

    it("3. Número JSON: available=false, reviewCode=INVALID_JSON_SHAPE, raw exacto", async () => {
      const vm = await makeAuditVm([{ eventType: "GRID_PROFESSIONAL_GENERATOR_USED", metadataJson: "123", rangeVersionId: "range-1" }]);
      const d = vm.latestGridDiagnostic;
      expect(d.professionalGeneratorAvailable).toBe(false);
      expect(d.professionalGeneratorForensics.reviewCode).toBe("INVALID_JSON_SHAPE");
      expect(d.professionalGeneratorForensics.raw).toBe("123");
    });

    it("4. Booleano JSON: available=false, reviewCode=INVALID_JSON_SHAPE, raw exacto", async () => {
      const vm = await makeAuditVm([{ eventType: "GRID_PROFESSIONAL_GENERATOR_USED", metadataJson: "true", rangeVersionId: "range-1" }]);
      const d = vm.latestGridDiagnostic;
      expect(d.professionalGeneratorAvailable).toBe(false);
      expect(d.professionalGeneratorForensics.reviewCode).toBe("INVALID_JSON_SHAPE");
      expect(d.professionalGeneratorForensics.raw).toBe("true");
    });

    it("5. String JSON: available=false, reviewCode=INVALID_JSON_SHAPE, raw exacto", async () => {
      const vm = await makeAuditVm([{ eventType: "GRID_PROFESSIONAL_GENERATOR_USED", metadataJson: '"hello world"', rangeVersionId: "range-1" }]);
      const d = vm.latestGridDiagnostic;
      expect(d.professionalGeneratorAvailable).toBe(false);
      expect(d.professionalGeneratorForensics.reviewCode).toBe("INVALID_JSON_SHAPE");
      expect(d.professionalGeneratorForensics.raw).toBe('"hello world"');
    });

    it("6. Objeto válido sin professionalGenerator: available=false, no defaults fabricados", async () => {
      const vm = await makeAuditVm([{ eventType: "GRID_PROFESSIONAL_GENERATOR_USED", metadataJson: '{"key": "value"}', rangeVersionId: "range-1" }]);
      const d = vm.latestGridDiagnostic;
      expect(d.professionalGeneratorAvailable).toBe(false);
      expect(d.professionalGeneratorForensics.status).toBe("invalid");
      expect(d.professionalGeneratorForensics.reviewCode).toBe("MISSING_PROFESSIONAL_GENERATOR");
      expect(d.professionalGeneratorForensics.requiresReview).toBe(true);
      expect(d.professionalGeneratorGeneratedLevels).toBe(0);
    });

    it("7. professionalGenerator con forma inválida (array): available=false, shape inválido, raw conservado", async () => {
      const vm = await makeAuditVm([{ eventType: "GRID_PROFESSIONAL_GENERATOR_USED", metadataJson: '{"professionalGenerator": [1, 2]}', rangeVersionId: "range-1" }]);
      const d = vm.latestGridDiagnostic;
      expect(d.professionalGeneratorAvailable).toBe(false);
      expect(d.professionalGeneratorForensics.status).toBe("invalid");
      expect(d.professionalGeneratorForensics.reviewCode).toBe("INVALID_JSON_SHAPE");
      expect(d.professionalGeneratorForensics.requiresReview).toBe(true);
    });

    it("8. professionalGenerator válido: available=true, status=valid, mode real, formula real, generatedLevels=6", async () => {
      const vm = await makeAuditVm([{ eventType: "GRID_PROFESSIONAL_GENERATOR_USED", metadataJson: JSON.stringify({
        professionalGenerator: {
          mode: "shadow_generation",
          formula: "accumulated_spacing",
          generatedBuyLevels: 3,
          generatedSellLevels: 3,
        },
      }), rangeVersionId: "range-1" }]);
      const d = vm.latestGridDiagnostic;
      expect(d.professionalGeneratorAvailable).toBe(true);
      expect(d.professionalGeneratorForensics.status).toBe("valid");
      expect(d.professionalGeneratorForensics.requiresReview).toBe(false);
      expect(d.professionalGeneratorGeneratedLevels).toBe(6);
    });

    it("9. null: available=false, status=absent, requiresReview=false, raw=null", async () => {
      const vm = await makeAuditVm([{ eventType: "GRID_PROFESSIONAL_GENERATOR_USED", metadataJson: null, rangeVersionId: "range-1" }]);
      const d = vm.latestGridDiagnostic;
      expect(d.professionalGeneratorAvailable).toBe(false);
      expect(d.professionalGeneratorForensics.status).toBe("absent");
      expect(d.professionalGeneratorForensics.requiresReview).toBe(false);
      expect(d.professionalGeneratorForensics.raw).toBeNull();
    });

    it("10. undefined: mismo comportamiento de ausencia", async () => {
      const vm = await makeAuditVm([{ eventType: "GRID_PROFESSIONAL_GENERATOR_USED", metadataJson: undefined, rangeVersionId: "range-1" }]);
      const d = vm.latestGridDiagnostic;
      expect(d.professionalGeneratorAvailable).toBe(false);
      expect(d.professionalGeneratorForensics.status).toBe("absent");
      expect(d.professionalGeneratorForensics.requiresReview).toBe(false);
      expect(d.professionalGeneratorForensics.raw).toBeNull();
    });

    it("11. El raw sobrevive hasta el GridAuditViewModel final (no se queda en variable local)", async () => {
      const rawJson = "{corrupt";
      const vm = await makeAuditVm([{ eventType: "GRID_PROFESSIONAL_GENERATOR_USED", metadataJson: rawJson, rangeVersionId: "range-1" }]);
      expect(vm.latestGridDiagnostic.professionalGeneratorForensics.raw).toBe(rawJson);
    });

    it("12. latestGridDiagnostic expone el estado forense exacto", async () => {
      const vm = await makeAuditVm([{ eventType: "GRID_PROFESSIONAL_GENERATOR_USED", metadataJson: "42", rangeVersionId: "range-1" }]);
      const f = vm.latestGridDiagnostic.professionalGeneratorForensics;
      expect(f.status).toBe("invalid");
      expect(f.requiresReview).toBe(true);
      expect(f.reviewCode).toBe("INVALID_JSON_SHAPE");
      expect(f.reviewReason).toBeTruthy();
      expect(f.raw).toBe("42");
    });
  });
});
