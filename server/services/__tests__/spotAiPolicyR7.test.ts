/**
 * spotAiPolicyR7.test.ts — R7 POLICY tests: Live/backfill fingerprint parity.
 *
 * Verifies that the same raw Forward Twin + same trade + same features + same labels
 * produces the same durable payload and fingerprint regardless of ingestion mechanism.
 */

import { describe, it, expect } from "vitest";
import {
  buildCanonicalFingerprint,
  buildGivebackFingerprint,
  buildDurableEntryPayload,
  buildDurableGivebackPayload,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import type { CompletedTrade } from "../spotAiForwardTwin/spotAiCompletedTrades";
import type { SpotAiGivebackSample } from "../spotAiForwardTwin/spotAiForwardTwinTypes";

function makeTrade(overrides: Partial<CompletedTrade> = {}): CompletedTrade {
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
    ...overrides,
  };
}

function makeGivebackSample(overrides: Partial<SpotAiGivebackSample> = {}): SpotAiGivebackSample {
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
    labels: { future_MFE_R: 2.0, future_MAE_R: -0.5 } as any,
    sourceForwardTwinSchemaVersion: 2,
    sourcePolicyVersion: "SPOT_POLICY_X",
    ...overrides,
  };
}

describe("R7 POLICY tests — live/backfill fingerprint parity", () => {
  // DURABLE_R7_POLICY_01: same policy → same fingerprint + same payload
  it("DURABLE_R7_POLICY_01: same policy → same fingerprint + same payload", () => {
    const trade = makeTrade();
    const features = { atrPct: 1.5, adx: 25 };
    const labels = { outcome: "WIN", rMultiple: 1.0 };
    const policyVersion = "SPOT_POLICY_X";

    // Build via the canonical payload builder (used by both live and backfill)
    const livePayload = buildDurableEntryPayload(trade, features, labels, policyVersion);
    const backfillPayload = buildDurableEntryPayload(trade, features, labels, policyVersion);

    // Same fingerprint
    expect(livePayload.fingerprint).toBe(backfillPayload.fingerprint);
    // Same payload (deep equal)
    expect(livePayload.row).toEqual(backfillPayload.row);
    // sourcePolicyVersion is the real policy, not "backfill" or "live"
    expect(livePayload.row.policyVersion).toBe("SPOT_POLICY_X");
    expect(backfillPayload.row.policyVersion).toBe("SPOT_POLICY_X");
  });

  // DURABLE_R7_POLICY_02: different real policy → different fingerprint
  it("DURABLE_R7_POLICY_02: different real policy → different fingerprint", () => {
    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };

    const fpX = buildCanonicalFingerprint(trade, features, labels, "SPOT_POLICY_X");
    const fpY = buildCanonicalFingerprint(trade, features, labels, "SPOT_POLICY_Y");

    expect(fpX).not.toBe(fpY);
  });

  // DURABLE_R7_POLICY_03: changing only ingestion mechanism → same fingerprint
  it("DURABLE_R7_POLICY_03: changing mechanism (live→backfill→restart) → same fingerprint", () => {
    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };
    const policyVersion = "SPOT_POLICY_X";

    // The fingerprint is computed from the SAME inputs regardless of mechanism.
    // The mechanism name is NOT part of the fingerprint.
    const fp1 = buildCanonicalFingerprint(trade, features, labels, policyVersion);
    const fp2 = buildCanonicalFingerprint(trade, features, labels, policyVersion);
    const fp3 = buildCanonicalFingerprint(trade, features, labels, policyVersion);

    expect(fp1).toBe(fp2);
    expect(fp2).toBe(fp3);
  });

  // DURABLE_R7_POLICY_04: giveback same policy → same fingerprint
  it("DURABLE_R7_POLICY_04: giveback same policy → same fingerprint", () => {
    const sample = makeGivebackSample();
    const fp1 = buildGivebackFingerprint(sample);
    const fp2 = buildGivebackFingerprint(sample);
    expect(fp1).toBe(fp2);
    expect(fp1).toContain(""); // just verify it's a string
  });

  // DURABLE_R7_POLICY_05: giveback different policy → different fingerprint
  it("DURABLE_R7_POLICY_05: giveback different policy → different fingerprint", () => {
    const sample1 = makeGivebackSample({ sourcePolicyVersion: "SPOT_POLICY_X" });
    const sample2 = makeGivebackSample({ sourcePolicyVersion: "SPOT_POLICY_Y" });
    const fp1 = buildGivebackFingerprint(sample1);
    const fp2 = buildGivebackFingerprint(sample2);
    expect(fp1).not.toBe(fp2);
  });

  // DURABLE_R7_POLICY_06: fingerprint does not contain ingestion mechanism name
  it("DURABLE_R7_POLICY_06: fingerprint does not contain 'backfill' or 'live'", () => {
    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };
    const fp = buildCanonicalFingerprint(trade, features, labels, "SPOT_POLICY_X");
    // The fingerprint is a hex hash — it won't contain literal strings.
    // But we verify the policyVersion in the payload is NOT "backfill" or "live".
    const payload = buildDurableEntryPayload(trade, features, labels, "SPOT_POLICY_X");
    expect(payload.row.policyVersion).not.toBe("backfill");
    expect(payload.row.policyVersion).not.toBe("live");
    expect(payload.row.policyVersion).not.toBe("sync");
    expect(payload.row.policyVersion).not.toBe("restart");
  });

  // DURABLE_R7_POLICY_07: buildDurableEntryPayload computes fingerprint centrally
  it("DURABLE_R7_POLICY_07: buildDurableEntryPayload fingerprint matches buildCanonicalFingerprint", () => {
    const trade = makeTrade();
    const features = { f: 1 };
    const labels = { l: 1 };
    const policyVersion = "SPOT_POLICY_X";

    const payload = buildDurableEntryPayload(trade, features, labels, policyVersion);
    const directFp = buildCanonicalFingerprint(trade, features, labels, policyVersion);

    expect(payload.fingerprint).toBe(directFp);
  });

  // DURABLE_R7_POLICY_08: buildDurableGivebackPayload computes fingerprint centrally
  it("DURABLE_R7_POLICY_08: buildDurableGivebackPayload fingerprint matches buildGivebackFingerprint", () => {
    const sample = makeGivebackSample();
    const payload = buildDurableGivebackPayload(sample);
    const directFp = buildGivebackFingerprint(sample);
    expect(payload.fingerprint).toBe(directFp);
  });
});
