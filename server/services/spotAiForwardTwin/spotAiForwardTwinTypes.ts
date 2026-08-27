/**
 * spotAiForwardTwinTypes — Type definitions for IA SPOT FORWARD TWIN.
 *
 * This module defines the AI intelligence layer that reads exclusively
 * from spot_forward_twin_snapshots and produces advisory predictions.
 *
 * INVARIANTS:
 *   - AI_TRADING_CONTROL = NONE. No placeOrder, blockEntry, forceExit, moveStop, changeSizing.
 *   - Data source: spot_forward_twin_snapshots ONLY. No legacy dataset mixing.
 *   - Feature schema is versioned. No lookahead features.
 *   - Labels computed only after trade closure.
 *   - Model registry is append-only. No overwriting without version bump.
 */

// ─── AI Status ───────────────────────────────────────────────────────────────

export type SpotAiStatus =
  | "COLLECTING"
  | "READY_TO_TRAIN"
  | "TRAINING"
  | "VALIDATING"
  | "ADVISORY"
  | "SHADOW_FILTER_CANDIDATE"
  | "DISABLED";

export const SPOT_AI_INITIAL_STATUS: SpotAiStatus = "COLLECTING";

// ─── Feature Schema ──────────────────────────────────────────────────────────

export const SPOT_AI_FEATURE_SCHEMA_VERSION = 1;

export const MIN_TRADES_TO_TRAIN = 100;
export const PREFERRED_TRADES_TO_TRAIN = 200;

export interface SpotAiFeatures {
  featureSchemaVersion: number;
  // Identity
  pair: string;
  scanId: string;
  timestamp: number;
  // Market state
  regime: string;
  direction: string;
  macroBias: string;
  dataHealth: string;
  // Ticker
  bid: number;
  ask: number;
  last: number;
  spreadPct: number;
  // Volatility / trend
  atr: number;
  atrPct: number;
  adx: number;
  ema20: number;
  ema50: number;
  ema200: number;
  emaAlignment: string;
  // Volume
  volume: number;
  volumeRatio: number;
  participation: string;
  // Signal
  setupTag: string | null;
  signalConfidence: number;
  // Intent
  intentState: string | null;
  antiLateEntryState: string | null;
  // Capital
  availableCapital: number;
  reservedCapital: number;
  openLotsForPair: number;
  // Sizing (if intent exists)
  notionalUsd: number | null;
  initialRiskUsd: number | null;
}

// ─── Entry Labels ────────────────────────────────────────────────────────────

export interface SpotAiEntryLabels {
  reached_0_5R_before_stop: boolean;
  reached_1R_before_stop: boolean;
  reached_1_5R_before_stop: boolean;
  reached_2R_before_stop: boolean;
  final_net_profitable: boolean;
  final_R: number;
  mfe_R: number;
  mae_R: number;
  time_to_0_5R: number | null;
  time_to_1R: number | null;
  time_to_exit: number | null;
}

// ─── Giveback Labels ─────────────────────────────────────────────────────────

export interface SpotAiGivebackLabels {
  profit_to_loss: boolean;
  giveback_25pct: boolean;
  giveback_50pct: boolean;
  giveback_75pct: boolean;
  final_R: number;
  future_MFE_R: number;
  future_MAE_R: number;
  expected_giveback_R: number;
}

// ─── Prediction Outputs ──────────────────────────────────────────────────────

export interface SpotAiEntryPrediction {
  modelVersion: string;
  featureSchemaVersion: number;
  scanId: string;
  pair: string;
  timestamp: number;
  prob_0_5R: number;
  prob_1R: number;
  prob_2R: number;
  expected_MFE_R: number;
  expected_MAE_R: number;
  prob_net_profit: number;
  entry_quality_score: number;
}

export interface SpotAiGivebackPrediction {
  modelVersion: string;
  featureSchemaVersion: number;
  scanId: string;
  pair: string;
  lotId: string;
  timestamp: number;
  prob_profit_to_loss: number;
  expected_future_MFE_R: number;
  expected_final_R: number;
  expected_giveback_R: number;
  giveback_risk_score: number;
}

// ─── Challenger Projections (observational only) ─────────────────────────────

export type ChallengerPolicy = "BASELINE" | "B_RET_0_75_0_30" | "A_FLOOR_1_00_1_00";

export interface ChallengerProjection {
  policy: ChallengerPolicy;
  projectedExitPrice: number;
  projectedR: number;
  projectedPnlUsd: number;
  /**
   * Whether the challenger projection is reliable. A challenger must NOT
   * simulate "reached trigger => closed immediately at trigger" when there is
   * insufficient chronological path data to determine whether the target or
   * the stop was hit first. When available=false, reason explains why.
   */
  available: boolean;
  reason: string | null;
}

// ─── Model Registry ──────────────────────────────────────────────────────────

