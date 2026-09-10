/**
 * SpotBaselineResearch — Runs baseline replay over Kraken historical data.
 *
 * Uses the EXACT current strategy (no optimization).
 * Produces deterministic results with SHA256 hashing.
 * Generates metrics, structure pre-entry analysis, and duration analysis.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { SpotCandle } from "../spotTypes";
import { ExitReasonType, SetupTag, Regime } from "../spotTypes";
import { runReplay, type ReplayCandleSet, type ReplayConfig, type ReplayResult, type ReplayTrade } from "../spotReplayEngine";
import { PAIR_MAPPINGS, TIMEFRAMES, loadAllCached, type KrakenDataset, type KrakenOHLCRow, KRAKEN_SOURCE, KRAKEN_OFFICIAL_PAGE, KRAKEN_API_URL } from "./krakenHistoricalLoader";
import { validateDataset, validateAllCached, type ValidationResult, type FullValidationReport } from "./krakenDatasetValidator";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BaselineMetrics {
  pair: string;
  window: string;
  candlesAnalyzed: number;
  signalsBuy: number;
  entriesExecuted: number;
  closedTrades: number;
  openTerminalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  feesUsd: number;
  feesToGrossProfitRatio: number;
  expectancyUsd: number;
  expectancyR: number;
  medianR: number;
  meanR: number;
  profitFactor: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  maxConsecutiveLosses: number;
  avgHoldMinutes: number;
  medianHoldMinutes: number;
  mfeMean: number;
  mfeMedian: number;
  mfeP75: number;
  mfeP90: number;
  maeMean: number;
  maeMedian: number;
  maeP75: number;
  maeP90: number;
  profitCaptureMean: number;
  profitCaptureMedian: number;
  exitReasonBreakdown: Record<string, number>;
  setupTagBreakdown: Record<string, number>;
  regimeBreakdown: Record<string, number>;
}

export interface StructurePreEntryAnalysis {
  structureExitWith0PostEntry15m: number;
  structureExitWith1PostEntry15m: number;
  structureExitWith2PlusPostEntry15m: number;
}

export interface DurationAnalysis {
  tradesLe5Min: number;
  tradesLe10Min: number;
  tradesLe15Min: number;
  tradesLe30Min: number;
  tradesLe60Min: number;
  details: { holdMinutes: number; exitReason: string; rMultiple: number; mfeUsd: number; maeUsd: number; feesUsd: number; netPnlUsd: number }[];
}

export interface PairBaselineResult {
  pair: string;
  window: string;
  startDate: string;
  endDate: string;
  metrics: BaselineMetrics;
  structurePreEntry: StructurePreEntryAnalysis;
  durationAnalysis: DurationAnalysis;
  runHash: string;
  deterministic: boolean;
}

export interface BaselineReport {
  pairs: PairBaselineResult[];
  commonWindowStart: string;
  commonWindowEnd: string;
  fullWindows: { pair: string; start: string; end: string }[];
  validationReport: FullValidationReport;
  generatedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TF_MS: Record<number, number> = {
  5: 5 * 60 * 1000,
  15: 15 * 60 * 1000,
  60: 60 * 60 * 1000,
  240: 240 * 60 * 1000,
};

function toSpotCandle(row: KrakenOHLCRow): SpotCandle {
  return {
    time: row.timestamp,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
  };
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function sha256(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function serializeResult(result: ReplayResult): string {
  return JSON.stringify({
    pair: result.pair,
    trades: result.trades.map(t => ({
      lotId: t.lotId,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      openedAtMs: t.openedAtMs,
      closedAtMs: t.closedAtMs,
      exitReason: t.exitReason,
      netPnlUsd: Math.round(t.netPnlUsd * 1e8) / 1e8,
      rMultiple: Math.round(t.rMultiple * 1e6) / 1e6,
    })),
    stats: result.stats,
  });
}

// ─── Compute metrics ─────────────────────────────────────────────────────────

function computeMetrics(pair: string, window: string, result: ReplayResult, candlesAnalyzed: number): BaselineMetrics {
  const trades = result.trades;
  const wins = trades.filter(t => t.netPnlUsd > 0);
  const losses = trades.filter(t => t.netPnlUsd <= 0);
  const grossProfit = wins.reduce((s, t) => s + Math.max(0, t.grossPnlUsd), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + Math.min(0, t.grossPnlUsd), 0));
  const totalFees = trades.reduce((s, t) => s + t.entryFeeUsd + t.exitFeeUsd, 0);
  const rMultiples = trades.map(t => t.rMultiple);
  const holdTimes = trades.map(t => t.holdTimeMinutes);
  const mfeValues = trades.map(t => t.mfeUsd);
  const maeValues = trades.map(t => t.maeUsd);
  const profitCaptures = trades.map(t => t.profitCapturePct ?? 0);

  const exitReasonBreakdown: Record<string, number> = {};
  for (const t of trades) {
    exitReasonBreakdown[t.exitReason] = (exitReasonBreakdown[t.exitReason] ?? 0) + 1;
  }

  const setupTagBreakdown: Record<string, number> = {};
  for (const t of trades) {
    setupTagBreakdown[t.setupTag] = (setupTagBreakdown[t.setupTag] ?? 0) + 1;
  }

  // Max drawdown
  let peak = 0;
  let maxDd = 0;
  let cumulative = 0;
  for (const t of trades) {
    cumulative += t.netPnlUsd;
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDd) maxDd = dd;
  }

  // Max consecutive losses
  let maxConsecLosses = 0;
  let currentLosses = 0;
  for (const t of trades) {
    if (t.netPnlUsd <= 0) {
      currentLosses++;
      if (currentLosses > maxConsecLosses) maxConsecLosses = currentLosses;
    } else {
      currentLosses = 0;
    }
  }

  return {
    pair,
    window,
    candlesAnalyzed,
    signalsBuy: trades.length,
    entriesExecuted: trades.length,
    closedTrades: trades.filter(t => t.exitReason !== "OPEN_AT_END" as ExitReasonType).length,
    openTerminalTrades: trades.filter(t => t.exitReason === ("OPEN_AT_END" as any)).length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    grossPnlUsd: trades.reduce((s, t) => s + t.grossPnlUsd, 0),
    netPnlUsd: trades.reduce((s, t) => s + t.netPnlUsd, 0),
    feesUsd: totalFees,
    feesToGrossProfitRatio: grossProfit > 0 ? totalFees / grossProfit : 0,
    expectancyUsd: trades.length > 0 ? trades.reduce((s, t) => s + t.netPnlUsd, 0) / trades.length : 0,
    expectancyR: trades.length > 0 ? rMultiples.reduce((s, r) => s + r, 0) / trades.length : 0,
    medianR: median(rMultiples),
    meanR: trades.length > 0 ? rMultiples.reduce((s, r) => s + r, 0) / trades.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    maxDrawdownUsd: maxDd,
    maxDrawdownPct: peak > 0 ? (maxDd / peak) * 100 : 0,
    maxConsecutiveLosses: maxConsecLosses,
    avgHoldMinutes: trades.length > 0 ? holdTimes.reduce((s, h) => s + h, 0) / trades.length : 0,
    medianHoldMinutes: median(holdTimes),
    mfeMean: trades.length > 0 ? mfeValues.reduce((s, v) => s + v, 0) / trades.length : 0,
    mfeMedian: median(mfeValues),
    mfeP75: percentile(mfeValues, 75),
    mfeP90: percentile(mfeValues, 90),
    maeMean: trades.length > 0 ? maeValues.reduce((s, v) => s + v, 0) / trades.length : 0,
    maeMedian: median(maeValues),
    maeP75: percentile(maeValues, 75),
    maeP90: percentile(maeValues, 90),
    profitCaptureMean: trades.length > 0 ? profitCaptures.reduce((s, v) => s + v, 0) / trades.length : 0,
    profitCaptureMedian: median(profitCaptures),
    exitReasonBreakdown,
    setupTagBreakdown,
    regimeBreakdown: {},
  };
}

function computeStructurePreEntry(trades: ReplayTrade[], candles15m: SpotCandle[]): StructurePreEntryAnalysis {
  let with0 = 0;
  let with1 = 0;
  let with2Plus = 0;

  for (const trade of trades) {
    if (trade.exitReason !== ("STRUCTURE_INVALIDATION" as ExitReasonType)) continue;

    const openedAt = trade.openedAtMs;
    const closedAt = trade.closedAtMs;

    // Count closed 15m candles between openedAt and closedAt
    const postEntry = candles15m.filter(c => {
      const closeTime = c.time + TF_MS[15];
      return closeTime > openedAt && closeTime <= closedAt;
    });

    if (postEntry.length === 0) with0++;
    else if (postEntry.length === 1) with1++;
    else with2Plus++;
  }

  return {
    structureExitWith0PostEntry15m: with0,
    structureExitWith1PostEntry15m: with1,
    structureExitWith2PlusPostEntry15m: with2Plus,
  };
}

function computeDurationAnalysis(trades: ReplayTrade[]): DurationAnalysis {
  const details = trades.map(t => ({
    holdMinutes: t.holdTimeMinutes,
    exitReason: t.exitReason,
    rMultiple: t.rMultiple,
    mfeUsd: t.mfeUsd,
    maeUsd: t.maeUsd,
    feesUsd: t.entryFeeUsd + t.exitFeeUsd,
    netPnlUsd: t.netPnlUsd,
  }));

  return {
    tradesLe5Min: trades.filter(t => t.holdTimeMinutes <= 5).length,
    tradesLe10Min: trades.filter(t => t.holdTimeMinutes <= 10).length,
    tradesLe15Min: trades.filter(t => t.holdTimeMinutes <= 15).length,
    tradesLe30Min: trades.filter(t => t.holdTimeMinutes <= 30).length,
    tradesLe60Min: trades.filter(t => t.holdTimeMinutes <= 60).length,
    details,
  };
}

// ─── Run baseline ────────────────────────────────────────────────────────────

export function runBaselineForPair(
  pair: string,
  datasets: Map<string, KrakenDataset>,
  window: string = "FULL",
): PairBaselineResult | null {
  const c5 = datasets.get(`${pair}_5m`);
  const c15 = datasets.get(`${pair}_15m`);
  const c60 = datasets.get(`${pair}_60m`);
  const c240 = datasets.get(`${pair}_240m`);

  if (!c5 || !c15 || !c60 || !c240) {
    console.error(`[Baseline] Missing datasets for ${pair}`);
    return null;
  }

  const candles5m = c5.rows.map(toSpotCandle);
  const candles15m = c15.rows.map(toSpotCandle);
  const candles1h = c60.rows.map(toSpotCandle);
  const candles4h = c240.rows.map(toSpotCandle);

  const candleSet: ReplayCandleSet = {
    pair,
    candles5m,
    candles15m,
    candles1h,
    candles4h,
  };

  const config: ReplayConfig = {
    pair,
    availableCapitalUsd: 10000,
  };

  // Run 1
  const result1 = runReplay(candleSet, config);
  const hash1 = sha256(serializeResult(result1));

  // Run 2 (determinism check)
  const result2 = runReplay(candleSet, config);
  const hash2 = sha256(serializeResult(result2));

  const deterministic = hash1 === hash2;

  const metrics = computeMetrics(pair, window, result1, candles5m.length);
  const structurePreEntry = computeStructurePreEntry(result1.trades, candles15m);
  const durationAnalysis = computeDurationAnalysis(result1.trades);

  return {
    pair,
    window,
    startDate: new Date(c5.firstTimestamp).toISOString(),
    endDate: new Date(c5.lastTimestamp).toISOString(),
    metrics,
    structurePreEntry,
    durationAnalysis,
    runHash: hash1,
    deterministic,
  };
}

export function runFullBaseline(): BaselineReport {
  const datasets = loadAllCached();
  const validationReport = validateAllCached();

  // Compute common window
  let commonStart = 0;
  let commonEnd = Infinity;
  for (const mapping of PAIR_MAPPINGS) {
    const c5 = datasets.get(`${mapping.requested}_5m`);
    if (!c5) continue;
    if (commonStart < c5.firstTimestamp) commonStart = c5.firstTimestamp;
    if (commonEnd > c5.lastTimestamp) commonEnd = c5.lastTimestamp;
  }

  const pairs: PairBaselineResult[] = [];
  const fullWindows: { pair: string; start: string; end: string }[] = [];

  for (const mapping of PAIR_MAPPINGS) {
    const result = runBaselineForPair(mapping.requested, datasets, "FULL");
    if (result) {
      pairs.push(result);
      fullWindows.push({ pair: mapping.requested, start: result.startDate, end: result.endDate });
    }
  }

  return {
    pairs,
    commonWindowStart: commonStart > 0 ? new Date(commonStart).toISOString() : "N/A",
    commonWindowEnd: commonEnd < Infinity ? new Date(commonEnd).toISOString() : "N/A",
    fullWindows,
    validationReport,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Report generation ────────────────────────────────────────────────────────

export function generateReports(report: BaselineReport, outputDir: string): void {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // JSON
  fs.writeFileSync(path.join(outputDir, "SPOT_V3_BASELINE_SUMMARY.json"), JSON.stringify(report, null, 2));

  // CSV
  const csvLines: string[] = [];
  const headers = [
    "pair", "window", "startDate", "endDate", "candlesAnalyzed", "signalsBuy", "entriesExecuted",
    "closedTrades", "openTerminalTrades", "wins", "losses", "winRate",
    "grossPnlUsd", "netPnlUsd", "feesUsd", "feesToGrossProfitRatio",
    "expectancyUsd", "expectancyR", "medianR", "meanR", "profitFactor",
    "maxDrawdownUsd", "maxDrawdownPct", "maxConsecutiveLosses",
    "avgHoldMinutes", "medianHoldMinutes",
    "mfeMean", "mfeMedian", "mfeP75", "mfeP90",
    "maeMean", "maeMedian", "maeP75", "maeP90",
    "profitCaptureMean", "profitCaptureMedian",
    "runHash", "deterministic",
    "structureExitWith0PostEntry15m", "structureExitWith1PostEntry15m", "structureExitWith2PlusPostEntry15m",
  ];
  csvLines.push(headers.join(","));

  for (const p of report.pairs) {
    const m = p.metrics;
    const s = p.structurePreEntry;
    const row = [
      p.pair, p.window, p.startDate, p.endDate, m.candlesAnalyzed, m.signalsBuy, m.entriesExecuted,
      m.closedTrades, m.openTerminalTrades, m.wins, m.losses, m.winRate.toFixed(4),
      m.grossPnlUsd.toFixed(2), m.netPnlUsd.toFixed(2), m.feesUsd.toFixed(2), m.feesToGrossProfitRatio.toFixed(4),
      m.expectancyUsd.toFixed(2), m.expectancyR.toFixed(4), m.medianR.toFixed(4), m.meanR.toFixed(4), m.profitFactor.toFixed(4),
      m.maxDrawdownUsd.toFixed(2), m.maxDrawdownPct.toFixed(2), m.maxConsecutiveLosses,
      m.avgHoldMinutes.toFixed(1), m.medianHoldMinutes.toFixed(1),
      m.mfeMean.toFixed(2), m.mfeMedian.toFixed(2), m.mfeP75.toFixed(2), m.mfeP90.toFixed(2),
      m.maeMean.toFixed(2), m.maeMedian.toFixed(2), m.maeP75.toFixed(2), m.maeP90.toFixed(2),
      m.profitCaptureMean.toFixed(4), m.profitCaptureMedian.toFixed(4),
      p.runHash, p.deterministic,
      s.structureExitWith0PostEntry15m, s.structureExitWith1PostEntry15m, s.structureExitWith2PlusPostEntry15m,
    ];
    csvLines.push(row.join(","));
  }

  fs.writeFileSync(path.join(outputDir, "SPOT_V3_BASELINE_SUMMARY.csv"), csvLines.join("\n"));

  // MD report
  const md: string[] = [];
  md.push("# SPOT V3 Baseline Replay Summary");
  md.push("");
  md.push(`Generated: ${report.generatedAt}`);
  md.push(`Common Window: ${report.commonWindowStart} → ${report.commonWindowEnd}`);
  md.push("");
  md.push("## Full Windows");
  for (const w of report.fullWindows) {
    md.push(`- **${w.pair}**: ${w.start} → ${w.end}`);
  }
  md.push("");
  md.push("## Baseline Results");
  for (const p of report.pairs) {
    const m = p.metrics;
    md.push(`### ${p.pair} (${p.window})`);
    md.push(`- Range: ${p.startDate} → ${p.endDate}`);
    md.push(`- Candles: ${m.candlesAnalyzed}`);
    md.push(`- Trades: ${m.entriesExecuted} (closed: ${m.closedTrades}, open: ${m.openTerminalTrades})`);
    md.push(`- Win Rate: ${(m.winRate * 100).toFixed(1)}% (${m.wins}W / ${m.losses}L)`);
    md.push(`- Net PnL: $${m.netPnlUsd.toFixed(2)}`);
    md.push(`- Gross PnL: $${m.grossPnlUsd.toFixed(2)}`);
    md.push(`- Fees: $${m.feesUsd.toFixed(2)}`);
    md.push(`- Profit Factor: ${m.profitFactor.toFixed(2)}`);
    md.push(`- Max DD: $${m.maxDrawdownUsd.toFixed(2)} (${m.maxDrawdownPct.toFixed(1)}%)`);
    md.push(`- Expectancy: $${m.expectancyUsd.toFixed(2)}/trade, ${m.expectancyR.toFixed(2)}R/trade`);
    md.push(`- Avg Hold: ${m.avgHoldMinutes.toFixed(0)} min (median: ${m.medianHoldMinutes.toFixed(0)} min)`);
    md.push(`- MFE: mean=$${m.mfeMean.toFixed(2)}, p90=$${m.mfeP90.toFixed(2)}`);
    md.push(`- MAE: mean=$${m.maeMean.toFixed(2)}, p90=$${m.maeP90.toFixed(2)}`);
    md.push(`- Deterministic: ${p.deterministic} (hash: ${p.runHash.substring(0, 16)}...)`);
    md.push(`- Structure pre-entry: 0-post=${p.structurePreEntry.structureExitWith0PostEntry15m}, 1-post=${p.structurePreEntry.structureExitWith1PostEntry15m}, 2+=${p.structurePreEntry.structureExitWith2PlusPostEntry15m}`);
    md.push("");
  }
  md.push("## Dataset Validation");
  md.push(`- All valid: ${report.validationReport.allValid}`);
  md.push(`- MTF all pass: ${report.validationReport.mtfAllPass}`);
  for (const v of report.validationReport.validations) {
    md.push(`- **${v.pair} ${v.timeframe}**: ${v.rowCount} rows, gaps=${v.gaps.gapCount}, largest=${v.gaps.largestGapMinutes}min, dupConflicts=${v.duplicateConflicting}, valid=${v.valid}`);
  }
  md.push("");
  md.push("## Exit Reason Breakdown");
  for (const p of report.pairs) {
    md.push(`### ${p.pair}`);
    for (const [reason, count] of Object.entries(p.metrics.exitReasonBreakdown)) {
      md.push(`- ${reason}: ${count}`);
    }
    md.push("");
  }

  fs.writeFileSync(path.join(outputDir, "SPOT_V3_BASELINE_REPORT.md"), md.join("\n"));
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

export function generateManifest(datasets: Map<string, KrakenDataset>, outputDir: string): void {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const manifest: any = {
    source: KRAKEN_SOURCE,
    official_page_url: KRAKEN_OFFICIAL_PAGE,
    api_url: KRAKEN_API_URL,
    downloaded_at_utc: new Date().toISOString(),
    baseline_commit_sha: "e2ce79a1af2c572d9b92d26240b171d53156645d",
    parser_version: "1.0.0",
    normalizer_version: "1.0.0",
    pairs: [] as any[],
  };

  for (const mapping of PAIR_MAPPINGS) {
    for (const tf of TIMEFRAMES) {
      const key = `${mapping.requested}_${tf}m`;
      const ds = datasets.get(key);
      if (!ds) continue;

      const cp = path.join(outputDir, "..", "normalized", `${mapping.requested.replace("/", "_")}_${tf}m.json`);
      let csvSha = "";
      try {
        const data = fs.readFileSync(cp);
        csvSha = crypto.createHash("sha256").update(data).digest("hex");
      } catch {}

      manifest.pairs.push({
        pair_requested: mapping.requested,
        kraken_pair: mapping.krakenPair,
        kraken_result_key: mapping.resultKey,
        timeframe_minutes: tf,
        csv_filename: `${mapping.requested.replace("/", "_")}_${tf}m.json`,
        csv_size: ds.rowCount,
        csv_sha256: csvSha,
        row_count: ds.rowCount,
        first_timestamp: ds.firstTimestamp,
        last_timestamp: ds.lastTimestamp,
      });
    }
  }

  fs.writeFileSync(path.join(outputDir, "kraken-historical-manifest.json"), JSON.stringify(manifest, null, 2));
}
