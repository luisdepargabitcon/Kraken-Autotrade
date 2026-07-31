# AUDITORÍA R4 — Correcciones Pre-Merge AMA V2.2

**Fecha:** 2026-07-30
**Iteración:** R4
**Branch:** `review/ama-seed-v2-2-20260729`
**Base R3 commit:** `f5cd254be4593d3a57ebe2b819baba051410e107`

---

## Resumen

R4 implementa 17 correcciones estructurales sobre el flujo adaptativo AMA, unificando el planificador canónico Seed, endureciendo la validación fail-closed, corrigiendo límites UTC, y eliminando lógica heredada redundante.

---

## Correcciones aplicadas

### R4.1 — Integrar planificador Seed en flujo adaptativo
- **Archivo:** `server/services/ama/amaDeterministicEngine.ts`
- **Cambio:** Añadido `buildCanonicalSeedPlan()` que combina validación de política, planificación de tramos, evaluación de elegibilidad y guardrails en un único constructor canónico.
- **Deprecado:** `planTranches()` se mantiene para compatibilidad pero el flujo adaptativo usa `buildCanonicalSeedPlan()`.

### R4.2 — Conservar metadatos canónicos en candidatos Seed
- **Archivo:** `server/services/ama/amaTypes.ts`, `server/services/ama/amaDeterministicEngine.ts`
- **Cambio:** `AmaTrancheCandidate` extendido con: `asset`, `seedTrancheIndex`, `canonicalTriggerDropPct`, `canonicalTriggerPrice`, `capitalPct`, `policyId`, `policyVersion`, `riskOverlayMultiplier`, `confirmedCloseTimestamp`.
- **Hash:** `canonicalPlanPayload()` ahora incluye metadatos canónicos y excluye `trancheId`, `createdAt`, `planId`.

### R4.3 — Replan con executed evidence real
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** Reemplazado `executedTrancheCount: number` por `ExecutedTrancheEvidence[]` con `trancheId`, `seedTrancheIndex`, `executedAmountUsd`, `fillStatus`, `idempotencyKey`.
- **Validación:** Detecta duplicados, marca tramos fully executed como inelegibles, no asume orden.

### R4.4 — Selección de un solo tramo por decisión
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `makeAdaptiveDecision()` ahora selecciona exactamente un tramo (el primero elegible) y expone `selectedTrancheId`, `selectedSeedTrancheIndex`, `selectedAmountUsd`, `selectedTriggerPrice`, `selectedPolicyId`.

### R4.5 — Política de gaps
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `AdaptiveDecision` ahora incluye `crossedLevels` (niveles donde precio ≤ trigger) y `pendingCooldownLevels` (crossed pero no elegibles).

### R4.6 — Cooldown UTC (epoch ms)
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `applyCooldown()` usa `Date.parse() + hours * 3600 * 1000` en lugar de `setHours()`. Rechaza timestamps inválidos. DST-safe.

### R4.7 — Límites semanal/mensual UTC
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** Añadido `startOfUtcWeek()` (Lunes 00:00 UTC) y `startOfUtcMonth()` (día 1 00:00 UTC). Eliminado reset por 28 días. `resetWeeklyIfNeeded` y `resetMonthlyIfNeeded` comparan boundaries canónicas.

### R4.8 — applyTrancheToPeriod reset antes de sumar
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `applyTrancheToPeriod()` ahora resetea weekly/monthly si la UTC boundary cambió antes de sumar el tramo.

### R4.9 — HWM isClosed obligatorio fail-closed
- **Archivo:** `server/services/ama/amaHwmBar.ts`
- **Cambio:** `normalizeClosedDailyClosesStrict()` rechaza candles sin `isClosed`. `processIncrementalClose()` rechaza `newClose` sin `isClosed`. `adaptLegacyCloseObservation()` devuelve `null` si `isClosed` es undefined.

### R4.10 — Normalizar timestamps a UTC canónico
- **Archivo:** `server/services/ama/amaHwmBar.ts`
- **Cambio:** `normalizeClosedDailyCloses()` y `normalizeClosedDailyClosesStrict()` convierten timestamps a `new Date().toISOString()` (UTC canónico). Deduplicación por instant UTC.

### R4.11 — Política determinista de duplicados
- **Archivo:** `server/services/ama/amaHwmBar.ts`
- **Cambio:** `normalizeClosedDailyClosesStrict()` devuelve `NormalizationResult` con `errors` y `valid`. Política: closed prevalece sobre open; mismo precio = dedup; precios distintos = `CONFLICTING_CLOSED_CANDLE` (bloquea).

