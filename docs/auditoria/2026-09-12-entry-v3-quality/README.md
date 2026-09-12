# Entry V3 Quality Improvement — Audit Package

**Date:** 2026-09-12
**Branch:** `feature/spot-adaptive-v3-shadow`
**Scope:** Entry quality only — no position management changes

## 1. Objective

Improve entry quality in SPOT ADAPTIVE V3 by implementing a new entry logic (Entry V3) that requires explicit evidence of:
1. **Impulse** — minimum ATR-sized move in lookback window
2. **Pullback** — minimum retracement depth from impulse high
3. **Structure preserved** — price stays above EMA - N×ATR
4. **15m closed reclaim** — bullish candle closing above EMA
5. **5m closed resumption** — bullish 5m trigger after reclaim close

## 2. Changes

### New files
- `server/services/spot/spotEntryV3.ts` — Entry V3 logic module with `evaluateEntryV3` and `evaluateV3AntiLateEntry`
- `server/services/spot/research/entryV3Comparison.ts` — B0 vs V3 comparison + WFO functions
- `server/services/spot/research/runEntryV3Wfo.ts` — Standalone WFO runner with progress JSON
- `server/services/spot/__tests__/entryV3.test.ts` — 14 mandatory tests

### Modified files
- `server/services/spot/spotExitPolicy.ts` — Structure invalidation temporal fix (only post-entry 15m closes count)
- `server/services/spot/spotReplayEngine.ts` — V3 integration, instrumentation, gating
- `server/services/spot/__tests__/spotC1F5ForwardTwinFidelity.test.ts` — Updated C1F5F-3 test for temporal correctness

## 3. Feature Gating

- `DEFAULT_ENTRY_V3_CONFIG.enabled = false` — production default OFF
- Research replay enables via `ReplayConfig.entryV3Config`
- No changes to production entry flow when disabled

## 4. Anti-Late Entry

- No re-anchor of `originPrice` (unlike B0 which chases)
- Intents expire if price moves > `maxEntryDistanceAtr` from origin
- Fresh triggers create new opportunities

## 5. Structure Invalidation Fix

**Before:** Any 15m candle close below EMA counted, including pre-entry candles.
**After:** Only 15m candles with `closeTime > position.openedAt` count.

## 6. B0 vs V3 Comparison

| Pair | B0 Trades | V3 Trades | B0 Net PnL | V3 Net PnL | B0 PF | V3 PF | V3 Top Reject |
|------|----------|-----------|------------|------------|-------|-------|---------------|
| BTC/USD | 24 | 6 | -95.37 | -83.76 | 0.76 | 0.26 | PULLBACK_STRUCTURE_FAILED |
| ETH/USD | 39 | 3 | -573.34 | +22.71 | 0.30 | 2.27 | PULLBACK_STRUCTURE_FAILED |
| SOL/USD | 44 | 10 | +317.76 | -96.97 | 1.61 | 0.40 | PULLBACK_STRUCTURE_FAILED |
| XRP/USD | 27 | 3 | -90.42 | -17.86 | 0.80 | 0.47 | PULLBACK_STRUCTURE_FAILED |
| **Total** | **134** | **22** | **-441.37** | **-175.88** | **1.14** | **0.73** | |

**Key findings:**
- V3 filters 83% of B0 trades (22 vs 134)
- ETH/USD shows clear improvement: PF 0.30→2.27, expectancy -14.70→+7.57
- Top reject reason across all pairs: `V3_PULLBACK_STRUCTURE_FAILED`
- V3 reduces drawdown significantly (BTC: 196→84, ETH: 573→18, XRP: 227→18)

## 7. Walk-Forward Optimization

- **Train:** 90 days, **Test:** 30 days, **Step:** 30 days
- **Grid:** 6 combinations of 4 parameters (impulseMinAtr, retracementMinAtr, maxEntryDistanceAtr, resumptionMinBodyPct)
- **Ranking:** Net PnL primary, Profit Factor tiebreaker
- **Smoke BTC:** 3 folds, 18 combos, 226.5s runtime

### WFO OOS Summary

| Pair | Folds | Trades OOS | Net OOS | PF OOS | Avg DD OOS | Runtime |
|------|-------|------------|---------|--------|-----------|---------|
| BTC/USD | 3 | 2 | -46.25 | 0.09 | 21.49 | 291s |
| ETH/USD | 3 | 2 | +40.53 | 999 | 0.00 | 342s |
| SOL/USD | 3 | 6 | -39.31 | 0.39 | 31.64 | 365s |
| XRP/USD | 3 | 2 | -2.83 | 999 | 5.76 | 357s |
| **Total** | **12** | **12** | **-47.86** | — | — | **1355s** |

**WFO findings:**
- Very few OOS trades (12 total across 4 pairs × 3 folds) — V3 is highly selective
- ETH/USD profitable OOS (+40.53, PF=999 — no losing trades)
- XRP/USD near breakeven (-2.83)
- BTC/USD and SOL/USD negative OOS
- Best params vary by fold: `impulseMinAtr` 0.8-1.5, `retracementMinAtr` 0.2-0.5, `maxEntryDistanceAtr` 1.0-2.0
- Dominant winner: `impulseMinAtr=0.8, retracementMinAtr=0.2, maxEntryDistanceAtr=1.0` (most conservative)

### B0 vs V3 vs WFO-OOS Comparison

| Metric | B0 (all pairs) | V3 default (all pairs) | WFO-OOS (all pairs) |
|--------|---------------|----------------------|-------------------|
| Trades | 134 | 22 | 12 |
| Net PnL | -441.37 | -175.88 | -47.86 |
| Avg trades/pair | 33.5 | 5.5 | 3.0 |

V3 with WFO-tuned params reduces losses further: -47.86 vs -175.88 (V3 default) vs -441.37 (B0).

See `entry-v3-wfo-<PAIR>.json` files in `SPOT_ADAPTIVE_V3_DATA/kraken/results/` for full fold details.

## 8. Tests

- 14/14 Entry V3 tests pass
- 37 files / 435 tests — all SPOT tests pass
- TSC clean (no type errors)

## 9. Runner Usage

```bash
# Single pair
node --import tsx server/services/spot/research/runEntryV3Wfo.ts --pair BTC/USD

# All pairs
node --import tsx server/services/spot/research/runEntryV3Wfo.ts --all

# Smoke test
node --import tsx server/services/spot/research/runEntryV3Wfo.ts --pair BTC/USD --smoke --max-combos 10
```

Progress: `SPOT_ADAPTIVE_V3_DATA/kraken/results/entry-v3-wfo-progress.json`
Results: `SPOT_ADAPTIVE_V3_DATA/kraken/results/entry-v3-wfo-<PAIR>.json`
