# 📝 CORRECCIONES Y ACTUALIZACIONES

> Registro detallado de cambios en código y configuración.

---

## 2026-01-27 13:25 — MEJORA: Allowlist centralizada de pares activos (evita 404 por pares no soportados)

### Problema Detectado
El backend intentaba consultar precios en RevolutX para activos presentes en el balance pero **no operados por el bot** (ej.: `LMWR`).
Esto generaba spam de logs con errores 404 al construir pares como `LMWR-USD` y llamar endpoints de market data.

### Solución Implementada

#### 1) Allowlist centralizada basada en `botConfig.activePairs`
Se agregó un helper reutilizable para:
- Tomar `botConfig.activePairs` como **fuente de verdad**.
- Normalizar formato de par (`BTC-USD` -> `BTC/USD`).
- Validar si un par está permitido antes de ejecutar llamadas a RevolutX.

#### 2) Filtrado preventivo en `/api/prices/portfolio`
Antes, el endpoint intentaba `revolutXService.getTicker()` para cualquier asset del balance.
Ahora, solo consulta RevolutX si el par derivado está en allowlist.

#### 3) Validación en `/api/trade/revolutx`
Se valida que el par solicitado esté en allowlist y se normaliza el par para evitar inconsistencias (`BTC-USD` vs `BTC/USD`).

### Archivos Modificados
- `server/services/pairAllowlist.ts` (nuevo)
- `server/routes.ts`

### Impacto
- ✅ Evita errores 404 por pares no operados por el bot (ej.: `LMWR-USD`)
- ✅ Logs más limpios (menos ruido de endpoints inexistentes)
- ✅ Reduce llamadas innecesarias a la API de RevolutX
- ✅ Enforce consistente de pares activos para trading manual RevolutX

---

## 2026-01-26 15:30 — FIX CRÍTICO: Órdenes RevolutX Marcadas Como FAILED Incorrectamente

### Problema Detectado
**Síntoma:** Orden ejecutada exitosamente en RevolutX pero marcada como FAILED en el sistema. La alerta de Telegram muestra "La orden fue aceptada por revolutx" pero la posición termina en estado FAILED.

**Causa Raíz:** 
1. RevolutX acepta la orden pero no retorna precio inmediatamente (`pendingFill: true`)
2. FillWatcher inicia polling cada 3s buscando fills
3. `fetchFillsForOrder()` solo retorna fills si `averagePrice > 0`, ignorando órdenes con `filledSize > 0` pero precio pendiente
4. Después de 2 minutos sin detectar fills, FillWatcher marca la posición como FAILED
5. **El problema:** FillWatcher NO verificaba el estado real de la orden en el exchange antes de marcar como FAILED

### Correcciones Implementadas

#### 1. Verificación de Estado Real en Timeout (`FillWatcher.ts` líneas 93-188)

**Antes:**
```typescript
if (elapsed > timeoutMs && totalFilledAmount === 0) {
  await storage.markPositionFailed(clientOrderId, 'Timeout: No fills received');
  return;
}
```

**Después:**
```typescript
if (elapsed > timeoutMs && totalFilledAmount === 0 && exchangeOrderId) {
  // CRITICAL FIX: Verificar estado real de la orden en el exchange
  const order = await exchangeService.getOrder(exchangeOrderId);
  if (order.status === 'FILLED' && order.filledSize > 0) {
    // Orden fue FILLED - procesar fill tardío
    let price = order.averagePrice || order.executedValue / order.filledSize;
    // Crear fill sintético y actualizar posición
    await storage.updatePositionWithFill(clientOrderId, {...});
    await botLogger.info('ORDER_FILLED_LATE', ...);
    return; // Éxito - NO marcar como FAILED
  }
  // Solo marcar FAILED si verificación confirma que no hay fills
  await storage.markPositionFailed(clientOrderId, 'Timeout after verification');
}
```

#### 2. Derivación de Precio en `fetchFillsForOrder()` (`FillWatcher.ts` líneas 325-352)

**Antes:**
```typescript
if (order && order.filledSize > 0 && order.averagePrice > 0) {
  return [fill]; // Solo si averagePrice está disponible
}
```

**Después:**
```typescript
if (order && order.filledSize > 0) {
  let price = order.averagePrice || 0;
  if (price <= 0 && order.executedValue && order.filledSize > 0) {
    price = order.executedValue / order.filledSize; // Derivar precio
  }
  if (price > 0) {
    return [fill]; // Retornar fill con precio derivado
  }
}
```

#### 3. Nuevo Evento de Log (`botLogger.ts`)

