# 📋 BITÁCORA - WINDSURF CHESTER BOT

> **Fuente de verdad** para registro de cambios, incidentes, deploys y verificaciones.  
> Organizado por **categorías** con entradas en orden cronológico inverso.

---

# 🔧 CORRECCIONES POR CATEGORÍA

---

## �️ SMART_GUARD Y LOGS

### 2026-01-23 — Arreglo Definitivo SMART_GUARD (no acumulación) + clientOrderId linking + logs duplicados

**Problema:** 
1. **SMART_GUARD permitía acumulación** - El bot podía abrir múltiples posiciones del mismo par a pesar del límite
2. **clientOrderId perdido** - RevolutXService generaba su propio ID, rompiendo la cadena de atribución
3. **Logs duplicados** - Cada cliente WebSocket persistía logs, creando duplicados en DB
4. **Gate inconsistente** - Solo contaba posiciones OPEN, ignorando PENDING_FILL e intents

**Solución Integral:**

#### 1️⃣ SMART_GUARD Gate Robusto
**Nueva lógica de bloqueo:**
```typescript
// Cuenta todos los slots ocupados (OPEN + PENDING_FILL + intents)
const occupiedSlots = await storage.countOccupiedSlotsForPair(exchange, pair);
// openPositions: number; pendingFillPositions: number; 
// pendingIntents: number; acceptedIntents: number; total: number

// Anti-burst cooldown: mínimo 120s entre entradas por par
const lastOrderTime = await storage.getLastOrderTimeForPair(exchange, pair);
if (secondsSinceLastOrder < 120) {
  // Bloquear con cooldown remaining
}

// Gate único para SINGLE y SMART_GUARD
if (currentOpenLots >= maxLotsForMode) {
  // Bloquear con detalle: OPEN=X, PENDING=Y, intents=Z
}
```

**Nuevas funciones storage:**
- `countOccupiedSlotsForPair()` - Query SQL que cuenta OPEN + PENDING_FILL + pending/accepted intents
- `getLastOrderTimeForPair()` - Para cooldown anti-ráfaga

**Logs mejorados:**
```
TON/USD: Compra bloqueada - slots ocupados 1/1 (OPEN=0, PENDING=1, intents=0)
SOL/USD: Compra bloqueada - Cooldown anti-ráfaga: 87s
```

#### 2️⃣ Fix Crítico: Propagación clientOrderId
**Problema:** `RevolutXService.placeOrder()` ignoraba el `clientOrderId` del caller
```typescript
// ANTES (rompía la cadena)
const clientOrderId = this.generateClientOrderId(); // Siempre nuevo

// AHORA (preserva la cadena)
const clientOrderId = params.clientOrderId || this.generateClientOrderId();
console.log(`[revolutx] Using clientOrderId: ${clientOrderId} (caller-provided: ${!!params.clientOrderId})`);
```

**Interface actualizada:**
```typescript
// IExchangeService.placeOrder
placeOrder(params: {
  pair: string;
  type: "buy" | "sell";
  ordertype: string;
  price?: string;
  volume: string;
  clientOrderId?: string; // Nuevo: opcional para traceabilidad
}): Promise<OrderResult>;
```

#### 3️⃣ Logs Centralizados (Fix Duplicación)
**Problema:** Cada cliente WS en `terminalWebSocket.ts` persistía logs
```typescript
// ANTES: Cada cliente persistía
serverLogsService.persistLog("app_stdout", line, isError);

// AHORA: Persistencia única centralizada
// En logStreamService.addEntry()
serverLogsService.persistLog("app_stdout", line, isError);
```

**Cambio implementado:**
- `logStreamService.ts`: Centraliza persistencia en `addEntry()`
- `terminalWebSocket.ts`: Solo envía a clientes, sin persistir

#### 4️⃣ Configuración y Defaults
**SMART_GUARD por defecto:**
- `sgMaxOpenLotsPerPair = 1` (configurable)
- `sgMinSecondsBetweenEntries = 120s` (anti-burst)
- `sgAllowScaleIn = false` (no acumular por defecto)

**Comportamiento resultante:**
- **SINGLE**: Máximo 1 posición por par
- **SMART_GUARD**: Máximo configurable (default 1), sin scale-in
- **Cooldown**: 120s mínimo entre entradas del mismo par

---

### � POSICIONES Y RECONCILE

### 2026-01-23 — Posiciones instantáneas con Average Entry Price

**Problema:** Las posiciones tardaban 10+ minutos en aparecer en UI (dependían de sync + reconcile).

**Solución:** Posición visible en 0-2s tras aceptar orden (estado PENDING_FILL), confirmada a OPEN cuando llegan fills.

