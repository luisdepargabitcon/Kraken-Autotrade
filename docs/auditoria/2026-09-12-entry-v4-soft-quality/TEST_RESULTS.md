# Entry V4 Soft Quality Overlay — Test Results

## Compilation

| Check | Result |
|---|---|
| tsc --noEmit | PASS |
| git diff --check | PASS |

## Counter-Audit Tests (testEntryV4CounterAudit.ts)

| Test | Result |
|---|---|
| V4_ACCEPTS_B0_REJECTED | PASS (0 B0-rejected candidates accepted by V4) |
| V4_B0_CHASE_PARITY | PASS (CHASED state blocks V4) |
| V4_B0_CONTEXT_PARITY | PASS (regime/direction/macro flips block V4) |
| V4_FUTURE_INVARIANCE | PASS (score=0.4847, identical with altered future) |
| V4_THRESHOLD_ZERO_EQUALS_B0 | PASS (qualityScore >= 0 always true) |
| B0_SCORE_COVERAGE | PASS (100%, 94/94 mapped, 0 missing) |
| QUALITY_SCORE_RANGE | PASS (zero=0, mid=0.4847, max=1) |
| QUALITY_SCORE_DETERMINISTIC | PASS (score=0.4847) |
| QUALITY_SCORE_MONOTONIC_COMPONENTS | PASS |
| V4_DEFAULT_RESEARCH_ONLY | PASS (researchOnly=true, thresholds=5, weightSum=1) |
| V4_SIZING_UNCHANGED | PASS |
| V4_PAIR_INDEPENDENT | PASS |

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
| Precompute sec | 193.4 |
| Research sec | 10.1 |
| Total runtime sec | 203.5 |

### B0 OOS

| Metric | Value |
|---|---|
| Trades | 94 |
| Net | $228.34 |
| PF | 1.16 |
| Expectancy | $2.43 |
| Portfolio Max DD | $532.79 |

### V4 True Overlay OOS

| Metric | Value |
|---|---|
| Trades | 52 |
| Net | $297.38 |
| PF | 1.41 |
| Expectancy | $5.72 |
| Portfolio Max DD | $275.98 |

### Verdict

DEVELOPMENT_PASS
