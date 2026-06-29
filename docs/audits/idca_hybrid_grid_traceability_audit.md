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

---

## Revisión 2 — 2026-06-29: Corrección doble conteo niveles, capital y PnL

### Problema raíz
El grid genera dos legs técnicas por nivel lógico: `buy_entry` + `sell_tp`. Sin distinción semántica:
- `levelsCount` reportaba 6 para 3 niveles lógicos.
- `capitalUsedSimulatedUsd` sumaba buy+sell = doble del capital real en riesgo.
- `expectedNetProfitUsd` sumaba buy+sell = 2× el beneficio esperado real.
- Los eventos `GRID_LEVEL_PLANNED` se emitían para buy Y sell legs (6 eventos por 3 niveles).

### Corrección aplicada

**`IdcaGridOverlay.ts`**:
- Añadidos `gridLevelIndex` (1..n) y `legRole` (`buy_entry` | `sell_tp`) a `GridLeg`.
- `levelsCount` ya era `nLevels` (correcto), el error era en `getGridPlan`.

**`IdcaHybridDecisionService.ts` — `getGridPlan`**:
- `buyLevelsCount` = legs donde `side=buy` o `leg_role=buy_entry`.
- `tpLegsCount` = legs donde `side=sell` o `leg_role=sell_tp`.
- `totalLegsCount` = todas las legs técnicas.
- `plannedBuyCapitalUsd` = suma de `planned_notional_usd` solo en buy legs.
- `plannedSellNotionalUsd` = suma sell legs (solo informativo).
- `capitalUsedSimulatedUsd` = `plannedBuyCapitalUsd` (capital real en riesgo).
- `expectedNetProfitUsd` = suma solo buy legs (beneficio sin duplicar).
- `levelsTriggered` / `levelsClosed` cuentan solo buy legs.
- Nueva clave `levels[]` con grupos lógicos (1 fila por nivel: entry+TP).
- DB: `leg_role` y `grid_level_index` persistidos en `idca_grid_legs`.

**Migración 060** (ya existente, extendida): añade columnas `grid_level_index`, `leg_role`, `created_at`.

**Eventos**:
- `GRID_PLAN_CREATED` ahora incluye `stateAfter` correcto.
- `GRID_LEVEL_PLANNED` solo se emite para `buy_entry` legs (no duplicado para sell_tp).
- Metadatos incluyen `gridLevelIndex` y `legRole`.

**UI `IdcaCycleGridOverlay.tsx`**:
- Consume `levels[]` (lógicos) en lugar de `legs[]` brutos.
- Resumen: "N niveles de compra + N TP" en lugar de "N*2 niveles".
- Capital simulado en riesgo = solo buy capital.
- Beneficio neto esperado = solo buy PnL.

### Valores esperados para ETH/USD ciclo #29 (3 niveles, 48.67 USD/nivel)
- `buyLevelsCount: 3`, `tpLegsCount: 3`, `totalLegsCount: 6`
- `capitalUsedSimulatedUsd: ~146.01` (3 × 48.67)
- `expectedNetProfitUsd: ~1.54` (0.23 + 0.51 + 0.80)
- Eventos: 1× GRID_PLAN_CREATED, 3× GRID_LEVEL_PLANNED

### Tests añadidos (37 total en idcaHybrid.test.ts)
- `levelsCount = logical buy levels, NOT total legs`
- `each leg has gridLevelIndex and legRole`
- `buy-only capital and PnL do not double-count sell legs`

---

## Recomendaciones
1. Desplegar en staging para validar la migración 060 sobre datos reales.
2. Verificar que el endpoint `GET /api/idca/hybrid/events` ya no devuelve `NOT_FOUND`.
3. Activar Grid Inteligente en modo Observador y confirmar que se generan eventos y legs.
4. Revisar el panel de ciclos para comprobar que aparece el grid dentro de cada ciclo normal.

## Aprobación para despliegue
El cambio no realiza trading real ni toma acciones automáticas. Recomienda aprobación del usuario para:
- Ejecutar deploy en staging (`git pull` + `docker compose up -d --build`).
- Ejecutar la migración 060 en producción cuando corresponda.
