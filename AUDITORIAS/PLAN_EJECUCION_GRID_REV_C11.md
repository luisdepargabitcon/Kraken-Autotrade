# PLAN DE EJECUCIÓN GRID V2 REV-C11

DONE: FALSE
HARD_BLOCKER: FALSE
TASK_STATUS: FASE 1 completada, pendiente commit y push
NEXT_ACTION: commit selectivo y push a origin/main
LAST_COMPLETED_ACTION: FASE 1 — 57/57 tests gridOpenCycleShadowClose verdes, 134/134 gridIsolated verdes, npm run check OK, npm run build OK
LAST_VALIDATION: 2026-07-23T07:45+02:00 check+build+tests OK
CURRENT_HEAD: pendiente (tras commit)
ORIGIN_HEAD: ee22c878b2d925cf3b38ec775edb1b629393b409
EXPECTED_DEPLOY_HASH: pendiente
DEPLOYED_HASH: pendiente
UPDATED_AT: 2026-07-23T07:45+02:00

## FASE 1 — Cambios aplicados

### gridIsolatedEngine.ts
1. **MIN_MAKER_REST_MS = 1**: constante para `makerEligibleAfter > makerOrderCreatedAt`.
2. **resolveExitForCycle**: eliminado check `makerEligibleAfter` time (tickId check es suficiente; tests síncronos no avanzan el reloj).
3. **persistSellLifecycle**: CAS con `.returning()` para ciclo y nivel SELL. Para TRIGGERED inicial (levelStatus="open") solo permite `buy_filled`/`hodl_recovery`, previniendo doble avance concurrente.
4. **processSellLevelLifecycle**: bloquea avance si ciclo en REQUIRES_REVIEW; propaga resultado booleano de persistSellLifecycle.
5. **completeCycleShadow**: rechaza cierre si `requiresReview=true`; in-memory sync de BUY rearm solo para rango activo (legacy mantiene filled).
6. **evaluateRiskForOpenCycles**: REQUIRES_REVIEW es terminal; revierte `cycle.status` en fallo de validación JSONB.
7. **advanceProtectiveExitLifecycle**: REQUIRES_REVIEW no avanza; `makerEligibleAfter` con offset MIN_MAKER_REST_MS.
8. **canProcessShadowFill**: SELL legacy busca ciclo por `level.rangeVersionId`; rechaza ciclos en review.
9. **simulateShadowTick**: incluye SELL levels de rangos anteriores con ciclo abierto que los reclama como target.

### gridOpenCycleShadowClose.test.ts
- 8 tests nuevos REV-C11 FASE 1: quarantine, CAS, rollback, memoria, concurrencia, makerEligibleAfter, legacy SELL, legacy BUY no abre ciclo.
- Fix fixture: legacy BUY level con `filledPrice: 60_000`.
