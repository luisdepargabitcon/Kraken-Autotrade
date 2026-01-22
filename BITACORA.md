# 📋 BITÁCORA - WINDSURF CHESTER BOT

> **Fuente de verdad** para registro cronológico de cambios, incidentes, deploys y verificaciones.  
> Entradas en **orden cronológico inverso** (más reciente arriba).

---

## 2026-01-22 21:30 (Europe/Madrid) — [ENV: VPS/STG] — REGLA ÚNICA: open_positions = solo posiciones del bot

### Resumen
Eliminados modos SAFE/ADOPT. Implementada regla única: `open_positions` contiene únicamente posiciones abiertas por el bot (engine), nunca balances externos del exchange.

### Evidencia Forense
1. **2026-01-21 22:30:44Z** — CREACIÓN MASIVA por MANUAL RECONCILE desde BUY históricos
2. **2026-01-22 08:14:29Z** — Smart-Guard intenta VENDER ETH por Break-even
3. **2026-01-22 14:57:27Z** — RECONCILE ADOPTA holdings y ACTUALIZA cantidades (365%+ inflado)

### REGLA ÚNICA Implementada
> `open_positions` = solo posiciones abiertas por el bot (engine), nunca balances externos

### Cambios Concretos

**A) Reconcile simplificado (sin modos):**
- Eliminado `adoptMode` - ya no existe modo ADOPT
- Solo elimina posiciones del bot si balance real = 0
- Solo actualiza qty de posiciones del bot (con configSnapshot)
- PROHIBIDO crear posiciones desde balances externos

**B) Smart-Guard solo gestiona posiciones del bot:**
- Verifica: `configSnapshot != null` + `entryMode === 'SMART_GUARD'` + sin prefijos especiales
- Posiciones con lotId `reconcile-`, `sync-`, `adopt-` → ignoradas

**C) Sync de RevolutX:**
- Solo importa trades a tabla `trades`
- Nunca crea/modifica `open_positions`

### Archivos Tocados
- `server/routes.ts` (reconcile sin modos, solo bot positions)
- `server/services/tradingEngine.ts` (Smart-Guard solo bot positions)
- `client/src/pages/Terminal.tsx` (UI sin mención de modos)

### Deploy/Comandos
```bash
cd /opt/krakenbot-staging
git pull origin main
docker compose -f docker-compose.staging.yml up -d --build --force-recreate
```

### Verificación Post-Deploy
```bash
# 1) Ejecutar reconcile RX
curl -X POST http://127.0.0.1:3020/api/positions/reconcile \
  -H "Content-Type: application/json" \
  -d '{"exchange":"revolutx","autoClean":true}'

# Debe retornar: created: 0, y skipped_external_balance para holdings sin posición del bot

# 2) Verificar que NO se crearon posiciones desde balances
docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "
SELECT pair, amount, entry_mode, lot_id, (config_snapshot_json IS NOT NULL) as has_snapshot
FROM open_positions WHERE exchange='revolutx' ORDER BY pair;"
```

### Definition of Done
- ✅ Reconcile NO crea posiciones desde balances externos
- ✅ Smart-Guard solo gestiona posiciones del bot
- ✅ open_positions = solo posiciones engine-managed
- ✅ UI sin confusión de modos

---

## 2026-01-22 15:45 (Europe/Madrid) — [ENV: VPS/STG] — CRÍTICO: Fix "resurrección de posiciones" + reconcile multi-exchange

### Resumen
Incidente crítico: posiciones vendidas en Revolut X "resucitaban" tras sync/reconcile. La UI no mostraba SELLs y el botón Reconciliar solo soportaba Kraken.

### Síntomas Reportados
1. Posición ETH/USD vendida por señal reaparecía como abierta tras sync
2. UI de trades no mostraba la venta del 22/01 (solo venta del 18/01)
3. Posición BUY 09:14 ETH/USD sin etiqueta "Smart Guard" en UI
4. Botón "Reconciliar" hardcoded a Kraken (modal decía "Reconciliar con Kraken")

### Root Cause
1. **sync-revolutx** creaba posiciones para cada BUY importado, ignorando SELLs
2. **reconcile-from-trades** solo miraba BUY trades, no balances reales
3. **UI Terminal.tsx** hardcoded a `/api/positions/reconcile` (Kraken-only)

### Fix Aplicado
**REGLA DE ORO**: `open_positions` debe reflejar BALANCES reales del exchange, no historial de trades.

