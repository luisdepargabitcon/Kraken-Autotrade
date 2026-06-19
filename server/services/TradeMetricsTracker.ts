/**
 * TradeMetricsTracker — Phase 5
 *
 * Samples MFE/MAE/drawdown every 5 minutes for open BOT SPOT positions.
 * IDCA cycles are tracked separately via onIdcaSample().
 * Scheduler is started once from server/routes.ts, non-blocking on failures.
 * Retention: 30 days by default.
 */

import { storage } from "../storage";
import type { InsertTradeMetric } from "@shared/schema";

const SAMPLE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const RETENTION_DAYS     = 30;

// In-memory peak tracking per open lot (cleared on close)
interface MfeMaeState {
  highPriceSeen: number;
  lowPriceSeen:  number;
  mfePct:        number;  // max favorable
  maePct:        number;  // max adverse (negative = loss)
  maxDrawdownPct: number;
  timePositiveMinutes: number;
  timeNegativeMinutes: number;
  trailingActivated: boolean;
}

class TradeMetricsTracker {
  private static instance: TradeMetricsTracker;
  private states: Map<string, MfeMaeState> = new Map(); // key = `${sourceMode}::${sourceTradeId}`
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

  static getInstance(): TradeMetricsTracker {
    if (!TradeMetricsTracker.instance) {
      TradeMetricsTracker.instance = new TradeMetricsTracker();
    }
    return TradeMetricsTracker.instance;
  }

  /**
   * Called from routes.ts on startup.
   * The `getOpenPositions` callback provides current price per lot.
   */
  startScheduler(
    getOpenSamples: () => Promise<Array<{
      sourceMode:    string;
      strategyType:  string;
      sourceTradeId: string;
      pair:          string;
      entryPrice:    number;
      currentPrice:  number;
      trailingActivated?: boolean;
    }>>
  ): void {
    if (this.intervalId) return; // Already running

    this.intervalId = setInterval(() => {
      this._tick(getOpenSamples).catch(e =>
        console.warn(`[metrics-tracker] tick error (non-critical): ${e?.message}`)
      );
    }, SAMPLE_INTERVAL_MS);

    // Daily cleanup
    this.cleanupIntervalId = setInterval(() => {
      storage.cleanupTradeMetrics(RETENTION_DAYS).catch(() => {});
    }, 24 * 60 * 60 * 1000);

    console.log("[metrics-tracker] MFE/MAE scheduler started (5min interval)");
  }

  stopScheduler(): void {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    if (this.cleanupIntervalId) { clearInterval(this.cleanupIntervalId); this.cleanupIntervalId = null; }
  }

  /** Record a sample from IDCA engine (called manually from IdcaEngine). */
  onIdcaSample(params: {
    sourceMode:    string;
    sourceTradeId: string;
    pair:          string;
    entryPrice:    number;
    currentPrice:  number;
    trailingActivated?: boolean;
  }): void {
    const key = `${params.sourceMode}::${params.sourceTradeId}`;
    const state = this._updateState(key, params.entryPrice, params.currentPrice, params.trailingActivated ?? false);
    const metric: InsertTradeMetric = {
      sourceMode:          params.sourceMode,
      strategyType:        "IDCA",
      sourceTradeId:       params.sourceTradeId,
      pair:                params.pair,
      entryPrice:          params.entryPrice.toFixed(8),
      currentPrice:        params.currentPrice.toFixed(8),
      floatingPnlUsd:      null,
      floatingPnlPct:      ((params.currentPrice - params.entryPrice) / params.entryPrice * 100).toFixed(4),
      mfePct:              state.mfePct.toFixed(4),
      maePct:              state.maePct.toFixed(4),
      maxDrawdownPct:      state.maxDrawdownPct.toFixed(4),
      highPriceSeen:       state.highPriceSeen.toFixed(8),
      lowPriceSeen:        state.lowPriceSeen.toFixed(8),
      trailingActivated:   state.trailingActivated,
      timePositiveMinutes: state.timePositiveMinutes,
      timeNegativeMinutes: state.timeNegativeMinutes,
    };
    storage.saveTradeMetric(metric).catch(() => {});
  }

  /** Erase state for a closed trade/cycle. */
  onClose(sourceMode: string, sourceTradeId: string): void {
    this.states.delete(`${sourceMode}::${sourceTradeId}`);
  }

  private async _tick(
    getOpenSamples: () => Promise<Array<{
      sourceMode: string; strategyType: string; sourceTradeId: string;
      pair: string; entryPrice: number; currentPrice: number; trailingActivated?: boolean;
    }>>
  ): Promise<void> {
    const samples = await getOpenSamples();
    for (const s of samples) {
      const key = `${s.sourceMode}::${s.sourceTradeId}`;
      const state = this._updateState(key, s.entryPrice, s.currentPrice, s.trailingActivated ?? false);
      const floatingPct = (s.currentPrice - s.entryPrice) / s.entryPrice * 100;
      const metric: InsertTradeMetric = {
        sourceMode:          s.sourceMode,
        strategyType:        s.strategyType,
        sourceTradeId:       s.sourceTradeId,
        pair:                s.pair,
        entryPrice:          s.entryPrice.toFixed(8),
        currentPrice:        s.currentPrice.toFixed(8),
        floatingPnlUsd:      null,
        floatingPnlPct:      floatingPct.toFixed(4),
        mfePct:              state.mfePct.toFixed(4),
        maePct:              state.maePct.toFixed(4),
        maxDrawdownPct:      state.maxDrawdownPct.toFixed(4),
        highPriceSeen:       state.highPriceSeen.toFixed(8),
        lowPriceSeen:        state.lowPriceSeen.toFixed(8),
        trailingActivated:   state.trailingActivated,
        timePositiveMinutes: state.timePositiveMinutes,
        timeNegativeMinutes: state.timeNegativeMinutes,
      };
      await storage.saveTradeMetric(metric);
    }
  }

  private _updateState(key: string, entryPrice: number, currentPrice: number, trailingActivated: boolean): MfeMaeState {
    let s = this.states.get(key);
    if (!s) {
      s = {
        highPriceSeen:       currentPrice,
        lowPriceSeen:        currentPrice,
        mfePct:              0,
        maePct:              0,
        maxDrawdownPct:      0,
        timePositiveMinutes: 0,
        timeNegativeMinutes: 0,
        trailingActivated,
      };
    }

    s.highPriceSeen = Math.max(s.highPriceSeen, currentPrice);
    s.lowPriceSeen  = Math.min(s.lowPriceSeen,  currentPrice);

    const fromEntryPct  = (currentPrice - entryPrice)        / entryPrice * 100;
    const fromLowPct    = (s.highPriceSeen - s.lowPriceSeen)  / s.highPriceSeen * 100;

    s.mfePct         = Math.max(s.mfePct,  (s.highPriceSeen - entryPrice) / entryPrice * 100);
    s.maePct         = Math.min(s.maePct,  (s.lowPriceSeen  - entryPrice) / entryPrice * 100);
    s.maxDrawdownPct = Math.max(s.maxDrawdownPct, fromLowPct);

    if (fromEntryPct > 0) s.timePositiveMinutes += 5;
    else                   s.timeNegativeMinutes += 5;

    s.trailingActivated = trailingActivated || s.trailingActivated;
    this.states.set(key, s);
    return s;
  }
}


export const tradeMetricsTracker = TradeMetricsTracker.getInstance();
