# AUDITORÍA TÉCNICA: Referencia de Entrada IDCA
**Fecha:** 2026-05-03
**Objetivo:** Entender cómo se calcula y actualiza la referencia de entrada IDCA, identificar bugs/riesgos y proponer mejoras.

---

## A) RESUMEN EJECUTIVO

### ¿Qué referencia se usa realmente para comprar/bloquear?

**La referencia efectiva de entrada es `effectiveBasePrice`, que se calcula así:**

1. **Si VWAP Anchor está activo y fiable** (`assetConfig.vwapEnabled = true`):
   - `effectiveBasePrice = frozenAnchor.anchorPrice` (VWAP Anchor guardado en memoria)
   - `basePriceMethod = "vwap_anchor"`

2. **Si VWAP Anchor NO está disponible o no es fiable**:
   - `effectiveBasePrice = basePriceResult.price` (Hybrid V2.1)
   - `basePriceMethod = "hybrid_v2_fallback"`

**Esta referencia se usa para:**
- Calcular `entryDipPct`: `(effectiveBasePrice - currentPrice) / effectiveBasePrice * 100`
- Calcular `buyTriggerPrice`: `effectiveBasePrice * (1 - minDipPct/100)`
- Decidir bloqueo `insufficient_dip`
- Mostrar en eventos de entrada bloqueada

### ¿Por qué no coincide con Contexto de mercado?

**El Contexto de mercado usa `anchorPrice` de `IdcaMarketContextService`, que es:**

- Si `frozenAnchorPrice` está disponible → usa ese
- Si VWAP es fiable → usa VWAP
- Si no → usa high de ventana extendida

**Problema detectado:** El Contexto de mercado se calcula de forma independiente y puede usar un precio diferente al que usa el engine para decidir entrada. Hay 3 fuentes distintas:

1. **Engine (real):** `effectiveBasePrice` (frozenAnchor o Hybrid V2.1)
2. **Contexto de mercado (UI):** `anchorPrice` (frozenAnchor, VWAP o window_high)
3. **Eventos:** Muestran `basePrice.price` (Hybrid V2.1) y `effectiveBasePrice` (frozenAnchor)

### ¿La referencia se está actualizando demasiado pronto?

**SÍ, detectado riesgo significativo:**

El anchor se actualiza cuando `newSwingPrice > anchorAfterReset.anchorPrice`. Esto ocurre en **cada tick** donde el nuevo swing high es mayor que el anchor actual. No hay:
- Cooldown mínimo de tiempo
- Histéresis
- Confirmación de cierre de vela
- Umbral mínimo de superación

Esto significa que si el precio sube brevemente y vuelve a bajar, el anchor puede haber subido y ya no bajar (solo sube, nunca baja), lo que puede hacer que la referencia sea demasiado alta para medir caídas reales.

---

## B) TABLA DE CAMPOS

