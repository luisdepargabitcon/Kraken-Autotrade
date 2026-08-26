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
 * CAUSAL CORRELATION (defects E, F):
 *   - TradeOutcomeEntry MUST contain pair AND entryScanId.
 *   - deriveGroupId and findOutcomeForSnapshot match by EXPLICIT correlation:
 *     outcome.entryScanId === snapshot.scanId AND outcome.pair === snapshot.pair.
 *   - Temporal overlap (entryTime <= scan.timestamp <= exitTime) is NOT used
 *     to associate Entry Model labels. Only the scan that ORIGINATED the entry
 *     receives that outcome. Overlapping but unrelated scans get labels=null.
 *   - When entryScanId is null the trade is CORRELATION_INCOMPLETE and no scan
 *     receives its labels (defect C).
 *   - A BTC scan can NEVER receive labels from an ETH trade.
 *
 * TIME-TO-TARGETS:
 *   - time_to_0_5R and time_to_1R are computed from SUPERVISOR snapshots
 *     that first observed the position reaching +0.5R or +1.0R.
 *   - If no supervisor snapshot is available, null (NOT holdTime).
 *
 * GIVEBACK DATASET (defect G):
 *   - NOT built from SCAN. Built from SUPERVISOR snapshots via
 *     buildGivebackDataset(). Each sample = lotId + timestamp + state known
 *     up to that instant; future outcome is the LABEL only.
 *   - Entry dataset scan samples carry givebackLabels=null (giveback is a
 *     separate dataset).
 *
 * CHALLENGERS (defect H):
 *   - A challenger must NOT simulate "reached trigger => closed immediately at
 *     trigger" when there is insufficient chronological path data to decide
 *     whether the target or the stop was hit first.
 *   - When the supervisor path is insufficient, available=false with
 *     reason=INSUFFICIENT_PATH_DATA.
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
  SpotAiGivebackDataset,
  SpotAiGivebackSample,
  GivebackSampleState,
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

    // Defect G: giveback is NOT built from SCAN. The entry dataset carries
    // givebackLabels=null; giveback is a separate dataset built from
    // SUPERVISOR snapshots via buildGivebackDataset().
    const givebackLabels: SpotAiGivebackLabels | null = null;

    const challengers: ChallengerProjection[] = outcome
      ? projectChallengers(outcome, supervisorSnapshots)
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

/**
 * Derive the group id for a SCAN snapshot. The group is the lotId of the trade
 * whose entry was ORIGINATED by this scan (explicit entryScanId correlation),
 * never a temporal-overlap match. Unrelated scans fall back to a temporal
 * block group (and will have labels=null).
 */
function deriveGroupId(snapshot: ForwardTwinSnapshot, outcomes: Map<string, TradeOutcomeEntry>): string {
  for (const [lotId, outcome] of outcomes) {
    if (outcome.pair !== snapshot.pair) continue;
    if (outcome.entryScanId !== null && outcome.entryScanId === snapshot.scanId) {
      return lotId;
    }
  }
  return `temporal-${snapshot.pair}-${Math.floor(snapshot.timestamp / (60 * 60 * 1000))}`;
}

/**
 * Find the trade outcome whose entry was ORIGINATED by this scan, via explicit
 * entryScanId correlation (defects E, F). Temporal overlap is NOT used. A
 * scan that did not originate any entry receives no outcome (labels=null).
 * Outcomes with entryScanId=null are CORRELATION_INCOMPLETE and match nothing.
 */
