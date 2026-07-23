# PLAN DE EJECUCIÓN GRID V2 REV-C11

DONE: FALSE
HARD_BLOCKER: FALSE
TASK_STATUS: FASE 2 corregida — 5 defectos nuevos (A-E) corregidos, 25 tests añadidos, pendiente commit y push
NEXT_ACTION: FASE 3 (no iniciada — pendiente autorización)
LAST_COMPLETED_ACTION: FASE 2 CORRECCIÓN — Defectos A-E corregidos, 155/155 tests grid verdes, tsc OK, build OK
LAST_VALIDATION: 2026-07-23T12:22+02:00 tsc+build+vitest OK
CURRENT_HEAD: pendiente commit
ORIGIN_HEAD: 9b1b258
EXPECTED_DEPLOY_HASH: pendiente
DEPLOYED_HASH: pendiente
UPDATED_AT: 2026-07-23T12:22+02:00

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

## FASE 2 CORRECCIÓN — Atomicidad del rearme BUY y contrato canónico

### Contexto
La FASE 2 anterior quedó incompleta. Se identificaron 5 defectos nuevos (A-E) relacionados con la atomicidad del rearme BUY, el contrato canónico de ciclos abiertos vs terminales, y el manejo forense de JSON inválido.

### Defectos corregidos

- **Defecto D — Rearme BUY transaccional**: `completeCycleShadow` ahora devuelve un resultado transaccional explícito `{ committed, buyLevelRearmed }`. Cero filas en el UPDATE del BUY activo provoca rollback completo (throw). Más de una fila también provoca rollback. La memoria solo rearma el BUY si `buyLevelRearmed === true`. Legacy de rango anterior cierra sin intentar rearmar.
- **Defecto A — buildClosedCycle separado**: Creada función `buildClosedCycle` independiente de `buildOpenCycle`. Los ciclos terminales usan campos realizados (`sellPrice`, `sellFilledAt`, `realizedGrossPnl`, `realizedFee`, `realizedTax`, `realizedNetPnl`, `realizedNetPnlPct`) desde los campos persistidos. Campos `estimated*=null` para cerrados. Campos `realized*=null` para abiertos. Interfaz `OperationalOpenCycle` extendida con todos los campos comunes y de ejecución.
- **Defecto B — computeCycleEstimates sin fallback**: `computeCycleEstimates` ahora usa exclusivamente `targetSellPrice` (no `cycle.sellPrice` como fallback). Si `targetSellPrice` es null, las estimaciones son null. `buildClosedCycle` no llama a `computeCycleEstimates`.
- **Defecto C — sell_filled en closedCycles**: Añadido `"sell_filled"` al filtro de `closedCycleObjects` en el operational VM y al filtro de `historicalCycles` en `buildCounters` del audit VM.
- **Defecto E — parseJsonSafe forense**: `parseJsonSafe` en audit VM ahora conserva `_parseError`, `_raw`, `requiresReview`, `reviewCode`, `reviewReason` cuando el JSON es inválido, en lugar de retornar `{}` silenciosamente.

### Tests añadidos (25 nuevos)

#### gridOpenCycleShadowClose.test.ts — 11 tests (6 rearme BUY + 5 regresión)
- BUY de rango activo: commit, DB planned, memoria planned
- BUY cero filas: rollback completo, ciclo abierto, SELL no filled, BUY memoria filled, cero PnL, cero eventos
- BUY más de una fila: rollback completo
- Legacy de rango anterior: cierre permitido, BUY no rearmado, DB filled, memoria filled
- buyLevelRearmed=false: no rearma memoria
- Evento solo después de commit correcto
- Doble barrera maker sigue verde
- REQUIRES_REVIEW sigue en cuarentena
- persistSellLifecycle mantiene CAS
- SELL legacy sigue cerrando
- BUY legacy no abre nuevos ciclos

#### buildGridOperationalViewModel.test.ts — 9 tests contrato canónico
- Ciclo abierto: targetSellPrice presente, sellPrice=null, estimatedNetPnl no null, realizedNetPnl=null
- Ciclo completed con target≠sellPrice: PnL realizado de sellPrice, estimated*=null
- Ciclo stop_loss_hit: sellPrice real, PnL negativo, target histórico
- Ciclo trailing_closed: sellPrice real, target no sustituye
- Ciclo sell_filled: aparece en closedCycles, no en openCycles
- Ciclo terminal con sellPrice=null: null, no fallback al target
- Ciclo terminal con sellFilledAt=null: null, no fallback a completedAt
- Ciclo abierto sin target: estimaciones=null
- SYNTHETIC_RUNG: targetSellLevelId=null, targetRungLevelId conservado

#### gridForensicJsonb.test.ts — 5 tests audit/JSON
- JSON inválido conserva estado de revisión
- JSON inválido no se convierte en objeto sano silencioso
- Operational y Audit coinciden para ciclo cerrado con target≠sellPrice
- Operational y Audit coinciden para sell_filled
- Operational y Audit coinciden para SYNTHETIC_RUNG

### Archivos modificados
1. `server/services/gridIsolated/gridIsolatedEngine.ts` — Defecto D
2. `server/services/gridIsolated/buildGridOperationalViewModel.ts` — Defectos A, B, C
3. `server/services/gridIsolated/buildGridAuditViewModel.ts` — Defecto E + sell_filled en buildCounters
4. `server/services/gridIsolated/__tests__/gridOpenCycleShadowClose.test.ts` — 11 tests + fixtures BUY level
5. `server/services/gridIsolated/__tests__/buildGridOperationalViewModel.test.ts` — 9 tests
6. `server/services/gridIsolated/__tests__/gridForensicJsonb.test.ts` — 5 tests
7. `AUDITORIAS/PLAN_EJECUCION_GRID_REV_C11.md` — este documento

### Validaciones
- `npx tsc --noEmit`: OK
- `npx vitest run` (3 archivos grid): 155/155 tests verdes
- `npm run build`: OK
- `git diff --check`: OK

### Notas
- No se accedió al VPS. No se hizo deploy.
- Ciclo #26 intacto — no se modificó schema, migraciones, ni datos.
- No se inició FASE 3.
- NEXT_ACTION: FASE 3 pendiente de autorización.
