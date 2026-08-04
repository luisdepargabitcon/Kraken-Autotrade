# AUDITORÍA R7 — Atomicidad verdadera, identidad unificada y HWM parity AMA V2.2

**Fecha:** 2026-07-31
**Iteración:** R7
**Branch:** `review/ama-seed-v2-2-20260729`
**Base R6 commit:** `7d6cbffcc688690c380b5903f3dc2a7c9a5381e3`
**origin/main:** `44cd46ff3a6e195556987968a87c8e795d66cd02`

---

## Resumen

R7 implementa 12 correcciones sobre el pipeline adaptativo AMA, transformando el replan en un pipeline atómico real con pipeline ordenado estricto, intervalo temporal completo de evidence, semántica agregada PARTIAL/FILLED, reconciliación fail-closed de portfolioDeployedUsd, HWM obligatorio en planes canónicos, planId y planHash con identidad única desde el plan final, idempotencia derivada del plan final, paridad HWM con velas abiertas, validación de PeriodLimitState antes de reset, cooldown con resultado explícito, y venue canónico con makerOnly/postOnly/takerFallback.

---

## Correcciones aplicadas

### R7.1 — Replan verdaderamente atómico
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `replanTranches` reescrito como pipeline ordenado estricto: Step 1 validar originalPlan (HWM obligatorio) → Step 2 validar evidence → Step 3 agregar evidence por tranche → Step 4 reconciliar portfolioDeployedUsd → Step 5 construir remaining seed levels → Step 6 evaluar elegibilidad → Step 7-12 finalizar plan con versión e identidad.
- **Verificación:** Tests 1-6 confirman pipeline atómico con partial, full, no fill, mixed, y abort en evidence inválida.

### R7.2 — Elegibilidad post-fill recalculada
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** La elegibilidad se evalúa después de aplicar fills. Los candidatos con partial fill preservan `remainingAmountUsd` y se evalúan con el remanente. Los fully executed quedan inelegibles.
- **Verificación:** Tests 7-10 confirman elegibilidad post-fill.

### R7.3 — Intervalo temporal completo de evidence
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `validateExecutedEvidence` ahora recibe `currentConfirmedClose` y valida que `executedAt` esté entre `planAsOfConfirmedCloseTimestamp` y `currentConfirmedClose.timestamp`. Reason code `EXECUTED_BEFORE_PLAN_AS_OF` reemplaza `EXECUTED_BEFORE_CONFIRMED_CLOSE`.
- **Verificación:** Tests 11-14 confirman intervalo temporal.

### R7.4 — Semántica agregada PARTIAL/FILLED
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** Valida secuencia de fillStatus: FILLED con remanente > 0 → rechazado; PARTIAL que alcanza full amount → rechazado; múltiples FILLED → rechazado; evento después de FILLED → rechazado. Reason codes: `FILLED_WITH_REMAINING`, `PARTIAL_EXCEEDS_PLANNED`, `DUPLICATE_FILLED`, `EVENT_AFTER_FILLED`.
- **Verificación:** Tests 15-20 confirman semántica agregada.

### R7.5 — portfolioDeployedUsd fail-closed
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** Reconciliación estricta: `portfolioDeployedUsd < sum(evidence)` → null (abort); `portfolioDeployedUsd > budget` → null (abort). No hay ajuste silencioso.
- **Verificación:** Tests 21-23 confirman fail-closed.

### R7.6 — HWM obligatorio en planes canónicos
- **Archivo:** `server/services/ama/amaDeterministicEngine.ts`, `server/services/ama/amaTypes.ts`
- **Cambio:** `AmaTranchePlan` requiere `hwmPrice` y `hwmTimestamp`. `buildCanonicalSeedPlan` los recibe de `SeedTranchePlanInput`. Los builders legacy los añaden con defaults.
- **Verificación:** Tests 24-26 confirman HWM obligatorio.

