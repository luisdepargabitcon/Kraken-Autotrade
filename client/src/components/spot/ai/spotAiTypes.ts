export interface SpotAiStatus {
  status: string;
  featureSchemaVersion: number;
  totalSnapshots: number;
  labeledTrades: number;
  minTradesToTrain: number;
  preferredTradesToTrain: number;
  entryModelVersion: string | null;
  givebackModelVersion: string | null;
  entryModelStatus: string | null;
  givebackModelStatus: string | null;
  autoRetrain: boolean;
  aiTradingControl: string;
  legacyDataMixed: boolean;
  // R3: training pipeline readiness and durable trade count.
  trainingPipelineReady?: boolean;
  durableLabeledTrades?: number | null;
  collectorSessionCaptured?: number;
  collectorSessionFlushed?: number;
  bufferSize?: number;
  bufferMax?: number;
  droppedSnapshots?: number;
}

export interface DatasetOverview {
  totalSnapshots: number;
  scanCount: number;
  supervisorCount: number;
  fillCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  labeledTrades: number;
  labeledSampleCount?: number;
  // R4: real unlabeled scan count (totalScans - labeledEntryScans).
  labeledEntryScans?: number;
  unlabeledScanCount?: number;
  // R4: durable completed trade count (null if 090 not applied).
  completedDurableTrades?: number | null;
  pendingTrades: number | null;
  collectorEnabled: boolean;
  bufferSize: number;
  bufferMax: number;
  collectorSessionCaptured?: number;
  collectorSessionFlushed?: number;
}

export interface DatasetQuality {
  checks: {
    schemaVersionMismatches: number;
    invalidSnapshots: number;
    missingFeatures: number;
    duplicateEntryFills: number;
    duplicateExitFills: number;
    orphanSupervisor: number;
    orphanFills: number;
    incompleteTrades: number;
    // R3: nullable — not computable in pure SQL. null = NO DISPONIBLE.
    lookaheadViolations: number | null;
    causalCorrelationFailures: number | null;
    legacyMixed: boolean;
    syntheticLabels: boolean;
    // R4/R5: new quality checks
    legacyBuyFillMissingLotId?: number;
    completedTradeEconomicInvalid?: number | null;
    duplicateCompletedLot?: number | null;
    partialExitTrades?: number;
    correlationIncompleteTrades?: number;
    // R5: overfill and multi-fill checks
    exitVolumeOverflowTrades?: number;
    multiBuyFills?: number;
    multiSellFills?: number;
    durableStorageAvailable?: boolean;
    durableSyncErrors?: number | null;
    durableUnsyncedCompletedTrades?: number | null;
    forwardTwinV1Count?: number;
    forwardTwinV2Count?: number;
  };
  // R3: per-check availability metadata.
  checksAvailable?: Record<string, boolean>;
  // R3: coverage percentage of computed checks vs total checks.
  qualityCoveragePct?: number;
  // R3: true when coverage < 100 (partial score).
  scoreIsPartial?: boolean;
  score: number;
  available: boolean;
  status: string;
  legacyMixedStructuralInvariant: boolean;
  syntheticLabelsStructuralInvariant: boolean;
  featureSchemaVersion: number;
}

export interface FeatureInfo {
  name: string;
  type: string;
  origin: string;
  timeframe: string;
  missingPct: number | null;
  version: number;
}

export interface FeaturesResponse {
  features: FeatureInfo[];
  schemaVersion: number;
  available: boolean;
  reason?: string;
}

export interface PairDistribution {
  pair: string;
  total: number;
  scans: number;
  supervisors: number;
  fills: number;
  firstTs: number;
  lastTs: number;
  trades: number | null;
  wins: number | null;
  losses: number | null;
  winRate: number | null;
  netPnl: number | null;
  mfeMedian: number | null;
  maeMedian: number | null;
  tradeStatsAvailable: boolean;
}

export interface RegimeDistribution {
  regime: string;
  direction: string;
  count: number;
}

export interface ModelRegistryEntry {
  modelName: string;
  modelVersion: string;
  featureSchemaVersion: number;
  status: string;
  datasetStart: number;
  datasetEnd: number;
  tradeCount: number;
  gitSha: string;
  trainedAt: number;
  metrics: Record<string, number>;
  modelPath: string;
}

