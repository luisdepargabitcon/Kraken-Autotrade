# AUDITORÍA PRE-DEPLOY — MÓDULO INSTITUTIONAL DCA
## Commit: 487bc28 | Fecha: 2026-03-18

---

# 1) AUDITORÍA ESTÁTICA

## 1.1 schema.ts vs 019_institutional_dca.sql — Coincidencia de columnas

| Tabla | schema.ts cols | SQL cols | Match |
|---|---|---|---|
| trading_engine_controls | 4 (id, normalBotEnabled, institutionalDcaEnabled, globalTradingPause, updatedAt) | 4 + id | ✅ |
| institutional_dca_config | ~55 columnas | ~55 columnas | ✅ |
| institutional_dca_asset_configs | 16 cols | 16 cols | ✅ |
| institutional_dca_cycles | 25 cols | 25 cols | ✅ |
| institutional_dca_orders | 14 cols | 14 cols | ✅ |
| institutional_dca_events | 8 cols | 8 cols | ✅ |
| institutional_dca_backtests | 10 cols | 10 cols | ✅ |
| institutional_dca_simulation_wallet | 10 cols | 10 cols | ✅ |
| institutional_dca_ohlcv_cache | 9 cols + UNIQUE constraint | 9 cols + UNIQUE | ✅ |

**Verificación detallada campo por campo:**
- Todos los tipos SQL coinciden: SERIAL↔serial, BOOLEAN↔boolean, TEXT↔text, DECIMAL(p,s)↔decimal({precision,scale}), INTEGER↔integer, TIMESTAMP↔timestamp, JSONB↔jsonb
- Todos los defaults coinciden entre schema.ts y SQL
- Todos los NOT NULL coinciden
- La constraint UNIQUE(pair, timeframe, ts) en ohlcv_cache coincide con la Drizzle unique()

## 1.2 Repository vs Schema — Coincidencia de imports/tablas

| Tabla schema.ts | Importada en IdcaRepository.ts | Usada en CRUD | OK |
|---|---|---|---|
| tradingEngineControls | ✅ línea 8 | get/update | ✅ |
| institutionalDcaConfig | ✅ línea 9 | get/update | ✅ |
| institutionalDcaAssetConfigs | ✅ línea 10 | get/getAll/upsert | ✅ |
| institutionalDcaCycles | ✅ línea 11 | get/create/update/close | ✅ |
| institutionalDcaOrders | ✅ línea 12 | create/getByCycle/getHistory | ✅ |
| institutionalDcaEvents | ✅ línea 13 | create/getEvents/purge | ✅ |
| institutionalDcaBacktests | ✅ línea 14 | create/getBacktests | ✅ |
| institutionalDcaSimulationWallet | ✅ línea 15 | get/update/reset | ✅ |
| institutionalDcaOhlcvCache | ✅ línea 16 | upsert/getRange | ✅ |

## 1.3 Routes vs Repository — Coincidencia de endpoints

| Endpoint | Método | Repo function llamada | OK |
|---|---|---|---|
| /controls | GET | getTradingEngineControls() | ✅ |
| /controls | PATCH | updateTradingEngineControls() | ✅ |
| /config | GET | getIdcaConfig() | ✅ |
| /config | PATCH | updateIdcaConfig() + handleModeTransition() | ✅ |
| /asset-configs | GET | getAssetConfigs() | ✅ |
| /asset-configs/:pair | GET | getAssetConfig() | ✅ |
| /asset-configs/:pair | PATCH | upsertAssetConfig() | ✅ |
| /summary | GET | getModuleSummary() | ✅ |
| /cycles | GET | getCycles() | ✅ |
| /cycles/active | GET | getAllActiveCycles() | ✅ |
| /cycles/:id | GET | getCycleById() + getOrdersByCycle() | ✅ |
| /orders | GET | getOrderHistory() | ✅ |
| /events | GET | getEvents() | ✅ |
| /simulation/wallet | GET | getSimulationWallet() | ✅ |
| /simulation/reset | POST | resetSimulationWallet() + closeCyclesBulk() | ✅ |
| /backtests | GET | getBacktests() | ✅ |
| /emergency/close-all | POST | engine.emergencyCloseAll() | ✅ |
| /health | GET | engine.getHealthStatus() + getIdcaConfig() + getControls() | ✅ |
| /telegram/test | POST | telegram.sendTestMessage() | ✅ |
| /export/orders | GET | getOrderHistory(limit:10000) | ✅ |
| /export/cycles | GET | getCycles(limit:10000) | ✅ |

