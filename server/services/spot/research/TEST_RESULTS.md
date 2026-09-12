# Test Results — Strict Window + Ablation WFO

## 1. TypeScript Compilation

```
npx tsc --noEmit
```

Result: **PASS** (0 errors)

## 2. git diff --check

Result: **PASS** (no whitespace errors)

## 3. Strict Window Equivalence Test

```
node --import tsx server/services/spot/research/testStrictWindowEquivalence.ts
```

### Results

| Test | Result |
|------|--------|
| FAST_WINDOW_EQUIVALENCE | PASS |
| NO_LEAKAGE | PASS |
| WINDOW_FUTURE_INVARIANCE | PASS |
| BOUNDARY_CLOSE_MATCH | PASS |
| ALL_TESTS | PASS |

Details:
- PAIR=BTC/USD
- WINDOW_START=2026-04-28T08:23:45.000Z
- WINDOW_END=2026-06-12T16:47:30.000Z
- PRECOMPUTE_SEC=80.9
- BOUNDARY_TRADES_FAST=0
- BOUNDARY_TRADES_RUNREPLAY=0
- OLD_POST_BOUNDARY_CLOSES=0

## 4. Full WFO + Ablation Run

```
node --import tsx server/services/spot/research/runEntryV3Wfo.ts --all
```

### Results

| Metric | Value |
|--------|-------|
| FOLDS | 3 |
| COMBOS | 108 |
| PRECOMPUTE_SEC | 347.7 |
| RESEARCH_SEC | 39.8 |
| TOTAL_RUNTIME_SEC | 387.5 |

### B0 (V3 OFF) OOS

| Metric | Value |
|--------|-------|
| Trades | 94 |
| Net PnL | +$228.34 |
| PF | 1.16 |
| Expectancy | +$2.43 |
| Fees | $462.43 |
| Worst Fold DD | $227.25 |
| Worst Pair DD | $227.25 (XRP/USD) |

### Strict V3 (ALL stages) OOS

| Metric | Value |
|--------|-------|
| Trades | 12 |
| Net PnL | -$124.94 |
| PF | 0.44 |
| Expectancy | -$10.41 |
| Fees | $54.21 |
| Worst Fold DD | $64.46 |
| Worst Pair DD | $64.46 (BTC/USD) |

### Ablation Selected OOS

| Metric | Value |
|--------|-------|
| Trades | 22 |
| Net PnL | -$88.76 |
| PF | 0.78 |
| Expectancy | -$4.03 |
| Fees | $95.26 |
| Worst Fold DD | $90.64 |
| Worst Pair DD | $90.64 (SOL/USD) |

### Architecture Selection

| Fold | Architecture |
|------|-------------|
| 0 | NO_RECLAIM |
| 1 | NO_RECLAIM |
| 2 | NO_RETRACEMENT |

- Most common: NO_RECLAIM
- Architecture instability: NO
- OOS sample sufficient: NO (22 < 30)

### Per-Pair OOS

| Pair | B0 Net | Ablation Net |
|------|--------|-------------|
| BTC/USD | +$26.68 | -$65.57 |
| ETH/USD | -$153 | +$40.53 |
| SOL/USD | +$355.77 | +$32.27 |
| XRP/USD | -$1.11 | -$95.99 |

## 5. CSV Files Generated

- STRICT_WINDOW_RESULTS.csv
- STAGE_ATTRIBUTION.csv
- ABLATION_TRAIN.csv
- ABLATION_SELECTED_OOS.csv
- JOINT_WFO_FOLDS.csv
- B0_VS_V3_OOS.csv
- OOS_SUMMARY.csv
- entry-v3-wfo-joint.json
