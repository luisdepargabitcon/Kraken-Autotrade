# WFO Entry V3 — Strict Window + Ablation Study Report

## 1. Methodology

### 1.1 Window Isolation
- **Strict `evaluationEndMs` boundary**: Positions open at window end are closed with `RESEARCH_WINDOW_END` exit reason. No market data beyond the boundary is used.
- **Flat start**: Each TRAIN and TEST phase starts with zero open positions. No inheritance between phases.
- **Warmup preserved**: Full historical candles are loaded for indicator context. `evaluationStartMs` prevents trades before the window; `evaluationEndMs` prevents trades after.
- **Future invariance**: Verified that modifying post-boundary candle data does not affect trades within the window.

### 1.2 WFO Configuration
- **Pairs**: BTC/USD, ETH/USD, SOL/USD, XRP/USD
- **Folds**: 3 (90d train, 30d test, 30d step)
- **Parameter grid**: 6 combos (impulseMinAtr, retracementMinAtr, maxEntryDistanceAtr, resumptionMinBodyPct)
- **Ablation architectures**: 6 (ALL, NO_IMPULSE, NO_RETRACEMENT, NO_STRUCTURE, NO_RECLAIM, NO_RESUMPTION)
- **Total combos**: 3 folds x 6 params x 6 architectures = 108
- **Selection**: TRAIN-only, joint across all pairs (not per-pair)
- **OOS**: TEST run once with selected architecture + params

### 1.3 Corrected Objective Function

```
score = netExpectancy * tradeCountFactor * crossPairFactor * ddPenalty * feePenalty * worstPairPenalty
```

- **netExpectancy** = totalNetPnl / totalTrades
- **tradeCountFactor**: 0 trades -> -1000, 1 -> -500, 2 -> 0.3, 3 -> 0.5, 4 -> 0.7, >=5 -> min(1.0, n/10)
- **crossPairFactor**: 1 pair active -> 0.5, else 1.0
- **ddPenalty**: worstDD > $200 -> max(0.1, 1 - DD/500), else 1.0
- **feePenalty**: fees > 50% of grossEdge -> 0.7, else 1.0
- **worstPairPenalty**: any pair expectancy < -$50 -> 0.5, else 1.0
- PF capped at 5.0 (Infinity does NOT dominate)

### 1.4 Drawdown Calculation
- DD calculated independently for B0, strict V3, and ablation-selected V3
- Reported as worst fold DD and worst pair DD (with pair name)

## 2. Equivalence Test Results

| Test | Result |
|------|--------|
| FAST_WINDOW_EQUIVALENCE | PASS |
| NO_LEAKAGE | PASS |
| WINDOW_FUTURE_INVARIANCE | PASS |
| BOUNDARY_CLOSE_MATCH | PASS |
| ALL_TESTS | PASS |

- Precompute time: 80.9s (single pair, BTC/USD)
- Window: 2026-04-28 to 2026-06-12 (mid-window)

## 3. Stage Attribution

### 3.1 Pass Rates by Stage (aggregated across folds)

| Pair | Candidates | Impulse % | Retracement % | Structure % | Reclaim % | Resumption % |
|------|-----------|-----------|---------------|-------------|-----------|--------------|
| BTC/USD | 46 | 88-95 | 47-50 | 52-55 | 52-60 | 0-41 |
| ETH/USD | 61 | 91-96 | 22-29 | 38-59 | 59-71 | 17-60 |
| SOL/USD | 53 | 77-100 | 44-50 | 25-36 | 75-83 | 25-65 |
| XRP/USD | 47 | 50-91 | 19-50 | 50-52 | 25-76 | 0-50 |

### 3.2 Bottleneck Analysis

- **Resumption** is the top bottleneck: 0% pass rate on BTC/USD fold 0, 16.7% on ETH/USD fold 0
- **Retracement** is the second bottleneck: 19-29% pass rate on ETH/USD and XRP/USD
- **Structure** is the third bottleneck: 25% on SOL/USD fold 0
- **Impulse** generally passes well (77-100%), except XRP/USD fold 2 (50%)
- **Reclaim** passes reasonably (52-83%)

### 3.3 Failure Breakdown

Most failures are **multi-stage** (failMultiple), meaning candidates fail multiple stages simultaneously. Single-stage failures are dominated by failOnlyResumption.

## 4. WFO + Ablation Results

### 4.1 Architecture Selection Per Fold