## 1.4 Frontend Hooks vs API Endpoints

| Hook | Endpoint llamado | Existe en routes | OK |
|---|---|---|---|
| useIdcaControls | GET /controls | ✅ | ✅ |
| useIdcaConfig | GET /config | ✅ | ✅ |
| useIdcaAssetConfigs | GET /asset-configs | ✅ | ✅ |
| useIdcaSummary | GET /summary | ✅ | ✅ |
| useIdcaCycles | GET /cycles?params | ✅ | ✅ |
| useIdcaActiveCycles | GET /cycles/active | ✅ | ✅ |
| useIdcaOrders | GET /orders?params | ✅ | ✅ |
| useIdcaEvents | GET /events?params | ✅ | ✅ |
| useIdcaSimulationWallet | GET /simulation/wallet | ✅ | ✅ |
| useIdcaHealth | GET /health | ✅ | ✅ |
| useUpdateIdcaControls | PATCH /controls | ✅ | ✅ |
| useUpdateIdcaConfig | PATCH /config | ✅ | ✅ |
| useUpdateAssetConfig | PATCH /asset-configs/:pair | ✅ | ✅ |
| useEmergencyCloseAll | POST /emergency/close-all | ✅ | ✅ |
| useResetSimulationWallet | POST /simulation/reset | ✅ | ✅ |
| useIdcaTelegramTest | POST /telegram/test | ✅ | ✅ |

## 1.5 Frontend Types vs Backend Response — Coincidencia de campos

| Frontend Type | Campos declarados | Coincide con backend | Notas |
|---|---|---|---|
| IdcaControls | id, normalBotEnabled, institutionalDcaEnabled, globalTradingPause, updatedAt | ✅ | Drizzle devuelve camelCase |
| IdcaConfig | ~30 campos | ✅ | Tiene [key:string]:any como fallback |
| IdcaAssetConfig | 16 campos | ✅ | Coincide 1:1 con schema |
| IdcaCycle | 24 campos | ✅ | Coincide con schema |
| IdcaOrder | 14 campos | ✅ | Coincide con schema |
| IdcaEvent | 8 campos | ✅ | Coincide con schema |
| IdcaSummary | 12 campos | ✅ | Coincide con repo.getModuleSummary() |
| IdcaSimulationWallet | 10 campos | ✅ | Coincide con schema |
| IdcaHealth | 9 campos | ✅ | Coincide con engine.getHealthStatus() + config + controls |

## 1.6 Errores encontrados

### BLOQUEANTES
1. **B1: `normalBotEnabled` NO ESTÁ CONECTADO al toggle actual del bot.** El bot actual sigue usando `bot_config.isActive` (en `routes.ts:277`). La tabla `trading_engine_controls.normal_bot_enabled` existe pero NADA en el código del bot normal la lee o la modifica. El toggle "normalBotEnabled" en el frontend IDCA controla un campo que no tiene efecto sobre el bot. **NO es regresión** (no rompe nada) pero el toggle es cosmético.

2. **B2: NO existe endpoint de cleanup/maintenance.** La función `purgeOldEvents()` existe en `IdcaRepository.ts:292` pero **NO hay endpoint** ni scheduler que la invoque. Los datos de eventos y órdenes crecerán indefinidamente. `eventRetentionDays` y `orderArchiveDays` se guardan en config pero nada los usa.

