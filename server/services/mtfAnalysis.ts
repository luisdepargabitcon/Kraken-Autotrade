/**
 * MTF Analysis — Multi-Timeframe data fetching, caching, diagnostic, and trend analysis.
 * Extracted from TradingEngine for modularity.
 */

import { log } from "../utils/logger";
import { calculateEMA } from "./indicators";
import type { OHLCCandle } from "./indicators";

// === Types ===

export interface MultiTimeframeData {
  tf5m: OHLCCandle[];
  tf1h: OHLCCandle[];
  tf4h: OHLCCandle[];
  lastUpdate: number;
  isValid: boolean; // Fail-safe flag: if false, MTF signals should be ignored
}

export interface TrendAnalysis {
  shortTerm: "bullish" | "bearish" | "neutral";
  mediumTerm: "bullish" | "bearish" | "neutral";
  longTerm: "bullish" | "bearish" | "neutral";
  alignment: number;
  confidence: number;
  summary: string;
}

// === Constants ===

const MTF_DIAG_ENABLED = true;
const MTF_CACHE_TTL = 300000; // 5 minutes
const MTF_RATE_LIMIT_BACKOFF_MS = 120_000; // 2 min backoff after rate-limit error

// === Host interface ===

export interface IMtfAnalysisHost {
  getOHLC(pair: string, intervalMinutes: number): Promise<OHLCCandle[]>;
}

// === Pure functions ===

export function analyzeTimeframeTrend(candles: OHLCCandle[]): "bullish" | "bearish" | "neutral" {
  if (candles.length < 10) return "neutral";

  const closes = candles.map(c => c.close);
  const ema10 = calculateEMA(closes.slice(-10), 10);
  const ema20 = calculateEMA(closes.slice(-20), 20);
  const currentPrice = closes[closes.length - 1];

  const priceVsEma10 = (currentPrice - ema10) / ema10 * 100;
  const ema10VsEma20 = (ema10 - ema20) / ema20 * 100;

  let score = 0;
  if (priceVsEma10 > 0.5) score += 2;
  else if (priceVsEma10 > 0) score += 1;
  else if (priceVsEma10 < -0.5) score -= 2;
  else if (priceVsEma10 < 0) score -= 1;

  if (ema10VsEma20 > 0.3) score += 2;
  else if (ema10VsEma20 > 0) score += 1;
  else if (ema10VsEma20 < -0.3) score -= 2;
  else if (ema10VsEma20 < 0) score -= 1;

  const recentCandles = candles.slice(-5);
  const higherHighs = recentCandles.filter((c, i) => i > 0 && c.high > recentCandles[i-1].high).length;
  const lowerLows = recentCandles.filter((c, i) => i > 0 && c.low < recentCandles[i-1].low).length;

  if (higherHighs >= 3) score += 1;
  if (lowerLows >= 3) score -= 1;

  if (score >= 3) return "bullish";
  if (score <= -3) return "bearish";
  return "neutral";
}

export function analyzeMultiTimeframe(mtfData: MultiTimeframeData): TrendAnalysis {
  const shortTerm = analyzeTimeframeTrend(mtfData.tf5m);
  const mediumTerm = analyzeTimeframeTrend(mtfData.tf1h);
  const longTerm = analyzeTimeframeTrend(mtfData.tf4h);

  const trendValues = { bullish: 1, neutral: 0, bearish: -1 };
  const totalScore = trendValues[shortTerm] + trendValues[mediumTerm] * 1.5 + trendValues[longTerm] * 2;

  const allAligned = (shortTerm === mediumTerm && mediumTerm === longTerm && shortTerm !== "neutral");
  const twoAligned = (shortTerm === mediumTerm || mediumTerm === longTerm || shortTerm === longTerm);

  let alignment = 0;
  let confidence = 0.5;

  if (allAligned) {
    alignment = trendValues[shortTerm];
    confidence = 0.9;
  } else if (twoAligned && shortTerm !== "neutral") {
    alignment = totalScore > 0 ? 0.7 : totalScore < 0 ? -0.7 : 0;
    confidence = 0.7;
  } else {
    alignment = totalScore / 4.5;
    confidence = 0.5;
  }

  let summary = "";
  if (allAligned) {
    summary = `Tendencia ${shortTerm === "bullish" ? "ALCISTA" : "BAJISTA"} confirmada en todos los timeframes (5m/1h/4h)`;
  } else {
    summary = `5m: ${shortTerm}, 1h: ${mediumTerm}, 4h: ${longTerm}`;
  }

  return { shortTerm, mediumTerm, longTerm, alignment, confidence, summary };
}