| Campo | Origen | Uso | Persistencia | Cuándo cambia |
|-------|--------|-----|--------------|---------------|
| `basePrice.price` | `smart.computeBasePrice()` (Hybrid V2.1) | Base técnica para cálculo de dips, fallback cuando VWAP no disponible | No persistido (calculado en cada tick) | Cada tick (recalculado desde OHLCV) |
| `basePrice.type` | `smart.computeBasePrice()` | Indica método: "hybrid_v2", "swing_high_1h", "window_high_p95" | No persistido | Cada tick |
| `basePrice.timestamp` | `smart.computeBasePrice()` | Timestamp de la vela que generó el precio | No persistido | Cada tick |
| `basePrice.meta.selectedAnchorPrice` | `smart.computeBasePrice()` (Hybrid V2.1) | Swing high seleccionado como candidato | No persistido | Cada tick (candidato puede cambiar) |
| `basePrice.meta.selectedAnchorTime` | `smart.computeBasePrice()` (Hybrid V2.1) | Timestamp del swing high seleccionado | No persistido | Cada tick |
| `effectiveBasePrice` | `IdcaEngine.performEntryCheck()` | **REFERENCIA EFECTIVA REAL** para calcular dips, buyTriggerPrice, bloqueos | No persistido (calculado en cada tick) | Cada tick (depende de frozenAnchor o basePriceResult) |
| `frozenAnchorPrice` | `vwapAnchorMemory.get(pair).anchorPrice` | Anchor VWAP guardado en memoria (prioridad para effectiveBasePrice) | **SÍ persistido** en `idca_vwapAnchors` | Cuando `newSwingPrice > anchorAfterReset.anchorPrice` (solo sube) |
| `frozenAnchorTs` | `vwapAnchorMemory.get(pair).anchorTimestamp` | Timestamp del anchor VWAP | **SÍ persistido** en `idca_vwapAnchors` | Cuando se actualiza el anchor |
| `frozenAnchorPrevious` | `vwapAnchorMemory.get(pair).previous` | Anchor anterior invalidado | **SÍ persistido** en `idca_vwapAnchors` (prevPrice, prevTs, prevSetAt) | Cuando se reemplaza el anchor |
| `basePriceMethod` | `IdcaEngine.performEntryCheck()` | Indica fuente: "vwap_anchor" o "hybrid_v2_fallback" | No persistido | Cada tick (según disponibilidad de frozenAnchor) |
| `anchorPriceUpdatedAt` | `IdcaMarketContextService` | Timestamp de última actualización de anchor en contexto | No persistido (calculado en cada llamada) | Cada llamada a getMarketContext |
| `referencePrice` (UI) | `IdcaMarketContextService.anchorPrice` | Referencia mostrada en UI de contexto de mercado | No persistido | Cada llamada a getMarketContext (puede ser diferente a effectiveBasePrice) |

---

## C) FLUJO ACTUAL PASO A PASO

### 1. Cálculo inicial de `basePriceResult`

**Archivo:** `IdcaEngine.ts` → `performEntryCheck()`
**Línea:** ~2497

```typescript
const basePriceResult = smart.computeBasePrice({
  candles,
  lookbackMinutes: config.localHighLookbackMinutes,
  method: dipRefMethod,  // "hybrid", "swing_high", "window_high"
  currentPrice,
  pair,
});
```

**Hybrid V2.1** (`IdcaSmartLayer.ts` → `computeHybridV2()`):
- Analiza velas de 24h, 48h, 72h, 7d, 30d
- Detecta pivotes (swing highs) con confirmación
- Aplica tolerancias dinámicas per-pair
- Filtra outliers usando ATR
- Cap a 30d con tolerancia per-pair
- Devuelve `basePriceResult.price` (swing high más alto válido)

### 2. Actualización de VWAP Anchor Memory

**Archivo:** `IdcaEngine.ts` → `performEntryCheck()`
**Línea:** ~2512-2600

```typescript
const anchorPriceBefore = vwapAnchorMemory.get(pair)?.anchorPrice ?? null;

if (assetConfig.vwapEnabled && basePriceResult.price > 0) {
  const newSwingPrice = basePriceResult.price;
  
  // Regla 1: resetear si precio supera la ancla
  const currentAnchor = vwapAnchorMemory.get(pair);
  if (currentAnchor && currentPrice > currentAnchor.anchorPrice) {
    vwapAnchorMemory.delete(pair);  // RESET inmediato
  }
  
  // Regla 2: ancla solo sube, nunca baja
  const anchorAfterReset = vwapAnchorMemory.get(pair);
  if (!anchorAfterReset || newSwingPrice > anchorAfterReset.anchorPrice) {
    vwapAnchorMemory.set(pair, {
      anchorPrice: newSwingPrice,
      anchorTimestamp: newSwingTs,
      setAt: Date.now(),
      drawdownPct: 0,
      previous: anchorAfterReset ? { ...anchorAfterReset, replacedAt: Date.now() } : ...
    });
  }
  
  // Persistir en DB (fire-and-forget)
  repo.upsertVwapAnchor({ ... });
}
```

