/**
 * spotAiDatasetBuilder — Build training dataset from Forward Twin snapshots.
 *
 * R3 SINGLE SOURCE: TradeOutcomeEntry comes from spotAiCompletedTrades.
 * Labels come from spotAiLabelBuilder (single canonical implementation).
 *
 * Key invariants:
 *   - Source: spot_forward_twin_snapshots ONLY (no legacy training_trades).
 *   - Includes HOLD/REJECTED scans, not just executed trades.
 *   - Group split by lotId (or temporal block for non-position scans).
 *   - Temporal split: 60% train, 20% validation, 20% test — chronological.
 *   - No random shuffle.
 *   - No lookahead: features from snapshot at prediction time only.
 *
 * CAUSAL CORRELATION (R3):
 *   - deriveGroupId and findOutcomeForSnapshot match by EXPLICIT correlation:
 *     outcome.entryScanId === snapshot.scanId AND outcome.pair === snapshot.pair.
 *   - Temporal overlap is NOT used. Only the scan that ORIGINATED the entry
 *     receives that outcome. Overlapping but unrelated scans get labels=null.
 *   - A BTC scan can NEVER receive labels from an ETH trade.
 *
 * GIVEBACK DATASET (R3):
 *   - Built from SUPERVISOR snapshots via buildGivebackDataset().
 *   - Each sample = lotId + timestamp T + state known up to T (FEATURE side).
 *   - labels = future outcome computed from supervisor path with timestamp > T
 *     (strictly after T). Aggregate outcome MFE/MAE is NOT used directly
 *     because it may include excursions before T.
 *   - lowestPrice is NOT used as a feature (SpotPosition has no real
 *     lowestPrice; the builder used entryPrice as a placeholder). See
 *     GivebackSampleState for the available real fields.
 *
 * CHALLENGERS (R3):
 *   - B_RET and A_FLOOR are ARMED policies: they reach a trigger, then
 *     evaluate a retroceso/protección posterior. An exact counterfactual
 *     state-machine simulator is NOT implemented.
 *   - BASELINE: available=true (actual exit).
 *   - B_RET_0_75_0_30 / A_FLOOR_1_00_1_00: available=false,
 *     reason=EXACT_POLICY_SIMULATOR_NOT_IMPLEMENTED. NO fake PnL.
 *   - Challengers are observational only — never modify exit policy.
 */

import { SPOT_AI_FEATURE_SCHEMA_VERSION } from "./spotAiForwardTwinTypes";
import type {
  SpotAiDataset,
  SpotAiDatasetSample,
  DatasetSplit,
  SpotAiFeatures,
  SpotAiGivebackLabels,
  SpotAiGivebackDataset,
  SpotAiGivebackSample,
  GivebackSampleState,
  ChallengerProjection,
} from "./spotAiForwardTwinTypes";
import { buildFeaturesFromSnapshot, validateNoLookahead } from "./spotAiFeatureBuilder";
import { buildEntryLabels, buildGivebackLabels } from "./spotAiLabelBuilder";
import type { TradeOutcomeEntry } from "./spotAiCompletedTrades";
// Re-export so existing imports from this module keep working.
export type { TradeOutcomeEntry } from "./spotAiCompletedTrades";
import type { ForwardTwinSnapshot } from "../spot/spotForwardTwinTypes";

export interface DatasetBuildInput {
  scanSnapshots: ForwardTwinSnapshot[];
  supervisorSnapshots: ForwardTwinSnapshot[];
  fillSnapshots: ForwardTwinSnapshot[];
  tradeOutcomes: Map<string, TradeOutcomeEntry>;
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
    // R3: use the SINGLE canonical label builder (spotAiLabelBuilder).
    const labels = outcome ? buildEntryLabels(outcome, supervisorSnapshots) : null;

