# Dataset Validation Report

Code SHA: 0860a02e6aa326c453f730a59ef52878ff2463d8
Generated: 2026-09-11T18:28:19.505Z

## Summary

- All datasets valid: true
- MTF all pass: true
- Total datasets: 16 (4 pairs × 4 timeframes)

## Per-Dataset Validation

| Pair | TF | Rows | Gaps | Largest Gap | Dup Conflicts | Valid |
|---|---|---|---|---|---|---|
| BTC/USD | 5m | 52240 | 3 | 10min | 0 | true |
| BTC/USD | 15m | 17414 | 0 | 0min | 0 | true |
| BTC/USD | 60m | 4353 | 0 | 0min | 0 | true |
| BTC/USD | 240m | 1088 | 0 | 0min | 0 | true |
| ETH/USD | 5m | 52244 | 3 | 10min | 0 | true |
| ETH/USD | 15m | 17416 | 0 | 0min | 0 | true |
| ETH/USD | 60m | 4354 | 0 | 0min | 0 | true |
| ETH/USD | 240m | 1088 | 0 | 0min | 0 | true |
| SOL/USD | 5m | 52266 | 3 | 10min | 0 | true |
| SOL/USD | 15m | 17423 | 0 | 0min | 0 | true |
| SOL/USD | 60m | 4355 | 0 | 0min | 0 | true |
| SOL/USD | 240m | 1088 | 0 | 0min | 0 | true |
| XRP/USD | 5m | 52277 | 3 | 10min | 0 | true |
| XRP/USD | 15m | 17427 | 0 | 0min | 0 | true |
| XRP/USD | 60m | 4356 | 0 | 0min | 0 | true |
| XRP/USD | 240m | 1089 | 0 | 0min | 0 | true |

## Notes

- All 5m datasets have exactly 3 gaps of 10min each (expected from Kraken REST API rate limiting).
- No duplicate conflicts in any dataset.
- All MTF consistency checks pass (5m candles aggregate correctly to 15m, 60m, 240m).

## Dataset Integrity

All 16 datasets have SHA256 hashes recorded in `DATASET_MANIFEST.json`.
Datasets are stored locally outside Git. Integrity can be verified by recomputing SHA256 on the local files and comparing against the manifest.