**Condiciones de actualización:**
- `newSwingPrice > anchorAfterReset.anchorPrice` → actualiza anchor
- `currentPrice > currentAnchor.anchorPrice` → resetea anchor (borra)
- **No hay cooldown, no hay histéresis, no hay confirmación de vela**

### 3. Cálculo de `effectiveBasePrice`

**Archivo:** `IdcaEngine.ts` → `performEntryCheck()`
**Línea:** ~2650-2666

```typescript
const vwapAnchorAvailable = assetConfig.vwapEnabled 
  && frozenAnchor?.anchorPrice 
  && frozenAnchor.anchorPrice > 0;

let effectiveBasePrice: number;
let basePriceMethod: string;

if (vwapAnchorAvailable) {
  // VWAP Anchor es la referencia principal
  effectiveBasePrice = frozenAnchor.anchorPrice;
  basePriceMethod = "vwap_anchor";
} else {
  // Hybrid V2.1 como fallback
  effectiveBasePrice = basePriceResult.price;
  basePriceMethod = "hybrid_v2_fallback";
}
```

### 4. Cálculo de dips y decisiones

```typescript
const entryDipPct = effectiveBasePrice > 0
  ? ((effectiveBasePrice - currentPrice) / effectiveBasePrice) * 100
  : 0;

const minDip = assetConfig.vwapEnabled
  ? Math.max(atrPct * 1.5, parseFloat(String(assetConfig.minDipPct)))
  : parseFloat(String(assetConfig.minDipPct));

const buyTriggerPrice = effectiveBasePrice * (1 - minDip / 100);

// Bloqueo si dip insuficiente
if (entryDipPct < minDip) {
  blocks.push({ code: "insufficient_dip", ... });
}
```

### 5. Contexto de mercado (UI independiente)

**Archivo:** `IdcaMarketContextService.ts` → `getMarketContext()`
**Línea:** ~85-150

```typescript
async getMarketContext(pair, options = {}) {
  // Prioridad 1: frozenAnchorPrice (si está disponible)
  if (options.frozenAnchorPrice && options.frozenAnchorPrice > 0) {
    anchorPrice = options.frozenAnchorPrice;
    anchorSource = "frozen";
  } else if (vwap?.isReliable) {
    // Prioridad 2: VWAP si fiable
    anchorPrice = vwap.vwap;
    anchorSource = "vwap";
  } else {
    // Prioridad 3: high de ventana extendida
    anchorPrice = highCandle.high;
    anchorSource = "window_high";
  }
  
  return { anchorPrice, anchorSource, anchorPriceUpdatedAt, ... };
}
```

**Nota:** El contexto de mercado se calcula de forma independiente y puede no coincidir con `effectiveBasePrice` del engine.

---

## D) CONDICIONES EXACTAS DE ACTUALIZACIÓN/REEMPLAZO

### 1. Reset de anchor (borrado completo)

**Archivo:** `IdcaEngine.ts` → `performEntryCheck()`
**Línea:** ~2527-2536

**Condición:** `currentPrice > currentAnchor.anchorPrice`

**Acción:**
```typescript
vwapAnchorMemory.delete(pair);
TrailingBuyManager.disarm(pair);  // Cancela trailing buy
telegram.alertTrailingBuyCancelled(pair, mode, currentPrice, "reference_changed");
```

**Características:**
- Inmediato (sin confirmación)
- Sin umbral de superación (cualquier superación)
- Sin cooldown
- Sin histéresis

### 2. Actualización de anchor (solo sube)

**Archivo:** `IdcaEngine.ts` → `performEntryCheck()`
**Línea:** ~2542-2553

**Condición:** `newSwingPrice > anchorAfterReset.anchorPrice`

