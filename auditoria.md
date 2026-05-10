# AUDITORÍA IDCA AMPLIADA
**Fecha:** 10 de mayo de 2026

---

# FASE 1 — ANCLA VWAP: MAPA COMPLETO DE LLAMADAS

## Tabla de campos críticos

| Campo | Archivo / Línea | Valor usado | Fuente real | ¿Lo usa el engine? | ¿Lo muestra la UI? | ¿Puede diferir? | Conclusión |
|---|---|---|---|---|---|---|---|
| `effectiveEntryReference` (decisión) | `IdcaEngine.ts:2842` | `refResult.effectiveEntryReference` | `vwapAnchorMemory` (in-memory) o Hybrid | **SÍ — decisión real** | No directo | — | Correcto |
| `effectiveEntryReference` (UI) | `IdcaMarketContextService.ts:416` | `refResult.effectiveEntryReference` | DB (`getVwapAnchor`) o Hybrid | No | **SÍ** | ⚠️ puede diferir del engine | Latencia DB vs memoria |
| `frozenAnchor` (engine) | `IdcaEngine.ts:2786` | `vwapAnchorMemory.get(pair)` | Map en memoria, cargado en startup desde DB, actualizado en cada tick | **SÍ** | No | ⚠️ | Correcto pero no compartido |
| `frozenAnchor` (MCS) | `IdcaMarketContextService.ts:340` | `await getVwapAnchor(pair)` | DB query directa cada vez | No | SÍ | ⚠️ DB puede tener valor anterior | Posible lag |
| `drawdownPct` (engine) | `IdcaEngine.ts:2845-2846` | `((effectiveBasePrice - currentPrice) / effectiveBasePrice) * 100` | `effectiveEntryReference` real | **SÍ** | Via evento | — | **CORRECTO** |
| `drawdownPct` (MCS/UI) | `IdcaMarketContextService.ts:225` | `((anchorPrice - currentPrice) / anchorPrice) * 100` | `anchorPrice` legacy (VWAP actual o window_high) | No | **SÍ — etiquetado como "desde ref. efectiva"** | ❌ **SÍ — cuando vwap_anchor activo** | **BUG CONFIRMADO** |
| `basePriceResult` (engine) | `IdcaEngine.ts:2652-2658` | `computeBasePrice({candles: ohlcCache, ...})` | `ohlcCache` propia del engine | **SÍ** | No | ⚠️ | Correcto |
| `basePriceResult` (MCS) | `IdcaMarketContextService.ts:290-296` | `computeBasePrice({candles: rawCandles, ...})` | `MarketDataService.getCandles` | No | SÍ (como `technicalBasePrice`) | ⚠️ velas distintas | Pueden calcular precios diferentes |
| `entryDipPct` (engine) | `IdcaEngine.ts:2845` | `((effectiveBasePrice - currentPrice) / effectiveBasePrice) * 100` | `effectiveEntryReference` correcta | **SÍ — gateway de entrada** | Via evento payload | — | Correcto |
| `basePriceMethod` | `IdcaEngine.ts:2843` | `refResult.effectiveReferenceSource` | Mismo resolver canónico | **SÍ** | Via evento | — | Correcto |
| `selectedPrice` (Hybrid) | `IdcaSmartLayer.ts:556-614` | Calculado dentro de `computeHybridV2` | `ohlcCache` (engine) o MDS (MCS) | SÍ (vía engine) | Como `technicalBasePrice` | ⚠️ | Distinto set de velas |
| `currentPrice` (engine) | `IdcaEngine.ts` | `MarketDataService.getPrice(pair)` | MarketDataService (compartido) | **SÍ** | No | No | COMPARTIDO Y CORRECTO |
| `currentPrice` (MCS) | `IdcaMarketContextService.ts:138` | `MarketDataService.getPrice(pair)` | MarketDataService (compartido) | No | **SÍ** | No | COMPARTIDO Y CORRECTO |

## Confirmación de dos rutas separadas

**Ruta A — Decisión real del engine** (`IdcaEngine.ts`)
```
ohlcCache (own Map) → computeBasePrice → resolveEffectiveEntryReference (vwapAnchorMemory) → entryDipPct → bloquea/permite
```

**Ruta B — Contexto visual/UI** (`IdcaMarketContextService.ts`)
```
MarketDataService.getCandles (shared TTL 90min) → computeBasePrice → resolveEffectiveEntryReference (DB query) → drawdownPct (desde anchorPrice legacy)
```

## ¿Pueden producir valores distintos en el mismo tick?

**SÍ — tres mecanismos confirmados:**

1. **frozenAnchor**: Engine usa `vwapAnchorMemory` (actualizado síncronamente en cada tick). MCS lee DB (la escritura a DB es `async`). Ventana de divergencia: la misma hasta que el `upsertVwapAnchor` completa.

2. **Velas**: Engine usa `ohlcCache` (copy procesada con `mapKrakenCandles`, actualizada en loop propio). MCS usa `MarketDataService.candleCache` (TTL 90min, sin `mapKrakenCandles`). Aunque el exchange es el mismo, los arrays no son el mismo objeto. Timestamps distintos (uno con guardia `>1e12`, otro sin ella).

