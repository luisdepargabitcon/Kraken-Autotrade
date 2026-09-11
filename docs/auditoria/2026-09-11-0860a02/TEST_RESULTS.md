# Test Results

Code SHA: 0860a02e6aa326c453f730a59ef52878ff2463d8
Test run: 2026-09-11T20:28:31Z

## SPOT Test Suite

```
Test Files  33 passed (33)
     Tests  409 passed (409)
  Duration  8.32s
```

## Equivalence Tests

### closedCandleFastEquivalence.test.ts (11 tests)

Compares original `splitCandlesByClose` + `buildClosedCandleContext` vs new `prepareCandles` + `splitCandlesByCloseFast` + `buildClosedCandleContextFast`.

| Test | Status |
|---|---|
| 5m: split equivalence at boundary | PASS |
| 15m: split equivalence at boundary | PASS |
| 1h: split equivalence at boundary | PASS |
| 4h: split equivalence at boundary | PASS |
| 5m: duplicates removed identically | PASS |
| 5m: forming candle excluded identically | PASS |
| 5m: future candle excluded identically | PASS |
| 5m: unsorted input produces same result | PASS |
| Full context equivalence (all TFs) | PASS |
| 15m: context equivalence with mixed candles | PASS |
| 4h: context equivalence at exact close | PASS |

### replayFastPath.test.ts (2 tests)

| Test | Status |
|---|---|
| Replay determinism — identical trades + metrics on consecutive runs | PASS |
| Replay handles 1000 5m candles without error | PASS |

## TypeScript Compilation

```
npx tsc --noEmit
Exit code: 0 (clean)
```

## Microbenchmark

```
BTC/USD 7-day window: 2017 candles
Elapsed: 49ms
Throughput: 41,163 candles/sec
Estimated full baseline (8 runs): 0.2 minutes
Deterministic: true
```

## Determinism Verification

All 8 baseline runs (4 pairs × FULL + COMMON) produced identical `runHash` values across consecutive executions. Each run is fully deterministic.

## Limitations

1. **FAST_PATH_MULTIPLE_FORMING_GENERAL_EQUIVALENCE=PENDING** — Equivalence tests cover single forming candle scenarios. Multiple forming candles (anomaly path) in the fast path is marked as `multipleFormingDetected=false` by construction (deduplicated data guarantees one per openTime). General equivalence for anomaly scenarios with multiple forming candles is pending.

2. **HISTORICAL_REPLAY_SCAN_GRANULARITY=5m** — The historical replay evaluates signals on 5m candle boundaries. Production scan granularity is approximately 60s. Therefore the historical baseline is a comparative baseline, not a tick-perfect reproduction of production behavior.

3. **GitHub no almacena los datasets brutos completos** — Only SHA256 hashes and metadata are committed. The raw candle data is excluded from Git due to size.
