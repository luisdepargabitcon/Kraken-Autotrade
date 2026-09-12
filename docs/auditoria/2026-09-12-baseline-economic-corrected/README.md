# Baseline Económico Corregido — SPOT ADAPTIVE V3

## Metadatos

- **Fecha**: 2026-09-12
- **Branch**: `feature/spot-adaptive-v3-shadow`
- **Baseline anterior**: `docs/auditoria/2026-09-11-0860a02/`
- **SHA base**: 0860a02e6aa326c453f730a59ef52878ff2463d8
- **SHA corrección**: (pendiente de commit)
- **Datasets**: Reutilizados sin cambios (16 datasets, SHA256 verificados contra manifest anterior)

## Defectos corregidos

### Defecto 1: Replay no usaba `evaluateSizing()` productivo

**Antes**: `spotReplayEngine.ts` llamaba directamente `computeStopDistance()` y `computePositionSize()`, sin aplicar las puertas de riesgo productivas (maxLotsPerPair, spread gate, capital efficiency, fee gate).

**Después**: `spotReplayEngine.ts` llama `evaluateSizing()` con los mismos parámetros que usa `spotEngine.ts` en producción, incluyendo:
- `openLotsForPair` calculado dinámicamente
- `DEFAULT_SPOT_RISK_CONFIG` (o configuración inyectada)
- `feeModel` explícito

**Impacto**: Las entradas que el replay ejecutaba pero la producción rechazaría ahora son filtradas. El número de entradas ejecutadas disminuye (ej. BTC/USD: 36→24, ETH/USD: 49→39, SOL/USD: 47→44).

### Defecto 2: Replay usaba fee model Kraken (0.40%) en lugar de Revolut X (0.09%)

**Antes**: `getSpotTakerFeePct()` intentaba resolver el fee del exchange activo vía `ExchangeFactory`, que en contexto offline fallaba y caía al fallback de Kraken 0.40% taker.

**Después**: `spotBaselineResearch.ts` inyecta explícitamente `HISTORICAL_FEE_MODEL = { exchange: "revolutx", takerFeePct: 0.09, makerFeePct: 0.00, quality: "ESTIMATED" }` en `ReplayConfig.feeModel`. Este fee model se propaga a:
- `evaluateSizing()` → `evaluateFeeGate()` y `entryFeeUsd`
- `computeFeeBreakdown()` en exits
- `computePnlBreakdown()` en PnL de cierre

**Impacto**: Fees totales reducidos ~78% (ej. BTC/USD: $1176→$139, ETH/USD: $1546→$237, SOL/USD: $1060→$208, XRP/USD: $466→$105).

## Cambios de código

### `server/services/spot/spotRiskManager.ts`
- `evaluateFeeGate()`: añadido parámetro opcional `feeModel?: FeeModel`
- `evaluateSizing()`: añadido parámetro opcional `feeModel?: FeeModel`
- Import de `type FeeModel` desde `feeModel.ts`

### `server/services/spot/spotReplayEngine.ts`
- Import cambiado: `evaluateSizing` en lugar de `computeStopDistance`/`computePositionSize`
- `ReplayConfig`: añadido campo `feeModel?: FeeModel`
- `runReplay()`: reemplazado sizing directo por `evaluateSizing()` con `sizingCtx` (ticker.last = fill price)
- `computeFeeBreakdown()` y `computePnlBreakdown()`: pasan `feeModel` explícito
- `sizing.entryFeeUsd` usado en lugar de cálculo manual

### `server/services/spot/research/spotBaselineResearch.ts`
- Import de `type FeeModel` desde `feeModel.ts`
- Constante `HISTORICAL_FEE_MODEL` con Revolut X 0.09% taker
- `ReplayConfig` en `runBaselineForPair()` pasa `feeModel: HISTORICAL_FEE_MODEL`

### Tests nuevos
- `server/services/spot/__tests__/replayFeeModel.test.ts` — 5 tests
- `server/services/spot/__tests__/replaySizingGate.test.ts` — 5 tests

## Verificación de datasets

Los 16 datasets (4 pares × 4 timeframes) fueron verificados contra el manifest del baseline anterior (`docs/auditoria/2026-09-11-0860a02/DATASET_MANIFEST.json`). Todos los SHA256 coinciden.

## Resultados

Ver `BASELINE_SUMMARY.csv` para métricas detalladas y `COMPARISON_OLD_VS_CORRECTED.csv` para comparación con el baseline anterior.

## Limitaciones

- No se modificaron parámetros de estrategia ni configuración de riesgo
- No se inició optimización ni walk-forward
- No se desplegó al VPS
- Los fees son ESTIMATED (modelo), no REAL (fills reales)
- El replay asume fills sin slippage (executionCost = 0)
