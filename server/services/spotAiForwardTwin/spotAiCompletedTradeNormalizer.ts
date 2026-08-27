/**
 * spotAiCompletedTradeNormalizer — SHARED canonical core for completed trade
 * normalization and validation.
 *
 * R5: Both `queryCompletedTrades()` (DB path) and `buildCompletedTradesFromSnapshots()`
 * (in-memory path) feed raw aggregated fill data into this module. This
 * guarantees DB ↔ builder parity.
 *
 * RESPONSIBILITIES:
 *   - Aggregate BUY fills per lotId+pair (weighted entry price, total volume,
 *     total fees, scanId compatibility check).
 *   - Aggregate SELL fills per lotId+pair (weighted exit price, total volume,
 *     total fees).
 *   - Validate economic invariants (finite, >0, stopPrice < entryPrice for LONG).
 *   - Compute PnL from actually closed quantity (not full entry volume when
 *     only 99.x% sold).
 *   - Detect overfill (exit volume >> entry volume) → EXIT_VOLUME_OVERFLOW.
 *   - Detect partial exit (exit volume < entry volume * tolerance) → PARTIAL_EXIT.
 *   - Detect multiple incompatible scanIds for same lotId+pair → CORRELATION_INCOMPLETE.
 *   - Build CompletedTrade objects with full economic fields.
 *
 * INVARIANTS:
 *   - SPOT canónico is LONG (BUY→SELL). Direction is always +1.
 *   - initialStopPrice and initialRiskUsd come from the causal SCAN's sizing.
 *   - netPnlUsd = grossPnlUsd - entryFeeUsd - exitFeeUsd.
 *   - grossPnlUsd uses the actually closed quantity, not full entry volume.
 *   - Invalid risk → fail closed → no CompletedTrade.
 *   - Maximum 1 CompletedTrade per lotId+pair.
 */

import type { ForwardTwinSnapshot } from "../spot/spotForwardTwinTypes";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Volume tolerance: exit volume must cover >= 99% of entry volume. */
export const VOLUME_COVERAGE_TOLERANCE = 0.99;

/** Overfill threshold: exit volume > 101% of entry volume → EXIT_VOLUME_OVERFLOW. */
export const VOLUME_OVERFILL_THRESHOLD = 1.01;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CompletedTrade {
  lotId: string;
  pair: string;
  entryScanId: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  /** Immutable initial stop from the causal SCAN's sizing. */
  initialStopPrice: number;
  /** Immutable initial risk (USD) from the causal SCAN's sizing. */
  initialRiskUsd: number;
  /** Weighted average exit price across all SELL fills. */
  weightedAverageExitPrice: number;
  /** Weighted average entry price across all BUY fills. */
  weightedAverageEntryPrice: number;
  /** Total executed entry volume (base currency). */
  totalEntryVolume: number;
  /** Total executed exit volume (base currency). */
  totalExitVolume: number;
  /** Actually closed quantity (min of entry and exit volume). */
  closedQty: number;
  /** Total entry fee (USD). */
  entryFeeUsd: number;
  /** Total exit fee (USD). */
  exitFeeUsd: number;
  /** Gross PnL (USD) = (exitPrice - entryPrice) * closedQty. */
  grossPnlUsd: number;
  /** Net PnL (USD) = grossPnlUsd - entryFeeUsd - exitFeeUsd. */
  netPnlUsd: number;
  mfe: number;
  mae: number;
  mfeR: number;
  maeR: number;
  exitReasonType: string | null;
}

export type TradeClassification =
  | "COMPLETED"
  | "PARTIAL_EXIT"
  | "EXIT_VOLUME_OVERFLOW"
  | "CORRELATION_INCOMPLETE"
  | "CORRELATION_INCOMPLETE_MISSING_LOT_ID"
  | "ECONOMIC_INVALID"
  | "INCOMPLETE";