**Acción:**
```typescript
vwapAnchorMemory.set(pair, {
  anchorPrice: newSwingPrice,
  anchorTimestamp: newSwingTs,
  setAt: Date.now(),
  drawdownPct: 0,
  previous: anchorAfterReset ? { ...anchorAfterReset, replacedAt: Date.now() } : ...
});
```

**Características:**
- Inmediato (sin confirmación)
- Sin umbral de superación (cualquier aumento)
- Sin cooldown
- Solo sube, nunca baja (monótono creciente)

### 3. Persistencia en DB

**Archivo:** `IdcaEngine.ts` → `performEntryCheck()`
**Línea:** ~2590

**Acción:** `repo.upsertVwapAnchor({ ... })`

**Características:**
- Fire-and-forget (no await)
- Se ejecuta en cada actualización de anchor
- Guarda historial: prevPrice, prevTs, prevSetAt, prevReplacedAt

---

## E) PERSISTENCIA DE LA REFERENCIA

### ¿La referencia sobrevive a restart?

**SÍ, parcialmente:**

- **VWAP Anchor:** Se carga desde DB al startup (`loadAnchorsFromDb()` en línea ~525)
- **BasePrice (Hybrid V2.1):** NO persistido, se recalcula desde cero en cada tick
- **effectiveBasePrice:** NO persistido, se recalcula en cada tick

### ¿La referencia anterior queda guardada?

**SÍ, pero solo una:**

- DB guarda `prevPrice`, `prevTs`, `prevSetAt`, `prevReplacedAt`
- Memoria guarda `previous: { anchorPrice, anchorTimestamp, setAt, replacedAt }`
- **Solo hay UN registro anterior**, no hay historial completo

### ¿Solo hay frozenAnchorPrevious o hay historial completo?

**Solo frozenAnchorPrevious (un registro anterior).**

No hay historial completo de cambios de referencia.

### ¿El contexto de mercado usa memoria in-memory?

**SÍ:**

- `IdcaMarketContextService` tiene cache con TTL
- `vwapAnchorMemory` es un Map in-memory
- Al deploy, se recarga desde DB
- Durante ejecución, usa memoria in-memory

### ¿El evento usa payload calculado en tick y el Resumen usa otro cálculo?

**SÍ, detectado:**

- **Eventos:** Muestran `basePrice.price` (Hybrid V2.1) y `effectiveBasePrice` (frozenAnchor)
- **Resumen (UI):** Usa `anchorPrice` de `IdcaMarketContextService` (puede ser frozenAnchor, VWAP o window_high)
- **Estas tres fuentes pueden ser diferentes en el mismo tick**

---

## F) RIESGOS DETECTADOS

### 1. ❌ Contexto de mercado usando `anchorPrice` en vez de `effectiveBasePrice`

**Severidad:** ALTA

**Descripción:** La UI de contexto de mercado muestra `anchorPrice` de `IdcaMarketContextService`, que puede ser diferente a `effectiveBasePrice` que usa el engine para decidir entrada.

**Impacto:** El usuario ve una referencia en Resumen que no coincide con la referencia real que se usa para comprar/bloquear.

**Archivo:** `IdcaMarketContextService.ts` → `getMarketContext()`

---

### 2. ❌ Eventos usando una referencia y Resumen otra

**Severidad:** ALTA

**Descripción:** 
- Eventos muestran `basePrice.price` (Hybrid V2.1) y `effectiveBasePrice` (frozenAnchor)
- Resumen muestra `anchorPrice` (frozenAnchor, VWAP o window_high)
- Estas tres fuentes pueden ser diferentes

**Impacto:** Confusión para el usuario al ver referencias inconsistentes.

**Archivos:** `IdcaEventCards.tsx`, `IdcaMarketContextCard.tsx`

---

### 3. ❌ `frozenAnchorPrice` recalculándose demasiado pronto

**Severidad:** ALTA

**Descripción:** El anchor se actualiza cuando `newSwingPrice > anchorAfterReset.anchorPrice`. Esto ocurre en cada tick donde el nuevo swing high es mayor.

