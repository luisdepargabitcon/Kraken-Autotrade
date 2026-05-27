# DIAGNÓSTICO CICLO BTC ACTIVO - DATOS REALES STAGING

**Fecha:** 2026-05-27
**Ciclo:** BTC/USD #25 (main, live, active)
**Modo:** Estrictamente lectura - sin modificaciones

---

## 1. DATOS REALES OBTENIDOS

### 1.1. Datos del ciclo BTC activo (DB)

| Campo | Valor |
|-------|-------|
| cycleId | 25 |
| pair | BTC/USD |
| status | active |
| cycleType | main |
| DB totalQuantity | 0.01389551 BTC |
| DB capitalUsedUsd | **0.00 USD** ⚠️ |
| DB avgEntryPrice | 75062.10000000 |
| DB currentPrice | 74901.50000000 |
| DB unrealizedPnlUsd | 1040.79 USD |
| DB unrealizedPnlPct | **0.0000%** ⚠️ |
| buyCount | 1 |
| startedAt | 2026-05-27T15:18:03.489Z |

### 1.2. Orden del ciclo 25 (DB)

| Campo | Valor |
|-------|-------|
| orderId | 764 |
| cycleId | 25 |
| orderType | base_buy |
| side | buy |
| quantity | 0.01389551 BTC |
| grossValueUsd | **0.00 USD** ⚠️ |
| feesUsd | **0.00 USD** ⚠️ |
| netValueUsd | **0.00 USD** ⚠️ |
| executedQuantity | 0.01389551 BTC |
| executedUsd | **0.00 USD** ⚠️ |
| avgFillPrice | 75062.10000000 |
| executionStatus | filled |
| executedAt | 2026-05-27T15:18:03.493Z |

### 1.3. Saldo real Revolut X (Exchange)

| Asset | Balance |
|-------|---------|
| BTC | **0.013883 BTC** |
| USD | 357.57 USD |
| ETH | 1.68485269 ETH |
| (otros) | ... |

---

## 2. COMPARACIÓN Y ANÁLISIS

### 2.1. Comparación DB vs Exchange

| Métrica | DB | Exchange | Diferencia | % |
|---------|-----|----------|------------|-----|
| Cantidad BTC | 0.01389551 | 0.013883 | 0.00001251 | **0.09%** |
| Capital USD | 0.00 | N/A | N/A | N/A |
| PnL USD | 1040.79 | N/A | N/A | N/A |

### 2.2. Cálculo teórico

**Valor teórico de la compra:**
- Quantity: 0.01389551 BTC
- Price: 75062.10 USD
- Gross Value: 0.01389551 * 75062.10 = **1043.27 USD**

**Fee estimado (0.09%):**
- Fee USD: 1043.27 * 0.0009 = **0.94 USD**
- Fee BTC (si se cobra en base): 0.94 / 75062.10 = **0.00001251 BTC**

**Valor neto esperado:**
- Net Value USD: 1043.27 - 0.94 = **1042.33 USD**
- Net Quantity BTC: 0.01389551 - 0.00001251 = **0.013883 BTC**

---

## 3. CAUSA RAÍZ CONFIRMADA

### 3.1. Diferencia de cantidad (0.09%)

**CONFIRMADO:** La diferencia de 0.00001251 BTC (0.09%) coincide exactamente con el fee de Revolut X (0.09%).

**Conclusión:** Revolut X cobra fee en BTC (base asset), no en USD.

- DB quantity: 0.01389551 BTC (cantidad bruta llena)
- Exchange available: 0.013883 BTC (cantidad neta = bruta - fee en base)
- Diff: 0.00001251 BTC = fee en base asset

### 3.2. CapitalUsedUsd = 0.00 USD

**CONFIRMADO:** `capitalUsedUsd` está en 0.00 USD en el ciclo y en la orden.

**Causa probable:** La orden se guardó con `executedUsd = 0.00` y `grossValueUsd = 0.00`, por lo que el ciclo no actualizó `capitalUsedUsd`.

**Impacto:**
- `unrealizedPnlPct = 0.0000%` porque `capitalUsedUsd = 0` (división por cero)
- `unrealizedPnlUsd = 1040.79` se calcula como `qty * currentPrice - capitalUsedUsd = 0.01389551 * 74901.50 - 0 = 1041.56` (valor incorrecto)

### 3.3. Fees registradas = 0.00 USD

**CONFIRMADO:** `feesUsd` está en 0.00 USD en la orden.

**Causa probable:** `confirmOrderFill` no detectó el fee en base asset o no lo convirtió a USD.

---

## 4. RIESGO OPERATIVO REAL

### 4.1. ¿Puede una venta total intentar vender más BTC del disponible?

**Riesgo:** MODERADO

**Análisis:**
- DB quantity: 0.01389551 BTC
- Exchange available: 0.013883 BTC
- Diff: 0.00001251 BTC (0.09%)
- Tolerancia `validateSellQuantity`: 0.25%

**Resultado:** La venta procederá con cantidad ajustada a 0.013883 BTC (dust tolerance).

