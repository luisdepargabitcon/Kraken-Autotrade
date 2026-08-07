# Auditoría R3 — Correcciones Pre-Merge AMA V2.2

**Fecha:** 2026-07-30
**Rama:** `review/ama-seed-v2-2-20260729`
**Base R2 SHA:** `a74f55076972b380db8ecc8e7ace44cdfe268238`
**Estado:** IMPLEMENTADO — EN GATE PRECOMMIT R3

## Defectos R2 corregidos en R3

### 1. Doble descuento de reserva

**Problema:** `generateTrancheCandidateFromSeed()` y `planTranches()` calculaban `projectedFreeUsd` restando `amountUsd` del candidato, y luego volvían a restar `amountUsd` en el check de reserva obligatoria. Esto descuenta el candidato dos veces.

**Solución:** Reemplazado `projectedFreeUsd - amountUsd < mandatoryReserveUsd` por `projectedFreeAfterCandidateUsd < mandatoryReserveUsd`, donde `projectedFreeAfterCandidateUsd = budgetUsd - projectedDeployedUsd - reservedUsd` ya incluye el descuento del candidato.

**Archivos:** `server/services/ama/amaDeterministicEngine.ts`

### 2. Overlay silenciosamente clamped

**Problema:** `Math.min(riskOverlayMultiplier, 1.0)` convertía `1.50` en `1.00` sin validar ni rechazar.

**Solución:** Añadido `isValidRiskOverlayMultiplier()` que rechaza `> 1.0`, `<= 0`, `NaN`, `Infinity`. El planner retorna `null` (fail-closed) si el overlay es inválido.

**Archivos:** `server/services/ama/amaDeterministicEngine.ts`

### 3. Triggers Seed no vinculantes

**Problema:** `planTranchesFromSeeds()` aceptaba `pricePoints` externos sin verificar que alcanzaran el `triggerDropPct` canónico del tramo Seed.

**Solución:** Añadido `planSeedTranches()` que deriva `triggerPrice = hwmPrice * (1 - triggerDropPct / 100)` desde el HWM. Añadido `evaluateSeedTrancheEligibility()` que verifica que el cierre confirmado alcance el trigger. El planner verifica `price > canonicalTriggerPrice` antes de marcar elegible.

**Archivos:** `server/services/ama/amaDeterministicEngine.ts`

### 4. Look-ahead en HWM incremental

**Problema:** `processIncrementalClose()` recibía `allCloses` y podía usar cierres posteriores al `newClose`, incluyendo cierres futuros.

**Solución:** Cambiada API a `closesAvailableAsOfNewClose`. Filtra closes con `timestamp <= asOf`. Usa `normalizeClosedDailyCloses()` compartida.

**Archivos:** `server/services/ama/amaHwmBar.ts`

### 5. Vela incompleta no modelada

**Problema:** El test "vela incompleta" solo probaba falta de observaciones, no velas abiertas con `isClosed = false`.

**Solución:** Añadido `DailyCloseObservation` con `isClosed: boolean`. `bootstrapHWM`, `evaluateConfirmation` y `processIncrementalClose` filtran velas no cerradas.

**Archivos:** `server/services/ama/amaHwmBar.ts`

### 6. Deduplicación no compartida

**Problema:** Bootstrap deduplicaba inline, incremental no usaba la misma normalización.

**Solución:** Añadido `normalizeClosedDailyCloses()` que valida timestamp, normaliza UTC, ordena, elimina duplicados. Usada desde `bootstrapHWM`, `processIncrementalClose`, `evaluateConfirmation`.

**Archivos:** `server/services/ama/amaHwmBar.ts`

### 7. Test trivial de migración

**Problema:** Test R2 usaba `expect(true).toBe(true)` sin inspeccionar `server/routes.ts`.

**Solución:** Reemplazado por test real que lee `server/routes.ts`, extrae migraciones activas (saltando líneas comentadas), y verifica que `080_ama_initial` no esté activa.

