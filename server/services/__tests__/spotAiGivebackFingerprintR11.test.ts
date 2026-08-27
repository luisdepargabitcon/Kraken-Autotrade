/**
 * spotAiGivebackFingerprintR11.test.ts — R11-03 eliminate raw-policy fallback.
 *
 * R11-03: buildGivebackFingerprint must NOT fall back to raw policy.
 * - BACKFILL => fail-closed fingerprint (never matches valid)
 * - "  SPOT_POLICY_X  " and "SPOT_POLICY_X" => same fingerprint
 * - No production code contains `canonicalizePolicyProvenance(...) ?? original`
 */

import { describe, it, expect } from "vitest";
import {
  buildGivebackFingerprint,
  buildDurableGivebackPayload,
} from "../spotAiForwardTwin/spotAiDurableTrainingStore";
import type { SpotAiGivebackSample } from "../spotAiForwardTwin/spotAiForwardTwinTypes";
import fs from "fs";
import path from "path";

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

describe("R11-03 GIVEBACK FINGERPRINT NO RAW-POLICY FALLBACK", () => {
  // FINGERPRINT_R11_01: BACKFILL => no valid fingerprint (builder fails closed)
  it("FINGERPRINT_R11_01: BACKFILL policy => builder fails closed, no valid row", () => {
    const sample = makeGivebackSample("BACKFILL");
    const r = buildDurableGivebackPayload(sample);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("INVALID_POLICY_PROVENANCE");
    }
  });

  // FINGERPRINT_R11_02: padded and trimmed => same fingerprint
  it("FINGERPRINT_R11_02: '  SPOT_POLICY_X  ' and 'SPOT_POLICY_X' => same fingerprint", () => {
    const samplePadded = makeGivebackSample("  SPOT_POLICY_X  ");
    const sampleTrimmed = makeGivebackSample("SPOT_POLICY_X");
    // Build via canonical builder (which canonicalizes internally)
    const rPadded = buildDurableGivebackPayload(samplePadded);
    const rTrimmed = buildDurableGivebackPayload(sampleTrimmed);
    expect(rPadded.ok).toBe(true);
    expect(rTrimmed.ok).toBe(true);
    if (rPadded.ok && rTrimmed.ok) {
      expect(rPadded.fingerprint).toBe(rTrimmed.fingerprint);
    }
    // Also test buildGivebackFingerprint directly with canonical policy
    const fp1 = buildGivebackFingerprint(samplePadded, undefined, "SPOT_POLICY_X");
    const fp2 = buildGivebackFingerprint(sampleTrimmed, undefined, "SPOT_POLICY_X");
    expect(fp1).toBe(fp2);
  });

  // FINGERPRINT_R11_03: no production code contains raw-policy fallback
  it("FINGERPRINT_R11_03: no production code contains canonicalizePolicyProvenance(...) ?? original", () => {
    const storePath = path.resolve(__dirname, "../spotAiForwardTwin/spotAiDurableTrainingStore.ts");
    const source = fs.readFileSync(storePath, "utf-8");
    // Check that the old fallback pattern is NOT present for durable provenance
    // The old pattern was: canonicalizePolicyProvenance(...) ?? sample.sourcePolicyVersion
    const hasFallback = source.includes("?? sample.sourcePolicyVersion");
    expect(hasFallback).toBe(false);
  });

  // FINGERPRINT_R11_04: invalid policy via buildGivebackFingerprint => fail-closed fingerprint
  it("FINGERPRINT_R11_04: invalid policy => fail-closed fingerprint (never matches valid)", () => {
    const sampleInvalid = makeGivebackSample("BACKFILL");
    const sampleValid = makeGivebackSample("SPOT_POLICY_X");
    // Without canonical policy param, buildGivebackFingerprint canonicalizes internally
    const fpInvalid = buildGivebackFingerprint(sampleInvalid);
    const fpValid = buildGivebackFingerprint(sampleValid);
    // The invalid fingerprint must NOT match the valid one
    expect(fpInvalid).not.toBe(fpValid);
  });
});
