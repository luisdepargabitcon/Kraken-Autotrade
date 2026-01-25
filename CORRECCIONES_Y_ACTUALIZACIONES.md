# 📝 CORRECCIONES Y ACTUALIZACIONES

> Registro detallado de cambios en código y configuración.

---

## 2026-01-25 14:20 — FIX CRÍTICO: Exposición no contaba posiciones PENDING_FILL

### Problema Reportado
Una posición SOL/USD se creó a las 12:45 cuando el límite de exposición ya estaba alcanzado. El siguiente ciclo de scan (12:50) bloqueó correctamente por exposición, pero la orden ya había sido enviada.

### Causa Raíz
La verificación de exposición usaba `this.openPositions` (memoria) que NO incluía posiciones `PENDING_FILL`:
- Verificación de **slots** (BD): Incluía PENDING_FILL ✓
- Verificación de **exposición** (memoria): NO incluía PENDING_FILL ✗

Las posiciones PENDING_FILL tienen `amount: '0'` y `entryPrice: '0'` en BD, por lo que aunque se cargaran, su contribución a la exposición era 0.

### Solución
Implementado **tracking de exposición pendiente** en memoria:

```typescript
// Nuevo Map para trackear exposición de posiciones PENDING_FILL
private pendingFillExposure: Map<string, { pair: string; expectedUsd: number }> = new Map();

// calculatePairExposure y calculateTotalExposure ahora incluyen pendingFillExposure
private calculatePairExposure(pair: string): number {
  let total = 0;
  // OPEN positions
  this.openPositions.forEach((position) => {...});
  // PENDING_FILL positions
  this.pendingFillExposure.forEach((pending) => {...});
  return total;
}
```

**Ciclo de vida del tracking:**
1. `addPendingExposure()` - Al crear posición PENDING_FILL
2. `removePendingExposure()` - Cuando posición pasa a OPEN, timeout, o se carga desde BD
3. `clearAllPendingExposure()` - Al iniciar el engine (limpiar datos stale)

### Archivos Modificados
- `server/services/tradingEngine.ts`:
  - Líneas 483-485: Nuevo Map `pendingFillExposure`
  - Líneas 1135-1186: Funciones de cálculo y tracking de exposición
  - Línea 1869: Limpieza al inicio del engine
  - Línea 2026: Limpieza al cargar posición desde BD
  - Líneas 6476-6478: Añadir exposición al crear PENDING_FILL
  - Líneas 6504-6510: Remover exposición en callbacks de FillWatcher
  - Líneas 6727-6728, 6825-6826: Remover exposición al confirmar posición

### Impacto
- La exposición ahora cuenta PENDING_FILL positions correctamente
- No se pueden crear nuevas órdenes si hay órdenes pendientes que ya ocupan la exposición
- Previene sobre-asignación de capital cuando hay órdenes en vuelo

---

## 2026-01-25 16:45 — MEJORA: Alertas Telegram para Time-Stop en ambos modos

### Mejora Solicitada
Añadir alertas Telegram cuando una posición alcanza el Time-Stop, tanto en modo SOFT como HARD.

### Cambios Realizados
- **Modo SOFT**: Ya existía alerta, se añadió nota sobre cierre manual
- **Modo HARD**: Nueva alerta Telegram notificando cierre inmediato

### Archivos Modificados
- `server/services/tradingEngine.ts`:
  - Líneas 744-760: Alerta Telegram para modo HARD
  - Línea 823: Nota sobre cierre manual en modo SOFT

### Alertas Enviadas

**Modo SOFT (cuando expira):**
```
⏰ Posición en espera
📦 Detalles: Par, tiempo abierta, límite, cierre forzado
📊 Estado: Ganancia actual, mínimo para cerrar
💡 La posición se cerrará cuando supere X% o al llegar a 54h
⚠️ Puedes cerrarla manualmente si lo prefieres
```

**Modo HARD (cuando expira):**
```
⏰ Time-Stop HARD - Cierre Inmediato
📦 Detalles: Par, tiempo abierta, límite
📊 Estado: Ganancia actual
⚡ ACCIÓN: La posición se cerrará INMEDIATAMENTE [modo HARD]
```

### Impacto
- Notificación inmediata cuando Time-Stop se activa
- Opción de intervención manual en modo SOFT
- Claridad sobre acción automática en modo HARD

---

## 2026-01-25 14:15 — FIX: Time-Stop SOFT no cerraba posiciones en pérdida

