# Auditoría R2 — Correcciones Pre-Merge AMA V2.2

**Fecha:** 2026-07-30
**Rama:** `review/ama-seed-v2-2-20260729`
**Base R1 SHA:** `05a8344561c4048c8535d75d8b9d752648e2093e`
**Estado:** IMPLEMENTADO — EN GATE PRECOMMIT R2

## Inventario de archivos modificados

### Código

| Archivo | Cambios |
|---------|---------|
| `server/services/ama/amaSeedTypes.ts` | R2.2-R2.4: `ResolvedSeedTranche`, `BTC_SEED_TRANCHES`, `ETH_SEED_TRANCHES`, `SEED_MAXIMUM_TRANCHE_PCT`, `computeEffectiveMaximumTranchePct`, `validateSeedPolicy` |
| `server/services/ama/amaHwmBar.ts` | R2.5-R2.7: `evaluateConfirmation` canónica, `bootstrapHWM` refactorizado, `processIncrementalClose`, `WeeklyConfirmationConfig` (deshabilitada) |
| `server/services/ama/amaDeterministicEngine.ts` | R2.1-R2.3: `generateTrancheCandidateFromSeed`, `planTranchesFromSeeds`, `planTranches` con tracking acumulativo, `computeIdempotencyKey`, `TranchePlanInput` con `asset` y `riskOverlayMultiplier` |

### Tests

| Archivo | Cambios |
|---------|---------|
| `server/services/ama/__tests__/amaR2Corrections.test.ts` | **NUEVO** — 41 tests R2 |
| `server/services/ama/__tests__/amaDeterministicEngine.test.ts` | `makeInput` actualizado con `asset` y `riskOverlayMultiplier` |
| `server/services/ama/__tests__/amaAdaptivePlanner.test.ts` | `makeInput` actualizado con `asset` y `riskOverlayMultiplier` |

### Documentación

| Archivo | Cambios |
|---------|---------|
| `AUDITORIAS/VALIDACION_POSTGRESQL_DESECHABLE_AMA_080_2026-07-30.md` | Actualizado a R2 con `BLOCKED_NO_SAFE_ENVIRONMENT` |
| `AUDITORIAS/AUDITORIA_CORRECCION_PREMERGE_AMA_V2_2_R2_2026-07-30.md` | **NUEVO** — esta auditoría |

## Correcciones detalladas

### R2.1 — Planificador acumulativo

**Problema:** `planTranches()` no acumulaba `deployedUsd` ni `reservedUsd` al evaluar candidatos subsecuentes dentro del mismo ciclo de planificación.

**Solución:**
- `planTranches()` ahora mantiene `plannedEligibleUsd` y `plannedEligibleCount` acumulativos.
- Cada candidato se re-evalúa con `projectedDeployedUsd = input.deployedUsd + plannedEligibleUsd + candidate.amountUsd`.
- Verificaciones acumulativas: `CUMULATIVE_CYCLE_DEPLOYMENT_LIMIT`, `CUMULATIVE_RESERVE_VIOLATION`, `CUMULATIVE_CAPITAL_CAP_EXCEEDED`, `CUMULATIVE_MAX_TRANCHES_REACHED`, `CUMULATIVE_TRANCHE_COUNT_CAP_EXCEEDED`.
- Nuevo `planTranchesFromSeeds()` usa tramos canónicos de Seed Policy con tracking acumulativo desde el inicio.

### R2.2 — Tramos exactos Seed Policy

**Problema:** Los tramos se derivaban arbitrariamente desde zonas macro, no desde la Seed Policy.

**Solución:**
- `ResolvedSeedTranche` interface con `index`, `asset`, `triggerDropPct`, `capitalPct`, `trancheType`, `policyId`, `policyVersion`.
- `BTC_SEED_TRANCHES`: 6 tramos con triggers [18, 25, 33, 42, 52, 63] y capital [7, 9, 12, 14, 15, 18].
- `ETH_SEED_TRANCHES`: 7 tramos con triggers [24, 32, 41, 51, 61, 71, 80] y capital [5, 7, 8, 10, 11, 12, 12].
- `getSeedTranches(asset)` devuelve los tramos canónicos.

### R2.3 — Límites por tramo

**Problema:** No se distinguía entre seed max, user max, y effective max.

**Solución:**
- `SEED_MAXIMUM_TRANCHE_PCT`: BTC=18, ETH=12.
- `getSeedMaximumTranchePct(asset)` devuelve el máximo de la política.
- `computeEffectiveMaximumTranchePct(asset, userMax)` = `Math.min(seedMax, userMax)`.
- El tramo BTC 18% no se recorta silenciosamente.

### R2.4 — Validación total Seed Policy (fail-closed)

**Problema:** No existía validación de consistencia entre tramos y política.

**Solución:**
- `validateSeedPolicy(asset)` verifica:
  - Tranche count coincide con `policy.trancheCount`.
  - Suma de `capitalPct` coincide con `policy.capitalDeploymentPct`.
  - `capitalDeploymentPct + capitalReservePct = 100`.
  - Triggers únicos y estrictamente crecientes en profundidad.
  - ETH no tiene `executionEnabled`.
  - Max tranche no excede `SEED_MAXIMUM_TRANCHE_PCT`.