export interface CompletedTradesResult {
  completedTrades: CompletedTrade[];
  completedTradeCount: number;
  correlationIncompleteTrades: number;
  incompleteTrades: number;
  partialExitTrades: number;
  /** R5: overfill trades (exit volume >> entry volume). */
  exitVolumeOverflowTrades: number;
  /** R5: trades with invalid economic data. */
  economicInvalidTrades: number;
  legacyMissingLotIdBuyFills: number;
  /** R5: per-classification breakdown for audit. */
  classifications: TradeClassification[];
}

// ─── Raw fill data (input to normalizer) ─────────────────────────────────────

export interface RawBuyFill {
  lotId: string;
  pair: string;
  scanId: string;
  fillPrice: number;
  fillVolume: number;
  feeUsd: number;
  timestamp: number;
}

export interface RawSellFill {
  lotId: string;
  pair: string;
  fillPrice: number;
  fillVolume: number;
  feeUsd: number;
  timestamp: number;
}

export interface RawScanSizing {
  scanId: string;
  pair: string;
  stopPrice: number;
  riskUsd: number;
}

export interface RawSupervisorData {
  lotId: string;
  pair: string;
  mfe: number;
  mae: number;
  mfeR: number;
  maeR: number;
  exitReasonType: string | null;
}

export interface RawLegacyNullLotBuyFill {
  count: number;
}

export interface NormalizeInput {
  buyFills: RawBuyFill[];
  sellFills: RawSellFill[];
  scanSizings: RawScanSizing[];
  supervisors: RawSupervisorData[];
  legacyNullLotBuyFillCount: number;
}

// ─── Aggregation helpers ─────────────────────────────────────────────────────

interface BuyAgg {
  lotId: string;
  pair: string;
  scanIds: Set<string>;
  totalVolume: number;
  weightedPriceSum: number;
  totalFees: number;
  firstTimestamp: number;
}

interface SellAgg {
  lotId: string;
  pair: string;
  totalVolume: number;
  weightedPriceSum: number;
  totalFees: number;
  lastTimestamp: number;
}

function aggregateBuyFills(buyFills: RawBuyFill[]): Map<string, BuyAgg> {
  const map = new Map<string, BuyAgg>();
  for (const f of buyFills) {
    if (!f.lotId || !f.pair) continue;
    const key = `${f.lotId}|${f.pair}`;
    const existing = map.get(key);
    if (existing) {
      existing.scanIds.add(f.scanId);
      existing.totalVolume += f.fillVolume;
      existing.weightedPriceSum += f.fillPrice * f.fillVolume;
      existing.totalFees += f.feeUsd;
      if (f.timestamp < existing.firstTimestamp) existing.firstTimestamp = f.timestamp;
    } else {
      const agg: BuyAgg = {
        lotId: f.lotId,
        pair: f.pair,
        scanIds: new Set([f.scanId]),
        totalVolume: f.fillVolume,
        weightedPriceSum: f.fillPrice * f.fillVolume,
        totalFees: f.feeUsd,
        firstTimestamp: f.timestamp,
      };
      map.set(key, agg);
    }
  }
  return map;
}

function aggregateSellFills(sellFills: RawSellFill[]): Map<string, SellAgg> {
  const map = new Map<string, SellAgg>();
  for (const f of sellFills) {
    if (!f.lotId || !f.pair) continue;
    const key = `${f.lotId}|${f.pair}`;
    const existing = map.get(key);
    if (existing) {
      existing.totalVolume += f.fillVolume;
      existing.weightedPriceSum += f.fillPrice * f.fillVolume;
      existing.totalFees += f.feeUsd;
      if (f.timestamp > existing.lastTimestamp) existing.lastTimestamp = f.timestamp;
    } else {
      const agg: SellAgg = {
        lotId: f.lotId,
        pair: f.pair,
        totalVolume: f.fillVolume,
        weightedPriceSum: f.fillPrice * f.fillVolume,
        totalFees: f.feeUsd,
        lastTimestamp: f.timestamp,
      };
      map.set(key, agg);
    }
  }
  return map;
}

// ─── Economic validation ─────────────────────────────────────────────────────

