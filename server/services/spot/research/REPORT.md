# WFO Entry V3 — Strict Window + Ablation Study Report (Contra-auditoría)

## 1. Methodology

### 1.1 Window Isolation
- **Strict `evaluationEndMs` boundary**: Positions open at window end are closed with `RESEARCH_WINDOW_END` exit reason. No market data beyond the boundary is used.
- **Flat start**: Each TRAIN and TEST phase starts with zero open positions. No inheritance between phases.
- **Warmup preserved**: Full historical candles are loaded for indicator context. `evaluationStartMs` prevents trades before the window; `evaluationEndMs` prevents trades after.
- **Future invariance**: Verified that modifying post-boundary candle data does not affect trades within the window.
- **Non-vacuous boundary**: Verified that at least 1 trade exits with `RESEARCH_WINDOW_END` in both `fastReplay` and `runReplay`.

### 1.2 WFO Configuration
- **Pairs**: BTC/USD, ETH/USD, SOL/USD, XRP/USD
- **Folds**: 3 (90d train, 30d test, 30d step)
- **Parameter grid**: 6 combos (impulseMinAtr, retracementMinAtr, maxEntryDistanceAtr, resumptionMinBodyPct)
- **Ablation architectures**: 6 (ALL, NO_IMPULSE, NO_RETRACEMENT, NO_STRUCTURE, NO_RECLAIM, NO_RESUMPTION)
- **Strict WFO**: 3 folds × 6 params = 18 combos (ALL_STAGES_MASK)
- **Ablation WFO**: 3 folds × 6 architectures × 6 params = 108 combos
- **Total combos**: 18 + 108 = 126 (independent selections)
- **Selection**: TRAIN-only, joint across all pairs (not per-pair)
- **OOS**: TEST run once with B0, strict-selected params, and ablation-selected arch + params

### 1.3 Corrected Objective Function (Additive/Monotonic)

```
baseQuality = normalizedNetExpectancy + cappedPfContribution
score = baseQuality - sparseSamplePenalty - crossPairPenalty - drawdownPenalty - feePenalty - worstPairPenalty
```

- **normalizedNetExpectancy** = expectancy / 10 ($10/trade = 1.0)
- **cappedPfContribution**: totalTrades >= 5 ? min(netPF, 3) / 3 * 0.5 : 0 (PF capped at 3, Infinity treated as 3)
- **sparseSamplePenalty**: 0 trades -> -1000 (hard), 1 -> -500 (hard), 2 -> -0.3, 3 -> -0.2, 4 -> -0.1, >=5 -> 0
- **crossPairPenalty**: 1 pair active -> -0.5, else 0
- **drawdownPenalty**: worstDD > $200 -> worstDD / 500 (max ~1.0), else 0
- **feePenalty**: fees > 50% of grossEdge -> -0.3, else 0
- **worstPairPenalty**: any pair expectancy < -$50 -> -0.5, else 0

**Monotonicity guarantees**:
- More DD → score never improves
- More fees → score never improves
- Fewer pairs → score never improves
- Smaller sample → score never improves
- Lower PF → score never improves
- More negative expectancy → score never improves (penalties make bad scores WORSE, not less bad)

### 1.4 Stage Attribution
- Raw 5 booleans computed independently of mask and anti-late
- Anti-late failures tracked separately (distance + expiry)
- Mask only affects acceptance, not attribution

### 1.5 Drawdown Calculation
- DD calculated independently for B0, strict V3, and ablation-selected V3
- Reported as worst fold DD and worst pair DD (with pair name)

## 2. Equivalence & Boundary Test Results

| Test | Result |
|------|--------|
| FAST_WINDOW_EQUIVALENCE | PASS |
| NO_LEAKAGE | PASS |
| WINDOW_FUTURE_INVARIANCE | PASS |
| BOUNDARY_CLOSE_MATCH | PASS |
| BOUNDARY_NONVACUOUS | PASS (1 boundary trade) |
| BOUNDARY_FUTURE_INVARIANCE | PASS |
| ALL_TESTS | PASS |