    // Giveback is NOT built from SCAN. The entry dataset carries
    // givebackLabels=null; giveback is a separate dataset built from
    // SUPERVISOR snapshots via buildGivebackDataset().
    const givebackLabels: SpotAiGivebackLabels | null = null;

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
      // R7: policy provenance from the causal SCAN snapshot.
      sourcePolicyVersion: snapshot.policyVersion,
    });
  }

  samples.sort((a, b) => a.features.timestamp - b.features.timestamp);

  assignTemporalSplits(samples);

  return {
    featureSchemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION,
    samples,
    trainCount: samples.filter((s) => s.split === "train").length,
    validationCount: samples.filter((s) => s.split === "validation").length,
    testCount: samples.filter((s) => s.split === "test").length,
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
    if (outcome.entryScanId === snapshot.scanId) {
      return lotId;
    }
  }
  return `temporal-${snapshot.pair}-${Math.floor(snapshot.timestamp / (60 * 60 * 1000))}`;
}

/**
 * Find the trade outcome whose entry was ORIGINATED by this scan, via explicit
 * entryScanId correlation. Temporal overlap is NOT used. A scan that did not
 * originate any entry receives no outcome (labels=null).
 */
function findOutcomeForSnapshot(
  snapshot: ForwardTwinSnapshot,
  outcomes: Map<string, TradeOutcomeEntry>,
): TradeOutcomeEntry | null {
  for (const outcome of outcomes.values()) {
    if (outcome.pair !== snapshot.pair) continue;
    if (outcome.entryScanId === snapshot.scanId) {
      return outcome;
    }
  }
  return null;
}

// ─── Giveback dataset (from SUPERVISOR, future labels after T) ───────────────

/**
 * Build the Giveback dataset from SUPERVISOR snapshots.
 *
 * Each sample is a SUPERVISOR snapshot for a lotId at time T:
 *   - state  = state known up to T (FEATURE side). R3: lowestPrice is NOT
 *              included (SpotPosition has no real lowestPrice; using
 *              entryPrice as a placeholder is prohibited).
 *   - labels = future outcome computed from supervisor path with
 *              timestamp > T (strictly after T). null if trade not closed.
 *
 * The dataset is grouped by lotId and split BY TRADE (chronological lotId
 * ordering by first supervisor timestamp), 60/20/20. All snapshots of a
 * lot inherit the lot's split. No lot appears in >1 split.
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
    // R4: currentR is the instantaneous unrealized R from schema v2 supervisor
    // snapshots. For v1 snapshots without currentR, currentR=null and giveback
    // labels are null (currentRUnavailable=true).
    const currentR = position.currentR ?? null;
    const currentRUnavailable = currentR === null;
    const labels = outcome
      ? buildGivebackLabels({
          lotId: position.lotId,
          pair: position.pair,
          timestamp: snap.timestamp,
          currentR,
          outcome,
          supervisorSnapshots,
        })
      : null;

    const minutesInTrade = position.openedAt > 0
      ? Math.max(0, Math.round((snap.timestamp - position.openedAt) / 60_000))
      : 0;

    // R4: GivebackSampleState uses currentR (instantaneous) and
    // runningMfeR/runningMaeR (cumulative) with clear naming.
    const state: GivebackSampleState = {
      lotId: position.lotId,
      pair: position.pair,
      timestamp: snap.timestamp,
      entryPrice: position.entryPrice,
      currentR,
      runningMfeR: position.mfeR,
      runningMaeR: position.maeR,
      mfeUsd: position.mfe,
      maeUsd: position.mae,
      minutesInTrade,
      breakEvenActivated: position.sgBreakEvenActivated,
      trailingActivated: position.sgTrailingActivated,
      currentStopPrice: position.sgCurrentStopPrice,
      highestPrice: position.highestPrice,
      currentRUnavailable,
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
      // R6: per-sample schema provenance from the originating SUPERVISOR snapshot.
      sourceForwardTwinSchemaVersion: snap.schemaVersion,
      // R7: per-sample policy provenance from the originating SUPERVISOR snapshot.
      sourcePolicyVersion: snap.policyVersion,
    });
  }

  // R3: split BY TRADE (chronological lotId ordering by first supervisor ts).
  assignGivebackTemporalSplitsByTrade(samples);

  return {
    featureSchemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION,
    samples,
    trainCount: samples.filter((s) => s.split === "train").length,
    validationCount: samples.filter((s) => s.split === "validation").length,
    testCount: samples.filter((s) => s.split === "test").length,
    labeledTradeCount: labeledLotIds.size,
    totalSupervisorSnapshots: supervisorSnapshots.length,
    groupSplitByTrade: true,
    temporalSplit: true,
  };
}

/**
 * R3: split giveback samples BY TRADE. Order lotIds by their first supervisor
 * timestamp, assign 60/20/20 by lotId, then all snapshots of a lot inherit
 * the lot's split. No lot appears in >1 split.
 */
