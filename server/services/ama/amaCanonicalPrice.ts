/**
 * AMA Canonical Price — Fase 2C
 *
 * Kraken is the AUTHORITATIVE source for OHLC, HWM, ATR.
 * Canonical price = Kraken last trade.
 * ATR20 is calculated over Kraken daily candles.
 *
 * Safety: No Revolut X prices in analysis formulas.
 * No mixing Kraken and Revolut X prices without declaring their function.
 */

import type { OhlcCandle } from "./amaDataQuality";

export interface CanonicalPriceResult {
  price: number;
  source: "KRAKEN_LAST_TRADE";
  timestamp: string;
  valid: boolean;
}

export function computeCanonicalPrice(
  krakenLastTradePrice: number,
  timestamp: string,
): CanonicalPriceResult {
  if (krakenLastTradePrice <= 0) {
    return {
      price: 0,
      source: "KRAKEN_LAST_TRADE",
      timestamp,
      valid: false,
    };
  }
  return {
    price: krakenLastTradePrice,
    source: "KRAKEN_LAST_TRADE",
    timestamp,
    valid: true,
  };
}

export function computeAtr20(dailyCandles: OhlcCandle[]): number | null {
  if (dailyCandles.length < 20) return null;

  const trueRanges: number[] = [];

  for (let i = 1; i < dailyCandles.length; i++) {
    const high = dailyCandles[i].high;
    const low = dailyCandles[i].low;
    const prevClose = dailyCandles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );

    trueRanges.push(tr);
  }

  // Take last 20 true ranges
  const last20 = trueRanges.slice(-20);
  const sum = last20.reduce((acc, val) => acc + val, 0);

  return sum / 20;
}

export function computeAtrPct(atr20: number, latestClose: number): number {
  if (latestClose <= 0) return 0;
  return (atr20 / latestClose) * 100;
}

export function computeReversalThreshold(
  atrPct: number,
  atrMultiplier: number,
  minimumReversalPct: number,
  maximumReversalPct: number,
): number {
  const raw = atrPct * atrMultiplier;
  return Math.max(minimumReversalPct, Math.min(maximumReversalPct, raw));
}

export function computeHwmFromKraken(dailyCloses: { timestamp: string; close: number }[]): number | null {
  if (dailyCloses.length === 0) return null;
  return Math.max(...dailyCloses.map((d) => d.close));
}

export function isKrakenAuthoritativeForOhlc(): boolean {
  return true;
}

export function isKrakenAuthoritativeForHwm(): boolean {
  return true;
}

export function isKrakenAuthoritativeForAtr(): boolean {
  return true;
}