### Problema Reportado
Posición TON/USD con Time-Stop (48h) marcado como "EXPIRED" pero la posición seguía abierta. En modo SOFT, si la posición tiene pérdida, el bot esperaba indefinidamente a que tuviera profit.

### Causa Raíz
El Time-Stop en modo SOFT solo cerraba posiciones si el profit era suficiente para cubrir fees. Posiciones con pérdida quedaban abiertas indefinidamente.

### Solución
Añadido **tiempo máximo absoluto** del 50% adicional al Time-Stop configurado:
- Time-Stop 48h → Cierre forzado a las 72h
- Time-Stop 36h → Cierre forzado a las 54h

```typescript
// NUEVO: Force close after 50% additional time
const maxAbsoluteHours = timeStopHours * 1.5;
if (ageHours >= maxAbsoluteHours) {
  return {
    triggered: true,
    expired: true,
    shouldClose: true,
    reason: `Time-stop máximo absoluto - forzando cierre`,
  };
}
```

### Archivo Modificado
- `server/services/tradingEngine.ts` líneas 760-772

### Impacto
- Posiciones con Time-Stop expirado ya NO quedan abiertas indefinidamente
- Después del 50% de tiempo adicional, se fuerza el cierre aunque esté en pérdida
- Notificación de Telegram actualizada con hora de cierre forzado

---

## 2026-01-25 14:10 — FIX CRÍTICO: Reconciliación NUNCA crea posiciones

### Problema Reportado
Al darle a "Reconciliar", se creó una posición de BTC/USD sin señal válida.

### Regla Establecida
**Las posiciones SOLO las crea el bot por señal válida.** La reconciliación:
- ✅ Sincroniza cantidades de posiciones existentes
- ✅ Elimina posiciones huérfanas (balance=0)
- ❌ NUNCA crea nuevas posiciones

### Solución
Eliminada completamente la lógica de creación de posiciones en reconciliación. Si hay balance sin posición, se registra como "balance externo" sin crear posición.

### Archivo Modificado
- `server/routes.ts` líneas 2412-2419

---

## 2026-01-25 13:55 — FIX CRÍTICO: Reconciliación creaba posiciones desde balances externos

### Problema Reportado
Al darle a "Reconciliar", se creó una posición de BTC/USD sin señal válida. El usuario tenía balance de BTC en el exchange (probablemente depósito externo), y la reconciliación creó una posición basándose en trades históricos del bot.

### Causa Raíz
La lógica de reconciliación buscaba trades con `executed_by_bot=true` en los últimos 7 días, pero **no verificaba si hubo ventas posteriores** al último BUY del bot.

Escenario problemático:
1. Hace 5 días el bot compró BTC
2. Hace 3 días se vendió (manual o por bot)
3. Hoy el usuario depositó BTC externamente
4. Reconciliación: balance BTC > 0 + trade BUY del bot histórico → crea posición incorrecta

### Solución
```typescript
// ANTES: Solo verificaba si existía trade BUY del bot
const botTrades = await storage.getRecentTradesForReconcile({...});
if (botTrades.length > 0) {
  // Crear posición con último trade
}

// AHORA: Verifica que NO haya SELL posterior al último BUY
const buyTrades = botBuyTrades.filter(t => t.type === 'buy');
if (buyTrades.length > 0) {
  const lastBuyTime = new Date(buyTrades[0].executedAt).getTime();
  
  // Buscar cualquier SELL posterior al BUY
  const allRecentTrades = await storage.getRecentTradesForReconcile({
    since: new Date(lastBuyTime), // Desde el último BUY
    // Sin filtrar por executedByBot para capturar ventas manuales
  });
  
  const sellAfterBuy = allRecentTrades.find(t => 
    t.type === 'sell' && new Date(t.executedAt).getTime() > lastBuyTime
  );
  
  if (sellAfterBuy) {
    // Balance es externo - NO crear posición
    results.push({ action: 'skipped_sold_after_buy', ... });
  } else {
    // Sin ventas posteriores → crear posición
  }
}
```

### Archivo Modificado
- `server/routes.ts` líneas 2410-2505 (endpoint `/api/positions/reconcile`)

### Impacto
- Reconciliación ya NO crea posiciones de balances externos
- Solo crea posiciones si el último trade BUY del bot NO tiene ventas posteriores
- Previene "resurrecciones" de posiciones ya vendidas

### Acción Manual Requerida
- Eliminar manualmente la posición BTC/USD incorrecta desde el dashboard
- Verificar que las posiciones SOL/USD con status FAILED se limpien

