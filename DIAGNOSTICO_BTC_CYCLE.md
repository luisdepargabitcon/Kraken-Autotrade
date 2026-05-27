# DIAGNÓSTICO CICLO BTC ACTIVO - SOLO LECTURA

**Fecha:** 2026-05-27
**Objetivo:** Auditar discrepancia entre DB quantity y exchange balance para ciclo BTC activo en staging
**Modo:** Estrictamente lectura - sin modificaciones

---

## 1. RUTA DE VENTA - AUDITORÍA DE CÓDIGO

### 1.1. Función `executeRealSell` (IdcaEngine.ts:4859-4898)

**Ubicación:** `server/services/institutionalDca/IdcaEngine.ts`

**Flujo:**
1. Llama a `liveGuard.validateSellQuantity(pair, quantity, cycleQty)`
2. Si validación falla → lanza error, crea evento `cycle_exchange_qty_mismatch`, NO cierra ciclo
3. Si validación pasa → llama a `exchange.placeOrder()`
4. Si `placeOrder` falla → lanza error, NO cierra ciclo

**Protección:** ✅ SÍ consulta saldo real antes de vender

### 1.2. Función `validateSellQuantity` (IdcaLiveExecutionGuard.ts:348-376)

**Ubicación:** `server/services/institutionalDca/IdcaLiveExecutionGuard.ts`

**Flujo:**
1. Llama a `getAvailableBaseQty(pair)` para obtener saldo real del exchange
2. Compara `cycleQty` vs `availableQty` con tolerancia 0.25%
3. Si `cycleQty > availableQty * 1.0025` → retorna `valid: false` con motivo `cycle_exchange_qty_mismatch`
4. Si `requestedQty > availableQty * 1.0025` → retorna `valid: false` con motivo `insufficient_base_balance`

**Protección:** ✅ SÍ detecta mismatch entre DB y exchange

### 1.3. Función `getAvailableBaseQty` (IdcaLiveExecutionGuard.ts:103-124)

**Ubicación:** `server/services/institutionalDca/IdcaLiveExecutionGuard.ts`

**Flujo:**
1. Obtiene `exchange.getBalance()`
2. Extrae asset base del pair (BTC/USD → BTC)
3. Retorna `balance[asset].available` o `balance[asset].free`

**Protección:** ✅ Consulta saldo real del exchange

### 1.4. Función `verifyBalance` (IdcaExitExecutor.ts:68-112)

**Ubicación:** `server/services/institutionalDca/IdcaExitExecutor.ts`

**Flujo:**
1. Usada por `executeExitInstruction` (cierres manuales programados)
2. Llama a `exchange.getBalance()`
3. Aplica tolerancia 0.25% para full-close (dust tolerance)
4. Para partial-close: NO aplica tolerancia, lanza error si available < requested
5. Si diff > tolerance → lanza error `insufficient_exchange_balance`

**Protección:** ✅ SÍ consulta saldo real, ✅ SÍ aplica dust tolerance para full-close

### 1.5. Función `computeLiveSellQtyWithDustTolerance` (IdcaEngine.ts:81-100)

**Ubicación:** `server/services/institutionalDca/IdcaEngine.ts`

**Flujo:**
1. Usada por `executeExit`, `executeTrailingExit`, `executeBreakevenExit`
2. Tolerancia: `max(0.00000002, requestedQty * 0.0025)` (0.25% relativo)
3. Solo ajusta si `isFullClose=true`
4. Para partial-close: NUNCA ajusta, lanza error

**Protección:** ✅ SÍ aplica dust tolerance, ✅ SÍ protege partial-close

---

## 2. TIPOS DE VENTA Y PROTECCIÓN