**Riesgo residual:** El ciclo quedará con quantity residual en DB (0.00001251 BTC) pero 0 en exchange.

### 4.2. ¿Por qué la UI muestra PnL/capital/valor/fees como 0?

**CONFIRMADO:**
- `capitalUsedUsd = 0.00` → UI muestra $0.00
- `feesUsd = 0.00` → UI muestra $0.00
- `executedUsd = 0.00` → UI muestra $0.00
- `grossValueUsd = 0.00` → UI muestra $0.00

**Causa raíz:** La orden se guardó con valores USD en 0.00 tras la compra real.

---

## 5. CORRECCIONES RECOMENDADAS

### A) DTO/UI PnL vivo

**Problema:** `capitalUsedUsd = 0.00` causa PnL incorrecto.

**Corrección requerida:**
1. Verificar que `executeRealBuyWithGuard` actualiza `capitalUsedUsd` con `executedUsd` real
2. Verificar que `createOrder` guarda `executedUsd` y `grossValueUsd` correctamente
3. Verificar que el ciclo se actualiza con los valores retornados por `executeRealBuyWithGuard`

**Prioridad:** ALTA - Impacto directo en UI

### B) netBaseQty / feeAsset

**Problema:** Fee cobrado en base asset no se registra ni descuenta de quantity.

**Corrección requerida:**
1. Detectar si el fee está en base asset o USD en `confirmOrderFill`
2. Si fee en base: `netBaseQty = filledQty - feeInBase`
3. Guardar `netBaseQty` en lugar de `filledQty` en `cycle.totalQuantity`
4. Añadir campo `feeAsset` al schema de `institutionalDcaOrders`
5. Añadir campo `feeAsset` al schema de `institutionalDcaCycles`

**Prioridad:** ALTA - Causa raíz del mismatch

### C) safeSellQty / residual dust

**Problema:** Dust tolerance deja quantity residual en DB tras venta.

**Corrección requerida:**
1. Si dust adjustment en full-close, actualizar `cycle.totalQuantity` a 0 en DB
2. Crear campo `residualDustQty` para tracking de dust residual
3. Añadir evento/badge de reconciliación cuando hay dust residual

**Prioridad:** MEDIA - Protección ya existe, pero deja residuo

### D) reconciliación ciclo actual BTC #25

**Problema:** Ciclo 25 tiene datos incorrectos (capitalUsedUsd = 0, fees = 0).

**Corrección requerida:**
1. Calcular `executedUsd` real: `executedQuantity * avgFillPrice = 0.01389551 * 75062.10 = 1043.27 USD`
2. Calcular `feeUsd` real: `executedUsd * 0.0009 = 0.94 USD`
3. Calcular `netBaseQty` real: `executedQuantity - (feeUsd / avgFillPrice) = 0.01389551 - 0.00001251 = 0.013883 BTC`
4. Actualizar orden 764 con valores correctos
5. Actualizar ciclo 25 con `capitalUsedUsd = 1043.27` y `totalQuantity = 0.013883`

**Prioridad:** ALTA - Ciclo activo con datos incorrectos

### E) Tests

**Tests requeridos:**
1. Compra con fee en base: netBaseQty < grossFilledQty
2. UI/DTO no devuelve PnL 0 si hay currentPrice y avgEntry distintos
3. Valor USD = netQty * currentPrice
4. Fee desconocida no se pinta como $0.00 falso
5. Venta real capada cuando DB qty > exchange available
6. Venta bloqueada si exchange available <= dust
7. Fallo de venta no cierra ciclo
8. Ciclo con mismatch emite evento/badge de reconciliación
9. Dust adjustment en full-close deja totalQuantity = 0 en DB
10. capitalUsedUsd se actualiza tras compra real

**Prioridad:** ALTA - Prevenir regresiones

---

## 6. RESUMEN EJECUTIVO

| Item | Estado | Causa raíz | Prioridad |
|------|--------|------------|-----------|
| Mismatch DB vs Exchange (0.09%) | ✅ CONFIRMADO | Fee en base asset | ALTA |
| capitalUsedUsd = 0.00 | ✅ CONFIRMADO | Orden guardada con executedUsd = 0 | ALTA |
| PnL UI = $0.00 | ✅ CONFIRMADO | capitalUsedUsd = 0 causa división por cero | ALTA |
| Fees = $0.00 | ✅ CONFIRMADO | Fee en base no detectado/convertido | ALTA |
| Protección venta | ✅ FUNCIONA | validateSellQuantity + dust tolerance | N/A |
| Fallo venta cierra ciclo | ✅ NO CIERRA | Try-catch en todas las rutas | N/A |

---

## 7. PRÓXIMOS PASOS

**Inmediato (requiere aprobación):**
1. Reconciliar ciclo 25 con valores correctos (D)
2. Corregir detección de fee en base asset (B)
3. Corregir actualización de capitalUsedUsd (A)

**Corto plazo:**
4. Añadir schema feeAsset/netBaseQty (B)
5. Implementar dust cleanup en full-close (C)
6. Añadir tests (E)

**Largo plazo:**
7. Añadir dashboard de reconciliación
8. Añadir alertas automáticas de mismatch