/**
 * Validate economic invariants for a completed trade.
 * Returns null if valid, or a TradeClassification if invalid.
 */
export function validateEconomic(
  entryPrice: number,
  exitPrice: number,
  entryVolume: number,
  exitVolume: number,
  entryFeeUsd: number,
  exitFeeUsd: number,
  initialStopPrice: number,
  initialRiskUsd: number,
  entryTime: number,
  exitTime: number,
): TradeClassification | null {
  // Finite checks
  if (!isFinite(entryPrice) || entryPrice <= 0) return "ECONOMIC_INVALID";
  if (!isFinite(exitPrice) || exitPrice <= 0) return "ECONOMIC_INVALID";
  if (!isFinite(entryVolume) || entryVolume <= 0) return "ECONOMIC_INVALID";
  if (!isFinite(exitVolume) || exitVolume <= 0) return "ECONOMIC_INVALID";
  if (!isFinite(entryFeeUsd) || entryFeeUsd < 0) return "ECONOMIC_INVALID";
  if (!isFinite(exitFeeUsd) || exitFeeUsd < 0) return "ECONOMIC_INVALID";
  if (!isFinite(initialStopPrice) || initialStopPrice <= 0) return "ECONOMIC_INVALID";
  if (!isFinite(initialRiskUsd) || initialRiskUsd <= 0) return "ECONOMIC_INVALID";
  if (!isFinite(entryTime) || entryTime <= 0) return "ECONOMIC_INVALID";
  if (!isFinite(exitTime) || exitTime <= 0) return "ECONOMIC_INVALID";

  // SPOT LONG: initialStopPrice < entryPrice
  if (initialStopPrice >= entryPrice) return "ECONOMIC_INVALID";

  return null;
}

// ─── Canonical normalizer ────────────────────────────────────────────────────

/**
 * Normalize raw fill data into completed trades.
 *
 * This is the SHARED canonical core used by both DB and in-memory paths.
 * Guarantees:
 *   - Maximum 1 CompletedTrade per lotId+pair.
 *   - Weighted average entry/exit prices from aggregated fills.
 *   - PnL from actually closed quantity (min of entry and exit volume).
 *   - Full economic validation.
 *   - Overfill detection.
 *   - Causal scan compatibility check (all BUY fills for same lot must have
 *     same scanId, otherwise CORRELATION_INCOMPLETE).
 */