**Problemas:**
- No hay cooldown mínimo de tiempo
- No hay umbral de superación (cualquier aumento)
- No hay confirmación de cierre de vela
- Si el precio sube brevemente y vuelve a bajar, el anchor ya subió y no baja (solo sube)

**Impacto:** La referencia puede subir demasiado rápido, haciendo que las caídas parezcan menores de lo que son.

**Archivo:** `IdcaEngine.ts` → línea ~2542

---

### 4. ❌ `frozenAnchorPrevious` solo guardado en memoria y perdido tras restart

**Severidad:** MEDIA

**Descripción:** Aunque DB guarda `prevPrice`, la memoria in-memory (`vwapAnchorMemory.previous`) se pierde tras restart y se recarga solo el último anchor.

**Impacto:** Al reiniciar, se pierde la referencia anterior que estaba en memoria, aunque DB la tenga guardada.

**Archivo:** `IdcaEngine.ts` → línea ~529-540

---

### 5. ❌ Anchor VWAP reemplazando la referencia sin confirmación suficiente

**Severidad:** ALTA

**Descripción:** Cuando `newSwingPrice > anchorAfterReset.anchorPrice`, el anchor se actualiza inmediatamente sin:
- Confirmación de cierre de vela
- Umbral mínimo de superación
- Cooldown de tiempo
- Histéresis

**Impacto:** La referencia puede cambiar por movimientos temporales del precio.

**Archivo:** `IdcaEngine.ts` → línea ~2542

---

### 6. ❌ La referencia se actualiza al superar precio anterior por una diferencia mínima

**Severidad:** ALTA

**Descripción:** La condición `newSwingPrice > anchorAfterReset.anchorPrice` no tiene umbral mínimo. Cualquier diferencia positiva dispara la actualización.

**Ejemplo:** Si anchor = 50000 y newSwing = 50001 (0.002%), se actualiza.

**Impacto:** La referencia puede subir por movimientos insignificantes.

**Archivo:** `IdcaEngine.ts` → línea ~2542

---

### 7. ❌ No hay cooldown mínimo de actualización

**Severidad:** ALTA

**Descripción:** El anchor puede actualizarse múltiples veces en pocos minutos si el precio sigue haciendo nuevos swing highs.

**Impacto:** La referencia puede ser volátil en períodos de alta volatilidad.

**Archivo:** `IdcaEngine.ts` → línea ~2542

---

### 8. ❌ No hay histéresis

**Severidad:** MEDIA

**Descripción:** No hay mecanismo de histéresis para evitar cambios de referencia por movimientos temporales.

**Impacto:** La referencia es reactiva, no robusta a ruido de precio.

---

### 9. ❌ No hay persistencia DB de `basePrice` e `effectiveBasePrice`

**Severidad:** BAJA

**Descripción:** Solo `frozenAnchorPrice` se persiste. `basePrice` (Hybrid V2.1) y `effectiveBasePrice` se recalculan en cada tick.

**Impacto:** Tras restart, se pierde el histórico de referencias calculadas.

---

### 10. ❌ No hay trazabilidad visual suficiente de cambios de referencia

**Severidad:** MEDIA

**Descripción:** Solo hay `frozenAnchorPrevious` (un registro). No hay historial completo de cambios con:
- Timestamp de cada cambio
- Motivo del cambio
- Precio que causó el cambio
- Duración de cada referencia

**Impacto:** Difícil auditar por qué cambió la referencia.

---

## G) RECOMENDACIÓN PROFESIONAL

### Cómo debería ejecutarse según las últimas actualizaciones

**Estado actual:** El sistema tiene una arquitectura híbrida donde VWAP Anchor tiene prioridad, pero falta robustez en las condiciones de actualización.

**Problema principal:** El anchor se actualiza demasiado agresivamente sin protección contra ruido de precio.

### Qué cambiaría

#### 1. Añadir umbral mínimo de actualización (histéresis)

