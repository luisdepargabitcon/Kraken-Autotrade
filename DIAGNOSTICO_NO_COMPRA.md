# 📊 Diagnóstico Bot Trading - Por qué no compra

**Fecha:** 14 Enero 2025  
**Commit fix:** `b95cfe0` - fix: corregir crashes críticos en tradingEngine  
**Estado:** ✅ Crashes corregidos | ✅ Diagnóstico completado

---

## 🎯 Resumen Ejecutivo

El bot **NO compra** principalmente por **filtros de entrada demasiado restrictivos**, NO por bugs de código. Los crashes corregidos (`pnl` undefined y `cooldownSec`) no bloqueaban compras, solo causaban errores al vender.

### Configuración actual (RevolutX)
- **Balance total:** $1,624.14
- **Balance disponible trading:** ~$1,199
- **Exposición actual:** BTC $702 + ETH $444 + TRX $419 = **$1,565**
- **Límite exposición (60%):** $1,199 × 0.6 = **$719**
- **Margen disponible:** ~$0 (exposición al límite)

---

## 📈 Ranking TRADE_SKIPPED (Top 10 razones - 879 eventos analizados)

| # | Razón | Eventos | % | Explicación |
|---|-------|---------|---|-------------|
| **1** | `SMART_GUARD_INSUFFICIENT_SIGNALS` | **208** | 24% | Señales técnicas insuficientes (requiere ≥5, mercado genera <5) |
| **2** | `VOLUME_BELOW_MINIMUM` | **185** | 21% | Volumen calculado < $20 (mínimo absoluto) o < $100 (sgMinEntryUsd) |
| **3** | `SMART_GUARD_SIGNAL_SELL_BLOCKED` | **141** | 16% | Señales de venta activas bloquean nuevas compras |
| **4** | `DUST_POSITION` | **102** | 12% | Posición abierta demasiado pequeña para vender |
| **5** | `SINGLE_MODE_POSITION_EXISTS` | **72** | 8% | Ya existe posición en modo SINGLE |
| **6** | `SMART_GUARD_MAX_LOTS_REACHED` | **45** | 5% | Máximo de lotes SMART_GUARD alcanzado |
| **7** | `EXPOSURE_ZERO` | **36** | 4% | Sin exposición disponible (límite alcanzado) |
| **8** | `NO_POSITION` | **33** | 4% | Intento de venta sin posición abierta |
| **9** | `REGIME_TRANSITION_PAUSE` | **31** | 4% | Régimen TRANSITION pausó operaciones |
| **10** | `SMART_GUARD_POSITION_EXISTS` | **26** | 3% | Ya existe posición SMART_GUARD |

**Total analizado:** 879 eventos | **Top 2 causas:** 393 eventos (45%)

---

## 🔍 Causa Raíz

### Problema principal: Exposición al límite
Con balance $1,199 y `maxTotalExposurePct = 60%`:
- **Límite:** $719
- **Exposición actual:** $1,565 (BTC+ETH+TRX)
- **Margen disponible:** ~$0

**Resultado:** 36 eventos `EXPOSURE_ZERO` + imposibilidad de nuevas compras aunque haya señales.

### Problema secundario: Señales insuficientes
El bot requiere **≥5 señales técnicas** (minSignals) pero el mercado actual genera menos. Esto explica los **208 eventos** de `SMART_GUARD_INSUFFICIENT_SIGNALS`.

---

## ✅ Fixes Aplicados (Commit b95cfe0)

### Fix A: Crash `pnl is not defined`
**Ubicación:** `server/services/tradingEngine.ts:2666`  
**Problema:** Variable `pnl` usada en alerta Telegram sin definir previamente.  
**Solución:** Calcular P&L neto antes de usarlo:
```typescript
const sellValueGross = sellAmount * currentPrice;
const sellFeeEstimated = sellValueGross * (getTakerFeePct() / 100);
const entryValueGross = sellAmount * position.entryPrice;
const entryFeeProrated = (position.entryFee || 0) * (sellAmount / position.amount);
const pnl = sellValueGross - sellFeeEstimated - entryValueGross - entryFeeProrated;
```

### Fix B: Crash `cooldownSec` undefined
**Ubicación:** `server/services/tradingEngine.ts:6686, 6744`  
**Problema:** Comparación `cooldownSec > 0` falla si `cooldownSec` es `undefined`.  
**Solución:** Guard explícito:
```typescript
cooldownSec: cooldownSec !== undefined && cooldownSec > 0 ? cooldownSec : undefined
```