1. **sync-revolutx**: Ya NO crea posiciones automáticamente. Solo importa trades a DB.
2. **Nuevo endpoint `/api/positions/reconcile`** (multi-exchange):
   - Obtiene balances REALES del exchange (RevolutX o Kraken)
   - Si balance = 0 → ELIMINA posición (evita resurrección)
   - Si balance > 0 y no hay posición → CREA con snapshot SMART_GUARD
   - Si balance > 0 y posición existe → ACTUALIZA qty si difiere >5%
3. **UI Terminal.tsx**: Dos botones "RECONCILIAR RX" y "RECONCILIAR KR"

### Archivos Tocados
- `server/routes.ts` (sync-revolutx simplificado, nuevo reconcile multi-exchange)
- `client/src/pages/Terminal.tsx` (botones reconcile por exchange)

### Deploy/Comandos
```bash
cd /opt/krakenbot-staging
git pull origin main
docker compose -f docker-compose.staging.yml up -d --build --force-recreate
```

### Verificación Post-Deploy
```bash
# A) Ver que el SELL está en DB (debe aparecer BUY y SELL)
docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "
SELECT executed_at, type, price, amount, origin
FROM trades
WHERE exchange='revolutx' AND pair='ETH/USD' AND executed_at::date='2026-01-22'
ORDER BY executed_at ASC;"

# B) Ver que reconcile RX NO deja posición si balance real es 0
# 1) Ejecutar reconcile RevolutX
curl -X POST http://127.0.0.1:3020/api/positions/reconcile \
  -H "Content-Type: application/json" \
  -d '{"exchange":"revolutx","autoClean":true}'

# 2) Verificar que ETH/USD fue eliminada
docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "
SELECT * FROM open_positions WHERE exchange='revolutx' AND pair='ETH/USD';"

# C) Validar en UI que después de sync + reconcile la posición NO reaparece
# - Ir a dashboard > Posiciones Abiertas
# - Verificar que ETH/USD no aparece
# - Ir a Operaciones y verificar que SELL del 22/01 aparece (depende de query de UI)
```

### NOTA: UI de Operaciones
- Este fix NO garantiza que la UI muestre SELLs
- Si la UI lista desde tabla `trades` y sync importa SELL → aparecerá
- Si la UI filtra mal o usa otra tabla → seguirá sin verse
- Próximo PR si es necesario: revisar endpoint/query de operaciones para incluir SELLs de RevolutX

### Rollback
```bash
git revert HEAD
docker compose -f docker-compose.staging.yml up -d --build
```

### Pendientes
- Verificar en VPS que el fix funciona correctamente
- Si UI no muestra SELLs → próximo PR: revisar endpoint/query de operaciones para incluir SELLs de RevolutX desde tabla `trades`

---

## 2026-01-22 00:30 (Europe/Madrid) — [ENV: VPS/STG] — Fix sistémico Smart-Guard posiciones reconcile/sync

### Resumen
Las 4 posiciones de Revolut X (BTC/USD, ETH/USD, SOL/USD, TON/USD) creadas por reconcile/sync no eran gestionadas por Smart-Guard debido a `configSnapshotJson` nulo.

### Impacto
- Smart-Guard visual pero no ejecutable (sin BE/trailing)
- Posiciones sin protección automática

### Root Cause
- `checkSmartGuardExit` requiere `position.configSnapshot` para ejecutarse
- Posiciones reconcile/sync se creaban sin `configSnapshotJson` ni `entryMode`

### Fix Aplicado
**Commit:** `cf66b96`

1. **Backfill automático** en `loadOpenPositionsFromDB`: crea snapshot desde config actual
2. **Endpoint reconcile** con snapshot SMART_GUARD completo
3. **Eventos SG_***: Nuevos tipos para auditoría (`SG_SNAPSHOT_BACKFILLED`, `SG_BE_ACTIVATED`, `SG_TRAIL_ACTIVATED`, `SG_STOP_UPDATED`, `SG_EXIT_TRIGGERED`)

### Archivos Tocados
- `server/services/tradingEngine.ts` (backfill en loadOpenPositionsFromDB)
- `server/routes.ts` (endpoint reconcile con snapshot)
- `server/services/botLogger.ts` (nuevos EventTypes SG_*)

### Deploy/Comandos
```bash
cd /opt/krakenbot-staging
git pull origin main
docker compose -f docker-compose.staging.yml up -d --build --force-recreate
```

