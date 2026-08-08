/**
 * AMA Market Runtime Service — Real market data integration for AMA.
 *
 * Connects getMarketView() to the existing Kraken MarketDataService singleton.
 * Computes drop percentages, macro zones, and HWM-derived metrics from real data.
 *
 * SAFETY: Read-only. No orders, no exchange writes, no capital movements.
 */

import { MarketDataService, type Timeframe } from "../MarketDataService";
import type { OHLC, Ticker } from "../exchanges/IExchangeService";
import { amaHwmBootstrapService } from "./amaFunctionalClosure";
import {
  AMA_PAIR,
  type AmaMarketView,
  type MacroZone,
  type DataQualityState,
} from "./amaTypes";
import { getZoneFromDropPct } from "./amaTypes";

/**
 * Build a real AmaMarketView from Kraken public market data + HWM bootstrap state.
 * Returns a view with dataQuality="UNAVAILABLE" if market data is inaccessible.
 */
export async function getRealMarketView(): Promise<AmaMarketView> {
  const pair = AMA_PAIR;

  // Fetch ticker and candles in parallel
  let ticker: Ticker | null = null;
  let candles1d: OHLC[] = [];

  try {
    [ticker, candles1d] = await Promise.all([
      MarketDataService.getTicker(pair),
      MarketDataService.getCandles(pair, "1d" as Timeframe),
    ]);
  } catch {
    // Fall through to unavailable
  }

  // Fetch HWM bootstrap state
  const hwmState = await amaHwmBootstrapService.getState();
  const hwm = hwmState.hwm;
  const hwmTimestamp = hwmState.hwmTimestamp;

  // If no ticker at all, return unavailable
  if (!ticker || !Number.isFinite(ticker.last) || ticker.last <= 0) {
    return {
      pair,
      analysisPrice: null,
      analysisTimestamp: null,
      executionBid: null,
      executionAsk: null,
      executionMid: null,
      spreadPct: null,
      crossVenueBasisPct: null,
      executionTimestamp: null,
      highWaterMark: hwm,
      cycleLow: null,
      currentDropPct: null,
      maxDropPct: null,
      reboundFromLowPct: null,
      macroZone: null,
      daysSinceCeiling: null,
      daysSinceLow: null,
      dataQuality: "UNAVAILABLE" as DataQualityState,
    };
  }

  const analysisPrice = ticker.last;
  const analysisTimestamp = new Date().toISOString();
  const executionBid = ticker.bid ?? null;
  const executionAsk = ticker.ask ?? null;
  const executionMid = executionBid !== null && executionAsk !== null
    ? (executionBid + executionAsk) / 2
    : analysisPrice;
  const spreadPct = executionBid !== null && executionAsk !== null && executionBid > 0
    ? ((executionAsk - executionBid) / executionBid) * 100
    : null;
  const executionTimestamp = analysisTimestamp;

  // Compute drop metrics from HWM
  let currentDropPct: number | null = null;
  let macroZone: MacroZone | null = null;
  let cycleLow: number | null = null;
  let maxDropPct: number | null = null;
  let reboundFromLowPct: number | null = null;
  let daysSinceCeiling: number | null = null;
  let daysSinceLow: number | null = null;

  if (hwm !== null && hwm > 0) {
    currentDropPct = ((hwm - analysisPrice) / hwm) * 100;
    if (currentDropPct < 0) currentDropPct = 0; // price above HWM = no drop
    macroZone = getZoneFromDropPct(currentDropPct);

    if (hwmTimestamp) {
      const hwmDate = new Date(hwmTimestamp);
      daysSinceCeiling = Math.floor((Date.now() - hwmDate.getTime()) / (1000 * 60 * 60 * 24));
    }
  }

  // Compute cycle low and max drop from daily candles
  if (candles1d.length > 0) {
    const lows = candles1d.map(c => c.low);
    cycleLow = Math.min(...lows);
    if (hwm !== null && hwm > 0 && cycleLow > 0) {
      maxDropPct = ((hwm - cycleLow) / hwm) * 100;
    }
    if (cycleLow > 0 && analysisPrice > cycleLow) {
      reboundFromLowPct = ((analysisPrice - cycleLow) / cycleLow) * 100;
    }
    // Find the candle with the lowest low for daysSinceLow
    const lowCandle = candles1d.reduce((min, c) => c.low < min.low ? c : min, candles1d[0]);
    if (lowCandle?.time) {
      const lowDate = new Date(lowCandle.time * 1000);
      daysSinceLow = Math.floor((Date.now() - lowDate.getTime()) / (1000 * 60 * 60 * 24));
    }
  }

  // Determine data quality
  let dataQuality: DataQualityState = "FRESH";
  if (!hwm) {
    dataQuality = "STALE";
  }
  if (candles1d.length < 7) {
    dataQuality = "STALE";
  }

  return {
    pair,
    analysisPrice,
    analysisTimestamp,
    executionBid,
    executionAsk,
    executionMid,
    spreadPct,
    crossVenueBasisPct: null, // single venue, no cross-venue basis
    executionTimestamp,
    highWaterMark: hwm,
    cycleLow,
    currentDropPct,
    maxDropPct,
    reboundFromLowPct,
    macroZone,
    daysSinceCeiling,
    daysSinceLow,
    dataQuality,
  };
}

/**
 * Execute HWM bootstrap: fetch historical daily candles, compute HWM, persist.
 */
export async function executeHwmBootstrap(
  pair: string = AMA_PAIR,
  candleCount: number = 200,
): Promise<{ hwm: number; hwmTimestamp: string; candlesProcessed: number }> {
  // Start bootstrap
  await amaHwmBootstrapService.startBootstrap(pair, candleCount);

  try {
    // Fetch daily candles from MarketDataService (Kraken public)
    const candles = await MarketDataService.getCandles(pair, "1d" as Timeframe);

    if (!candles || candles.length === 0) {
      await amaHwmBootstrapService.failBootstrap("No candles returned from MarketDataService");
      throw new Error("[AMA] HWM bootstrap failed: no candles returned");
    }

    // Sort by time ascending (oldest first)
    const sorted = [...candles].sort((a, b) => a.time - b.time);

    // Filter to closed candles only (exclude the last one if it's the current forming candle)
    const closedCandles = sorted.slice(0, -1);

    if (closedCandles.length < 7) {
      await amaHwmBootstrapService.failBootstrap(
        `Insufficient closed candles: ${closedCandles.length}`,
      );
      throw new Error(`[AMA] HWM bootstrap failed: only ${closedCandles.length} closed candles`);
    }

    // Compute HWM = highest high among closed candles
    let hwm = 0;
    let hwmTimestamp = "";
    let processed = 0;

    for (const candle of closedCandles) {
      processed++;
      if (candle.high > hwm) {
        hwm = candle.high;
        hwmTimestamp = new Date(candle.time * 1000).toISOString();
      }
      // Update progress periodically
      if (processed % 50 === 0 || processed === closedCandles.length) {
        await amaHwmBootstrapService.updateProgress(processed, hwm);
      }
    }

    if (hwm <= 0) {
      await amaHwmBootstrapService.failBootstrap("Computed HWM is zero or negative");
      throw new Error("[AMA] HWM bootstrap failed: invalid HWM");
    }

    // Complete bootstrap
    await amaHwmBootstrapService.completeBootstrap(hwm, hwmTimestamp);

    return { hwm, hwmTimestamp, candlesProcessed: processed };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    await amaHwmBootstrapService.failBootstrap(msg);
    throw error;
  }
}
