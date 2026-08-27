/**
 * spotAiPolicyProvenanceR9.test.ts — R9-08 case-insensitive policy provenance.
 *
 * R9-08: isValidPolicyProvenance must be case-insensitive.
 * canonicalizePolicyProvenance trims whitespace and returns canonical string.
 * ENTRY and GIVEBACK use the same function.
 */

import { describe, it, expect } from "vitest";
import {
  canonicalizePolicyProvenance,
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

function makeGivebackSample(policy: string): SpotAiGivebackSample {
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
    labels: { future_MFE_R: 2.0 } as any,
    sourceForwardTwinSchemaVersion: 2,
    sourcePolicyVersion: policy,
  };
}

describe("R9-08 POLICY PROVENANCE CASE-INSENSITIVE", () => {
  // POLICY_R9_01: all synthetic variants rejected
  it("POLICY_R9_01: all synthetic variants (case-insensitive) => reject", () => {
    const syntheticVariants = [
      "backfill", "BACKFILL", "BackFill", "BaCkFiLl",
      "live", "LIVE", "Live",
      "sync", "SYNC", "Sync",
      "restart", "RESTART", "Restart",
    ];
    for (const v of syntheticVariants) {
      expect(canonicalizePolicyProvenance(v)).toBeNull();
    }
  });

  // POLICY_R9_02: "  SPOT_POLICY_X  " → persist "SPOT_POLICY_X", same fingerprint
  it("POLICY_R9_02: outer whitespace canonicalized, fingerprint identical", () => {
    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };

    const { row: rowTrimmed, fingerprint: fpTrimmed } = buildDurableEntryPayload(
      trade, features, labels, "SPOT_POLICY_X",
    );
    const { row: rowPadded, fingerprint: fpPadded } = buildDurableEntryPayload(
      trade, features, labels, "  SPOT_POLICY_X  ",
    );

    expect(rowPadded.policyVersion).toBe("SPOT_POLICY_X");
    expect(fpPadded).toBe(fpTrimmed);
  });

  // POLICY_R9_03: giveback same rule
  it("POLICY_R9_03: giveback same canonicalization rule", () => {
    const sampleTrimmed = makeGivebackSample("SPOT_POLICY_X");
    const samplePadded = makeGivebackSample("  SPOT_POLICY_X  ");

    const { row: rowTrimmed, fingerprint: fpTrimmed } = buildDurableGivebackPayload(sampleTrimmed);
    const { row: rowPadded, fingerprint: fpPadded } = buildDurableGivebackPayload(samplePadded);

    expect(rowPadded.policyVersion).toBe("SPOT_POLICY_X");
    expect(fpPadded).toBe(fpTrimmed);
  });

  // Empty/whitespace-only rejected
  it("POLICY_R9_04: empty and whitespace-only rejected", () => {
    expect(canonicalizePolicyProvenance("")).toBeNull();
    expect(canonicalizePolicyProvenance("   ")).toBeNull();
    expect(canonicalizePolicyProvenance("\t\n")).toBeNull();
  });

  // Non-string rejected
  it("POLICY_R9_05: non-string rejected", () => {
    expect(canonicalizePolicyProvenance(null as any)).toBeNull();
    expect(canonicalizePolicyProvenance(undefined as any)).toBeNull();
    expect(canonicalizePolicyProvenance(123 as any)).toBeNull();
  });
});