- Devuelve array de errores (fail-closed: errores vacíos = válido).

### R2.5 — Bootstrap HWM

**Problema:** `bootstrapHWM()` usaba `some()` para verificar reversión (al menos un cierre bajo umbral) en lugar de `every()` (todos los cierres bajo umbral).

**Solución:**
- `evaluateConfirmation()` requiere `allBelowThreshold` (every close <= reversalThresholdPrice) AND `allBelowHwm` (every close < hwmPrice).
- Deduplicación de velas por timestamp.
- Ordenamiento estricto por timestamp.

### R2.6 — Bootstrap e incremental coinciden

**Problema:** Bootstrap e incremental usaban lógica diferente.

**Solución:**
- `evaluateConfirmation()` es la función canónica compartida.
- `bootstrapHWM()` la usa internamente.
- `processIncrementalClose()` la usa para re-evaluar CANDIDATE/CONFIRMING con nuevos cierres.
- Tests verifican que mismo dataset produce mismo HWM, estado, fecha de confirmación y umbral.

### R2.7 — Confirmación semanal

**Estado:** Documentada como deshabilitada.

- `WeeklyConfirmationConfig` interface con `weeklyOverrideEnabled`, `requiredWeeklyCloses`, `weeklyBoundaryUtc`, `weeklyThresholdPrice`.
- `DEFAULT_WEEKLY_CONFIG.weeklyOverrideEnabled = false`.
- `isWeeklyConfirmationEnabled()` devuelve `false` por defecto.
- No afecta lógica de confirmación diaria existente.

### R2.8 — Clasificación de IDs

**Clasificación:**

| Tipo | Patrón | Determinismo | Ejemplo |
|------|--------|--------------|---------|
| **Domain ID** | UUID/ULID o timestamp-based | No determinista | `hwm-${timestamp}`, `cycle-${id}` |
| **Reproducible hash** | SHA-256 sobre payload canónico | Determinista | `computePlanHash()` → 64 hex |
| **Idempotency key** | SHA-256 sobre datos canónicos | Determinista | `computeIdempotencyKey()` → 24 hex |

- `computeIdempotencyKey(asset, cycleId, policyVersion, trancheIndex, confirmedCandleTimestamp, action)` — no usa `Date.now()`.
- `computePlanHash()` excluye `planId` y `createdAt` del payload canónico.

### R2.9 — PostgreSQL desechable

**Estado:** `BLOCKED_NO_SAFE_ENVIRONMENT`

- Docker no disponible en máquina de desarrollo.
- `psql` no instalado.
- Script `ama_migration_validate.mjs` preparado pero no ejecutable.
- Migración 080: `NOT_REGISTERED, NOT_AUTOAPPLY`.

## Tests R2

**Archivo:** `server/services/ama/__tests__/amaR2Corrections.test.ts`

| Categoría | Tests | Estado |
|-----------|-------|--------|
| Seed Policy BTC | 8 | ✅ |
| Seed Policy ETH | 8 | ✅ |
| validateSeedPolicy | 2 | ✅ |
| Plan acumulativo | 4 | ✅ |
| Risk overlay | 3 | ✅ |
| HWM Bootstrap | 7 | ✅ |
| Bootstrap = Incremental | 4 | ✅ |
| Confirmación semanal | 1 | ✅ |
| IDs e idempotencia | 3 | ✅ |
| Migración 080 | 1 | ✅ |
| **Total** | **41** | **✅** |

## Validaciones ejecutadas

| Validación | Resultado |
|------------|-----------|
| `npm run check` (tsc) | ✅ Pass |
| `npx vitest run server/services/ama` | ✅ 560/560 pass |
| `npx vitest run server/services/ama/__tests__/amaR2Corrections.test.ts` | ✅ 41/41 pass |

## Riesgos residuales

1. **PostgreSQL:** Migración 080 no validada en entorno desechable. Script preparado.
2. **Confirmación semanal:** Deshabilitada por defecto. No afecta operación actual.
3. **Backward compat:** `planTranches()` legacy mantiene interfaz pero ahora requiere `asset` y `riskOverlayMultiplier` en `TranchePlanInput`.

## Gates

- **Commit:** NO AUTORIZADO hasta gate precommit R2.
- **Push:** NO AUTORIZADO hasta gate precommit R2.
- **Merge main:** PROHIBIDO.
- **Deploy:** PROHIBIDO.
- **Migración DB:** PROHIBIDA.
- **REAL mode:** PROHIBIDO.

## Veredicto

```text
PostgreSQL = BLOCKED_NO_SAFE_ENVIRONMENT
Docker = NOT_AVAILABLE
080 = NOT_REGISTERED
080 = NOT_AUTOAPPLY
R2 = APTO_PARA_COMMIT_R2_EN_RAMA_DE_REVISION
merge = NO AUTORIZADO
deploy = NO AUTORIZADO
R2_CORRECTIONS = IMPLEMENTED
R2_TESTS = 41/41 PASS
R2_TSC = PASS
R2_BUILD = PASS
R2_SUITE_COMPLETA = 3675 passed, 31 failed preexistentes, 29 skipped, 0 fallos nuevos
R2_GATE = PENDING_USER_AUTHORIZATION
```