---

## 2026-01-25 12:35 — FIX: P&L Neto usaba fee incorrecto para RevolutX

### Problema
El cálculo de P&L Neto en `/api/open-positions` usaba siempre `takerFeePct` (0.40% Kraken) en lugar del fee real según el exchange de la posición.

Para posiciones RevolutX (fee real 0.09%), las comisiones estimadas estaban infladas 4.4x.

### Causa Raíz
```typescript
// ANTES: Siempre usaba takerFeePct (0.40%)
const entryFeeUsd = entryValueUsd * takerFeePct;
const exitFeeUsd = currentValueUsd * takerFeePct;
```

### Solución
```typescript
// AHORA: Usa fee según exchange
const feePctForExchange = (exchange: string) => {
  if (exchange === 'revolutx') return 0.09 / 100;  // 0.09%
  return krakenFeePct;  // config (default 0.40%)
};

const feePct = feePctForExchange(ex);
const entryFeeUsd = entryValueUsd * feePct;
const exitFeeUsd = currentValueUsd * feePct;
```

### Archivo Modificado
- `server/routes.ts` líneas 762-812

### Impacto
- Posiciones RevolutX: comisiones correctas (0.09% vs 0.40%)
- P&L Neto más preciso para trading real
- Sin cambio para posiciones Kraken

---

## 2026-01-24 20:45 — FIX CRÍTICO: Órdenes ejecutadas marcadas como FALLIDA

### Problema Reportado
Orden BUY TON ejecutada correctamente en RevolutX (32.72251 TON @ $1.5323), pero en UI:
- Aparece lote 2/2 marcado como "FALLIDA"
- La cantidad comprada se suma a la posición TON existente (lote 1) en lugar del lote 2

### Causa Raíz Identificada
**RevolutXService NO tenía implementado el método `getFills`**. El FillWatcher:
1. Intentaba llamar `exchangeService.getFills?.({ limit: 50 })`
2. Al no existir, retornaba array vacío
3. Después de 120s de timeout sin fills, marcaba la posición como FAILED
4. La orden SÍ estaba ejecutada pero el bot no podía verificarlo

### Archivos Modificados

#### `server/services/exchanges/RevolutXService.ts`
- **NUEVO**: Método `getOrder(orderId)` - Consulta estado de orden específica
  - Usa endpoint `GET /api/1.0/orders/{orderId}`
  - Retorna filledSize, executedValue, averagePrice, status
- **NUEVO**: Método `getFills(params)` - Obtiene fills recientes
  - Usa `listPrivateTrades()` para symbol específico
  - Fallback a `getOrder()` para construir fill sintético
  - Fallback a endpoint `/api/1.0/fills`

#### `server/services/FillWatcher.ts`
- **MEJORADO**: Función `fetchFillsForOrder()` con 3 estrategias:
  1. **ESTRATEGIA 1**: Si hay `exchangeOrderId`, consulta `getOrder()` directamente
  2. **ESTRATEGIA 2**: Si hay `pair`, usa `getFills({ symbol })` con filtro temporal
  3. **ESTRATEGIA 3**: Fallback genérico `getFills({ limit: 50 })`

#### `shared/schema.ts`
- **NUEVO**: Campo `venueOrderId` en tabla `open_positions`
  - Almacena ID de orden del exchange para consultas de estado

#### `server/storage.ts`
- **ACTUALIZADO**: `createPendingPosition()` acepta `venueOrderId`
- **NUEVO**: Método `getPositionByVenueOrderId()`

#### `server/services/tradingEngine.ts`
- **ACTUALIZADO**: Pasa `venueOrderId: pendingOrderId` a `createPendingPosition()`

#### `db/migrations/011_add_venue_order_id.sql`
- Migración para agregar columna `venue_order_id` a `open_positions`
- Índice para búsqueda eficiente

### Flujo Corregido
1. `placeOrder()` → exchange acepta orden → retorna `orderId`
2. `createPendingPosition()` guarda `clientOrderId` + `venueOrderId`
3. `FillWatcher` inicia polling cada 3s
4. `getOrder(venueOrderId)` consulta estado real de la orden
5. Si orden tiene fills → actualiza posición a OPEN con precio medio
6. UI muestra lote 2/2 como OPEN (no FAILED)