3. **drawdownPct**: Engine calcula desde `effectiveEntryReference` (correcto). MCS calcula desde `anchorPrice` legacy (VWAP actual o window_high, no el frozenAnchor).

**Escenario de riesgo real:** Si `vwapEnabled=true` y hay un `frozenAnchor` de $95,000 pero el VWAP actual está en $93,000:
- Engine decide con `effectiveEntryReference = $95,000`
- UI muestra `drawdownPct` calculado desde `anchorPrice = $93,000` (distinto)
- La caída real que usa el engine es `(95000 - currentPrice) / 95000`
- La caída que ve el usuario es `(93000 - currentPrice) / 93000`
- Con `currentPrice = $91,000`: engine ve **4.2% de caída**, UI muestra **2.2%** → discrepancia de 2 puntos

---

# FASE 2 — CADUCIDAD Y VALIDEZ DEL FROZEN ANCHOR

## ¿Tiene caducidad real en backend?

**NO. Confirmado.** El resolver canónico no verifica edad:

```typescript
// IdcaEntryReferenceResolver.ts:91-95
const vwapAnchorAvailable = vwapEnabled
  && frozenAnchor?.anchorPrice
  && frozenAnchor.anchorPrice > 0;
```

La única comprobación es `anchorPrice > 0`. Un anchor de 90 días activo es idéntico a uno de 1 hora.

## ¿Cuándo se invalida? (únicas 3 condiciones)

| Condición | Archivo/línea | Disparo |
|---|---|---|
| Precio sube > 0.25% (BTC) / 0.35% (ETH) por encima del anchor | `IdcaEngine.ts:2683` | `shouldResetAnchor` → `vwapAnchorMemory.delete` + `deleteVwapAnchor` DB |
| Se abre un nuevo ciclo | `IdcaEngine.ts:1520` | `vwapAnchorMemory.delete(pair)` (SOLO memoria, no DB explícito aquí) |
| Reset manual por usuario | `IdcaEngine.ts:5397-5399` | `vwapAnchorMemory.delete` + `deleteVwapAnchor` DB |

## ¿Qué muestra la UI?

```typescript
// IdcaMarketContextCard.tsx:235-239
{data.frozenAnchorAgeHours != null && (
  <span className={data.frozenAnchorAgeHours > 168 ? " text-amber-400/70" : ""}>
    {" "}· hace {data.frozenAnchorAgeHours > 48
      ? `${(data.frozenAnchorAgeHours / 24).toFixed(1)}d`
      : `${data.frozenAnchorAgeHours.toFixed(1)}h`}
```

- **>168h**: amber/70 (casi invisible)
- **>72h**: `resolveAnchorStatus` → `"stale"` en el context, pero no hay bloqueo
- Sin umbral rojo. Sin invalidación automática por tiempo.

## Constantes de umbrales de edad (solo para texto, no para lógica)

```typescript
// IdcaReferenceContext.ts:19-20
export const ANCHOR_STALE_HOURS       = 72;
export const ANCHOR_VERY_STALE_HOURS  = 168;
```

Estas constantes solo se usan para el **texto descriptivo** del tooltip del badge. No bloquean entrada. No invalidan el anchor.

## Riesgo de anchor obsoleto

En un mercado lateral/bajista prolongado donde el precio nunca recupera el anchor, el sistema usará indefinidamente ese precio como referencia de caída. Un anchor de 3 semanas en BTC puede representar un nivel ya superado por la estructura real del mercado.

---

# FASE 3 — AUDITORÍA PROFUNDA DE "SIN VELAS SUFICIENTES"

## Tabla de umbrales

| Umbral | Valor | Archivo / Línea | Afecta engine | Afecta UI/MCS | Bloquea entrada | Genera evento | Genera log | Mensaje visible |
|---|---|---|---|---|---|---|---|---|
| `MIN_CANDLES` | **7** | `IdcaSmartLayer.ts:447` | **SÍ** — Hybrid V2.1 | No | **SÍ** (→ `insufficient_base_price_data`) | SÍ | SÍ | "insufficient 24h candles X/7" |
| Cold-start ohlcCache vacío | **0** | `IdcaEngine.ts:2632-2636` | **SÍ** | No | **SÍ** (→ `data_not_ready`) | **NO** (suprimido) | SÍ | — (no hay evento visible) |
| `minCandlesForAtr` | **14** | `IdcaMarketContextService.ts:144-146` | No | **SÍ** — lanza EXCEPCIÓN | No (engine no lo usa) | No | Error en catch del caller | tarjeta de contexto falla silenciosamente |
| `MIN_WARMUP_CANDLES` | **24** | `IdcaMarketContextService.ts:157` | No | Solo log | No | No | `[IDCA][MARKET_DATA_WARMUP] status=warming_up` | Badge "calentando" en UI si status se mapea |
| `minCandlesForVwap` | **50** | `IdcaMarketContextService.ts:83,171` | No | VWAP no calculado | No | No | No | VWAP ausente → qualityReason = "missing_vwap_zone" |
| `OPTIMAL_CANDLES` | **100** | `IdcaMarketContextService.ts:244` | No | qualityStatus="partial" | No | No | No | Badge "Parcial: X/100 velas" |