// MTF diagnostic rate-limiting cache
const mtfDedupeCache: Map<string, { lastLogged: number; count: number }> = new Map();
const MTF_DEDUPE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function shouldLogMTFDiagnostic(pair: string, isCritical: boolean): boolean {
  const key = `${pair}:${isCritical ? 'CRITICAL' : 'INFO'}`;
  const now = Date.now();
  const cached = mtfDedupeCache.get(key);

  if (cached && now - cached.lastLogged < MTF_DEDUPE_TTL_MS) {
    cached.count++;
    // Only log if critical and count is multiple of 10 (every ~2.5 hours if spamming)
    if (isCritical && cached.count % 10 === 0) {
      log(`[MTF_DIAG] ${pair}: ${cached.count} repeticiones desde último log (rate-limited)`, "trading");
    }
    return false;
  }

  mtfDedupeCache.set(key, { lastLogged: now, count: 0 });
  return true;
}

// Helper to calculate average step between consecutive candles
function calcAverageStep(candles: OHLCCandle[]): number {
  if (candles.length < 2) return 0;
  let totalStep = 0;
  for (let i = 1; i < candles.length; i++) {
    totalStep += candles[i].time - candles[i - 1].time;
  }
  return totalStep / (candles.length - 1);
}

// Expected steps in seconds
const EXPECTED_STEPS = {
  '5m': 300,
  '1h': 3600,
  '4h': 14400,
};

export function emitMTFDiagnostic(pair: string, tf5m: OHLCCandle[], tf1h: OHLCCandle[], tf4h: OHLCCandle[]): boolean {
  const formatTs = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 16);
  const calcSpanHours = (candles: OHLCCandle[]) => {
    if (candles.length < 2) return 0;
    return ((candles[candles.length - 1].time - candles[0].time) / 3600).toFixed(1);
  };

  const span5m = calcSpanHours(tf5m);
  const span1h = calcSpanHours(tf1h);
  const span4h = calcSpanHours(tf4h);

  const first5m = tf5m[0]?.time || 0;
  const first1h = tf1h[0]?.time || 0;
  const first4h = tf4h[0]?.time || 0;
  const last5m = tf5m[tf5m.length - 1]?.time || 0;
  const last1h = tf1h[tf1h.length - 1]?.time || 0;
  const last4h = tf4h[tf4h.length - 1]?.time || 0;

  // Calculate actual steps to validate intervals
  const step5m = calcAverageStep(tf5m);
  const step1h = calcAverageStep(tf1h);
  const step4h = calcAverageStep(tf4h);

  // Detect CRITICAL issues (real data corruption)
  const sameArrayReference = (tf5m === tf1h || tf1h === tf4h || tf5m === tf4h);
  const identicalSpans = (span5m === span1h && span1h === span4h && parseFloat(String(span5m)) > 0);
  // exactFirstMatch is only critical if we have enough candles (more than 1)
  const exactFirstMatch = (first5m === first1h && first1h === first4h && first5m > 0) &&
    (tf5m.length > 1 && tf1h.length > 1 && tf4h.length > 1);
  const sameStepWrongTimeframe = (
    (step5m > 0 && Math.abs(step5m - EXPECTED_STEPS['5m']) > 60) ||
    (step1h > 0 && Math.abs(step1h - EXPECTED_STEPS['1h']) > 300) ||
    (step4h > 0 && Math.abs(step4h - EXPECTED_STEPS['4h']) > 600)
  );

  // exactLastMatch alone is NOT critical - it's normal for different timeframes to share the last candle timestamp
  const exactLastMatch = (last5m === last1h && last1h === last4h && last5m > 0);

  // Determine if truly critical
  const isCritical = sameArrayReference || identicalSpans || exactFirstMatch || sameStepWrongTimeframe;

  // Log basic info (rate-limited)
  if (shouldLogMTFDiagnostic(pair, isCritical)) {
    log(`[MTF_DIAG] ${pair}: ` +
      `5m: ${tf5m.length} velas [${formatTs(first5m)} -> ${formatTs(last5m)}] span=${span5m}h step=${step5m}s | ` +
      `1h: ${tf1h.length} velas [${formatTs(first1h)} -> ${formatTs(last1h)}] span=${span1h}h step=${step1h}s | ` +
      `4h: ${tf4h.length} velas [${formatTs(first4h)} -> ${formatTs(last4h)}] span=${span4h}h step=${step4h}s`, "trading");

    if (isCritical) {
      log(`[MTF_DIAG] \u{1F6A8} ERROR ${pair}: Duplicación MTF CRÍTICA detectada! ` +
        `sameArrayRef=${sameArrayReference}, identicalSpans=${identicalSpans}, exactFirst=${exactFirstMatch}, ` +
        `sameStepWrongTimeframe=${sameStepWrongTimeframe}, exactLast=${exactLastMatch} (normal)`, "trading");
    } else if (exactLastMatch) {
      // exactLast alone is not critical, just informational
      log(`[MTF_DIAG] \u{1F4C1} INFO ${pair}: exactLast=true (normal - timeframes comparten última vela alineada)`, "trading");
    }
  }

  return isCritical;
}

