/**
 * Download script: fetches Kraken OHLCVT data for all pairs/timeframes.
 * Run: npx tsx server/services/spot/research/downloadKrakenData.ts
 */

import { downloadAllPairs, PAIR_MAPPINGS, TIMEFRAMES, DATA_ROOT } from "./krakenHistoricalLoader";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log(`[Download] Data root: ${DATA_ROOT}`);
  console.log(`[Download] Pairs: ${PAIR_MAPPINGS.map(p => p.requested).join(", ")}`);
  console.log(`[Download] Timeframes: ${TIMEFRAMES.join(", ")} minutes`);

  // Download from 2 years ago to now (in seconds)
  const twoYearsAgoSec = Math.floor((Date.now() - 2 * 365 * 24 * 60 * 60 * 1000) / 1000);
  console.log(`[Download] Since: ${new Date(twoYearsAgoSec * 1000).toISOString()}`);

  const results = await downloadAllPairs(twoYearsAgoSec, 500);

  // Print summary
  console.log("\n[Download] Summary:");
  for (const [key, ds] of results) {
    console.log(`  ${key}: ${ds.rowCount} candles, ${new Date(ds.firstTimestamp).toISOString()} → ${new Date(ds.lastTimestamp).toISOString()}`);
  }

  console.log(`\n[Download] Done. ${results.size} datasets saved.`);
}

main().catch(e => {
  console.error("[Download] Fatal:", e);
  process.exit(1);
});
