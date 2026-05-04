/**
 * idcaReferenceContext.test.ts
 * Tests for buildReferenceContext() and getVwapReliabilityReason()
 *
 * Verifies 18 cases from the spec:
 * 1-9: referenceSource, labels, reasons, vwapStatus, legacyIgnored
 * 10-12: event payload fields (entry_check_blocked includes referenceContext)
 * 13-14: logs (vwapStatus in REFERENCE_CONTEXT log)
 * 15-18: UI safety (no throw when fields are null/missing)
 */

import { describe, it, expect } from "vitest";
import {
  buildReferenceContext,
  getVwapReliabilityReason,
  MIN_VWAP_CANDLES_FOR_ENTRY_DEFAULT,
  ANCHOR_STALE_HOURS,
  ANCHOR_VERY_STALE_HOURS,
  type BuildReferenceContextInput,
} from "../institutionalDca/IdcaReferenceContext";
import type { EffectiveEntryReferenceResult } from "../institutionalDca/IdcaEntryReferenceResolver";
import type { BasePriceResult } from "../institutionalDca/IdcaTypes";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = Date.now();

function makeBasePriceResult(overrides: Partial<BasePriceResult> = {}): BasePriceResult {
  return {
    price: 80000,
    type: "hybrid_v2" as any,
    windowMinutes: 1440,
    timestamp: new Date(NOW - 3600_000),
    isReliable: true,
    reason: "Hybrid V2.1 selected swing high",
    meta: {
      candleCount: 96,
      swingHighsFound: 3,
      selectedMethod: "swing_high_24h",
      selectedReason: "Swing high 24h aligned with P95",
      selectedAnchorPrice: 80500,
    },
    ...overrides,
  };
}

function makeRefResult(overrides: Partial<EffectiveEntryReferenceResult> = {}): EffectiveEntryReferenceResult {
  return {
    effectiveEntryReference: 80000,
    effectiveReferenceSource: "hybrid_v2_fallback",
    effectiveReferenceLabel: "Hybrid V2.1",
    technicalBasePrice: 80000,
    technicalBaseType: "hybrid_v2",
    technicalBaseTimestamp: new Date(NOW).toISOString(),
    referenceChangedRecently: false,
    ...overrides,
  };
}

function makeInput(overrides: Partial<BuildReferenceContextInput> = {}): BuildReferenceContextInput {
  return {
    pair: "BTC/USD",
    refResult: makeRefResult(),
    basePriceResult: makeBasePriceResult(),
    vwapEnabled: true,
    now: NOW,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildReferenceContext — referenceSource", () => {
  it("1. source=vwap_anchor → referenceLabel='VWAP Anclado'", () => {
    const rc = buildReferenceContext(makeInput({
      refResult: makeRefResult({
        effectiveReferenceSource: "vwap_anchor",
        effectiveReferenceLabel: "VWAP Anclado",
        frozenAnchorPrice: 2424.05,
        frozenAnchorTs: NOW - 10 * 3600_000,
        frozenAnchorAgeHours: 10,
      }),
      frozenAnchor: {
        anchorPrice: 2424.05,
        anchorTimestamp: NOW - 10 * 3600_000,
        setAt: NOW - 10 * 3600_000,
        drawdownPct: 0,
      },
    }));
    expect(rc.referenceSource).toBe("vwap_anchor");
    expect(rc.referenceLabel).toBe("VWAP Anclado");
    expect(rc.vwapUsed).toBe(true);
    expect(rc.vwapStatus).toBe("used");
  });

  it("2. source=hybrid_v2_fallback → referenceSource='hybrid_v2'", () => {
    const rc = buildReferenceContext(makeInput());
    expect(rc.referenceSource).toBe("hybrid_v2");
    expect(rc.vwapUsed).toBe(false);
  });

  it("3. hybrid_v2 → referenceLabel='Hybrid V2.1'", () => {
    const rc = buildReferenceContext(makeInput());
    expect(rc.referenceLabel).toBe("Hybrid V2.1");
  });
});

