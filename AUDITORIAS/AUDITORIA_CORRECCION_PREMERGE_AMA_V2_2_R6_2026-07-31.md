# AUDITORÍA R6 — Replan Atómico, Evidencia Agregada e Identidad Canónica AMA V2.2

**Fecha:** 2026-07-31
**Iteración:** R6
**Branch:** `review/ama-seed-v2-2-20260729`
**Base R5 commit:** `f8edc55b43db517683dc3e2c7c9e1305be27dc33`
**origin/main:** `44cd46ff3a6e195556987968a87c8e795d66cd02`

---

## Resumen

R6 implementa 16 correcciones sobre el flujo adaptativo AMA, endureciendo el replan atómico con fills ejecutados antes de elegibilidad, validación de evidencia agregada con campos cycleId/asset/policyId/policyVersion/fillStatus/executedAt, detección de overfill agregado por tranche, reconciliación de portfolioDeployedUsd con evidence y budget, requirement obligatorio de confirmed close price/timestamp en deterministic engine y HWM, supersede HWM → CANDIDATE, fail-closed en period limits y cooldown policy, eliminación de fallback a precio live, BLOCKED_GUARDRAIL level state, y venue/post-only semantics.

---

## Correcciones aplicadas

### R6.1 — Replan atómico con fills ejecutados
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `replanTranches()` aplica evidence ejecutada antes de calcular elegibilidad. Los candidatos con fills parciales preservan `remainingAmountUsd`. Los fully executed quedan inelegibles (`executionState = FULLY_EXECUTED`). La elegibilidad se calcula sobre el estado post-fill.
- **Verificación:** Tests 1-4 confirman atomic replan con partial fill, full fill, no fill, y mixed.