## Qué condición genera qué resultado exacto

### Flujo del engine (decisión real):

```
ohlcCache vacío → data_not_ready → BLOQUEA, evento SUPRIMIDO
ohlcCache no vacío → computeHybridV2:
  candles24h < 7 → price=0, isReliable=false → insufficient_base_price_data → BLOQUEA, evento SÍ generado
  candles24h ≥ 7 → Hybrid funciona → puede bloquear por otras razones (dip, score)
```

### Flujo de MarketContextService (contexto/UI):

```
rawCandles.length < 14 → LANZA EXCEPCIÓN (throw) → contexto no disponible → tarjeta de mercado vacía/error
rawCandles.length < 24 → log WARMUP, basePriceResult calculable, qualityStatus potencialmente "partial"
rawCandles.length < 50 → VWAP no calculado → qualityReason="warming_up_cache" o "missing_vwap_zone"
rawCandles.length < 100 → qualityStatus="partial", qualityReason varía
rawCandles.length ≥ 100 → qualityStatus="ok" si VWAP y ATRP ok
```

### Escenario confirmado de divergencia (7-13 velas):
- Engine: Hybrid V2.1 funciona (≥7), `isReliable=true`, puede permitir entrada
- MCS: lanza excepción en línea 144, contexto no disponible, tarjeta de mercado muestra error
- **El engine puede estar operando normalmente mientras la UI de contexto está en error**

## Mensaje visible al usuario según cada condición

| Condición | Evento generado | Texto visible en UI |
|---|---|---|
| ohlcCache vacío | NINGUNO (suprimido) | Ninguno hasta siguiente tick exitoso |
| insufficient_base_price_data | `entry_check_blocked` | "No se compró porque el sistema aún no dispone de suficientes velas (X/7)" |
| MCS lanza excepción | No (error de API) | Tarjeta "Contexto de Mercado" puede mostrar "Error: Insufficient candles..." |
| warming_up (14-23 velas) | No | Badge "Parcial: calentando" en MarketContextCard |
| missing_vwap_zone (23-49) | No | Badge "Parcial: falta VWAP" o "Ref. VWAP anclada" |

---

# FASE 4 — TIMESTAMPS Y DOBLE MULTIPLICACIÓN

## Mapa completo de rutas de tiempo

### Ruta A — Engine (`ohlcCache`)

```
RevolutXService.getOHLC() → time = r.time (raw, sin normalizar)
    ↓
MarketDataService.candleCache → guarda {time: raw} (sin normalizar)
    ↓
IdcaEngine: mapKrakenCandles → time = c.time * 1000  ← SIEMPRE ×1000
    ↓
ohlcCache → timestamps en lo que sea × 1000
    ↓
filterWindow(candles, nowMs, 1440) ← espera ms
```

### Ruta B — MarketContextService

```
MarketDataService.getCandles() → misma candleCache
    ↓
IdcaMarketContextService.ts:153 → time = c.time > 1e12 ? c.time : c.time * 1000  ← GUARDA CORRECTA
    ↓
filterWindow espera ms → correcto en ambos casos
```

## ¿Qué formato retorna RevolutXService.getOHLC?

```typescript
// RevolutXService.ts:487-495
if (Array.isArray(r) && r.length >= 6) {
  const t = this.parseNumeric(r[0]);
  ...
  parsed.push({ time: t, open: o, high: h, low: l, close: c, volume: ... });
```

`parseNumeric` devuelve el valor numérico tal cual — **sin multiplicar ni dividir**. El formato de `time` en el `OHLC` interface **no está documentado** y depende del API de RevolutX.

**Evidencia clave**: En `IdcaEngine.ts:3309`:

```typescript
await repo.upsertOhlcv({
  pair, timeframe: "1h",
  ts: new Date(c.time * 1000),
```

Aquí `c` viene de `candles1h` (salida de `MarketDataService.getCandles`, **antes** de `mapKrakenCandles`). Se hace `c.time * 1000` para construir la fecha. Esto confirma que el código **asume** que `MarketDataService.getCandles` devuelve `time` en **segundos**.

## ¿Se recargan OHLCV de DB al arrancar?

**NO.** El único dato que se recarga es el VWAP anchor:

```typescript
// IdcaEngine.ts:692
await loadAnchorsFromDb();
```

`getOhlcvRange` existe en IdcaRepository pero **nunca es llamada** en el arranque del engine. Las velas OHLCV persisten a DB solo como auditoría, no se restauran.

**Riesgo de doble multiplicación vía DB: DESCARTADO.**

## Riesgo real de timestamp