### Migración Requerida
```sql
-- Ejecutar en BD antes de deploy:
ALTER TABLE open_positions ADD COLUMN IF NOT EXISTS venue_order_id TEXT;
CREATE INDEX IF NOT EXISTS idx_open_positions_venue_order_id 
ON open_positions(venue_order_id) WHERE venue_order_id IS NOT NULL;
```

### Criterio de Éxito (Validación)
- Repetir compra TON con `sgMaxOpenLotsPerPair=2`
- La compra nueva queda en lote 2 (OPEN), NO se suma al lote 1
- No aparece ningún lote "FALLIDA" para órdenes ejecutadas
- IDs (client_order_id y venue_order_id) persistidos y trazables

---

## 2026-01-25 13:20 — Mejora Visual de Alertas Telegram (Compras/Ventas/Errores)

### Objetivo
Mejorar el formato visual de las alertas de Telegram para que sean más claras y atractivas, con estados de proceso y P&L real.

### Cambios Implementados

#### 1️⃣ Alertas de Error con Severidad Visual
- **ERROR CRITICAL** 🔴 - Errores graves que requieren atención inmediata
- **ERROR MEDIUM** 🟡 - Errores moderados
- **ERROR LOW** 🟢 - Advertencias menores

Formato nuevo:
```
🔴 ERROR CRITICAL 🔴
━━━━━━━━━━━━━━━━━━━
🏷️ Tipo: TRADING_ERROR
📊 Par: ETH/USD
🏦 Exchange: RevolutX
🕐 Hora: 25/01/2026, 13:15:00
📁 Archivo: tradingEngine.ts
🔧 Función: executeTrade
📍 Línea: 1234

❌ Error al ejecutar orden de compra

📋 Contexto:
   • orderId: abc123...
   • reason: Insufficient funds
━━━━━━━━━━━━━━━━━━━
```

#### 2️⃣ Alertas de COMPRA con Estados
- **🟡 COMPRA ENVIADA** - Orden enviada, esperando confirmación
- **🟢 COMPRA REALIZADA** - Orden ejecutada exitosamente
- **🔴 COMPRA FALLIDA** - Error en la ejecución

Formato nuevo:
```
🟢🟢🟢 COMPRA REALIZADA 🟢🟢🟢
━━━━━━━━━━━━━━━━━━━
✅ XRP/USD

🏦 Exchange: RevolutX
💵 Precio: $3.15
📦 Cantidad: 109.58
💰 Total invertido: $345.19

📊 Indicadores:
EMA10>EMA20 ✓, MACD+ ✓

🧭 Régimen: TREND
   ↳ Tendencia alcista

⚙️ Modo: SMART_GUARD
🔗 OrderID: 177b3f2a...
🎫 LotID: engine-17691...
━━━━━━━━━━━━━━━━━━━
🕐 25/01/2026, 13:15:00
```

#### 3️⃣ Alertas de VENTA con P&L Real (incluyendo fees)
- **🟠 VENTA ENVIADA** - Orden enviada
- **🔴 VENTA REALIZADA** - Con resultado real
- **⚫ VENTA FALLIDA** - Error

Formato nuevo con P&L NETO:
```
🔴🔴🔴 VENTA REALIZADA 🔴🔴🔴
━━━━━━━━━━━━━━━━━━━
💰 ETH/USD

🏦 Exchange: RevolutX
💵 Precio venta: $3350.00
📦 Cantidad: 0.175
💰 Total recibido: $586.25
⏱️ Duración: 1d 2h 15m

━━━━━━━━━━━━━━━━━━━
🎉 RESULTADO REAL 🎉

📈 Beneficio/Pérdida NETO:
   💵 +$21.94 (+3.89%)

📊 Desglose:
   • P&L Bruto: +$23.11
   • Fees pagados: -$1.17
   • NETO: +$21.94
━━━━━━━━━━━━━━━━━━━

🛡️ Tipo salida: TRAILING_STOP
⚡ Trigger: Trail activado en $3380

⚙️ Modo: SMART_GUARD
🔗 OrderID: 288c4g3b...
━━━━━━━━━━━━━━━━━━━
🕐 25/01/2026, 13:30:00
```

### Archivos Modificados
- `server/services/telegram/templates.ts` - Nuevos templates visuales
- `server/services/telegram.ts` - Nuevos métodos de envío