| Fold | Selected Architecture | Best Params (impulse/retracement/maxDist/resumptionBody) | Train Score | Train Trades |
|------|---------------------|----------------------------------------------------------|-------------|-------------|
| 0 | NO_RECLAIM | 1.5 / 0.5 / 2.0 / 0.003 | 3.51 | 3 |
| 1 | NO_RECLAIM | 0.8 / 0.3 / 1.5 / 0.001 | 4.17 | 10 |
| 2 | NO_RETRACEMENT | 0.8 / 0.2 / 1.0 / 0.0005 | 2.34 | 6 |

- **Most common**: NO_RECLAIM (2/3 folds)
- **Architecture instability**: NO (<=2 unique architectures selected)

### 4.2 OOS Metrics (Aggregated Across All Folds)

| Metric | B0 (V3 OFF) | Strict V3 (ALL stages) | Ablation Selected |
|--------|------------|------------------------|-------------------|
| Trades | 94 | 12 | 22 |
| Net PnL | +$228.34 | -$124.94 | -$88.76 |
| Profit Factor | 1.16 | 0.44 | 0.78 |
| Expectancy | +$2.43 | -$10.41 | -$4.03 |
| Fees | $462.43 | $54.21 | $95.26 |
| Win Rate | 42.6% | 16.7% | 27.3% |
| Worst Fold DD | $227.25 | $64.46 | $90.64 |
| Worst Pair DD | $227.25 (XRP/USD) | $64.46 (BTC/USD) | $90.64 (SOL/USD) |

### 4.3 Per-Pair OOS Summary

| Pair | B0 Trades | B0 Net | B0 PF | V3 Trades | V3 Net | V3 PF | Ablation Trades | Ablation Net | Ablation PF |
|------|----------|--------|-------|----------|--------|-------|----------------|-------------|-------------|
| BTC/USD | 14 | +$26.68 | 1.11 | 2 | -$46.25 | 0.28 | 4 | -$65.57 | 0.27 |
| ETH/USD | 27 | -$153 | 0.62 | 2 | +$40.53 | INF | 2 | +$40.53 | INF |
| SOL/USD | 38 | +$355.77 | 1.78 | 7 | -$101.95 | 0.27 | 13 | +$32.27 | 1.15 |
| XRP/USD | 15 | -$1.11 | 1.00 | 1 | -$17.27 | 0 | 3 | -$95.99 | 0 |

### 4.4 Sample Sufficiency
- **OOS trades (ablation)**: 22 < 30 -> **INCONCLUSIVE**
- **OOS trades (strict V3)**: 12 < 30 -> **INCONCLUSIVE**
- **OOS trades (B0)**: 94 >= 30 -> Sufficient

## 5. Performance

| Phase | Time |
|-------|------|
| Precompute (4 pairs) | 347.7s (5.8 min) |
| Research (108 combos) | 39.8s |
| Total runtime | 387.5s (6.5 min) |

- Precompute target: <5 min -> **MISSED** (5.8 min)
- Research target: <2 min -> **PASS** (39.8s)
- Total target: <10 min -> **PASS** (6.5 min)

## 6. Verdict

### 6.1 V3 Entry Quality Filter
- **Strict V3 (ALL stages)** significantly reduces trade count (94 -> 12, -87%) but produces negative OOS PnL (-$124.94).
- V3 filters out most trades but the remaining ones perform worse than B0 on average.
- The strict V3 is **NOT ready for production** -- it over-filters and the remaining trades have negative expectancy.

### 6.2 Ablation Study
- **NO_RECLAIM** selected in 2/3 folds, suggesting the reclaim stage is the most restrictive without adding value.
- **NO_RETRACEMENT** selected in 1/3 fold, suggesting retracement can also be loosened.
- Ablation-selected V3 improves trade count (12 -> 22) and reduces losses (-$124.94 -> -$88.76) vs strict V3, but still underperforms B0.
- **Architecture is stable** (NO_RECLAIM dominant), but the selected architecture still does not beat B0.

### 6.3 Key Findings
1. **Resumption stage is the top bottleneck** (0-16.7% pass rate in some folds)
2. **Retracement stage is the second bottleneck** (19-29% pass rate on ETH/XRP)
3. **B0 outperforms both strict V3 and ablation V3** in OOS net PnL
4. **Sample insufficient** for conclusive ablation verdict (22 < 30 trades)
5. **SOL/USD is the best pair for B0** (+$355.77, PF 1.78)
6. **ETH/USD is the worst pair for B0** (-$153, PF 0.62) but the best for V3 (+$40.53)

### 6.4 Recommendation
- Do NOT enable V3 in production yet.
- Consider revisiting the resumption stage definition -- it filters too aggressively.
- Consider expanding the parameter grid or fold count to increase OOS sample size.
- The ablation study suggests reclaim and retracement stages may not add value with current thresholds.