| Escenario | Engine (ohlcCache) | MCS | Riesgo |
|---|---|---|---|
| RevolutX devuelve segundos | `time * 1000` → ms correcto | `>1e12` guarda → ms correcto | NINGUNO |
| RevolutX devuelve ms | `time * 1000` → year 60000 | `>1e12` guarda sin multiplicar → ms correcto | **ALTO para engine** |
| Kraken legacy devuelve segundos | `time * 1000` → ms correcto | `>1e12` guarda → ms correcto | NINGUNO |

**Conclusión**: El riesgo de timestamp en el engine es **PROBABLE** si RevolutX devuelve ms. El código de `mapKrakenCandles` fue escrito para Kraken (segundos) y nunca se actualizó la guardia para RevolutX. El resultado sería que `filterWindow` filtraría TODAS las velas → `candles24h = []` → `insufficient 0/7` → bloqueo de entradas.

**El MCS (`IdcaMarketContextService`) está PROTEGIDO** con la guardia `>1e12`. El engine NO.

---

# FASE 5 — CACHES Y DATOS COMPARTIDOS CON MOMENTUM

## Tabla de datos compartidos

| Dato | Fuente IDCA engine | Fuente IDCA UI/contexto | Fuente Momentum | Compartido | Puede divergir | Riesgo | Clasificación |
|---|---|---|---|---|---|---|---|
| Precio actual | `MarketDataService.getPrice` | `MarketDataService.getPrice` | `MarketDataService.getPrice` | **SÍ — todos** | No | Ninguno | **COMPARTIDO Y CORRECTO** |
| Velas 1h raw | `MarketDataService.getCandles` | `MarketDataService.getCandles` | `MarketDataService.getCandles` | **SÍ — misma cache** (TTL 90min) | No (misma cache) | Ninguno | **COMPARTIDO Y CORRECTO** |
| Velas 1h procesadas | `ohlcCache` propio (mapKrakenCandles) | `MarketDataService.candleCache` raw | `MarketDataService.candleCache` raw | **NO** (engine tiene copia propia) | ⚠️ SÍ (timestamps distintos) | Medio | **NO COMPARTIDO PERO DEBERÍA COMPARTIRSE** |
| frozenAnchor | `vwapAnchorMemory` (in-memory) | DB (`getVwapAnchor`) | N/A | NO | ⚠️ mismo tick puede diferir | Medio | **COMPARTIDO PERO RIESGOSO** |
| Exchange (singleton) | `ExchangeFactory.getDataExchange()` | vía MarketDataService | `ExchangeFactory.getDataExchange()` | **SÍ** | No | Ninguno | **COMPARTIDO Y CORRECTO** |
| Rate limiter | `RevolutXService.rlQueue` (instancia) | vía MarketDataService | vía MarketDataService | **SÍ** (misma instancia) | No | Bajo — 250ms min | **COMPARTIDO Y CORRECTO** |
| `ohlcDailyCache` (1d) | Engine propio (macro context) | No usa | No usa | NO | N/A | Ninguno | **NO COMPARTIDO Y CORRECTO** |

## Implicación: caches calientes en Momentum pero frías en IDCA (o viceversa)

- `MarketDataService.candleCache` (TTL 90min) es **compartido entre todos**. Si Momentum actualiza las velas, IDCA las ve en la siguiente lectura. Correcto.
- `ohlcCache` del engine es **propio**. Se actualiza en cada tick del engine. Momentum no lo ve ni lo usa.
- Si el engine acaba de arrancar pero Momentum ha estado activo: Momentum tendrá velas frescas en MarketDataService, pero `ohlcCache` del engine estará vacío hasta el primer tick. Esto genera el `data_not_ready` al inicio aunque haya datos en el sistema.

---

# FASE 6 — UI: REFERENCIAS CLARAS — TABLA COMPLETA