export type ModelName = "SPOT_AI_FORWARD_TWIN_ENTRY" | "SPOT_AI_FORWARD_TWIN_GIVEBACK";
export type ModelStatus = "CANDIDATE" | "VALIDATED" | "ACTIVE_ADVISORY" | "RETIRED";

export interface ModelRegistryEntry {
  modelName: ModelName;
  modelVersion: string;
  featureSchemaVersion: number;
  status: ModelStatus;
  datasetStart: number;
  datasetEnd: number;
  tradeCount: number;
  gitSha: string;
  trainedAt: number;
  metrics: Record<string, number>;
  modelPath: string;
}

// ─── Dataset Sample ──────────────────────────────────────────────────────────

export type DatasetSplit = "train" | "validation" | "test";

export interface SpotAiDatasetSample {
  sampleId: string;
  split: DatasetSplit;
  groupId: string;
  features: SpotAiFeatures;
  labels: SpotAiEntryLabels | null;
  givebackLabels: SpotAiGivebackLabels | null;
  challengers: ChallengerProjection[];
}

export interface SpotAiDataset {
  featureSchemaVersion: number;
  samples: SpotAiDatasetSample[];
  trainCount: number;
  validationCount: number;
  testCount: number;
  labeledTradeCount: number;
  totalSnapshotCount: number;
  groupSplitByTrade: boolean;
  temporalSplit: boolean;
}

// ─── Giveback Dataset (from SUPERVISOR snapshots) ────────────────────────────

/**
 * State known up to a given SUPERVISOR snapshot instant. This is the FEATURE
 * side of a giveback sample — never includes future outcome.
 *
 * R3: lowestPrice is NOT included. SpotPosition has no real lowestPrice
 * (the Forward Twin builder used entryPrice as a placeholder, which is
 * incorrect). Only fields with a real source are present.
 *
 * R4: currentR is the instantaneous unrealized R at time T (from schema v2
 * supervisor snapshots). runningMfeR/runningMaeR are the cumulative MFE/MAE
 * R-multiples since entry (different from currentR). For v1 snapshots without
 * currentR, currentRUnavailable=true and giveback labels are null.
 */
export interface GivebackSampleState {
  lotId: string;
  pair: string;
  timestamp: number;
  entryPrice: number;
  /** R4: instantaneous unrealized R at time T. null for v1 snapshots. */
  currentR: number | null;
  /** R4: cumulative MFE R since entry (running, NOT current). */
  runningMfeR: number;
  /** R4: cumulative MAE R since entry (running, NOT current). */
  runningMaeR: number;
  mfeUsd: number;
  maeUsd: number;
  minutesInTrade: number;
  breakEvenActivated: boolean;
  trailingActivated: boolean;
  currentStopPrice: number;
  highestPrice: number;
  /** R4: true when currentR is unavailable (v1 snapshot without currentR). */
  currentRUnavailable: boolean;
}

export interface SpotAiGivebackSample {
  sampleId: string;
  split: DatasetSplit;
  groupId: string; // lotId — group split by trade
  state: GivebackSampleState;
  // Future outcome — LABEL only, not available at prediction time.
  // null when the trade is not yet closed (no completed outcome).
  labels: SpotAiGivebackLabels | null;
}

export interface SpotAiGivebackDataset {
  featureSchemaVersion: number;
  samples: SpotAiGivebackSample[];
  trainCount: number;
  validationCount: number;
  testCount: number;
  labeledTradeCount: number;
  totalSupervisorSnapshots: number;
  groupSplitByTrade: boolean;
  temporalSplit: boolean;
}

// ─── Advisory Log ────────────────────────────────────────────────────────────

export interface SpotAiAdvisoryLog {
  scanId: string;
  pair: string;
  modelVersion: string;
  featureSchemaVersion: number;
  entryQualityScore: number;
  prob_0_5R: number;
  prob_1R: number;
  prob_2R: number;
  expectedMfeR: number;
  expectedMaeR: number;
  prob_net_profit: number;
  givebackRiskScore: number | null;
  lotId: string | null;
  timestamp: number;
}

// ─── Status Response ─────────────────────────────────────────────────────────

export interface SpotAiStatusResponse {
  status: SpotAiStatus;
  featureSchemaVersion: number;
  totalSnapshots: number;
  labeledTrades: number;
  minTradesToTrain: number;
  preferredTradesToTrain: number;
  entryModelVersion: string | null;
  givebackModelVersion: string | null;
  entryModelStatus: ModelStatus | null;
  givebackModelStatus: ModelStatus | null;
  autoRetrain: boolean;
  aiTradingControl: "NONE";
  legacyDataMixed: boolean;
  // R3: training pipeline readiness. NO until durable training trade storage
  // (migration 090) is applied and the durable completed trade count is used
  // as the training guard. The rolling 7-day raw snapshot count is NOT a
  // durable basis for training.
  trainingPipelineReady: boolean;
  // R3: durable completed trade count (from spot_ai_forward_training_trades).
  // null when the durable table does not exist yet (migration 090 not applied).
  durableLabeledTrades: number | null;
}
