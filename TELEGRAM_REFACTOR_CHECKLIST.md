# ✅ CHECKLIST DE ACEPTACIÓN - Refactorización Telegram

**PR:** Telegram Branding Unificado + Anti-Placeholders + Comandos  
**Fecha:** 2026-01-24  
**Autor:** Windsurf Cascade

---

## 1️⃣ Branding Unificado

- [ ] Todos los mensajes usan `CHESTER BOT` como nombre canónico
- [ ] Header format: `[VPS/STG] 🤖 CHESTER BOT 🇪🇸`
- [ ] Exchange (Kraken/RevolutX) aparece en el **body**, no en el header
- [ ] No aparece "KRAKEN BOT" sin aclaración del exchange real

## 2️⃣ Exchange Explícito

- [ ] Trade Buy muestra `🏦 Exchange: RevolutX` o `Kraken`
- [ ] Trade Sell muestra exchange
- [ ] Posiciones muestran exchange por cada posición
- [ ] Reporte diario muestra exchange en cada posición/orden

## 3️⃣ Reporte Diario Mejorado

- [ ] **Posiciones confirmadas** separadas de **órdenes pendientes**
- [ ] lastSync por exchange con edad (`hace Xm Ys`)
- [ ] Warning visual `⚠️` si memoria > 90%
- [ ] Si hay órdenes pendientes, se muestran aunque posiciones = 0
- [ ] Sync status muestra `N/D (sin sincronizar)` si no hay sync

## 4️⃣ Anti-Placeholders

- [ ] Ningún mensaje contiene `: -` como valor
- [ ] Ningún mensaje contiene `: null` o `: undefined`
- [ ] Si falta dato, muestra `N/D (motivo: ...)`
- [ ] Schemas Zod validan todos los contextos antes de enviar

## 5️⃣ Deduplicación

- [ ] `positions_update` no se envía más de 1x cada 5min (mismo contenido)
- [ ] `heartbeat` no se envía más de 1x cada 6h
- [ ] Rate limit: máx 20 mensajes de error/hora
- [ ] Hash de contenido detecta mensajes idénticos

## 6️⃣ Comandos Telegram

- [ ] `/refresh_commands` existe y funciona (admin)
- [ ] `setMyCommands()` se ejecuta al iniciar el bot
- [ ] `/ayuda` genera lista dinámicamente desde `TELEGRAM_COMMANDS`
- [ ] `/help` coincide 1:1 con comandos activos en el menú
- [ ] Nuevos comandos: `/posiciones`, `/ganancias`, `/refresh_commands`

## 7️⃣ Tests

- [ ] `npm test -- server/services/telegram/templates.test.ts` pasa
- [ ] Snapshots generados para: DailyReport (full, empty, pending), TradeBuy, TradeSell
- [ ] Tests anti-placeholder validan todos los templates
- [ ] Tests de helpers (escapeHtml, formatDuration, formatAge)

---

## 📋 Verificación Manual

### Reporte Diario - Caso Completo
```
Verificar que muestra:
✅ Conexiones: Kraken, RevolutX, DB, Telegram
✅ Sistema: CPU, Mem (con warning si >90%), Disco, Uptime
✅ Bot: Entorno, DRY_RUN, Modo, Estrategia, Pares
✅ Portfolio: Count, Exposición, lista de posiciones con exchange
✅ Órdenes pendientes: Count, última orden si hay
✅ Sincronización: lastSync por exchange con edad
```

### Reporte Diario - Sin Posiciones con Órdenes Pendientes
```
Verificar que muestra:
✅ Posiciones: 0 | Exposición: $0.00
✅ Órdenes pendientes: 2 pendientes (RevolutX) | Última: BUY XRP | ID: 177b...
(NO debe mostrar "Sin órdenes pendientes" si hay pending)
```

### Trade Buy
```
Verificar campos:
✅ Exchange explícito
✅ Par, Precio, Cantidad, Total
✅ Indicadores (si disponibles)
✅ Régimen + razón
✅ Modo (SMART_GUARD)
✅ OrderID, LotID
✅ Timestamp
```

### Trade Sell
```
Verificar campos:
✅ Exchange explícito
✅ PnL con signo (+/-) y emoji (📈/📉)
✅ Fee
✅ Tipo de salida (SL/TP/TRAILING/etc)
✅ Duración posición
✅ OrderID, LotID
```

---

## 🔧 Comandos de Verificación

```bash
# Compilación
npx tsc --noEmit --skipLibCheck

# Tests
npm test -- server/services/telegram/templates.test.ts

# Verificar imports
grep -r "from './telegram'" server/services/telegram.ts

# Verificar branding
grep -r "CHESTER BOT" server/services/telegram/
```

---

## 📁 Archivos del PR

### Creados
- `server/services/telegram/types.ts`
- `server/services/telegram/templates.ts`
- `server/services/telegram/deduplication.ts`
- `server/services/telegram/index.ts`
- `server/services/telegram/templates.test.ts`

### Modificados
- `server/services/telegram.ts`
- `BITACORA.md`
- `CORRECCIONES_Y_ACTUALIZACIONES.md`

---

**Aprobación:**

- [ ] QA: Verificación manual completada
- [ ] Dev: Code review aprobado
- [ ] Deploy: Staging probado
- [ ] User: Acepta cambios

Firma: ___________________ Fecha: _______________