**Recomendación:** No actualizar anchor si `newSwingPrice <= anchor * (1 + threshold)`

**Threshold sugerido:**
- BTC: 0.3% - 0.5%
- ETH: 0.5% - 0.7%
- Altcoins: 1.0% - 1.5%

**Archivo:** `IdcaEngine.ts` → línea ~2542

**Código sugerido:**
```typescript
const UPDATE_THRESHOLD_PCT = pair === "BTC/USD" ? 0.003 : pair === "ETH/USD" ? 0.005 : 0.01;
const minPriceForUpdate = anchorAfterReset.anchorPrice * (1 + UPDATE_THRESHOLD_PCT);

if (newSwingPrice > minPriceForUpdate) {
  vwapAnchorMemory.set(pair, { ... });
}
```

---

#### 2. Añadir cooldown mínimo de actualización

**Recomendación:** No actualizar anchor más de una vez cada X horas.

**Cooldown sugerido:**
- BTC/ETH: 6 horas
- Altcoins: 12 horas

**Archivo:** `IdcaEngine.ts` → añadir `lastAnchorUpdateAt` a `vwapAnchorMemory`

**Código sugerido:**
```typescript
const COOLDOWN_MS = pair === "BTC/USD" || pair === "ETH/USD" 
  ? 6 * 60 * 60 * 1000 
  : 12 * 60 * 60 * 1000;

const timeSinceUpdate = Date.now() - (anchorAfterReset?.setAt ?? 0);
if (timeSinceUpdate < COOLDOWN_MS) {
  // Skip update
  return;
}
```

---

#### 3. Añadir confirmación de cierre de vela

**Recomendación:** Solo actualizar anchor si el nuevo swing high está en una vela cerrada, no en vela en formación.

**Archivo:** `IdcaSmartLayer.ts` → `computeHybridV2()`

**Implementación:** Modificar para solo considerar velas con `time < now - intervalMs` (cerradas).

---

#### 4. Unificar referencias entre Engine y Contexto de mercado

**Recomendación:** `IdcaMarketContextService` debería usar la misma lógica que `performEntryCheck` para calcular la referencia efectiva.

**Archivo:** `IdcaMarketContextService.ts` → `getMarketContext()`

**Cambio:** Añadir parámetro `effectiveBasePrice` o llamar a la misma función que el engine.

---

#### 5. Unificar referencias en Eventos y Resumen

**Recomendación:** Tanto eventos como Resumen deberían mostrar `effectiveBasePrice` y `basePriceMethod` para consistencia.

**Archivos:** `IdcaEventCards.tsx`, `IdcaMarketContextCard.tsx`

---

#### 6. Añadir historial completo de referencias

**Recomendación:** Crear tabla `idca_reference_history` para guardar:
- anchorPrice
- anchorTime
- source (vwap_anchor, hybrid_v2, window_high)
- setAt
- invalidatedAt
- invalidationReason
- replacedBy
- maxPriceAfterAnchor
- wasUsedForEntry

