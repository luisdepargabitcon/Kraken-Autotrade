# PLAN DE EJECUCIÓN GRID V2 REV-C11

DONE: FALSE
HARD_BLOCKER: FALSE
TASK_STATUS: FASE 2 completada — 8 defectos corregidos, 47 tests añadidos, pendiente commit y push
NEXT_ACTION: commit selectivo y push a origin/main
LAST_COMPLETED_ACTION: FASE 2 — D1-D8 corregidos, 190/190 tests gridIsolated verdes, tsc OK, build OK
LAST_VALIDATION: 2026-07-23T10:52+02:00 tsc+build+vitest OK
CURRENT_HEAD: 0b0b9bb (pendiente nuevo commit)
ORIGIN_HEAD: 0b0b9bb
EXPECTED_DEPLOY_HASH: pendiente
DEPLOYED_HASH: pendiente
UPDATED_AT: 2026-07-23T10:52+02:00

## FASE 1 — Cambios aplicados

### gridIsolatedEngine.ts
1. **MIN_MAKER_REST_MS = 1**: constante para `makerEligibleAfter > makerOrderCreatedAt`.
2. **resolveExitForCycle**: DOBLE BARRERA restaurada — tick lógico posterior (`ctx.tickId > lifecycleTickId`) Y elegibilidad temporal real (`ctx.startedAt >= makerEligibleAfter`). Ambas condiciones son obligatorias simultáneamente.
3. **persistSellLifecycle**: CAS con `.returning()` para ciclo y nivel SELL. Para TRIGGERED inicial (levelStatus="open") solo permite `buy_filled`/`hodl_recovery`, previniendo doble avance concurrente.
4. **processSellLevelLifecycle**: bloquea avance si ciclo en REQUIRES_REVIEW; propaga resultado booleano de persistSellLifecycle; usa `tickCtx.startedAt` para `makerOrderCreatedAt` (no `new Date()`).
5. **completeCycleShadow**: rechaza cierre si `requiresReview=true`; in-memory sync de BUY rearm solo para rango activo (legacy mantiene filled).
6. **evaluateRiskForOpenCycles**: REQUIRES_REVIEW es terminal; revierte `cycle.status` en fallo de validación JSONB.
7. **advanceProtectiveExitLifecycle**: REQUIRES_REVIEW no avanza; usa `ctx.startedAt` (no `new Date()`); reprice actualiza `makerOrderCreatedAt` y crea nuevo `makerEligibleAfter` posterior.
8. **canProcessShadowFill**: SELL legacy busca ciclo por `level.rangeVersionId`; rechaza ciclos en review.
9. **simulateShadowTick**: incluye SELL levels de rangos anteriores con ciclo abierto que los reclama como target.

### gridOpenCycleShadowClose.test.ts
- Reloj controlado y monotónico: `testClockMs` avanza `TICK_CLOCK_STEP_MS` (100ms) por tick. `resetEngine` reinicia el reloj.
- Helper `processLifecycleTickAt` para tests con timestamp exacto.
- Helper `makeCtxAt` para construir tick context con `startedAt` arbitrario.
- 10 tests exactos de elegibilidad temporal:
  1. mismo tick lógico: bloqueado
  2. tick posterior pero 1 ms antes de makerEligibleAfter: bloqueado
  3. exactamente en makerEligibleAfter: permitido
  4. después de makerEligibleAfter: permitido
  5. timestamp anterior al makerOrderCreatedAt: bloqueado
  6. reloj regresivo: bloqueado
  7. reprice actualiza makerOrderCreatedAt
  8. reprice crea makerEligibleAfter nuevo y posterior
  9. tick posterior al reprice pero antes de la nueva elegibilidad: bloqueado
  10. tick posterior y elegible después del reprice: permitido
- Tests anteriores mantenidos: quarantine, CAS, rollback, memoria, concurrencia, legacy SELL, legacy BUY.
- Fix fixture: legacy BUY level con `filledPrice: 60_000`.

## FASE 2 — Cierre atómico y view models canónicos

### Defectos encontrados y corregidos

- **D1 (Medium)**: `completeCycleShadow` lanzaba error cuando el ciclo ya estaba cerrado en DB (`cycleUpdate.length !== 1`). **Fix**: devuelve `false` (no-op) sin throw, sin mutar memoria, sin emitir evento.
- **D2 (Low)**: SELL level CAS verificaba `isNull(filledAt)` pero no `status`. **Fix**: añadido `inArray(status, ["planned", "open"])` al WHERE del level update.
- **D4 (Medium)**: `buildCounters` en audit VM no incluía `"hodl_recovery"` en openCycles. **Fix**: añadido al filtro. También `stop_loss_hit` y `trailing_closed` añadidos a historicalCycles.
- **D5 (Medium)**: `buildGridOperationalViewModel` closedCycles solo filtraba `"completed"`. **Fix**: añadido `"stop_loss_hit"` y `"trailing_closed"` al filtro.
- **D6 (Low)**: `parseJsonSafe` en audit VM retornaba JSON válido no-objeto (string/number) sin envolver. **Fix**: añadido helper `isPlainObject` y retorno de `{}` para valores no-objeto.
- **D7 (Medium)**: `buildGridOperationalViewModel` openCycles no incluía `"hodl_recovery"`. **Fix**: añadido al filtro.
- **D8 (Low)**: `validateTargetCalculationJson` lanzaba `Error("invalid_candidate")` en lugar de retornar resultado de validación. **Fix**: retorna objeto con `reasonCode: "INVALID_CANDIDATE"` para candidatos inválidos.

### Tests añadidos (47 nuevos)

#### gridOpenCycleShadowClose.test.ts — 21 tests cierre atómico
- D1: 5 tests (no-op sin throw, concurrencia, no mutación, no evento)
- D2: 7 tests (SELL status cancelled/replaced/buy_maker_pending → rollback; planned/open → éxito; filledAt sin status → rollback; no mutación; no evento)
- CAS ciclo: 2 tests (status cancelled → no-op; completedAt set → no-op)
- closingCycleIds: 2 tests (limpieza post-éxito y post-no-op)
- Eventos PnL: 5 tests (GRID_CYCLE_COMPLETED roles, STOP_LOSS_HIT, TRAILING_CLOSED, SYNTHETIC_RUNG sin sellLevelId)

#### buildGridOperationalViewModel.test.ts — 11 tests view model operational
- D7: hodl_recovery en openCycles
- D5: stop_loss_hit, trailing_closed, completed en closedCycles
- Mix de statuses, cancelled/error excluidos
- openEstimatedNetPnlUsd solo ciclos abiertos
- hodl_recovery con riskStateJson
- stop_loss_hit PnL negativo
- trailing_closed con openedAt

#### gridForensicJsonb.test.ts — 15 tests audit VM y JSONB
- D8: 9 tests (side null/undefined/BOGUS/null-candidate → INVALID_CANDIDATE; side BUY/SELL válido; array vacío; no-array → valid:false; forensic preserva raw)
- D6: 5 tests (parseJsonSafe string válido, string no-objeto, number, JSON inválido, null)
- D4: 2 tests (buildCounters hodl_recovery en openCycles, stop_loss_hit+trailing_closed en historicalCycles)

### Validaciones
- `npx tsc --noEmit`: OK
- `npx vitest run server/services/gridIsolated/__tests__/`: 190/190 tests en 9 archivos
- `npm run build`: OK