### Nuevos Métodos en TelegramService
```typescript
// Errores con severidad
sendErrorAlert(ctx: ErrorAlertContext)
sendCriticalError(ctx: Omit<ErrorAlertContext, 'severity'>)

// Compras visuales
sendBuyAlert(ctx: { status: 'PENDING' | 'COMPLETED' | 'FAILED', ... })

// Ventas con P&L real
sendSellAlert(ctx: { pnlUsd, feeUsd, netPnlUsd, ... })

// Orden pendiente
sendOrderPending(type: 'BUY' | 'SELL', pair, exchange, amount, price, orderId)
```

---

## 2026-01-24 00:30 — Documentación Completa de Alertas Telegram

### Objetivo
Crear inventario completo de todas las alertas Telegram, cuándo se activan y cómo se configuran.

### Archivo Creado
`ALERTAS_TELEGRAM.md` - Documentación exhaustiva del sistema de alertas

### Contenido
- **25+ tipos de alertas** categorizadas por tipo
- **Tablas detalladas** con cuándo se activa cada alerta
- **Cooldowns configurables** por tipo de evento
- **Sistema de deduplicación v2.0** con hash/throttle
- **Comandos de gestión** (/channels, /menu, /refresh_commands)

### Categorías Documentadas
- 🕐 Programadas (Heartbeat, Reporte Diario)
- 🚀 Ciclo de vida del bot (Inicio/Detenido)
- 💰 Trading (Compras/Ventas/SL/TP/Trailing)
- 🛡️ Smart Guard (BE/Trailing/Scale-Out)
- ⚠️ Riesgos y Límites (Drawdown, Cooldown)
- 🔧 Reconciliación (Posiciones huérfanas)
- 🚨 Errores (Críticos, API)

### Configuración
- 6 tipos de alertas configurables en `/channels`
- Cooldowns personalizables por evento
- Sistema de deduplicación por tipo de mensaje

---

## 2026-01-24 00:00 — Refactorización Completa Sistema Telegram

### Objetivo
Modernizar notificaciones Telegram: branding unificado "CHESTER BOT", exchange explícito, anti-placeholders, deduplicación, comandos alineados.

### Archivos Creados

#### `server/services/telegram/types.ts`
- Schemas Zod para validación de contextos
- `BOT_CANONICAL_NAME = "CHESTER BOT"`
- `TELEGRAM_COMMANDS` - Lista autoritativa de comandos
- `DailyReportContextSchema`, `TradeBuyContextSchema`, etc.
- Funciones `validateContext()`, `safeValidateContext()`

#### `server/services/telegram/templates.ts`
- Templates HTML con branding consistente
- `buildHeader()` → `[VPS/STG] 🤖 CHESTER BOT 🇪🇸`
- `buildDailyReportHTML()` mejorado con secciones separadas
- `buildTradeBuyHTML()` / `buildTradeSellHTML()` con exchange explícito
- Helpers: `formatAge()`, `formatDuration()`, `escapeHtml()`

#### `server/services/telegram/deduplication.ts`
- `MessageDeduplicator` class con hash y throttle
- Configs por tipo: positions_update (5min), heartbeat (6h), etc.
- Rate limit por hora
- `checkAndMark()` para verificar y marcar en una llamada

#### `server/services/telegram/templates.test.ts`
- Tests snapshot para cada template
- Fixtures completos: reporte con posiciones, vacío, con pending orders
- Validación anti-placeholder en todos los templates
- Tests de helpers (escapeHtml, formatDuration, etc.)

### Archivos Modificados

#### `server/services/telegram.ts`
```typescript
// Nuevos imports
import { TELEGRAM_COMMANDS, BOT_CANONICAL_NAME, ... } from "./telegram/types";
import { telegramTemplates, buildDailyReportHTML, ... } from "./telegram/templates";
import { messageDeduplicator } from "./telegram/deduplication";

// Branding actualizado
function getBotBranding(): string {
  return `[${environment.envTag}] 🤖 <b>${BOT_CANONICAL_NAME}</b> 🇪🇸`;
}

// Nuevos comandos
this.bot.onText(/\/refresh_commands/, async (msg) => {
  await this.handleRefreshCommands(msg.chat.id);
});

// setMyCommands al iniciar
private async registerCommandsWithTelegram(): Promise<void> {
  await this.bot.setMyCommands(TELEGRAM_COMMANDS.map(...));
}

// /ayuda dinámico desde TELEGRAM_COMMANDS
private async handleAyuda(chatId: number) {
  const sections = [
    formatSection("📊 Información:", infoCommands),
    formatSection("⚙️ Configuración:", configCommands),
    ...
  ];
}
```

### Ejemplos de Salida

