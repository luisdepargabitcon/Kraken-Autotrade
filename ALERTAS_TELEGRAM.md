# 📋 INVENTARIO COMPLETO DE ALERTAS TELEGRAM

> Documentación de todas las alertas Telegram del bot, cuándo se activan y cómo se configuran.

---

## 🕐 ALERTAS PROGRAMADAS (Automáticas)

| Alerta | Cuándo se ejecuta | Archivo:Línea | Tipo | Configurable |
|--------|-------------------|---------------|------|-------------|
| **Heartbeat** | Cada **12 horas** | `telegram.ts:1930` | `heartbeat` | ✅ `alertHeartbeat` |
| **Reporte Diario** | **14:00** Europe/Madrid | `telegram.ts:1995` (cron: `0 14 * * *`) | `system` | ✅ `alertSystem` |

---

## 🚀 ALERTAS DE CICLO DE VIDA DEL BOT

| Alerta | Cuándo se activa | Archivo:Línea | Tipo | Configurable |
|--------|------------------|---------------|------|-------------|
| **Bot Iniciado** | Al llamar `tradingEngine.start()` | `tradingEngine.ts:1827` | `system_bot_started` | ✅ `alertSystem` |
| **Bot Detenido** | Al llamar `tradingEngine.stop()` | `tradingEngine.ts:1874` | `system_bot_paused` | ✅ `alertSystem` |
| **Posiciones Cargadas** | Al iniciar, si hay posiciones en DB | `tradingEngine.ts:1997` | `system` | ✅ `alertSystem` |

---

## 💰 ALERTAS DE TRADING (Compras/Ventas)

| Alerta | Cuándo se activa | Archivo:Línea | Tipo | Configurable |
|--------|------------------|---------------|------|-------------|
| **Compra Ejecutada** | Después de `executeTrade("buy")` exitoso | `tradingEngine.ts:954` | `trades` | ✅ `alertTrades` |
| **Venta Ejecutada** | Después de `executeTrade("sell")` exitoso | `tradingEngine.ts:2615` | `trades` | ✅ `alertTrades` |
| **Stop-Loss Ejecutado** | Cuando SL se dispara | `tradingEngine.ts:2936` | `trades` | ✅ `alertTrades` |
| **Take-Profit Ejecutado** | Cuando TP se dispara | `tradingEngine.ts:2936` | `trades` | ✅ `alertTrades` |
| **Trailing Stop Ejecutado** | Cuando trailing se dispara | `tradingEngine.ts:2936` | `trades` | ✅ `alertTrades` |
| **Trade Manual (API)** | Desde `/api/trades` endpoint | `routes.ts:1767` | `trades` | ✅ `alertTrades` |
| **Trade Importado (Sync)** | Cuando sync detecta trade externo | `routes.ts:2166` | `trades` | ✅ `alertTrades` |

---

## 🛡️ ALERTAS SMART GUARD

| Alerta | Cuándo se activa | Archivo:Línea | Tipo | Configurable |
|--------|------------------|---------------|------|-------------|
| **Break-Even Activado** | Cuando profit >= umbral BE | `routes.ts:4084` | `status` | ✅ (siempre activo) |
| **Trailing Activado** | Cuando profit >= umbral trailing | `routes.ts:4097` | `status` | ✅ (siempre activo) |
| **Trailing Stop Actualizado** | Cuando stop se mueve hacia arriba | `routes.ts:4109` | `status` | ✅ (siempre activo) |
| **Scale-Out Ejecutado** | Cuando se vende parcial por profit | `routes.ts:4122` | `status` | ✅ (siempre activo) |

---

## ⚠️ ALERTAS DE RIESGO Y LÍMITES

| Alerta | Cuándo se activa | Archivo:Línea | Tipo | Configurable |
|--------|------------------|---------------|------|-------------|
| **Límite Pérdida Diaria** | Cuando drawdown >= `maxDailyDrawdownPct` | `tradingEngine.ts:2120` | `errors` | ✅ `alertErrors` |
| **Par en Cooldown** | Después de pérdida, par entra en espera | `tradingEngine.ts:3532` | `system` | ✅ `alertSystem` |
| **Señal SELL Bloqueada** | Cuando no hay posición para vender | `tradingEngine.ts:3767` | `system` | ✅ `alertSystem` |
| **Posición en Espera** | Time-stop soft (esperando profit) | `tradingEngine.ts:769` | `system` | ✅ `alertSystem` |

---

## 🔧 ALERTAS DE RECONCILIACIÓN

| Alerta | Cuándo se activa | Archivo:Línea | Tipo | Configurable |
|--------|------------------|---------------|------|-------------|
| **Posición Huérfana Eliminada** | Reconcile detecta posición sin balance | `tradingEngine.ts:2540` | `system` | ✅ `alertSystem` |
| **Posición Ajustada** | Reconcile ajusta cantidad | `tradingEngine.ts:2572` | `system` | ✅ `alertSystem` |
| **Posición Huérfana (API)** | Desde `/api/positions/:id` DELETE | `routes.ts:1245` | `system` | ✅ `alertSystem` |

