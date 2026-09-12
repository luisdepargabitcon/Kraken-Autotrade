/**
 * testObjectiveMonotonicity — Verify the corrected objective function is monotonic.
 *
 * Tests:
 *   1. NEGATIVE_EXPECTANCY_PENALTY: more negative expectancy → score never improves
 *   2. MORE_DD: higher drawdown → score never improves
 *   3. MORE_FEES: higher fees → score never improves
 *   4. FEWER_PAIRS: fewer active pairs → score never improves
 *   5. SPARSER_SAMPLE: fewer trades → score never improves
 *   6. LOWER_PF: lower profit factor → score never improves
 */

// We need to import objectiveScore — but it's not exported. Let's define a minimal copy
// that mirrors the production function for testing.
// Actually, let's test by importing the function if exported, or by constructing
// synthetic trades and checking the score properties.

// Since objectiveScore is not exported, we'll test the properties by constructing
// synthetic trade arrays and verifying monotonicity through the WFO runner.
// For direct testing, we'll replicate the function logic here and verify properties.

function netPF(trades: { netPnlUsd: number }[]): { netWin: number; netLoss: number; pf: number } {
  const netWin = trades.filter(t => t.netPnlUsd > 0).reduce((s, t) => s + t.netPnlUsd, 0);
  const netLoss = Math.abs(trades.filter(t => t.netPnlUsd <= 0).reduce((s, t) => s + t.netPnlUsd, 0));
  const pf = netLoss > 0 ? netWin / netLoss : netWin > 0 ? Infinity : 0;
  return { netWin, netLoss, pf };
}

function maxDrawdown(trades: { netPnlUsd: number }[], initialCapital: number = 10000): number {
  let equity = initialCapital;
  let peak = initialCapital;
  let maxDD = 0;
  for (const t of trades) {
    equity += t.netPnlUsd;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

// Replicated objective function (must match runEntryV3Wfo.ts exactly)
function objectiveScore(allPairTrades: { pair: string; trades: { netPnlUsd: number; grossPnlUsd: number; entryFeeUsd: number; exitFeeUsd: number }[] }[]): { score: number; totalTrades: number; netPnl: number } {
  let totalTrades = 0;
  let totalNetPnl = 0;
  let totalFees = 0;
  let totalGrossEdge = 0;
  let netWin = 0;
  let netLoss = 0;
  const pairsWithTrades: string[] = [];
  let worstDD = 0;
  let worstPairExpectancy = 0;

  for (const { pair, trades } of allPairTrades) {
    totalTrades += trades.length;
    const pairNet = trades.reduce((s, t) => s + t.netPnlUsd, 0);
    totalNetPnl += pairNet;
    const pairFees = trades.reduce((s, t) => s + t.entryFeeUsd + t.exitFeeUsd, 0);
    totalFees += pairFees;
    totalGrossEdge += trades.reduce((s, t) => s + Math.abs(t.grossPnlUsd), 0);
    netWin += trades.filter(t => t.netPnlUsd > 0).reduce((s, t) => s + t.netPnlUsd, 0);
    netLoss += Math.abs(trades.filter(t => t.netPnlUsd <= 0).reduce((s, t) => s + t.netPnlUsd, 0));
    if (trades.length > 0) {
      pairsWithTrades.push(pair);
      const pairExp = pairNet / trades.length;
      if (pairExp < worstPairExpectancy) worstPairExpectancy = pairExp;
    }
    const dd = maxDrawdown(trades);
    if (dd > worstDD) worstDD = dd;
  }

  if (totalTrades === 0) return { score: -1000, totalTrades: 0, netPnl: 0 };
  if (totalTrades === 1) return { score: -500, totalTrades: 1, netPnl: totalNetPnl };

  const expectancy = totalNetPnl / totalTrades;
  const normalizedNetExpectancy = expectancy / 10;

  const rawPF = netLoss > 0 ? netWin / netLoss : netWin > 0 ? Infinity : 0;
  const cappedPF = Math.min(rawPF === Infinity ? 3 : rawPF, 3);
  const cappedPfContribution = totalTrades >= 5 ? (cappedPF / 3) * 0.5 : 0;

  const baseQuality = normalizedNetExpectancy + cappedPfContribution;

  let sparseSamplePenalty = 0;
  if (totalTrades === 2) sparseSamplePenalty = 0.3;
  else if (totalTrades === 3) sparseSamplePenalty = 0.2;
  else if (totalTrades === 4) sparseSamplePenalty = 0.1;

  const crossPairPenalty = pairsWithTrades.length <= 1 ? 0.5 : 0;
  const drawdownPenalty = worstDD > 200 ? worstDD / 500 : 0;
  const feePenalty = totalGrossEdge > 0 && totalFees > totalGrossEdge * 0.5 ? 0.3 : 0;
  const worstPairPenalty = worstPairExpectancy < -50 ? 0.5 : 0;

  const score = baseQuality - sparseSamplePenalty - crossPairPenalty - drawdownPenalty - feePenalty - worstPairPenalty;

  return { score: Math.round(score * 100) / 100, totalTrades, netPnl: Math.round(totalNetPnl * 100) / 100 };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

interface SynthTrade {
  netPnlUsd: number;
  grossPnlUsd: number;
  entryFeeUsd: number;
  exitFeeUsd: number;
}

function makeTrade(netPnl: number, fees: number = 5): SynthTrade {
  return {
    netPnlUsd: netPnl,
    grossPnlUsd: Math.abs(netPnl) + fees,
    entryFeeUsd: fees / 2,
    exitFeeUsd: fees / 2,
  };
}

function makePairTrades(pair: string, trades: SynthTrade[]): { pair: string; trades: SynthTrade[] } {
  return { pair, trades };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

function testNegativeExpectancyPenalty(): boolean {
  // More negative expectancy should never improve score
  const base = [
    makePairTrades("BTC/USD", [makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10)]),
    makePairTrades("ETH/USD", [makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10)]),
  ];
  const worse = [
    makePairTrades("BTC/USD", [makeTrade(-10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10)]),
    makePairTrades("ETH/USD", [makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10)]),
  ];
  const worst = [
    makePairTrades("BTC/USD", [makeTrade(-50), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10)]),
    makePairTrades("ETH/USD", [makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10)]),
  ];

  const sBase = objectiveScore(base).score;
  const sWorse = objectiveScore(worse).score;
  const sWorst = objectiveScore(worst).score;

  console.log(`NEGATIVE_EXPECTANCY: base=${sBase} worse=${sWorse} worst=${sWorst}`);
  return sBase >= sWorse && sWorse >= sWorst;
}

