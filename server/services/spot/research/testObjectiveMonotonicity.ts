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

import { objectiveScore, type ObjectiveTrade } from "./runEntryV3Wfo";

// ─── Helpers ───────────────────────────────────────────────────────────────

interface SynthTrade extends ObjectiveTrade {}

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
  const twoPairs = [
    makePairTrades("BTC/USD", [makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10)]),
    makePairTrades("ETH/USD", [makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10)]),
  ];
  const onePair = [
    makePairTrades("BTC/USD", [makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10), makeTrade(10)]),
    makePairTrades("ETH/USD", []),
  ];

  const sTwo = objectiveScore(twoPairs).score;
  const sOne = objectiveScore(onePair).score;

  console.log(`FEWER_PAIRS: two=${sTwo} one=${sOne}`);
  return sTwo >= sOne;
}

function testSparserSample(): boolean {
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
  const highPF = [
    makePairTrades("BTC/USD", [makeTrade(20), makeTrade(20), makeTrade(20), makeTrade(20), makeTrade(-5)]),
    makePairTrades("ETH/USD", [makeTrade(20), makeTrade(20), makeTrade(20), makeTrade(20), makeTrade(-5)]),
  ];
  const lowPF = [
    makePairTrades("BTC/USD", [makeTrade(20), makeTrade(20), makeTrade(5), makeTrade(5), makeTrade(5)]),
    makePairTrades("ETH/USD", [makeTrade(20), makeTrade(20), makeTrade(5), makeTrade(5), makeTrade(5)]),
  ];
  const sHigh = objectiveScore(highPF).score;
  const sLow = objectiveScore(lowPF).score;

  console.log(`LOWER_PF: high=${sHigh} low=${sLow}`);
  return sHigh >= sLow;
}

function testNegativeExpectancyWithPenalty(): boolean {
  const noPenalty = [
    makePairTrades("BTC/USD", [makeTrade(-10), makeTrade(-10), makeTrade(-10), makeTrade(-10), makeTrade(-10)]),
    makePairTrades("ETH/USD", [makeTrade(-10), makeTrade(-10), makeTrade(-10), makeTrade(-10), makeTrade(-10)]),
  ];
  const withPenalty = [
    makePairTrades("BTC/USD", [makeTrade(-10), makeTrade(-10), makeTrade(-10), makeTrade(-10), makeTrade(-10)]),
    makePairTrades("ETH/USD", [makeTrade(-100), makeTrade(-100), makeTrade(-100), makeTrade(-100), makeTrade(-100)]),
  ];

  const sNoPenalty = objectiveScore(noPenalty).score;
  const sWithPenalty = objectiveScore(withPenalty).score;

  console.log(`NEGATIVE_EXPECTANCY_PENALTY: noPenalty=${sNoPenalty} withPenalty=${sWithPenalty}`);
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