| Campo | Calcula backend | Devuelve API | Tipa hook/type | Pinta UI | Visible | Problema | Recomendación |
|---|---|---|---|---|---|---|---|
| `effectiveEntryReference` | ✅ | ✅ | ✅ `MarketContextPreview` | ✅ "Ref. Efectiva" | Sí, prominente | — | OK |
| `effectiveReferenceSource` | ✅ | ✅ | ✅ | ✅ (badge indirecto) | Sí, via badge | — | OK |
| `effectiveReferenceLabel` | ✅ | ✅ | ✅ | ✅ "VWAP Anclado" / "Hybrid V2.1" | Sí | — | OK |
| `technicalBasePrice` | ✅ | ✅ | ✅ | ✅ solo si diferente de effectiveRef | Oculto si iguales | No siempre visible | P3 |
| `referenceContext` | ✅ | ✅ | ✅ `IdcaReferenceContext` | ✅ (parcialmente, en DetailPanel) | Parcial | Razones en 8px opacidad 50% | P2 |
| `selectedMethod` (swing_high_24h, p95_24h…) | ✅ en `meta` | ❌ no incluido en API | ❌ | ❌ | **No** | Meta completo no expuesto | P2 |
| `selectedReason` (texto detallado) | ✅ en `meta` | ❌ solo `technicalBaseReason` | ❌ | ❌ | **No** | Meta completo no expuesto | P2 |
| `swingWindowUsed` (24h/48h/72h) | ✅ en `meta` | ❌ | ❌ | ❌ | **No** | Usuario no sabe si swing fue de 48h/72h | P2 |
| `swingHighsFound` | ✅ en `meta` | ❌ | ❌ | ❌ | **No** | — | P3 |
| `candidates` (swingHigh, P95_24h, P95_7d) | ✅ en `meta` | ❌ | ❌ | ❌ | **No** | — | P3 |
| `capsApplied` (cappedBy7d, cappedBy30d) | ✅ en `meta` | ❌ | ❌ | ❌ | **No** | Usuario no sabe si el precio fue capado | P2 |
| `outlierRejected` | ✅ en `meta` | ❌ | ❌ | ❌ | **No** | — | P3 |
| `dynamicTols` (atrPct, swingAlignmentTol…) | ✅ en `meta` | ❌ | ❌ | ❌ | **No** | — | P3 |
| `candlesAvailable` / `candleCount` | ✅ | ✅ (en `qualityDetail`) | ✅ | ✅ pero footer, 9px, opacidad 50% | **Casi invisible** | Muy pequeño, al fondo | P2 |
| `candlesRequired` (óptimo) | ✅ (=100) | ✅ (en `qualityDetail`) | ✅ | ✅ "X/100" | Casi invisible | Muestra óptimo (100), no mínimo (7) | P1 |
| `timeframe` ("velas de 1h") | Implícito | ❌ | ❌ | ❌ | **No** | Usuario no sabe qué velas usa el sistema | P2 |
| `qualityStatus` / badge | ✅ | ✅ | ✅ | ✅ badge CompactRow | Sí si no es "ok" | Oculto cuando ok | OK |
| `frozenAnchorAgeHours` | ✅ | ✅ | ✅ | ✅ amber si >168h | Sí pero amber muy suave | No hay umbral rojo | P1 |
| `currentPrice` | ✅ | ✅ | ✅ | ✅ | Sí | — | OK |
| `drawdownPct` | ✅ (pero incorrecto) | ✅ | ✅ | ✅ "desde ref. efectiva" | Sí | **BUG: desde anchorPrice legacy** | **P0** |
| `nextBuyPrice` | ✅ en ciclo | ✅ en ciclo | ✅ `IdcaCycle` | ✅ en ciclo card | Sí en ciclo | No en tarjeta de contexto | P2 |
| `distanceToNextBuy` | ❌ (no calculado) | ❌ | ❌ | ❌ | **No** | — | P3 |
| `takeProfitPrice` | ✅ `tpTargetPrice` en ciclo | ✅ en ciclo | ✅ | ✅ en ciclo | Sí | — | OK |
| `distanceToTakeProfit` | ❌ | ❌ | ❌ | ❌ | **No** | Solo el precio, no la distancia | P3 |
| `protectionStopPrice` | ✅ en ciclo | ✅ en ciclo | ✅ | ✅ badge ciclo | Sí | — | OK |
| `distanceToProtection` | ❌ | ❌ | ❌ | ❌ | **No** | — | P3 |
| `trailingActivationPrice` | ✅ (calculable: avgEntry × (1 + activationPct)) | ❌ (solo `trailingActivationPct` %) | Solo % | Solo % | Sí (%) | No hay precio absoluto | P3 |
| `distanceToTrailing` | ❌ | ❌ | ❌ | ❌ | **No** | — | P3 |

---

# FASE 7 — EVENTOS DE BLOQUEO

## Tabla de eventos

| Evento | Archivo / Línea | Cuándo se dispara | Mensaje visible | Datos incluidos | Datos que faltan | Riesgo |
|---|---|---|---|---|---|---|
| `data_not_ready` | `IdcaEngine.ts:2636` | `ohlcCache` vacío (cold start) | **NINGUNO** (suprimido en línea 1346) | — | Todo | ⚠️ Usuario no sabe que el bot está inicializando |
| `insufficient_base_price_data` | `IdcaEngine.ts:2664` | `basePriceResult.isReliable=false` (candles24h <7) | "No se compró... velas (X/7)" | par, precio, velas, ancla, referenceContext | timestamp última vela, fuente de velas | BAJO — mensaje humanizado correcto |
| `entry_check_blocked` | `IdcaEngine.ts:1441-1471` | Cualquier bloqueo excepto `data_not_ready` | Texto humanizado en castellano | blockReasons, effectiveBasePrice, frozenAnchorPrice, frozenAnchorAgeHours, drawdownFromAnchorPct, referenceContext | método Hybrid exacto (selectedMethod), ventana usada (swingWindowUsed) | BAJO |
| `entry_check_passed` | `IdcaEngine.ts:1511-1517` | Entrada permitida | Texto de confirmación | marketScore, effectiveBasePrice, basePriceMethod, basePrice completo | — | NINGUNO |
| `trailing_buy_level1_activated` | `IdcaEngine.ts:1251-1266` | Trailing buy armado | Texto con referencia, threshold, max | effectiveEntryReference, buyThreshold, maxExecutionPrice | — | NINGUNO |
| `cycle_management` | `IdcaEngine.ts:1871` | Cada revisión de ciclo activo | Conclusión del diagnóstico | pnlPct, price, nearestTrigger | — | NINGUNO |