### R4.12 — Cierres diarios consecutivos UTC
- **Archivo:** `server/services/ama/amaHwmBar.ts`
- **Cambio:** `evaluateConfirmation()` ahora requiere que los closes de confirmación sean consecutivos en UTC días (`areAllConsecutiveUtcDays()`). Gap resetea a `CONFIRMING`.

### R4.13 — Validar parámetros de confirmación
- **Archivo:** `server/services/ama/amaHwmBar.ts`
- **Cambio:** `evaluateConfirmation()` valida: `requiredConfirmations` entero > 0, `reversalThresholdPct` en (0, 100), `hwmPrice` > 0 finito, `hwmTimestamp` parseable. Fail-closed a `CANDIDATE`.

### R4.14 — Incremental HWM fail-closed con validación
- **Archivo:** `server/services/ama/amaHwmBar.ts`
- **Cambio:** `processIncrementalClose()` valida: timestamp parseable, close > 0 finito, `isClosed` presente, timestamp > HWM timestamp. Rechaza inválidos sin modificar HWM.

### R4.15 — Eliminar tercera lógica de reversión
- **Archivo:** `server/services/ama/amaHwmBar.ts`
- **Cambio:** `isReversalConfirmed()` ahora delega a `evaluateConfirmation()` en lugar de tener lógica independiente. Paridad garantizada.

### R4.16 — Validar Seed antes de planificar
- **Archivo:** `server/services/ama/amaDeterministicEngine.ts`
- **Cambio:** `validateSeedBeforePlanning()` valida: política seed, asset, budget > 0, HWM > 0, deployed/reserved ≥ 0, deployed+reserved ≤ budget, overlay válido. `buildCanonicalSeedPlan()` bloquea si hay errores.

### R4.17 — Rutas y servicio siguen como scaffold
- Sin cambios — el servicio y rutas ya están bloqueados para producción.

---

## Archivos modificados

| Archivo | Cambios |
|---------|---------|
| `server/services/ama/amaTypes.ts` | R4.2: Extensión de `AmaTrancheCandidate` con metadatos canónicos |
| `server/services/ama/amaDeterministicEngine.ts` | R4.1, R4.2, R4.16: `buildCanonicalSeedPlan`, `validateSeedBeforePlanning`, hash con metadatos |
| `server/services/ama/amaAdaptivePlanner.ts` | R4.1, R4.3-R4.8: `ExecutedTrancheEvidence`, single tranche, gap policy, UTC cooldown/limits, reset before sum |
| `server/services/ama/amaHwmBar.ts` | R4.9-R4.15: Strict normalization, consecutive days, param validation, incremental fail-closed, reversal parity |
| `server/services/ama/__tests__/amaR4Integration.test.ts` | **NUEVO** — 38 tests R4 |
| `server/services/ama/__tests__/amaR2Corrections.test.ts` | Fix: isClosed en test data, timestamp format .000Z |
| `server/services/ama/__tests__/amaAdaptivePlanner.test.ts` | Fix: ReplanContext adaptado, UTC week/month tests, single tranche assertions |

---

## Tests

- **Total AMA:** 637 tests en 21 archivos — **TODOS PASAN**
- **R4 nuevos:** 38 tests en `amaR4Integration.test.ts`
- **R2/R3 actualizados:** 3 tests corregidos por cambios de formato UTC y isClosed obligatorio

---

## Validación

- **npm run check:** ✅ (tsc, 0 errores)
- **npm run build:** ✅ (vite + tsx, 2598 módulos)
- **Tests AMA:** `vitest run server/services/ama` — 637/637 pass (21 archivos)
- **Tests Portfolio:** `vitest run server/services/portfolio` — 59/59 pass (3 archivos)
- **Suite completa:** `vitest run` — 3752 passed, 31 failed (preexistentes), 29 skipped (preexistentes)
- **Fallos nuevos:** 0
- **Skipped nuevos:** 0

---

## Actualización R5 (2026-07-31)

R4 ha sido committed y pushed a `origin/review/ama-seed-v2-2-20260729` en `9c86c148aecb980682e41ebc7719fbae3eaf7db9`. Las correcciones R5 se aplican sobre R4. Ver auditoría R5 para el estado actual.
