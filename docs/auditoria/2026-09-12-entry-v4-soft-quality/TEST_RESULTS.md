# Entry V4 Soft Quality Overlay — Test Results

## Compilation

| Check | Result |
|---|---|
| tsc --noEmit | PASS |
| git diff --check | PASS |

## Counter-Audit Tests (testEntryV4CounterAudit.ts — real data, BTC/USD)

| Test | Result |
|---|---|
| HISTORICAL_INTENT_CLOCK | PASS (49 intents, createdAt==evaluationTime, expiresAt correct) |
| CANONICAL_FAST_B0_PARITY | PASS (runReplay B0 == fastReplay B0, all trade fields match) |
| V4_THRESHOLD_ZERO_EQUALS_B0 | PASS (fastReplay B0 == fastReplay V4 threshold=0, exact trade equality) |
| V4_REAL_FUTURE_INVARIANCE | PASS (featuresEqual=true, scoresEqual=true, score=0.2025) |
| V4_ACCEPTS_B0_REJECTED | PASS (0 B0-rejected candidates accepted by V4) |
| B0_SCORE_COVERAGE | PASS (100%, 24/24 mapped, 0 missing) |

**ALL_V4_COUNTER_AUDIT_TESTS=PASS**

## Original V4 Tests (testEntryV4.ts)

| Test | Result |
|---|---|
| QUALITY_SCORE_RANGE | PASS |
| QUALITY_SCORE_DETERMINISTIC | PASS |
| QUALITY_SCORE_NO_LOOKAHEAD | PASS |
| QUALITY_SCORE_MONOTONIC_COMPONENTS | PASS |
| V4_DEFAULT_RESEARCH_ONLY | PASS |
| V4_SIZING_UNCHANGED | PASS |
| V4_PAIR_INDEPENDENT | PASS |
| V4_FAST_REPLAY_EQUIVALENCE | PASS |

**ALL_V4_TESTS=PASS**

## Objective Monotonicity Tests (testObjectiveMonotonicity.ts)

| Test | Result |
|---|---|
| NEGATIVE_EXPECTANCY | PASS |
| MORE_DD | PASS |
| MORE_FEES | PASS |
| FEWER_PAIRS | PASS |
| SPARSER_SAMPLE | PASS |
| LOWER_PF | PASS |
| NEGATIVE_EXPECTANCY_PENALTY | PASS |

**ALL_MONOTONICITY_TESTS=PASS**

## Fast Replay Equivalence (testFastReplayEquivalence.ts)

| Check | Result |
|---|---|
| V3 tradeCount | OK (6) |
| V3 netPnl | OK |
| V3 trade[0-5] fields | OK |
| B0 tradeCount | OK (24) |
| B0 netPnl | OK |
| B0 trade[0-23] fields | OK |

**ALL TESTS PASSED**

## WFO Run

| Parameter | Value |
|---|---|
| Folds | 3 |
| Combos | 15 |
| Precompute sec | 212.7 |
| Research sec | 10.8 |
| Total runtime sec | 223.5 |

### B0 OOS

| Metric | Value |
|---|---|
| Trades | 94 |
| Net | $228.34 |
| PF | 1.16 |
| Expectancy | $2.43 |
| Win Rate | 0.38 |
| Worst Fold DD | $227.25 |
| Worst Pair DD | $227.25 (XRP/USD) |
| Portfolio Max DD | $532.79 |

### V4 True Overlay OOS

| Metric | Value |
|---|---|
| Trades | 52 |
| Net | $297.38 |
| PF | 1.41 |
| Expectancy | $5.72 |
| Win Rate | 0.42 |
| Worst Fold DD | $217.63 |
| Worst Pair DD | $217.63 (XRP/USD) |
| Portfolio Max DD | $275.98 |

### Candidate Counters

| Counter | Value |
|---|---|
| B0_SIGNAL_CANDIDATES | 133 |
| B0_INTENT_ELIGIBLE | 108 |
| B0_SIZING_APPROVED | 94 |
| V4_SCORE_ELIGIBLE | 133 |
| V4_FINAL_EXECUTED | 108 |
| V4_ACCEPTS_B0_REJECTED | 0 |
| B0_SCORE_COVERAGE | 100% |

### Per-Fold Results

| Fold | Threshold | B0 Trades | V4 Trades | B0 Net | V4 Net |
|---|---|---|---|---|---|
| 0 | 0.5 | 16 | 0 | -$223.56 | $0.00 |
| 1 | 0.3 | 14 | 5 | $15.51 | $5.41 |
| 2 | 0.3 | 64 | 47 | $436.39 | $291.97 |

### Per-Pair Results

| Pair | B0 Net | V4 Net |
|---|---|---|
| BTC/USD | $26.68 | $177.71 |
| ETH/USD | -$153.00 | $45.01 |
| SOL/USD | $355.77 | $169.83 |
| XRP/USD | -$1.11 | -$95.17 |

### Score Bins

| Bin | Trades | Expectancy | PF | Win Rate |
|---|---|---|---|---|
| Q1 | 24 | $0.79 | 1.05 | 0.38 |
| Q2 | 24 | $0.81 | 1.05 | 0.33 |
| Q3 | 24 | $5.85 | 1.40 | 0.42 |
| Q4 | 22 | $2.24 | 1.17 | 0.41 |

### Robustness

| Metric | Value |
|---|---|
| Threshold Stability | MEDIUM |
| PCT Net From Best Fold | 98.18% |
| Temporal Concentration | HIGH |
| Robustness | LOW |
| Spearman Score-NetR | 0.038 |
| Spearman Score-MfeR | 0.117 |

### Verdict

DEVELOPMENT_PASS
