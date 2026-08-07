/**
 * AMA ETF Source — Fase 2H
 *
 * SEC EDGAR filings: 13F, N-PORT. Holdings ETF Bitcoin spot.
 */

export interface EtfHolding {
  ticker: string;
  filingDate: string;
  reportDate: string;
  btcHoldings: number;
  aumUsd: number;
  filingType: "13F" | "N-PORT" | "S-1";
}

export function validateEtfHolding(holding: EtfHolding): string[] {
  const errors: string[] = [];
  if (holding.btcHoldings < 0) errors.push("NEGATIVE_BTC_HOLDINGS");
  if (holding.aumUsd < 0) errors.push("NEGATIVE_AUM");
  if (holding.filingDate < holding.reportDate) errors.push("FILING_DATE_BEFORE_REPORT_DATE");
  return errors;
}

export function isFilingDateValid(filingDate: string, asOf: string): boolean {
  return new Date(filingDate).getTime() <= new Date(asOf).getTime();
}
