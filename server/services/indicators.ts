/**
 * Technical Indicators — Pure functions extracted from TradingEngine.
 * No side effects, no dependencies. Used by TradingEngine, RegimeManager, etc.
 */

// === Types ===

export interface PriceData {
  price: number;
  timestamp: number;
  high: number;
  low: number;
  volume: number;
}

export interface OHLCCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// === EMA ===

export function calculateEMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  const multiplier = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  return ema;
}

// === RSI ===

export function calculateRSI(prices: number[]): number {
  if (prices.length < 2) return 50;

  let gains = 0, losses = 0;
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / (prices.length - 1);
  const avgLoss = losses / (prices.length - 1);

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// === Volatility (CV%) ===

export function calculateVolatility(prices: number[]): number {
  if (prices.length < 2) return 0;
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
  return (Math.sqrt(variance) / mean) * 100;
}

// === MACD ===

export function calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
  if (prices.length < 26) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  const ema12 = calculateEMA(prices.slice(-12), 12);
  const ema26 = calculateEMA(prices.slice(-26), 26);
  const macd = ema12 - ema26;

  const macdHistory: number[] = [];
  for (let i = 26; i <= prices.length; i++) {
    const e12 = calculateEMA(prices.slice(i - 12, i), 12);
    const e26 = calculateEMA(prices.slice(i - 26, i), 26);
    macdHistory.push(e12 - e26);
  }

  const signal = macdHistory.length >= 9 ? calculateEMA(macdHistory.slice(-9), 9) : 0;
  const histogram = macd - signal;

  return { macd, signal, histogram };
}

// === Bollinger Bands ===

export function calculateBollingerBands(
  prices: number[],
  period: number = 20,
  stdDevMultiplier: number = 2
): { upper: number; middle: number; lower: number; percentB: number } {
  if (prices.length < period) {
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    return { upper: avg, middle: avg, lower: avg, percentB: 50 };
  }

  const recentPrices = prices.slice(-period);
  const middle = recentPrices.reduce((a, b) => a + b, 0) / period;
  const stdDev = Math.sqrt(
    recentPrices.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period
  );

  const upper = middle + (stdDevMultiplier * stdDev);
  const lower = middle - (stdDevMultiplier * stdDev);
  const currentPrice = prices[prices.length - 1];
  const percentB = ((currentPrice - lower) / (upper - lower)) * 100;

  return { upper, middle, lower, percentB };
}

// === ATR (Average True Range) ===

export function calculateATR(history: PriceData[], period: number = 14): number {
  if (history.length < period + 1) {
    return 0;
  }

  const trueRanges: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const current = history[i];
    const previous = history[i - 1];

    const tr1 = current.high - current.low;
    const tr2 = Math.abs(current.high - previous.price);
    const tr3 = Math.abs(current.low - previous.price);

    const trueRange = Math.max(tr1, tr2, tr3);
    trueRanges.push(trueRange);
  }

  const recentTRs = trueRanges.slice(-period);
  const atr = recentTRs.reduce((a, b) => a + b, 0) / recentTRs.length;

  return atr;
}

export function calculateATRPercent(history: PriceData[], period: number = 14): number {
  const atr = calculateATR(history, period);
  if (history.length === 0 || atr === 0) return 0;

  const currentPrice = history[history.length - 1].price;
  return (atr / currentPrice) * 100;
}

// === Abnormal Volume Detection ===

export function detectAbnormalVolume(history: PriceData[]): { isAbnormal: boolean; ratio: number; direction: string } {
  if (history.length < 10) {
    return { isAbnormal: false, ratio: 1, direction: "neutral" };
  }

  const volumes = history.map(h => h.volume);
  const currentVolume = volumes[volumes.length - 1];
  const avgVolume = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1);

  if (avgVolume <= 0 || !isFinite(avgVolume) || currentVolume <= 0) {
    return { isAbnormal: false, ratio: 1, direction: "neutral" };
  }

  const ratio = currentVolume / avgVolume;

  if (!isFinite(ratio) || isNaN(ratio)) {
    return { isAbnormal: false, ratio: 1, direction: "neutral" };
  }

  const isAbnormal = ratio > 2.0 || ratio < 0.3;

  const priceChange = (history[history.length - 1].price - history[history.length - 2].price);
  const direction = priceChange > 0 ? "bullish" : priceChange < 0 ? "bearish" : "neutral";

  return { isAbnormal, ratio, direction };
}