3. **B3: `ConfigField` en UI no actualiza `localVal` cuando `value` prop cambia.** El componente `ConfigField` captura el valor inicial con `useState(value)` pero si el prop `value` cambia (ej. después de mutation), el input no se actualiza. Es un bug de UI que causa desfase entre lo que muestra y lo real.

### IMPORTANTES
4. **I1: Live orders NO se ejecutan realmente.** `executeRealBuy()` y `executeRealSell()` solo hacen `console.log` — no llaman a `tradingExchange.placeOrder()`. Esto es seguro para staging pero significa que el modo live es no-funcional. Es intencional (safety) pero debe documentarse.

5. **I2: `simulation/reset` usa `prices[pair] = 0` para cerrar ciclos.** En `institutionalDca.routes.ts:218`, el reset cierra ciclos con precio 0, lo que distorsiona PnL realizado. Debería obtener precios reales del engine.

6. **I3: Iconos `Heart` y `Power` importados pero no usados** en `InstitutionalDca.tsx`. Warning de tree-shaking, no bloqueante.

7. **I4: `getOHLC` se llama con cast `(dataExchange as any).getOHLC?.(pair, 60)`.** Funciona pero es frágil — si la interfaz cambia, no habrá error de compilación.

8. **I5: Thread ID de Telegram no se usa realmente.** En `IdcaTelegramNotifier.ts:72-75`, el branch `if (threadId)` y `else` hacen exactamente lo mismo — `sendToChat()` no acepta threadId. Los mensajes siempre van al chat principal.

### MENORES
9. **M1: Volume data siempre es `1` en market score.** `currentVolume: 1, avgVolume: 1` en las llamadas a `computeMarketScore()` (IdcaEngine.ts:996-997). El score de volumen relativo siempre será 50.
10. **M2: `localHigh` no usa el lookback temporal real.** `getLocalHigh()` usa todos los candles cacheados sin filtrar por timestamp cutoff.
11. **M3: Emergency close en live mode busca ciclos activos DESPUÉS de cerrarlos.** `emergencyCloseAll()` llama `closeCyclesBulk()` primero y luego `getAllActiveCycles("live")` que ya no devuelve nada.

---

# 2) CHECKLIST NO-REGRESIÓN BOT ACTUAL

| Verificación | Resultado | Riesgo |
|---|---|---|
| Toggle actual `isActive` sigue controlando bot normal | ✅ — routes.ts:277 lee `req.body.isActive`, no toca trading_engine_controls | NINGUNO |
| IDCA tiene toggle independiente | ✅ — institutionalDcaEnabled en trading_engine_controls, leído por IdcaEngine | NINGUNO |
| `globalTradingPause` NO rompe bot actual | ✅ — Solo lo lee IdcaEngine.ts:127. El bot actual no consulta esta tabla | NINGUNO |
| routes.ts sigue registrando rutas previas | ✅ — El bloque IDCA es additive (líneas 226-242), dentro de try/catch independiente | NINGUNO |
| Scheduler IDCA NO interfiere con scheduler actual | ✅ — Usa `setInterval` independiente en IdcaEngine, no comparte timers | NINGUNO |
| Bot normal funciona con IDCA desactivado | ✅ — Flujos completamente separados | NINGUNO |
| IDCA funciona con bot normal desactivado | ✅ — Lee config propia, no consulta bot_config | NINGUNO |
| Sin colisión de labels/jobs/intervals | ✅ — Prefijo [IDCA] en logs, interval variable independiente | NINGUNO |
| Sin colisión en Telegram service | ✅ — IDCA usa `telegramService.sendToChat()` con chatId propio, no interfiere con chats del bot | NINGUNO |
| Sin colisión en DB schema | ✅ — 9 tablas nuevas, todas con prefijo `institutional_dca_` o nombre único. No modifica tablas existentes | NINGUNO |
| Sin colisión en rutas React | ✅ — `/institutional-dca` es ruta nueva, no colisiona | NINGUNO |
| Sin colisión en navegación UI | ✅ — Nuevo item "IDCA" añadido, no reemplaza nada | NINGUNO |
| El módulo IDCA falla al inicio sin crashear server | ✅ — Todo el bloque de inicio está en try/catch (routes.ts:227-242) | NINGUNO |