### Verificación (SQL/logs)
```sql
-- Posiciones con snapshot SMART_GUARD
SELECT pair, entry_mode, config_snapshot_json->>'sgBeAtPct' as be_pct,
       sg_break_even_activated, sg_trailing_activated
FROM open_positions ORDER BY pair;

-- Eventos SG_* en bot_events
SELECT type, message, timestamp 
FROM bot_events 
WHERE type LIKE 'SG_%' 
ORDER BY timestamp DESC LIMIT 10;
```

**Resultado validado:**
```
SG_SNAPSHOT_BACKFILLED | Snapshot backfilled for position BTC/USD
SG_BREAK_EVEN_ACTIVATED | SG_BREAK_EVEN_ACTIVATED en SOL/USD  
SG_TRAILING_ACTIVATED   | SG_TRAILING_ACTIVATED en TON/USD
```

### Rollback
```bash
git revert cf66b96
docker compose -f docker-compose.staging.yml up -d --build
```

### Pendientes
- Ninguno. Incidente cerrado.

---

## 2026-01-21 23:00 (Europe/Madrid) — [ENV: VPS/STG] — Endpoint reconcile-from-trades

### Resumen
Implementación de endpoint para crear posiciones desde trades históricos importados por sync.

### Impacto
- Trades BUY importados sin posición asociada ahora pueden reconciliarse

### Fix Aplicado
**Commit:** `616b4f1`

- Nuevo endpoint `POST /api/positions/reconcile-from-trades`
- Soporta dry-run para preview
- Crea posiciones con lotId único

### Archivos Tocados
- `server/routes.ts`

### Deploy/Comandos
```bash
curl -X POST http://127.0.0.1:3020/api/positions/reconcile-from-trades \
  -H "Content-Type: application/json" \
  -d '{"exchange":"revolutx","since":"2026-01-21T00:00:00Z","dryRun":false}'
```

---

## 2026-01-21 22:00 (Europe/Madrid) — [ENV: VPS/STG] — Fix pendingFill RevolutX

### Resumen
Órdenes aceptadas por RevolutX sin precio ejecutado inmediato se marcaban incorrectamente como ORDER_FAILED.

### Impacto
- Órdenes realmente ejecutadas aparecían como fallidas
- Sin posición creada, sin notificación Telegram

### Root Cause
`RevolutXService.placeOrder()` marcaba `success: false` si no había `executed_price` inmediato, aunque la orden fue aceptada.

### Fix Aplicado
**Commit:** `153ba06`

1. **RevolutXService.ts**: Si orden aceptada pero sin precio → `success: true, pendingFill: true`
2. **tradingEngine.ts**: Manejo de `ORDER_PENDING_FILL`, notificación Telegram
3. **botLogger.ts**: Nuevos EventTypes (`ORDER_PENDING_FILL`, `ORDER_FILLED_VIA_SYNC`, `POSITION_CREATED_VIA_SYNC`)
4. **routes.ts**: Sync crea posiciones automáticamente para BUY trades

### Archivos Tocados
- `server/services/exchanges/RevolutXService.ts`
- `server/services/exchanges/IExchangeService.ts`
- `server/services/tradingEngine.ts`
- `server/services/botLogger.ts`
- `server/routes.ts`

---

## 2026-01-21 15:00 (Europe/Madrid) — [ENV: VPS/STG] — Análisis forense 4 compras silenciosas

### Resumen
Investigación de 4 órdenes BUY Market en Revolut X sin notificaciones Telegram.

### Fills Afectados
| executed_at (UTC) | pair | type | price | amount | origin |
|-------------------|------|------|-------|--------|--------|
| 2026-01-21 07:30:03 | ETH/USD | buy | $2979.04 | 0.03356482 | sync |
| 2026-01-21 13:08:30 | ETH/USD | buy | $2941.81 | 0.03399776 | sync |
| 2026-01-21 14:00:30 | TON/USD | buy | $1.5318 | 65.35947 | sync |
| 2026-01-21 14:15:30 | BTC/USD | buy | $89412.28 | 0.00111823 | sync |

### Root Cause Identificado
**H6 confirmada**: Las compras fueron ejecutadas EXTERNAMENTE (Auto-Invest Revolut X o manual), NO por el bot. El job `sync-revolutx` las importó con `origin='sync'`.

### Archivos Tocados
- `ROOT_CAUSE_ANALYSIS_4_BUYS.md` (documentación)
- `ANALISIS_FORENSE_COMPRAS_SILENCIOSAS.md` (documentación)

---

## 2026-01-21 12:00 (Europe/Madrid) — [ENV: VPS/STG] — Fix nombres personalizados backups

### Resumen
Nombre personalizado de backup no se usaba; scripts hacían word-splitting con espacios.