Agregado tipo de evento `ORDER_FILLED_LATE` para rastrear fills detectados después del timeout.

### Flujo Corregido

```
1. RevolutX acepta orden → pendingFill: true
2. Posición PENDING_FILL creada
3. FillWatcher inicia polling
4. Si timeout SIN fills detectados:
   ├─ Verificar estado real en exchange
   ├─ Si FILLED → Procesar fill tardío ✅
   └─ Si NO FILLED → Marcar FAILED ❌
5. Posición actualizada correctamente
```

### Archivos Modificados
- `server/services/FillWatcher.ts` - Verificación en timeout + derivación de precio
- `server/services/botLogger.ts` - Nuevo evento ORDER_FILLED_LATE

### Impacto
- ✅ Elimina falsos positivos de órdenes FAILED
- ✅ Reconciliación automática de fills tardíos
- ✅ Mejor trazabilidad con evento ORDER_FILLED_LATE
- ✅ Previene pérdida de posiciones exitosas

---

## 2026-01-26 21:15 — FIX DEFINITIVO: PENDING_FILL se quedaba colgado aunque RevolutX ya estaba FILLED (tras restart)

### Problema Detectado
**Síntoma:** En UI quedaba una posición `PENDING_FILL` con `Cantidad=0` y `Precio Entrada=$0`, pero en RevolutX la compra estaba **Ejecutada** (FILLED) al instante.

**Caso real (TON/USD):**
- RevolutX `GET /api/1.0/orders/{id}` devolvía:
  - `filled_quantity > 0`
  - `average_fill_price > 0`
  - `status = filled`

### Causas Raíz
1. **Parsing incompleto en `getOrder()`**: RevolutX devuelve `average_fill_price`, pero el parser solo contemplaba `average_price/avg_price`, resultando en `averagePrice=0` aunque la orden estuviera llena.
2. **Watcher perdido tras reinicio**: `FillWatcher` corre en memoria. Si el contenedor se reinicia, una posición `PENDING_FILL` existente en BD puede quedarse “huérfana” si no se relanza el watcher.

### Correcciones Implementadas

#### 1) `RevolutXService.getOrder()` ahora parsea `average_fill_price`
- Se agregaron aliases `average_fill_price` / `avg_fill_price` para poblar `averagePrice`.
- Se añadió parsing de `created_date` (epoch ms) para `createdAt`.

**Commit:** `455f1ac` (RevolutX getOrder parse average_fill_price)

#### 2) Recovery automático en startup: relanzar FillWatcher para PENDING_FILL
- Al iniciar el engine:
  - `storage.getPendingFillPositions(exchange)`
  - `startFillWatcher()` por cada posición, usando `venueOrderId`.
  - Rehidrata `pendingFillExposure` (para SmartGuard) y la limpia al abrir/timeout.

**Commit:** `2b4693a` (Recover PENDING_FILL positions on startup)

#### 3) (Complementario) Error claro en compras manuales cuando no hay USD
- `manualBuyForTest()` valida balance del quote (USD) antes de enviar orden y devuelve error claro (disponible vs requerido con buffer).

**Commit:** `9e01b4d`

### Verificación (Evidencia)
- Logs:
  - `[PENDING_FILL_RECOVERY] Restarting FillWatcher for TON/USD ...`
  - `[FillWatcher] Found fill via getOrder: 0.98749 @ 1.5258`
  - `[storage] Updated position TON/USD with fill ... avgPrice=1.52580000`
- BD (`open_positions.id=28`): `status=OPEN`, `total_amount_base=0.98749000`, `average_entry_price=1.52580000`.

### Impacto
- ✅ PENDING_FILL ya no queda colgado tras reinicios
- ✅ Si RevolutX devuelve `average_fill_price`, se abre la posición con precio real
- ✅ Reduce falsos FAILED por timeouts y elimina “0 @ $0”

---

## 2026-01-25 21:30 — FIX CRÍTICO: Time-Stop ahora funciona en SMART_GUARD

### Problema Detectado
El Time-Stop **NO SE EVALUABA** en posiciones SMART_GUARD porque `checkSmartGuardExit()` hacía `return` sin verificar el tiempo de vida de la posición.

### Corrección
Integrado Time-Stop al inicio de `checkSmartGuardExit()`:

```typescript
// Línea 2964-3051: Time-Stop check en SMART_GUARD
if (!position.timeStopDisabled) {
  if (ageHours >= timeStopHours) {
    if (timeStopMode === "hard") {
      // Cierre forzado (anula SmartGuard)
      await executeTrade(...)
      return;
    } else {
      // SOFT: Solo alerta, SmartGuard sigue gestionando
      await sendAlertWithSubtype(..., "trade_timestop")
      // Continúa con lógica de SmartGuard
    }
  }
}
```