**RESULTADO: 0 riesgos de regresión detectados. El módulo es completamente aditivo.**

---

# 3) VALIDACIÓN MIGRACIÓN SQL

## 3.1 Tablas creadas vs declaradas

| # | Tabla SQL | Tabla schema.ts | Seed | Indexes | OK |
|---|---|---|---|---|---|
| 1 | trading_engine_controls | tradingEngineControls | ✅ 1 row (true,false,false) | - | ✅ |
| 2 | institutional_dca_config | institutionalDcaConfig | ✅ 1 row (false,disabled) | - | ✅ |
| 3 | institutional_dca_asset_configs | institutionalDcaAssetConfigs | ✅ 2 rows (BTC/USD, ETH/USD) | - | ✅ |
| 4 | institutional_dca_cycles | institutionalDcaCycles | - | idx_idca_cycles_pair_mode_status | ✅ |
| 5 | institutional_dca_orders | institutionalDcaOrders | - | idx_idca_orders_cycle_id, idx_idca_orders_pair_mode | ✅ |
| 6 | institutional_dca_events | institutionalDcaEvents | - | idx_idca_events_type, idx_idca_events_created | ✅ |
| 7 | institutional_dca_backtests | institutionalDcaBacktests | - | - | ✅ |
| 8 | institutional_dca_simulation_wallet | institutionalDcaSimulationWallet | ✅ 1 row (10000,10000,10000) | - | ✅ |
| 9 | institutional_dca_ohlcv_cache | institutionalDcaOhlcvCache | - | idx_idca_ohlcv_pair_tf_ts + UNIQUE(pair,timeframe,ts) | ✅ |

## 3.2 Idempotencia
- Todas las tablas usan `CREATE TABLE IF NOT EXISTS` → ✅ idempotente
- Todos los indexes usan `CREATE INDEX IF NOT EXISTS` → ✅ idempotente
- Seeds usan `INSERT ... WHERE NOT EXISTS (SELECT 1 ...)` → ✅ idempotente
- **La migración es segura para ejecutar múltiples veces**

## 3.3 Orden de creación
- Sin dependencias FK entre tablas IDCA → orden no importa → ✅

## 3.4 Problema detectado
- **No hay FK reales** entre orders→cycles, events→cycles. Solo hay cycle_id INTEGER sin REFERENCES. Esto es funcional pero sin integridad referencial. **NO BLOQUEANTE** — consistente con el patrón del proyecto.

## 3.5 Verificación de índices vs queries del repository
- `idx_idca_cycles_pair_mode_status` → usado por `getActiveCycle(pair, mode)` ✅
- `idx_idca_orders_cycle_id` → usado por `getOrdersByCycle(cycleId)` ✅
- `idx_idca_orders_pair_mode` → usado por `getOrderHistory({mode, pair})` ✅
- `idx_idca_events_type` → usado por `getEvents({eventType})` ✅
- `idx_idca_events_created` → usado por `purgeOldEvents(retentionDays)` ✅
- `idx_idca_ohlcv_pair_tf_ts` → usado por `getOhlcvRange(pair, timeframe, from, to)` ✅

---

# 4) PRUEBAS BACKEND

## 4.1 Compilación
- **`npx tsc --noEmit`** → ✅ 0 errores TypeScript
- **`npx vite build`** → ✅ Build exitoso (solo chunk size warning)

## 4.2 Tabla de endpoints