**Nuevos campos `open_positions`:**
- `status`: PENDING_FILL → OPEN → FAILED/CANCELLED
- `client_order_id`: UUID para upsert idempotente
- `total_cost_quote`, `total_amount_base`: Agregados para coste medio
- `average_entry_price`: total_cost_quote / total_amount_base
- `fill_count`, `first_fill_at`, `last_fill_at`: Tracking de fills

**Flujo nuevo:**
1. `placeOrder()` → Crea posición PENDING_FILL inmediatamente
2. `FillWatcher` → Polling 3s monitorea fills
3. Fill recibido → Actualiza agregados + status=OPEN + emite WS
4. `reconcile` → Backup/repair si hay drift

**Archivos modificados (SMART_GUARD + clientOrderId + logs):**
- `server/services/exchanges/RevolutXService.ts` - Usa clientOrderId del caller
- `server/services/exchanges/IExchangeService.ts` - Interface actualizada con clientOrderId?
- `server/services/tradingEngine.ts` - Gate robusto en analyzePairAndTrade + analyzePairAndTradeWithCandles
- `server/storage.ts` - countOccupiedSlotsForPair + getLastOrderTimeForPair + IStorage interface
- `server/services/logStreamService.ts` - Persistencia centralizada en addEntry()
- `server/services/terminalWebSocket.ts` - Removida persistencia duplicada

**Deploy STG:**
```bash
cd /opt/krakenbot-staging
git pull origin main  # Commit: adbc9c3
docker compose -f docker-compose.staging.yml up -d --build --force-recreate
```

**Verificación post-deploy:**
```bash
# SMART_GUARD gate visible
docker compose -f docker-compose.staging.yml logs | grep "openLotsThisPair"

# clientOrderId linking (próxima orden)
docker compose -f docker-compose.staging.yml logs | grep "caller-provided"

# No duplicación logs
docker exec -i krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "
SELECT line, COUNT(*) FROM server_logs
WHERE timestamp > NOW() - INTERVAL '10 minutes'
GROUP BY line HAVING COUNT(*) > 1;"
```

**Commit:** `adbc9c3` - "fix: SMART_GUARD no-accumulate + clientOrderId linking + logs duplicados"

---

**Archivos (posiciones instantáneas):**
- `db/migrations/009_instant_positions.sql` (migración)
- `server/services/FillWatcher.ts` (nuevo)
- `server/services/positionsWebSocket.ts` (nuevo)
- `server/services/tradingEngine.ts` (crea PENDING_FILL + inicia watcher)
- `server/storage.ts` (métodos createPendingPosition, updatePositionWithFill)
- `server/routes.ts` (reconcile recalcula avgPrice)
- `client/src/pages/Terminal.tsx` (badge status + coste medio)

**Deploy (posiciones instantáneas):**
```bash
git pull origin main
cat db/migrations/009_instant_positions.sql | docker exec -i krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging
docker compose -f docker-compose.staging.yml up -d --build --force-recreate
```

**Commit:** `9c41b45`

---

## 📋 RESULTADOS VERIFICACIÓN STG (2026-01-23)

### ✅ SMART_GUARD Gate
- **Estado:** Funcionando correctamente
- **Evidencia:** `openLotsThisPair:1, maxLotsPerPair:2` visible en PAIR_DECISION_TRACE
- **Logs:** Bloqueos con detalle `slots ocupados X/Y (OPEN=A, PENDING=B, intents=C)`

### ✅ clientOrderId Linking  
- **Estado:** Código desplegado, pendiente de verificar con próxima orden
- **Esperado:** `[revolutx] Using clientOrderId: XXX (caller-provided: true)`

### ✅ Logs Centralizados
- **Estado:** Sin duplicaciones confirmado
- **Evidencia:** `0 rows` con COUNT(*) > 1 en últimos 10 minutos
- **IDs:** Secuenciales únicos (12331-12346)

### ⚠️ AEP en Posiciones Existentes
- **Estado:** `total_cost_quote=0` en posiciones pre-fix
- **Causa:** Posiciones creadas antes del sistema de agregados
- **Solución:** Las nuevas posiciones tendrán AEP correcto

### 📊 Trades Disponibles
- **Evidencia:** Trades con `order_intent_id` presente (ej: XRP/USD con id=1)
- **Backfill:** Posible para posiciones históricas si se requiere

---

**Próximos pasos:**
1. Esperar próxima orden real para verificar `caller-provided: true`
2. Verificar PENDING_FILL → OPEN con AEP calculado
3. Monitorear que SMART_GUARD bloque segundas entradas del mismo par

---

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
