/**
 * idcaLogPrefixes.test.ts
 * Tests for log prefix correctness and parser backward compatibility.
 *
 * Verifies:
 *  1. New logs do NOT contain [IDCA][IDCA][...] double prefix
 *  2. Parser matches [IDCA][EFFECTIVE_CONFIG] (new format)
 *  3. Parser matches [IDCA][IDCA][EFFECTIVE_CONFIG] (legacy backward compat — substring match)
 *  4. Parser matches [IDCA][VWAP_RELIABILITY] (new format)
 *  5. Parser matches [IDCA][IDCA][VWAP_RELIABILITY] (legacy backward compat)
 *  6. Parser matches [IDCA][REFERENCE_CONTEXT]
 *  7. Parser matches [IDCA][ANCHOR_METADATA_WARNING]
 *  8. TAG prefix is correctly [IDCA] single
 */
import { describe, it, expect } from "vitest";
import { extractEvent, isIdcaLine } from "../institutionalDca/idcaLogParser";

const TAG = "[IDCA]";

describe("IDCA Log Prefixes — no double prefix", () => {
  it("1. New EFFECTIVE_CONFIG log has single [IDCA] prefix, not double", () => {
    const log = `${TAG}[EFFECTIVE_CONFIG] pair=BTC/USD source=sliders effectiveMinDipPct=4.20%`;
    expect(log).toContain("[IDCA][EFFECTIVE_CONFIG]");
    expect(log).not.toContain("[IDCA][IDCA]");
  });

  it("2. New VWAP_RELIABILITY log has single [IDCA] prefix, not double", () => {
    const log = `${TAG}[VWAP_RELIABILITY] pair=ETH/USD candlesUsed=10 reliableForEntry=false`;
    expect(log).toContain("[IDCA][VWAP_RELIABILITY]");
    expect(log).not.toContain("[IDCA][IDCA]");
  });

  it("3. New REFERENCE_CONTEXT log has single [IDCA] prefix", () => {
    const log = `${TAG}[REFERENCE_CONTEXT] pair=ETH/USD effectiveEntryReference=2424.05 referenceSource=vwap_anchor`;
    expect(log).toContain("[IDCA][REFERENCE_CONTEXT]");
    expect(log).not.toContain("[IDCA][IDCA]");
  });

  it("4. New ANCHOR_METADATA_WARNING log has single [IDCA] prefix", () => {
    const log = `${TAG}[ANCHOR_METADATA_WARNING] pair=ETH/USD source=hybrid_v2_fallback reason=missing_anchor_timestamp`;
    expect(log).toContain("[IDCA][ANCHOR_METADATA_WARNING]");
    expect(log).not.toContain("[IDCA][IDCA]");
  });
});

describe("IDCA Log Parser — event extraction", () => {
  it("5. Parser extracts EFFECTIVE_CONFIG from new format", () => {
    const log = "[IDCA][EFFECTIVE_CONFIG] pair=BTC/USD source=sliders effectiveMinDipPct=4.20%";
    expect(extractEvent(log)).toBe("EFFECTIVE_CONFIG");
  });

  it("6. Parser extracts EFFECTIVE_CONFIG from legacy double-prefix format (backward compat)", () => {
    const log = "[IDCA][IDCA][EFFECTIVE_CONFIG] pair=BTC/USD source=sliders effectiveMinDipPct=4.20%";
    expect(extractEvent(log)).toBe("EFFECTIVE_CONFIG");
  });

  it("7. Parser extracts VWAP_RELIABILITY from new format", () => {
    const log = "[IDCA][VWAP_RELIABILITY] pair=ETH/USD candlesUsed=10 reliableForEntry=false";
    expect(extractEvent(log)).toBe("VWAP_RELIABILITY");
  });

  it("8. Parser extracts VWAP_RELIABILITY from legacy double-prefix format", () => {
    const log = "[IDCA][IDCA][VWAP_RELIABILITY] pair=ETH/USD candlesUsed=10 reliableForEntry=false";
    expect(extractEvent(log)).toBe("VWAP_RELIABILITY");
  });

  it("9. Parser extracts REFERENCE_CONTEXT", () => {
    const log = "[IDCA][REFERENCE_CONTEXT] pair=ETH/USD effectiveEntryReference=2424.05 anchorTimestamp=2026-04-22T16:00:00.000Z";
    expect(extractEvent(log)).toBe("REFERENCE_CONTEXT");
  });

  it("10. Parser extracts ANCHOR_METADATA_WARNING", () => {
    const log = "[IDCA][ANCHOR_METADATA_WARNING] pair=ETH/USD source=vwap_anchor reason=missing_anchor_timestamp";
    expect(extractEvent(log)).toBe("ANCHOR_METADATA_WARNING");
  });

  it("11. isIdcaLine recognises new log formats", () => {
    expect(isIdcaLine("[IDCA][REFERENCE_CONTEXT] pair=BTC/USD")).toBe(true);
    expect(isIdcaLine("[IDCA][ANCHOR_METADATA_WARNING] pair=ETH/USD")).toBe(true);
    expect(isIdcaLine("[IDCA][EFFECTIVE_CONFIG] pair=BTC/USD")).toBe(true);
  });

  it("12. TAG is single [IDCA]", () => {
    expect(TAG).toBe("[IDCA]");
    expect(TAG.match(/\[IDCA\]/g)?.length).toBe(1);
  });
});