| Endpoint | Método | Existe en routes | Repo function | Notas | Status |
|---|---|---|---|---|---|
| /api/institutional-dca/controls | GET | ✅ | getTradingEngineControls | Auto-crea si no existe | ✅ OK |
| /api/institutional-dca/controls | PATCH | ✅ | updateTradingEngineControls | + start/stop scheduler | ✅ OK |
| /api/institutional-dca/config | GET | ✅ | getIdcaConfig | Auto-crea si no existe | ✅ OK |
| /api/institutional-dca/config | PATCH | ✅ | updateIdcaConfig | + handleModeTransition | ✅ OK |
| /api/institutional-dca/asset-configs | GET | ✅ | getAssetConfigs | | ✅ OK |
| /api/institutional-dca/asset-configs/:pair | GET | ✅ | getAssetConfig | 404 if not found | ✅ OK |
| /api/institutional-dca/asset-configs/:pair | PATCH | ✅ | upsertAssetConfig | Validates allowed pairs | ✅ OK |
| /api/institutional-dca/summary | GET | ✅ | getModuleSummary | Fallback to simulation if disabled | ✅ OK |
| /api/institutional-dca/cycles | GET | ✅ | getCycles | Query params | ✅ OK |
| /api/institutional-dca/cycles/active | GET | ✅ | getAllActiveCycles | | ✅ OK |
| /api/institutional-dca/cycles/:id | GET | ✅ | getCycleById + orders | 404 if not found | ✅ OK |
| /api/institutional-dca/orders | GET | ✅ | getOrderHistory | Query params | ✅ OK |
| /api/institutional-dca/events | GET | ✅ | getEvents | Query params | ✅ OK |
| /api/institutional-dca/simulation/wallet | GET | ✅ | getSimulationWallet | Auto-crea si no existe | ✅ OK |
| /api/institutional-dca/simulation/reset | POST | ✅ | resetSimulationWallet | ⚠️ precios=0 | ⚠️ I2 |
| /api/institutional-dca/backtests | GET | ✅ | getBacktests | | ✅ OK |
| /api/institutional-dca/emergency/close-all | POST | ✅ | engine.emergencyCloseAll | Safe even with 0 cycles | ✅ OK |
| /api/institutional-dca/health | GET | ✅ | engine.getHealthStatus + config + controls | | ✅ OK |
| /api/institutional-dca/telegram/test | POST | ✅ | telegram.sendTestMessage | | ✅ OK |
| /api/institutional-dca/export/orders | GET | ✅ | getOrderHistory(10000) | CSV response | ✅ OK |
| /api/institutional-dca/export/cycles | GET | ✅ | getCycles(10000) | CSV response | ✅ OK |
| **cleanup/maintenance** | **-** | **❌ NO EXISTE** | purgeOldEvents existe pero no endpoint | | **❌ B2** |

---

# 5) PRUEBAS FRONTEND

## 5.1 Compilación
- **`npx vite build`** → ✅ Build exitoso

## 5.2 Ruta y navegación
- `/institutional-dca` registrada en App.tsx ✅
- "IDCA" en Nav.tsx con icono CircleDollarSign ✅

## 5.3 Sub-pestañas UI

| Tab | Componente | Hooks usados | Empty state | OK |
|---|---|---|---|---|
| Resumen | SummaryTab | useIdcaSummary, useIdcaConfig | ✅ "No hay ciclos activos" | ✅ |
| Config | ConfigTab | useIdcaConfig, useIdcaAssetConfigs, mutations | ✅ "Cargando..." | ⚠️ B3 |
| Ciclos | CyclesTab | useIdcaCycles | ✅ "No hay ciclos" | ✅ |
| Historial | HistoryTab | useIdcaOrders | ✅ "No hay órdenes" | ✅ |
| Simulación | SimulationTab | useIdcaSimulationWallet, useIdcaConfig | ✅ Warning si modo != simulation | ✅ |
| Eventos | EventsTab | useIdcaEvents | ✅ "No hay eventos" | ✅ |
| Telegram | TelegramTab | useIdcaConfig, mutations | ✅ "Cargando..." | ✅ |

