/**
 * AMA Derivatives Source — Fase 2I
 *
 * CME futures: open interest, basis, contango/backwardation.
 * Funding rates: perpetuals.
 */

export interface DerivativesData {
  venue: string;
  openInterestUsd: number;
  basisPct: number;
  fundingRatePct: number; // 8h funding rate
  futuresPrice: number;
  spotPrice: number;
  timestamp: string;
}

export type MarketStructure = "CONTANGO" | "BACKWARDATION" | "FLAT";

export function getMarketStructure(data: DerivativesData): MarketStructure {
  if (data.futuresPrice > data.spotPrice * 1.0001) return "CONTANGO";
  if (data.futuresPrice < data.spotPrice * 0.9999) return "BACKWARDATION";
  return "FLAT";
}

export function computeBasisPct(futuresPrice: number, spotPrice: number): number {
  if (spotPrice <= 0) return 0;
  return ((futuresPrice - spotPrice) / spotPrice) * 100;
}

export function validateDerivativesData(data: DerivativesData): string[] {
  const errors: string[] = [];
  if (data.openInterestUsd < 0) errors.push("NEGATIVE_OPEN_INTEREST");
  if (data.futuresPrice < 0) errors.push("NEGATIVE_FUTURES_PRICE");
  if (data.spotPrice < 0) errors.push("NEGATIVE_SPOT_PRICE");
  return errors;
}
