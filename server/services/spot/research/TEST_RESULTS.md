# TEST_RESULTS.md — Fast-Path Research Replay

## 1. TypeScript Compilation
```
npx tsc --noEmit → 0 errors
```

## 2. Equivalence Test: runReplay vs fastReplay

**Command**: `node --import tsx server/services/spot/research/testFastReplayEquivalence.ts`

**Pair**: BTC/USD (full dataset, no evaluation window restriction)

### V3 Enabled (entryV3Config.enabled = true)

| Metric | runReplay | fastReplay | Match |
|--------|-----------|------------|-------|
| tradeCount | 6 | 6 | ✅ |
| signalsBuy | 49 | 49 | ✅ |
| intentExecutable | 7 | 7 | ✅ |
| entriesExecuted | 6 | 6 | ✅ |
| netPnl | -83.76023 | -83.76023 | ✅ |
| grossPnl | -50.26222 | -50.26222 | ✅ |
| totalFees | 33.49801 | 33.49801 | ✅ |
| winRate | 0.3333 | 0.3333 | ✅ |
| profitFactor | 0.25879 | 0.25879 | ✅ |
| wins | 2 | 2 | ✅ |
| losses | 4 | 4 | ✅ |

### Per-Trade Comparison (V3)

| # | lotId | entryPrice | exitPrice | netPnl | exitReason | openedAtMs | closedAtMs | Match |
|---|-------|-----------|-----------|--------|------------|------------|------------|-------|
| 0 | replay-BTC/USD-1 | 71919.9 | 71295.9 | -40.09 | STRUCTURE_INVALIDATION | 1775670600000 | 1775673900000 | ✅ |
| 1 | replay-BTC/USD-2 | 73035.2 | 73111.4 | -3.11 | TIME_EFFICIENCY | 1775844600000 | 1775855700000 | ✅ |
| 2 | replay-BTC/USD-3 | 80500 | 80900.9 | 11.04 | TIME_EFFICIENCY | 1777946700000 | 1777957800000 | ✅ |
| 3 | replay-BTC/USD-4 | 68766.7 | 69335.7 | 18.21 | TIME_EFFICIENCY | 1787171100000 | 1787182200000 | ✅ |
| 4 | replay-BTC/USD-5 | 78011.2 | 77908.6 | -5.34 | STRUCTURE_INVALIDATION | 1787347500000 | 1787358600000 | ✅ |
| 5 | replay-BTC/USD-6 | 78700.5 | 76955 | -64.46 | EMERGENCY | 1787373300000 | 1787376000000 | ✅ |

### B0 (V3 Disabled)

| Metric | runReplay | fastReplay | Match |
|--------|-----------|------------|-------|
| tradeCount | 24 | 24 | ✅ |
| netPnl | -95.37 | -95.37 | ✅ |
| profitFactor | 0.7624 | 0.7624 | ✅ |
| Per-trade (24 trades) | — | — | ✅ all identical |

### Performance

| Metric | Value |
|--------|-------|
| runReplay time | 73,814ms |
| precompute time | 67,745ms |
| fastReplay time | 266ms |
| Speedup (per combo) | 277.5x |
| Speedup (incl precompute) | 1.1x |

**Result: ALL TESTS PASSED**

## 3. Smoke WFO (1 fold, 2 combos, 4 pairs)

**Command**: `node --import tsx server/services/spot/research/runEntryV3Wfo.ts --smoke --max-combos 2`

| Metric | Value |
|--------|-------|
| Precompute | 274.3s |
| WFO runtime | 8.5s |
| Combos/sec | 0.71 |
| Estimated full WFO | 26s |
| Total (precompute + WFO) | ~283s |

## 4. Full WFO (3 folds, 6 combos, 4 pairs)

**Command**: `node --import tsx server/services/spot/research/runEntryV3Wfo.ts`

| Metric | Value |
|--------|-------|
| Precompute | 272.5s |
| WFO runtime | 9.6s |
| Total runtime | 282.1s (~4.7 min) |
| Target | ≤ 20 min ✅ |
| B0 OOS trades | 94 |
| V3 OOS trades | 11 |
| B0 OOS net PnL | $228.34 |
| V3 OOS net PnL | -$90.24 |
| Sample sufficient | NO (11 < 30) |

**Result: WFO COMPLETED SUCCESSFULLY**