### Fix Aplicado
1. **Backend**: Función `slugify()` + metadata JSON
2. **Scripts**: Validación de entrada + prefijos correctos (`db_`, `code_`)
3. **Frontend**: Icono restore cambiado a `RotateCcw`

### Archivos Tocados
- `server/services/BackupService.ts`
- `scripts/backup-database.sh`
- `scripts/backup-code.sh`
- `scripts/backup-full.sh`
- `client/src/pages/Backups.tsx`

---

## 2026-01-21 10:00 (Europe/Madrid) — [ENV: VPS/STG] — Sistema de backups funcional en VPS

### Resumen
Panel de backups fallaba con múltiples errores: bash not found, rutas hardcodeadas, sin docker.sock.

### Fix Aplicado
1. **Backend**: Rutas configurables vía env variables (`BACKUP_DIR`, `BACKUP_SCRIPTS_DIR`)
2. **Docker Compose**: Volumes + docker.sock montado
3. **Scripts**: Environment variables con fallbacks

### Archivos Tocados
- `server/services/BackupService.ts`
- `docker-compose.staging.yml`
- `scripts/backup-database.sh`
- `scripts/backup-code.sh`

### Deploy/Comandos
```bash
cd /opt/krakenbot-staging
git pull origin main
mkdir -p backups
chmod +x scripts/*.sh
docker compose -f docker-compose.staging.yml up -d --build
```

---

## 2026-01-20 18:00 (Europe/Madrid) — [ENV: VPS/STG] — Fix phantom buys RevolutX

### Resumen
Trades ejecutados por el bot en RevolutX no aparecían en `open_positions`, causando "compras fantasma" sin tracking.

### Root Cause
Divergencia en generación de `trade_id` entre bot y sync:
- Bot usaba `REVOLUTX-${txid}` (no determinístico)
- Sync usaba hash determinístico

### Fix Aplicado
**Commit:** `4244df0`

1. **Unificación de Trade ID**: `buildTradeId()` con hash SHA256 determinístico
2. **Persistencia idempotente**: Tabla `applied_trades` con gating
3. **Logging y alertas**: Eventos `TRADE_PERSIST_*`, `POSITION_APPLY_*`

### Archivos Tocados
- `server/utils/tradeId.ts`
- `server/routes.ts`
- `server/services/tradingEngine.ts`
- `server/storage.ts`
- `shared/schema.ts`
- `db/migrations/006_applied_trades.sql`

---

## 2026-01-20 14:00 (Europe/Madrid) — [ENV: VPS/STG] — Fix validación órdenes RevolutX

### Resumen
Posición fantasma de BTC/USD creada aunque la orden falló (balance insuficiente).

### Root Cause
El bot NO validaba el campo `success` en la respuesta de `placeOrder()`.

### Fix Aplicado
Validación crítica: `if ((order as any)?.success === false)` → log `ORDER_FAILED` + return false

### Archivos Tocados
- `server/services/tradingEngine.ts`

---

## 2026-01-20 10:00 (Europe/Madrid) — [ENV: VPS/STG] — Fix sync RevolutX bloqueado + endpoint orderbook 404

### Resumen
- Sync RevolutX devolvía 403 (variable `REVOLUTX_SYNC_ENABLED` no configurada)
- Endpoint orderbook causaba spam de errores 404 (no existe en API RevolutX)

### Fix Aplicado
1. **docker-compose.staging.yml**: Añadir `REVOLUTX_SYNC_ENABLED=true`
2. **RevolutXService.ts**: Deshabilitar endpoint orderbook inexistente
3. **routes.ts**: Usar Kraken como fuente de precio

### Archivos Tocados
- `docker-compose.staging.yml`
- `server/services/exchanges/RevolutXService.ts`
- `server/routes.ts`

---

## 2026-01-17 (Europe/Madrid) — [ENV: VPS/STG] — Gran actualización de sistema

### Resumen
Actualización masiva con 13 fixes/features implementados.

### Implementaciones
1. **FIX**: Invalid Date en reporte diario
2. **FIX**: Unificación de links "Ver Panel"
3. **FIX**: Branding consistente (WINDSURF CHESTER BOT)
4. **FEAT**: /logs detallado con filtros y paginación
5. **FEAT**: /balance multi-exchange y /cartera
6. **FIX**: /ganancias desde DB real
7. **FIX**: /ultimas operaciones reales
8. **UI**: CRIPTOFONÍA y actualización de microcopy
9. **Telegram MULTI-CHAT** + envío manual
10. **MITIGACIÓN**: Telegram polling 409 Conflict (SinglePollerGuard)
11. **MITIGACIÓN**: RevolutX ticker falla + price discovery (Circuit Breaker)
12. **FIX**: Arranque Docker no-interactivo (staging)
13. **FIX**: Migración robusta de `telegram_chats`