- Precompute time: 55.9s (single pair, BTC/USD)
- Window: 2026-04-28 to 2026-06-12 (mid-window)
- Non-vacuous window: 2026-04-01 to 2026-05-05 (forced boundary)

## 3. Objective Monotonicity Tests

| Test | Result |
|------|--------|
| NEGATIVE_EXPECTANCY | PASS |
| MORE_DD | PASS |
| MORE_FEES | PASS |
| FEWER_PAIRS | PASS |
| SPARSER_SAMPLE | PASS |
| LOWER_PF | PASS |
| NEGATIVE_EXPECTANCY_PENALTY | PASS |
| ALL_MONOTONICITY_TESTS | PASS |

## 4. Stage Attribution

### 4.1 Pass Rates by Stage (aggregated across folds)

| Pair | Candidates | Impulse % | Retracement % | Structure % | Reclaim % | Resumption % |
|------|-----------|-----------|---------------|-------------|-----------|--------------|
| BTC/USD | 46 | 88-95 | 47-50 | 52-55 | 52-60 | 0-41 |
| ETH/USD | 61 | 91-96 | 22-29 | 38-59 | 59-71 | 17-60 |
| SOL/USD | 53 | 77-100 | 44-50 | 25-36 | 75-83 | 25-65 |
| XRP/USD | 47 | 50-91 | 19-50 | 50-52 | 25-76 | 0-50 |

### 4.2 Bottleneck Analysis

- **Resumption** is the top bottleneck: 0% pass rate on BTC/USD fold 0, 16.7% on ETH/USD fold 0
- **Retracement** is the second bottleneck: 19-29% pass rate on ETH/USD and XRP/USD
- **Structure** is the third bottleneck: 25% on SOL/USD fold 0
- **Impulse** generally passes well (77-100%), except XRP/USD fold 2 (50%)
- **Reclaim** passes reasonably (52-83%)

### 4.3 Failure Breakdown

Most failures are **multi-stage** (failMultipleStages), meaning candidates fail multiple stages simultaneously. Single-stage failures are dominated by failOnlyResumption. Anti-late failures tracked separately (distance + expiry).

## 5. WFO + Ablation Results

### 5.1 Strict WFO Selection Per Fold

| Fold | Best Params (impulse/retracement/maxDist/resumptionBody) |
|------|----------------------------------------------------------|
| 0 | 1.5 / 0.5 / 2.0 / 0.003 |
| 1 | 0.8 / 0.3 / 1.5 / 0.001 |
| 2 | 0.8 / 0.2 / 1.0 / 0.0005 |

### 5.2 Ablation WFO Selection Per Fold

| Fold | Selected Architecture | Best Params (impulse/retracement/maxDist/resumptionBody) |
|------|----------------------|----------------------------------------------------------|
| 0 | NO_RECLAIM | 1.5 / 0.5 / 2.0 / 0.003 |
| 1 | NO_RECLAIM | 0.8 / 0.3 / 1.5 / 0.001 |
| 2 | NO_RETRACEMENT | 0.8 / 0.2 / 1.0 / 0.0005 |

- **Most common**: NO_RECLAIM (2/3 folds)
- **Architecture stability**: MEDIUM (2/3 folds agree, >= ceil(3/2))

### 5.3 OOS Metrics (Aggregated Across All Folds)

| Metric | B0 (V3 OFF) | Strict V3 (ALL stages) | Ablation Selected |
|--------|------------|------------------------|-------------------|
| Trades | 94 | 12 | 22 |
| Net PnL | +$228.34 | -$124.94 | -$88.76 |
| Profit Factor | 1.16 | 0.44 | 0.78 |
| Expectancy | +$2.43 | -$10.41 | -$4.03 |
| Fees | $462.43 | $54.21 | $95.26 |
| Worst Fold DD | $227.25 | $64.46 | $90.64 |
| Worst Pair DD | $227.25 (XRP/USD) | $64.46 (BTC/USD) | $90.64 (SOL/USD) |

### 5.4 Per-Pair OOS Summary