## Problema crítico: `data_not_ready` suprimido

```typescript
// IdcaEngine.ts:1345-1346
// Suppress event for data_not_ready (fires every tick on cold start, not useful)
if (check.blockReasons.length > 0 && check.blockReasons[0]?.code !== "data_not_ready") {
```

Durante el cold start (que puede durar minutos), el engine bloquea todas las entradas con `data_not_ready` pero **no genera ningún evento**. La UI de eventos está vacía. El usuario ve el bot aparentemente inactivo sin explicación.

## Mensaje para `insufficient_base_price_data`:

```typescript
// IdcaEventCards.tsx:555-558
if (meta?.candleCount != null) {
  return `No se compró porque el sistema aún no dispone de suficientes velas (${meta.candleCount}/7) para calcular una referencia de precio fiable. El sistema seguirá reintentando automáticamente.`;
}
return "No se compró porque el sistema aún no dispone de suficientes datos de mercado para calcular una referencia fiable. El sistema seguirá reintentando automáticamente.";
```

El mensaje con `X/7` solo aparece si `meta?.candleCount != null`. Si `basePriceResult.meta` es undefined (path de fallback), aparece el mensaje genérico sin conteo. La UI hardcodea `/7` como denominador aunque `MIN_CANDLES=7` podría cambiar.

---

# FASE 8 — CONTRASTE FINAL ENGINE VS UI

## Tabla de contraste

| Campo | Engine | UI (MarketContextService) | Coincide | Evidencia | Riesgo |
|---|---|---|---|---|---|
| Precio actual | `MarketDataService.getPrice` | `MarketDataService.getPrice` | ✅ Sí | Misma función, misma cache | NINGUNO |
| Velas raw (fuente) | `MarketDataService.getCandles` | `MarketDataService.getCandles` | ✅ Sí | Misma cache TTL 90min | NINGUNO |
| Velas procesadas | `ohlcCache` (mapKrakenCandles, sin guardia) | `rawCandles` con guardia `>1e12` | ⚠️ NO | Distintos arrays, distintas timestamps | MEDIO — si RevolutX devuelve ms |
| `frozenAnchor` | `vwapAnchorMemory.get(pair)` | `getVwapAnchor(pair)` DB | ⚠️ Puede no coincidir | Engine actualiza en tick, MCS lee DB | MEDIO |
| `effectiveEntryReference` | Desde `vwapAnchorMemory` | Desde DB | ⚠️ Puede no coincidir | Misma lógica, datos distintos | MEDIO |
| `drawdownPct` | `((effectiveRef - price) / effectiveRef) * 100` (correcto) | `((anchorPrice - price) / anchorPrice) * 100` (legacy) | ❌ NO | Confirmado en código | **ALTO — UI muestra valor incorrecto** |
| Calidad de datos | Binario: `isReliable` (7 velas) | Multiescala: 14/24/50/100 | ⚠️ NO — escalas distintas | Umbrales divergentes | MEDIO |
| Motivo de bloqueo (candles) | `isReliable=false` → `insufficient_base_price_data` | throw excepción si <14 | ⚠️ NO — distintos paths | Engine puede estar OK, MCS falla | MEDIO |
| Timestamp de evaluación | `Date.now()` en tick | `new Date()` en getMarketContext | ✅ Prácticamente igual | Diferencia <100ms | MÍNIMO |
| VWAP anchor delete en ciclo abierto | `vwapAnchorMemory.delete(pair)` (IdcaEngine.ts:1520) | No lo sabe hasta próxima query DB | ⚠️ Puede persistir en UI | Engine borra en memoria, DB se actualiza async | BAJO |

---

# FASE 9 — INFORME FINAL DE AUDITORÍA AMPLIADA

## 1. Resumen ejecutivo

La arquitectura IDCA tiene **dos rutas paralelas** para resolver la referencia de entrada: el engine (decisión real) y el MarketContextService (contexto visual). Comparten la fuente de datos (MarketDataService, exchange), pero divergen en el procesamiento de velas, la fuente del frozenAnchor (memoria vs DB), y el cálculo del drawdown. El frozenAnchor **no tiene caducidad temporal** en backend. El riesgo más alto confirmado es que la UI muestra un `drawdownPct` calculado desde una fuente distinta a la que usa el engine para decidir entradas.

---

## 2. Hallazgos confirmados

