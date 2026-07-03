/**
 * GridBandAdapter — Adapts existing Bollinger Bands and ATR from indicators.ts
 * to the Grid Isolated Engine's needs.
 *
 * This module does NOT re-calculate Bollinger Bands or ATR.
 * It wraps the existing functions from indicators.ts and adds
 * grid-specific interpretation (band width, regime suitability,
 * mid-price anchoring, range bounds).
 *
 * Market data is sourced from MarketDataService (central, Kraken).
 */

import { MarketDataService } from "../MarketDataService";
import { calculateBollingerBands, calculateATR, calculateATRPercent, type PriceData } from "../indicators";

export interface GridBandSnapshot {
  upper: number;
  middle: number;
  lower: number;
  percentB: number;
  bandWidthPct: number;
  atrPct: number;
  atr: number;
  midPrice: number;
  regime: string;
  suitableForGrid: boolean;
  reason: string;
}

export interface GridBandConfig {
  bandPeriod: number;
  bandStdDevMultiplier: number;
  atrPeriod: number;
  atrTimeframe: string;
  pair: string;
}

/**
 * Fetch candles from MarketDataService and compute a Grid Band Snapshot.
 * Uses the central market data cache — no duplicate API calls.
 */
export async function getGridBandSnapshot(config: GridBandConfig): Promise<GridBandSnapshot | null> {
  try {
    const candles = await MarketDataService.getCandles(config.pair, config.atrTimeframe as any);
    if (!candles || candles.length < Math.max(config.bandPeriod, config.atrPeriod + 1)) {
      return null;
    }

    const prices = candles.map(c => c.close);
    const priceData: PriceData[] = candles.map(c => ({
      price: c.close,
      timestamp: c.time,
      high: c.high,
      low: c.low,
      volume: c.volume,
    }));

    const bands = calculateBollingerBands(prices, config.bandPeriod, config.bandStdDevMultiplier);
    const atr = calculateATR(priceData, config.atrPeriod);
    const atrPct = calculateATRPercent(priceData, config.atrPeriod);

    const midPrice = prices[prices.length - 1];
    const bandWidthPct = bands.middle > 0
      ? ((bands.upper - bands.lower) / bands.middle) * 100
      : 0;

    // Determine regime suitability for grid
    const { regime, suitableForGrid, reason } = assessGridSuitability(
      bandWidthPct,
      atrPct,
      bands.percentB
    );

    return {
      upper: bands.upper,
      middle: bands.middle,
      lower: bands.lower,
      percentB: bands.percentB,
      bandWidthPct,
      atrPct,
      atr,
      midPrice,
      regime,
      suitableForGrid,
      reason,
    };
  } catch (error) {
    console.error("[GridBandAdapter] Error fetching band snapshot:", error);
    return null;
  }
}

/**
 * Assess whether current market conditions are suitable for grid trading.
 * Grid works best in ranging/sideways markets with moderate volatility.
 */
function assessGridSuitability(
  bandWidthPct: number,
  atrPct: number,
  percentB: number
): { regime: string; suitableForGrid: boolean; reason: string } {
  // Too narrow = low volatility, grid profits too small
  if (bandWidthPct < 1.0) {
    return {
      regime: "compressed",
      suitableForGrid: false,
      reason: "Bandas demasiado comprimidas — volatilidad insuficiente para grid",
    };
  }

  // Too wide = high volatility, grid risk too high
  if (bandWidthPct > 15.0) {
    return {
      regime: "high_volatility",
      suitableForGrid: false,
      reason: "Bandas demasiado anchas — volatilidad excesiva para grid",
    };
  }

  // Strong trend (percentB > 90 or < 10) = not suitable for grid
  if (percentB > 90) {
    return {
      regime: "strong_uptrend",
      suitableForGrid: false,
      reason: "Precio en banda superior — tendencia alcista fuerte, grid arriesgado",
    };
  }

  if (percentB < 10) {
    return {
      regime: "strong_downtrend",
      suitableForGrid: false,
      reason: "Precio en banda inferior — tendencia bajista fuerte, grid arriesgado",
    };
  }

  // ATR too high relative to price
  if (atrPct > 5.0) {
    return {
      regime: "high_volatility",
      suitableForGrid: false,
      reason: "ATR% demasiado alto — volatilidad excesiva",
    };
  }

  // Good range for grid
  if (bandWidthPct >= 2.0 && bandWidthPct <= 10.0 && atrPct >= 0.5 && atrPct <= 3.0) {
    return {
      regime: "ranging",
      suitableForGrid: true,
      reason: "Régimen lateral ideal para grid trading",
    };
  }

  // Moderate conditions — grid possible but with caution
  return {
    regime: "moderate",
    suitableForGrid: true,
    reason: "Condiciones moderadas — grid viable con vigilancia",
  };
}
