# 📋 BITÁCORA - WINDSURF CHESTER BOT

> **Fuente de verdad** para registro de cambios, incidentes, deploys y verificaciones.  
> Organizado por **categorías** con entradas en orden cronológico inverso.

---

# 🔧 CORRECCIONES POR CATEGORÍA

---

## 📊 POSICIONES Y RECONCILE

### 2026-01-23 — Sistema de atribución de órdenes del bot

**Problema:** Las órdenes BUY del bot no creaban posiciones abiertas. El sync importaba trades con `origin='sync'` pero no distinguía trades del bot de trades manuales/externos.

**Solución:**
1. **Nueva tabla `order_intents`**: Persiste la intención del bot ANTES de enviar la orden
   - Campos: `clientOrderId`, `exchange`, `pair`, `side`, `volume`, `status`
   - Estados: pending → accepted → filled/failed/expired

2. **Campo `executed_by_bot` en trades**: Boolean marcado `true` cuando sync hace match con order_intent

3. **Flujo modificado:**
   - `tradingEngine.ts`: Genera `clientOrderId` UUID y persiste intent antes de `placeOrder()`
   - `sync-revolutx`: Match trades con intents por pair, side, volume ±5%
   - `reconcile`: Solo crea posiciones para trades con `executed_by_bot=true`

**Archivos:** `shared/schema.ts`, `server/storage.ts`, `server/services/tradingEngine.ts`, `server/routes.ts`, `db/migrations/007_order_intents.sql`

**Deploy:**
```bash
git pull origin main
cat db/migrations/007_order_intents.sql | docker exec -i krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging
docker compose -f docker-compose.staging.yml up -d --build --force-recreate
```

**Backfill históricos:**
```sql
UPDATE trades SET executed_by_bot = true 
WHERE exchange = 'revolutx' AND type = 'buy' AND origin = 'sync' 
AND executed_at > NOW() - INTERVAL '24 hours';
```

---

### 2026-01-22 — REGLA ÚNICA: open_positions = solo posiciones del bot

**Problema:** Posiciones vendidas "resucitaban" tras sync/reconcile. Reconcile creaba posiciones desde balances externos.

**Solución:** Regla única implementada: `open_positions` contiene ÚNICAMENTE posiciones abiertas por el bot (engine).

**Cambios:**
- Reconcile: Solo elimina/actualiza posiciones del bot; PROHIBIDO crear desde balances externos
- Smart-Guard: Solo gestiona posiciones con `configSnapshot != null` + `entryMode === 'SMART_GUARD'`
- Sync RevolutX: Solo importa trades a tabla `trades`, nunca crea posiciones

**Endpoints admin:**
- `GET /api/admin/legacy-positions` - Lista posiciones legacy
- `POST /api/admin/purge-legacy-positions` - Purga posiciones legacy

**Archivos:** `server/routes.ts`, `server/services/tradingEngine.ts`

---

### 2026-01-22 — Fix Smart-Guard para posiciones reconcile/sync

**Problema:** Posiciones creadas por reconcile/sync no eran gestionadas por Smart-Guard (`configSnapshotJson` nulo).

**Solución:**
- Backfill automático en `loadOpenPositionsFromDB`: crea snapshot desde config actual
- Endpoint reconcile con snapshot SMART_GUARD completo
- Nuevos eventos: `SG_SNAPSHOT_BACKFILLED`, `SG_BE_ACTIVATED`, `SG_TRAIL_ACTIVATED`

**Archivos:** `server/services/tradingEngine.ts`, `server/routes.ts`, `server/services/botLogger.ts`

---

## 📈 TRADES Y SYNC

### 2026-01-21 — Fix pendingFill RevolutX

**Problema:** Órdenes aceptadas por RevolutX sin precio inmediato se marcaban como ORDER_FAILED.

**Solución:**
- `RevolutXService.ts`: Si orden aceptada pero sin precio → `success: true, pendingFill: true`
- `tradingEngine.ts`: Manejo de `ORDER_PENDING_FILL`, notificación Telegram
- Nuevos eventos: `ORDER_PENDING_FILL`, `ORDER_FILLED_VIA_SYNC`, `POSITION_CREATED_VIA_SYNC`

**Archivos:** `server/services/exchanges/RevolutXService.ts`, `server/services/tradingEngine.ts`, `server/services/botLogger.ts`

---

### 2026-01-20 — Fix phantom buys RevolutX

**Problema:** Trades ejecutados por el bot no aparecían en `open_positions` (compras fantasma).

**Root Cause:** Divergencia en generación de `trade_id` entre bot y sync.

**Solución:**
- Unificación con `buildTradeId()` usando hash SHA256 determinístico
- Tabla `applied_trades` con gating idempotente
- Eventos `TRADE_PERSIST_*`, `POSITION_APPLY_*`

**Archivos:** `server/utils/tradeId.ts`, `server/routes.ts`, `server/services/tradingEngine.ts`, `db/migrations/006_applied_trades.sql`

---

### 2026-01-20 — Fix validación órdenes RevolutX

**Problema:** Posición fantasma creada aunque la orden falló (balance insuficiente).

**Solución:** Validación crítica: `if ((order as any)?.success === false)` → log `ORDER_FAILED` + return false

**Archivos:** `server/services/tradingEngine.ts`