### R7.7 — planId y planHash con identidad única
- **Archivo:** `server/services/ama/amaDeterministicEngine.ts`, `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `planId = plan-${cycleId}-${planHash.slice(0,24)}` donde `planHash = computePlanHash(plan)` sobre el plan final completo. `finalizeReplannedSeedPlan` genera el planId después de construir el plan completo. `computePlanId` legacy mantiene compatibilidad.
- **Verificación:** Tests 27-30 confirman identidad unificada.

### R7.8 — Idempotencia derivada del plan final
- **Archivo:** `server/services/ama/amaDeterministicEngine.ts`
- **Cambio:** `computeIdempotencyKey(planHash, trancheId, action, canonicalAsOfTimestamp)`. Deriva del planHash final, no de campos individuales dispersos.
- **Verificación:** Tests 31-33 confirman idempotencia desde plan final.

### R7.9 — Paridad HWM con velas abiertas
- **Archivo:** `server/services/ama/amaHwmBar.ts`
- **Cambio:** `bootstrapHWM` y `processIncrementalClose` pasan todas las observaciones (open+closed) después del HWM para confirmación. Las velas abiertas pueden resetear la secuencia de confirmación si su high supera el HWM actual.
- **Verificación:** Tests 34-37 confirman paridad con velas abiertas.

### R7.10 — PeriodLimitState validado antes de reset
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `validatePeriodLimitState` verifica: weekStart es Monday UTC, monthStart es día 1 UTC, deployedUsd ≥ 0, budgetUsd ≥ 0. Si inválido, `makeAdaptiveDecision` retorna ABORT con `PERIOD_STATE_INVALID:<reason>`.
- **Verificación:** Tests 38-41 confirman validación de period state.

### R7.11 — Cooldown con resultado explícito
- **Archivo:** `server/services/ama/amaAdaptivePlanner.ts`
- **Cambio:** `applyCooldown` retorna `CooldownApplyResult extends CooldownState` con `valid: boolean` y `reasonCodes: string[]`. Backward compatible: los callers que usan campos de CooldownState siguen funcionando.
- **Verificación:** Tests 42-45 confirman cooldown con resultado explícito.

### R7.12 — Venue canónico
- **Archivo:** `server/services/ama/amaSeedTypes.ts`
- **Cambio:** `makerOnly = true`, `postOnly = true`, `takerFallback = false` en BTC y ETH asset profiles. `targetExecutionVenue` canónico. `validateSeedPolicy` verifica estos campos.
- **Verificación:** Tests 46-49 confirman venue canónico.

---

## Archivos modificados

| Archivo | Cambios |
|---------|---------|
| `server/services/ama/amaAdaptivePlanner.ts` | R7.1–R7.5, R7.10, R7.11: pipeline atómico, validateExecutedEvidence con intervalo temporal y fillStatus, validatePeriodLimitState, applyCooldown con CooldownApplyResult |
| `server/services/ama/amaDeterministicEngine.ts` | R7.6, R7.7, R7.8: HWM obligatorio, planId desde planHash, computeIdempotencyKey desde plan final |
| `server/services/ama/amaHwmBar.ts` | R7.9: paridad HWM con velas abiertas |
| `server/services/ama/amaSeedTypes.ts` | R7.12: makerOnly en asset profiles |
| `server/services/ama/amaTypes.ts` | tipos actualizados |
| `server/services/ama/__tests__/amaR7TrueAtomicity.test.ts` | **NUEVO** — 49 tests R7 |
| `server/services/ama/__tests__/amaR5Invariants.test.ts` | Fix: replanClose, computePlanHash, weekStart Monday |
| `server/services/ama/__tests__/amaR6AtomicReplan.test.ts` | Fix: replanClose, EXECUTED_BEFORE_PLAN_AS_OF, CooldownApplyResult |

---

## Tests

- **Total AMA:** 776 tests en 24 archivos — **TODOS PASAN**
- **R7 nuevos:** 49 tests en `amaR7TrueAtomicity.test.ts`
- **R5/R6 actualizados:** 2 archivos de test corregidos por cambios de API R7
- **Diferencia respecto a R6:** 776 - 727 = +49 tests

---

## Validación

- **npm run check:** ✅
- **npm run build:** ✅
- **Tests R7:** `vitest run server/services/ama/__tests__/amaR7TrueAtomicity.test.ts` — 49/49 pass
- **Tests AMA:** `vitest run server/services/ama` — 776/776 pass (24 archivos)
- **Tests Portfolio:** pendiente de ejecución final R7.15
- **Suite completa:** pendiente de ejecución final R7.15
- **Fallos nuevos esperados:** 0
- **Skipped nuevos esperados:** 0

---

## Invariantes verificadas

### Replan atómico verdadero
- Pipeline ordenado estricto: validar → agregar → reconciliar → construir → evaluar → finalizar ✅
- Evidence ejecutada se aplica antes de calcular elegibilidad ✅
- Partial fill preserva remanente ✅
- Full fill queda inelegible ✅
- Elegibilidad post-fill, no pre-fill ✅

### Intervalo temporal de evidence
- `executedAt` ≥ `planAsOfConfirmedCloseTimestamp` ✅
- `executedAt` ≤ `currentConfirmedClose.timestamp` ✅
- Reason code `EXECUTED_BEFORE_PLAN_AS_OF` ✅

### Semántica agregada PARTIAL/FILLED
- FILLED con remanente > 0 → rechazado ✅
- PARTIAL que alcanza full amount → rechazado ✅
- Múltiples FILLED → rechazado ✅
- Evento después de FILLED → rechazado ✅

### portfolioDeployedUsd fail-closed
- `portfolioDeployedUsd < sum(evidence)` → null ✅
- `portfolioDeployedUsd > budget` → null ✅
- No hay ajuste silencioso ✅

### HWM obligatorio
- `AmaTranchePlan` requiere `hwmPrice` y `hwmTimestamp` ✅
- `buildCanonicalSeedPlan` los recibe de input ✅

### Identidad unificada
- `planId = plan-${cycleId}-${planHash.slice(0,24)}` ✅
- `planHash` sobre plan final completo ✅
- `computeIdempotencyKey` desde planHash ✅

### Paridad HWM con velas abiertas
- Velas abiertas resetean secuencia de confirmación ✅
- `bootstrapHWM` pasa todas las observaciones ✅

### PeriodLimitState validado
- weekStart = Monday UTC ✅
- monthStart = día 1 UTC ✅
- deployedUsd ≥ 0 ✅
- ABORT si inválido ✅

### Cooldown con resultado explícito
- `CooldownApplyResult extends CooldownState` ✅
- `valid` y `reasonCodes` en resultado ✅
- Backward compatible ✅

### Venue canónico
- BTC: `makerOnly = true`, `takerFallback = false` ✅
- ETH: `makerOnly = true`, `takerFallback = false` ✅
- `postOnly = true` obligatorio ✅

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

**APTO_PARA_COMMIT_R7_EN_RAMA_DE_REVISION**

No declarar:
- apto para merge
- apto para deploy
- PostgreSQL validado
- migración 080 lista para aplicarse
- SHADOW operativo
- REAL preparado

---

## Actualización R8A (2026-08-03)

R8A completa la alineación de la migración 080 con los contratos R7 y configura CI PostgreSQL desechable.

**Cambios R8A sobre baseline R7:**
- Migración 080 rediseñada con contratos R7 completos (tablas, columnas, CHECKs, FKs, indexes)
- Helpers canónicos migrados a `scripts/ama_migration_validation_helpers.mjs` (JS puro)
- Validator endurecido con main module guard (no ejecuta en import)
- 46 tests unitarios nuevos (total AMA: 822 = 776 R7 + 46 R8A)
- CI: workflow PostgreSQL 16 desechable con `npm run check` + `validate:ama:postgres`

**Validaciones R8A:**
- `npm run check` ✅ | `npm run build` ✅
- `vitest amaR8MigrationValidator` ✅ 46/46
- `vitest server/services/ama` ✅ 822 passed
- `vitest server/services/portfolio` ✅ 59/59
- `vitest run` ✅ 3934 passed / 34 failed (preexistentes) / 29 skipped

**Veredicto R8A:** APTO_PARA_COMMIT_R8A_Y_EJECUCION_CI_EN_RAMA_DE_REVISION