## 5.4 Problemas UI
- **B3:** `ConfigField` usa `useState(value)` sin `useEffect` para sincronizar cambios externos. Tras una mutation exitosa, el campo muestra el valor viejo.
- **I3:** Iconos `Heart` y `Power` importados pero no usados — tree-shaking los elimina pero es código muerto.

---

# 6) VALIDACIÓN FUNCIONAL MOTOR IDCA

| Feature | Status | Ubicación exacta |
|---|---|---|
| schedulerIntervalSeconds = 60 | **IMPLEMENTADO** | IdcaEngine.ts:53 `config.schedulerIntervalSeconds \|\| 60` |
| simulation vs live branch real | **IMPLEMENTADO** | IdcaEngine.ts:278 `if (mode === "simulation")`, :324 `if (mode === "live")` |
| No envía órdenes reales en simulation | **IMPLEMENTADO** | IdcaEngine.ts:324 solo llama executeRealBuy si live |
| market score (0-100) | **IMPLEMENTADO** | IdcaSmartLayer.ts:28-87 `computeMarketScore()` |
| trailing por ATR/volatilidad | **IMPLEMENTADO** | IdcaSmartLayer.ts:98-103 `computeDynamicTrailing()` |
| TP adaptativo | **IMPLEMENTADO** | IdcaSmartLayer.ts:192-211 `computeAdaptiveTp()` |
| adaptive sizing | **IMPLEMENTADO** | IdcaSmartLayer.ts:215-232 `selectSizeProfile()` + `getSizeWeights()` |
| rebound detection | **IMPLEMENTADO** | IdcaSmartLayer.ts:318-346 `detectRebound()` |
| learning window | **IMPLEMENTADO** | IdcaSmartLayer.ts:265-308 `computeLearningAdjustments()` |
| learning auto-apply | **NO IMPLEMENTADO** | La función existe pero NUNCA se invoca desde IdcaEngine |
| exposure combinada con bot normal | **NO IMPLEMENTADO** | Solo verifica exposure dentro del módulo IDCA, no consulta posiciones del bot normal |
| max module drawdown | **IMPLEMENTADO** | IdcaEngine.ts:1039-1070 `checkModuleDrawdown()` |
| emergency close all | **IMPLEMENTADO** | IdcaEngine.ts:75-114 `emergencyCloseAll()` |
| mode transition rules | **IMPLEMENTADO** | IdcaEngine.ts:1209-1256 `handleModeTransition()` |
| rate limiter compartido | **NO IMPLEMENTADO** | No existe rate limiter para API calls al exchange |
| cleanup retention | **PARCIAL** | `purgeOldEvents()` existe en repo pero no hay scheduler ni endpoint que la invoque |
| ohlcv cache para backtest | **PARCIAL** | Cache se llena en `updateOhlcvCache()` pero no hay backtest engine que la use |
| config audit log | **NO IMPLEMENTADO** | No se registra evento al cambiar config |
| health endpoint | **IMPLEMENTADO** | IdcaEngine.ts:40-48 + routes:260-275 |
| export CSV | **IMPLEMENTADO** | routes:290-333 orders + cycles |

---

# 7) SEGURIDAD / ROBUSTEZ