---

### 2026-01-20 — Fix sync RevolutX bloqueado

**Problema:** Sync devolvía 403 (`REVOLUTX_SYNC_ENABLED` no configurada); endpoint orderbook 404.

**Solución:**
- `docker-compose.staging.yml`: Añadir `REVOLUTX_SYNC_ENABLED=true`
- `RevolutXService.ts`: Deshabilitar endpoint orderbook inexistente
- Usar Kraken como fuente de precio

**Archivos:** `docker-compose.staging.yml`, `server/services/exchanges/RevolutXService.ts`

---

## 📋 EVENTOS Y LOGS

### 2026-01-22 — Filtrado eventos por rango temporal + exportación

**Problema:** Filtro de rango (1h/6h/24h) no filtraba realmente; WebSocket enviaba solo últimos 50 eventos.

**Solución:**
- `getDbEvents()` acepta `{ limit, from, to, level, type }`
- Endpoints: `/api/events`, `/api/events/export`, `/api/admin/purge-events`
- WebSocket snapshot envía últimas 24h por defecto
- Frontend con contador y timezone visible

**Archivos:** `server/services/botLogger.ts`, `server/services/eventsWebSocket.ts`, `server/routes.ts`, `client/src/pages/Monitor.tsx`

---

## 💾 BACKUPS

### 2026-01-21 — Nombres personalizados en backups

**Problema:** Nombre personalizado no se usaba; scripts hacían word-splitting con espacios.

**Solución:**
- Función `slugify()` + metadata JSON
- Validación de entrada + prefijos correctos (`db_`, `code_`)

**Archivos:** `server/services/BackupService.ts`, `scripts/backup-*.sh`

---

### 2026-01-21 — Sistema de backups funcional en VPS

**Problema:** Panel de backups fallaba: bash not found, rutas hardcodeadas, sin docker.sock.

**Solución:**
- Rutas configurables vía env (`BACKUP_DIR`, `BACKUP_SCRIPTS_DIR`)
- Docker Compose con volumes + docker.sock montado

**Archivos:** `server/services/BackupService.ts`, `docker-compose.staging.yml`, `scripts/backup-*.sh`

---

## ⚙️ CONFIGURACIÓN Y SISTEMA

### 2026-01-17 — Gran actualización de sistema

Actualización masiva con múltiples fixes:
- Fix Invalid Date en reporte diario
- Branding consistente (WINDSURF CHESTER BOT)
- `/logs` detallado con filtros y paginación
- `/balance` multi-exchange y `/cartera`
- `/ganancias` desde DB real
- Telegram MULTI-CHAT + envío manual
- SinglePollerGuard para Telegram polling 409
- Circuit Breaker para RevolutX ticker

---

### 2026-01-15 — Sistema de configuración dinámica

**Implementaciones:**
- ConfigService: singleton con cache, locking y validación
- API REST: 15 endpoints para gestión de configuración
- Base de Datos: 3 tablas (`trading_config`, `config_change`, `config_preset`)
- Hot-Reload integrado con tradingEngine
- Dashboard UI con tabs (Presets/Custom)
- Presets: Conservative/Balanced/Aggressive

**Archivos:** `shared/config-schema.ts`, `server/services/ConfigService.ts`, `server/routes/config.ts`, `client/src/components/dashboard/TradingConfigDashboard.tsx`

---

# 📚 ANEXOS

## Anexo A: Endpoints RevolutX API

### ✅ Endpoints funcionales
| Endpoint | Método | Propósito |
|----------|--------|-----------|
| `/api/1.0/accounts` | GET | Obtener balances |
| `/api/1.0/orders` | POST | Crear órdenes |
| `/api/1.0/orders/{id}` | DELETE | Cancelar órdenes |
| `/api/1.0/orders` | GET | Obtener órdenes activas |
| `/api/1.0/fills` | GET | Obtener trades ejecutados |
| `/api/1.0/currencies` | GET | Obtener monedas disponibles |
| `/api/1.0/symbols` | GET | Obtener pares disponibles |

### ❌ Endpoints inexistentes
| Endpoint | Estado |
|----------|--------|
| `/api/1.0/ticker` | 404 |
| `/api/1.0/orderbook` | 404 |

## Anexo B: Significado de `origin` en trades

| Valor | Significado |
|-------|-------------|
| `engine` | Trade ejecutado por el motor de trading |
| `manual` | Trade ejecutado via API (dashboard) |
| `sync` | Trade importado desde exchange vía sync |

## Anexo C: Queries de verificación

```sql
-- Posiciones con snapshot
SELECT pair, entry_mode, config_snapshot_json IS NOT NULL as has_snapshot
FROM open_positions ORDER BY pair;

-- Trades por origen
SELECT origin, COUNT(*) FROM trades WHERE exchange = 'revolutx' GROUP BY origin;

-- Verificar order_intents
SELECT id, client_order_id, pair, side, status, created_at 
FROM order_intents ORDER BY created_at DESC LIMIT 10;

-- Trades con executed_by_bot
SELECT id, pair, type, executed_by_bot, executed_at 
FROM trades WHERE exchange='revolutx' AND executed_by_bot = true 
ORDER BY executed_at DESC;
```

---

*Última actualización: 2026-01-23*  
*Mantenido por: Windsurf Cascade AI*
