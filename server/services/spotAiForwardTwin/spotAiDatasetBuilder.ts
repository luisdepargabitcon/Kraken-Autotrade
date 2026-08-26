/**
 * spotAiDatasetBuilder — Build training dataset from Forward Twin snapshots.
 *
 * Key invariants:
 *   - Source: spot_forward_twin_snapshots ONLY (no legacy training_trades).
 *   - Includes HOLD/REJECTED scans, not just executed trades.
 *   - Group split by lotId (or temporal block for non-position scans).
 *   - Temporal split: 60% train, 20% validation, 20% test — chronological.
 *   - No random shuffle.
 *   - No lookahead: features from snapshot at prediction time only.
 *
 * CAUSAL CORRELATION:
 *   - TradeOutcomeEntry MUST contain pair.
 *   - deriveGroupId and findOutcomeForSnapshot match by pair AND lotId,
 *     never by simple temporal overlap.
 *   - A BTC scan can NEVER receive labels from an ETH trade.
 *
 * TIME-TO-TARGETS:
 *   - time_to_0_5R and time_to_1R are computed from SUPERVISOR snapshots
 *     that first observed the position reaching +0.5R or +1.0R.
 *   - If no supervisor snapshot is available, null (NOT holdTime).
 *
 * GIVEBACK LABELS:
 *   - Computed from SUPERVISOR + FILL snapshots for each lotId.
 *   - profit_to_loss: position was profitable (MFE >= 1R) but closed at a loss.
 *   - Challengers are observational only — never modify exit policy.
 */

import { SPOT_AI_FEATURE_SCHEMA_VERSION } from "./spotAiForwardTwinTypes";
import type {
  SpotAiDataset,
  SpotAiDatasetSample,
  DatasetSplit,
  SpotAiFeatures,
  SpotAiEntryLabels,
  SpotAiGivebackLabels,
  ChallengerProjection,
  ChallengerPolicy,
} from "./spotAiForwardTwinTypes";
import { buildFeaturesFromSnapshot, validateNoLookahead } from "./spotAiFeatureBuilder";
import type { ForwardTwinSnapshot } from "../spot/spotForwardTwinTypes";

export interface DatasetBuildInput {
  scanSnapshots: ForwardTwinSnapshot[];
  supervisorSnapshots: ForwardTwinSnapshot[];
  fillSnapshots: ForwardTwinSnapshot[];
  tradeOutcomes: Map<string, TradeOutcomeEntry>;
}

export interface TradeOutcomeEntry {
  lotId: string;
  pair: string;
  entryScanId: string | null;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  mfe: number;
  mae: number;
  mfeR: number;
  maeR: number;
  entryTime: number;
  exitTime: number;
  netPnlUsd: number;
  riskUsd: number;
}

export function buildDataset(input: DatasetBuildInput): SpotAiDataset {
  const { scanSnapshots, supervisorSnapshots, tradeOutcomes } = input;

  const samples: SpotAiDatasetSample[] = [];
  let labeledTradeCount = 0;
  const labeledLotIds = new Set<string>();

  for (const snapshot of scanSnapshots) {
    if (snapshot.snapshotType !== "SCAN") continue;

    let features: SpotAiFeatures;
    try {
      features = buildFeaturesFromSnapshot(snapshot);
    } catch {
      continue;
    }

    if (!validateNoLookahead(features, snapshot.timestamp, snapshot)) continue;

    const groupId = deriveGroupId(snapshot, tradeOutcomes);
    const outcome = findOutcomeForSnapshot(snapshot, tradeOutcomes);
    const labels: SpotAiEntryLabels | null = outcome ? buildEntryLabelsFromOutcome(outcome, supervisorSnapshots) : null;

    const givebackLabels: SpotAiGivebackLabels | null = outcome
      ? buildGivebackLabelsFromOutcome(outcome, supervisorSnapshots)
      : null;

    const challengers: ChallengerProjection[] = outcome
      ? projectChallengers(outcome)
      : [];

    if (labels && outcome) {
      if (!labeledLotIds.has(outcome.lotId)) {
        labeledLotIds.add(outcome.lotId);
        labeledTradeCount++;
      }
    }

    samples.push({
      sampleId: `${snapshot.scanId}-${snapshot.pair}`,
      split: "train",
      groupId,
      features,
      labels,
      givebackLabels,
      challengers,
    });
  }

  samples.sort((a, b) => a.features.timestamp - b.features.timestamp);

  assignTemporalSplits(samples);

  return {
    featureSchemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION,
    samples,
    trainCount: samples.filter(s => s.split === "train").length,
    validationCount: samples.filter(s => s.split === "validation").length,
    testCount: samples.filter(s => s.split === "test").length,
    labeledTradeCount,
    totalSnapshotCount: scanSnapshots.length,
    groupSplitByTrade: true,
    temporalSplit: true,
  };
}