| Escenario | Qué pasa | Riesgo |
|---|---|---|
| Faltan seeds iniciales | `getTradingEngineControls()`, `getIdcaConfig()`, `getSimulationWallet()` auto-crean row vacío con defaults | ✅ SEGURO |
| Faltan asset configs | `evaluatePair()` retorna early si `!assetConfig` (línea 174) | ✅ SEGURO |
| trading_engine_controls vacío | Auto-crea en `getTradingEngineControls()` (línea 42) | ✅ SEGURO |
| institutional_dca_config vacío | Auto-crea en `getIdcaConfig()` (línea 65) | ✅ SEGURO |
| Scheduler arranca antes de config | Lee config en primer tick, no en constructor | ✅ SEGURO |
| Falla Telegram | try/catch en `send()` (TelegramNotifier:76), retorna false | ✅ SEGURO |
| Falla query DB | try/catch en cada endpoint, try/catch en runTick() | ✅ SEGURO |
| Emergency close sin ciclos | Retorna `closedCycles: 0` | ✅ SEGURO |
| Simulation wallet no existe | Auto-crea en `getSimulationWallet()` (línea 324) | ✅ SEGURO |
| Null en campos numéricos | `parseFloat(String(val \|\| "0"))` pattern usado consistentemente | ✅ SEGURO |
| SafetyOrders JSON inválido | `parseSafetyOrders()` retorna [] si no es array (línea 1197) | ✅ SEGURO |
| UI recibe 500 en hooks | React Query muestra error state, no crashea | ✅ SEGURO |
| Exchange no inicializado | `getDataExchange().isInitialized()` check (línea 1077), fallback a cache | ✅ SEGURO |
| **Emergency close en live busca ciclos post-cierre** | `getAllActiveCycles("live")` DESPUÉS de `closeCyclesBulk()` → devuelve 0 ciclos → no vende nada | ⚠️ BUG M3 |

---

# 8) COMANDOS PRE-DEPLOY

```bash
# 1. Verificar compilación TypeScript (local)
cd /c/Users/JSLUI/Qsync/BOT_NAS/BOT_AUTOTRADE
npx tsc --noEmit

# 2. Verificar build frontend (local)
npx vite build

# 3. En VPS staging — pull + rebuild (migración es AUTOMÁTICA)
cd /opt/krakenbot-staging
git pull origin main
docker compose -f docker-compose.staging.yml up -d --build
# La migración 019_institutional_dca.sql se ejecuta automáticamente
# vía script/migrate.ts al arrancar el contenedor

# 4. Verificar logs de arranque (migración + módulo)
docker logs krakenbot-staging-app 2>&1 | grep -i "migrate\|IDCA\|institutional"
# Esperado:
#   [migrate] Ensuring Institutional DCA tables exist...
#   [migrate] institutional_dca applied: 019_institutional_dca.sql
#   [IDCA] Routes registered under /api/institutional-dca/*
#   [startup] Institutional DCA module idle (toggle off or mode disabled)

# 5. Verificar tablas y seeds creados
docker exec -i krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "
SELECT 'trading_engine_controls' as tbl, count(*) FROM trading_engine_controls
UNION ALL
SELECT 'institutional_dca_config', count(*) FROM institutional_dca_config
UNION ALL
SELECT 'institutional_dca_asset_configs', count(*) FROM institutional_dca_asset_configs
UNION ALL
SELECT 'institutional_dca_simulation_wallet', count(*) FROM institutional_dca_simulation_wallet;
"
-- Esperado: 1, 1, 2, 1

# 6. Verificar endpoints (ajustar puerto)
curl -s http://localhost:5000/api/institutional-dca/health | python3 -m json.tool
curl -s http://localhost:5000/api/institutional-dca/controls | python3 -m json.tool
curl -s http://localhost:5000/api/institutional-dca/config | python3 -m json.tool
curl -s http://localhost:5000/api/institutional-dca/asset-configs | python3 -m json.tool
curl -s http://localhost:5000/api/institutional-dca/summary | python3 -m json.tool
curl -s http://localhost:5000/api/institutional-dca/simulation/wallet | python3 -m json.tool

# 7. Verificar que bot normal sigue funcionando
curl -s http://localhost:5000/api/config | python3 -m json.tool
curl -s http://localhost:5000/api/trading/status | python3 -m json.tool

# 8. Test emergency close (seguro sin ciclos)
curl -s -X POST http://localhost:5000/api/institutional-dca/emergency/close-all | python3 -m json.tool
# Esperado: {"success":true,"closedCycles":0}
```

---

# 9) RESULTADO FINAL

