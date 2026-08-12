/**
 * SpotRegimeEngine — Unified regime context for SPOT.
 *
 * PROBLEM (FASE 1 audit):
 *   Two regime vocabularies exist:
 *     A: TREND/RANGE/TRANSITION (regimeDetection.ts:12) — entry
 *     B: TREND/CHOP/VOLATILE (SmartExitEngine.ts:25) — exit
 *   No mapping layer. Entry and Exit compute regime independently.
 *
 * SOLUTION:
 *   SpotRegimeEngine produces a SINGLE SpotRegimeContext with:
 *     - regime: TREND | RANGE | TRANSITION (vocabulary A, kept as canonical)
 *     - direction: BULLISH | BEARISH | NEUTRAL
 *     - volatility: LOW | NORMAL | HIGH
 *     - macroBias: BULLISH | BEARISH | NEUTRAL (from 4h)
 *   Both Entry and Exit consume the SAME context (same regimeId/contextId).
 *
 * INVARIANT: SpotExitPolicy MUST NOT create its own regime.
 */

import {
  calculateEMA,
  calculateADX,
  calculateBollingerBands,
  calculateATR,
  type OHLCCandle,
  type PriceData,
} from "../indicators";
import { detectMarketRegime, type MarketRegime } from "../regimeDetection";
import { normalizeCandleTimestampMs, DataHealth } from "./candleTimestamp";
import {
  Regime,
  RegimeDirection,
  VolatilityLevel,
  MacroBias,
  type SpotRegimeContext,
  type SpotCandle,
} from "./spotTypes";

// ─── Helpers ────────────────────────────────────────────────────────────────

