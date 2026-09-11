# Kraken Baseline Audit Package

CODE_SHA=0860a02e6aa326c453f730a59ef52878ff2463d8

DATA_SOURCE=KRAKEN_OFFICIAL_REST_TRADES

PAIRS=
BTC/USD
ETH/USD
SOL/USD
XRP/USD

FULL_ROWS=4
COMMON_ROWS=4
TOTAL_BASELINE_ROWS=8

## Contents

| File | Description |
|---|---|
| `README.md` | This file — audit metadata |
| `BASELINE_REPORT.md` | Full baseline report (8 runs: 4 pairs × FULL + COMMON) |
| `BASELINE_SUMMARY.csv` | Machine-readable summary (8 rows) |
| `DATASET_MANIFEST.json` | Manifest with SHA256 of all 16 datasets |
| `VALIDATION_REPORT.md` | Dataset validation results |
| `TEST_RESULTS.md` | Test and equivalence verification results |

## Dataset Storage

Los datasets voluminosos (16 archivos JSON, ~81 MB total) permanecen fuera de Git.
Se almacenan localmente en `SPOT_ADAPTIVE_V3_DATA/kraken/results/`.
Los SHA256 de cada dataset están registrados en `DATASET_MANIFEST.json`.

## Limitations

1. **FAST_PATH_MULTIPLE_FORMING_GENERAL_EQUIVALENCE=PENDING** — The equivalence test covers single forming candle scenarios. Multiple forming candles (anomaly path) in the fast path is marked as `multipleFormingDetected=false` by construction (deduplicated data guarantees one per openTime). General equivalence for anomaly scenarios with multiple forming candles is pending.

2. **HISTORICAL_REPLAY_SCAN_GRANULARITY=5m** — The historical replay evaluates signals on 5m candle boundaries. Production scan granularity is approximately 60s. Therefore the historical baseline is a comparative baseline, not a tick-perfect reproduction of production behavior.

3. **GitHub no almacena los datasets brutos completos** — Only SHA256 hashes and metadata are committed. The raw candle data is excluded from Git due to size.
