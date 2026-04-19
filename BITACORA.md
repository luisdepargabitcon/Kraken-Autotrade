# 📋 BITÁCORA — WINDSURF CHESTER BOT

> Documentación técnica y operativa unificada. Solo describe cómo funciona **ahora**.
> Última actualización: 2026-04-19

---

## 🏛️ ARQUITECTURA GENERAL

```
┌──────────────────────────────────────────────────────────────────┐
│                     ExchangeFactory (singleton)                   │
│                  Kraken  ←→  RevolutX                             │
│     Trading exchange / Data exchange (configurable)               │
└────────────┬─────────────────────────────────┬───────────────────┘
             │                                 │
             ▼                                 ▼
┌────────────────────────┐     ┌──────────────────────────────────┐
│  MarketDataService     │     │  tradingEngine (Modo Normal)     │
│  (cache unificado)     │     │  SmartGuard + Momentum + Candles │
│  TTLs: 15m/1h/1d/spot │     │  + ExitManager + FillWatcher     │
└────────┬───────────────┘     └──────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│                     IdcaEngine (Modo IDCA)                        │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────────┐ │
│  │IdcaSmartLayer│  │TrailingBuyMgr  │  │IdcaMessageFormatter  │ │
│  │(VWAP,rebound │  │(trailing stop  │  │(mensajes humanos +   │ │
│  │ ATR,basePrice│  │ buy inverso)   │  │ técnicos Telegram)   │ │
│  │ safetyOrders)│  │                │  │                      │ │
│  └──────────────┘  └────────────────┘  └──────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Exchanges soportados
- **Kraken**: API completa (OHLC, ticker, balance, orders, fills). Rate limiter FIFO con backpressure + estado degradado.
- **RevolutX**: Orders, fills, balances. Sin ticker/OHLC → usa Kraken como data source. `pendingFill` → FillWatcher monitorea.

### Modos de operación
- **NORMAL**: SmartGuard (BE + trailing + scale-out + time-stop)
- **IDCA**: Institutional DCA (ciclos, safety orders, TP dinámico, VWAP)
- **DRY_RUN**: Simulación sin órdenes reales (ambos modos)

---

## 🏗️ ESTRUCTURA DEL PROYECTO

```
server/
  services/
    tradingEngine.ts          ← Motor principal (modo Normal)
    exitManager.ts            ← SL/TP/BE/Trailing/Scale-out/Time-stop
    FillWatcher.ts            ← Reconciliación de fills pendientes
    MarketDataService.ts      ← Cache unificado velas+precios (TTL)
    strategies.ts             ← momentumCandlesStrategy
    telegram.ts               ← Multi-chat, alertas, polling
    ErrorAlertService.ts      ← Alertas críticas (instancia inyectada)
    botLogger.ts              ← Eventos + retención configurable
    kraken.ts                 ← Kraken API wrapper
    BackupService.ts          ← DB + code backups
    exchanges/
      ExchangeFactory.ts      ← Singleton multi-exchange
      RevolutXService.ts      ← RevolutX API
      IExchangeService.ts     ← Interfaz común
    institutionalDca/
      IdcaEngine.ts           ← Motor IDCA (ciclos, scheduler)
      IdcaSmartLayer.ts       ← VWAP, ATR, rebound, base price, safety orders
      IdcaTypes.ts            ← Interfaces (SafetyOrderLevel, VwapEntryContext, etc.)
      IdcaMessageFormatter.ts ← Mensajes humanos + técnicos
      IdcaReasonCatalog.ts    ← Catálogo de bloqueos con templates
      TrailingBuyManager.ts   ← Trailing stop buy inverso (in-memory)
  routes/
    config.ts                 ← Config REST API (15 endpoints)
    institutionalDca.routes.ts← IDCA REST API
    fiscoAlerts.routes.ts     ← Alertas FISCO
  utils/
    krakenRateLimiter.ts      ← FIFO + backpressure + degraded state
shared/
  schema.ts                   ← Drizzle schema (todas las tablas)
client/src/
  pages/
    InstitutionalDca.tsx      ← UI IDCA completa
    Terminal.tsx               ← Posiciones + historial
    Monitor.tsx                ← Eventos tiempo real
    Notifications.tsx          ← Preferencias alertas Telegram
  components/
    idca/IdcaEventCards.tsx    ← Cards con humanMessage + chips técnicos
  hooks/
    useInstitutionalDca.ts    ← React Query hooks IDCA
