/**
 * Baseline runner script.
 * Run: npx tsx server/services/spot/research/runBaseline.ts
 */

import { runFullBaseline, generateReports, generateManifest } from "./spotBaselineResearch";
import { loadAllCached } from "./krakenHistoricalLoader";
import * as path from "path";
import * as fs from "fs";

const RESULTS_DIR = path.join(
  process.env.KRAKEN_DATA_ROOT
    ?? "C:\\Users\\JSLUI\\Qsync\\BOT_NAS\\BOT_AUTOTRADE_SPOT_ADAPTIVE_V3_DATA\\kraken",
  "results"
);

async function main() {
  console.log("[Baseline] Loading cached datasets...");
  const datasets = loadAllCached();
  console.log(`[Baseline] Loaded ${datasets.size} datasets`);

  if (datasets.size === 0) {
    console.error("[Baseline] No cached data found. Run downloadKrakenData.ts first.");
    process.exit(1);
  }

  console.log("[Baseline] Generating manifest...");
  generateManifest(datasets, RESULTS_DIR);

  console.log("[Baseline] Running full baseline replay...");
  const report = runFullBaseline();

  console.log("[Baseline] Generating reports...");
  generateReports(report, RESULTS_DIR);

  console.log("\n[Baseline] Summary:");
  for (const p of report.pairs) {
    const m = p.metrics;
    console.log(`  ${p.pair} (${p.window}):`);
    console.log(`    Range: ${p.startDate} → ${p.endDate}`);
    console.log(`    Candles: ${m.candlesAnalyzed}`);
    console.log(`    Trades: ${m.entriesExecuted} (closed: ${m.closedTrades}, open: ${m.openTerminalTrades})`);
    console.log(`    Net PnL: $${m.netPnlUsd.toFixed(2)}`);
    console.log(`    Win Rate: ${(m.winRate * 100).toFixed(1)}%`);
    console.log(`    Profit Factor: ${m.profitFactor.toFixed(2)}`);
    console.log(`    Max DD: $${m.maxDrawdownUsd.toFixed(2)}`);
    console.log(`    Deterministic: ${p.deterministic} (hash: ${p.runHash.substring(0, 16)}...)`);
    console.log(`    Structure pre-entry: 0-post=${p.structurePreEntry.structureExitWith0PostEntry15m}, 1-post=${p.structurePreEntry.structureExitWith1PostEntry15m}, 2+=${p.structurePreEntry.structureExitWith2PlusPostEntry15m}`);
  }

  console.log(`\n[Baseline] Reports saved to: ${RESULTS_DIR}`);
  console.log("[Baseline] Done.");
}

main().catch(e => {
  console.error("[Baseline] Fatal:", e);
  process.exit(1);
});