---

## 2026-01-15 (Europe/Madrid) — [ENV: VPS/STG] — Sistema de configuración dinámica

### Resumen
Sistema completo de configuración dinámica para el bot de trading.

### Implementaciones
- **ConfigService**: Servicio singleton con cache, locking y validación
- **API REST**: 15 endpoints para gestión de configuración
- **Base de Datos**: 3 nuevas tablas (`trading_config`, `config_change`, `config_preset`)
- **Hot-Reload**: Integración con tradingEngine
- **Dashboard UI**: Componente React con tabs (Presets/Custom)
- **Presets**: Conservative/Balanced/Aggressive

### Archivos Tocados
- `shared/config-schema.ts`
- `server/services/ConfigService.ts`
- `server/routes/config.ts`
- `db/migrations/001_create_config_tables.sql`
- `client/src/components/dashboard/TradingConfigDashboard.tsx`

---

## 2026-01-14 (Europe/Madrid) — [ENV: VPS/STG] — Diagnóstico bot no compra

### Resumen
El bot NO compra principalmente por filtros de entrada demasiado restrictivos, NO por bugs de código.

### Root Cause
- Exposición al límite (60% = $719, exposición actual $1,565)
- Señales insuficientes (requiere ≥5, mercado genera <5)

### Fixes Aplicados
**Commit:** `b95cfe0`

- Fix crash `pnl is not defined`
- Fix crash `cooldownSec` undefined
- Otros fixes de tipado

### Recomendaciones
1. Aumentar `maxTotalExposurePct` de 60% a 80%
2. Reducir `sgMinEntryUsd` de $100 a $80
3. Activar `sgAllowUnderMin: true`

---

# ANEXOS

## Anexo A: Endpoints RevolutX API

### ✅ Endpoints que funcionan
| Endpoint | Método | Propósito |
|----------|--------|-----------|
| `/api/1.0/accounts` | GET | Obtener balances |
| `/api/1.0/orders` | POST | Crear órdenes |
| `/api/1.0/orders/{id}` | DELETE | Cancelar órdenes |
| `/api/1.0/orders` | GET | Obtener órdenes activas |
| `/api/1.0/fills` | GET | Obtener trades ejecutados |
| `/api/1.0/currencies` | GET | Obtener monedas disponibles |
| `/api/1.0/symbols` | GET | Obtener pares disponibles |

### ❌ Endpoints que NO existen
| Endpoint | Método | Estado |
|----------|--------|--------|
| `/api/1.0/ticker` | GET | 404 Not Found |
| `/api/1.0/orderbook` | GET | 404 Not Found |
| `/api/1.0/market-data` | GET | 404 Not Found |

## Anexo B: Significado de `origin` en trades

| Valor | Significado | Código |
|-------|-------------|--------|
| `engine` | Trade ejecutado por el motor de trading | `tradingEngine.ts` |
| `manual` | Trade ejecutado via API endpoint (dashboard) | `routes.ts` |
| `sync` | Trade importado desde exchange vía sync | `routes.ts` |

## Anexo C: Queries de verificación comunes

```sql
-- Verificar posiciones con snapshot
SELECT pair, entry_mode, config_snapshot_json IS NOT NULL as has_snapshot,
       sg_break_even_activated, sg_trailing_activated
FROM open_positions ORDER BY pair;

-- Verificar eventos recientes
SELECT type, message, timestamp 
FROM bot_events 
ORDER BY timestamp DESC LIMIT 20;

-- Verificar trades por origen
SELECT origin, COUNT(*) as total
FROM trades
WHERE exchange = 'revolutx'
GROUP BY origin;

-- Verificar phantom buys
SELECT t."tradeId", t.pair, t.type, t."executedAt",
       CASE WHEN op."lotId" IS NOT NULL THEN 'HAS_POSITION' ELSE 'PHANTOM' END as status
FROM trades t
LEFT JOIN open_positions op ON t.exchange = op.exchange 
  AND t.pair = op.pair AND t."tradeId" = op."tradeId"
WHERE t.type = 'buy' AND t.exchange = 'revolutx'
ORDER BY t."executedAt" DESC LIMIT 20;
```

---

*Última actualización: 2026-01-22*  
*Mantenido por: Windsurf Cascade AI*
