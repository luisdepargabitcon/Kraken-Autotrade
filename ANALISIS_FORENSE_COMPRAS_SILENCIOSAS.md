# Análisis Forense: Compras "Silenciosas" en Revolut X
**Fecha:** 2025-01-22  
**Incidente:** Órdenes ejecutadas sin notificaciones Telegram (21/01/2025)

---

## 1. ROOT CAUSE IDENTIFICADO

### Ubicación del problema
`server/services/tradingEngine.ts` líneas **6558-6603**

### Código problemático actual:
```typescript
// Línea 6558
if (this.telegramService.isInitialized()) {
  // ... construye mensaje ...
  await this.telegramService.sendAlertWithSubtype(naturalMessage, "trades", "trade_buy");
}
// Línea 6603 - FIN DEL IF

log(`Orden ejecutada: ${txid}`, "trading");  // <-- NO INDICA SI HUBO NOTIFICACIÓN
```

### Problema:
1. **Sin fallback**: Si `isInitialized()` es `false`, la notificación se omite silenciosamente
2. **Sin try-catch**: Si `sendAlertWithSubtype()` lanza excepción, no se captura
3. **Sin logging**: No hay registro de si la notificación fue enviada o no
4. **Sin trazabilidad**: No hay correlation_id para vincular orden con notificación

### Confirmación en `start()` (línea 1782):
```typescript
if (!this.telegramService.isInitialized()) {
  log("Telegram no está configurado, continuando sin notificaciones", "trading");
  // El bot CONTINÚA operando sin alertas
}
```

---

## 2. PUNTOS DE EJECUCIÓN DE TRADING IDENTIFICADOS

| Archivo | Método | Descripción |
|---------|--------|-------------|
| `tradingEngine.ts` | `placeOrder()` línea 6171 | **PRINCIPAL** - Ejecución de órdenes |
| `RevolutXService.ts` | `placeOrder()` línea 304 | Adapter para Revolut X API |
| `kraken.ts` | `placeOrder()` | Adapter para Kraken API |
| `routes.ts` | `/api/trading/execute` | Endpoint manual (requiere confirmación) |

**Conclusión:** Solo hay UN punto de ejecución real: `tradingEngine.placeOrder()` que delega al adapter del exchange configurado.

---

## 3. FLUJO ACTUAL DE ORDEN

```
Trigger (tick/scheduler)
    ↓
Señal/decisión (evalBuySignal/evalSellSignal)
    ↓
placeOrder() línea 6171
    ↓
Exchange adapter (RevolutX/Kraken)
    ↓
Persistencia (storage.insertTradeIgnoreDuplicate) ✓
    ↓
Actualización posición (savePositionToDB) ✓
    ↓
Notificación Telegram ← ⚠️ FALLA SILENCIOSAMENTE AQUÍ
    ↓
botLogger.info("TRADE_EXECUTED") ← NO REGISTRA ESTADO DE NOTIFICACIÓN
```

---

## 4. FIX PROPUESTO

### 4.1 Agregar correlation_id (antes de placeOrder, ~línea 6159)
```typescript
// NUEVO: Generar correlation_id para trazabilidad completa
const correlationId = `${Date.now()}-${pair.replace('/', '')}-${type}-${Math.random().toString(36).slice(2, 8)}`;

// NUEVO: Log ORDER_ATTEMPT antes de ejecutar
log(`[ORDER_ATTEMPT] ${correlationId} | ${type.toUpperCase()} ${volume} ${pair} @ $${price.toFixed(2)} via ${this.getTradingExchangeType()}`, "trading");
await botLogger.info("ORDER_ATTEMPT", `Attempting ${type.toUpperCase()} order`, {
  correlationId,
  pair,
  type,
  volume,
  price,
  exchange: this.getTradingExchangeType(),
  reason,
  telegramInitialized: this.telegramService.isInitialized(),
});
```

### 4.2 Reemplazar bloque de notificación (líneas 6555-6603)

**ANTES:**
```typescript
const emoji = type === "buy" ? "🟢" : "🔴";
const totalUSDFormatted = totalUSD.toFixed(2);

if (this.telegramService.isInitialized()) {
  // ... mensaje ...
  await this.telegramService.sendAlertWithSubtype(...);
}

log(`Orden ejecutada: ${txid}`, "trading");
```

