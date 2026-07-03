/**
 * GridBacktest — Robust backtesting engine for Grid Isolated.
 *
 * Features:
 *   - No lookahead bias (strictly processes candles in chronological order)
 *   - Multiple variants tested simultaneously
 *   - 3 fill models: optimistic (fill at touch), realistic (fill at close),
 *     pessimistic (fill at close + slippage)
 *   - Computes: total cycles, net PnL, max drawdown, Sharpe ratio,
 *     average cycle time, best/worst cycle
 *
 * Uses MarketDataService to fetch historical candles.
 * Does NOT place real orders — pure simulation.
 */

import { MarketDataService } from "../MarketDataService";
import { calculateBollingerBands, calculateATR, calculateATRPercent, type PriceData } from "../indicators";
import { generateGeometricLevels } from "./gridGeometricLevels";
import { computeGrossTargetFromNet, computeCyclePnL } from "./gridNetCalculator";
import { botLogger } from "../botLogger";
import type {
  GridBacktestConfig,
  GridBacktestResult,
  GridBacktestVariant,
  CapitalProfile,
} from "./gridIsolatedTypes";
import { CAPITAL_PROFILES } from "./gridIsolatedTypes";

interface SimLevel {
  side: "BUY" | "SELL";
  price: number;
  notionalUsd: number;
  quantity: number;
  filled: boolean;
  filledPrice: number;
  filledAtIdx: number;
}

interface SimCycle {
  buyPrice: number;
  buyIdx: number;
  sellPrice: number | null;
  sellIdx: number | null;
  quantity: number;
  status: "open" | "completed" | "stop_loss";
  pnl: ReturnType<typeof computeCyclePnL> | null;
}

class GridBacktestEngine {
  /**
   * Run a full backtest with multiple variants.
   */
  async runBacktest(config: GridBacktestConfig): Promise<GridBacktestResult[]> {
    await botLogger.info("GRID_BACKTEST_STARTED", `Backtest started: ${config.pair} ${config.startDate.toISOString()} → ${config.endDate.toISOString()}`, {
      pair: config.pair, variants: config.variants.length, fillModel: config.fillModel,
    });

    // Fetch candles
    const candles = await MarketDataService.getCandles(config.pair, config.timeframe as any);
    if (!candles || candles.length < 50) {
      throw new Error("Insufficient candle data for backtest");
    }

    // Filter to date range
    const startMs = config.startDate.getTime();
    const endMs = config.endDate.getTime();
    const filteredCandles = candles.filter(c => c.time * 1000 >= startMs && c.time * 1000 <= endMs);

    if (filteredCandles.length < 50) {
      throw new Error("Insufficient candles in date range");
    }

    const results: GridBacktestResult[] = [];

    for (const variant of config.variants) {
      const result = this.runVariant(variant, filteredCandles, config);
      results.push(result);
    }

    await botLogger.info("GRID_BACKTEST_COMPLETED", `Backtest completed: ${results.length} variants`, {
      results: results.map(r => ({ label: r.variantLabel, netPnl: r.totalNetPnlUsd, cycles: r.completedCycles })),
    });

    return results;
  }