| Tipo de venta | Función principal | Consulta saldo real | Dust tolerance | Bloquea si mismatch |
|--------------|-------------------|-------------------|----------------|-------------------|
| `executeRealSell` (general) | `executeRealSell` | ✅ `validateSellQuantity` | ✅ 0.25% | ✅ SÍ |
| Trailing exit | `executeTrailingExit` | ✅ `computeLiveSellQtyWithDustTolerance` | ✅ 0.25% | ✅ SÍ |
| Breakeven exit | `executeBreakevenExit` | ✅ `computeLiveSellQtyWithDustTolerance` | ✅ 0.25% | ✅ SÍ |
| Take-profit partial | `armTakeProfit` → `executeRealSell` | ✅ `validateSellQuantity` | ✅ 0.25% | ✅ SÍ |
| Emergency close | `emergencyCloseAll` → `executeRealSell` | ✅ `validateSellQuantity` | ✅ 0.25% | ✅ SÍ |
| Manual exit instruction | `executeExitInstruction` | ✅ `verifyBalance` | ✅ 0.25% (full) / ❌ (partial) | ✅ SÍ |

**Conclusión:** ✅ TODOS los tipos de venta tienen protección de saldo real

---

## 3. ¿PUEDE UN FALLO DE VENTA CERRAR INDEBIDAMENTE EL CICLO?

### 3.1. `executeRealSell` (IdcaEngine.ts:4859-4898)

**Si falla validación de saldo:**
- Lanza error
- Crea evento `cycle_exchange_qty_mismatch`
- **NO cierra ciclo** ✅

**Si falla `placeOrder`:**
- Lanza error
- **NO cierra ciclo** ✅

### 3.2. `executeTrailingExit` (IdcaEngine.ts:3087-3178)

**Si falla validación de saldo:**
- Lanza error
- Crea evento `critical_error`
- Envía Telegram alert
- **NO cierra ciclo** ✅

**Si falla `executeRealSell`:**
- Lanza error
- Crea evento `critical_error`
- Envía Telegram alert
- **NO cierra ciclo** ✅

### 3.3. `executeBreakevenExit` (IdcaEngine.ts:3268-3353)

**Si falla validación de saldo:**
- Lanza error
- Crea evento `critical_error`
- Envía Telegram alert
- **NO cierra ciclo** ✅

**Si falla `executeRealSell`:**
- Lanza error
- Crea evento `critical_error`
- Envía Telegram alert
- **NO cierra ciclo** ✅

### 3.4. `executeExitInstruction` (IdcaExitExecutor.ts:295-441)

**Si falla `verifyBalance`:**
- Lanza error
- Marca instrucción como `failed` o `failed_requires_review`
- **NO cierra ciclo** ✅

**Si falla `executeLiveSell`:**
- Lanza error
- Marca instrucción como `failed_requires_review` (si es live incierta)
- **NO cierra ciclo** ✅

**Conclusión:** ✅ NINGÚN fallo de venta cierra indebidamente el ciclo en DB

---

## 4. ACTUALIZACIÓN DE PnL EN EL ENGINE

### 4.1. Función `evaluatePair` (IdcaEngine.ts:1068-1086)

**Ubicación:** `server/services/institutionalDca/IdcaEngine.ts`

**Flujo:**
```typescript
const allPairCycles = await repo.getAllActiveCyclesForPair(pair, mode);
for (const c of allPairCycles) {
  const avg = parseFloat(String(c.avgEntryPrice || "0"));
  const qty = parseFloat(String(c.totalQuantity || "0"));
  const cap = parseFloat(String(c.capitalUsedUsd || "0"));
  if (avg <= 0 || qty <= 0) continue;
  const mv = qty * currentPrice;
  const pnlUsd = mv - cap;
  const pnlPct = cap > 0 ? (pnlUsd / cap) * 100 : 0;
  const dd = pnlPct < 0 ? Math.abs(pnlPct) : 0;
  const prevDD = parseFloat(String(c.maxDrawdownPct || "0"));
  await repo.updateCycle(c.id, {
    currentPrice: currentPrice.toFixed(8),
    unrealizedPnlUsd: pnlUsd.toFixed(2),
    unrealizedPnlPct: pnlPct.toFixed(4),
    maxDrawdownPct: Math.max(dd, prevDD).toFixed(2),
  });
}
```

