# Entry V4 — Resultados de Tests de Certificación

**Fecha:** 2026-09-13
**Commit:** `56279f6e113406d47ba85d02b068aac4b2370600`
**Rama:** `feature/spot-adaptive-v3-shadow`

---

## Suite: testEntryV4Certification.ts (7 tests)

| # | Test | Resultado | Detalle |
|---|------|-----------|---------|
| 1 | PRODUCTIVE_V4_HISTORICAL_PARITY | **PASS** | 229 candidatos, 0 mismatches, 4 pares |
| 2 | PRODUCTION_030_BASELINE | **PASS** | 84 trades, net=-85.19, fees=401.09, DD=328.40 |
| 3 | PRODUCTION_V4_B0_OVERLAY | **PASS** | v4AcceptsB0Rejected=0 en todos los pares |
| 4 | ENTRY_V4_SIZING_UNCHANGED | **PASS** | 102 candidatos, 0 mismatches en sizing |
| 5 | V4_MODE_INDEPENDENT_DECISION | **PASS** | 229 evaluaciones, idénticas en OFF/SHADOW/REAL |
| 6 | REAL_SAFETY_UNCHANGED | **PASS** | 0 violaciones de imports/referencias |
| 7 | V4_PRODUCTIVE_CLOSED_CANDLE_ONLY | **PASS** | featuresEqual=true, scoresEqual=true, gateEqual=true |

**Resultado:** `ALL_V4_CERTIFICATION_TESTS=PASS`

---

## Suite: testEntryV4ProductionParity.ts (10 tests)

| # | Test | Resultado |
|---|------|-----------|
| 1 | ENTRY_V4_PRODUCTION_RESEARCH_PARITY | **PASS** |
| 2 | PRODUCTIVE_V4_HISTORICAL_PARITY | **PASS** |
| 3 | PRODUCTION_030_BASELINE | **PASS** |
| 4 | V4_FAIL_CLOSED | **PASS** |
| 5 | V4_B0_OVERLAY | **PASS** |
| 6 | V4_SIZING_UNCHANGED | **PASS** |
| 7 | V4_MODE_INDEPENDENT | **PASS** |
| 8 | V4_CLOSED_CANDLE | **PASS** |
| 9 | V4_WEIGHTS_FROZEN | **PASS** |
| 10 | V4_THRESHOLD_FROZEN | **PASS** |

**Resultado:** `ALL_V4_PRODUCTION_TESTS=PASS`

---

## Suite: testEntryV4CounterAudit.ts (6 tests)

| # | Test | Resultado |
|---|------|-----------|
| 1 | HISTORICAL_INTENT_CLOCK | **PASS** |
| 2 | CANONICAL_FAST_B0_PARITY | **PASS** |
| 3 | V4_THRESHOLD_ZERO_EQUALS_B0 | **PASS** |
| 4 | V4_REAL_FUTURE_INVARIANCE | **PASS** |
| 5 | V4_ACCEPTS_B0_REJECTED | **PASS** |
| 6 | B0_SCORE_COVERAGE | **PASS** |

**Resultado:** `ALL_V4_COUNTER_AUDIT_TESTS=PASS`

---

## Suite: testEntryV4.ts (8 tests)

| # | Test | Resultado |
|---|------|-----------|
| 1 | QUALITY_SCORE_RANGE | **PASS** |
| 2 | QUALITY_SCORE_DETERMINISTIC | **PASS** |
| 3 | QUALITY_SCORE_NO_LOOKAHEAD | **PASS** |
| 4 | QUALITY_SCORE_MONOTONIC_COMPONENTS | **PASS** |
| 5 | V4_DEFAULT_RESEARCH_ONLY | **PASS** |
| 6 | V4_SIZING_UNCHANGED | **PASS** |
| 7 | V4_PAIR_INDEPENDENT | **PASS** |
| 8 | V4_FAST_REPLAY_EQUIVALENCE | **PASS** |

**Resultado:** `ALL_V4_TESTS=PASS`

---

## Compilación

| Check | Resultado |
|-------|-----------|
| `tsc --noEmit` | **PASS** (0 errors) |
| `npm run build` | **PASS** (28.22s) |

---

## Datos Utilizados

- **Fuente:** Kraken OHLC API (cached localmente)
- **Pares:** BTC/USD, ETH/USD, SOL/USD, XRP/USD
- **Timeframes:** 5m, 15m, 1h, 4h
- **Fee model:** taker=0.09%, maker=0.00%
- **Capital:** $10,000 por par
