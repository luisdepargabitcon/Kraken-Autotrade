# Test Results — Baseline Económico Corregido

## Tests nuevos

### `replayFeeModel.test.ts` — 5/5 PASS

| Test | Descripción | Resultado |
|------|-------------|-----------|
| entry fee on $1000 notional with Revolut X = $0.90 (not $4.00) | Verifica que `computeFeeBreakdown` con Revolut X produce $0.90 de fee de entrada en $1000 notional | PASS |
| round-trip fee on ~$1000 notional with Revolut X ≈ $1.80 (not ~$8.00) | Verifica round-trip fee ≈ $1.80 | PASS |
| KRAKEN_040_NOT_USED_IN_HISTORICAL_REPLAY=PASS | Confirma que Kraken 0.40% produce $4.00 y Revolut X 0.09% produce $0.90 | PASS |
| evaluateSizing with Revolut X fee model uses 0.09% for entryFeeUsd | Verifica que `evaluateSizing` con feeModel inyectado usa 0.09% | PASS |
| PnL breakdown uses Revolut X fee model | Verifica que `computePnlBreakdown` con feeModel usa 0.09% en exit fee | PASS |

### `replaySizingGate.test.ts` — 5/5 PASS

| Test | Descripción | Resultado |
|------|-------------|-----------|
| rejects entry when notional > maxOrderUsd | `evaluateSizing` rechaza con `MAX_NOTIONAL` | PASS |
| rejects entry when availableCapital < notional | `evaluateSizing` rechaza cuando capital insuficiente | PASS |
| rejects entry when maxLotsPerPair reached | `evaluateSizing` rechaza con `MAX_LOTS_REACHED` | PASS |
| simulates replay scenario: intent executable but sizing rejects → entriesExecuted=0 | Flujo completo: signal=1, intent=1, sizing rejected → entries=0 | PASS |
| approves entry when all gates pass with Revolut X fee model | Verifica aprobación con fee model correcto y entryFeeUsd = 0.09% | PASS |

### `replayExpectedProfitFeeModel.test.ts` — 2/2 PASS

| Test | Descripción | Resultado |
|------|-------------|-----------|
| expectedProfitUsd = grossProfit - fees at 0.09% (not 0.40%) | Verifica que `expectedProfitUsd` usa `feeModel` inyectado en `computeFeeBreakdown` | PASS |
| boundary: approved with 0.09% but rejected with 0.40% due to capital efficiency | Demuestra que el bug podía cambiar entradas: con 0.09% approved, con 0.40% rejected por slot efficiency | PASS |

## Suite existente

- **SPOT tests**: 36 archivos, 421 tests, todos PASS
- **TSC**: `npx tsc --noEmit` sin errores

## Comando de ejecución

```
npx vitest run server/services/spot/__tests__/replayFeeModel.test.ts server/services/spot/__tests__/replaySizingGate.test.ts server/services/spot/__tests__/replayExpectedProfitFeeModel.test.ts
npx vitest run server/services/spot/
npx tsc --noEmit
```
