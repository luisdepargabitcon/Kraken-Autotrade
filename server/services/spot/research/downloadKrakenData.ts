/**
 * Download script: fetches Kraken OHLC data for all pairs/timeframes.
 * Uses official Kraken REST API OHLC endpoint with `since` pagination.
 * Downloads 180 days of history for baseline certification.
 *
 * Run: npx tsx server/services/spot/research/downloadKrakenData.ts
 */

import { downloadAllPairs, PAIR_MAPPINGS, TIMEFRAMES, DATA_ROOT, KRAKEN_SOURCE } from "./krakenHistoricalLoader";

async function main() {
  console.log(`[Download] Source: ${KRAKEN_SOURCE}`);
  console.log(`[Download] Data root: ${DATA_ROOT}`);
  console.log(`[Download] Pairs: ${PAIR_MAPPINGS.map(p => p.requested).join(", ")}`);
  console.log(`[Download] Timeframes: ${TIMEFRAMES.join(", ")} minutes`);

  // 180 days before now, approximated to 2026-03-14
  const startUtc = Date.UTC(2026, 2, 14); // March 14, 2026 00:00:00 UTC
  const startSeconds = Math.floor(startUtc / 1000);
  console.log(`[Download] Since: ${new Date(startUtc).toISOString()} (${startSeconds}s)`);
  console.log();

  const results = await downloadAllPairs(startSeconds, 500);

  // Print summary
  console.log("\n[Download] Summary:");
  for (const [key, ds] of results) {
    const days = ds.rowCount > 0 ? (ds.lastTimestamp - ds.firstTimestamp) / (24 * 3600 * 1000) : 0;
    console.log(`  ${key}: ${ds.rowCount} candles, ${days.toFixed(1)} days, ${ds.firstTimestamp > 0 ? new Date(ds.firstTimestamp).toISOString() : "N/A"} → ${ds.lastTimestamp > 0 ? new Date(ds.lastTimestamp).toISOString() : "N/A"}`);
  }

  console.log(`\n[Download] Done. ${results.size} datasets saved.`);
}

main().catch(e => {
  console.error("[Download] Fatal:", e);
  process.exit(1);
});
