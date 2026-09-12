# Validation Report — Baseline Económico Corregido

## Dataset Hash Verification

Los 16 datasets (4 pares × 4 timeframes) fueron verificados contra el manifest del baseline anterior (`docs/auditoria/2026-09-11-0860a02/DATASET_MANIFEST.json`).

| Pair | Timeframe | SHA256 Match |
|------|-----------|:------------:|
| BTC/USD | 5m | ✅ |
| BTC/USD | 15m | ✅ |
| BTC/USD | 60m | ✅ |
| BTC/USD | 240m | ✅ |
| ETH/USD | 5m | ✅ |
| ETH/USD | 15m | ✅ |
| ETH/USD | 60m | ✅ |
| ETH/USD | 240m | ✅ |
| SOL/USD | 5m | ✅ |
| SOL/USD | 15m | ✅ |
| SOL/USD | 60m | ✅ |
| SOL/USD | 240m | ✅ |
| XRP/USD | 5m | ✅ |
| XRP/USD | 15m | ✅ |
| XRP/USD | 60m | ✅ |
| XRP/USD | 240m | ✅ |

**Resultado**: ALL_MATCH=True

## Determinism

Las 8 corridas (4 pares × 2 ventanas FULL/COMMON) son deterministas (hash run1 = hash run2).

| Pair | Window | Deterministic |
|------|--------|:------------:|
| BTC/USD | FULL | ✅ |
| BTC/USD | COMMON | ✅ |
| ETH/USD | FULL | ✅ |
| ETH/USD | COMMON | ✅ |
| SOL/USD | FULL | ✅ |
| SOL/USD | COMMON | ✅ |
| XRP/USD | FULL | ✅ |
| XRP/USD | COMMON | ✅ |

## Dataset Reuse

- **Datasets descargados**: No se descargaron nuevos datos
- **Datasets regenerados**: No se regeneraron datasets
- **Datasets reutilizados**: Los mismos 16 datasets del baseline anterior
- **Manifest**: Copiado del baseline anterior sin modificaciones