**Schema:**
```sql
CREATE TABLE idca_reference_history (
  id SERIAL PRIMARY KEY,
  pair TEXT NOT NULL,
  anchor_price DECIMAL(20,8) NOT NULL,
  anchor_ts BIGINT NOT NULL,
  source TEXT NOT NULL,
  set_at BIGINT NOT NULL,
  invalidated_at BIGINT,
  invalidation_reason TEXT,
  replaced_by INTEGER REFERENCES idca_reference_history(id),
  max_price_after_anchor DECIMAL(20,8),
  was_used_for_entry BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

#### 7. Añadir visualización de cambios de referencia

**Recomendación:** En UI de Resumen:
- Mostrar referencia efectiva actual
- Mostrar referencia anterior invalidada
- Mostrar motivo de reemplazo
- Mostrar edad de la referencia
- Si cambió hace <24h, mostrar en color rojo temporal

**Archivo:** `IdcaMarketContextCard.tsx`

---

#### 8. Persistir `basePrice` e `effectiveBasePrice` en ciclo

**Recomendación:** Añadir campos a `institutionalDcaCycles`:
- `entryBasePrice` (precio de referencia al entrar)
- `entryBasePriceType` (fuente)
- `entryBasePriceMeta` (metadatos)

**Schema:** `shared/schema.ts`

---

### Qué dejaría igual

1. **Arquitectura híbrida (VWAP Anchor + Hybrid V2.1 fallback):** Es correcta y flexible.
2. **Persistencia de VWAP Anchor en DB:** Funciona bien, sobrevive a restarts.
3. **Guardado de `frozenAnchorPrevious`:** Útil para trazabilidad.
4. **Alerta Telegram de cambio de anchor:** Buena notificación.
5. **Reset de anchor al abrir ciclo:** Correcto para limpiar estado.

---

### Prioridad de cambios

**PRIORIDAD 1 (Crítico):**
1. Añadir umbral mínimo de actualización (histéresis)
2. Añadir cooldown mínimo de actualización
3. Unificar referencias entre Engine y Contexto de mercado

**PRIORIDAD 2 (Alta):**
4. Añadir confirmación de cierre de vela
5. Unificar referencias en Eventos y Resumen
6. Añadir visualización de cambios de referencia

**PRIORIDAD 3 (Media):**
7. Añadir historial completo de referencias
8. Persistir `basePrice` e `effectiveBasePrice` en ciclo

---

## H) ARCHIVOS QUE HABRÍA QUE TOCAR

### Backend

1. **`server/services/institutionalDca/IdcaEngine.ts`**
   - Línea ~2542: Añadir umbral de actualización
   - Línea ~2542: Añadir cooldown de actualización
   - Línea ~2542: Añadir confirmación de vela (llamando a smart layer modificado)
   - Línea ~2650: Unificar lógica de effectiveBasePrice

2. **`server/services/institutionalDca/IdcaSmartLayer.ts`**
   - `computeHybridV2()`: Modificar para solo considerar velas cerradas
   - Añadir parámetro para umbral de actualización

3. **`server/services/institutionalDca/IdcaMarketContextService.ts`**
   - `getMarketContext()`: Usar misma lógica que engine para calcular referencia efectiva
   - Añadir parámetro para recibir effectiveBasePrice del engine

4. **`shared/schema.ts`**
   - `institutionalDcaCycles`: Añadir `entryBasePrice`, `entryBasePriceType`, `entryBasePriceMeta`

5. **`db/migrations/`**
   - Crear migración para tabla `idca_reference_history`
   - Crear migración para añadir campos a `institutional_dca_cycles`

### Frontend

6. **`client/src/components/idca/IdcaMarketContextCard.tsx`**
   - Mostrar referencia efectiva actual
   - Mostrar referencia anterior invalidada
   - Mostrar motivo de reemplazo
   - Mostrar edad de referencia
   - Color rojo si cambió hace <24h

7. **`client/src/components/idca/IdcaEventCards.tsx`**
   - Unificar para mostrar siempre `effectiveBasePrice` y `basePriceMethod`
   - Añadir visualización de cambios de referencia

8. **`client/src/components/idca/idcaMarketContextHelpers.ts`**
   - Añadir helpers para historial de referencias
   - Añadir helper para estado de cambio reciente

---

## CONCLUSIÓN

El sistema actual tiene una arquitectura sólida pero **falta robustez en las condiciones de actualización del anchor**. Los principales riesgos son:

1. **Actualización demasiado agresiva** sin umbral, cooldown ni histéresis
2. **Inconsistencia visual** entre Engine, Contexto de mercado y Eventos
3. **Falta de trazabilidad** de cambios de referencia

Se recomienda implementar las mejoras de PRIORIDAD 1 antes de continuar con nuevas funcionalidades, ya que esto afecta directamente a la calidad de las decisiones de entrada del bot.
