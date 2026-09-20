/**
 * Microbenchmark: Run baseline replay for BTC/USD 7 days to measure throughput.
 * Usage: npx tsx server/services/spot/research/microbenchmark.ts
 */

import { runBaselineForPair } from "./spotBaselineResearch";
import { loadAllCached } from "./krakenHistoricalLoader";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function main() {
  console.log("[Microbenchmark] Loading cached datasets...");
  const datasets = loadAllCached();
  console.log(`[Microbenchmark] Loaded ${datasets.size} datasets`);

  const btc5m = datasets.get("BTC/USD_5m");
  if (!btc5m) {
    console.error("[Microbenchmark] BTC/USD 5m dataset not found");
    process.exit(1);
  }

  // Use last 7 days of BTC/USD data
  const endTs = btc5m.lastTimestamp;
  const startTs = endTs - SEVEN_DAYS_MS;

  console.log(`[Microbenchmark] BTC/USD 7-day window: ${new Date(startTs).toISOString()} → ${new Date(endTs).toISOString()}`);

  const t0 = Date.now();
  const result = runBaselineForPair("BTC/USD", datasets, "7D", startTs, endTs);
  const elapsed = Date.now() - t0;

  if (!result) {
    console.error("[Microbenchmark] No result (insufficient candles?)");
    process.exit(1);
  }

  const candles = result.metrics.candlesAnalyzed;
  const trades = result.metrics.entriesExecuted;
  const candlesPerSec = candles / (elapsed / 1000);

  // 180 days = 180/7 ≈ 25.7x the 7-day window
  // 4 pairs = 4x
  // But COMMON window adds another ~4 runs
  // Total = 8 runs × 25.7x = ~205x the 7-day runtime
  // Actually: 180 days has ~52k 5m candles, 7 days has ~2k 5m candles
  // So 180-day run = ~26x the 7-day run
  // 8 runs (4 FULL + 4 COMMON) = 8 × 26x = ~208x
  // But COMMON windows are same size as FULL, so it's 8 × 26x
  // Actually: 4 FULL + 4 COMMON, each ~52k candles = 8 × 52k = 416k candles
  // 7-day = ~2k candles
  // Ratio = 416k / 2k = 208x
  const estimatedFullRuntime = (elapsed * 208) / 1000 / 60; // minutes

  console.log(`[Microbenchmark] Results:`);
  console.log(`  Candles analyzed: ${candles}`);
  console.log(`  Trades: ${trades}`);
  console.log(`  Elapsed: ${elapsed}ms (${(elapsed / 1000).toFixed(2)}s)`);
  console.log(`  Throughput: ${candlesPerSec.toFixed(0)} candles/sec`);
  console.log(`  Estimated full baseline (8 runs × 180 days): ${estimatedFullRuntime.toFixed(1)} minutes`);
  console.log(`  Deterministic: ${result.deterministic}`);

  if (estimatedFullRuntime > 30) {
    console.log(`[Microbenchmark] WARNING: Estimated runtime > 30 minutes. Consider further optimization.`);
  } else {
    console.log(`[Microbenchmark] ETA within 30 minutes — safe to run full baseline.`);
  }
}

main().catch(e => {
  console.error("[Microbenchmark] Fatal:", e);
  process.exit(1);
});