### Otros fixes de tipado
- `parseFloat(String(...))` para union `number | "0"`
- Ampliar tipos `sellContext` y `executionMeta`
- Completar payload `upsertTradeFill` con `orderId`, `cost`, `executedAt`
- Añadir Vitest + smoke test
- Configurar `tsconfig.json` target ES2020

**Verificación:**
- ✅ `npm ci`
- ✅ `npm run check`
- ✅ `npm run test`

---

## 🎯 Recomendaciones (sin tocar código)

### Opción 1: Aumentar límite de exposición (RECOMENDADO)
**Cambio:** `maxTotalExposurePct: 60% → 80%`  
**Efecto:** Límite pasa de $719 a $959 (+$240 margen)  
**Riesgo:** Bajo (sigue siendo conservador)  
**Cómo:** Ajustar en configuración del bot (UI o DB)

### Opción 2: Reducir mínimo de entrada
**Cambio:**
- `sgMinEntryUsd: $100 → $80`
- `sgAllowUnderMin: false → true`

**Efecto:** Permite compras entre $20-$80 cuando balance es limitado  
**Riesgo:** Medio (órdenes más pequeñas, más comisiones proporcionales)

### Opción 3: Relajar filtro de señales
**Cambio:** `minSignals: 5 → 4` (en preset de régimen activo)  
**Efecto:** Reduce bloqueos por `INSUFFICIENT_SIGNALS`  
**Riesgo:** Medio (más entradas, potencialmente menor calidad)

### Opción 4: Cerrar posiciones no rentables
**Acción manual:** Vender parcialmente BTC/ETH/TRX para liberar exposición  
**Efecto inmediato:** Margen disponible para nuevas compras  
**Riesgo:** Depende del P&L actual de cada posición

---

## 📦 Archivos Modificados

1. **`server/services/tradingEngine.ts`**
   - Definición `pnl` antes de Telegram alert (línea 2655-2660)
   - Guard `cooldownSec` (líneas 6693, 6744)
   - Tipos ampliados `sellContext`, `executionMeta` (líneas 5658-5659)
   - Payload completo `upsertTradeFill` (líneas 6155-6166)
   - Coerción `String()` en parseFloat (líneas 1671, 1889, 2265)

2. **`server/services/telegram.ts`**
   - Tipo `dailyReportJob` corregido
   - Uso de `trade.realizedPnlUsd` en lugar de `trade.pnl`

3. **`server/services/botLogger.ts`**
   - Ampliado `EventType` con eventos usados por tradingEngine

4. **`tsconfig.json`**
   - `target: "ES2020"` para iteradores Map/Set

5. **`package.json`**
   - Script `"test": "vitest run"`

6. **`vitest.config.ts`** (nuevo)
7. **`server/smoke.test.ts`** (nuevo)

---

## 🚀 Próximos Pasos

### En VPS (despliegue)
```bash
cd /opt/krakenbot-staging
git pull origin main
docker compose down
docker compose up -d --build
docker logs -f krakenbot-staging-app
```

### Ajuste de configuración (UI o DB)
1. Aumentar `maxTotalExposurePct` de 60% a 80%
2. (Opcional) Reducir `sgMinEntryUsd` de $100 a $80
3. (Opcional) Activar `sgAllowUnderMin: true`
4. (Opcional) Reducir `minSignals` de 5 a 4 en preset activo

### Monitoreo post-despliegue
- Verificar logs: `docker logs krakenbot-staging-app | grep -i "error\|crash"`
- Revisar dashboard: comprobar que no hay crashes en ventas
- Observar nuevas compras si se ajustó exposición/señales

---

## 📝 Notas Finales

- **Sin cambios de estrategia:** Solo fixes de crashes y tipado
- **Lógica de trading intacta:** Todos los filtros y umbrales permanecen igual
- **Diagnóstico basado en evidencia:** 879 eventos `TRADE_SKIPPED` analizados desde DB real
- **Rollback seguro:** `git revert b95cfe0` si hay problemas (poco probable)

**Conclusión:** El bot funciona correctamente, pero está **bloqueado por exposición al límite** y **señales insuficientes**. Ajustar configuración (no código) para aumentar frecuencia de compras.
