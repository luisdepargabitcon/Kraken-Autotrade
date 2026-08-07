/**
 * AMA Macro Source — Fase 2G
 *
 * FRED API with point-in-time vintages. No look-ahead.
 */

export interface FredSeries {
  seriesId: string;
  title: string;
  units: string;
  frequency: string;
}

export const FRED_SERIES: Record<string, FredSeries> = {
  DGS10: { seriesId: "DGS10", title: "10-Year Treasury", units: "Percent", frequency: "Daily" },
  DGS2: { seriesId: "DGS2", title: "2-Year Treasury", units: "Percent", frequency: "Daily" },
  T10Y2Y: { seriesId: "T10Y2Y", title: "10-2 Year Spread", units: "Percent", frequency: "Daily" },
  DFF: { seriesId: "DFF", title: "Fed Funds Rate", units: "Percent", frequency: "Daily" },
  CPIAUCSL: { seriesId: "CPIAUCSL", title: "CPI All Items", units: "Index", frequency: "Monthly" },
};

export interface FredVintagePoint {
  date: string;
  value: number;
  vintageDate: string;
  revisionNumber: number;
}

export function isLookAhead(vintageDate: string, asOf: string): boolean {
  return new Date(vintageDate).getTime() > new Date(asOf).getTime();
}

export function filterPointInTime(
  vintages: FredVintagePoint[],
  asOf: string,
): FredVintagePoint[] {
  return vintages.filter((v) => !isLookAhead(v.vintageDate, asOf));
}

export function detectRevisions(vintages: FredVintagePoint[]): {
  date: string;
  revisionCount: number;
}[] {
  const byDate = new Map<string, number>();
  for (const v of vintages) {
    byDate.set(v.date, (byDate.get(v.date) || 0) + 1);
  }
  const revisions: { date: string; revisionCount: number }[] = [];
  for (const [date, count] of byDate) {
    if (count > 1) {
      revisions.push({ date, revisionCount: count });
    }
  }
  return revisions;
}