| ID | Hallazgo | Archivo/línea | Severidad |
|---|---|---|---|
| C1 | `drawdownPct` en UI calculado desde `anchorPrice` legacy, etiquetado "desde ref. efectiva" | `IdcaMarketContextService.ts:225` / `IdcaMarketContextCard.tsx:325` | **P0** |
| C2 | `mapKrakenCandles` sin guardia `>1e12`, multiplica `c.time * 1000` siempre | `IdcaEngine.ts:3261` | **P1** |
| C3 | `MinCandlesForAtr=14` en MCS lanza excepción, mientras engine acepta ≥7 velas | `IdcaMarketContextService.ts:144-146` | **P1** |
| C4 | `frozenAnchor` del engine (memoria) y MCS (DB) divergen en el mismo tick | `IdcaEngine.ts:2786` vs `IdcaMarketContextService.ts:340` | **P1** |
| C5 | `data_not_ready` no genera evento visible al usuario | `IdcaEngine.ts:1346` | **P1** |
| C6 | Frozen anchor sin caducidad temporal: se usa indefinidamente si precio no sube | `IdcaEntryReferenceResolver.ts:91-95` | **P1** |
| C7 | `vwapAnchorMemory.delete` al abrir ciclo (in-memory) pero DB puede no sincronizarse a tiempo | `IdcaEngine.ts:1520` | **P1** |
| C8 | Metadatos completos de Hybrid V2.1 (`selectedMethod`, `swingWindowUsed`, `candidates`, `capsApplied`) no expuestos en API | `institutionalDca.routes.ts:1142-1171` | **P2** |
| C9 | Contador de velas visible en footer a 9px opacidad 50% — prácticamente invisible | `IdcaMarketContextCard.tsx:386` | **P2** |
| C10 | UI hardcodea `/7` en mensaje de velas insuficientes aunque MIN_CANDLES es configurable | `IdcaEventCards.tsx:556` | **P2** |
| C11 | Timeframe de velas ("1h") nunca informado explícitamente al usuario | Todo el sistema | **P2** |

---

## 3. Hallazgos probables (no confirmables solo con código estático)

| ID | Hallazgo | Evidencia | Severidad |
|---|---|---|---|
| P1 | RevolutX.getOHLC puede devolver ms → `mapKrakenCandles` crea timestamps year 60000 → `filterWindow` vacía → bloqueos | `RevolutXService.ts:495` no normaliza, `mapKrakenCandles` multiplica siempre | **P1** |
| P2 | Engine opera con 7 velas pero UI de contexto falla con <14 → usuario ve bot activo pero sin contexto de mercado | Umbrales confirmados, comportamiento de excepciones | **P1** |
| P3 | Cuando frozenAnchor se borra al abrir ciclo, MCS puede seguir mostrando anchor antiguo durante el lag de DB | DB async + cache TTL 30s en MCS | **P2** |

---

## 4. Riesgos descartados

| ID | Hallazgo | Motivo |
|---|---|---|
| D1 | Doble multiplicación de timestamps vía DB reload | `getOhlcvRange` nunca se llama en startup del engine. DB OHLCV es solo auditoría. |
| D2 | Rate limit duplicado entre IDCA y Momentum | RevolutX rate limiter es instancia singleton compartida vía `ExchangeFactory` |

---

## 5. Pendientes no verificables solo con código

| ID | Pendiente |
|---|---|
| V1 | Formato real de timestamp que devuelve RevolutX API (segundos vs ms) — requiere log en VPS o test con exchange |
| V2 | Confirmar si la ventana de lag entre `vwapAnchorMemory.delete` y DB delete es observable en producción |
| V3 | Confirmar si `ANCHOR_STALE_HOURS = 72` y `ANCHOR_VERY_STALE_HOURS = 168` son valores apropiados para los pares activos actuales |

---

## 6. Tabla de umbrales de velas

| Umbral | Valor | Bloquea entrada | Excepción | Solo visual | Log |
|---|---|---|---|---|---|
| `MIN_CANDLES` (Hybrid V2.1) | 7 | **SÍ** | No | No | SÍ |
| `minCandlesForAtr` (MCS) | 14 | No (MCS) | **SÍ** (throw) | — | Error callsite |
| `MIN_WARMUP_CANDLES` (MCS log) | 24 | No | No | No | **SÍ** |
| `minCandlesForVwap` (MCS) | 50 | No | No | qualityReason | No |
| `OPTIMAL_CANDLES` (MCS) | 100 | No | No | qualityStatus="partial" | No |

---

## 7. Tabla de datos compartidos IDCA vs Momentum

| Dato | IDCA engine | IDCA UI | Momentum | Compartido | Riesgo |
|---|---|---|---|---|---|
| Precio actual | MDS.getPrice | MDS.getPrice | MDS.getPrice | **SÍ** | Ninguno |
| Velas raw | MDS.getCandles | MDS.getCandles | MDS.getCandles | **SÍ** | Ninguno |
| Velas procesadas | ohlcCache propio | MDS.candleCache | MDS.candleCache | **NO** | Medio |
| frozenAnchor | vwapAnchorMemory | DB | N/A | **NO** | Medio |
| Exchange | ExchangeFactory (singleton) | vía MDS | ExchangeFactory (singleton) | **SÍ** | Ninguno |
| Rate limiter | RevolutX.rlQueue (singleton) | vía MDS | vía MDS | **SÍ** | Ninguno |