| Pair | B0 Trades | B0 Net | V3 Trades | V3 Net | Ablation Trades | Ablation Net |
|------|----------|--------|----------|--------|----------------|-------------|
| BTC/USD | 14 | +$26.68 | 2 | -$46.25 | 4 | -$65.57 |
| ETH/USD | 27 | -$153 | 2 | +$40.53 | 2 | +$40.53 |
| SOL/USD | 38 | +$355.77 | 7 | -$101.95 | 13 | +$32.27 |
| XRP/USD | 15 | -$1.11 | 1 | -$17.27 | 3 | -$95.99 |

### 5.5 Sample Sufficiency
- **OOS trades (ablation)**: 22 < 30 → **INCONCLUSIVE**
- **OOS trades (strict V3)**: 12 < 30 → **INCONCLUSIVE**
- **OOS trades (B0)**: 94 >= 30 → Sufficient

## 6. Performance

| Phase | Time |
|-------|------|
| Precompute (4 pairs) | 203s (3.4 min) |
| Research (126 combos) | 21.4s |
| Total runtime | 224.4s (3.7 min) |

- Precompute target: <5 min → **PASS** (3.4 min)
- Research target: <2 min → **PASS** (21.4s)
- Total target: <10 min → **PASS** (3.7 min)

## 7. Comparison with f8ba19f

| Metric | f8ba19f | Corrected | Change |
|--------|---------|-----------|--------|
| Combos | 108 (shared) | 126 (independent) | +18 (strict separated) |
| Research time | 39.8s | 21.4s | -46% |
| Objective | Multiplicative | Additive/monotonic | Methodological fix |
| Architecture | "instability: NO" | "stability: MEDIUM" | Nomenclature fix |
| Boundary tests | Vacuous (0 boundary) | Non-vacuous (1 boundary) | Methodological fix |
| B0 OOS Net | +$228.34 | +$228.34 | Identical |
| Strict V3 OOS Net | -$124.94 | -$124.94 | Identical |
| Ablation OOS Net | -$88.76 | -$88.76 | Identical |
| Stage attribution | Mask-dependent | Raw independent | Methodological fix |

**Key finding**: OOS results are identical because the corrected objective function selects the same parameters. The methodological fixes (additive objective, independent selections, non-vacuous boundary, raw stage attribution) do not change the outcome but ensure the methodology is valid.

## 8. Verdict

### 8.1 V3 Entry Quality Filter
- **Strict V3 (ALL stages)** significantly reduces trade count (94 → 12, -87%) but produces negative OOS PnL (-$124.94).
- V3 filters out most trades but the remaining ones perform worse than B0 on average.
- The strict V3 is **NOT ready for production** — it over-filters and the remaining trades have negative expectancy.

### 8.2 Ablation Study
- **NO_RECLAIM** selected in 2/3 folds, suggesting the reclaim stage is the most restrictive without adding value.
- **NO_RETRACEMENT** selected in 1/3 fold, suggesting retracement can also be loosened.
- Ablation-selected V3 improves trade count (12 → 22) and reduces losses (-$124.94 → -$88.76) vs strict V3, but still underperforms B0.
- **Architecture stability**: MEDIUM (2/3 folds agree on NO_RECLAIM)

### 8.3 Key Findings
1. **Resumption stage is the top bottleneck** (0-16.7% pass rate in some folds)
2. **Retracement stage is the second bottleneck** (19-29% pass rate on ETH/XRP)
3. **B0 outperforms both strict V3 and ablation V3** in OOS net PnL
4. **Sample insufficient** for conclusive ablation verdict (22 < 30 trades)
5. **SOL/USD is the best pair for B0** (+$355.77, PF 1.78)
6. **ETH/USD is the worst pair for B0** (-$153, PF 0.62) but the best for V3 (+$40.53)

### 8.4 Recommendation
- Do NOT enable V3 in production yet.
- Consider revisiting the resumption stage definition — it filters too aggressively.
- Consider expanding the parameter grid or fold count to increase OOS sample size.
- The ablation study suggests reclaim and retracement stages may not add value with current thresholds.
