# 🔍 VERIFICACIÓN COMPLETA DE ALERTAS TELEGRAM

> Checklist para verificar que todas las alertas estén activadas y funcionales.

---

## ✅ PASO 1: VERIFICAR CONFIGURACIÓN DE CHATS

### Comando para verificar estado actual
```bash
curl -X GET http://localhost:3000/api/telegram/chats
```

### Campos a verificar en cada chat:
- ✅ `isActive: true` - Chat activo
- ✅ `alertTrades: true` - Recibe trades
- ✅ `alertSystem: true` - Recibe eventos sistema
- ✅ `alertErrors: true` - Recibe errores
- ✅ `alertHeartbeat: true` - Recibe heartbeats
- ⬜ `alertBalance: true/false` - (opcional, no usado actualmente)

---

## ✅ PASO 2: VERIFICAR ALERTAS PROGRAMADAS

### Heartbeat (cada 12 horas)
```bash
# Verificar que el intervalo está activo
grep -A 5 "startHeartbeat" server/services/telegram.ts

# Verificar logs de heartbeat
docker logs krakenbot-staging | grep "Heartbeat iniciado"
```

### Reporte Diario (14:00 Europe/Madrid)
```bash
# Verificar configuración cron
grep -A 3 "startDailyReport" server/services/telegram.ts

# Verificar que está programado
grep "0 14 \* \* \*" server/services/telegram.ts
```

---

## ✅ PASO 3: PROBAR ALERTAS MANUALMENTE

### 1. Alerta de Sistema (Bot Status)
```bash
curl -X POST http://localhost:3000/api/telegram/message \
  -H "Content-Type: application/json" \
  -d '{"message": "🧪 TEST ALERTA DE SISTEMA - Verificación manual"}'
```

### 2. Alerta de Trading
```bash
curl -X POST http://localhost:3000/api/trades \
  -H "Content-Type: application/json" \
  -d '{
    "type": "buy",
    "pair": "BTC/USD",
    "amount": "0.001",
    "price": "50000"
  }'
```

### 3. Alerta de Error
```bash
curl -X POST http://localhost:3000/api/telegram/alert \
  -H "Content-Type: application/json" \
  -d '{
    "title": "🧪 TEST ERROR",
    "description": "Error de prueba para verificar alertas"
  }'
```

---

## ✅ PASO 4: VERIFICAR TIPOS DE ALERTA EN CÓDIGO

### AlertTypes válidos en `shouldSendToChat()`:
```typescript
case "trades":     return chat.alertTrades;      // ✅ Compras/Ventas
case "errors":     return chat.alertErrors;      // ✅ Errores críticos
case "system":     return chat.alertSystem;      // ✅ Eventos sistema
case "balance":    return chat.alertBalance;     // ⬜ Balance (no usado)
case "heartbeat":  return chat.alertHeartbeat;   // ✅ Heartbeat
case "strategy":   return true;                  // ✅ Siempre activo
```

---

## ✅ PASO 5: VERIFICAR COOLDOWNS

### Cooldowns configurables:
```typescript
notifCooldownStopUpdated: 60s
notifCooldownRegimeChange: 300s (5min)
notifCooldownHeartbeat: 3600s (1h)
notifCooldownTrades: 0 (sin límite)
notifCooldownErrors: 60s
```

### Verificar en config DB:
```sql
SELECT key, value FROM bot_config 
WHERE key LIKE 'notifCooldown%';
```

---

## ✅ PASO 6: VERIFICAR DEDUPLICACIÓN

### Configuraciones por tipo:
```typescript
// positions_update: 5min min, 2min throttle, 12/hora
// heartbeat: 6h min, 1h throttle, 2/hora
// daily_report: 12h min, 6h throttle, 2/hora
// entry_intent: 15min min, 5min throttle, 8/hora
// trade_buy/sell: 10s min, 5s throttle, 60/hora
// error: 5min min, 1min throttle, 20/hora
```

