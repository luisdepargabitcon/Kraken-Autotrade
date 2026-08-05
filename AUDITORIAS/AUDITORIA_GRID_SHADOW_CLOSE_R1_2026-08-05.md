# AUDITORÍA GRID SHADOW CLOSE R1 — 2026-08-05

## Estado

- Grid SHADOW todavía no está cerrado
- Fixes recuperados desde working tree local
- No se hizo commit directo en main
- Deploy pendiente
- Persistencia pendiente

## Fixes aplicados

### 1. Maker Pending Lifecycle (`gridShadowPolicy.ts`)
- `getCrossedShadowLevels` ahora incluye niveles `buy_maker_pending`
- Umbral de cruce: `buyMakerRequestedPrice` para pending, `price` para planned/open
- No incluye estados terminales
- No incluye SELL pending
- Tick guard existente en `canProcessShadowFill` bloquea fill en mismo tick

### 2. Timestamp Canónico (`gridIsolatedEngine.ts:968`)
- `resolveGridShadowExecutionPrice` ahora recibe `now: this.lastTickAt ?? undefined`
- Evita `future_timestamp` en freshness check
- Type-safe: no pasa null a campo Date

### 3. Quantity Step Alignment (`gridIsolatedEngine.ts:1639-1654`)
- Cantidades alineadas a `quantityStep` tras `toGridLevels`
- Redondeo hacia abajo (floor) — nunca aumenta exposición
- Notional recalculado tras redondeo
- Niveles con cantidad cero son filtrados
- Rango rechazado si quedan menos de 4 niveles viables

## Tests

- E2E: 29/29 ✅
- Maker Pending Lifecycle: 6/6 ✅
- Tests dirigidos: 127/127 ✅
- Revolut X: 48/48 ✅
- CHECK_EXIT=0
- BUILD_EXIT=0
- DIFF_EXIT=0
- Full suite real: 3483 tests, 30 fallos históricos, 0 fallos nuevos

## Seguridad

- Órdenes reales: 0
- DB no modificada
- Maker-only preservado
- Taker fallback deshabilitado
- Sin migraciones
- Sin cambios en Docker/compose/package

## Plan

DONE: FALSE
HARD_BLOCKER: FALSE
TASK_STATUS: fixes de cierre SHADOW publicados en review; pendientes integración y deploy
NEXT_ACTION: verificación limpia, fast-forward y deploy app-only
DEPLOY_AUTHORIZED: FALSE
MIGRATION_REQUIRED: FALSE