## A) RESUMEN EJECUTIVO
- **¿Listo para staging?** SÍ, con 3 fixes recomendados
- **¿Listo para production?** NO — live orders son no-op, normalBotEnabled sin efecto, cleanup sin scheduler
- **Riesgo general:** BAJO para staging, MEDIO para production

## B) BLOQUEANTES (para producción)
1. **B1:** `normalBotEnabled` no está conectado al toggle del bot actual — el campo existe pero es cosmético
2. **B2:** No hay endpoint ni scheduler de cleanup/maintenance — datos crecerán sin límite
3. **B3:** `ConfigField` UI no sincroniza valor cuando prop cambia — muestra datos stale después de save

## C) IMPORTANTES (no bloqueantes para staging)
4. **I1:** Live orders son console.log only — modo live no ejecuta trades reales (intencional)
5. **I2:** Simulation reset cierra ciclos con price=0 — distorsiona PnL
6. **I3:** Iconos importados no usados (Heart, Power) — código muerto
7. **I4:** `getOHLC` llamado con cast `as any` — frágil
8. **I5:** threadId de Telegram no se usa realmente en sendToChat

## D) MENORES
9. **M1:** Volume data siempre 1/1 en market score — componente de volumen siempre = 50
10. **M2:** `getLocalHigh()` no filtra por lookback timestamp real
11. **M3:** Emergency close en live busca ciclos DESPUÉS de cerrarlos → no vende posiciones reales

## E) COMPROBACIONES OK
- ✅ TypeScript compila sin errores (0 errors)
- ✅ Frontend build exitoso
- ✅ 9/9 tablas SQL coinciden 1:1 con schema.ts
- ✅ Migración SQL es idempotente
- ✅ Seeds completos para arrancar (4 seeds)
- ✅ 21/21 endpoints existen y están wired
- ✅ 16/16 hooks frontend apuntan a endpoints reales
- ✅ 7/7 sub-pestañas UI renderizan con empty state
- ✅ 0 riesgos de regresión sobre bot actual
- ✅ Auto-create patterns en repo para tablas de configuración
- ✅ Try/catch en todos los endpoints y en el scheduler tick
- ✅ Scheduler no crashea server si falta config
- ✅ Telegram falla silenciosamente
- ✅ Indexes SQL alineados con queries del repository

## F) COMANDOS EXACTOS PRE-DEPLOY
Ver sección 8 arriba — copiar/pegar completo.

## G) PROCEDIMIENTO DE DEPLOY EN STAGING

### Paso 1: Pull + Rebuild (migración es AUTOMÁTICA)
```bash
cd /opt/krakenbot-staging
git pull origin main
docker compose -f docker-compose.staging.yml up -d --build
# script/migrate.ts ejecuta 019_institutional_dca.sql automáticamente al arrancar
```

### Paso 2: Verificar arranque y migración
```bash
docker logs krakenbot-staging-app 2>&1 | tail -80 | grep -i "migrate\|IDCA\|institutional\|startup"
# Esperado:
#   [migrate] Ensuring Institutional DCA tables exist...
#   [migrate] institutional_dca applied: 019_institutional_dca.sql
#   [migrate] Migration completed successfully!
#   [IDCA] Routes registered under /api/institutional-dca/*
#   [startup] Institutional DCA module idle (toggle off or mode disabled)
```

### Paso 3: Verificar tablas y seeds
```bash
docker exec -i krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "\dt institutional_dca_*"
docker exec -i krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "SELECT count(*) FROM institutional_dca_asset_configs;"
```

### Paso 5: Smoke test endpoints
```bash
curl -s http://localhost:5000/api/institutional-dca/health
curl -s http://localhost:5000/api/institutional-dca/config
curl -s http://localhost:5000/api/institutional-dca/asset-configs
curl -s http://localhost:5000/api/institutional-dca/summary
curl -s -X POST http://localhost:5000/api/institutional-dca/emergency/close-all
```

### Paso 6: Verificar bot normal no roto
```bash
curl -s http://localhost:5000/api/config
curl -s http://localhost:5000/api/trading/status
```
