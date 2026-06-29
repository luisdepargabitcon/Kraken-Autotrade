# Auditoría — IDCA Hybrid Grid Traceability

## Fecha
2026-06-29

## Alcance
Verificación de la trazabilidad y visibilidad completa del modo observador de Grid Híbrido en el IDCA Bot.

## Resumen ejecutivo
Se implementa una máquina de estados clara para el Grid, persistencia de los niveles simulados en `idca_grid_legs` con precios, cantidades, capital esperado y PnL, una tabla nueva `idca_hybrid_events` para registro de eventos de ciclo de vida, y endpoints UI/UX para exponer esta información de forma natural y filtrable.

## Cambios implementados

### 1. Base de datos
- Migración `060_idca_hybrid_grid_traceability.sql`:
  - Añade columnas detalladas a `idca_grid_legs`: `planned_entry_price`, `planned_exit_price`, `quantity`, `planned_notional_usd`, `expected_gross_profit_usd`, `expected_fees_usd`, `expected_net_profit_usd`, `trigger_condition_json`, `cancel_condition_json`, `leg_group`, `regime_snapshot_json`, `grid_plan_id`, `created_at`, `triggered_at`, `closed_at`, `status`, `observer_only`.
  - Crea `idca_hybrid_events` con: `event_type`, `severity`, `natural_reason`, `observer_only`, `grid_plan_id`, `leg_index`, `state_before`, `state_after`, `price`, `quantity`, `notional_usd`, `expected_pnl_usd`, `raw_json`, `ts`.
  - Añade índices y función `cleanup_old_idca_hybrid_events`.
- Registrada en `server/routes.ts` AutoMigrationRunner.

### 2. Lógica de negocio
- `IdcaGridOverlay.ts`: `evaluateGridOverlay` ahora calcula `gridPlanId`, `plannedEntryPrice`, `plannedExitPrice`, `quantity`, `plannedNotionalUsd`, `expectedGrossProfitUsd`, `expectedFeesUsd`, `expectedNetProfitUsd`, `triggerCondition`, `cancelCondition`, `legGroup` y `observerOnly` para cada leg.
- `IdcaHybridDecisionService.ts`:
  - `persistGridLegs` persiste todos los campos anteriores.
  - `persistHybridEvent` registra eventos del ciclo de vida.
  - `evaluate` y `evaluateActiveCycle` emiten eventos `GRID_PLAN_CREATED`, `GRID_LEVEL_PLANNED`, `GRID_BLOCKED_*`, `ASSISTED_PROPOSAL_READY`.
  - Añade `getGridPlan`, `getAllGridPlans`, `getHybridEvents`.

### 3. API endpoints
- `GET /api/idca/hybrid/events` — filtrable por par, cycleId, eventType, since, observerOnly, limit.
- `GET /api/idca/hybrid/grid/:pair/:cycleId` — plan completo de grid + legs + eventos.
- `GET /api/idca/hybrid/grid` — listado de todos los planes de grid.
- Antiguo endpoint `/api/idca/hybrid/events` basado en `idca_hybrid_state` reemplazado por consulta directa a `idca_hybrid_events`.

### 4. UI
- `IdcaCycleGridOverlay.tsx`: muestra el plan de grid dentro de cada tarjeta de ciclo activo (niveles, capital, PnL simulado, eventos).
- `IdcaHybridEventsPanel.tsx`: tabla de eventos con filtros, motivos en lenguaje natural, raw técnico desplegable y advertencia de modo observador.
- `IdcaHybridPanel.tsx`: integra el overlay dentro de cada ciclo normal.

### 5. Tests
- `server/services/__tests__/idcaHybrid.test.ts`: 34 tests, incluyendo 2 nuevos de GridOverlay + 4 de migración.
- `server/services/__tests__/idcaHybridEventMapper.test.ts`: 21 tests (preexistentes) siguen pasando.

### 6. Seguridad / modo observador
- Todos los legs y eventos se marcan con `observer_only=true`.
- No se ejecutan órdenes reales ni se modifica configuración de ciclos automáticamente.
- Ciclos importados y manuales se protegen: el grid se bloquea y se registra el evento correspondiente.

## Verificación de calidad
- `npm run check`: ✅
- `npx vitest run server/services/__tests__/idcaHybrid.test.ts`: ✅ 34 tests
- `npx vitest run server/services/__tests__/idcaHybridEventMapper.test.ts`: ✅ 21 tests

## Recomendaciones
1. Desplegar en staging para validar la migración 060 sobre datos reales.
2. Verificar que el endpoint `GET /api/idca/hybrid/events` ya no devuelve `NOT_FOUND`.
3. Activar Grid Inteligente en modo Observador y confirmar que se generan eventos y legs.
4. Revisar el panel de ciclos para comprobar que aparece el grid dentro de cada ciclo normal.

## Aprobación para despliegue
El cambio no realiza trading real ni toma acciones automáticas. Recomienda aprobación del usuario para:
- Ejecutar deploy en staging (`git pull` + `docker compose up -d --build`).
- Ejecutar la migración 060 en producción cuando corresponda.