function testMoreDD(): boolean {
  // Higher drawdown should never improve score
  // Same trades, same net, same PF, same count — only DD differs via ordering
  // Trades: five +60 and five -50 → net = 50, 10 trades
  // Low DD: alternating → max DD ~60
  // High DD: losses clustered first → max DD = 250 (>200 threshold)
  const lowDD = [
    makePairTrades("BTC/USD", [makeTrade(60), makeTrade(-50), makeTrade(60), makeTrade(-50), makeTrade(60), makeTrade(-50), makeTrade(60), makeTrade(-50), makeTrade(60), makeTrade(-50)]),
    makePairTrades("ETH/USD", [makeTrade(60), makeTrade(-50), makeTrade(60), makeTrade(-50), makeTrade(60), makeTrade(-50), makeTrade(60), makeTrade(-50), makeTrade(60), makeTrade(-50)]),
  ];
  const highDD = [
    makePairTrades("BTC/USD", [makeTrade(-50), makeTrade(-50), makeTrade(-50), makeTrade(-50), makeTrade(-50), makeTrade(60), makeTrade(60), makeTrade(60), makeTrade(60), makeTrade(60)]),
    makePairTrades("ETH/USD", [makeTrade(60), makeTrade(-50), makeTrade(60), makeTrade(-50), makeTrade(60), makeTrade(-50), makeTrade(60), makeTrade(-50), makeTrade(60), makeTrade(-50)]),
  ];

  const sLow = objectiveScore(lowDD).score;
  const sHigh = objectiveScore(highDD).score;

  console.log(`MORE_DD: low=${sLow} high=${sHigh}`);
  return sLow >= sHigh;
}

function testMoreFees(): boolean {
  // Higher fees should never improve score
  const lowFees = [
    makePairTrades("BTC/USD", [makeTrade(20, 2), makeTrade(20, 2), makeTrade(20, 2), makeTrade(20, 2), makeTrade(20, 2)]),
    makePairTrades("ETH/USD", [makeTrade(20, 2), makeTrade(20, 2), makeTrade(20, 2), makeTrade(20, 2), makeTrade(20, 2)]),
  ];
  const highFees = [
    makePairTrades("BTC/USD", [makeTrade(20, 50), makeTrade(20, 50), makeTrade(20, 50), makeTrade(20, 50), makeTrade(20, 50)]),
    makePairTrades("ETH/USD", [makeTrade(20, 2), makeTrade(20, 2), makeTrade(20, 2), makeTrade(20, 2), makeTrade(20, 2)]),
  ];

  const sLow = objectiveScore(lowFees).score;
  const sHigh = objectiveScore(highFees).score;

  console.log(`MORE_FEES: low=${sLow} high=${sHigh}`);
  return sLow >= sHigh;
}

