# WFO Entry V3 — Fast-Path Research Report

## Date
2026-09-12

## Objective
Refactor Walk-Forward Optimization (WFO) for Entry V3 using a fast-path research mechanism: precompute `ReplayFrame[]` per pair with signals and V3 raw features, then run numerical threshold checks per parameter combo. Achieve strict equivalence with `runReplay()` and reduce WFO runtime to ≤ 20 min.

## Methodology

### Fast-Path Architecture
1. **Precompute** (once per pair): `precomputeFrames()` iterates all 5m candles, builds `SpotMarketContext` via `buildReplayContextFast`, evaluates `evaluateSpotCanonical` for signals, and `extractV3Features` for V3 raw features. Stores lightweight frames (no ctx) + sorted candle arrays for on-demand ctx rebuild.
2. **Fast Replay** (per combo): `fastReplay()` iterates precomputed frames, applies V3 threshold checks numerically via `checkV3Acceptance()`, rebuilds ctx only when needed (exit evaluation for open positions, sizing for accepted entries).

### WFO Configuration
- **Folds**: 3 (90-day train, 30-day test, 30-day step)
- **Parameter Grid**: 6 combos varying `impulseMinAtr`, `retracementMinAtr`, `maxEntryDistanceAtr`, `resumptionMinBodyPct`
- **Pairs**: BTC/USD, ETH/USD, SOL/USD, XRP/USD
- **Objective**: `expectancy × tradeCountFactor × crossPairFactor × ddPenalty`
- **Fee Model**: Kraken taker 0.09%, maker 0.00% (ESTIMATED)
- **Capital**: $10,000 per pair

## Equivalence Test Results

| Check | runReplay | fastReplay | Match |
|-------|-----------|------------|-------|
| V3 tradeCount | 6 | 6 | ✅ |
| V3 signalsBuy | 49 | 49 | ✅ |
| V3 netPnl | -83.76 | -83.76 | ✅ |
| V3 profitFactor | 0.2588 | 0.2588 | ✅ |
| B0 tradeCount | 24 | 24 | ✅ |
| B0 netPnl | -95.37 | -95.37 | ✅ |
| Per-trade entry/exit/PnL/fees | — | — | ✅ all identical |

**Speedup**: 277x per combo (266ms vs 73.8s). Precompute: 67.7s (one-time).

## WFO Results

### Aggregated OOS (Out-of-Sample)

| Metric | B0 (Baseline) | V3 (Best Params) | Delta |
|--------|-------------|-----------------|-------|
| Trades | 94 | 11 | -83 |
| Net PnL | $228.34 | -$90.24 | -$318.58 |
| Profit Factor | 1.161 | 0.519 | — |
| Expectancy | $2.43 | -$8.20 | -$10.63 |
| Fees | $462.43 | $45.79 | -$416.64 |
| Win Rate | 38.3% | 36.4% | — |
| Worst Fold DD | — | $227.25 | — |
| Sample Sufficient | — | NO (11 < 30) | — |

### Per-Fold Best Parameters

| Fold | Train Period | Best impulseMinAtr | retracementMinAtr | maxEntryDistanceAtr | resumptionMinBodyPct | Train Score | Train Trades |
|------|-------------|-------------------|-------------------|--------------------|--------------------|-------------|-------------|
| 0 | Mar 14 → Jun 12 | 1.5 | 0.5 | 2.0 | 0.003 | -0.17 | 2 |
| 1 | Apr 13 → Jul 12 | 1.5 | 0.5 | 2.0 | 0.003 | 0.38 | 2 |
| 2 | May 13 → Aug 11 | 0.8 | 0.2 | 1.0 | 0.0005 | -1.34 | 2 |

### Per-Pair OOS Summary

| Pair | B0 Trades | B0 Net | B0 PF | V3 Trades | V3 Net | V3 PF |
|------|-----------|--------|-------|-----------|--------|-------|
| BTC/USD | 14 | $26.68 | 1.11 | 2 | -$46.25 | 0.28 |
| ETH/USD | 27 | -$153.00 | 0.62 | 2 | $40.53 | ∞ |
| SOL/USD | 38 | $355.77 | 1.78 | 6 | -$67.25 | 0.36 |
| XRP/USD | 15 | -$1.11 | 1.00 | 1 | -$17.27 | 0.00 |

## Performance

| Phase | Time |
|-------|------|
| Precompute (4 pairs) | 272.5s |
| WFO (18 combos) | 9.6s |
| **Total** | **282.1s (~4.7 min)** |
| Target | ≤ 20 min ✅ |

## Conclusions

1. **V3 Entry filter is too restrictive**: Only 11 OOS trades vs 94 B0 trades. Sample insufficient (11 < 30 minimum).
2. **V3 degrades performance**: Net PnL drops from $228.34 (B0) to -$90.24 (V3). V3 PF 0.519 vs B0 PF 1.161.
3. **Parameter instability**: Best params vary across folds (fold 0/1 select strict params, fold 2 selects loose params), indicating overfitting risk.
4. **Recommendation**: V3 entry filter in current form does not improve OOS performance. Consider expanding the parameter grid or revisiting V3 logic before production deployment.

## Files

- `server/services/spot/research/fastResearchReplay.ts` — Precompute + fast replay
- `server/services/spot/research/runEntryV3Wfo.ts` — WFO runner (uses fast path)
- `server/services/spot/research/testFastReplayEquivalence.ts` — Equivalence test
- `server/services/spot/spotReplayEngine.ts` — Exported `buildReplayContextFast`
- Results: `SPOT_ADAPTIVE_V3_DATA/kraken/results/` (CSVs + JSON)
