# B10 — Auditoría global de consumidores de tablas compartidas

**Fecha**: 2026-08-13  
**Bloqueador**: B10 — Consumidores legacy de `open_positions` y `trades` sin filtro `engine_owner`  
**Estado**: **PASS** — Filtros null-safe aplicados a todos los consumidores P0/P1/P2.

## Resumen

Las tablas `open_positions` y `trades` son compartidas entre el engine legacy y el SPOT canonical engine. El migration 086 añade `policy_version`, `engine_owner` y `origin` para discriminar provenancia. Se auditaron todos los consumidores del repo que tocan estas tablas.

## Null-safety verification

Todos los filtros usan la forma **null-safe**:

```typescript
or(isNull(table.engineOwner), ne(table.engineOwner, 'SPOT_CANONICAL'))
```

Esto equivale a SQL: `(engine_owner IS NULL OR engine_owner <> 'SPOT_CANONICAL')`

**Tres clases de filas**:

| `engine_owner` | ¿Visible a legacy? | ¿Visible a SPOT? |
|---|---|---|
| `NULL` | ✅ Sí (legacy histórico pre-migración) | ❌ No |
| `'LEGACY_NORMAL'` | ✅ Sí | ❌ No |
| `'SPOT_CANONICAL'` | ❌ No | ✅ Sí |

**SPOT_B10_NULL_SAFE_LEGACY_FILTER=PASS**

## Consumidores auditados — `storage.ts`

### P0 — Agregación PnL / portfolio (FILTROS APLICADOS)

| # | Función | Tabla | Propósito | Scope | Filtro | Riesgo | Estado |
|---|---------|-------|-----------|-------|--------|--------|--------|
| 1 | `getPortfolioRealizedPnlAggregate()` | trades | PnL monetario REAL | REAL_ONLY | ✅ `or(isNull,ne('SPOT_CANONICAL'))` | SHADOW inflaría PnL real | **PROTEGIDO** |
| 2 | `getTrades()` | trades | API historial legacy | LEGACY_ONLY | ✅ `or(isNull,ne('SPOT_CANONICAL'))` | SHADOW aparecería en historial | **PROTEGIDO** |
| 3 | `getFilledTradesForPerformance()` | trades | Métricas de rendimiento | LEGACY_ONLY | ✅ `or(isNull,ne('SPOT_CANONICAL'))` | SHADOW distorsionaría métricas | **PROTEGIDO** |
| 4 | `rebuildPnlForAllSells()` | trades | Reconstrucción FIFO PnL | LEGACY_ONLY | ✅ `or(isNull,ne('SPOT_CANONICAL'))` | SHADOW contaminaría FIFO | **PROTEGIDO** |
| 5 | `getUnmatchedBuys()` | trades | FIFO matching de buys | LEGACY_ONLY | ✅ `or(isNull,ne('SPOT_CANONICAL'))` | SHADOW buys en FIFO legacy | **PROTEGIDO** |

### P1 — Gestión de posiciones (FILTROS APLICADOS)

| # | Función | Tabla | Propósito | Scope | Filtro | Riesgo | Estado |
|---|---------|-------|-----------|-------|--------|--------|--------|
| 6 | `getOpenPositions()` | open_positions | API posiciones legacy | LEGACY_ONLY | ✅ `or(isNull,ne('SPOT_CANONICAL'))` | SPOT positions en API legacy | **PROTEGIDO** |
| 7 | `getOpenPositionsByPair()` | open_positions | FillWatcher / engine legacy | LEGACY_ONLY | ✅ `or(isNull,ne('SPOT_CANONICAL'))` | Legacy gestionaría SPOT | **PROTEGIDO** |
| 8 | `getOpenPositionsWithQtyRemaining()` | open_positions | Engine legacy qty management | LEGACY_ONLY | ✅ `or(isNull,ne('SPOT_CANONICAL'))` | Legacy gestionaría SPOT | **PROTEGIDO** |
| 9 | `countOccupiedSlotsForPair()` OPEN | open_positions | SMART_GUARD slot count | LEGACY_ONLY | ✅ `or(isNull,ne('SPOT_CANONICAL'))` | SPOT positions bloquearían legacy | **PROTEGIDO** |
| 10 | `countOccupiedSlotsForPair()` PENDING_FILL | open_positions | SMART_GUARD slot count | LEGACY_ONLY | ✅ `or(isNull,ne('SPOT_CANONICAL'))` | SPOT pending bloquearían legacy | **PROTEGIDO** |

