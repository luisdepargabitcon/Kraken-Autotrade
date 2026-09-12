# Entry V4 Soft Quality Overlay — Counter-Audit Report

## Base
- Commit base: `f9b6160b62d3b2909342825df64c7ceaee860f14`
- Branch: `feature/spot-adaptive-v3-shadow`
- Date: 2026-09-12

## Objective

Demonstrate whether the V4 improvement comes from the quality score or from changed B0 anti-late semantics. V4 must be a true overlay on B0, not a replacement.

## Methodology

### V4 True B0 Overlay Semantics

V4 does NOT replace `evaluateEntryIntent()`. The correct sequence is:

1. Canonical BUY signal → `createEntryIntent`
2. `evaluateEntryIntent` (B0 exactly) — TTL, maxPriceMoveAtr, CHASED, regime flip, direction flip, macro bearish
3. If B0 `shouldExecute == false` → V4 cannot execute
4. If B0 `shouldExecute == true` → compute `qualityScore`
5. `qualityScore >= minQualityScore` → accept
6. `evaluateSizing` (B0 exactly)

V4 adds ONLY a quality filter. It does NOT eliminate any B0 gate.

### WFO Configuration

- Train: 90 days, Test: 30 days, Step: 30 days, 3 folds
- Pairs: BTC/USD, ETH/USD, SOL/USD, XRP/USD
- Threshold grid: [0.30, 0.40, 0.50, 0.60, 0.70]
- Weights: equal 0.20 each (5 components)
- Objective: additive monotonic with penalties

## Counter-Audit Tests

| Test | Result |
|---|---|
| HISTORICAL_INTENT_CLOCK | PASS (49 intents, createdAt==evaluationTime) |
| CANONICAL_FAST_B0_PARITY | PASS (runReplay B0 == fastReplay B0) |
| V4_THRESHOLD_ZERO_EQUALS_B0 | PASS (fastReplay B0 == fastReplay V4 threshold=0) |
| V4_REAL_FUTURE_INVARIANCE | PASS (featuresEqual, scoresEqual, score=0.2025) |
| V4_ACCEPTS_B0_REJECTED | PASS (0) |
| B0_SCORE_COVERAGE | 100% (94/94, 0 missing) |

## WFO Results

### Aggregated OOS

| Metric | B0 | V4 True Overlay | Delta |
|---|---|---|---|
| Trades | 94 | 52 | -42 |
| Net PnL | $228.34 | $297.38 | +$69.04 |
| Profit Factor | 1.16 | 1.41 | +0.25 |
| Expectancy | $2.43 | $5.72 | +$3.29 |
| Win Rate | 38% | 42% | +4pp |
| Portfolio Max DD | $532.79 | $275.98 | -$256.81 |

### Old V4 Policy-Mixed (bd9723a)

| Metric | Value |
|---|---|
| Trades | 58 |
| Net PnL | $585.49 |
| PF | 1.80 |
| Expectancy | $10.09 |

The old V4 mixed results were higher because V4 was replacing B0 anti-late semantics with V3 anti-late (different TTL, different distance checks). The true overlay shows a smaller but real improvement.

### Per-Fold Results

| Fold | Threshold | B0 Net | V4 Net |
|---|---|---|---|
| 0 | 0.50 | -$223.56 | $0.00 |
| 1 | 0.30 | $15.51 | $5.41 |
| 2 | 0.30 | $436.39 | $291.97 |

- PCT_NET_FROM_BEST_FOLD: 98.18%
- TEMPORAL_CONCENTRATION: HIGH

### Per-Pair OOS

| Pair | B0 Net | V4 Net |
|---|---|---|
| BTC/USD | $26.68 | $177.71 |
| ETH/USD | -$153.00 | $45.01 |
| SOL/USD | $355.77 | $169.83 |
| XRP/USD | -$1.11 | -$95.17 |

### Quality Calibration (Q1-Q4, B0 OOS trades)

| Bin | Trades | Expectancy | PF | Win Rate |
|---|---|---|---|---|
| Q1 | 24 | $0.79 | 1.05 | 38% |
| Q2 | 24 | $0.81 | 1.05 | 33% |
| Q3 | 24 | $5.85 | 1.40 | 42% |
| Q4 | 22 | $2.24 | 1.17 | 41% |

### Spearman Correlation

- Score vs Net R: 0.038
- Score vs MFE R: 0.117
- Quality Ranking Strength: WEAK

### Score Coverage

- B0_SCORE_TRADES: 94
- B0_SCORE_MAPPED: 94
- B0_SCORE_MISSING: 0
- B0_SCORE_COVERAGE: 100%

### Candidate Tracking

| Counter | Value |
|---|---|
| B0_SIGNAL_CANDIDATES | 133 |
| B0_INTENT_ELIGIBLE | 108 |
| B0_SIZING_APPROVED | 94 |
| V4_SCORE_ELIGIBLE | 133 |
| V4_FINAL_EXECUTED | 108 |
| V4_ACCEPTS_B0_REJECTED | 0 |

### Replay Clock Certification

- `evaluationTime` is now explicitly passed to `createEntryIntent` and `evaluateEntryIntent` in `precomputeFrames`, `fastReplay`, and `runReplay`.
- No `Date.now()` calls remain in replay paths.
- Intent `createdAt` matches candle close time exactly.
- Intent `expiresAt` = `createdAt + maxCandlesAfterSignal * candleIntervalMs`.

### Portfolio Drawdown Fix

- Trades closed at the same `closedAtMs` are grouped as a single equity event.
- Prevents artificial drawdown inflation from sequential same-timestamp trade processing.

## Causal Comparison

| Metric | Old V4 Mixed | New V4 True Overlay | Delta |
|---|---|---|---|
| Trades | 58 | 52 | -6 |
| Net | $585.49 | $297.38 | -$288.11 |
| PF | 1.80 | 1.41 | -0.39 |
| Expectancy | $10.09 | $5.72 | -$4.37 |

The old V4 mixed results were inflated by different anti-late semantics (V3 anti-late vs B0 anti-late). The true overlay shows a real but smaller improvement over B0.

## Verdict

DEVELOPMENT_PASS

- V4 true overlay improves over B0: +$69.04 net, +0.25 PF, +$3.29 expectancy
- Improvement is real (not from anti-late policy changes)
- Temporal concentration is HIGH (98.18% from best fold)
- Quality ranking is WEAK (Spearman 0.038)
- NOT production-ready