// === MtfAnalyzer class (stateful: cache) ===

export class MtfAnalyzer {
  private host: IMtfAnalysisHost;
  private mtfCache: Map<string, MultiTimeframeData> = new Map();
  private rateLimitBackoff: Map<string, number> = new Map(); // pair → retry-after timestamp

  constructor(host: IMtfAnalysisHost) {
    this.host = host;
  }

  invalidate(pair: string): void {
    this.mtfCache.delete(pair);
  }

  async getMultiTimeframeData(pair: string): Promise<MultiTimeframeData | null> {
    try {
      const cached = this.mtfCache.get(pair);
      if (cached && Date.now() - cached.lastUpdate < MTF_CACHE_TTL) {
        return cached;
      }

      // Rate-limit backoff: si está activo, usar caché stale en vez de reintentar
      const backoffUntil = this.rateLimitBackoff.get(pair) || 0;
      if (Date.now() < backoffUntil) {
        if (cached) {
          log(`[MTF_BACKOFF] ${pair}: rate-limit backoff activo (${Math.ceil((backoffUntil - Date.now()) / 1000)}s) → caché stale`, "trading");
          return cached;
        }
        return null;
      }

      const [tf5m, tf1h, tf4h] = await Promise.all([
        this.host.getOHLC(pair, 5),
        this.host.getOHLC(pair, 60),
        this.host.getOHLC(pair, 240),
      ]);

      // MTF Diagnostic: Verificar rangos temporales y validar datos
      let isValid = true;
      if (MTF_DIAG_ENABLED && tf5m.length > 0 && tf1h.length > 0 && tf4h.length > 0) {
        isValid = !emitMTFDiagnostic(pair, tf5m, tf1h, tf4h);
      }

      const data: MultiTimeframeData = {
        tf5m: tf5m.slice(-100),
        tf1h: tf1h.slice(-50),
        tf4h: tf4h.slice(-50),
        lastUpdate: Date.now(),
        isValid,
      };

      this.mtfCache.set(pair, data);
      this.rateLimitBackoff.delete(pair); // limpiar backoff al tener éxito
      log(`MTF datos actualizados para ${pair}: 5m=${tf5m.length}, 1h=${tf1h.length}, 4h=${tf4h.length}, valid=${isValid}`, "trading");

      return data;
    } catch (error: any) {
      const isRateLimit = error.message?.includes('Too many requests') ||
        error.message?.includes('EAPI:Rate limit') ||
        error.message?.includes('Rate limit exceed');
      if (isRateLimit) {
        this.rateLimitBackoff.set(pair, Date.now() + MTF_RATE_LIMIT_BACKOFF_MS);
        const stale = this.mtfCache.get(pair);
        log(`[MTF_RATE_LIMIT] ${pair}: rate limit hit → backoff ${MTF_RATE_LIMIT_BACKOFF_MS / 1000}s${stale ? ', usando caché stale' : ', sin datos previos'}`, "trading");
        return stale ?? null;
      }
      log(`Error obteniendo datos MTF para ${pair}: ${error.message}`, "trading");
      return null;
    }
  }
}