function findOutcomeForSnapshot(
  snapshot: ForwardTwinSnapshot,
  outcomes: Map<string, TradeOutcomeEntry>,
): TradeOutcomeEntry | null {
  for (const outcome of outcomes.values()) {
    if (outcome.pair !== snapshot.pair) continue;
    if (outcome.entryScanId !== null && outcome.entryScanId === snapshot.scanId) {
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

/**
 * Compute the future-outcome giveback LABEL from a completed trade outcome.
 * This is the LABEL side only — it must never be used as a feature. Returns
 * null when the trade has no positive MFE (no giveback to study).
 */
function buildGivebackLabelFromOutcome(outcome: TradeOutcomeEntry): SpotAiGivebackLabels | null {
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

/**
 * Build the Giveback dataset from SUPERVISOR snapshots (defect G).
 *
 * Each sample is a SUPERVISOR snapshot for a lotId:
 *   - state  = state known up to that instant (FEATURE side)
 *   - labels = future outcome (LABEL only), null if the trade is not closed
 *
 * The dataset is grouped by lotId and temporally split (60/20/20).
 */
export function buildGivebackDataset(input: DatasetBuildInput): SpotAiGivebackDataset {
  const { supervisorSnapshots, tradeOutcomes } = input;

  const samples: SpotAiGivebackSample[] = [];
  const labeledLotIds = new Set<string>();

  for (const snap of supervisorSnapshots) {
    if (snap.snapshotType !== "SUPERVISOR") continue;
    const position = snap.position;
    if (!position) continue;

    const outcome = tradeOutcomes.get(position.lotId) ?? null;
    // Only supervisor snapshots whose lotId has a completed outcome carry a
    // future label. Open positions (no outcome) are included with labels=null
    // so the dataset reflects the real supervisor population, but they do not
    // count as labeled trades.
    const labels = outcome ? buildGivebackLabelFromOutcome(outcome) : null;

    const minutesInTrade = position.openedAt > 0
      ? Math.max(0, Math.round((snap.timestamp - position.openedAt) / 60_000))
      : 0;

    const state: GivebackSampleState = {
      lotId: position.lotId,
      pair: position.pair,
      timestamp: snap.timestamp,
      entryPrice: position.entryPrice,
      mfeR: position.mfeR,
      maeR: position.maeR,
      mfeUsd: position.mfe,
      maeUsd: position.mae,
      minutesInTrade,
      breakEvenActivated: position.sgBreakEvenActivated,
      trailingActivated: position.sgTrailingActivated,
      currentStopPrice: position.sgCurrentStopPrice,
      highestPrice: position.highestPrice,
      lowestPrice: position.lowestPrice,
    };

    if (labels && outcome && !labeledLotIds.has(outcome.lotId)) {
      labeledLotIds.add(outcome.lotId);
    }

    samples.push({
      sampleId: `gb-${position.lotId}-${snap.timestamp}`,
      split: "train",
      groupId: position.lotId,
      state,
      labels,
    });
  }

  samples.sort((a, b) => a.state.timestamp - b.state.timestamp);
  assignGivebackTemporalSplits(samples);

  return {
    featureSchemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION,
    samples,
    trainCount: samples.filter(s => s.split === "train").length,
    validationCount: samples.filter(s => s.split === "validation").length,
    testCount: samples.filter(s => s.split === "test").length,
    labeledTradeCount: labeledLotIds.size,
    totalSupervisorSnapshots: supervisorSnapshots.length,
    groupSplitByTrade: true,
    temporalSplit: true,
  };
}

function assignGivebackTemporalSplits(samples: SpotAiGivebackSample[]): void {
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

/**
 * Project challenger exit policies observationally (defect H).
 *
 * A challenger must NOT simulate "reached trigger => closed immediately at
 * trigger" when there is insufficient chronological SUPERVISOR path data to
 * determine whether the target or the stop was hit first. When the path is
 * insufficient, the challenger is reported with available=false and
 * reason=INSUFFICIENT_PATH_DATA. BASELINE is always available (actual exit).
 */
function projectChallengers(
  outcome: TradeOutcomeEntry,
  supervisorSnapshots: ForwardTwinSnapshot[],
): ChallengerProjection[] {
  const r = outcome.riskUsd > 0 ? outcome.riskUsd : 1;
  const entryPrice = outcome.entryPrice;
  const stopPrice = outcome.stopPrice;
  const direction = entryPrice > stopPrice ? 1 : -1;
  const riskDist = Math.abs(entryPrice - stopPrice);

  const baseline: ChallengerProjection = {
    policy: "BASELINE",
    projectedExitPrice: outcome.exitPrice,
    projectedR: outcome.netPnlUsd / r,
    projectedPnlUsd: outcome.netPnlUsd,
    available: true,
    reason: null,
  };

  if (riskDist <= 0) {
    return [
      baseline,
      { policy: "B_RET_0_75_0_30", projectedExitPrice: 0, projectedR: 0, projectedPnlUsd: 0, available: false, reason: "INVALID_RISK_DISTANCE" },
      { policy: "A_FLOOR_1_00_1_00", projectedExitPrice: 0, projectedR: 0, projectedPnlUsd: 0, available: false, reason: "INVALID_RISK_DISTANCE" },
    ];
  }

  // Chronological supervisor path for this lot/pair — used to determine the
  // ORDER in which target/stop events occurred (defect H).
  const path = supervisorSnapshots
    .filter(s => s.snapshotType === "SUPERVISOR" && s.position?.lotId === outcome.lotId && s.position?.pair === outcome.pair)
    .sort((a, b) => a.timestamp - b.timestamp);

  const project = (
    policy: ChallengerPolicy,
    targetR: number,
    stopR: number,
  ): ChallengerProjection => {
    const targetPrice = entryPrice + direction * riskDist * targetR;
    const stopExitPrice = entryPrice - direction * riskDist * stopR;

    // Insufficient path data → cannot determine target-vs-stop ordering.
    if (path.length === 0) {
      return {
        policy,
        projectedExitPrice: 0,
        projectedR: 0,
        projectedPnlUsd: 0,
        available: false,
        reason: "INSUFFICIENT_PATH_DATA",
      };
    }

    // First supervisor snapshot where the running MFE reached the target,
    // and first where the running MAE reached the stop.
    let firstTargetTs: number | null = null;
    let firstStopTs: number | null = null;
    for (const s of path) {
      const mfeR = s.position?.mfeR ?? 0;
      const maeR = s.position?.maeR ?? 0;
      if (firstTargetTs === null && mfeR >= targetR) firstTargetTs = s.timestamp;
      if (firstStopTs === null && maeR <= -stopR) firstStopTs = s.timestamp;
      if (firstTargetTs !== null && firstStopTs !== null) break;
    }

    let projectedExitPrice: number;
    let projectedR: number;

    if (firstTargetTs !== null && (firstStopTs === null || firstTargetTs <= firstStopTs)) {
      // Target hit first (or stop never hit) → challenger exits at target.
      projectedExitPrice = targetPrice;
      projectedR = targetR;
    } else if (firstStopTs !== null && (firstTargetTs === null || firstStopTs < firstTargetTs)) {
      // Stop hit first → challenger exits at stop.
      projectedExitPrice = stopExitPrice;
      projectedR = -stopR;
    } else {
      // Neither event observed in the supervisor path → cannot simulate the
      // challenger policy reliably. Do NOT assume "reached trigger => closed
      // immediately at trigger" from aggregate MFE/MAE alone.
      return {
        policy,
        projectedExitPrice: 0,
        projectedR: 0,
        projectedPnlUsd: 0,
        available: false,
        reason: "INSUFFICIENT_PATH_DATA",
      };
    }

    const projectedPnlUsd = (projectedExitPrice - entryPrice) * direction * (r / riskDist);
    return {
      policy,
      projectedExitPrice,
      projectedR,
      projectedPnlUsd,
      available: true,
      reason: null,
    };
  };

  return [
    baseline,
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
