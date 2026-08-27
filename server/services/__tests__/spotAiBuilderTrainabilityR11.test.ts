/**
 * spotAiBuilderTrainabilityR11.test.ts — R11-01/R11-02 builder fail-closed on trainability.
 *
 * R11-01: DurableTradeRow.isTrainable is literal `true`.
 * R11-02: Entry builder FAIL CLOSED on empty features or labels.
 *         No row with isTrainable=false can be produced.
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

function makeGivebackSample(labels: any = { future_MFE_R: 2.0 }): SpotAiGivebackSample {
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
    sourcePolicyVersion: "SPOT_POLICY_X",
  };
}

describe("R11-01/R11-02 BUILDER TRAINABILITY FAIL CLOSED", () => {
  // BUILDER_R11_TRAIN_01: features={} => ok=false NOT_TRAINABLE
  it("BUILDER_R11_TRAIN_01: features={} => ok=false NOT_TRAINABLE", () => {
    const trade = makeTrade();
    const r = buildDurableEntryPayload(trade, {}, { l: 1 }, "SPOT_POLICY_X");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("NOT_TRAINABLE");
    }
  });

  // BUILDER_R11_TRAIN_02: labels={} => ok=false NOT_TRAINABLE
  it("BUILDER_R11_TRAIN_02: labels={} => ok=false NOT_TRAINABLE", () => {
    const trade = makeTrade();
    const r = buildDurableEntryPayload(trade, { f: 1 }, {}, "SPOT_POLICY_X");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("NOT_TRAINABLE");
    }
  });

  // BUILDER_R11_TRAIN_03: features+labels valid => ok=true, isTrainable === true
  it("BUILDER_R11_TRAIN_03: features+labels valid => ok=true, isTrainable === true (literal)", () => {
    const trade = makeTrade();
    const r = buildDurableEntryPayload(trade, { f: 1 }, { l: 1 }, "SPOT_POLICY_X");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.isTrainable).toBe(true);
      // Compile-time assertion: literal `true` type
      const _: true = r.row.isTrainable;
      expect(_).toBe(true);
    }
  });

  // BUILDER_R11_TRAIN_04: both empty => NOT_TRAINABLE
  it("BUILDER_R11_TRAIN_04: both features and labels empty => NOT_TRAINABLE", () => {
    const trade = makeTrade();
    const r = buildDurableEntryPayload(trade, {}, {}, "SPOT_POLICY_X");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("NOT_TRAINABLE");
    }
  });

  // R11-12: Giveback unlabeled => MATURATION_NOT_READY
  it("BUILDER_R11_GB_01: giveback unlabeled => MATURATION_NOT_READY", () => {
    const sample = makeGivebackSample(null);
    const r = buildDurableGivebackPayload(sample);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("MATURATION_NOT_READY");
    }
  });

  // R11-12: Giveback labeled => hasLabel literal true, labelsJson non-null
  it("BUILDER_R11_GB_02: giveback labeled => hasLabel=true, labelsJson non-null", () => {
    const sample = makeGivebackSample({ future_MFE_R: 2.0 });
    const r = buildDurableGivebackPayload(sample);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.hasLabel).toBe(true);
      // Compile-time assertion: literal `true` type
      const _: true = r.row.hasLabel;
      expect(_).toBe(true);
      expect(r.row.labelsJson).toBeDefined();
      expect(r.row.labelsJson).not.toBeNull();
    }
  });
});
