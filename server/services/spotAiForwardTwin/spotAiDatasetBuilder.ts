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
  const { scanSnapshots, tradeOutcomes } = input;

  const samples: SpotAiDatasetSample[] = [];
  let labeledTradeCount = 0;

  for (const snapshot of scanSnapshots) {
    if (snapshot.snapshotType !== "SCAN") continue;

    let features: SpotAiFeatures;
    try {
      features = buildFeaturesFromSnapshot(snapshot);
    } catch {
      continue;
    }

    if (!validateNoLookahead(features, snapshot.timestamp)) continue;

    const groupId = deriveGroupId(snapshot, tradeOutcomes);
    const outcome = findOutcomeForSnapshot(snapshot, tradeOutcomes);
    const labels: SpotAiEntryLabels | null = outcome ? buildEntryLabelsFromOutcome(outcome) : null;
    const givebackLabels: SpotAiGivebackLabels | null = null;
    const challengers: ChallengerProjection[] = [];

    if (labels) labeledTradeCount++;

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
    if (outcome.entryTime <= snapshot.timestamp && outcome.exitTime >= snapshot.timestamp) {
      return lotId;
    }
  }
  return `temporal-${Math.floor(snapshot.timestamp / (60 * 60 * 1000))}`;
}

function findOutcomeForSnapshot(
  snapshot: ForwardTwinSnapshot,
  outcomes: Map<string, TradeOutcomeEntry>,
): TradeOutcomeEntry | null {
  for (const outcome of outcomes.values()) {
    if (outcome.entryTime <= snapshot.timestamp && outcome.exitTime >= snapshot.timestamp) {
      return outcome;
    }
  }
  return null;
}

function buildEntryLabelsFromOutcome(outcome: TradeOutcomeEntry): SpotAiEntryLabels {
  const r = outcome.riskUsd > 0 ? outcome.riskUsd : 1;
  const mfeR = outcome.mfeR;
  const finalR = outcome.netPnlUsd / r;
  const holdMs = outcome.exitTime - outcome.entryTime;

  return {
    reached_0_5R_before_stop: mfeR >= 0.5,
    reached_1R_before_stop: mfeR >= 1.0,
    reached_1_5R_before_stop: mfeR >= 1.5,
    reached_2R_before_stop: mfeR >= 2.0,
    final_net_profitable: outcome.netPnlUsd > 0,
    final_R: finalR,
    mfe_R: mfeR,
    mae_R: outcome.maeR,
    time_to_0_5R: mfeR >= 0.5 ? holdMs : null,
    time_to_1R: mfeR >= 1.0 ? holdMs : null,
    time_to_exit: holdMs,
  };
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

export function validateHoldsIncluded(dataset: SpotAiDataset): boolean {
  return dataset.samples.some(s => s.labels === null);
}

export function validateMinTrades(dataset: SpotAiDataset, minTrades: number): boolean {
  return dataset.labeledTradeCount >= minTrades;
}