---

## 8. Tabla Engine vs UI

| Campo | Engine | UI | Coincide |
|---|---|---|---|
| Precio actual | MDS.getPrice | MDS.getPrice | ✅ |
| frozenAnchor | vwapAnchorMemory (ms) | DB query | ⚠️ lag posible |
| effectiveEntryReference | vwapAnchorMemory o Hybrid | DB o Hybrid | ⚠️ lag posible |
| drawdownPct | desde effectiveEntryReference | desde anchorPrice legacy | ❌ **BUG** |
| Velas (timestamps) | ohlcCache (sin guardia ×1000) | MDS raw + guardia >1e12 | ⚠️ |
| Umbral mínimo velas | 7 (MIN_CANDLES) | 14 (throw) | ❌ divergentes |
| Evento cold start | Bloqueado (suprimido) | No genera contexto | ⚠️ |

---

## 9. Tabla backend / API / hook / UI (campos clave)

| Campo | Backend | API | Hook | UI | Visible |
|---|---|---|---|---|---|
| `effectiveEntryReference` | ✅ | ✅ | ✅ | ✅ | **SÍ** |
| `drawdownPct` (bug) | ✅ | ✅ | ✅ | ✅ | Sí — **valor incorrecto** |
| `selectedMethod` | ✅ meta | ❌ | ❌ | ❌ | **NO** |
| `swingWindowUsed` | ✅ meta | ❌ | ❌ | ❌ | **NO** |
| `capsApplied` | ✅ meta | ❌ | ❌ | ❌ | **NO** |
| `candleCount / requiredForOptimal` | ✅ | ✅ | ✅ | ✅ | Sí — 9px invisible |
| `frozenAnchorAgeHours` | ✅ | ✅ | ✅ | ✅ | Sí — amber suave |
| `timeframe` ("1h") | Implícito | ❌ | ❌ | ❌ | **NO** |
| `data_not_ready` (evento) | ✅ bloquea | — | — | ❌ suprimido | **NO** |

---

## 10. Orden recomendado de corrección

### Lote 1 — P0/P1 operativos (bajo riesgo de cambio, máximo impacto)
| # | Corrección | Archivo | Tipo cambio | Riesgo |
|---|---|---|---|---|
| L1.1 | Corregir `drawdownPct` en MCS: calcular desde `effectiveEntryReference` | `IdcaMarketContextService.ts:225` | 1 línea | MÍNIMO |
| L1.2 | Añadir guardia `>1e12` en `mapKrakenCandles` | `IdcaEngine.ts:3261` | 1 línea | MÍNIMO |
| L1.3 | Cambiar `throw` en MCS por retorno degradado cuando <14 velas | `IdcaMarketContextService.ts:144-146` | 5-8 líneas | BAJO |
| L1.4 | Generar un evento único (no spam) cuando `data_not_ready` al arranque | `IdcaEngine.ts:1345-1346` | 5-10 líneas | BAJO |

### Lote 2 — P1/P2 de transparencia (metadatos y UI crítica)
| # | Corrección | Archivo | Tipo cambio |
|---|---|---|---|
| L2.1 | Exponer en API: `selectedMethod`, `swingWindowUsed`, `candleCount7d`, `capsApplied` | `institutionalDca.routes.ts` | Añadir campos al response |
| L2.2 | Hacer visible el contador de velas en el grid, no en footer | `IdcaMarketContextCard.tsx` | UI |
| L2.3 | Añadir badge rojo cuando `frozenAnchorAgeHours > 168` (no solo amber) | `IdcaMarketContextCard.tsx` | 1-2 líneas |
| L2.4 | Mostrar timeframe explícito ("velas de 1h") en la tarjeta | Routes + Card | 2-3 cambios |

### Lote 3 — P2/P3 limpieza y mejora UX
| # | Corrección |
|---|---|
| L3.1 | Humanizar el signo del drawdown ("por encima / por debajo del ancla") |
| L3.2 | Implementar caducidad temporal del anchor (configurable, ej. 30 días) |
| L3.3 | Unificar `ohlcCache` y `MarketDataService.candleCache` para una sola fuente procesada |
| L3.4 | Hardcodear `MIN_CANDLES` en el mensaje de evento usando la constante, no "7" fijo |

---

## 11. Lo que se puede aprobar primero con bajo riesgo

**Lote 1** completo — todos son cambios de 1 a 10 líneas, sin efecto en lógica de trading, sin migración de DB, sin cambio de comportamiento. Solo corrigen lo que ya se calcula mal o lo que ya bloquea pero no informa.

## 12. Lo que conviene dejar para después

**L3.3** (unificar cachés): Cambio arquitectónico mayor, requiere validación extensa. Alto riesgo de romper el loop del engine.

**L3.2** (caducidad del anchor): Requiere decisión de negocio sobre el umbral correcto y tests de regresión de comportamiento.

---

**Auditoría cerrada. Sin código modificado. Sin commit. Sin push. Sin deploy.**