**Posibles causas de PnL $0.00 en UI:**
- `currentPrice` es 0 o null (engine no actualiza precio)
- `avgEntryPrice` es 0 o null
- `totalQuantity` es 0
- `capitalUsedUsd` es 0
- El frontend no está refrescando (hook `useIdcaActiveCycles` tiene `refetchInterval: 10000`)

---

## 5. CANTIDAD TRAS COMPRA REAL - AUDITORÍA

### 5.1. Flujo de compra real

**Ubicación:** `server/services/institutionalDca/IdcaEngine.ts`

**Funciones:**
- `executeRealBuyWithGuard` (líneas 4595-4729)
- `confirmOrderFill` (IdcaLiveExecutionGuard.ts:253-343)

**Datos retornados por `confirmOrderFill`:**
- `filledQty` - cantidad bruta llena
- `filledUsd` - valor USD ejecutado
- `avgFillPrice` - precio medio
- `feeUsd` - fee (en USD o base asset?)

### 5.2. PROBLEMA CRÍTICO IDENTIFICADO

**`confirmOrderFill` (IdcaLiveExecutionGuard.ts:289):**
```typescript
const feeUsd = parseFloat(String(orderData.fee ?? 0));
```

**Issue:** NO especifica el asset del fee. Revolut X puede cobrar fee en BTC (base asset) o USD (quote asset).

**`getOrder` de RevolutXService (líneas 898-908):**
- NO retorna fee
- Solo retorna `filledSize`, `executedValue`, `averagePrice`

**`getFills` de RevolutXService (línea 989):**
- Retorna `fee` pero sin especificar el asset
- El fee podría estar en BTC o USD

### 5.3. Diferencia ciclo vs Revolut

**Usuario reportó:**
- Bot DB: 0.013896 BTC
- Revolut: 0.013883 BTC
- Diferencia: 0.000013 BTC (~0.09%)

**Interpretación:** Esta diferencia (0.09%) coincide exactamente con el fee de Revolut X (0.09%). Esto sugiere que:
- Revolut cobró fee en BTC (base asset)
- El bot está guardando la cantidad bruta sin descontar el fee en base asset
- `cycle.totalQuantity` = cantidad bruta llena (incluye fee)
- Exchange available = cantidad neta (bruta - fee en base)

---

## 6. INSTRUCCIONES PARA EJECUTAR DIAGNÓSTICO EN STAGING

### 6.1. Ejecutar script SQL en VPS

```bash
# SSH a VPS staging
ssh user@5.250.184.18

# Ejecutar script SQL
docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -f /path/to/diagnostic_btc_cycle.sql
```

### 6.2. Datos requeridos del script SQL

El script `diagnostic_btc_cycle.sql` generará:

1. **Datos del ciclo BTC activo:**
   - cycleId, pair, status, cycleType
   - DB totalQuantity, capitalUsedUsd, avgEntryPrice
   - DB currentPrice, unrealizedPnlUsd, unrealizedPnlPct

2. **Órdenes BUY:**
   - Cantidad bruta total
   - Valor USD total
   - Fees registradas

3. **Órdenes SELL:**
   - Cantidad vendida total
   - Valor USD total
   - Fees registradas

4. **Cantidad neta estimada:**
   - buyQty - sellQty

5. **Comparación DB vs Órdenes:**
   - Diferencia entre cycle.totalQuantity y (buyQty - sellQty)

6. **Eventos recientes:**
   - Últimos 20 eventos del ciclo

### 6.3. Obtener saldo real del exchange

**Opción A: Via API endpoint existente (si hay)**
```bash
curl http://5.250.184.18:3020/api/balance
```

**Opción B: Via logs del engine**
```bash
docker compose -f docker-compose.staging.yml logs -f --tail=100 | grep -i "SELL_CHECK\|balance"
```