db/migrations/                ← SQL migrations (001-028)
script/migrate.ts             ← Migration runner (deploy automático)
```

---

## 📊 TABLAS DB PRINCIPALES

| Tabla | Propósito |
|-------|-----------|
| `bot_config` | Config global (SmartGuard, pares, dry_run, log retention) |
| `api_config` | Credenciales Kraken + RevolutX + Telegram |
| `open_positions` | Posiciones abiertas (solo bot-managed, nunca creadas por sync) |
| `trades` | Historial de trades (origin: engine/manual/sync) |
| `trade_fills` | Fills individuales por exchange |
| `order_intents` | Órdenes enviadas con tracking de estado |
| `institutional_dca_config` | Config global IDCA + scheduler + recovery |
| `institutional_dca_asset_configs` | Config por par (dip, rebound, VWAP, safety, TP, sliders) |
| `institutional_dca_cycles` | Ciclos activos/cerrados con base_price, TP, fees |
| `institutional_dca_orders` | Órdenes de ciclo (base_buy, safety_buy, take_profit) |
| `institutional_dca_events` | Eventos con humanMessage + technicalSummary + payload |
| `time_stop_config` | TTL por activo con multiplicadores régimen |
| `market_metrics_snapshots` | Snapshots de métricas (Fear&Greed, etc.) |
| `market_metrics_evaluations` | Evaluaciones por par (score, bias, action) |
| `fisco_operations` | Operaciones fiscales (Kraken + RevolutX) |
| `fisco_lots` | Lotes FIFO para cálculo fiscal |
| `fisco_disposals` | Ventas con cost basis y gain/loss EUR |
| `training_trades` | Pipeline ML (backfill + labeling) |
| `regime_state` | Estado régimen por par (TRANSITION, BULL, BEAR, RANGE) |
| `telegram_chats` | Multi-chat con preferencias granulares |

---

## 🔄 FLUJO DE DATOS

### Modo Normal (scan loop ~60s)
```
1. exitManager.checkStopLossTakeProfit() → SL/TP/BE/Trailing siempre
2. KrakenRL.getState() → actualizar marketDataDegraded
3. Por cada par:
   a. shouldPollForNewCandle() → fetch vela si nueva (con catch-up cap)
   b. Si CANDLE_NEW + !marketDataDegraded:
      - analyzeWithCandleStrategy() → señal BUY/SELL/HOLD
      - Si BUY: gate reentrada + anti-burst + exposure → executeTrade
      - Si SELL: SmartGuard filter → safeSell
   c. Si CANDLE_SAME: skip (timing invariant guard)
```

### Modo IDCA (scheduler adaptativo)
```
1. getCurrentPrice(pair) via MarketDataService
2. updateOhlcvCache(pair) via MarketDataService (1h + 1d)
3. checkEntryConditions():
   a. computeHybridV2() → base price
   b. entryDipPct = (basePrice - currentPrice) / basePrice
   c. Si dip >= minDip + marketScore OK + rebound OK:
      - computeVwapAnchored() → zona VWAP
      - Retorna IdcaEntryCheckResult con vwapContext