### P2 — Backfill / admin (FILTROS APLICADOS)

| # | Función | Tabla | Propósito | Scope | Filtro | Riesgo | Estado |
|---|---------|-------|-----------|-------|--------|--------|--------|
| 11 | `getLegacyPositionsNeedingBackfill()` | open_positions | Backfill posiciones legacy | LEGACY_ONLY | ✅ `or(isNull,ne('SPOT_CANONICAL'))` | Backfill intentaría SPOT | **PROTEGIDO** |
| 12 | `getBackfillStatus()` legacyPositions | open_positions | Conteo posiciones legacy | LEGACY_ONLY | ✅ `or(isNull,ne('SPOT_CANONICAL'))` | Conteo inflado por SPOT | **PROTEGIDO** |

### Sin filtro requerido (safe by design)

| # | Función | Tabla | Razón |
|---|---------|-------|-------|
| 13 | `getOpenPosition(pair)` | open_positions | Búsqueda puntual por pair. Usado por admin close. Debe funcionar para cualquier posición. |
| 14 | `getOpenPositionByLotId()` | open_positions | Búsqueda por lotId. Usado para close/disable admin. Debe funcionar para cualquier posición. |
| 15 | `saveOpenPosition()` | open_positions | Insert/update. No es query de lectura. |
| 16 | `updateOpenPosition*()` | open_positions | Update por pair/lotId. Admin operation. |
| 17 | `deleteOpenPosition*()` | open_positions | Delete por pair/lotId/exchange. Admin cleanup. |
| 18 | `createTrade()` | trades | Insert. No es query de lectura. |
| 19 | `listTradesForRebuild()` | trades | Filtra por `origin='bot'` que excluye `origin='spot_engine'`. Safe. |
| 20 | `getRecentBotTradesCount()` | trades | Filtra por `origin IN ('bot','engine')` que excluye `origin='spot_engine'`. Safe. |
| 21 | `getRecentTradesForReconcile()` | trades | Filtra por `origin='sync'` por defecto. Safe. |
| 22 | `getDuplicateTradesByKrakenId()` | trades | Detección de duplicados por kraken_order_id. No agrega PnL. Safe. |
| 23 | `deleteInvalidFilledTrades()` | trades | Cleanup de trades inválidos (price=0). No afecta PnL. Safe. |
| 24 | `updateTradePnl*()` | trades | Update por ID/krakenOrderId. No es query de lectura. |
| 25 | `recalculatePositionAggregates()` | trades | Recálculo por positionId específico. Admin operation. |

## Consumidores auditados — otros módulos

### FISCO

| Archivo | Método de acceso | Tabla | Filtro | Riesgo | Estado |
|---------|-----------------|-------|--------|--------|--------|
| `server/services/fisco/*` | No accede directamente a `trades` o `open_positions` | N/A | N/A | N/A | **SAFE** — FISCO usa sus propias tablas (`fisco_*`) y obtiene datos de exchange sync, no de `trades` table |

### Portfolio

| Archivo | Método de acceso | Tabla | Filtro | Riesgo | Estado |
|---------|-----------------|-------|--------|--------|--------|
| `server/services/portfolio/*` | Usa `storage.getPortfolioRealizedPnlAggregate()` | trades | Hereda filtro de storage | PnL contamination | **PROTEGIDO** vía storage.ts |

### Reconciliation / Exchange sync

