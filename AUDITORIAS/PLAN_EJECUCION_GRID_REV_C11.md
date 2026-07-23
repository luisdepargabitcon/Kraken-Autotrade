# PLAN DE EJECUCIÓN GRID V2 REV-C11

DONE: FALSE
HARD_BLOCKER: FALSE
TASK_STATUS: FASE 1 corrección post-commit, pendiente commit y push
NEXT_ACTION: commit selectivo y push a origin/main
LAST_COMPLETED_ACTION: Corrección post FASE 1 — restaurada doble barrera temporal, 65/65 tests gridOpenCycleShadowClose verdes, 142/142 gridIsolated verdes, npm run check OK, npm run build OK
LAST_VALIDATION: 2026-07-23T07:55+02:00 check+build+tests OK
CURRENT_HEAD: 0b0b9bb (pendiente nuevo commit)
ORIGIN_HEAD: 0b0b9bb
EXPECTED_DEPLOY_HASH: pendiente
DEPLOYED_HASH: pendiente
UPDATED_AT: 2026-07-23T07:55+02:00

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
