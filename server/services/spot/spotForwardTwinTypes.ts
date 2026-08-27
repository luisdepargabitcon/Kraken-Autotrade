/**
 * spotForwardTwinTypes — Schema types for Forward Twin telemetry.
 *
 * Forward Twin captures EXACT inputs seen by production on every scan,
 * supervisor cycle, and fill event. These snapshots are consumed by
 * Replay V3 for deterministic offline replay.
 *
 * INVARIANTS:
 *   - Schema version is immutable per recorded snapshot.
 *   - All timestamps are epoch ms.
 *   - No secrets, API keys, or credentials are ever recorded.
 *   - Snapshots are append-only; no mutation after flush.
 *   - Telemetry capture is non-blocking (in-memory buffer, async flush).
 */

export const SPOT_FORWARD_TWIN_SCHEMA_VERSION = 1;
export const SPOT_FORWARD_TWIN_SCHEMA_VERSION_1 = 1;
export const SPOT_FORWARD_TWIN_SCHEMA_VERSION_2 = 2;

export const SPOT_FORWARD_TWIN_RETENTION_DAYS = 7;

/**
 * R6: Shared canonical schema validation per snapshot type.
 *
 * Allowed schema versions:
 *   SCAN → v1 only
 *   FILL → v1 only
 *   SUPERVISOR → v1 (legacy) and v2 (with currentR)
 *   unknown type → mismatch
 *
 * Used by quality checks and any consumer that needs to validate
 * Forward Twin schema provenance.
 */
export function isForwardTwinSchemaAllowed(
  snapshotType: string,
  schemaVersion: number,
): boolean {
  if (snapshotType === "SCAN") return schemaVersion === 1;
  if (snapshotType === "FILL") return schemaVersion === 1;
  if (snapshotType === "SUPERVISOR") return schemaVersion === 1 || schemaVersion === 2;
  return false;
}
export const SPOT_FORWARD_TWIN_FLUSH_INTERVAL_MS = 5_000;
export const SPOT_FORWARD_TWIN_BUFFER_MAX = 500;

// ─── Snapshot Types ──────────────────────────────────────────────────────────

export type ForwardTwinSnapshotType = "SCAN" | "SUPERVISOR" | "FILL";

export interface ForwardTwinTickerSnapshot {
  bid: number;
  ask: number;
  last: number;
  spread: number;
  spreadPct: number;
  fetchedAt: number;
}

export interface ForwardTwinCandleMeta {
  count: number;
  lastTime: number;
  lastClose: number;
}

export interface ForwardTwinCandleArray {
  meta: ForwardTwinCandleMeta;
  candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[];
}

export interface ForwardTwinCandleSnapshot {
  candles5m: ForwardTwinCandleArray;
  candles15m: ForwardTwinCandleArray;
  candles1h: ForwardTwinCandleArray;
  candles4h: ForwardTwinCandleArray;
}

export interface ForwardTwinRegimeSnapshot {
  regime: string;
  direction: string;
  macroBias: string;
  volatility: string;
  adx: number;
  ema20: number;
  ema50: number;
  ema200: number;
  emaAlignment: string;
  bollingerWidth: number;
  atrPct: number;
  confidence: number;
  regimeId: string;
  contextId: string;
}

export interface ForwardTwinVolumeSnapshot {
  volumeRatio: number;
  volume24h: number;
  participation: string;
}

export interface ForwardTwinSignalSnapshot {
  signal: "BUY" | "NONE";
  setupTag: string | null;
  reason: string;
  confidence: number;
  originPrice: number;
  origin15mCloseAt: number;
  originAtrPct: number;
  originVolume: number;
  contextId: string;
  blockReason: string | null;
}

export interface ForwardTwinIntentSnapshot {
  signalId: string;
  state: string;
  setupTag: string;
  createdAt: number;
  expiresAt: number;
  originPrice: number;
  originAtrPct: number;
  originRegime: string;
  originDirection: string;
  originMacro: string;
  retryCount: number;
  lastBlockReason: string | null;
  lastEvaluatedAt: number | null;
  shouldExecute: boolean;
  evaluationReason: string;
}

export interface ForwardTwinSizingSnapshot {
  approved: boolean;
  reason: string;
  volume: number;
  notionalUsd: number;
  stopPrice: number;
  stopDistanceUsd: number;
  stopDistancePct: number;
  riskUsd: number;
  entryFeeUsd: number;
  roundTripFeeUsd: number;
  blockReason: string | null;
  blockCode: string | null;
}

export interface ForwardTwinCapitalSnapshot {
  availableCapital: number;
  openLots: number;
  maxLotsPerPair: number;
  reservedCapital: number;
  realizedPnl: number;
  totalFees: number;
}