function toSpotCandles(candles: OHLCCandle[]): SpotCandle[] {
  return candles
    .map((c) => {
      const ms = normalizeCandleTimestampMs(c.time);
      if (ms === null) return null;
      return { time: ms, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
    })
    .filter((c): c is SpotCandle => c !== null);
}

function mapRegime(r: MarketRegime): Regime {
  if (r === "TREND") return Regime.TREND;
  if (r === "RANGE") return Regime.RANGE;
  return Regime.TRANSITION;
}

function deriveDirection(
  currentPrice: number,
  ema20: number,
  ema50: number,
  ema200: number,
  emaAlignment: number,
): RegimeDirection {
  if (emaAlignment > 0.5 && currentPrice > ema50) return RegimeDirection.BULLISH;
  if (emaAlignment < -0.5 && currentPrice < ema50) return RegimeDirection.BEARISH;
  return RegimeDirection.NEUTRAL;
}

function deriveVolatility(atrPct: number, bollingerWidth: number): VolatilityLevel {
  // atrPct = ATR / price × 100
  // Combined with Bollinger width for robustness
  const combined = (atrPct + bollingerWidth) / 2;
  if (combined < 1.5) return VolatilityLevel.LOW;
  if (combined > 4.0) return VolatilityLevel.HIGH;
  return VolatilityLevel.NORMAL;
}

function deriveMacroBias(
  candles4h: SpotCandle[],
): { bias: MacroBias; ema50: number; ema200: number; price: number } {
  if (candles4h.length < 50) {
    return { bias: MacroBias.NEUTRAL, ema50: 0, ema200: 0, price: 0 };
  }
  const closes = candles4h.map((c) => c.close);
  const price = closes[closes.length - 1];
  const ema50 = calculateEMA(closes.slice(-50), 50);
  const ema200 = candles4h.length >= 200 ? calculateEMA(closes, 200) : ema50;

  const priceVsEma50 = price > ema50;
  const priceVsEma200 = price > ema200;
  const ema50VsEma200 = ema50 > ema200;

  // Slope of EMA50 (last 5 candles)
  const ema50Series = [];
  for (let i = Math.max(5, closes.length - 50); i <= closes.length; i++) {
    ema50Series.push(calculateEMA(closes.slice(0, i).slice(-50), 50));
  }
  const slopeUp = ema50Series.length >= 2 && ema50Series[ema50Series.length - 1] > ema50Series[0];

  let bullScore = 0;
  let bearScore = 0;
  if (priceVsEma50) bullScore++; else bearScore++;
  if (priceVsEma200) bullScore++; else bearScore++;
  if (ema50VsEma200) bullScore++; else bearScore++;
  if (slopeUp) bullScore++; else bearScore++;

  if (bullScore >= 3 && bearScore <= 1) return { bias: MacroBias.BULLISH, ema50, ema200, price };
  if (bearScore >= 3 && bullScore <= 1) return { bias: MacroBias.BEARISH, ema50, ema200, price };
  return { bias: MacroBias.NEUTRAL, ema50, ema200, price };
}

function generateId(pair: string, timestamp: number, salt: string): string {
  // Deterministic-ish ID for tracing: pair + ts + salt hash
  const raw = `${pair}:${timestamp}:${salt}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `rc-${Math.abs(hash).toString(36)}-${timestamp.toString(36)}`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

export interface SpotRegimeInput {
  pair: string;
  candles1h: OHLCCandle[];
  candles4h: OHLCCandle[];
  dataHealth?: DataHealth;
}

/**
 * Build a unified SpotRegimeContext from 1h (regime/direction) and 4h (macro) candles.
 *
 * Entry and Exit MUST consume the same returned context.
 */
export function buildSpotRegimeContext(input: SpotRegimeInput): SpotRegimeContext {
  const { pair } = input;
  const generatedAt = Date.now();

  // 1h regime (reuses existing detectMarketRegime logic)
  const regime1h = detectMarketRegime(input.candles1h);
  const regime = mapRegime(regime1h.regime);

  // 1h indicators for direction + volatility
  const candles1hSpot = toSpotCandles(input.candles1h);
  const closes1h = candles1hSpot.map((c) => c.close);
  const currentPrice = closes1h.length > 0 ? closes1h[closes1h.length - 1] : 0;

  const ema20 = closes1h.length >= 20 ? calculateEMA(closes1h.slice(-20), 20) : currentPrice;
  const ema50 = closes1h.length >= 50 ? calculateEMA(closes1h.slice(-50), 50) : currentPrice;
  const ema200 = closes1h.length >= 200 ? calculateEMA(closes1h, 200) : ema50;

  const emaAlignmentStr: "bullish" | "bearish" | "neutral" =
    ema20 > ema50 && ema50 > ema200 ? "bullish"
    : ema20 < ema50 && ema50 < ema200 ? "bearish"
    : "neutral";

  const direction = deriveDirection(currentPrice, ema20, ema50, ema200, regime1h.emaAlignment);

  // ATR for volatility (calculateATR expects PriceData[])
  const priceData1h: PriceData[] = candles1hSpot.map((c) => ({
    price: c.close,
    timestamp: c.time,
    high: c.high,
    low: c.low,
    volume: c.volume,
  }));
  const atr = priceData1h.length >= 14 ? calculateATR(priceData1h, 14) : 0;
  const atrPct = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;
  const volatility = deriveVolatility(atrPct, regime1h.bollingerWidth);

  // 4h macro bias
  const candles4hSpot = toSpotCandles(input.candles4h);
  const macro = deriveMacroBias(candles4hSpot);

  const regimeId = generateId(pair, generatedAt, "regime");
  const contextId = generateId(pair, generatedAt, "context");

  return {
    regimeId,
    contextId,
    pair,
    regime,
    direction,
    volatility,
    macroBias: macro.bias,
    adx: regime1h.adx,
    ema20,
    ema50,
    ema200,
    emaAlignment: emaAlignmentStr,
    bollingerWidth: regime1h.bollingerWidth,
    atrPct,
    confidence: regime1h.confidence,
    dataHealth: input.dataHealth ?? DataHealth.GOOD,
    generatedAt,
  };
}

// ─── Entry gate helpers ─────────────────────────────────────────────────────

/**
 * Whether new entries are allowed given the regime context.
 * SPOT_CANONICAL rules:
 *   - TREND + BULLISH → yes
 *   - TREND + BEARISH → no
 *   - TRANSITION → no (by default)
 *   - RANGE → no (by default)
 *   - Macro BEARISH → no (block regardless of 1h)
 */
export function isEntryAllowedByRegime(ctx: SpotRegimeContext): { allowed: boolean; reason: string } {
  if (ctx.macroBias === MacroBias.BEARISH) {
    return { allowed: false, reason: `Macro 4h bearish bloquea entrada` };
  }
  if (ctx.regime === Regime.TREND && ctx.direction === RegimeDirection.BULLISH) {
    return { allowed: true, reason: `Trend bullish 1h, macro ${ctx.macroBias}` };
  }
  if (ctx.regime === Regime.TREND && ctx.direction === RegimeDirection.BEARISH) {
    return { allowed: false, reason: `Trend bearish 1h` };
  }
  if (ctx.regime === Regime.TRANSITION) {
    return { allowed: false, reason: `Régimen transition 1h` };
  }
  if (ctx.regime === Regime.RANGE) {
    return { allowed: false, reason: `Régimen range 1h` };
  }
  return { allowed: false, reason: `Régimen/dirección no propicio` };
}