#### Reporte Diario (con posiciones)
```
[VPS/STG] 🤖 CHESTER BOT 🇪🇸
━━━━━━━━━━━━━━━━━━━
📋 REPORTE DIARIO (14:00)
🕒 23/01/2026 14:00:00 (Europe/Madrid)

🔌 Conexiones:
  ✅ Kraken | ✅ DB | ✅ Telegram | ✅ RevolutX

🧠 Sistema:
  CPU: 0.4%
  Memoria: 7.4/7.7 GB (96.4%) ⚠️
  Disco: 42.1/232.4 GB (18.1%)
  Uptime: 17d 16h 13m

🤖 Bot:
  Entorno: VPS/STG | DRY_RUN: NO
  Modo: SMART_GUARD | Estrategia: momentum
  Pares: TON/USD, BTC/USD, ETH/USD, SOL/USD, XRP/USD

💰 Portfolio (confirmado):
  Posiciones: 3 | Exposición: $1087.32
  • XRP/USD (RevolutX): $345.19 @ $3.1500
  • ETH/USD (RevolutX): $563.14 @ $3218.4500
  • TON/USD (RevolutX): $178.99 @ $5.2300

🧾 Órdenes pendientes:
  Sin órdenes pendientes

🔄 Sincronización:
  Kraken lastSync: 13:58:10 (hace 1m 50s)
  RevolutX lastSync: 13:52:05 (hace 7m 55s)
━━━━━━━━━━━━━━━━━━━
Panel: http://5.250.184.18:3020/
```

#### Trade Buy
```
[VPS/STG] 🤖 CHESTER BOT 🇪🇸
━━━━━━━━━━━━━━━━━━━
🟢 COMPRA XRP/USD 🟢

🏦 Exchange: RevolutX
💵 Precio: $3.15
📦 Cantidad: 109.58
💰 Total: $345.19

📊 Indicadores:
EMA10>EMA20 ✓, MACD+ ✓, Vol 1.8x ✓, RSI 42

🧭 Régimen: TREND
   ↳ Tendencia alcista (ADX=32, EMAs alineadas)

⚙️ Modo: SMART_GUARD
🔗 OrderID: 177b3f2a-1234-5678-9abc-def012345678
🎫 LotID: engine-1769186188930-XRPUSD

📅 23/01/2026 10:30:00
━━━━━━━━━━━━━━━━━━━
Panel: http://5.250.184.18:3020/
```

### Verificación
```bash
# Ejecutar tests
npm test -- server/services/telegram/templates.test.ts

# Verificar compilación
npx tsc --noEmit
```

---

## 2026-01-23 23:55 — Fix Logs en Rojo (detectLevel falsos positivos)

### Problema
Los logs del endpoint `/api/logs` aparecían en rojo (ERROR) en la UI del monitor aunque eran peticiones exitosas (HTTP 200). 

**Causa raíz:** La función `detectLevel()` en `serverLogsService.ts` buscaba la palabra "ERROR" en cualquier parte de la línea usando `line.toUpperCase().includes("ERROR")`. Cuando el endpoint `/api/logs` retornaba JSON con campos como `"isError":false`, toda la línea se clasificaba como ERROR.

### Solución
Modificado `server/services/serverLogsService.ts` líneas 53-98:

```typescript
private detectLevel(line: string): string {
  // Patrones regex específicos para errores reales
  const errorPatterns = [
    /\[ERROR\]/i,
    /\(ERROR\)/i,
    /^ERROR:/i,
    /\bERROR\b.*:/,
    /\[FATAL\]/i,
    /\bFATAL\b/i,
    /\bEXCEPTION\b/i,
    /\bUncaught\b/i,
    /\bUnhandled\b/i,
  ];
  
  // Detectar respuestas JSON que contienen logs anidados
  const isJsonResponseLog = line.includes('{"logs":') || line.includes('"isError"');
  
  if (!isJsonResponseLog) {
    // Aplicar patrones normalmente
    for (const pattern of errorPatterns) {
      if (pattern.test(line)) return "ERROR";
    }
  } else {
    // Solo marcar ERROR si HTTP status es 4xx/5xx
    const httpStatusMatch = line.match(/\s([45]\d{2})\s+in\s+\d+ms/);
    if (httpStatusMatch) return "ERROR";
  }
  
  // WARN y DEBUG patterns...
  return "INFO";
}
```

### Archivos modificados
- `server/services/serverLogsService.ts`

### Verificación
- Compilación OK (errores preexistentes en otros archivos)
- Documentado en BITACORA.md

---