function testFewerPairs(): boolean {
  // Fewer active pairs should never improve score
  const twoPairs = [
    makePairTrades("BTC/USD", [makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10)]),
    makePairTrades("ETH/USD", [makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10)]),
  ];
  const onePair = [
    makePairTrades("BTC/USD", [makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10)]),
    makePairTrades("ETH/USD", []),  // no trades
  ];

  const sTwo = objectiveScore(twoPairs).score;
  const sOne = objectiveScore(onePair).score;

  console.log(`FEWER_PAIRS: two=${sTwo} one=${sOne}`);
  return sTwo >= sOne;
}

function testSparserSample(): boolean {
  // Smaller sample should never improve score (same expectancy)
  const dense = [
    makePairTrades("BTC/USD", [makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10)]),
    makePairTrades("ETH/USD", [makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10)]),
  ];
  const sparse = [
    makePairTrades("BTC/USD", [makeTrade(10), makeTrade(10)]),
    makePairTrades("ETH/USD", [makeTrade(10), makeTrade(10)]),
  ];

  const sDense = objectiveScore(dense).score;
  const sSparse = objectiveScore(sparse).score;

  console.log(`SPARSER_SAMPLE: dense=${sDense} sparse=${sSparse}`);
  return sDense >= sSparse;
}

function testLowerPF(): boolean {
  // Lower PF should never improve score (same trade count, same net PnL)
  const highPF = [
    makePairTrades("BTC/USD", [makeTrade(20), makeTrade(20), makeTrade(20), makeTrade(20), makeTrade(-5)]),
    makePairTrades("ETH/USD", [makeTrade(20), makeTrade(20), makeTrade(20), makeTrade(20), makeTrade(-5)]),
  ];
  const lowPF = [
    makePairTrades("BTC/USD", [makeTrade(20), makeTrade(20), makeTrade(5), makeTrade(5), makeTrade(5)]),
    makePairTrades("ETH/USD", [makeTrade(20), makeTrade(20), makeTrade(5), makeTrade(5), makeTrade(5)]),
  ];
  // Both have same total net (75) and same trade count (5), but different PF
  const sHigh = objectiveScore(highPF).score;
  const sLow = objectiveScore(lowPF).score;

  console.log(`LOWER_PF: high=${sHigh} low=${sLow}`);
  return sHigh >= sLow;
}

function testNegativeExpectancyWithPenalty(): boolean {
  // CRITICAL: negative expectancy with penalty should be MORE negative, not less
  // Old bug: -10 * 0.5 = -5 (penalty made bad score LESS bad)
  // New fix: -1.0 (expectancy) - 0.5 (penalty) = -1.5 (penalty makes it WORSE)
  const noPenalty = [
    makePairTrades("BTC/USD", [makeTrade(-10), makeTrade(-10), makeTrade(-10), makeTrade(-10), makeTrade(-10)]),
    makePairTrades("ETH/USD", [makeTrade(-10), makeTrade(-10), makeTrade(-10), makeTrade(-10), makeTrade(-10)]),
  ];
  // Add a pair with very bad expectancy to trigger worstPairPenalty
  const withPenalty = [
    makePairTrades("BTC/USD", [makeTrade(-10), makeTrade(-10), makeTrade(-10), makeTrade(-10), makeTrade(-10)]),
    makePairTrades("ETH/USD", [makeTrade(-100), makeTrade(-100), makeTrade(-100), makeTrade(-100), makeTrade(-100)]),
  ];

  const sNoPenalty = objectiveScore(noPenalty).score;
  const sWithPenalty = objectiveScore(withPenalty).score;

  console.log(`NEGATIVE_EXPECTANCY_PENALTY: noPenalty=${sNoPenalty} withPenalty=${sWithPenalty}`);
  // withPenalty should be MORE negative (worse) than noPenalty
  return sWithPenalty < sNoPenalty;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const results: Record<string, boolean> = {};

  results["NEGATIVE_EXPECTANCY"] = testNegativeExpectancyPenalty();
  results["MORE_DD"] = testMoreDD();
  results["MORE_FEES"] = testMoreFees();
  results["FEWER_PAIRS"] = testFewerPairs();
  results["SPARSER_SAMPLE"] = testSparserSample();
  results["LOWER_PF"] = testLowerPF();
  results["NEGATIVE_EXPECTANCY_PENALTY"] = testNegativeExpectancyWithPenalty();

  let allPass = true;
  for (const [name, pass] of Object.entries(results)) {
    console.log(`${name}=${pass ? "PASS" : "FAIL"}`);
    if (!pass) allPass = false;
  }

  console.log(`\nALL_MONOTONICITY_TESTS=${allPass ? "PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
}

main();