**Archivos:** `server/services/ama/__tests__/amaR2Corrections.test.ts`

### 8. Falsos verdes `<= 75%`

**Problema:** Tests R2 usaban `<= 7500` y `>= 2500` que pasan aunque el resultado sea incorrecto.

**Solución:** Añadido tests de equality exacta: BTC `=== 7500`, ETH `=== 6500`, con assertions sobre número exacto de tramos, importe por tramo, y reason codes.

**Archivos:** `server/services/ama/__tests__/amaR2Corrections.test.ts`

## Inventario de archivos modificados

### Código

| Archivo | Cambios |
|---------|---------|
| `server/services/ama/amaDeterministicEngine.ts` | R3.1/R3.4/R3.5: `isValidRiskOverlayMultiplier`, `planSeedTranches`, `evaluateSeedTrancheEligibility`, fix doble descuento, trigger canónico |
| `server/services/ama/amaHwmBar.ts` | R3.6/R3.8/R3.9: `DailyCloseObservation`, `normalizeClosedDailyCloses`, no-lookahead incremental, `isClosed` filtering |

### Tests

| Archivo | Cambios |
|---------|---------|
| `server/services/ama/__tests__/amaR2Corrections.test.ts` | R3.2/R3.3/R3.7/R3.10/R3.11: +38 tests nuevos, equality exacta, incremental sin lookahead, migración real |

### Documentación

| Archivo | Cambios |
|---------|---------|
| `PLAN_IMPLEMENTACION_MODO_AMA.md` | Sección R3 |
| `FASES MODO AMA.md` | Estado R3 |
| `AUDITORIAS/AUDITORIA_CORRECCION_PREMERGE_AMA_V2_2_R3_2026-07-30.md` | Este archivo |

## Tests R3 nuevos

```text
BTC full Seed deploys exactly 75% and retains exactly 25%
ETH full Seed deploys exactly 65% and retains exactly 35%
overlay > 1.00 rechazado por planner (fail-closed)
overlay 1.50 rechazado por planner (fail-closed)
overlay negativo rechazado por planner (fail-closed)
overlay NaN rechazado por planner (fail-closed)
isValidRiskOverlayMultiplier accepts/rejects (6 tests)
planSeedTranches produce 6 niveles BTC con triggers canónicos
BTC tranche 1 trigger = 41000 para HWM 50000
BTC tranche 6 trigger = 18500 para HWM 50000
price 42000 no activa tranche -18%
price 41000 puede activar tranche -18%
price 20000 no cambia el trigger canónico del tramo -63%
ETH triggers exactos [24,32,41,51,61,71,80]
planSeedTranches rechaza overlay > 1.00 / NaN
primer cierre no puede ver segundo ni tercero
segundo cierre no puede ver tercero
no confirma antes del tercer cierre
confirma exactamente al recibir el tercer cierre
un cierre futuro extremo no altera el estado anterior
bootstrap final e incremental point-in-time coinciden
normalizeClosedDailyCloses (6 tests)
velas cerradas modeladas explícitamente (3 tests)
migración 080 real (2 tests)
```

## Riesgos residuales

1. **PostgreSQL:** Migración 080 no validada en entorno desechable. Docker no disponible.
2. **Confirmación semanal:** Deshabilitada por defecto. No afecta operación actual.
3. **Floating point:** Trigger check usa epsilon `1e-6` para evitar `9999.999... > 10000`.

## Gates

- **Commit:** NO AUTORIZADO hasta gate precommit R3.
- **Push:** NO AUTORIZADO hasta gate precommit R3.
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
R3 = APTO_PARA_COMMIT_R3_EN_RAMA_DE_REVISION
merge = NO AUTORIZADO
deploy = NO AUTORIZADO
R3_CORRECTIONS = IMPLEMENTED
R3_TESTS = 79/79 PASS (amaR2Corrections)
R3_AMA_TOTAL = 598/598 PASS
R3_TSC = PASS
R3_GATE = PENDING_USER_AUTHORIZATION
```