### Comportamiento Actual

| Modo | Posición Normal | Posición SMART_GUARD |
|------|-----------------|----------------------|
| **SOFT** | Alerta + espera profit 1.8% | Alerta + **SmartGuard sigue gestionando** |
| **HARD** | Alerta + cierre forzado | Alerta + **cierre forzado (anula SG)** |

### Botón Desactivar Time-Stop
- ✅ Endpoint `/api/positions/:lotId/time-stop` funciona
- ✅ Frontend muestra icono Timer/TimerOff según estado
- ✅ Campo `timeStopDisabled` en BD se respeta en ambos modos

---

## 2026-01-25 19:30 — CORRECCIÓN MÚLTIPLE: Time-Stop Robusto y Configurable

### 4 Puntos Corregidos

#### 1. SOFT Mode: Sin Cierre Forzado
**Problema**: El modo SOFT cerraba posiciones automáticamente a las 150% del tiempo (ej: 54h si timeStop=36h).
**Corrección**: Eliminado cierre forzado. Ahora SOFT solo cierra si hay profit suficiente o el usuario cierra manualmente.

```typescript
// ANTES: Cerraba automáticamente a 150% del tiempo
const maxAbsoluteHours = timeStopHours * 1.5;
if (ageHours >= maxAbsoluteHours) { shouldClose: true }

// DESPUÉS: Solo espera profit o cierre manual
// shouldClose: false hasta que priceChange >= minCloseNetPct
```

#### 2. TimeStopHours: Verificación
**Hallazgo**: `timeStopHours` es global (no por activo), configurable en Settings.tsx y `bot_config`.
- Default: 36h
- Rango: 6-120h
- Los 48h que viste eran probablemente un valor configurado anteriormente.

#### 3. TakerFeePct: Usa Fee del Exchange Activo
**Problema**: `getAdaptiveExitConfig()` usaba fee hardcodeado de BD (default 0.40%).
**Corrección**: Ahora usa `getTradingFees()` que devuelve fee del exchange activo:
- Kraken: 0.40%
- Revolut: 0.09%

```typescript
// ANTES
takerFeePct: parseFloat(config?.takerFeePct?.toString() ?? "0.40")

// DESPUÉS
const exchangeFees = this.getTradingFees();
takerFeePct: exchangeFees.takerFeePct
```

#### 4. UI: Toggle de Alertas Time-Stop en Notificaciones
**Nuevo**: Agregado toggle `trade_timestop` en la UI de Notificaciones.
- Usuarios pueden activar/desactivar alertas Time-Stop por chat
- Respeta preferencias usando `sendAlertWithSubtype(..., "trade_timestop")`

### Archivos Modificados
- `server/services/tradingEngine.ts`:
  - Eliminado bloque de cierre forzado a 150%
  - `getAdaptiveExitConfig()` usa fees del exchange activo
  - Alertas usan `sendAlertWithSubtype` con subtype `trade_timestop`
- `server/services/telegram.ts`:
  - Agregado `trade_timestop` al tipo `AlertSubtype`
- `client/src/pages/Notifications.tsx`:
  - Agregado toggle "Time-Stop" en categoría Trades

### Comportamiento Final SOFT Mode
1. Al llegar a `timeStopHours` → Alerta "Time-Stop Alcanzado"
2. Espera profit suficiente (>= minCloseNetPct) → Cierra automáticamente
3. Sin profit → **NO cierra** → Usuario puede cerrar manualmente
4. **Sin cierre forzado a 150%**

### Comportamiento Final HARD Mode
1. Al llegar a `timeStopHours` → Alerta "Cierre Inmediato" + Cierra automáticamente

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

## 2026-01-25 19:05 — MEJORA ROBUSTA: Refactorización del Sistema de Alertas Time-Stop

### Problemas Identificados en Revisión
1. **Configuración Hardcodeada**: Las funciones usaban valores fijos (36h, soft) en lugar de leer de BD
2. **Código Duplicado**: Alertas Telegram repetidas en 3 lugares diferentes
3. **Sin Manejo de Errores**: getTicker(), sendAlertToMultipleChats() y savePositionToDB() sin try/catch
4. **Sin Estadísticas**: Endpoints no devolvían información útil sobre alertas enviadas

### Solución Implementada

#### 1. Helper para Construir Mensajes (`buildTimeStopAlertMessage`)
```typescript
private buildTimeStopAlertMessage(
  pair: string,
  ageHours: number,
  timeStopHours: number,
  timeStopMode: "soft" | "hard",
  priceChange: number,
  minCloseNetPct: number
): string
```
- Centraliza la construcción de mensajes de alerta
- Elimina duplicación de código
- Facilita mantenimiento futuro