export interface ForwardTwinPositionSnapshot {
  lotId: string;
  pair: string;
  entryPrice: number;
  amount: number;
  qtyRemaining: number;
  highestPrice: number;
  lowestPrice: number;
  mfe: number;
  mae: number;
  mfeR: number;
  maeR: number;
  openedAt: number;
  setupTag: string;
  executionMode: string;
  sgBreakEvenActivated: boolean;
  sgTrailingActivated: boolean;
  sgCurrentStopPrice: number;
  breakEvenStopPrice: number | null;
  trailingStopPrice: number | null;
  trailingHighestPrice: number;
  // R4 (schema v2): immutable initial stop/risk from the causal entry scan.
  // v1 snapshots do NOT have these fields; readers must treat them as
  // optional and fall back to the causal SCAN sizing when absent.
  initialStopPrice?: number;
  initialStopDistanceUsd?: number;
  riskUsd?: number;
  // R4 (schema v2): instantaneous unrealized R at the moment of the
  // supervisor snapshot. Computed via computeRMultiple(currentPrice, position).
  // v1 snapshots do NOT have this field; giveback labels for v1 snapshots
  // cannot use instantaneous currentR and must be marked unavailable.
  currentR?: number;
  // R4 (schema v2): the ticker last price at the moment of the supervisor
  // snapshot. Used to compute currentR if not directly available.
  currentPrice?: number;
}

export interface ForwardTwinExitDecisionSnapshot {
  shouldExit: boolean;
  reasonType: string | null;
  reason: string;
  price: number;
  priority: number | null;
  evaluatedAt: number;
}

export interface ForwardTwinFillSnapshot {
  side: "BUY" | "SELL";
  lotId: string | null;
  fillPrice: number;
  fillVolume: number;
  notionalUsd: number;
  feeUsd: number;
  slippageUsd: number;
  slippagePct: number;
  fillQuality: string;
  orderId: string;
  executedAt: number;
  tickerBid: number;
  tickerAsk: number;
  tickerLast: number;
  // R3: explicit telemetry correlation keys (optional). For BUY fills,
  // intentId is the SpotExecutionIntent id and signalId is the originating
  // SpotEntryIntent signalId. These make the scan→entry→fill→lot chain
  // unambiguous without parsing internalIntentId.
  intentId?: string | null;
  signalId?: string | null;
}

// ─── Full Snapshot Record ────────────────────────────────────────────────────

export interface ForwardTwinSnapshot {
  schemaVersion: number;
  snapshotType: ForwardTwinSnapshotType;
  scanId: string;
  timestamp: number;
  pair: string;
  policyVersion: string;
  executionMode: string;
  engineOwner: string;

  // SCAN snapshots
  ticker?: ForwardTwinTickerSnapshot;
  candles?: ForwardTwinCandleSnapshot;
  regime?: ForwardTwinRegimeSnapshot;
  volume?: ForwardTwinVolumeSnapshot;
  signal?: ForwardTwinSignalSnapshot;
  intent?: ForwardTwinIntentSnapshot | null;
  sizing?: ForwardTwinSizingSnapshot | null;
  capital?: ForwardTwinCapitalSnapshot;
  dataHealth?: string;
  marketContextId?: string;
  pipelineStopStage?: string | null;
  pipelineStopReasonCode?: string | null;

  // SUPERVISOR snapshots
  position?: ForwardTwinPositionSnapshot;
  exitDecision?: ForwardTwinExitDecisionSnapshot;

  // FILL snapshots
  fill?: ForwardTwinFillSnapshot;
}

// ─── DB Row ──────────────────────────────────────────────────────────────────

export interface ForwardTwinDbRow {
  id: number;
  schema_version: number;
  snapshot_type: string;
  scan_id: string;
  timestamp: number;
  pair: string;
  policy_version: string;
  execution_mode: string;
  engine_owner: string;
  data: unknown;
  created_at: string;
}

// ─── Replay V3 Types ─────────────────────────────────────────────────────────

export interface ReplayV3Config {
  pair: string;
  startMs: number;
  endMs: number;
  initialCapitalUsd: number;
}

export interface ReplayV3Trade {
  lotId: string;
  pair: string;
  entryPrice: number;
  exitPrice: number;
  amount: number;
  entryTime: number;
  exitTime: number;
  netPnlUsd: number;
  grossPnlUsd: number;
  entryFeeUsd: number;
  exitFeeUsd: number;
  exitReasonType: string;
  holdTimeMinutes: number;
  mfe: number;
  mae: number;
  mfeR: number;
  maeR: number;
  setupTag: string;
}

export interface ReplayV3FidelityMetrics {
  signalMatchRate: number;
  signalTotal: number;
  intentMatchRate: number;
  intentTotal: number;
  entryMatchRate: number;
  entryTotal: number;
  exitDecisionMatchRate: number;
  fillMatchRate: number;
  totalSnapshots: number;
  scanSnapshots: number;
  supervisorSnapshots: number;
  fillSnapshots: number;
  matchedTrades: number;
  mismatchedTrades: number;
}

export interface ReplayV3Result {
  trades: ReplayV3Trade[];
  finalEquity: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  scanCount: number;
  supervisorCount: number;
  fillCount: number;
  fidelity: ReplayV3FidelityMetrics;
  deterministic: boolean;
}