  /**
   * Run a single variant through the candle data.
   */
  private runVariant(
    variant: GridBacktestVariant,
    candles: any[],
    config: GridBacktestConfig
  ): GridBacktestResult {
    const profile = CAPITAL_PROFILES[variant.capitalProfile];
    const capitalPerLevel = Math.min(
      profile.maxNotionalPerLevelUsd,
      Math.max(profile.minNotionalPerLevelUsd, config.initialCapitalUsd / 10)
    );

    const cycles: SimCycle[] = [];
    let currentLevels: SimLevel[] = [];
    let capitalUsed = 0;
    const equity: number[] = [config.initialCapitalUsd];

    // Process candles chronologically
    for (let i = 50; i < candles.length; i++) {
      const window = candles.slice(Math.max(0, i - variant.bandPeriod), i + 1);
      const prices = window.map(c => c.close);
      const priceData: PriceData[] = window.map(c => ({
        price: c.close,
        timestamp: c.time,
        high: c.high,
        low: c.low,
        volume: c.volume,
      }));

      // Compute bands every candle
      const bands = calculateBollingerBands(prices, variant.bandPeriod, 2);
      const atrPct = calculateATRPercent(priceData, 14);
      const currentPrice = candles[i].close;

      // Regenerate levels if none or range shifted significantly
      if (currentLevels.length === 0 || this.shouldRegenerateLevels(currentLevels, bands, currentPrice)) {
        currentLevels = this.generateSimLevels(
          currentPrice,
          bands.upper,
          bands.lower,
          atrPct,
          variant,
          capitalPerLevel
        );
      }

      // Check fills
      const fillPrice = this.getFillPrice(candles[i], config.fillModel);

      for (const level of currentLevels) {
        if (level.filled) continue;

        if (level.side === "BUY" && fillPrice <= level.price) {
          level.filled = true;
          level.filledPrice = fillPrice;
          level.filledAtIdx = i;

          // Create new cycle
          cycles.push({
            buyPrice: fillPrice,
            buyIdx: i,
            sellPrice: null,
            sellIdx: null,
            quantity: level.quantity,
            status: "open",
            pnl: null,
          });

          capitalUsed += level.notionalUsd;
        } else if (level.side === "SELL") {
          // Find oldest open cycle
          const openCycle = cycles.find(c => c.status === "open");
          if (openCycle && fillPrice >= level.price) {
            level.filled = true;
            level.filledPrice = fillPrice;
            level.filledAtIdx = i;

            openCycle.sellPrice = fillPrice;
            openCycle.sellIdx = i;
            openCycle.status = "completed";
            openCycle.pnl = computeCyclePnL(openCycle.buyPrice, fillPrice, openCycle.quantity);

            capitalUsed -= level.notionalUsd;
          }
        }
      }

      // Check stop losses for open cycles
      for (const cycle of cycles) {
        if (cycle.status !== "open") continue;

        const lossPct = ((currentPrice - cycle.buyPrice) / cycle.buyPrice) * 100;
        if (lossPct <= -5.0) { // hard stop at 5%
          cycle.sellPrice = currentPrice;
          cycle.sellIdx = i;
          cycle.status = "stop_loss";
          cycle.pnl = computeCyclePnL(cycle.buyPrice, currentPrice, cycle.quantity);
          capitalUsed -= cycle.buyPrice * cycle.quantity;
        }
      }

      // Track equity
      const openEquity = cycles
        .filter(c => c.status === "open")
        .reduce((sum, c) => sum + (currentPrice - c.buyPrice) * c.quantity, 0);
      const realizedEquity = cycles
        .filter(c => c.status === "completed" || c.status === "stop_loss")
        .reduce((sum, c) => sum + (c.pnl?.netPnlUsd || 0), 0);
      equity.push(config.initialCapitalUsd + realizedEquity + openEquity);
    }

    // Close any remaining open cycles at last price
    const lastPrice = candles[candles.length - 1].close;
    for (const cycle of cycles) {
      if (cycle.status === "open") {
        cycle.sellPrice = lastPrice;
        cycle.sellIdx = candles.length - 1;
        cycle.status = "completed";
        cycle.pnl = computeCyclePnL(cycle.buyPrice, lastPrice, cycle.quantity);
      }
    }

    return this.computeResult(variant.label, cycles, equity, config.initialCapitalUsd, candles.length);
  }

  /**
   * Determine if levels should be regenerated (range shifted).
   */
  private shouldRegenerateLevels(levels: SimLevel[], bands: any, currentPrice: number): boolean {
    if (levels.length === 0) return true;
    const allFilled = levels.every(l => l.filled);
    if (allFilled) return true;
    // Regenerate if price moved outside the band
    const maxBuyPrice = Math.max(...levels.filter(l => l.side === "BUY" && !l.filled).map(l => l.price));
    const minSellPrice = Math.min(...levels.filter(l => l.side === "SELL" && !l.filled).map(l => l.price));
    if (currentPrice > maxBuyPrice * 1.05 || currentPrice < minSellPrice * 0.95) return true;
    return false;
  }

