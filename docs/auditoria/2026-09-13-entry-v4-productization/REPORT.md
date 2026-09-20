# Entry V4 — Certificación Productiva para Deploy Staging

**Fecha:** 2026-09-13
**Rama:** `feature/spot-adaptive-v3-shadow`
**Commit:** `56279f6e113406d47ba85d02b068aac4b2370600`
**Modo:** SHADOW (sin órdenes reales)

---

## Resumen Ejecutivo

Entry V4 es un overlay de calidad suave (soft quality score) que se interpone entre la aprobación B0 (anti-late entry) y el sizing. Utiliza un score compuesto de 5 componentes con pesos iguales (0.20 cada uno) y un umbral fijo de 0.30.

**Semántica fail-closed:** Si V4 rechaza, NO hay fallback a B0. La entrada se bloquea.

---

## Parámetros Congelados

| Parámetro | Valor |
|-----------|-------|
| Threshold | 0.30 |
| Peso impulse | 0.20 |
| Peso retracement | 0.20 |
| Peso structure | 0.20 |
| Peso reclaim | 0.20 |
| Peso resumption | 0.20 |
| Suma pesos | 1.00 |

---

## Resultados de Certificación (7 tests, todos PASS)

### 1. PRODUCTIVE_V4_HISTORICAL_PARITY — PASS
- 229 candidatos evaluados en 4 pares (BTC/USD, ETH/USD, SOL/USD, XRP/USD)
- Paridad exacta entre extractor compartido, scores productivos y research
- 0 mismatches en features, scores, y decisiones
- CSV: `PARITY_RESULTS.csv` (229 filas)

### 2. PRODUCTION_030_BASELINE — PASS
- Replay histórico real con threshold fijo 0.30
- 4 pares, datos Kraken reales (5m, 15m, 1h, 4h)
- Fee model: taker 0.09%, maker 0.00%

| Par | Trades | Net PnL | PF | Expectancy | Fees | Max DD |
|-----|--------|---------|-----|------------|------|--------|
| BTC/USD | 12 | +156.42 | 2.119 | +13.04 | 70.81 | 68.22 |
| ETH/USD | 20 | -175.67 | 0.469 | -8.78 | 108.34 | 220.68 |
| SOL/USD | 31 | +120.01 | 1.320 | +3.87 | 139.68 | 136.67 |
| XRP/USD | 21 | -185.95 | 0.528 | -8.85 | 82.25 | 217.63 |
| **Portfolio** | **84** | **-85.19** | — | **-1.01** | **401.09** | **328.40** |

- CSV: `PRODUCTION_030_BASELINE.csv` (4 filas)

### 3. PRODUCTION_V4_B0_OVERLAY — PASS
- V4 nunca acepta cuando B0 rechaza
- `v4AcceptsB0Rejected = 0` en todos los pares
- Verificado tanto por replay como por evaluación manual por frame

| Par | Candidatos | B0 Approved | V4 Accepted |
|-----|-----------|-------------|-------------|
| BTC/USD | 49 | 36 | 18 |
| ETH/USD | 69 | 54 | 29 |
| SOL/USD | 72 | 54 | 34 |
| XRP/USD | 39 | 29 | 21 |

### 4. ENTRY_V4_SIZING_UNCHANGED — PASS
- 102 candidatos evaluados (B0+V4 approved)
- `evaluateSizing` produce resultados idénticos antes y después del gate V4
- 0 mismatches en volume, riskUsd, notionalUsd, stopPrice, stopDistanceUsd, stopDistancePct, entryFeeUsd

### 5. V4_MODE_INDEPENDENT_DECISION — PASS
- 229 evaluaciones de `evaluateV4Gate`
- Decisión idéntica en OFF, SHADOW, REAL
- `evaluateV4Gate` no recibe parámetro de modo — es agnóstico por diseño

### 6. REAL_SAFETY_UNCHANGED — PASS
- `spotEntryV4.ts` no importa ni referencia:
  - `spotRealReadiness`
  - `spotOrderIntentStore`
  - `spotReconciler`
  - `REAL_ACTIVATION_ALLOWED`
  - `isEntryGenerationValid` / `isPairEntryGenerationValid`
  - `ExecutionMode`
- No contiene lógica de colocación de órdenes
- `V4EvaluationResult` no contiene campos de modo de ejecución

### 7. V4_PRODUCTIVE_CLOSED_CANDLE_ONLY — PASS
- Alteración de velas futuras (post-evaluación) no cambia features, scores ni decisiones
- Verificado en los 4 pares con datos reales
- `featuresEqual=true`, `scoresEqual=true`, `gateEqual=true` en todos los casos

---

## Tests Adicionales Ejecutados

| Suite | Resultado |
|-------|-----------|
| `testEntryV4.ts` (unit tests) | PASS (8/8) |
| `testEntryV4CounterAudit.ts` | PASS (6/6) |
| `testEntryV4ProductionParity.ts` | PASS (10/10) |
| `testEntryV4Certification.ts` | PASS (7/7) |
| `tsc --noEmit` | PASS (0 errors) |
| `npm run build` | PASS |

---

## Archivos Modificados/Creados

| Archivo | Acción |
|---------|--------|
| `server/services/spot/research/testEntryV4Certification.ts` | NUEVO — Suite de certificación con datos reales |
| `server/services/spot/research/testEntryV4ProductionParity.ts` | MODIFICADO — Fix TS errors en mocks |
| `docs/auditoria/2026-09-13-entry-v4-productization/REPORT.md` | NUEVO |
| `docs/auditoria/2026-09-13-entry-v4-productization/TEST_RESULTS.md` | NUEVO |
| `docs/auditoria/2026-09-13-entry-v4-productization/PARITY_RESULTS.csv` | NUEVO |
| `docs/auditoria/2026-09-13-entry-v4-productization/PRODUCTION_030_BASELINE.csv` | NUEVO |

---

## Restricciones Respetadas

- ✅ Sin cambios a parámetros V4 (threshold=0.30, weights=0.20×5)
- ✅ Sin activación de REAL mode
- ✅ Sin órdenes reales
- ✅ Sin merge a main
- ✅ Deploy solo a staging VPS
- ✅ Fail-closed: V4 rejection nunca hace fallback a B0