4. Si entry allowed: crear ciclo + base buy + safety levels
5. Monitor ciclos activos: safety buys + exit management
```

---

## 🔐 REGLAS INVARIANTES

1. **`open_positions` = solo posiciones del bot** — Reconcile/sync nunca crea posiciones, solo `trades`
2. **Salidas siempre ejecutan** — `marketDataDegraded` bloquea entradas, nunca salidas
3. **Migraciones idempotentes** — `ADD COLUMN IF NOT EXISTS` en ambos paths (deploy + startup)
4. **IDCA allowed pairs** — Solo `["BTC/USD", "ETH/USD"]` (constante en `shared/schema.ts`)
5. **Telegram single instance** — ErrorAlertService usa instancia inyectada, nunca crea la suya
6. **DRY_RUN gate en memoria** — Contadores de slots y cooldown usan Maps en memoria, no DB

---

## 🚀 DEPLOY

```bash
cd /opt/krakenbot-staging
git pull origin main
docker compose -f docker-compose.staging.yml up -d --build
```

Migraciones ejecutan automáticamente:
- `script/migrate.ts` (pre-start en Docker) — aplica SQL files de `db/migrations/`
- `storage.runSchemaMigration()` (startup app) — ALTER TABLE inline como redundancia

### Verificación post-deploy
```bash
docker logs krakenbot-staging-app --tail 50
# Buscar: [migrate] Migration completed successfully!
# Buscar: [startup] Auto-migration: added ...
# Buscar: [startup] ExchangeFactory initialized
```

---

## 📡 ENDPOINTS CLAVE

| Endpoint | Método | Propósito |
|----------|--------|-----------|
| `/api/market-data/stats` | GET | Cache stats de MarketDataService |
| `/api/exchange-diagnostics` | GET | Nonce, rate limiter, estado exchanges |
| `/api/portfolio` | GET | Balances + precios + P&L |
| `/api/open-positions` | GET | Posiciones abiertas |
| `/api/events` | GET | Eventos con filtros temporales |
| `/api/test/critical-alert` | POST | Test alerta Telegram |
| `/api/idca/*` | CRUD | Config, ciclos, órdenes, eventos IDCA |
| `/api/fisco/*` | CRUD | Operaciones, lotes, sync fiscal |

---

## ⚙️ MODO NORMAL — DETALLE TÉCNICO

### Motor de señales
- `momentumCandlesStrategy()`: EMA10/20, RSI, MACD, Bollinger, volumen, engulfing. Score ponderado con umbral configurable.
- `analyzeWithCandleStrategy()`: Multi-timeframe analysis + hybrid guard watches + anti-cresta + volume overrides + early momentum.

### SmartGuard (gestión de posiciones)
- **Break-even progresivo**: Activa stop a entry cuando P&L >= `sg_be_at_pct`
- **Trailing stop**: Arranca a `sg_trail_start_pct`, distancia `sg_trail_distance_pct`, steps `sg_trail_step_pct`
- **Scale-out**: Venta parcial (`sg_scale_out_pct`) al alcanzar `sg_scale_out_threshold`
- **TP fijo**: Opcional, a `sg_tp_fixed_pct`
- **Time-stop**: TTL por activo con multiplicadores por régimen (table `time_stop_config`)

### Protecciones
- **KrakenRL backpressure**: Cola FIFO con `KRAKEN_MAX_QUEUE_SIZE` (default 60). Queue overflow → rechazo inmediato.
- **Market Data Degraded**: Histéresis (entrada: queue>30 OR waitedMs>15s OR 3+ errores; salida: 3 ticks limpios). Bloquea entradas, no salidas.
- **Catch-up cap**: Max 1 poll catch-up/30s por par. Si desfase >4 intervalos → reset sync.
- **Anti-burst DRY_RUN**: Gate reentrada + cooldown 120s usando contadores en memoria.

### Telegram dedup
- SELL_BLOCKED: Cooldown 15 min por par
- Circuit breaker: Cooldown 15 min por lotId
- DRY_RUN: Max 1 mensaje simulación por par+tipo cada 15 min
- Market data degraded: Cooldown 10 min por par

---

## 📈 MODO IDCA — DETALLE TÉCNICO

### MarketDataService (singleton)
Cache TTL unificado para velas y precios. Sirve a ambos modos.

| Timeframe | TTL |
|-----------|-----|
| 15m | 20 min |
| 1h | 90 min |
| 1d | 6 horas |
| Spot price | 30 seg |

### Base Price (computeHybridV2)
Precio de referencia determinístico:
- Ventanas: 24h, 48h, 72h, 7d, 30d
- Candidatos: Swing highs (pivot detection) + P95
- Outlier guard: ATR-based
- Tolerancias dinámicas por par: Swing BTC [6%-18%], ETH [8%-25%]; Cap 7d BTC [6%-20%], ETH [8%-25%]; Cap 30d BTC 20%, ETH 25%

### VWAP Anchored + Bandas
- `computeVwapAnchored()`: VWAP desde timestamp del base price, bandas ±1σ y ±2σ
- `getVwapBandPosition()`: Zona → `below_lower2` / `below_lower1` / `between_bands` / `above_upper1` / `above_upper2`
- Per-pair toggle: `vwapEnabled` (default OFF)

### Dynamic Safety Orders
- `adjustSafetyOrdersWithVwap()`: Ajusta `dipPct` según zona VWAP (deep value → tighten, overextended → widen)
- Per-pair toggle: `vwapDynamicSafetyEnabled` (default OFF)

### Rebound Detection
- 3 condiciones OR: lower wick >40% range, bounce > `reboundMinPct` desde local low, bearish momentum decelerating
- `reboundMinPct`: Configurable por par (default 0.30%)

### TrailingBuyManager
Trailing stop inverso para entradas:
1. `arm(pair)` → empieza tracking
2. `update(pair, price)` → dispara buy cuando bounce >= 0.5% desde local low
3. Expira después de 4h. Estado efímero (in-memory)

### Ciclos
- **Main**: Compra base + safety orders escalonados
- **Plus**: Compra adicional en ciclo existente
- **Recovery**: Ciclo secundario cuando main está en drawdown

### Exit (3 sliders por par)
1. **Protección**: Stop-loss a `protectionActivationPct`
2. **Trailing**: Arranca a `trailingActivationPct`, margen `trailingMarginPct`
3. **Close**: Rompe trailing → venta

### Mensajes humanos
- `humanTitle` + `humanMessage` en castellano natural
- `technicalSummary` como chips coloreados en UI
- Composición inteligente multi-bloqueo
- Signo semántico: positivo = "Caída X%", negativo = "Precio sobre ancla X%"

---

## 🔌 IDCA ASSET CONFIG — COLUMNAS

| Columna | Tipo | Default |
|---------|------|---------|
| `pair` | TEXT | — |
| `enabled` | BOOLEAN | true |
| `min_dip_pct` | DECIMAL | 2.00 |
| `dip_reference` | TEXT | hybrid |
| `require_rebound_confirmation` | BOOLEAN | true |
| `rebound_min_pct` | DECIMAL | 0.30 |
| `trailing_buy_enabled` | BOOLEAN | true |
| `vwap_enabled` | BOOLEAN | false |
| `vwap_dynamic_safety_enabled` | BOOLEAN | false |
| `safety_orders_json` | JSONB | [{2%,25%},...] |
| `max_safety_orders` | INTEGER | 4 |
| `take_profit_pct` | DECIMAL | 4.00 |
| `dynamic_take_profit` | BOOLEAN | true |
| `protection_activation_pct` | DECIMAL | 1.00 |
| `trailing_activation_pct` | DECIMAL | 3.50 |
| `trailing_margin_pct` | DECIMAL | 1.50 |
| `cooldown_minutes_between_buys` | INTEGER | 180 |
| `max_cycle_duration_hours` | INTEGER | 720 |

---

## 🛡️ GUARDS Y PROTECCIONES

| Guard | Descripción |
|-------|-------------|
| Market Data Degraded | Histéresis KrakenRL. Bloquea entradas, no salidas |
| Anti-burst | Cooldown 120s entre entradas (LIVE + DRY_RUN) |
| DRY_RUN double-sell | Previene SELL duplicado si lot ya cerrado |
| Queue overflow | Rechaza tareas KrakenRL si cola >= 60 |
| Catch-up cap | Max 1 poll catch-up/30s, reset si >4 intervalos |
| Timing invariant | Detecta desync reloj, resetea lastEvaluatedCandle |
| Fee cushion | Markup mínimo para cubrir comisiones |
| Anti-cresta | Filtro de señales en pico de momentum |
| MTF strict | Confirmación multi-timeframe |

---

## 💬 TELEGRAM

### Multi-chat con preferencias granulares
Cada chat configura qué subtipos recibe (trades, errores, sistema, balance, heartbeat).

### Subtipos de alerta
- `trade_buy_*`, `trade_sell_*`, `trade_entry_blocked_degraded`
- `system_market_data_degraded_on/off`
- `system_error_*`, `system_heartbeat`
- `idca_*` (cycle started, buy executed, entry blocked, cycle closed, etc.)

### ErrorAlertService
Usa instancia inyectada del TelegramService global. Severidad: 🟡 Medium / 🔴 High / 🚨 Critical

---

## 💰 FISCO

- Panel UI estilo Bit2Me: operaciones, lotes FIFO, disposals, P&L fiscal en EUR
- Sync Kraken + RevolutX con retry/rate-limit
- Cron diario 08:30 + sync manual
- Alertas Telegram configurables por canal
- Tablas: `fisco_operations`, `fisco_lots`, `fisco_disposals`, `fisco_sync_history`, `fisco_sync_retry`

---

## 📎 REFERENCIA RÁPIDA

### RevolutX endpoints funcionales
| Endpoint | Método |
|----------|--------|
| `/api/1.0/accounts` | GET |
| `/api/1.0/orders` | POST / DELETE / GET |
| `/api/1.0/fills` | GET |
| `/api/1.0/currencies` | GET |
| `/api/1.0/symbols` | GET |

No disponibles: ticker (404), orderbook (404)

### Significado de `origin` en trades
| Valor | Significado |
|-------|-------------|
| `engine` | Ejecutado por motor de trading |
| `manual` | Ejecutado via API/dashboard |
| `sync` | Importado desde exchange |

### Queries de verificación útiles
```sql
-- Posiciones con snapshot
SELECT pair, entry_mode, config_snapshot_json IS NOT NULL as has_snapshot
FROM open_positions ORDER BY pair;

-- Trades por origen
SELECT origin, COUNT(*) FROM trades GROUP BY origin;

-- Ciclos IDCA activos
SELECT id, pair, status, cycle_type, buy_count, capital_used_usd
FROM institutional_dca_cycles WHERE status = 'active';

-- IDCA asset configs
SELECT pair, enabled, min_dip_pct, vwap_enabled, rebound_min_pct
FROM institutional_dca_asset_configs;
```

---

*Última actualización: 2026-04-19*
*Mantenido por: Windsurf Cascade AI*