  /**
   * Generate simulation levels.
   */
  private generateSimLevels(
    midPrice: number,
    bandUpper: number,
    bandLower: number,
    atrPct: number,
    variant: GridBacktestVariant,
    capitalPerLevel: number
  ): SimLevel[] {
    const bandWidthPct = ((bandUpper - bandLower) / midPrice) * 100;
    const generated = generateGeometricLevels({
      midPrice,
      bandUpper,
      bandLower,
      atrPct,
      bandWidthPct,
      netProfitTargetPct: variant.netProfitTargetPct,
      gridStepAtrMultiplier: variant.gridStepAtrMultiplier,
      gridStepMinPct: 0.15,
      gridStepMaxPct: 3.0,
      geometricRatioMin: 0.8,
      geometricRatioMax: 1.2,
      capitalPerLevelUsd: capitalPerLevel,
      maxLevels: 10,
    });

    return generated.map(g => ({
      side: g.side,
      price: g.price,
      notionalUsd: g.notionalUsd,
      quantity: g.quantity,
      filled: false,
      filledPrice: 0,
      filledAtIdx: -1,
    }));
  }

  /**
   * Get fill price based on fill model.
   */
  private getFillPrice(candle: any, fillModel: string): number {
    switch (fillModel) {
      case "optimistic":
        // Fill at the best price of the candle (touch)
        return candle.low; // For buys, assume fill at low
      case "pessimistic":
        // Fill at close + slippage
        return candle.close * 1.001; // 0.1% slippage
      case "realistic":
      default:
        return candle.close;
    }
  }

  /**
   * Compute backtest result from cycles.
   */
  private computeResult(
    label: string,
    cycles: SimCycle[],
    equity: number[],
    initialCapital: number,
    candleCount: number
  ): GridBacktestResult {
    const completed = cycles.filter(c => c.status === "completed");
    const stopLossed = cycles.filter(c => c.status === "stop_loss");

    const totalNetPnl = cycles.reduce((sum, c) => sum + (c.pnl?.netPnlUsd || 0), 0);
    const totalFees = cycles.reduce((sum, c) => sum + (c.pnl?.totalFeesUsd || 0), 0);
    const totalTaxReserve = cycles.reduce((sum, c) => sum + (c.pnl?.taxReserveUsd || 0), 0);

    // Max drawdown
    let maxPeak = equity[0];
    let maxDrawdown = 0;
    for (const e of equity) {
      if (e > maxPeak) maxPeak = e;
      const dd = ((maxPeak - e) / maxPeak) * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    // Sharpe ratio (simplified — using equity changes)
    const returns: number[] = [];
    for (let i = 1; i < equity.length; i++) {
      returns.push((equity[i] - equity[i - 1]) / equity[i - 1]);
    }
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length || 0;
    const stdReturn = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length || 0
    );
    const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(365) : 0;

    // Cycle times
    const cycleTimes = cycles
      .filter(c => c.sellIdx !== null)
      .map(c => c.sellIdx! - c.buyIdx);
    const avgCycleTime = cycleTimes.length > 0
      ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length
      : 0;

    // Best/worst cycles
    const pnls = cycles.map(c => c.pnl?.netPnlUsd || 0);
    const bestCycle = pnls.length > 0 ? Math.max(...pnls) : 0;
    const worstCycle = pnls.length > 0 ? Math.min(...pnls) : 0;

    // Cycles per day (assuming 1h candles)
    const days = candleCount / 24;
    const cyclesPerDay = days > 0 ? cycles.length / days : 0;

    return {
      variantLabel: label,
      totalCycles: cycles.length,
      completedCycles: completed.length,
      stopLossCycles: stopLossed.length,
      trailingCycles: 0,
      hodlCycles: 0,
      totalNetPnlUsd: totalNetPnl,
      totalFeesUsd: totalFees,
      totalTaxReserveUsd: totalTaxReserve,
      maxDrawdownPct: maxDrawdown,
      sharpeRatio,
      averageCycleTimeMinutes: avgCycleTime * 60, // assuming 1h candles
      bestCyclePnlUsd: bestCycle,
      worstCyclePnlUsd: worstCycle,
      cyclesPerDay,
      finalCapitalUsd: initialCapital + totalNetPnl,
    };
  }
}

export const gridBacktestEngine = new GridBacktestEngine();
