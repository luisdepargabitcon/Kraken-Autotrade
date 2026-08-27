/**
 * spotAiBuilderFailClosedR10.test.ts — R10-06 canonical builders fail closed.
 *
 * R10-06: Canonical builders MUST NOT produce a payload with invalid policy.
 * No fallback to the original string.
 * - "BACKFILL" => fail closed (INVALID_POLICY_PROVENANCE)
 * - "  SPOT_POLICY_X  " => policy SPOT_POLICY_X
 * - entry/giveback identical policy canonicalization
 */

import { describe, it, expect } from "vitest";
import {
  buildDurableEntryPayload,
  buildDurableGivebackPayload,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import type { CompletedTrade } from "../spotAiForwardTwin/spotAiCompletedTrades";
import type { SpotAiGivebackSample } from "../spotAiForwardTwin/spotAiForwardTwinTypes";

function makeTrade(): CompletedTrade {
  return {
    lotId: "lot-1", pair: "BTC/USD", entryScanId: "scan-1",
    entryTime: 1000, exitTime: 2000,
    entryPrice: 100, exitPrice: 110,
    initialStopPrice: 95, initialRiskUsd: 10,
    weightedAverageExitPrice: 110, weightedAverageEntryPrice: 100,
    totalEntryVolume: 1, totalExitVolume: 1, closedQty: 1,
    totalEntryFeeUsd: 1, entryFeeAllocatedUsd: 1, totalExitFeeUsd: 1,
    entryFeeUsd: 1, exitFeeUsd: 1,
    grossPnlUsd: 10, netPnlUsd: 8,
    mfe: 10, mae: -5, mfeR: 1, maeR: -0.5,
    exitReasonType: "TARGET",
  };
}

function makeGivebackSample(policy: string, labels: any = { future_MFE_R: 2.0 }): SpotAiGivebackSample {
  return {
    sampleId: "gb-1",
    split: "train",
    groupId: "lot-1",
    state: {
      lotId: "lot-1", pair: "BTC/USD", timestamp: 1000,
      entryPrice: 100, currentR: 1.5,
      runningMfeR: 1, runningMaeR: -0.5,
      mfeUsd: 10, maeUsd: -5, minutesInTrade: 30,
      breakEvenActivated: false, trailingActivated: false,
      currentStopPrice: 95, highestPrice: 110,
      currentRUnavailable: false,
    } as any,
    labels: labels as any,
    sourceForwardTwinSchemaVersion: 2,
    sourcePolicyVersion: policy,
  };
}

describe("R10-06 CANONICAL BUILDERS FAIL CLOSED", () => {
  // BUILDER_R10_POLICY_01: "BACKFILL" => fail closed
  it("BUILDER_R10_POLICY_01: entry 'BACKFILL' => fail closed, no row", () => {
    const trade = makeTrade();
    const r = buildDurableEntryPayload(trade, { f: 1 }, { l: 1 }, "BACKFILL");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("INVALID_POLICY_PROVENANCE");
    }
  });

  it("BUILDER_R10_POLICY_01b: entry 'backfill' (lowercase) => fail closed", () => {
    const trade = makeTrade();
    const r = buildDurableEntryPayload(trade, { f: 1 }, { l: 1 }, "backfill");
    expect(r.ok).toBe(false);
  });

  it("BUILDER_R10_POLICY_01c: giveback 'BACKFILL' => fail closed", () => {
    const sample = makeGivebackSample("BACKFILL");
    const r = buildDurableGivebackPayload(sample);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("INVALID_POLICY_PROVENANCE");
    }
  });

  // BUILDER_R10_POLICY_02: "  SPOT_POLICY_X  " => policy SPOT_POLICY_X
  it("BUILDER_R10_POLICY_02: entry padded policy => canonical SPOT_POLICY_X", () => {
    const trade = makeTrade();
    const r = buildDurableEntryPayload(trade, { f: 1 }, { l: 1 }, "  SPOT_POLICY_X  ");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.policyVersion).toBe("SPOT_POLICY_X");
    }
  });

  it("BUILDER_R10_POLICY_02b: giveback padded policy => canonical SPOT_POLICY_X", () => {
    const sample = makeGivebackSample("  SPOT_POLICY_X  ");
    const r = buildDurableGivebackPayload(sample);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.policyVersion).toBe("SPOT_POLICY_X");
    }
  });

  // BUILDER_R10_POLICY_03: entry/giveback identical policy canonicalization
  it("BUILDER_R10_POLICY_03: entry and giveback use same canonicalization", () => {
    const trade = makeTrade();
    const entryR = buildDurableEntryPayload(trade, { f: 1 }, { l: 1 }, "  SPOT_POLICY_X  ");
    const gbR = buildDurableGivebackPayload(makeGivebackSample("  SPOT_POLICY_X  "));
    expect(entryR.ok).toBe(true);
    expect(gbR.ok).toBe(true);
    if (entryR.ok && gbR.ok) {
      expect(entryR.row.policyVersion).toBe(gbR.row.policyVersion);
      expect(entryR.row.policyVersion).toBe("SPOT_POLICY_X");
    }
  });

  // R10-07: giveback unlabeled => MATURATION_NOT_READY
  it("BUILDER_R10_MATURATION_01: giveback unlabeled => MATURATION_NOT_READY", () => {
    const sample = makeGivebackSample("SPOT_POLICY_X", null);
    const r = buildDurableGivebackPayload(sample);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("MATURATION_NOT_READY");
    }
  });

  // R10-07: giveback labeled => hasLabel=true, labelsJson non-null
  it("BUILDER_R10_MATURATION_02: giveback labeled => hasLabel=true, labelsJson non-null", () => {
    const sample = makeGivebackSample("SPOT_POLICY_X", { future_MFE_R: 2.0 });
    const r = buildDurableGivebackPayload(sample);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.hasLabel).toBe(true);
      expect(r.row.labelsJson).toBeDefined();
      expect(r.row.labelsJson).not.toBeNull();
    }
  });

  // R10-06: No fallback — empty policy => fail closed
  it("BUILDER_R10_POLICY_04: empty policy => fail closed", () => {
    const trade = makeTrade();
    const r = buildDurableEntryPayload(trade, { f: 1 }, { l: 1 }, "");
    expect(r.ok).toBe(false);
  });

  it("BUILDER_R10_POLICY_05: whitespace-only policy => fail closed", () => {
    const trade = makeTrade();
    const r = buildDurableEntryPayload(trade, { f: 1 }, { l: 1 }, "   ");
    expect(r.ok).toBe(false);
  });
});