export function normalizeCompletedTrades(input: NormalizeInput): CompletedTradesResult {
  const { buyFills, sellFills, scanSizings, supervisors, legacyNullLotBuyFillCount } = input;

  // Index scan sizings by scanId+pair
  const scanSizingMap = new Map<string, RawScanSizing>();
  for (const s of scanSizings) {
    scanSizingMap.set(`${s.scanId}|${s.pair}`, s);
  }

  // Index supervisors by lotId+pair (last one wins — caller should provide last)
  const supervisorMap = new Map<string, RawSupervisorData>();
  for (const s of supervisors) {
    supervisorMap.set(`${s.lotId}|${s.pair}`, s);
  }

  // Aggregate fills
  const buyAggs = aggregateBuyFills(buyFills);
  const sellAggs = aggregateSellFills(sellFills);

  const completedTrades: CompletedTrade[] = [];
  const classifications: TradeClassification[] = [];
  let correlationIncompleteTrades = 0;
  let incompleteTrades = 0;
  let partialExitTrades = 0;
  let exitVolumeOverflowTrades = 0;
  let economicInvalidTrades = 0;

  for (const [key, buy] of buyAggs) {
    const sell = sellAggs.get(key);
    const supervisor = supervisorMap.get(key);

    if (!sell || !supervisor) {
      incompleteTrades++;
      classifications.push("INCOMPLETE");
      continue;
    }

    // R5: causal scan compatibility — all BUY fills for same lot must have
    // the same scanId. Multiple incompatible scanIds → CORRELATION_INCOMPLETE.
    if (buy.scanIds.size > 1) {
      correlationIncompleteTrades++;
      classifications.push("CORRELATION_INCOMPLETE");
      continue;
    }

    // Get the single canonical scanId
    const canonicalScanId = buy.scanIds.values().next().value!;

    // Get initial stop/risk from causal SCAN sizing
    const sizing = scanSizingMap.get(`${canonicalScanId}|${buy.pair}`);
    if (!sizing) {
      correlationIncompleteTrades++;
      classifications.push("CORRELATION_INCOMPLETE");
      continue;
    }

    // Calculate weighted average prices
    const weightedAverageEntryPrice = buy.totalVolume > 0
      ? buy.weightedPriceSum / buy.totalVolume
      : 0;
    const weightedAverageExitPrice = sell.totalVolume > 0
      ? sell.weightedPriceSum / sell.totalVolume
      : 0;

    // R5: PnL from actually closed quantity.
    // closedQty = min(entryVolume, exitVolume) — the quantity actually closed.
    // For dust tolerance: if exit covers >= 99% of entry, use entry volume
    // (the remaining dust is negligible). If exit > 101% of entry, that's
    // overfill → fail closed.
    const coverageRatio = buy.totalVolume > 0
      ? sell.totalVolume / buy.totalVolume
      : 0;

    // Check overfill first (exit volume >> entry volume)
    if (coverageRatio > VOLUME_OVERFILL_THRESHOLD) {
      exitVolumeOverflowTrades++;
      classifications.push("EXIT_VOLUME_OVERFLOW");
      continue;
    }

    // Check partial exit
    if (coverageRatio < VOLUME_COVERAGE_TOLERANCE) {
      partialExitTrades++;
      classifications.push("PARTIAL_EXIT");
      continue;
    }

    // Within dust tolerance: use entry volume as closed quantity.
    // This avoids PnL phantom from multiplying full entry by exit price
    // when only 99.x% was sold. The dust (0.x%) is negligible.
    const closedQty = buy.totalVolume;

    // Economic validation
    const invalid = validateEconomic(
      weightedAverageEntryPrice,
      weightedAverageExitPrice,
      buy.totalVolume,
      sell.totalVolume,
      buy.totalFees,
      sell.totalFees,
      sizing.stopPrice,
      sizing.riskUsd,
      buy.firstTimestamp,
      sell.lastTimestamp,
    );
    if (invalid) {
      economicInvalidTrades++;
      classifications.push(invalid);
      continue;
    }

    // R5: SPOT canónico is LONG. Direction is always +1.
    // grossPnlUsd = (exitPrice - entryPrice) * closedQty
    const grossPnlUsd = (weightedAverageExitPrice - weightedAverageEntryPrice) * closedQty;
    // netPnlUsd = grossPnlUsd - entryFeeUsd - exitFeeUsd
    const netPnlUsd = grossPnlUsd - buy.totalFees - sell.totalFees;

    completedTrades.push({
      lotId: buy.lotId,
      pair: buy.pair,
      entryScanId: canonicalScanId,
      entryTime: buy.firstTimestamp,
      exitTime: sell.lastTimestamp,
      entryPrice: weightedAverageEntryPrice,
      exitPrice: weightedAverageExitPrice,
      initialStopPrice: sizing.stopPrice,
      initialRiskUsd: sizing.riskUsd,
      weightedAverageExitPrice,
      weightedAverageEntryPrice,
      totalEntryVolume: buy.totalVolume,
      totalExitVolume: sell.totalVolume,
      closedQty,
      entryFeeUsd: buy.totalFees,
      exitFeeUsd: sell.totalFees,
      grossPnlUsd,
      netPnlUsd,
      mfe: supervisor.mfe,
      mae: supervisor.mae,
      mfeR: supervisor.mfeR,
      maeR: supervisor.maeR,
      exitReasonType: supervisor.exitReasonType,
    });
    classifications.push("COMPLETED");
  }

  return {
    completedTrades,
    completedTradeCount: completedTrades.length,
    correlationIncompleteTrades,
    incompleteTrades,
    partialExitTrades,
    exitVolumeOverflowTrades,
    economicInvalidTrades,
    legacyMissingLotIdBuyFills: legacyNullLotBuyFillCount,
    classifications,
  };
}

