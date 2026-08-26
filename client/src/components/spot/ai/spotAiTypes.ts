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
}

export interface DatasetOverview {
  totalSnapshots: number;
  scanCount: number;
  supervisorCount: number;
  fillCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  labeledTrades: number;
  pendingTrades: number;
  collectorEnabled: boolean;
  bufferSize: number;
  bufferMax: number;
}

export interface DatasetQuality {
  checks: {
    lookaheadFeatures: number;
    legacyMixed: boolean;
    syntheticLabels: boolean;
    duplicateTrades: number;
    missingFeatures: number;
    invalidSnapshots: number;
    orphanSupervisor: number;
    orphanFills: number;
    incompleteTrades: number;
    schemaVersionMismatches: number;
  };
  score: number;
  featureSchemaVersion: number;
}

export interface FeatureInfo {
  name: string;
  type: string;
  origin: string;
  timeframe: string;
  missingPct: number;
  version: number;
}

export interface PairDistribution {
  pair: string;
  total: number;
  scans: number;
  supervisors: number;
  fills: number;
  firstTs: number;
  lastTs: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  netPnl: number | null;
  mfeMedian: number | null;
  maeMedian: number | null;
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
  timestamp: number;
  scores: Record<string, number>;
  recommendation: string;
}

export interface ValidationData {
  baseline: { name: string; trades: number; wins: number; losses: number; pnl: number };
  candidate: { name: string; trades: number; wins: number; losses: number; pnl: number } | null;
  confusionMatrix: { tp: number; fp: number; tn: number; fn: number } | null;
  winnerRejectionRate: number | null;
  loserAvoidanceRate: number | null;
  evaluatedTrades: number;
}

export interface GivebackData {
  tradesWithPositiveMfe: number;
  mfeGte0_5R: number;
  mfeGte1R: number;
  mfeGte1_5R: number;
  mfeGte2R: number;
  profitToLoss: number;
  givebackTotalUsd: number;
  medianGivebackPct: number | null;
  mfeTotal: number;
  pnlCaptured: number;
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
  collectorHealth: {
    enabled: boolean;
    totalCaptured: number;
    totalFlushed: number;
    droppedSnapshots: number;
    lastFlushError: string | null;
    lastFlushAt: number | null;
  };
  recentErrors: Array<{ timestamp: number; error: string; context: string }>;
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