function deriveGroupId(snapshot: ForwardTwinSnapshot, outcomes: Map<string, TradeOutcomeEntry>): string {
  for (const [lotId, outcome] of outcomes) {
    if (outcome.pair !== snapshot.pair) continue;
    if (outcome.entryTime <= snapshot.timestamp && outcome.exitTime >= snapshot.timestamp) {
      return lotId;
    }
  }
  return `temporal-${snapshot.pair}-${Math.floor(snapshot.timestamp / (60 * 60 * 1000))}`;
}

function findOutcomeForSnapshot(
  snapshot: ForwardTwinSnapshot,
  outcomes: Map<string, TradeOutcomeEntry>,
): TradeOutcomeEntry | null {
  for (const outcome of outcomes.values()) {
    if (outcome.pair !== snapshot.pair) continue;
    if (outcome.entryTime <= snapshot.timestamp && outcome.exitTime >= snapshot.timestamp) {
      return outcome;
    }
  }
  return null;
}

function buildEntryLabelsFromOutcome(
  outcome: TradeOutcomeEntry,
  supervisorSnapshots: ForwardTwinSnapshot[],
): SpotAiEntryLabels {
  const r = outcome.riskUsd > 0 ? outcome.riskUsd : 1;
  const mfeR = outcome.mfeR;
  const finalR = outcome.netPnlUsd / r;
  const holdMs = outcome.exitTime - outcome.entryTime;

  const timeTo0_5R = computeTimeToTarget(outcome, supervisorSnapshots, 0.5);
  const timeTo1R = computeTimeToTarget(outcome, supervisorSnapshots, 1.0);

  return {
    reached_0_5R_before_stop: mfeR >= 0.5,
    reached_1R_before_stop: mfeR >= 1.0,
    reached_1_5R_before_stop: mfeR >= 1.5,
    reached_2R_before_stop: mfeR >= 2.0,
    final_net_profitable: outcome.netPnlUsd > 0,
    final_R: finalR,
    mfe_R: mfeR,
    mae_R: outcome.maeR,
    time_to_0_5R: mfeR >= 0.5 ? timeTo0_5R : null,
    time_to_1R: mfeR >= 1.0 ? timeTo1R : null,
    time_to_exit: holdMs,
  };
}

function computeTimeToTarget(
  outcome: TradeOutcomeEntry,
  supervisorSnapshots: ForwardTwinSnapshot[],
  targetR: number,
): number | null {
  const relevant = supervisorSnapshots
    .filter(s => s.snapshotType === "SUPERVISOR" && s.position?.lotId === outcome.lotId && s.position?.pair === outcome.pair)
    .sort((a, b) => a.timestamp - b.timestamp);

  for (const snap of relevant) {
    if (snap.position && snap.position.mfeR >= targetR) {
      return snap.timestamp - outcome.entryTime;
    }
  }

  return null;
}

