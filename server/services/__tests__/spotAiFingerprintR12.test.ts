/**
 * spotAiFingerprintR12.test.ts — R12-01 giveback fingerprint fail-closed
 * with branded CanonicalPolicyVersion type.
 *
 * R12-01: buildGivebackFingerprint REQUIRES a CanonicalPolicyVersion (branded type).
 * canonicalizePolicyProvenance returns CanonicalPolicyVersion | null.
 * buildDurableGivebackPayload fail-closes on invalid policy (INVALID_POLICY_PROVENANCE).
 * No sentinel hash, no raw-policy fallback.
 */

import { describe, it, expect } from "vitest";
import {
  canonicalizePolicyProvenance,
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
      lotId: "lot-1",
      pair: "BTC/USD",
      timestamp: 1000,
      currentR: 1.5,
    } as any,
    labels: { future_MFE_R: 2.0 } as any,
    sourceForwardTwinSchemaVersion: 2,
    sourcePolicyVersion: policy,
  };
}

describe("R12-01 GIVEBACK FINGERPRINT FAIL-CLOSED WITH BRANDED CanonicalPolicyVersion", () => {
  // FINGERPRINT_R12_01: BACKFILL policy => canonicalize returns null => builder fails closed
  it("FINGERPRINT_R12_01: BACKFILL policy => canonicalize null => buildDurableGivebackPayload returns INVALID_POLICY_PROVENANCE, no fingerprint", () => {
    const sample = makeGivebackSample("BACKFILL");

    // canonicalizePolicyProvenance returns null for synthetic "BACKFILL"
    const canonical = canonicalizePolicyProvenance("BACKFILL");
    expect(canonical).toBeNull();

    // buildDurableGivebackPayload fail-closes
    const result = buildDurableGivebackPayload(sample);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("INVALID_POLICY_PROVENANCE");
    }

    // NO fingerprint string is produced — the result is a discriminated union
    // where the false branch has only `ok` and `reason`, no `fingerprint`.
    if (!result.ok) {
      expect((result as any).fingerprint).toBeUndefined();
    }
  });

  // FINGERPRINT_R12_02: padded and trimmed => same CanonicalPolicyVersion => same fingerprint
  it("FINGERPRINT_R12_02: '  SPOT_POLICY_X  ' and 'SPOT_POLICY_X' => same CanonicalPolicyVersion => same fingerprint", () => {
    const samplePadded = makeGivebackSample("  SPOT_POLICY_X  ");
    const sampleTrimmed = makeGivebackSample("SPOT_POLICY_X");

    // Both canonicalize to the same branded CanonicalPolicyVersion
    const canonicalPadded = canonicalizePolicyProvenance("  SPOT_POLICY_X  ");
    const canonicalTrimmed = canonicalizePolicyProvenance("SPOT_POLICY_X");
    expect(canonicalPadded).not.toBeNull();
    expect(canonicalTrimmed).not.toBeNull();
    expect(canonicalPadded).toBe(canonicalTrimmed);

    // Same fingerprint via buildGivebackFingerprint with the canonical policy
    const fpPadded = buildGivebackFingerprint(samplePadded, 1, canonicalPadded!);
    const fpTrimmed = buildGivebackFingerprint(sampleTrimmed, 1, canonicalTrimmed!);
    expect(fpPadded).toBe(fpTrimmed);

    // Also verify via buildDurableGivebackPayload (which canonicalizes internally)
    const rPadded = buildDurableGivebackPayload(samplePadded);
    const rTrimmed = buildDurableGivebackPayload(sampleTrimmed);
    expect(rPadded.ok).toBe(true);
    expect(rTrimmed.ok).toBe(true);
    if (rPadded.ok && rTrimmed.ok) {
      expect(rPadded.fingerprint).toBe(rTrimmed.fingerprint);
    }
  });

  // FINGERPRINT_R12_03: Verify at runtime that buildGivebackFingerprint requires branded type
  it("FINGERPRINT_R12_03: source code requires CanonicalPolicyVersion branded type and canonicalizePolicyProvenance returns CanonicalPolicyVersion | null", () => {
    const storePath = path.resolve(__dirname, "../spotAiForwardTwin/spotAiDurableTrainingStore.ts");
    const source = fs.readFileSync(storePath, "utf-8");

    // Verify buildGivebackFingerprint signature requires CanonicalPolicyVersion (not string)
    // The function signature should contain "canonicalPolicyVersion: CanonicalPolicyVersion"
    expect(source).toContain("canonicalPolicyVersion: CanonicalPolicyVersion");

    // Verify the branded type declaration exists
    expect(source).toContain("__canonicalPolicyVersionBrand");
    expect(source).toContain("export type CanonicalPolicyVersion = string & { readonly [__canonicalPolicyVersionBrand]: true }");

    // Verify canonicalizePolicyProvenance returns CanonicalPolicyVersion | null (not string | null)
    // The function signature should be: canonicalizePolicyProvenance(policy: string): CanonicalPolicyVersion | null
    const sigMatch = source.match(/export function canonicalizePolicyProvenance\([^)]*\):\s*([^\n{]+)/);
    expect(sigMatch).not.toBeNull();
    const returnType = sigMatch![1].trim();
    expect(returnType).toContain("CanonicalPolicyVersion");
    expect(returnType).toContain("null");
    // It should NOT be "string | null" — it must be the branded type
    expect(returnType).not.toMatch(/^string\s*\|\s*null$/);

    // Verify that buildGivebackFingerprint does NOT have a default value for canonicalPolicyVersion
    // (no "= something" after the parameter). Extract the function signature block
    // and check the parameter has no default.
    const fpSigStart = source.indexOf("export function buildGivebackFingerprint(");
    expect(fpSigStart).toBeGreaterThan(-1);
    const fpSigEnd = source.indexOf("): string", fpSigStart);
    expect(fpSigEnd).toBeGreaterThan(-1);
    const fpSigBlock = source.substring(fpSigStart, fpSigEnd);
    // The parameter line should be "canonicalPolicyVersion: CanonicalPolicyVersion"
    // with NO "= <default>" suffix
    const paramLine = fpSigBlock.match(/canonicalPolicyVersion:\s*CanonicalPolicyVersion\s*(\=[^,\n]*)?/);
    expect(paramLine).not.toBeNull();
    // The optional default-value capture group should be undefined or empty
    expect(paramLine![1]).toBeUndefined();
  });

  // FINGERPRINT_R12_04: Source code does NOT contain sentinel or fallback patterns
  it("FINGERPRINT_R12_04: no __INVALID_POLICY_FAIL_CLOSED__ sentinel and no ?? sample.sourcePolicyVersion fallback", () => {
    const storePath = path.resolve(__dirname, "../spotAiForwardTwin/spotAiDurableTrainingStore.ts");
    const source = fs.readFileSync(storePath, "utf-8");

    // The sentinel hash constant must NOT appear
    expect(source).not.toContain("__INVALID_POLICY_FAIL_CLOSED__");

    // No raw-policy fallback pattern: "?? sample.sourcePolicyVersion"
    expect(source).not.toContain("?? sample.sourcePolicyVersion");
  });
});