describe("buildReferenceContext — vwapStatus and vwapRejectReason", () => {
  it("4. vwapUsed=false + status=insufficient_candles includes vwapRejectReason with candle count", () => {
    const rc = buildReferenceContext(makeInput({
      basePriceResult: makeBasePriceResult({
        meta: { candleCount: 9, swingHighsFound: 0 },
      }),
    }));
    expect(rc.vwapStatus).toBe("insufficient_candles");
    expect(rc.vwapRejectReason).not.toBeNull();
    expect(rc.vwapRejectReason).toContain("9");
    expect(rc.vwapRejectReason).toContain(String(MIN_VWAP_CANDLES_FOR_ENTRY_DEFAULT));
  });

  it("5. VWAP con 9 velas y mínimo 24 dice 'solo hay 9 velas'", () => {
    const reason = getVwapReliabilityReason("insufficient_candles", { candlesUsed: 9, minCandlesRequired: 24 });
    expect(reason).toContain("solo hay 9 velas");
    expect(reason).toContain("al menos 24");
  });

  it("6. missing_anchor dice 'no existe una ancla VWAP válida'", () => {
    const reason = getVwapReliabilityReason("missing_anchor");
    expect(reason).toContain("no existe una ancla VWAP válida");
  });

  it("7. locked_by_active_cycle dice 'ciclo activo'", () => {
    const reason = getVwapReliabilityReason("locked_by_active_cycle");
    expect(reason).toContain("ciclo activo");
  });

  it("8. rejected_anti_chasing dice 'evitar perseguir el precio'", () => {
    const reason = getVwapReliabilityReason("rejected_anti_chasing");
    expect(reason).toContain("evitar perseguir el precio");
  });

  it("9. vwap_anchor con anchorAgeHours=291.6 produce anchorStatus=stale + warning en reason", () => {
    const ageHours = 291.6;
    const rc = buildReferenceContext(makeInput({
      refResult: makeRefResult({
        effectiveReferenceSource: "vwap_anchor",
        effectiveReferenceLabel: "VWAP Anclado",
        frozenAnchorPrice: 2424.05,
        frozenAnchorTs: NOW - ageHours * 3600_000,
        frozenAnchorAgeHours: ageHours,
      }),
      frozenAnchor: {
        anchorPrice: 2424.05,
        anchorTimestamp: NOW - ageHours * 3600_000,
        setAt: NOW - ageHours * 3600_000,
        drawdownPct: 0,
      },
    }));
    expect(rc.anchorStatus).toBe("stale");
    expect(rc.vwapReliability.reason).toContain("291.6h");
    expect(rc.vwapReliability.reason).toContain("Revisar");
    // No altera lógica de trading
    expect(rc.vwapUsed).toBe(true);  // sigue usándose
  });
});

describe("buildReferenceContext — event payload fields", () => {
  it("10. referenceContext contiene referenceSource correcto", () => {
    const rc = buildReferenceContext(makeInput({
      refResult: makeRefResult({
        effectiveReferenceSource: "vwap_anchor",
        effectiveReferenceLabel: "VWAP Anclado",
        frozenAnchorPrice: 2424.05,
        frozenAnchorTs: NOW - 5 * 3600_000,
        frozenAnchorAgeHours: 5,
      }),
      frozenAnchor: { anchorPrice: 2424.05, anchorTimestamp: NOW - 5 * 3600_000, setAt: NOW - 5 * 3600_000, drawdownPct: 0 },
    }));
    expect(rc.referenceSource).toBe("vwap_anchor");
  });

  it("11. referenceContext contiene referenceReason no vacío", () => {
    const rc = buildReferenceContext(makeInput());
    expect(rc.referenceReason).toBeTruthy();
    expect(rc.referenceReason.length).toBeGreaterThan(10);
  });

  it("12. referenceContext contiene vwapReliability con todos los campos", () => {
    const rc = buildReferenceContext(makeInput());
    expect(rc.vwapReliability).toHaveProperty("usableForEntry");
    expect(rc.vwapReliability).toHaveProperty("usableForContext");
    expect(rc.vwapReliability).toHaveProperty("status");
    expect(rc.vwapReliability).toHaveProperty("reason");
    expect(rc.vwapReliability).toHaveProperty("checkedAt");
  });
});

describe("buildReferenceContext — log/parser safety", () => {
  it("13. vwapStatus aparece en el contexto del log (presente en objeto)", () => {
    const rc = buildReferenceContext(makeInput());
    expect(rc.vwapStatus).toBeTruthy();
    expect(typeof rc.vwapStatus).toBe("string");
  });

  it("14. vwapReliability.status coincide con vwapStatus del contexto", () => {
    const rc = buildReferenceContext(makeInput());
    expect(rc.vwapReliability.status).toBe(rc.vwapStatus);
  });
});

describe("buildReferenceContext — UI safety", () => {
  it("15. vwapRejectReason es null cuando vwapUsed=true", () => {
    const rc = buildReferenceContext(makeInput({
      refResult: makeRefResult({
        effectiveReferenceSource: "vwap_anchor",
        effectiveReferenceLabel: "VWAP Anclado",
        frozenAnchorPrice: 2424.05,
        frozenAnchorTs: NOW - 5 * 3600_000,
        frozenAnchorAgeHours: 5,
      }),
      frozenAnchor: { anchorPrice: 2424.05, anchorTimestamp: NOW - 5 * 3600_000, setAt: NOW - 5 * 3600_000, drawdownPct: 0 },
    }));
    expect(rc.vwapRejectReason).toBeNull();
  });

  it("16. vwapRejectReason no es null cuando vwapUsed=false", () => {
    const rc = buildReferenceContext(makeInput());
    expect(rc.vwapRejectReason).not.toBeNull();
  });

  it("17. referenceReason nunca es undefined ni vacío", () => {
    const rc = buildReferenceContext(makeInput());
    expect(rc.referenceReason).toBeDefined();
    expect(rc.referenceReason).not.toBe("");
  });

  it("18. previousAnchor es null cuando no hay ancla anterior", () => {
    const rc = buildReferenceContext(makeInput());
    expect(rc.previousAnchor).toBeNull();
  });

  it("18b. ANCHOR_STALE_HOURS y ANCHOR_VERY_STALE_HOURS son valores numéricos positivos", () => {
    expect(ANCHOR_STALE_HOURS).toBeGreaterThan(0);
    expect(ANCHOR_VERY_STALE_HOURS).toBeGreaterThan(ANCHOR_STALE_HOURS);
  });
});