function assignGivebackTemporalSplitsByTrade(samples: SpotAiGivebackSample[]): void {
  if (samples.length === 0) return;

  // First timestamp per lotId.
  const firstTsByLot = new Map<string, number>();
  for (const s of samples) {
    const prev = firstTsByLot.get(s.groupId);
    if (prev === undefined || s.state.timestamp < prev) {
      firstTsByLot.set(s.groupId, s.state.timestamp);
    }
  }

  // Order lotIds by first timestamp.
  const orderedLots = Array.from(firstTsByLot.entries())
    .sort((a, b) => a[1] - b[1])
    .map((e) => e[0]);

  const nLots = orderedLots.length;
  const trainEnd = Math.floor(nLots * 0.6);
  const valEnd = Math.floor(nLots * 0.8);

  const lotSplit = new Map<string, DatasetSplit>();
  for (let i = 0; i < nLots; i++) {
    const split: DatasetSplit = i < trainEnd ? "train" : i < valEnd ? "validation" : "test";
    lotSplit.set(orderedLots[i], split);
  }

  for (const s of samples) {
    s.split = lotSplit.get(s.groupId) ?? "train";
  }
}

// ─── Challengers (R3: EXACT_POLICY_SIMULATOR_NOT_IMPLEMENTED) ────────────────

/**
 * Project challenger exit policies observationally.
 *
 * R3: B_RET and A_FLOOR are ARMED policies (trigger → retroceso/protección
 * posterior). An exact counterfactual state-machine simulator is NOT
 * implemented. Therefore these challengers report available=false with
 * reason=EXACT_POLICY_SIMULATOR_NOT_IMPLEMENTED and NO fake PnL.
 *
 * BASELINE is always available (actual exit).
 *
 * Challengers are observational only — never modify exit policy.
 */
function projectChallengers(outcome: TradeOutcomeEntry): ChallengerProjection[] {
  const r = outcome.riskUsd > 0 ? outcome.riskUsd : 1;
  return [
    {
      policy: "BASELINE",
      projectedExitPrice: outcome.exitPrice,
      projectedR: outcome.netPnlUsd / r,
      projectedPnlUsd: outcome.netPnlUsd,
      available: true,
      reason: null,
    },
    {
      policy: "B_RET_0_75_0_30",
      projectedExitPrice: 0,
      projectedR: 0,
      projectedPnlUsd: 0,
      available: false,
      reason: "EXACT_POLICY_SIMULATOR_NOT_IMPLEMENTED",
    },
    {
      policy: "A_FLOOR_1_00_1_00",
      projectedExitPrice: 0,
      projectedR: 0,
      projectedPnlUsd: 0,
      available: false,
      reason: "EXACT_POLICY_SIMULATOR_NOT_IMPLEMENTED",
    },
  ];
}

// ─── Temporal split (entry dataset) ──────────────────────────────────────────

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

// ─── Validation helpers ──────────────────────────────────────────────────────

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
  return dataset.samples.some((s) => s.labels === null);
}

export function validateMinTrades(dataset: SpotAiDataset, minTrades: number): boolean {
  return dataset.labeledTradeCount >= minTrades;
}

/**
 * R3: validate that no lotId appears in more than one split in the giveback
 * dataset (split by trade invariant).
 */
export function validateGivebackGroupSplit(dataset: SpotAiGivebackDataset): boolean {
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