### Verificar instancia:
```bash
# En logs de inicio
grep "telegram-dedupe" docker logs krakenbot-staging
```

---

## ✅ PASO 7: VERIFICAR ALERTAS SMART GUARD

### Eventos SMART GUARD que deben llegar:
- ✅ `SG_BREAK_EVEN_ACTIVATED`
- ✅ `SG_TRAILING_ACTIVATED`
- ✅ `SG_TRAILING_STOP_UPDATED`
- ✅ `SG_SCALE_OUT_EXECUTED`

### Verificar en routes.ts:
```bash
grep -A 3 "SG_" server/routes.ts | grep "sendAlertToMultipleChats"
```

---

## ✅ PASO 8: VERIFICAR COMANDOS DE GESTIÓN

### Comandos deben estar registrados:
```bash
# En Telegram
/refresh_commands  # Admin: actualiza menú
/channels         # Ver/configurar alertas
/ayuda           # Lista comandos
/menu            # Menú interactivo
```

### Verificar setMyCommands:
```bash
grep -A 10 "TELEGRAM_COMMANDS" server/services/telegram/types.ts
```

---

## ✅ PASO 9: VERIFICAR BRANDING UNIFICADO

### Todos los mensajes deben tener:
- ✅ Header: `[NAS/PROD] 🤖 CHESTER BOT 🇪🇸`
- ✅ Exchange explícito en body
- ✅ Sin placeholders (`-`, `null`, `undefined`)

### Verificar templates:
```bash
grep -r "CHESTER BOT" server/services/telegram/templates/
```

---

## ✅ PASO 10: TEST DE INTEGRACIÓN COMPLETO

### Escenario completo de prueba:
1. **Bot Iniciado** → Alerta sistema ✅
2. **Heartbeat** → Cada 12h ✅
3. **Trade Buy** → Alerta trades ✅
4. **Trade Sell** → Alerta trades ✅
5. **Stop-Loss** → Alerta trades ✅
6. **Break-Even** → Alerta status ✅
7. **Trailing** → Alerta status ✅
8. **Error Crítico** → Alerta errors ✅
9. **Reporte Diario** → 14:00 ✅

---

## 🚨 ERRORES COMUNES Y SOLUCIONES

| Error | Causa | Solución |
|-------|-------|----------|
| No llega alerta | `isActive: false` | Activar chat con `/channels` |
| Solo llegan errores | `alertTrades: false` | Activar trades con `/channels` |
| Spam de heartbeats | Cooldown roto | Verificar `checkCooldown()` |
| Branding incorrecto | Template viejo | Reiniciar servicio |
| Deduplicación no funciona | Instancia no inicializada | Verificar `messageDeduplicator` |

---

## 📊 CHECKLIST FINAL

- [ ] Chats activos y configurados
- [ ] Heartbeat programado y funcionando
- [ ] Reporte diario programado
- [ ] Alertas trades llegan al ejecutar trade
- [ ] Alertas sistema llegan al iniciar/detener bot
- [ ] Alertas errores llegan en fallos
- [ ] SMART GUARD envía actualizaciones de stop
- [ ] Cooldowns funcionan (no spam)
- [ ] Deduplicación activa
- [ ] Branding unificado CHESTER BOT
- [ ] Comandos `/refresh_commands` funciona
- [ ] Menú de comandos actualizado

---

## 🔧 COMANDOS ÚTILES

```bash
# Ver logs de Telegram
docker logs krakenbot-staging | grep "\[telegram\]"

# Ver configuración de chats
curl -s http://localhost:3000/api/telegram/chats | jq '.'

# Forzar heartbeat manual
curl -X POST http://localhost:3000/api/telegram/heartbeat

# Ver cooldowns activos
curl -s http://localhost:3000/api/config | jq '.cooldowns'

# Reiniciar servicio Telegram
docker restart krakenbot-staging
```

---

> **Nota:** Ejecutar esta verificación después de cada deploy para asegurar que todas las alertas funcionen correctamente.