// === Wilder's Smoothing (for ADX) ===

export function wilderSmooth(values: number[], period: number): number[] {
  if (values.length < period) return [];

  const result: number[] = [];
  // First value is simple sum of first N periods
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  result.push(sum);

  // Subsequent values use Wilder's smoothing: prev - (prev/N) + current
  for (let i = period; i < values.length; i++) {
    const smoothed = result[result.length - 1] - (result[result.length - 1] / period) + values[i];
    result.push(smoothed);
  }

  return result;
}

// === ADX (Average Directional Index) ===

export function calculateADX(candles: OHLCCandle[], period: number = 14): number {
  // Require enough candles for proper ADX calculation (need 2*period for ADX smoothing)
  if (!candles || candles.length < period * 2 + 1) return 25; // Default neutral value

  try {
    const dmPlus: number[] = [];
    const dmMinus: number[] = [];
    const trueRanges: number[] = [];

    // Calculate DM and TR for each period (starts at index 1)
    for (let i = 1; i < candles.length; i++) {
      const current = candles[i];
      const prev = candles[i - 1];

      // Validate candle data
      if (!current || !prev ||
          typeof current.high !== 'number' || typeof current.low !== 'number' ||
          typeof prev.high !== 'number' || typeof prev.low !== 'number' ||
          typeof prev.close !== 'number' ||
          !isFinite(current.high) || !isFinite(current.low) ||
          !isFinite(prev.high) || !isFinite(prev.low) || !isFinite(prev.close)) {
        // Push zeros to maintain array alignment
        dmPlus.push(0);
        dmMinus.push(0);
        trueRanges.push(0);
        continue;
      }

      const highDiff = current.high - prev.high;
      const lowDiff = prev.low - current.low;

      // +DM: higher high movement (only if > lower low movement and > 0)
      // -DM: lower low movement (only if > higher high movement and > 0)
      const plusDM = (highDiff > lowDiff && highDiff > 0) ? highDiff : 0;
      const minusDM = (lowDiff > highDiff && lowDiff > 0) ? lowDiff : 0;
      dmPlus.push(plusDM);
      dmMinus.push(minusDM);

      // True Range: max of (H-L, |H-prevC|, |L-prevC|)
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - prev.close),
        Math.abs(current.low - prev.close)
      );
      trueRanges.push(isFinite(tr) ? tr : 0);
    }

    if (trueRanges.length < period * 2) return 25;

    // Apply Wilder's smoothing to TR, +DM, -DM
    const smoothedTR = wilderSmooth(trueRanges, period);
    const smoothedDMPlus = wilderSmooth(dmPlus, period);
    const smoothedDMMinus = wilderSmooth(dmMinus, period);

    if (smoothedTR.length < period || smoothedDMPlus.length < period || smoothedDMMinus.length < period) {
      return 25;
    }

    // Calculate DI+ and DI- for each smoothed period, then DX
    const dxValues: number[] = [];
    for (let i = 0; i < smoothedTR.length; i++) {
      const tr = smoothedTR[i];
      if (tr <= 0 || !isFinite(tr)) continue;

      const diPlus = (smoothedDMPlus[i] / tr) * 100;
      const diMinus = (smoothedDMMinus[i] / tr) * 100;

      if (!isFinite(diPlus) || !isFinite(diMinus)) continue;

      const diSum = diPlus + diMinus;
      if (diSum <= 0) continue;

      const dx = (Math.abs(diPlus - diMinus) / diSum) * 100;
      if (isFinite(dx)) {
        dxValues.push(dx);
      }
    }

    if (dxValues.length < period) return 25;

    // ADX is Wilder-smoothed DX
    const adxSmoothed = wilderSmooth(dxValues, period);
    if (adxSmoothed.length === 0) return 25;

    // Return the latest ADX value, divided by period since Wilder stores sums
    const rawAdx = adxSmoothed[adxSmoothed.length - 1] / period;

    if (!isFinite(rawAdx)) return 25;

    return Math.min(100, Math.max(0, rawAdx));
  } catch (error) {
    return 25; // Safe default on any error
  }
}