// ─── Snapshot extraction helpers ─────────────────────────────────────────────

/**
 * Extract raw fill data from in-memory Forward Twin snapshots.
 * Used by buildCompletedTradesFromSnapshots() to feed into normalizeCompletedTrades().
 */
export function extractRawDataFromSnapshots(snapshots: {
  scans: ForwardTwinSnapshot[];
  supervisors: ForwardTwinSnapshot[];
  fills: ForwardTwinSnapshot[];
}): NormalizeInput {
  const { scans, supervisors, fills } = snapshots;

  const buyFills: RawBuyFill[] = [];
  const sellFills: RawSellFill[] = [];
  let legacyNullLotBuyFillCount = 0;

  for (const f of fills) {
    if (f.snapshotType !== "FILL" || !f.fill) continue;
    if (f.fill.side === "BUY") {
      if (f.fill.lotId === null) {
        legacyNullLotBuyFillCount++;
        continue;
      }
      buyFills.push({
        lotId: f.fill.lotId,
        pair: f.pair,
        scanId: f.scanId,
        fillPrice: f.fill.fillPrice,
        fillVolume: f.fill.fillVolume,
        feeUsd: f.fill.feeUsd,
        timestamp: f.timestamp,
      });
    } else if (f.fill.side === "SELL") {
      if (f.fill.lotId === null) continue;
      sellFills.push({
        lotId: f.fill.lotId,
        pair: f.pair,
        fillPrice: f.fill.fillPrice,
        fillVolume: f.fill.fillVolume,
        feeUsd: f.fill.feeUsd,
        timestamp: f.timestamp,
      });
    }
  }

  const scanSizings: RawScanSizing[] = [];
  for (const s of scans) {
    if (s.snapshotType !== "SCAN" || !s.sizing) continue;
    scanSizings.push({
      scanId: s.scanId,
      pair: s.pair,
      stopPrice: s.sizing.stopPrice,
      riskUsd: s.sizing.riskUsd,
    });
  }

  // Last supervisor per lotId+pair
  const supMap = new Map<string, RawSupervisorData>();
  for (const s of supervisors) {
    if (s.snapshotType !== "SUPERVISOR" || !s.position || !s.position.lotId) continue;
    const key = `${s.position.lotId}|${s.position.pair}`;
    const existing = supMap.get(key);
    // Keep the one with the latest timestamp
    if (!existing || s.timestamp > (existing as any)._ts) {
      supMap.set(key, {
        lotId: s.position.lotId,
        pair: s.position.pair,
        mfe: s.position.mfe,
        mae: s.position.mae,
        mfeR: s.position.mfeR,
        maeR: s.position.maeR,
        exitReasonType: s.exitDecision?.reasonType ?? null,
      });
    }
  }
  // We need to track timestamps for "last supervisor" logic.
  // Redo with proper timestamp tracking:
  supMap.clear();
  const supTsMap = new Map<string, number>();
  for (const s of supervisors) {
    if (s.snapshotType !== "SUPERVISOR" || !s.position || !s.position.lotId) continue;
    const key = `${s.position.lotId}|${s.position.pair}`;
    const prevTs = supTsMap.get(key) ?? 0;
    if (s.timestamp > prevTs) {
      supTsMap.set(key, s.timestamp);
      supMap.set(key, {
        lotId: s.position.lotId,
        pair: s.position.pair,
        mfe: s.position.mfe,
        mae: s.position.mae,
        mfeR: s.position.mfeR,
        maeR: s.position.maeR,
        exitReasonType: s.exitDecision?.reasonType ?? null,
      });
    }
  }

  return {
    buyFills,
    sellFills,
    scanSizings,
    supervisors: Array.from(supMap.values()),
    legacyNullLotBuyFillCount,
  };
}