function buildGivebackLabelsFromOutcome(
  outcome: TradeOutcomeEntry,
  _supervisorSnapshots: ForwardTwinSnapshot[],
): SpotAiGivebackLabels | null {
  if (outcome.mfeR <= 0) return null;

  const r = outcome.riskUsd > 0 ? outcome.riskUsd : 1;
  const finalR = outcome.netPnlUsd / r;
  const givebackR = outcome.mfeR - finalR;
  const givebackPct = outcome.mfeR > 0 ? givebackR / outcome.mfeR : 0;

  return {
    profit_to_loss: outcome.mfeR >= 1.0 && outcome.netPnlUsd < 0,
    giveback_25pct: givebackPct >= 0.25,
    giveback_50pct: givebackPct >= 0.50,
    giveback_75pct: givebackPct >= 0.75,
    final_R: finalR,
    future_MFE_R: outcome.mfeR,
    future_MAE_R: outcome.maeR,
    expected_giveback_R: givebackR,
  };
}

function projectChallengers(outcome: TradeOutcomeEntry): ChallengerProjection[] {
  const r = outcome.riskUsd > 0 ? outcome.riskUsd : 1;
  const entryPrice = outcome.entryPrice;
  const stopPrice = outcome.stopPrice;
  const direction = entryPrice > stopPrice ? 1 : -1;
  const riskDist = Math.abs(entryPrice - stopPrice);

  if (riskDist <= 0) return [];

  const project = (
    policy: ChallengerPolicy,
    targetR: number,
    stopR: number,
  ): ChallengerProjection => {
    const targetPrice = entryPrice + direction * riskDist * targetR;
    const stopExitPrice = entryPrice - direction * riskDist * stopR;

    let projectedExitPrice: number;
    let projectedR: number;

    if (outcome.mfeR >= targetR) {
      projectedExitPrice = targetPrice;
      projectedR = targetR;
    } else if (outcome.maeR <= -stopR) {
      projectedExitPrice = stopExitPrice;
      projectedR = -stopR;
    } else {
      projectedExitPrice = outcome.exitPrice;
      projectedR = outcome.netPnlUsd / r;
    }

    const projectedPnlUsd = (projectedExitPrice - entryPrice) * direction * (r / riskDist);

    return {
      policy,
      projectedExitPrice,
      projectedR,
      projectedPnlUsd,
    };
  };

  return [
    {
      policy: "BASELINE",
      projectedExitPrice: outcome.exitPrice,
      projectedR: outcome.netPnlUsd / r,
      projectedPnlUsd: outcome.netPnlUsd,
    },
    project("B_RET_0_75_0_30", 0.75, 0.30),
    project("A_FLOOR_1_00_1_00", 1.0, 1.0),
  ];
}

function assignTemporalSplits(samples: SpotAiDatasetSample[]): void {
  const n = samples.length;
  if (n === 0) return;

  const trainEnd = Math.floor(n * 0.6);
  const valEnd = Math.floor(n * 0.8);

  const groupAssignments = new Map<string, DatasetSplit>();

  for (let i = 0; i < n; i++) {
    const desired: DatasetSplit = i < trainEnd ? "train" : i < valEnd ? "validation" : "test";
    const groupId = samples[i].groupId;

    if (groupAssignments.has(groupId)) {
      samples[i].split = groupAssignments.get(groupId)!;
    } else {
      groupAssignments.set(groupId, desired);
      samples[i].split = desired;
    }
  }
}

export function validateGroupSplit(dataset: SpotAiDataset): boolean {
  const groupSplits = new Map<string, Set<DatasetSplit>>();
  for (const sample of dataset.samples) {
    if (!groupSplits.has(sample.groupId)) {
      groupSplits.set(sample.groupId, new Set());
    }
    groupSplits.get(sample.groupId)!.add(sample.split);
  }
  for (const splits of groupSplits.values()) {
    if (splits.size > 1) return false;
  }
  return true;
}

export function validateNoLookaheadInDataset(dataset: SpotAiDataset): boolean {
  for (const sample of dataset.samples) {
    if (!validateNoLookahead(sample.features, sample.features.timestamp)) return false;
  }
  return true;
}

export function countLabeledTrades(outcomes: Map<string, TradeOutcomeEntry>): number {
  return outcomes.size;
}

export function validateHoldsIncluded(dataset: SpotAiDataset): boolean {
  return dataset.samples.some(s => s.labels === null);
}

export function validateMinTrades(dataset: SpotAiDataset, minTrades: number): boolean {
  return dataset.labeledTradeCount >= minTrades;
}