#### 2. Helper para Enviar Alertas (`sendTimeStopAlert`)
```typescript
private async sendTimeStopAlert(
  position: OpenPosition,
  exitConfig: { takerFeePct; profitBufferPct; timeStopHours; timeStopMode }
): Promise<{ success: boolean; error?: string }>
```
- Manejo de errores robusto con try/catch
- Valida Telegram inicializado
- Captura errores de getTicker() y sendAlertToMultipleChats()
- Retorna resultado con error detallado si falla

#### 3. Configuración Dinámica desde BD
```typescript
// ANTES (hardcodeado):
const exitConfig = { timeStopHours: 36, timeStopMode: "soft" };

// DESPUÉS (dinámico):
const exitConfig = await this.getAdaptiveExitConfig();
```
- Usa `getAdaptiveExitConfig()` que lee de `bot_config` en BD
- Respeta cambios de configuración sin necesidad de redeploy

#### 4. Estadísticas de Ejecución
```typescript
// checkExpiredTimeStopPositions() retorna:
{ checked: number; alerted: number; errors: number }

// forceTimeStopAlerts() retorna:
{ checked: number; alerted: number; errors: number; skipped: number }
```
- Endpoint `/api/debug/time-stop-alerts-force` devuelve estadísticas
- Logging detallado de cada posición procesada

### Archivos Modificados
- `server/services/tradingEngine.ts`:
  - Líneas 1208-1252: `buildTimeStopAlertMessage()` helper
  - Líneas 1254-1306: `sendTimeStopAlert()` helper con error handling
  - Líneas 1308-1360: `checkExpiredTimeStopPositions()` refactorizado
  - Líneas 1362-1409: `forceTimeStopAlerts()` refactorizado
- `server/routes.ts`:
  - Línea 4734: Endpoint devuelve estadísticas

### Comportamiento Mejorado
- ✅ Lee configuración real de BD (timeStopHours, timeStopMode)
- ✅ Manejo de errores en cada paso (ticker, telegram, save)
- ✅ Logging detallado para debugging
- ✅ Estadísticas de alertas enviadas/fallidas/omitidas
- ✅ Código centralizado y mantenible

### Impacto
- No hay cambios de comportamiento visible para el usuario
- Mayor robustez ante errores de red o servicios externos
- Facilita debugging con logs detallados
- Prepara el sistema para futuras mejoras

---

## 2026-01-25 16:48 — FIX CRÍTICO: Alertas Time-Stop no llegaban para posiciones ya expiradas

### Problema Reportado
Las alertas de Time-Stop no llegaban para ETH/USD y TON/USD porque expiraron ANTES de implementar las alertas. El código solo enviaba alerta la primera vez que expiraba una posición.

### Causa Raíz
- Las posiciones expiraron hace 15 horas
- `timeStopExpiredAt` estaba vacío en BD
- El código solo notificaba si `!position.timeStopExpiredAt`
- Al iniciar el bot, no se verificaban posiciones ya expiradas

### Solución
Implementado `checkExpiredTimeStopPositions()` que se ejecuta al iniciar el bot:

```typescript
// Se ejecuta después de cargar posiciones desde BD
await this.checkExpiredTimeStopPositions();

// Verifica posiciones expiradas no notificadas y envía alerta
private async checkExpiredTimeStopPositions(): Promise<void> {
  for (const [lotId, position] of this.openPositions) {
    if (position.timeStopExpiredAt) continue;  // Ya notificada
    if (position.timeStopDisabled) continue;  // Time-Stop pausado
    
    if (ageHours >= exitConfig.timeStopHours) {
      // Enviar alerta SOFT o HARD según configuración
      // Marcar como notificada para evitar duplicados
    }
  }
}
```

### Archivos Modificados
- `server/services/tradingEngine.ts`:
  - Línea 1894: Llamada a `checkExpiredTimeStopPositions()` al iniciar
  - Líneas 1208-1288: Nueva función de verificación startup

### Comportamiento
- **Al iniciar bot**: Verifica todas las posiciones abiertas
- **Si expiraron y no notificadas**: Envía alerta inmediata
- **Marca como notificada**: Evita alertas duplicadas
- **Funciona para ambos modos**: SOFT y HARD

### Impacto
- Ahora recibirás alertas para posiciones ya expiradas (ETH, TON)
- Futuras expiraciones seguirán notificándose correctamente
- No se enviarán alertas duplicadas

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
