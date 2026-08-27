/**
 * spotAiCompletedTradeNormalizer — SHARED canonical core for completed trade
 * normalization and validation.
 *
 * R6 FIXES:
 *   - Eliminated phantom exit qty: no relative 99%-101% tolerance.
 *   - closedQty = min(totalEntryVolume, totalExitVolume) but COMPLETED only
 *     if abs(exit - entry) <= QTY_EPSILON (pure numeric representation epsilon).
 *   - exit < entry - epsilon → PARTIAL_EXIT. exit > entry + epsilon → OVERFLOW.
 *   - Entry fee allocated proportionally to closed quantity.
 *   - PnL uses closedQty (real executed exit qty), not full entry volume.
 *
 * RESPONSIBILITIES:
 *   - Aggregate BUY fills per lotId+pair (weighted entry price, total volume,
 *     total fees, scanId compatibility check).
 *   - Aggregate SELL fills per lotId+pair (weighted exit price, total volume,
 *     total fees).
 *   - Validate economic invariants (finite, >0, stopPrice < entryPrice for LONG).
 *   - Compute PnL from actually closed quantity.
 *   - Detect overfill (exit volume > entry volume + epsilon) → EXIT_VOLUME_OVERFLOW.
 *   - Detect partial exit (exit volume < entry volume - epsilon) → PARTIAL_EXIT.
 *   - Detect multiple incompatible scanIds for same lotId+pair → CORRELATION_INCOMPLETE.
 *   - Build CompletedTrade objects with full economic fields.
 */

import type { ForwardTwinSnapshot } from "../spot/spotForwardTwinTypes";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * R6: Pure numeric quantity epsilon for representation precision.
 *
 * This is NOT a business tolerance. It accounts for floating-point
 * representation imprecision only. Crypto base quantities typically have
 * 8 decimal places (satoshis/wei), so the epsilon is set to 1e-8 which
 * is the smallest representable unit for most exchange base currencies.
 *
 * A trade is COMPLETED only if abs(exitVolume - entryVolume) <= QTY_EPSILON.
 * No relative 1% tolerance is used.
 */
export const QTY_EPSILON = 1e-8;

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
  /** Actually closed quantity = min(entry, exit) when within epsilon. */
  closedQty: number;
  /** Total entry fee (USD) — all BUY fills. */
  totalEntryFeeUsd: number;
  /** Entry fee allocated to the closed portion = totalEntryFeeUsd * (closedQty / totalEntryVolume). */
  entryFeeAllocatedUsd: number;
  /** Total exit fee (USD) — all SELL fills. */
  totalExitFeeUsd: number;
  /**
   * Entry fee attributed to the trade (alias for backward compat).
   * R6: This is the ALLOCATED entry fee, not the total.
   */
  entryFeeUsd: number;
  /** Exit fee (USD). Alias for totalExitFeeUsd. */
  exitFeeUsd: number;
  /** Gross PnL (USD) = (exitPrice - entryPrice) * closedQty. */
  grossPnlUsd: number;
  /** Net PnL (USD) = grossPnlUsd - entryFeeAllocatedUsd - exitFeeUsd. */
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
 * R6: Uses QTY_EPSILON (pure numeric representation epsilon) instead of
 * relative 1% tolerance. A trade is COMPLETED only if
 * abs(exitVolume - entryVolume) <= QTY_EPSILON.
 *
 * closedQty = min(totalEntryVolume, totalExitVolume).
 * No phantom exit quantity — SELL price is never applied to unsold quantity.
 *
 * Entry fee is allocated proportionally to the closed portion.
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

    // R6: Pure numeric epsilon comparison — NO relative tolerance.
    const volumeDiff = sell.totalVolume - buy.totalVolume;

    // Check overfill: exit > entry + epsilon
    if (volumeDiff > QTY_EPSILON) {
      exitVolumeOverflowTrades++;
      classifications.push("EXIT_VOLUME_OVERFLOW");
      continue;
    }

    // Check partial exit: exit < entry - epsilon
    if (volumeDiff < -QTY_EPSILON) {
      partialExitTrades++;
      classifications.push("PARTIAL_EXIT");
      continue;
    }

    // Within numeric epsilon: COMPLETED.
    // closedQty = min(entry, exit) — the real executed quantity.
    // No phantom quantity receives the SELL price.
    const closedQty = Math.min(buy.totalVolume, sell.totalVolume);

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

    // R6: Entry fee allocated proportionally to closed portion.
    const totalEntryFeeUsd = buy.totalFees;
    const entryFeeAllocatedUsd = buy.totalVolume > 0
      ? totalEntryFeeUsd * (closedQty / buy.totalVolume)
      : totalEntryFeeUsd;
    const totalExitFeeUsd = sell.totalFees;

    // R6: SPOT canónico is LONG. Direction is always +1.
    // grossPnlUsd = (exitPrice - entryPrice) * closedQty
    const grossPnlUsd = (weightedAverageExitPrice - weightedAverageEntryPrice) * closedQty;
    // netPnlUsd = grossPnlUsd - entryFeeAllocatedUsd - exitFeeUsd
    const netPnlUsd = grossPnlUsd - entryFeeAllocatedUsd - totalExitFeeUsd;

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
      totalEntryFeeUsd,
      entryFeeAllocatedUsd,
      totalExitFeeUsd,
      // R6: entryFeeUsd = allocated (for backward compat with label builder).
      entryFeeUsd: entryFeeAllocatedUsd,
      exitFeeUsd: totalExitFeeUsd,
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