---

## 🚨 ALERTAS DE ERROR

| Alerta | Cuándo se activa | Archivo:Línea | Tipo | Configurable |
|--------|------------------|---------------|------|-------------|
| **Alerta Crítica** | Errores graves del sistema | `tradingEngine.ts:896` | `errors` | ✅ `alertErrors` |
| **Error de API** | Fallos de conexión a exchanges | `ErrorAlertService.ts` | `errors` | ✅ `alertErrors` |

---

## 📊 RESUMEN POR TIPO DE ALERTA

| Tipo | Cantidad | Configurable en `/channels` | Descripción |
|------|----------|----------------------------|------------|
| `trades` | 7 | ✅ `alertTrades` | Todas las operaciones de compra/venta |
| `system` | 8 | ✅ `alertSystem` | Eventos del sistema, reconciliación, límites |
| `errors` | 3 | ✅ `alertErrors` | Errores críticos y de API |
| `status` | 4 | ✅ (siempre activo) | Actualizaciones de stop-loss, trailing, scale-out |
| `heartbeat` | 1 | ✅ `alertHeartbeat` | Verificación cada 12h |
| `balance` | 0 | ✅ `alertBalance` | (no usado actualmente) |

---

## ⏱️ COOLDOWNS CONFIGURABLES

| Evento | Cooldown Default | Config Key | Descripción |
|--------|------------------|------------|------------|
| `stop_updated` | 60s | `notifCooldownStopUpdated` | Entre actualizaciones de stop |
| `regime_change` | 300s (5min) | `notifCooldownRegimeChange` | Cambios de régimen de mercado |
| `heartbeat` | 3600s (1h) | `notifCooldownHeartbeat` | Entre heartbeats |
| `trades` | 0 (sin cooldown) | `notifCooldownTrades` | Entre trades (sin límite) |
| `errors` | 60s | `notifCooldownErrors` | Entre errores repetidos |

---

## 🔄 DEDUPLICACIÓN (Nuevo módulo v2.0)

| Tipo Mensaje | Min Intervalo | Throttle Tipo | Max/Hora | Descripción |
|--------------|---------------|---------------|----------|------------|
| `positions_update` | 5 min | 2 min | 12 | Evita spam de actualizaciones de posiciones |
| `heartbeat` | 6 horas | 1 hora | 2 | Limita heartbeats repetidos |
| `daily_report` | 12 horas | 6 horas | 2 | Evita reportes diarios duplicados |
| `entry_intent` | 15 min | 5 min | 8 | Una por vela de 15m máximo |
| `trade_buy/sell` | 10s | 5s | 60 | Casi sin límite para trades reales |
| `error` | 5 min | 1 min | 20 | Previene spam de errores |

---

## 🔧 CONFIGURACIÓN DE CHATS

### Comandos para gestionar alertas:

| Comando | Descripción |
|--------|------------|
| `/channels` | Ver y configurar qué alertas recibir |
| `/menu` | Menú interactivo con botones |
| `/ayuda` | Lista completa de comandos |
| `/refresh_commands` | Actualizar menú de comandos en Telegram |

### Tipos de alertas por chat:

- ✅ **Trades** - Operaciones de compra/venta
- ✅ **System** - Eventos del sistema y reconciliación
- ✅ **Errors** - Errores críticos y de API
- ✅ **Heartbeat** - Verificación cada 12h
- ⬜ **Balance** - Alertas de balance (no usado actualmente)

---

## 📝 NOTAS DE IMPLEMENTACIÓN

### Branding (v2.0)
- Header unificado: `[NAS/PROD] 🤖 CHESTER BOT 🇪🇸`
- Exchange explícito en body de cada mensaje
- Anti-placeholders con validación Zod

### Envío de Alertas
```typescript
// Ejemplo de envío de alerta
await telegramService.sendAlertToMultipleChats(message, "trades");

// Con cooldown automático
await telegramService.sendWithCooldown(message, "stop_updated", "status", pair);
```

### Validación de Contextos
```typescript
// Validar contexto antes de enviar
const ctx = validateContext(TradeBuyContextSchema, data, "TradeBuy");
```

---

## 📅 ÚLTIMA ACTUALIZACIÓN

**Fecha:** 2026-01-24  
**Versión:** Telegram v2.0 (Refactorización completa)  
**Cambios:**
- Branding unificado CHESTER BOT
- Módulo deduplicación con hash/throttle
- Templates con validación Zod
- Comandos alineados con setMyCommands

---

> **Nota:** Para desactivar una alerta específica, usa `/channels` y desmarca la categoría correspondiente. Las alertas de tipo `status` (stop-loss, trailing, scale-out) siempre se envían para mantener visibilidad del estado de las posiciones.