| Archivo | Método de acceso | Tabla | Filtro | Riesgo | Estado |
|---------|-----------------|-------|--------|--------|--------|
| `server/routes/market.routes.ts` | `storage.getRecentTradesForReconcile()` | trades | `origin='sync'` excluye SPOT | Reconciliation contamination | **SAFE** por origin filter |
| `server/services/FillWatcher.ts` | Callbacks + storage methods | open_positions | Hereda filtros de storage | FillWatcher gestionaría SPOT | **PROTEGIDO** vía storage.ts |

### FIFO Matcher

| Archivo | Método de acceso | Tabla | Filtro | Riesgo | Estado |
|---------|-----------------|-------|--------|--------|--------|
| `server/services/fifoMatcher.ts` | `storage.getUnmatchedBuys()` + `storage.getLotMatchesBySellFillTxid()` | trades/open_positions | Hereda filtro de storage | FIFO contamination | **PROTEGIDO** vía storage.ts |

### Trading Engine (legacy)

| Archivo | Método de acceso | Tabla | Filtro | Riesgo | Estado |
|---------|-----------------|-------|--------|--------|--------|
| `server/services/tradingEngine.ts` | storage methods | both | Hereda filtros de storage | Legacy gestionaría SPOT | **PROTEGIDO** vía storage.ts + single-owner guard |

### Shadow Executor

| Archivo | Método de acceso | Tabla | Filtro | Riesgo | Estado |
|---------|-----------------|-------|--------|--------|--------|
| `server/services/executors/ShadowExecutor.ts` | `trainingTradesTable` (tabla separada) | training_trades | N/A | N/A | **SAFE** — usa tabla propia, no `trades` |

### Telegram / AMA / IDCA / GRID / Autotuning

| Módulo | Método de acceso | Tabla | Filtro | Riesgo | Estado |
|--------|-----------------|-------|--------|--------|--------|
| Telegram | `storage.getTrades()` + `storage.getOpenPositions()` | both | Hereda filtros | Notificaciones mezclarían SPOT/legacy | **PROTEGIDO** vía storage.ts |
| AMA | `storage.getPortfolioRealizedPnlAggregate()` | trades | Hereda filtro | PnL contamination | **PROTEGIDO** vía storage.ts |
| IDCA | Usa sus propias tablas (`institutional_dca_*`) | N/A | N/A | N/A | **SAFE** — tablas separadas |
| GRID | Usa sus propias tablas (`grid_*`) | N/A | N/A | N/A | **SAFE** — tablas separadas |
| Autotuning | Usa `dryRunTrades` y `trainingTrades` | N/A | N/A | N/A | **SAFE** — tablas separadas |

### Admin routes

| Archivo | Query | Tabla | Filtro | Riesgo | Estado |
|---------|-------|-------|--------|--------|--------|
| `admin.routes.ts` | `DELETE FROM open_positions WHERE status='FAILED'` | open_positions | Sin filtro | Cleanup de FAILED podría borrar SPOT FAILED | **ACEPTABLE** — cleanup admin, no afecta PnL ni datos válidos |
| `admin.routes.ts` | `storage.listTradesForRebuild({origin:'bot'})` | trades | `origin='bot'` | SPOT trades no incluidos | **SAFE** por origin filter |
| `admin.routes.ts` | `CREATE INDEX` queries | both | N/A | DDL only | **SAFE** |

## P0 Invariantes

| Invariante | Estado |
|------------|--------|
| SHADOW jamás entra en FISCO | ✅ FISCO no lee `trades` table |
| SHADOW jamás entra en PnL monetario REAL | ✅ `getPortfolioRealizedPnlAggregate` filtrado |
| SHADOW jamás entra en Portfolio REAL | ✅ Portfolio usa storage methods filtrados |
| SHADOW jamás entra en reconciliation del exchange | ✅ `getRecentTradesForReconcile` filtra por `origin='sync'` |
| SHADOW jamás entra en balance real | ✅ Balance viene de exchange API, no de `trades` |
| SHADOW jamás entra en sync de ejecuciones reales | ✅ Sync usa `origin='sync'` |

**B10_SHARED_TABLE_AUDIT=PASS**