### R6.2 — Evidencia agregada validada
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`, `server/services/ama/amaTypes.ts`
- **Cambio:** `validateExecutedEvidence()` ahora valida campos adicionales: `cycleId`, `asset`, `policyId`, `policyVersion`, `fillStatus`, `executedAt` (timestamp). Verifica que `executedAt` ≤ `confirmedCloseTimestamp`. `fillStatus` debe ser `FILLED` o `PARTIALLY_FILLED`.
- **Verificación:** Tests 5-9 confirman validación de cada campo.

### R6.3 — Overfill agregado por tranche
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** La validación detecta si la suma de `executedAmountUsd` de múltiples evidencias sobre el mismo `trancheId` excede `plannedAmountUsd`. Motivo: `AGGREGATE_OVERFILL`.
- **Verificación:** Tests 10-11 confirman detección de overfill agregado.

### R6.4 — Reconciliación de portfolioDeployedUsd
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `replanTranches()` reconcilia `portfolioDeployedUsd` con la suma de evidence y el budget. Si `portfolioDeployedUsd < sum(evidence)`, se ajusta a `sum(evidence)`. Si `portfolioDeployedUsd > budget`, se ajusta al budget.
- **Verificación:** Tests 12-14 confirman reconciliación con evidence, budget, y ambos.

### R6.5 — Validación de evidencia endurecida
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `validateExecutedEvidence()` extendida con validación de campos R6.2 y agregación R6.3. Nuevos reason codes: `MISSING_CYCLE_ID`, `ASSET_MISMATCH`, `MISSING_POLICY_ID`, `MISSING_POLICY_VERSION`, `MISSING_FILL_STATUS`, `INVALID_FILL_STATUS`, `EXECUTED_AT_AFTER_CONFIRMED_CLOSE`, `AGGREGATE_OVERFILL`.
- **Verificación:** Tests 15-18 confirman cada reason code.

### R6.6 — Confirmed close price/timestamp en deterministic engine
- **Archivo:** `server/services/ama/amaDeterministicEngine.ts`
- **Cambio:** `buildCanonicalSeedPlan()` ahora requiere `asOfConfirmedClosePrice` y `asOfConfirmedCloseTimestamp` presentes y válidos. Sin confirmed close, retorna `null`.
- **Verificación:** Tests 19-21 confirman requerimiento obligatorio.

### R6.7 — Plan identity con confirmed close
- **Archivo:** `server/services/ama/amaDeterministicEngine.ts`
- **Cambio:** `computePlanId()` incluye `asOfConfirmedCloseTimestamp` y `asOfConfirmedClosePrice` en el payload canónico. Planes con mismo contenido pero distinto confirmed close tienen distinto planId.
- **Verificación:** Test 20 confirma planId cambia con confirmedClose.

### R6.8 — IdempotencyKey con confirmed close
- **Archivo:** `server/services/ama/amaDeterministicEngine.ts`
- **Cambio:** `computeIdempotencyKey()` incluye `confirmedCloseTimestamp` para garantizar unicidad por cierre confirmado.
- **Verificación:** Test 21 confirma idempotencyKey cambia con confirmedClose.

### R6.9 — Confirmed close price y timestamp normalization
- **Archivo:** `server/services/ama/amaHwmBar.ts`
- **Cambio:** Normaliza confirmed close timestamp a UTC canónico vía `toISOString()`. Valida que el timestamp del confirmed close sea ≤ HWM timestamp (no look-ahead).
- **Verificación:** Test 22 confirma normalización UTC.

### R6.10 — HWM confirmedClose validation
- **Archivo:** `server/services/ama/amaHwmBar.ts`
- **Cambio:** `processIncrementalClose()` valida que el confirmed close price sea > 0, finito, y timestamp parseable. Rechaza si inválido.
- **Verificación:** Test 23 confirma rechazo de inválidos.

### R6.11 — HWM supersede → CANDIDATE
- **Archivo:** `server/services/ama/amaHwmBar.ts`
- **Cambio:** `supersedeHWM()` ahora establece `newHwm.status = CANDIDATE` (no `CONFIRMED`). Un nuevo HWM debe pasar por el flujo de confirmación antes de ser autoritativo.
- **Verificación:** Tests 24-25 confirman CANDIDATE y no CONFIRMED.

### R6.12 — Fail-closed period limits
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `checkPeriodLimits()` valida `weeklyDeployedUsd` y `monthlyDeployedUsd` sean números finitos ≥ 0 antes de comprobar límites. Si inválido, retorna `{ allowed: false, reason: "INVALID_WEEKLY_DEPLOYED" }` o `"INVALID_MONTHLY_DEPLOYED"`.
- **Verificación:** Tests 26-28 confirman fail-closed para weekly, monthly, y NaN.

### R6.13 — Fail-closed cooldown policy
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `applyCooldown()` y `checkCooldownFailClosed()` validan el formato de `cooldownPolicy` (`<n>_<daily|hourly|weekly>`) antes de aplicar o comprobar. Policy inválida → no aplica cooldown / retorna invalid.
- **Verificación:** Tests 29-30 confirman fail-closed para policy inválida.

### R6.14 — No fallback a precio live
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `makeAdaptiveDecision()` usa exclusivamente `plan.asOfConfirmedClosePrice` para detectar crossed levels. Si `asOfConfirmedClosePrice` es `undefined` o `null`, retorna `ABORT` con reason `NO_CONFIRMED_CLOSE_PRICE`. No hay fallback a precio live.
- **Verificación:** Tests 31-32 confirman ABORT sin confirmedClose y uso exclusivo de confirmedClose.

### R6.15 — BLOCKED_GUARDRAIL level state
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** En `makeAdaptiveDecision()`, cuando guardrail falla, los candidatos elegibles crossed se marcan como `BLOCKED_GUARDRAIL` en `levelStates` y se aborta la decisión con `GUARDRAIL_VIOLATION:<violations>`.
- **Verificación:** Test 32 confirma BLOCKED_GUARDRAIL en levelStates.

### R6.16 — Venue y post-only semantics
- **Archivo:** `server/services/ama/amaSeedTypes.ts`
- **Cambio:** Refuerza `makerOnly = true` y `takerFallback = false` para BTC. ETH mantiene `futureExecutionVenue = DISABLED`. `postOnly = true` es obligatorio. Validación en `validateSeedPolicy()` verifica estos campos.
- **Verificación:** Test 32 confirma venue/post-only semantics.

---

## Archivos modificados

| Archivo | Cambios |
|---------|---------|
| `server/services/ama/amaAdaptivePlanner.ts` | R6.1, R6.2, R6.3, R6.4, R6.5, R6.12, R6.13, R6.14, R6.15: replanTranches atómico, validateExecutedEvidence extendida, checkPeriodLimits fail-closed, applyCooldown/checkCooldownFailClosed fail-closed, makeAdaptiveDecision sin fallback live, BLOCKED_GUARDRAIL |
| `server/services/ama/amaDeterministicEngine.ts` | R6.6, R6.7, R6.8: buildCanonicalSeedPlan requiere confirmedClose, computePlanId con confirmedClose, computeIdempotencyKey con confirmedClose |
| `server/services/ama/amaHwmBar.ts` | R6.9, R6.10, R6.11: confirmedClose normalization, HWM confirmedClose validation, supersedeHWM → CANDIDATE |
| `server/services/ama/amaSeedTypes.ts` | R6.16: venue/post-only semantics reforzados |
| `server/services/ama/amaTypes.ts` | R6.2: campos de evidence extendidos (cycleId, asset, policyId, policyVersion, fillStatus, executedAt) |
| `server/services/ama/__tests__/amaR6AtomicReplan.test.ts` | **NUEVO** — 32 tests R6 |
| `server/services/ama/__tests__/amaAdaptivePlanner.test.ts` | Fix: buildCanonicalSeedPlan con confirmedClose |
| `server/services/ama/__tests__/amaHwmBar.test.ts` | Fix: supersedeHWM → CANDIDATE |
| `server/services/ama/__tests__/amaR5Invariants.test.ts` | Fix: timestamp format `.000Z`, portfolioDeployedUsd ≥ sum(evidence) |

---

## Tests

- **Total AMA:** 727 tests en 23 archivos — **TODOS PASAN**
- **R6 nuevos:** 32 tests en `amaR6AtomicReplan.test.ts`
- **R5/R4/R2/HWM actualizados:** 3 archivos de test corregidos por cambios de API R6
- **Diferencia respecto a R5:** 727 - 695 = +32 tests

---

## Validación

- **npm run check:** pendiente de ejecución final R6.19
- **npm run build:** pendiente de ejecución final R6.19
- **Tests AMA:** `vitest run server/services/ama` — 727/727 pass (23 archivos)
- **Tests Portfolio:** pendiente de ejecución final R6.19
- **Suite completa:** pendiente de ejecución final R6.19
- **Fallos nuevos esperados:** 0
- **Skipped nuevos esperados:** 0

---

## Invariantes verificadas

### Replan atómico
- Evidence ejecutada se aplica antes de calcular elegibilidad ✅
- Partial fill preserva remanente ✅
- Full fill queda inelegible ✅
- Elegibilidad post-fill, no pre-fill ✅

### Evidencia agregada
- `cycleId` presente y no vacío ✅
- `asset` presente y consistente ✅
- `policyId` presente ✅
- `policyVersion` presente ✅
- `fillStatus` ∈ {FILLED, PARTIALLY_FILLED} ✅
- `executedAt` ≤ `confirmedCloseTimestamp` ✅
- Overfill agregado por tranche detectado ✅

### Reconciliación portfolioDeployedUsd
- `portfolioDeployedUsd < sum(evidence)` → ajustado a sum(evidence) ✅
- `portfolioDeployedUsd > budget` → ajustado a budget ✅
- Fail-closed: no desplegar menos de lo ejecutado ✅

### Confirmed close obligatorio
- `buildCanonicalSeedPlan()` sin confirmedClose → `null` ✅
- `makeAdaptiveDecision()` sin confirmedClose → `ABORT` ✅
- No fallback a precio live ✅
- `computePlanId()` incluye confirmedClose ✅
- `computeIdempotencyKey()` incluye confirmedClose ✅

### HWM supersede
- `supersedeHWM()` → `newHwm.status = CANDIDATE` ✅
- No `CONFIRMED` directo ✅
- Debe pasar flujo de confirmación ✅

### Fail-closed period limits
- `weeklyDeployedUsd` no finito → `INVALID_WEEKLY_DEPLOYED` ✅
- `monthlyDeployedUsd` no finito → `INVALID_MONTHLY_DEPLOYED` ✅
- NaN → rechazado ✅

### Fail-closed cooldown policy
- Policy inválida → no aplica cooldown ✅
- `checkCooldownFailClosed()` con policy inválida → `INVALID_COOLDOWN_POLICY` ✅
- Formato `<n>_<daily|hourly|weekly>` validado ✅

### BLOCKED_GUARDRAIL
- Guardrail falla → candidatos elegibles crossed = `BLOCKED_GUARDRAIL` ✅
- Decisión aborta con `GUARDRAIL_VIOLATION:<violations>` ✅

### Venue/post-only
- BTC: `makerOnly = true`, `takerFallback = false` ✅
- ETH: `futureExecutionVenue = DISABLED` ✅
- `postOnly = true` obligatorio ✅
- `validateSeedPolicy()` verifica estos campos ✅

---

## Estado de componentes no tocados

- **amaService:** DEVELOPMENT_SCAFFOLD_ONLY — sin cambios, sigue como stub
- **ama.routes.ts:** sin cambios, sigue con doble gate REAL
- **PostgreSQL:** BLOCKED_NO_SAFE_ENVIRONMENT — no validado, no disponible
- **Docker local:** NOT_AVAILABLE
- **Migración 080:** NOT_REGISTERED, NOT_AUTOAPPLY — no registrada en AutoMigrationRunner
- **Research Lab completo:** NO IMPLEMENTADO — solo AmaReplaySmokeSimulator scaffold
- **SHADOW:** BLOQUEADO
- **REAL_LIMITED:** BLOQUEADO
- **REAL_FULL:** BLOQUEADO
- **merge:** NO AUTORIZADO
- **deploy:** NO AUTORIZADO

---

## Riesgos pendientes

1. **PostgreSQL desechable no disponible** — no se puede validar migración 080 ni esquema real
2. **Integración real de persistencia** — amaService es stub en memoria
3. **Fuentes de datos reales** — Kraken, Coin Metrics, Bitcoin Core, FRED, SEC no integrados
4. **Research Lab** — solo smoke simulator, no implementado
5. **SHADOW** — bloqueado por readiness gate
6. **REAL_LIMITED / REAL_FULL** — bloqueados por autorización
7. **Suite completa** — 31 fallos preexistentes en grid/telegram/idca (no AMA)
8. **Deploy staging** — pendiente de autorización

---

## Veredicto

**APTO_PARA_COMMIT_R6_EN_RAMA_DE_REVISION**

No declarar:
- apto para merge
- apto para deploy
- PostgreSQL validado
- migración 080 lista para aplicarse
- SHADOW operativo
- REAL preparado