**DESPUÉS:**
```typescript
const emoji = type === "buy" ? "🟢" : "🔴";
const totalUSDFormatted = totalUSD.toFixed(2);

// CRITICAL: Variables para tracking de notificación
let notificationSent = false;
let notificationError: string | null = null;

const strategyLabel = strategyMeta?.strategyId ? 
  ((strategyMeta?.timeframe && strategyMeta.timeframe !== "cycle") ? 
    `Momentum (Velas ${strategyMeta.timeframe})` : 
    "Momentum (Ciclos)") : 
  "Momentum (Ciclos)";
const confidenceValue = strategyMeta?.confidence ? toConfidencePct(strategyMeta.confidence, 0).toFixed(0) : "N/A";

if (this.telegramService.isInitialized()) {
  try {
    // Build natural language messages for Telegram with essential data
    if (type === "buy") {
      const regimeText = strategyMeta?.regime 
        ? (strategyMeta.regime === "TREND" ? "tendencia alcista" : 
           strategyMeta.regime === "RANGE" ? "mercado lateral" : "mercado en transición")
        : "";
      
      const assetName = pair.replace("/USD", "");
      const confNum = parseInt(confidenceValue);
      const confidenceLevel = !isNaN(confNum) 
        ? (confNum >= 80 ? "alta" : confNum >= 60 ? "buena" : "moderada")
        : "";
      
      let naturalMessage = `🟢 <b>Nueva compra de ${assetName}</b>\n\n`;
      naturalMessage += `He comprado <b>${volume}</b> ${assetName} (<b>$${totalUSDFormatted}</b>) a <b>$${price.toFixed(2)}</b>.\n\n`;
      
      if (regimeText && confidenceLevel) {
        naturalMessage += `📊 Mercado en ${regimeText}, confianza ${confidenceLevel} (${confidenceValue}%).\n`;
      } else if (confidenceLevel) {
        naturalMessage += `📊 Confianza ${confidenceLevel} (${confidenceValue}%).\n`;
      }
      
      naturalMessage += `🧠 Estrategia: ${strategyLabel}\n`;
      naturalMessage += `🔗 ID: <code>${txid}</code>\n\n`;
      naturalMessage += `<a href="${environment.panelUrl}">Ver en Panel</a>`;
      
      await this.telegramService.sendAlertWithSubtype(naturalMessage, "trades", "trade_buy");
    } else {
      const assetName = pair.replace("/USD", "");
      let naturalMessage = `🔴 <b>Venta de ${assetName}</b>\n\n`;
      naturalMessage += `He vendido <b>${volume}</b> ${assetName} a <b>$${price.toFixed(2)}</b> ($${totalUSDFormatted}).\n\n`;
      naturalMessage += `📝 ${reason}\n`;
      naturalMessage += `🔗 ID: <code>${txid}</code>`;
      
      await this.telegramService.sendAlertWithSubtype(naturalMessage, "trades", "trade_sell");
    }
    notificationSent = true;
  } catch (telegramErr: any) {
    notificationError = telegramErr.message;
    log(`[TELEGRAM_FAIL] ${correlationId} | Error enviando notificación: ${telegramErr.message}`, "trading");
  }
} else {
  notificationError = "Telegram not initialized";
  log(`[TELEGRAM_NOT_INIT] ${correlationId} | Telegram no inicializado - orden ejecutada SIN notificación`, "trading");
}

// CRITICAL: Log con estado de notificación para auditoría
await botLogger.info(notificationSent ? "NOTIFICATION_SENT" : "NOTIFICATION_FAILED", 
  notificationSent ? `Notification sent for ${type} order` : `FAILED to notify ${type} order`, {
  correlationId,
  pair,
  type,
  txid,
  notificationSent,
  notificationError,
  totalUsd: totalUSD,
});

log(`[ORDER_COMPLETED] ${correlationId} | Orden ejecutada: ${txid} | Notificación: ${notificationSent ? 'OK' : 'FAILED'}`, "trading");
```

---

## 5. BENEFICIOS DEL FIX

| Problema | Solución |
|----------|----------|
| Notificación silenciosa | Log explícito `[TELEGRAM_NOT_INIT]` o `[TELEGRAM_FAIL]` |
| Sin trazabilidad | `correlationId` en todo el flujo |
| Sin catch de errores | `try-catch` alrededor de Telegram |
| Sin log de resultado | `botLogger.info("NOTIFICATION_SENT/FAILED")` |
| Sin auditoría | `ORDER_ATTEMPT` antes, `ORDER_COMPLETED` después |

---

## 6. VERIFICACIÓN POST-FIX

Después de implementar, los logs mostrarán:
```
[ORDER_ATTEMPT] 1737550000000-ETHUSD-buy-a1b2c3 | BUY 0.05 ETH/USD @ $3200.00 via revolutx
[ORDER_COMPLETED] 1737550000000-ETHUSD-buy-a1b2c3 | Orden ejecutada: ORD123 | Notificación: OK
```

O en caso de fallo de Telegram:
```
[ORDER_ATTEMPT] 1737550000000-ETHUSD-buy-a1b2c3 | BUY 0.05 ETH/USD @ $3200.00 via revolutx
[TELEGRAM_NOT_INIT] 1737550000000-ETHUSD-buy-a1b2c3 | Telegram no inicializado - orden ejecutada SIN notificación
[ORDER_COMPLETED] 1737550000000-ETHUSD-buy-a1b2c3 | Orden ejecutada: ORD123 | Notificación: FAILED
```

---

## 7. TAREAS PENDIENTES (requieren aprobación)

- [ ] Aplicar fix en `tradingEngine.ts`
- [ ] Agregar fallback: si Telegram falla, persistir notificación pendiente (cola/outbox)
- [ ] Implementar opción configurable: bloquear trading si no hay canal de notificación
- [ ] Test de integración: simular fill → verificar notificación
- [ ] Test de caída: simular crash → verificar reconciliación

---

**¿Aprobar implementación del fix?**