**Opción C: Manual en Revolut X**
- Login a Revolut X
- Verificar saldo BTC disponible

---

## 7. ANÁLISIS DE RIESGO OPERATIVO

### 7.1. ¿Puede una venta total intentar vender más BTC del disponible?

**Respuesta:** ❌ NO

**Razón:**
- `validateSellQuantity` compara `cycleQty` vs `availableQty` con tolerancia 0.25%
- Si `cycleQty > availableQty * 1.0025` → bloquea venta
- Si `requestedQty > availableQty * 1.0025` → bloquea venta

**Sin embargo:** Si el mismatch es < 0.25%, la venta podría proceder con cantidad ajustada (dust tolerance).

### 7.2. ¿Qué pasa si el mismatch es < 0.25%?

**Respuesta:** La venta procede con cantidad ajustada a `availableQty`.

**Ejemplo:**
- DB cycleQty: 0.013896 BTC
- Exchange available: 0.013883 BTC
- Diff: 0.000013 BTC (0.09%)
- Tolerancia: 0.25%
- Resultado: ✅ Venta procede con 0.013883 BTC (ajustado por dust)

**Riesgo:** El ciclo queda con quantity residual en DB (0.000013 BTC) pero 0 en exchange.

---

## 8. RECOMENDACIONES (PENDIENTE APROBACIÓN)

### 8.1. Corrección de DTO/UI PnL vivo

**Acción requerida:**
- Verificar que `evaluatePair` se ejecuta cada tick
- Verificar que `currentPrice` se actualiza correctamente
- Verificar que el frontend refresca cada 10s

### 8.2. Corrección de cantidad neta post-fee

**Acción requerida:**
- Detectar si el fee está en base asset o USD
- Si fee en base: `netBaseQty = filledQty - feeInBase`
- Guardar `netBaseQty` en lugar de `filledQty` en `cycle.totalQuantity`
- Añadir campo `feeAsset` al schema de órdenes

### 8.3. Protección universal `safeSellQty`

**Estado:** ✅ YA IMPLEMENTADA

**Verificación:**
- `validateSellQuantity` se usa en `executeRealSell`
- `verifyBalance` se usa en `executeExitInstruction`
- `computeLiveSellQtyWithDustTolerance` se usa en trailing/breakeven

### 8.4. Migración/schema para `feeAsset` / `netBaseQty`

**Acción requerida:**
- Añadir `feeAsset` a `institutionalDcaOrders`
- Añadir `netBaseQty` a `institutionalDcaOrders`
- Añadir `feeAsset` a `institutionalDcaCycles` (para tracking histórico)
- Migración para actualizar registros existentes

### 8.5. Tests nuevos

**Tests requeridos:**
1. Compra con fee en base: netBaseQty < grossFilledQty
2. UI/DTO no devuelve PnL 0 si hay currentPrice y avgEntry distintos
3. Valor USD = netQty * currentPrice
4. Fee desconocida no se pinta como $0.00 falso
5. Venta real capada cuando DB qty > exchange available
6. Venta bloqueada si exchange available <= dust
7. Fallo de venta no cierra ciclo
8. Ciclo con mismatch emite evento/badge de reconciliación

---

## 9. PRÓXIMOS PASOS

1. **Ejecutar script SQL en staging** para obtener datos reales del ciclo BTC
2. **Obtener saldo real del exchange** (Revolut X o API)
3. **Comparar datos** y calcular diferencias
4. **Determinar causa raíz** (fee en base, redondeo, orden histórica)
5. **Aprobar correcciones** basadas en diagnóstico

---

## 10. SCRIPT SQL PARA EJECUTAR

El script `diagnostic_btc_cycle.sql` está en:
`c:\Users\JSLUI\Qsync\BOT_NAS\BOT_AUTOTRADE\diagnostic_btc_cycle.sql`

Para ejecutar en VPS:
```bash
docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -f diagnostic_btc_cycle.sql
```