export interface AdvisoryLog {
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

export interface ValidationData {
  available: boolean;
  reason?: string;
  baseline: { name: string; trades: number; wins: number; losses: number; pnl: number } | null;
  candidate: { name: string; trades: number; wins: number; losses: number; pnl: number } | null;
  confusionMatrix: { tp: number; fp: number; tn: number; fn: number } | null;
  winnerRejectionRate: number | null;
  loserAvoidanceRate: number | null;
  evaluatedTrades: number;
}

export interface GivebackData {
  available: boolean;
  reason?: string;
  tradesWithPositiveMfe: number | null;
  mfeGte0_5R: number | null;
  mfeGte1R: number | null;
  mfeGte1_5R: number | null;
  mfeGte2R: number | null;
  profitToLoss: number | null;
  givebackTotalUsd: number | null;
  medianGivebackPct: number | null;
  mfeTotal: number | null;
  pnlCaptured: number | null;
  captureEfficiency: number | null;
  highGivebackCases: Array<{ pair: string; lotId: string; mfeR: number; givebackPct: number; finalR: number }>;
}

export interface AuditData {
  featureSchemaVersion: number;
  modelVersions: Array<{
    modelName: string;
    modelVersion: string;
    status: string;
    trainedAt: number;
    tradeCount: number;
    gitSha: string;
    metrics: Record<string, number>;
  }>;
  trainingRuns: Array<{
    trainingRunId: string;
    timestamp: number;
    featureSchemaVersion: number;
    sampleCount: number;
    status: string;
    metrics: Record<string, number>;
  }>;
  trainingRunsAvailable: boolean;
  collectorHealth: {
    enabled: boolean;
    totalCaptured: number;
    totalFlushed: number;
    persistedSnapshots: number;
    droppedSnapshots: number;
    lastFlushError: string | null;
    lastFlushAt: number | null;
  };
  recentErrors: Array<{ timestamp: number; error: string; context: string }>;
  errorsAvailable: boolean;
}

export const STATUS_LABELS: Record<string, string> = {
  COLLECTING: "RECOPILANDO",
  READY_TO_TRAIN: "LISTO PARA ENTRENAR",
  TRAINING: "ENTRENANDO",
  VALIDATING: "VALIDANDO",
  ADVISORY: "ADVISORY ACTIVO",
  DISABLED: "DESACTIVADO",
};

export const STATUS_COLORS: Record<string, string> = {
  COLLECTING: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  READY_TO_TRAIN: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  TRAINING: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  VALIDATING: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  ADVISORY: "bg-green-500/20 text-green-400 border-green-500/30",
  DISABLED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

export const MODEL_STATUS_COLORS: Record<string, string> = {
  NOT_TRAINED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  TRAINING: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  CANDIDATE: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  VALIDATED: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  ACTIVE_ADVISORY: "bg-green-500/20 text-green-400 border-green-500/30",
  RETIRED: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  FAILED: "bg-red-500/20 text-red-400 border-red-500/30",
};

export function getAvailabilityBadge(
  available: boolean,
  reason?: string,
): { label: string; color: string } {
  if (available) {
    return { label: "REAL", color: "bg-green-500/20 text-green-400 border-green-500/30" };
  }
  if (reason === "INSUFFICIENT_DATA" || reason === "NO_COMPLETED_FORWARD_TRADES") {
    return { label: "INSUFICIENTE", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" };
  }
  if (reason === "NO_CANDIDATE" || reason === "EVALUATION_NOT_PERFORMED" || reason === "TRAINER_NOT_AVAILABLE") {
    return { label: "NO DISPONIBLE", color: "bg-gray-500/20 text-gray-400 border-gray-500/30" };
  }
  return { label: "NO DISPONIBLE", color: "bg-gray-500/20 text-gray-400 border-gray-500/30" };
}

export function isStructuralInvariant(checks: DatasetQuality): boolean {
  return checks.legacyMixedStructuralInvariant && checks.syntheticLabelsStructuralInvariant;
}
