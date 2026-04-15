# BITÁCORA TÉCNICA - KRAKEN AUTOTRADE

----

## 2026-04-15 — FEAT: Tolerancias dinámicas ATR-based en Hybrid V2.1 (basePrice)

### Problema
Los tres umbrales fijos del cálculo de base price (`SWING_ALIGNMENT_TOL=12%`, `CAP_7D_TOL=10%`, `CAP_30D_TOL=20%`) no se adaptaban a la volatilidad del mercado ni diferenciaban BTC de ETH:
- En mercado comprimido (ATR <1.5%), el 12% aceptaba cualquier swing incluyendo wicks
- En rallies fuertes (ATR >5%), el cap 7d al 10% bloqueaba entradas durante días
- ETH tiene volatilidad ~1.5× mayor que BTC pero usaba los mismos umbrales

### Solución — Tolerancias dinámicas con clamp por par

**SWING_ALIGNMENT_TOL** → `clamp(ATR% × 3.0, min, max)`
| Par | Min | Max |
|---|---|---|
| BTC | 6% | 18% |
| ETH | 8% | 25% |

**CAP_7D_TOL** → `clamp(ATR% × 2.5, min, max)`
| Par | Min | Max |
|---|---|---|
| BTC | 6% | 20% |
| ETH | 8% | 25% |

**CAP_30D_TOL** → Fijo por par (guardrail)
| Par | Valor |
|---|---|
| BTC | 20% |
| ETH | 25% |

### Helpers implementados
- `getDynamicSwingAlignmentTol(pair, atrPct)` → tolerancia de alineación swing/P95
- `getDynamicCap7dTol(pair, atrPct)` → tolerancia del cap semanal
- `getCap30dTol(pair)` → guardrail mensual por par

### Payload de auditoría
Nuevo campo `meta.dynamicTols` en `BasePriceResult`:
```json
{
  "pair": "BTC/USD",
  "swingAlignmentTol": 7.5,
  "swingAlignmentTolFixedLegacy": 12,
  "cap7dTol": 6.25,
  "cap7dTolFixedLegacy": 10,
  "cap30dTol": 20,
  "cap30dTolFixedLegacy": 20,
  "atrPctUsed": 2.5
}
```

### Textos de razón actualizados
- Swing aceptado: incluye distancia% y tolDinámica%
- Swing descartado: incluye distancia% vs tolDinámica%
- Cap 7d: incluye exceso%, capDinámico%
- Cap 30d: incluye exceso%, capPorPar%

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `server/services/institutionalDca/IdcaSmartLayer.ts` | Nuevos helpers dinámicos, `computeHybridV2` recibe `pair`, constantes legacy renombradas, reasons actualizados, `meta.dynamicTols` añadido |
| `server/services/institutionalDca/IdcaTypes.ts` | `BasePriceResult.meta.dynamicTols` tipo añadido |
| `server/services/institutionalDca/IdcaEngine.ts` | `pair` pasado a `computeBasePrice()` en ambas llamadas |

### Notas de migración
- **No requiere migración SQL** — sin campos nuevos en DB
- **Backward compatible** — `pair` es opcional en `ComputeBasePriceInput` (default `"BTC/USD"`)
- **Tests existentes** siguen pasando sin cambios (usan default)
- **Eventos** serializan `meta` como JSON genérico — `dynamicTols` se añade sin romper

### Bugfix incluido
Corregido bug en reason del cap 30d: usaba `selectedPrice` después de reasignar (mostraba p95_30d en vez del valor pre-cap).

----

## 2026-04-15 — REFACTOR: Saneamiento de coherencia IDCA (UI ↔ Motor)

### Problema
Auditoría funcional detectó 6 controles visibles en la UI que **no tenían efecto real** en el motor (decorativos/legacy), una incoherencia entre dos campos de trailing (`trailingPct` legacy vs `trailingMarginPct` slider), y una función de partial sell (`armTakeProfit`) que nunca se invoca desde el flujo principal.

### Cambios aplicados

#### Fase 1 — Retirada de controles decorativos de la UI
Eliminados de `InstitutionalDca.tsx` (ConfigTab):
- **`blockOnBreakdown`** — toggle sin lógica en el motor
- **`blockOnHighSpread`** — toggle sin lógica en el motor
- **`blockOnSellPressure`** — toggle sin lógica en el motor
- **`protectPrincipal`** — toggle sin implementación
- **`maxCombinedBtcExposurePct`** — slider sin verificación de exposición combinada
- **`maxCombinedEthExposurePct`** — slider sin verificación de exposición combinada

Las columnas de schema/DB **permanecen intactas** (0 riesgo de migración).

#### Fase 2 — Unificación del trailing
- `assetConfig.trailingMarginPct` (slider UI) definido como **única fuente de verdad**
- Se reemplazaron **6 referencias** a `assetConfig.trailingPct` (legacy) por `assetConfig.trailingMarginPct` en `IdcaEngine.ts`:
  - Creación de ciclo (checkEntry)
  - Import de posición (rehydrateImportedCycle)
  - armTakeProfit (legacy)
  - handleTrailingState
  - Recovery entry
  - Recovery safety buy
- El campo `cycle.trailingPct` (columna en ciclos) sigue almacenando el trailing calculado para cada ciclo activo — no se toca.

#### Fase 3 — Marcado de armTakeProfit como legacy
- Añadido comentario explícito documentando que `armTakeProfit()` no se invoca desde `handleActiveState`
- El flujo real va: `active → trailing_active` directamente (sin partial sell)
- Los campos `partialTpMinPct`/`partialTpMaxPct` no están expuestos en la UI actual

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `client/src/pages/InstitutionalDca.tsx` | Retirados 6 controles decorativos (3 toggles, 2 sliders, 1 toggle) |
| `server/services/institutionalDca/IdcaEngine.ts` | 6× `assetConfig.trailingPct` → `assetConfig.trailingMarginPct`, comentario legacy en `armTakeProfit` |

### Notas de migración
- **No requiere migración SQL** — las columnas de DB permanecen, solo se deja de leer/escribir desde UI
- **Ciclos existentes**: Si un ciclo ya tiene `cycle.trailingPct` almacenado, seguirá usando ese valor. Solo ciclos nuevos usarán `trailingMarginPct` como base.

----

## 2026-04-14 — FEAT: Swing adaptativo 48h/72h en Hybrid V2.1

### Problema
Cuando el mercado está lateral/tranquilo (baja volatilidad), la ventana de 24h no genera ningún pivot high confirmado (N=3 candles cada lado). En ese caso, el sistema caía directamente a P95 24h como base price, que es una referencia estadística menos precisa que un swing real.

### Solución — Fallback adaptativo
Dentro de `computeHybridV2()`, después de buscar pivots en 24h:
1. Si **0 pivots en 24h** → expandir a **48h** y reintentar `detectPivotHighs()`
2. Si **0 pivots en 48h** → expandir a **72h** y reintentar
3. Si **0 pivots en 72h** → P95 24h como antes (último recurso)
4. Los **caps 7d/30d existentes** actúan como guardrail si el swing expandido es demasiado alto

### Guardrails que protegen contra over-anchor
- **Cap 7d**: si swing_48h/72h > p95_7d × 1.10 → se capea a p95_7d
- **Cap 30d**: si base > p95_30d × 1.20 → se capea a p95_30d
- **Swing alignment**: si swing > p95_24h × 1.12 → se rechaza como inflado

### Trazabilidad en meta
- `selectedMethod`: `swing_high_24h` / `swing_high_48h` / `swing_high_72h` / `p95_24h`
- `swingWindowUsed`: 1440 / 2880 / 4320
- `candidates.swingHighExpanded`: precio del swing encontrado en ventana >24h

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `server/services/institutionalDca/IdcaSmartLayer.ts` | Fallback 24h→48h→72h en `computeHybridV2()` + ventanas 48h/72h |
| `server/services/institutionalDca/IdcaTypes.ts` | Campos `swingWindowUsed`, `swingHighExpanded` en `BasePriceResult.meta` |

----

## 2026-04-14 — FIX: Historial eventos vacío — Query Key Instability (FRONTEND)

### Problema
La UI mostraba 0 eventos pese a que el backend respondía correctamente con 50 eventos.
El CSV exportado contenía solo la cabecera sin datos.

### Causa raíz
**React Query key instability**: `effectiveDateFrom` se recalculaba con `new Date()` en cada render
del componente. Como el `queryKey` incluía el objeto `filters` con un `Date` que cambiaba por
milisegundos, React Query trataba cada render como una **query completamente nueva** (sin cache).
El ciclo era: render → nuevo queryKey → fetch inicia → data=undefined → render → nuevo queryKey → ...

### Solución
1. **`truncDateToSec()`** — Nueva función utilitaria que trunca Dates a precisión de segundo para el queryKey
2. **`useMemo(effectiveDateFrom, [dateRange, dateFrom])`** — La fecha solo se recalcula cuando el rango cambia
3. **Eliminación de doble filtrado** — El backend ya filtra por severity; el frontend re-filtraba innecesariamente
4. **CSV usa misma fuente** — El export CSV ya usaba `filtered` que dependía de `events`, así que el fix del queryKey también arregla el CSV

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `client/src/hooks/useInstitutionalDca.ts` | `truncDateToSec()` + stable queryKey en `useIdcaEvents` y `useIdcaEventsCount` |
| `client/src/pages/InstitutionalDca.tsx` | `useMemo` para `effectiveDateFrom` + eliminación doble filtrado severity |

----

## 2026-04-14 — FIX: Dashboard lento + Historial de eventos vacío

### Problema 1: Dashboard colgado (~5s en primera carga)
**Causa raíz**: `KrakenRateLimiter` es cola FIFO concurrencia=1 con 500ms entre llamadas. TODAS las llamadas a Kraken (IDCA OHLC, trading, dashboard tickers) comparten la misma cola. Cuando IDCA scheduler está activo, las llamadas de dashboard se encolan detrás → 5-30s de espera.

**Solución**: Patrón **stale-while-revalidate** en `/api/dashboard`:
- Primera carga: bloquea máx 3s, devuelve datos parciales si timeout
- Cargas posteriores: devuelve cache stale instantáneamente + refresca en background
- Cache de tickers (30s TTL) independiente para evitar entrar en cola del rate limiter
- Nunca devuelve 500 si hay cache stale disponible

### Problema 2: Historial de eventos muestra 0 eventos
**Causa raíz** (múltiple):
1. **`static.ts` bug**: `app.use("*")` en Express 4 establece `req.path = "/"` siempre. La guarda `req.path.startsWith("/api")` NUNCA se activaba → rutas API no registradas devolvían HTML en vez de 404 JSON.
2. **Severidad incorrecta**: `cycle_management` tenía severity `"debug"` siempre. Con filtro "Sin debug" activo (default) → 0 eventos visibles cuando hay ciclos activos.
3. **entry_evaluated bloqueado** tenía severity `"debug"` → también invisible con "Sin debug".

**Solución**:
- `static.ts`: usar `req.originalUrl` en vez de `req.path`
- `cycle_management`: severity `"info"` cuando `actionTaken=true`, `"debug"` solo en chequeos rutinarios
- `entry_evaluated`: severity siempre `"info"` (throttle 5min ya limita spam)
- Endpoint diagnóstico: `GET /api/institutional-dca/events/debug` (sin filtros, para curl)
- Logging: `[IDCA][EVENTS_API] count=... filters=...` en cada consulta

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `server/static.ts` | Fix `req.path` → `req.originalUrl` en catch-all SPA |
| `server/routes.ts` | Dashboard stale-while-revalidate + ticker cache 30s |
| `server/routes/institutionalDca.routes.ts` | Endpoint debug + logging en eventos API |
| `server/services/institutionalDca/IdcaEngine.ts` | Severidad condicional cycle_management + entry_evaluated siempre info |
| `client/src/components/idca/IdcaEventCards.tsx` | Catálogo visual para `entry_evaluated` |

----

## 2026-04-12 — REFACTOR: IDCA dipReference — Fase 2–8 completas

### Objetivo
Refactorización y hardening completo del campo `dipReference` del módulo IDCA:
eliminar valores legacy, añadir contrato de tipos estricto, implementar Hybrid V2.1
con contexto multi-timeframe, persistencia en BD y trazabilidad en UI.

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `db/migrations/025_idca_price_context.sql` | **NUEVO** — Migra `local_high`/`ema` → `hybrid`; cambia DEFAULT; añade CHECK constraint; crea `idca_price_context_snapshots` y `idca_price_context_static` |
| `shared/schema.ts` | Añade definiciones Drizzle de las 2 tablas nuevas + types |
| `server/services/institutionalDca/IdcaTypes.ts` | Elimina `ema` de `DipReferenceMethod`; añade `VALID_DIP_REFERENCE_METHODS`, `isValidDipReferenceMethod()`, `normalizeDipReferenceMethod()`; enriquece `BasePriceResult.meta`; añade `IdcaBucketContext` e `IdcaMacroContext` |
| `server/services/institutionalDca/IdcaSmartLayer.ts` | **Hybrid V2.1**: algoritmo multi-timeframe (24h+7d+30d), outlier guard ATR-dinámico, selección swing/P95 con tolerancia 12%, caps 7d/30d, meta enriquecido |
| `server/services/institutionalDca/IdcaEngine.ts` | `normalizeDipReferenceMethod` centralizada; `ohlcDailyCache`+`macroContextCache`; fetch candles diarias; `computeBucketContext`; upsert snapshots/static a BD; `logBasePriceDebug` y `logEntryDecision`; exporta `getMacroContext()` |
| `server/services/institutionalDca/IdcaRepository.ts` | Añade `upsertPriceContextSnapshot`, `getLatestPriceContextSnapshots`, `purgeOldPriceContextSnapshots`, `upsertPriceContextStatic`, `getPriceContextStatic` |
| `server/services/LogRetentionScheduler.ts` | Purge automático de `idca_price_context_snapshots` (retención 365 días) |
| `server/routes/institutionalDca.routes.ts` | Endpoints `GET /price-context/:pair` y `GET /price-context` |
| `client/src/components/idca/IdcaEventCards.tsx` | Sección "Cálculo de base (Hybrid V2.1)" con ancla, drawdown, candidatos P95, outlier, caps |
| `server/services/__tests__/idcaSmartLayer.test.ts` | **NUEVO** — 20+ tests para normalización, Hybrid V2.1, outlier guard, caps, edge cases |

### Algoritmo Hybrid V2.1

```
Inputs: candles 1h (hasta 30d), currentPrice, pivotN=3
1. Filtrar ventanas: 24h, 7d, 30d
2. ATR-pct sobre 24h → outlierThreshold = max(5%, atrPct×1.5)
3. Candidatos 24h: swingHigh (detectPivotHighs), P95, windowHigh
4. Outlier guard: si windowHigh > P95×(1+threshold) → rechazado
5. Selección: si swingHigh <= P95×1.12 → usar swing; si no → usar P95
6. Cap 7d: si base24h > p95_7d×1.10 → cap
7. Cap 30d: si base capped > p95_30d×1.20 → cap
8. Output: BasePriceResult con type="hybrid_v2" y meta enriquecido
```

### Logs estructurados añadidos
- `[IDCA][IDCA_BASE_PRICE]` — emitido en cada tick con precio base, ancla, ATR, caps, método
- `[IDCA][IDCA_ENTRY_DECISION]` — emitido por cada evaluación de entrada con resultado y razón

### Contexto macro (por actualizarse 1×/día con candles diarias)
- Tablas BD: `idca_price_context_snapshots` (buckets 7d/30d/90d/180d) y `idca_price_context_static` (high_2y, low_2y, yearHigh, yearLow, etc.)
- Limpieza automática: retención 365 días vía `LogRetentionScheduler`

----

## 2026-04-10 — AUDIT+FIX: IDCA Exit Flow & Telegram (FASE 1 + FASE 2)

### Problemas detectados (evidencia completa)

#### FASE 1 — Flujo de salida IDCA

**BUG CRÍTICO #1: `tpTargetPrice` decorativo — nunca dispara venta**
- La UI mostraba "🎯 Venta TP: $72,946" pero el engine NUNCA compara `currentPrice >= tpTargetPrice`
- `armTakeProfit()` definida pero jamás llamada (código muerto)
- El flujo real: `active` → trailing activa cuando pnlPct >= `trailingActivationPct` (3.5%) → `trailing_active` → venta cuando caída desde pico >= `trailingPct` (1.5%)

**BUG CRÍTICO #2: `executeRealSell` y `executeRealBuy` eran stubs sin lógica**
- En modo LIVE, solo hacían `console.log` y NO enviaban órdenes al exchange
- El ciclo se cerraba en DB aunque nunca se enviaba orden real → desincronización DB/exchange

**BUG CRÍTICO #3: Sin logs de evaluación de salida**
- Imposible diagnosticar por qué no se ejecutó una salida: no había trace de las evaluaciones

#### FASE 2 — Telegram IDCA

**BUG CRÍTICO #4: `telegram_enabled` por defecto = FALSE**
- El IDCA tiene su propio flag Telegram (independiente del bot principal), en false por defecto
- Resultado: 0 alertas enviadas silenciosamente

**BUG CRÍTICO #5: `canSend()` fallaba sin ningún log**
- Si Telegram estaba deshabilitado, no había traza ni mensaje de por qué

### Correcciones aplicadas

#### `IdcaEngine.ts`
- `handleActiveState`: añadido trace `[EXIT_EVAL]` en cada tick mostrando pnlPct, distancia al trailing, estado protección
- `handleTrailingState`: añadido trace `[EXIT_EVAL]` mostrando drop%, trailing stop price, `trailing_EXIT` al disparar
- `executeRealSell`: implementado con `tradingExchange.placeOrder()` real + error handling que propaga la excepción
- `executeRealBuy`: implementado con `tradingExchange.placeOrder()` real
- `executeTrailingExit`: si sell live falla → crea evento critical_error + envía Telegram + retorna SIN cerrar ciclo en DB
- `executeBreakevenExit`: mismo patrón de protección contra fallo de sell

#### `IdcaTelegramNotifier.ts`
- `canSend()`: añadidos logs `[IDCA][TELEGRAM][BLOCKED]` con razón (disabled, no_chat_id, toggle_disabled, simulation_disabled, cooldown)
- `getTelegramStatus()`: nuevo export con estado completo (enabled, chatIdConfigured, serviceInitialized, simulationAlertsEnabled, toggles)

#### `institutionalDca.routes.ts`
- `GET /telegram/status`: nuevo endpoint que devuelve diagnóstico completo de Telegram IDCA
- `POST /telegram/test`: con validación previa de cada prerequisito (enabled, chatId, service) con mensajes de error específicos

#### `InstitutionalDca.tsx` (UI)
- "Venta TP" → "Obj TP (ref)" con tooltip explicando que NO es el precio de venta real
- Para ciclos `trailing_active`: muestra "⏹ Stop trailing: $XX,XXX" (precio real de disparo) y pico máximo
- `TelegramTab`: panel de diagnóstico en tiempo real (enabled ✓/✗, Chat ID ✓/✗, Servicio ✓/✗, Sim. alertas)

#### `useInstitutionalDca.ts`
- `useIdcaTelegramStatus`: nuevo hook con polling cada 30s

### Archivos modificados
- `server/services/institutionalDca/IdcaEngine.ts`
- `server/services/institutionalDca/IdcaTelegramNotifier.ts`
- `server/routes/institutionalDca.routes.ts`
- `client/src/pages/InstitutionalDca.tsx`
- `client/src/hooks/useInstitutionalDca.ts`

----

## 2026-04-10b — FEAT: IDCA Historial Eventos (FASE 3)

### Mejoras aplicadas

#### Backend — `IdcaRepository.ts`
- `getEvents()`: nuevos filtros `mode`, `pair`, `severity`, `dateFrom`, `dateTo`, `orderBy`, `orderDirection`
- `getEventsCount()`: nuevo endpoint para total de eventos con los mismos filtros
- `purgeOldEvents()`: reescrito con borrado por lotes via subquery de IDs (evita lock en tabla grande)
- Import `asc` añadido

#### Backend — `institutionalDca.routes.ts`
- `GET /events`: ahora acepta todos los filtros nuevos
- `GET /events/count`: nuevo endpoint de conteo
- `POST /events/purge`: nuevo endpoint manual de purga con validación
- Auto-purge programado cada 6h eliminando eventos >7 días (solo tabla IDCA)

#### Frontend — `useInstitutionalDca.ts`
- `useIdcaEvents()`: acepta todos los filtros nuevos
- `useIdcaEventsCount()`: nuevo hook
- `useIdcaEventsPurge()`: nuevo mutation hook

#### Frontend — `InstitutionalDca.tsx`
- `EventsLogPanel`: barra de filtros completa
  - Rango temporal: 24h / 3d / 7d / custom (con pickers de fecha)
  - Filtro por severidad, modo (live/sim), par, tipo de evento
  - Ordenación: más recientes, más antiguos, críticos primero, info primero
  - Contador `X / total_real` (del conteo backend)
  - Selector de límite: 100 / 500 / 1k / 2k
  - Botón purga manual con modal de confirmación
  - Altura lista: 800px
  - Imports: `Select*` de shadcn/ui añadidos

### Pendiente (FASE 3)
- Mejorar historial de eventos IDCA: 7 días, filtros, purga automática

----

## 2026-04-08 — FEAT: Slider Maestro Smart Exit (0–100)

### Objetivo
Permitir controlar todo el comportamiento de Smart Exit con un solo slider, sin necesidad de ajustar parámetros técnicos uno a uno.

### Archivos creados/modificados

**`client/src/lib/smartExitSlider.ts`** — NUEVO (función pura):
- `deriveSmartExitConfigFromMasterSlider(value, currentConfig, manualOverrides)`: calcula toda la config desde un valor 0–100
- `getSliderLabel(v)`: etiqueta descriptiva (Muy pocas salidas … Muchas salidas)
- `getSliderColorClass(v)`: clase de color Tailwind según nivel
- `getSliderTrackClass(v)`: color de barra según nivel

**`client/src/components/strategies/SmartExitTab.tsx`** — MODIFICADO:
- **Slider Maestro** insertado al principio de la sección habilitada
  - `onValueChange` → actualiza visual local sin API
  - `onValueCommit` → llama `handleSliderCommit` y guarda en API
- **Sistema de overrides manuales**:
  - Cada campo controlado usa `manualUpdate(updates, overrideKey)` → guarda + marca override
  - Badge `Automático` (verde) / `Personalizado` (naranja)
  - Botón `"Volver a automático"` → limpia todos los overrides y re-aplica slider
  - `OverrideDot` — punto naranja junto a cada campo con ajuste manual
- **Señales**: `toggleSignal` pasa a través de `manualUpdate` con key `signals.${key}`
- **Persistencia**: `masterSliderValue`, `masterMode`, `manualOverrides` guardados en `smartExitConfig`

### Lógica de derivación (v=0 = MENOS SALIDAS, v=100 = MÁS SALIDAS)
| Parámetro | v=0 (MENOS) | v=100 (MÁS) |
|---|---|---|
| exitScoreThresholdBase | 10 | 4 |
| confirmationCycles | 10 | 3 |
| extraLossThresholdPenalty | 3 | 0 |
| minPositionAgeSec | 1800 (30m) | 900 (15m) |
| regimeThresholds.TREND | 10 | 4 |
| regimeThresholds.CHOP | 9 | 4 |
| regimeThresholds.VOLATILE | 10 | 5 |
| señales ruidosas (volumeDrop, stagnation, orderbook) | OFF | ON |
| exchangeFlows | OFF siempre | OFF siempre |

----

## 2026-04-07 — FIX: Panel Dashboard — Layout ordenado + Control del Sistema operable

### Problemas resueltos
1. Gráficas de distinto tamaño y layout desorganizado
2. "Control del Sistema" solo mostraba info (badges) sin controles operables

### Cambios implementados

**`client/src/pages/Dashboard.tsx`**:
- Nuevo layout en 3 filas ordenadas:
  - **Fila 1**: Asset cards (full width, 6 columnas responsive)
  - **Fila 2**: `ChartWidget` + `IdcaPnlWidget` en grid `lg:grid-cols-2` — **igual tamaño, lado a lado**
  - **Fila 3**: `BotControl` | `LivePricesWidget` | `ActivePositionsWidget` — 3 columnas iguales

**`client/src/components/dashboard/BotControl.tsx`** — Reescrito completamente:
- ✅ **Botón INICIAR/DETENER BOT** — llama `POST /api/config { isActive }` con loading state
- ✅ **Toggle LIVE / 🧪 SIM** — llama `POST /api/config { dryRunMode }` con loading state
- ✅ **Selector de Estrategia** — dropdown desplegable (Momentum, Reversión Media, Scalping, Grid)
- ✅ **Selector de Riesgo** — botones BAJO / MEDIO / ALTO con colores activos
- ✅ **Info Exchange** — muestra Kraken / Revolut X
- ✅ **Link a Configuración Avanzada** → `/strategies`
- Todos los controles usan `useMutation` de TanStack Query con invalidación automática

**`client/src/components/dashboard/ChartWidget.tsx`**:
- Eliminado `col-span-2` — ya no necesario con el nuevo layout de columna individual

----

## 2026-04-07 — FIX: DRY_RUN Auto-limpieza al arrancar + Reset API + Estado Alertas

### Cambios implementados

**`server/services/tradingEngine.ts`**:
- `loadDryRunPositionsFromDB()`: **borrado de toda la tabla `dry_run_trades` al arrancar** — cada deploy/restart comienza con simulación limpia (0 posiciones, 0 historial)
- Eliminado el código muerto del loop de reconstrucción de posiciones (ya no tiene sentido si siempre empezamos desde cero)
- `resetDryRunPositions()` (nuevo método público): limpia el mapa en memoria `openPositions` en dry run — llamado desde la API de reset
- Eliminado import `lt` de drizzle-orm (ya no se usa)

**`server/routes/dryrun.routes.ts`**:
- `DELETE /api/dryrun/clear`: ahora también llama `tradingEngine.resetDryRunPositions()` además de borrar la BD, garantizando limpieza completa (BD + memoria)
- Renombrado `_deps` → `deps` para acceder al engine

**`script/clear-dryrun.ts`** (nuevo): script de utilidad standalone para limpiar `dry_run_trades` directamente vía `npx tsx script/clear-dryrun.ts`

### Estado de alertas Telegram en dry run (verificado ✅)
- `tradingEngine.ts` DRY_RUN BUY/SELL: envía `🧪 Trade Simulado [DRY_RUN]` — activo
- `exitManager.ts` time-stop: envía `🧪 [SIM]` prefix — activo
- `exitManager.ts` SL/TP/trailing (`sendSgEventAlert`): envía `🧪 [SIM]` prefix — activo
- **Sin doble-alerta incorrecta**: ExitManager notifica el MOTIVO de salida, tradingEngine notifica la EJECUCIÓN — mensajes complementarios

### Flujo al arrancar en dry run
```
Bot arranca → loadOpenPositionsFromDB() → detecta dryRunMode
  → loadDryRunPositionsFromDB()
    → DELETE FROM dry_run_trades (limpieza total)
    → openPositions.clear()
    → Log: "Listo para iniciar simulación desde cero"
```

----

## 2026-04-07 — FIX: DRY_RUN SELL "matched buy: none" — Matching por lotId en vez de FIFO

### Problema raíz
Al activar el DRY_RUN, ExitManager evaluaba **todas las posiciones simultáneamente** al arrancar. Cuando 133 posiciones disparaban `safeSell` de forma concurrente, el path DRY_RUN SELL buscaba el buy más antiguo por par (FIFO) en vez de buscar el buy específico de esa posición (`lotId`). Resultado: múltiples sells competían para cerrar el mismo buy → colisión de DB → el buy quedaba ya cerrado para la mayoría de sells → `matched buy: none`.

### Causa secundaria
`loadDryRunPositionsFromDB()` cargaba **todas** las posiciones históricas abiertas (incluso de meses atrás), lo que causaba una avalancha masiva de exits al arrancar.

### Cambios implementados

**`server/services/tradingEngine.ts`**:
- Añadido `lotId?` al tipo de `sellContext` en `executeTrade()`
- Importado `lt` de drizzle-orm para comparación de fechas
- DRY_RUN SELL: busca primero por `simTxid = sellContext.lotId` (match exacto). Solo si no encuentra, hace fallback FIFO (sells huérfanos)
- `loadDryRunPositionsFromDB()`: expira automáticamente posiciones DRY_RUN con `status=open` de más de 7 días al arrancar, evitando la cascada masiva de exits

**`server/services/exitManager.ts`**:
- `safeSell()`: inyecta `lotId` en `enrichedSellContext` antes de llamar a `executeTrade()`, garantizando que el SELL siempre lleva el identificador de la posición exacta a cerrar

### Flujo corregido
```
ExitManager.safeSell(lotId=DRY-123, pair=ETH/USD)
  → enrichedSellContext = { ...sellContext, lotId: "DRY-123" }
  → executeTrade(sell, ETH/USD, ..., { lotId: "DRY-123" })
    → busca dry_run_trades WHERE simTxid="DRY-123" AND status="open"
    → encuentra el buy exacto → cierra → log: "matched buy: DRY-123"
```

----

## 2026-04-06 — REFACTOR: Modo DRY RUN — Comportamiento Idéntico al Modo Real

### Problema raíz identificado
El modo Dry Run tenía **4 fallos críticos** que causaban comportamiento completamente diferente al modo real:

1. **Compras infinitas sin ventas**: `executeTrade()` en DRY_RUN retornaba `true` inmediatamente tras persistir el buy en BD, sin añadir la posición al mapa `openPositions`. Como toda la lógica de salida (TP, trailing stop, SL, time-stop) itera sobre `this.openPositions`, **nunca encontraba posiciones que cerrar** → acumulación infinita de compras simuladas sin ventas.

2. **Posiciones perdidas al reiniciar**: `loadOpenPositionsFromDB()` solo cargaba desde la tabla `open_positions` (posiciones reales). En modo dry run, los buys están en `dry_run_trades`. Al reiniciar el bot, el mapa `openPositions` quedaba vacío → el ExitManager nunca evaluaba las posiciones abiertas.

3. **Contaminación de tabla `open_positions`**: `savePositionToDB()`, `updatePositionHighestPriceByLotId()` y `deletePositionFromDBByLotId()` escribían en tablas reales aunque estuviéramos en simulación → podía crear entradas fantasma en `open_positions`.

4. **Alertas Telegram sin prefijo [SIM]**: Las alertas de ExitManager (Break-even activado, Trailing activado, Time-Stop) no distinguían entre modo real y simulación → si se enviaban, no se identificaban como simuladas.

### Solución implementada

#### `server/services/tradingEngine.ts`

**`executeTrade()` — sección DRY_RUN BUY (línea ~5793)**
- Tras persistir el buy en `dry_run_trades`, ahora construye un `OpenPosition` completo con `configSnapshot` de la config actual (incluye todos los parámetros SMART_GUARD: BE, trailing, TP fijo, scale-out).
- Añade la posición al mapa `this.openPositions` con `lotId = simTxid`.
- El ExitManager ya puede evaluar esta posición en cada ciclo → TP, trailing stop, SL y time-stop se disparan normalmente.

**Nuevo método `loadDryRunPositionsFromDB()`**
- En modo dry run, en lugar de cargar `open_positions`, carga los registros `dry_run_trades` con `type="buy"` y `status="open"`.
- Reconstruye el `configSnapshot` con los parámetros actuales de la config (SMART_GUARD).
- Envía alerta Telegram `[SIM] Posiciones DRY_RUN Restauradas` al iniciar.

**`loadOpenPositionsFromDB()`**
- Si `this.dryRunMode`, delega a `loadDryRunPositionsFromDB()` y retorna sin cargar posiciones reales.

**`savePositionToDB()` / `deletePositionFromDBByLotId()` / `updatePositionHighestPriceByLotId()`**
- Añadido `if (this.dryRunMode) return;` al inicio de los tres métodos.
- Las posiciones dry run son **solo en memoria** — no contaminan la tabla `open_positions`.

**`createExitHost()`**
- Añadido `isDryRunMode: () => this.dryRunMode` al objeto host expuesto al ExitManager.

#### `server/services/exitManager.ts`

**`IExitManagerHost` interface**
- Añadido `isDryRunMode(): boolean` al interfaz.

**`sendSgEventAlert()`** (Break-even, Trailing activado/actualizado, Scale-out)
- Prepend `🧪 <b>[SIM]</b>\n` a todos los mensajes Telegram cuando `this.host.isDryRunMode()`.

**`checkTimeStop()`** (ambas ramas: expirado-desactivado y expirado-cerrar)
- Prepend `🧪 <b>[SIM]</b>\n` a los mensajes Telegram de time-stop en modo dry run.

### Flujo corregido en DRY RUN

```
BUY signal → executeTrade(DRY_RUN BUY)
  ├── Persiste en dry_run_trades (status="open")
  ├── Crea OpenPosition(lotId=simTxid) con configSnapshot SMART_GUARD
  ├── Añade a this.openPositions[simTxid]
  └── Envía Telegram: 🧪 [DRY_RUN] Trade Simulado - COMPRA

Cada ciclo → ExitManager.checkStopLossTakeProfit()
  └── Itera this.openPositions → encuentra posición dry run
      ├── checkSmartGuardExit() evalúa TP/BE/trailing/SL
      └── Si trigger → safeSell() → executeTrade(DRY_RUN SELL)
            ├── Persiste sell en dry_run_trades (status="closed")
            ├── Marca buy original como "closed" con P&L calculado
            ├── Envía Telegram: 🧪 [DRY_RUN] Trade Simulado - VENTA
            └── safeSell elimina posición de this.openPositions

Al reiniciar → loadDryRunPositionsFromDB()
  └── Carga open dry_run_trades como posiciones en memoria
```

### Archivos modificados
- `server/services/tradingEngine.ts` — 6 cambios
- `server/services/exitManager.ts` — 4 cambios

### Compilación
TypeScript compila sin errores.

----

## 2026-04-05 — FIX: IDCA Posiciones Importadas Independientes del Motor Autónomo

### Problema
Las posiciones importadas manualmente en IDCA interferían con la lógica autónoma del bot de tres formas:

1. **Bloqueo de nuevas entradas**: `getActiveCycle(pair, mode)` retornaba ciclos importados (tienen `cycleType="main"`) → el bot nunca abría ciclos autónomos mientras hubiera un importado activo.
2. **Inflado de exposición de módulo**: `getAllActiveCycles(mode)` incluía el capital importado → podía superar `maxModuleExposurePct` antes de que el bot desplegara nada.
3. **Inflado de exposición por par**: `getTotalPairExposureUsd` y conteo de ciclos en Plus/Recovery incluían importados → bloqueaba activación de Plus y Recovery cycles.

### Solución
Separación completa de los flujos: importados se gestionan de forma independiente y **no cuentan** para las decisiones autónomas del bot.

### Archivos modificados

#### `server/services/institutionalDca/IdcaRepository.ts`
Añadidas 6 nuevas funciones bot-only (excluyen `isImported=true`):
- `getActiveBotCycle(pair, mode)` — ciclo principal del bot sin importados
- `getActiveImportedCycles(pair, mode)` — solo ciclos importados activos
- `getAllActiveBotCycles(mode)` — todos los ciclos bot activos (exposición módulo)
- `getAllActiveBotCyclesForPair(pair, mode)` — ciclos bot por par (conteo recovery)
- `getTotalBotPairExposureUsd(pair, mode)` — exposición por par sin importados
- `hasActiveBotCycleForPair(pair, mode)` — check de subciclos huérfanos bot

#### `server/services/institutionalDca/IdcaEngine.ts`
5 cambios en el motor:
- `evaluatePair`: Separado en dos flujos independientes. Importados se gestionan en loop propio; bot usa `getActiveBotCycle` sin importar si hay posiciones importadas activas.
- `performEntryCheck`: Usa `getActiveBotCycle` + `getAllActiveBotCycles` para checks de exposición.
- `checkPlusActivation`: Usa `getAllActiveBotCycles` para exposición de par.
- `checkRecoveryActivation`: Usa `getTotalBotPairExposureUsd` + `getAllActiveBotCyclesForPair`.

### Comportamiento resultante
| Aspecto | Antes | Después |
|---------|-------|---------|
| Bot abre ciclo si hay importado activo | ❌ Bloqueado | ✅ Independiente |
| Capital importado vs límite módulo | ❌ Cuenta | ✅ No cuenta |
| Capital importado vs exposición par | ❌ Cuenta | ✅ No cuenta |
| Gestión de importados (TP, safety buys) | ✅ Funciona | ✅ Sigue funcionando |
| PnL/precio de importados actualizado | ✅ Funciona | ✅ Sigue funcionando |

### Migraciones
Ninguna. Solo usa columna `is_imported` existente (schema + migrate.ts sin cambios).

----

## 2026-04-05 — REFACTOR: Dry Run Mode + Dashboard Moderno (8 Fases)

### Resumen ejecutivo
Refactorización completa del sistema en 8 fases autónomas: auditoría de arquitectura, corrección DRY RUN, limpieza backfill, nuevo dashboard operativo, controles unificados, UX moderna, validación TypeScript y cleanup final.

### FASE 1 — Auditoría de Arquitectura
- Mapeadas todas las tablas: `bot_config`, `open_positions`, `trades`, `dry_run_trades`, `bot_events`, `institutional_dca_*`
- Identificadas inconsistencias:
  - DRY RUN no visible en posiciones activas ni dashboard
  - Backfill sin filtros traía 65 operaciones inconsistentes
  - Dashboard con TradeLog/EventsPanel de baja utilidad operativa
  - BotControl solo lectura sin indicador DRY RUN
- Generado `FASE1_AUDITORIA_ARQUITECTURA.md` con mapa completo

### FASE 2 — Corrección DRY RUN
- Verificado aislamiento FIFO: `fifoMatcher.ts` no accede a `dry_run_trades` ✅
- Verificado P&L DRY RUN: FIFO correcto con match BUY/SELL ✅
- No se requirieron cambios en lógica de trading

### FASE 3 — Backfill Defensivo (botón RECUPERAR)
**Archivo:** `server/routes/dryrun.routes.ts`
- Filtro temporal: solo últimos 30 días (parámetro `daysBack` configurable)
- Validaciones obligatorias: `pair`, `type`, `simTxid` presentes
- Validación de formato de pair (debe contener `/`)
- Validación `price > 0` y `volume > 0` (no NaN)
- Idempotencia: detecta duplicados por `simTxid`
- Response incluye `skipReasons` detallados: `{duplicate, missingData, invalidPrice, invalidVolume, invalidPair}`

**Archivo:** `client/src/pages/Terminal.tsx`
- Toast informativo con skip reasons y ventana temporal
- Duración 8 segundos para leer detalles

### FASE 4 — Dashboard Moderno
**Nuevo endpoint:** `GET /api/institutional-dca/performance`
- Curva P&L acumulado IDCA desde ciclos cerrados
- Summary: totalPnlUsd, unrealizedPnlUsd, winRate, activeCycles, wins, losses

**Nuevos componentes:**
- `client/src/components/dashboard/ActivePositionsWidget.tsx`
  - Posiciones abiertas del bot con P&L no realizado calculado en tiempo real
  - Indicadores SmartGuard (SG, TRAIL, BE)
  - Navegación directa al Terminal
  - Estado vacío con botón "Ir a Terminal"
  - Refresh cada 20s
- `client/src/components/dashboard/IdcaPnlWidget.tsx`
  - Gráfica AreaChart (recharts) del P&L acumulado IDCA
  - KPIs: realizado, no realizado, win rate, ciclos
  - Navegación a `/institutional-dca`
  - Estado vacío bien diseñado
  - Refresh cada 30s
- `client/src/components/dashboard/LivePricesWidget.tsx`
  - Precios en tiempo real para pares activos
  - Indicadores de tendencia (TrendingUp/Down/Minus)
  - Indicador "LIVE" con pulso cuando exchange conectado
  - Timestamp de última actualización
  - Refresh cada 15s

**Modificado:** `client/src/components/dashboard/ChartWidget.tsx`
- Botón "Ver →" navega a Terminal
- Título clickeable

**Modificado:** `client/src/pages/Dashboard.tsx`
- Eliminados: `TradeLog`, `EventsPanel`
- Añadidos: `ActivePositionsWidget`, `IdcaPnlWidget`, `LivePricesWidget`
- Nuevo layout: ChartWidget(9) + [BotControl + LivePrices](3) | ActivePositions(7) + IdcaPnlWidget(5)

### FASE 5 — Control de Sistema Unificado
**Modificado:** `client/src/components/dashboard/BotControl.tsx`
- Badge "DRY RUN" en header cuando modo activo
- Banner de alerta ámbar cuando DRY RUN está activo con explicación clara
- Fila "Modo Bot" que muestra DRY RUN / LIVE
- Botón "Configurar / Cambiar Modo" navega a `/strategies`
- Imports añadidos: `Button`, `FlaskConical`, `Settings`, `Link`

### FASE 6 — UX Moderna
- Todos los nuevos widgets con estados vacíos bien diseñados
- Loaders con spinner centrado
- Navegación consistente (Ver →) en todos los widgets
- Badges informativos (modo, estado, conteo)
- Colores semánticos: verde=live/positivo, ámbar=dry-run/simulación, azul=IDCA

### FASE 7 — Validación TypeScript
- `npx tsc --noEmit` → ✅ Sin errores en todos los pasos

### Commits generados
```
990383f feat(fase2): backfill defensivo dry run - filtros temporales, validacion robusta, skip reasons detallados
782c1bb feat(fase3-6): dashboard moderno - ActivePositions, IdcaPnlWidget, LivePrices, BotControl DryRun, IDCA performance endpoint
```

### Archivos modificados (total)
- `server/routes/dryrun.routes.ts` — backfill defensivo
- `server/routes/institutionalDca.routes.ts` — endpoint /performance
- `client/src/pages/Terminal.tsx` — toast backfill mejorado
- `client/src/pages/Dashboard.tsx` — layout nuevo
- `client/src/components/dashboard/BotControl.tsx` — DRY RUN visible + operativo
- `client/src/components/dashboard/ChartWidget.tsx` — navegación
- `client/src/components/dashboard/ActivePositionsWidget.tsx` — NUEVO
- `client/src/components/dashboard/IdcaPnlWidget.tsx` — NUEVO
- `client/src/components/dashboard/LivePricesWidget.tsx` — NUEVO

### Documentación generada
- `FASE1_AUDITORIA_ARQUITECTURA.md`
- `FASE2_CORRECCION_DRY_RUN.md`

----

## 2026-04-09 — FEAT: Cierre manual de posición + P&L en USD en ciclos IDCA

### Nuevas funcionalidades

1. **Botón "Cerrar posición"** en la barra de acciones de cada ciclo abierto (importado o del bot)
   - Disponible para cualquier ciclo con `status !== "closed"`
   - Modal de confirmación muestra: par, modo, cantidad, precio avg entrada, precio actual y P&L no realizado con % + USD
   - Aviso diferenciado LIVE (naranja) vs Simulación (amarillo)
   - En modo LIVE: envía orden de venta real al exchange
   - En modo Simulación: actualiza wallet simulado

2. **P&L en USD** junto con el porcentaje en la cabecera de cada ciclo
   - Formato: `+2.35% (+$47.22)` para ciclos abiertos
   - Campo "Realizado" separado cuando hay PnL ya materializado

### Backend (6 archivos)
- `IdcaTypes.ts`: nuevo orden type `manual_sell`
- `IdcaMessageFormatter.ts`: texto para `manual_sell`
- `IdcaEngine.ts`: función exportada `manualCloseCycle()` — crea orden `manual_sell`, cierra ciclo, actualiza wallet sim, crea evento, envía Telegram
- `institutionalDca.routes.ts`: endpoint `POST /cycles/:id/close-manual`

### Frontend (2 archivos)
- `useInstitutionalDca.ts`: hook `useManualCloseCycle` + interfaz `ManualCloseCycleResult`
- `InstitutionalDca.tsx`: botón, modal, estado, P&L USD

----

## 2026-03-30b — FIX: nextBuyPrice no calculado para ciclos importados con gestión completa

### Problema
Los ciclos importados directamente con `soloSalida=false` mostraban "pendiente de cálculo" para la próxima compra porque `importPosition()` nunca calculaba `nextBuyPrice` ni `skippedSafetyLevels`. Tampoco se recalculaba para ciclos en estado `PAUSED`.

### Causa raíz
1. `importPosition()` creaba el ciclo sin `nextBuyPrice` (null) aunque `soloSalida=false`
2. `rehydrateImportedCycle` solo se llamaba al hacer toggle de `soloSalida=true → false`, no al importar directamente con `soloSalida=false`
3. Para ciclos en estado `paused`/`blocked`, `manageCycle` no ejecutaba ninguna lógica → nextBuyPrice seguía null para siempre

### Solución
1. **`importPosition()`**: calcula `nextBuyPrice`, `skippedSafetyLevels` y `skippedLevelsDetail` usando `calculateEffectiveSafetyLevel` antes de crear el ciclo → los campos se guardan correctos desde el primer tick
2. **`manageCycle()` (self-heal)**: bloque post-switch que recalcula `nextBuyPrice` en CADA TICK para cualquier ciclo importado no-soloSalida con `nextBuyPrice=null`, incluidos `paused`/`blocked` → ciclos existentes se autocorrigen al hacer deploy
3. **UI**: distingue entre "🛒 Sin más niveles disponibles" (`skippedSafetyLevels > 0` + `nextBuyPrice=null`) y "pendiente de cálculo" (`skippedSafetyLevels = 0`)

### Archivos modificados
- `server/services/institutionalDca/IdcaEngine.ts` — importPosition + manageCycle self-heal
- `client/src/pages/InstitutionalDca.tsx` — mensaje UI mejorado

----

## 2026-03-30 — FIX: Filtro ciclos activos + niveles compra + eliminar ciclos (WINDSURF FIX)

### Problemas reportados y solucionados

1. **BTC no aparece en filtro "Activos" modo LIVE**
   - Causa: `getCycles` usaba `eq(status, "active")` (match exacto). Los ciclos BTC con status `tp_armed`, `trailing_active`, etc. no coincidían
   - Solución: Cuando `status === "active"`, ahora filtra por `status != 'closed'` (todos los no-cerrados)
   - Archivo: `server/services/institutionalDca/IdcaRepository.ts`

2. **ETH importada mostraba "sin niveles disponibles"**
   - Causa: La lógica UI no priorizaba la condición `soloSalida` correctamente. Para ciclos con `soloSalida=true`, el flujo caía en la rama genérica mostrando "sin niveles"
   - Solución: Reordenada la lógica: primero comprueba `soloSalida` → luego `nextBuyPrice` → luego "pendiente de cálculo"
   - Archivo: `client/src/pages/InstitutionalDca.tsx`

3. **Eliminar ciclos manualmente (simulation + live)**
   - Nueva función `deleteCycleForce()` en repositorio — borra ciclo + órdenes + eventos
   - Nuevo endpoint `DELETE /api/institutional-dca/cycles/:id/force`
   - Nuevo hook `useDeleteCycleForce()` en frontend
   - Botón "Eliminar ciclo" visible en TODOS los ciclos al expandir (no solo importados)
   - Modal de confirmación con detalle del ciclo y aviso de permanencia
   - Para ciclos LIVE, aviso extra sobre cerrar posición real en exchange
   - Registro de evento `cycle_force_deleted` + notificación Telegram

### Archivos modificados
- `server/services/institutionalDca/IdcaRepository.ts` — filtro active + deleteCycleForce
- `server/routes/institutionalDca.routes.ts` — endpoint DELETE force
- `client/src/hooks/useInstitutionalDca.ts` — hook useDeleteCycleForce
- `client/src/pages/InstitutionalDca.tsx` — UI filtro + niveles + botón eliminar

----

## 2026-03-29 — FEAT: Pestañas Dry Run en Terminal (posiciones + historial simulados)

### Problema
En modo Dry Run el bot generaba señales y enviaba alertas Telegram, pero las posiciones simuladas **no se persistían en la BD** y por tanto **no aparecían en la UI**. El usuario no podía ver qué operaciones se estaban simulando.

### Solución

**1. Nueva tabla `dry_run_trades` (`shared/schema.ts` + migración SQL):**
- Campos: `sim_txid`, `pair`, `type`, `price`, `amount`, `total_usd`, `reason`, `status` (open/closed)
- Para ventas: `entry_sim_txid`, `entry_price`, `realized_pnl_usd`, `realized_pnl_pct`, `closed_at`
- Meta: `strategy_id`, `regime`, `confidence`, `created_at`
- Índices: `status`, `pair`, `created_at DESC`

**2. Persistencia en `executeTrade` (`server/services/tradingEngine.ts`):**
- BUY dry run → inserta registro con `status: "open"`
- SELL dry run → busca el BUY abierto más antiguo (FIFO), calcula P&L, inserta SELL como "closed" y cierra el BUY correspondiente
- Bloque try/catch para que un error de BD no bloquee el flujo de simulación

**3. Endpoints API (`server/routes/dryrun.routes.ts`):**
- `GET /api/dryrun/positions` — Posiciones abiertas (BUYs con status "open")
- `GET /api/dryrun/history` — Historial de ventas simuladas (con paginación)
- `GET /api/dryrun/summary` — Resumen agregado (P&L, win rate, W/L)
- `DELETE /api/dryrun/clear` — Limpiar todos los trades dry run (reset)

**4. UI — 2 pestañas nuevas en Terminal (`client/src/pages/Terminal.tsx`):**
- **DRY RUN**: Posiciones abiertas simuladas con tabla (par, precio, cantidad, total USD, estrategia, razón, fecha). Panel de resumen con P&L realizado, trades cerrados, win rate, W/L. Botones Actualizar y Limpiar.
- **HIST. DRY**: Historial de ventas simuladas con tabla (par, entrada, salida, cantidad, P&L USD, P&L %, razón, fecha). Paginación incluida.
- Esquema de colores **amber** para distinguir visualmente del modo LIVE (cyan).

### Archivos Creados
- `db/migrations/024_create_dry_run_trades.sql`
- `server/routes/dryrun.routes.ts`

### Archivos Modificados
- `shared/schema.ts` — tabla `dryRunTrades`, tipos `DryRunTrade`, `InsertDryRunTrade`
- `server/services/tradingEngine.ts` — persistencia de dry run trades en `executeTrade`
- `server/routes.ts` — registro de `dryrun.routes.ts`
- `client/src/pages/Terminal.tsx` — 2 pestañas nuevas + queries + interfaces

### Build: 0 errores TypeScript

---

## 2026-03-29 — FIX: Errores TypeScript IdcaCycle + Migración SQL completa (WINDSURF FIX)

### Problemas detectados y solucionados

1. **Errores TypeScript: propiedades faltantes en tipo `IdcaCycle`**
   - `EditImportedCycleModal.tsx` fallaba con 5 errores TS:
     - `protectionArmedAt` no existe en tipo `IdcaCycle`
     - `editHistoryJson` no existe en tipo `IdcaCycle` (4 usos)
   - Causa: Se añadieron columnas al esquema DB pero no se actualizó la interfaz TypeScript del cliente
   - Solución: Añadidas 8 propiedades faltantes a `IdcaCycle`:
     - `basePrice`, `basePriceType`, `entryDipPct`
     - `protectionArmedAt`, `protectionStopPrice`
     - `lastManualEditAt`, `lastManualEditReason`, `editHistoryJson`

2. **Migración SQL automática — columnas faltantes añadidas al auto-migrador**
   - Las 6 columnas nuevas faltaban en `storage.ts` → `runSchemaMigration()`:
     - `last_manual_edit_at`, `last_manual_edit_reason`, `edit_history_json`
     - `skipped_safety_levels`, `skipped_levels_detail`
     - `tp_breakdown_json`
   - Ahora se crean automáticamente al arrancar la app (no requiere SQL manual)
   - El sistema existente en `routes.ts` llama `runSchemaMigration()` al startup

### Archivos modificados
- `client/src/hooks/useInstitutionalDca.ts` — interfaz `IdcaCycle` ampliada
- `server/storage.ts` — 6 columnas IDCA añadidas al auto-migrador
- `migrations/add_idca_audit_columns.sql` — migración comprehensiva (backup manual)

### Deploy: Solo hacer deploy, la migración es automática
```bash
cd /opt/krakenbot-staging
git pull origin main
docker compose -f docker-compose.staging.yml up -d --build
```

----

## 2026-03-28 — FIX: Arreglos IDCA - Resumen, Importación, Botones Borrar (WINDSURF FIX v2)

### Problemas reportados y solucionados

1. **Pestaña resumen no carga - queda en loading**
   - Causa: Error de base de datos (columnas faltantes) no se mostraba correctamente
   - Solución: SummaryTab ahora captura y muestra el error con mensaje claro
   - Si el error persiste tras aplicar migración SQL, muestra indicador visual

2. **Formulario importación borra el importe al actualizar**
   - Causa: El cálculo automático de fee sobreescribía el valor manual
   - Solución: 
     - Fee USD solo se recalcula automáticamente si NO fue editado manualmente
     - Capital usado ya no se sobreescribe al cambiar otros campos

3. **Botones borrar órdenes en la UI no estaban implementados**
   - Solución: Implementados en HistoryTab → vista Órdenes
   - Botón individual con icono 🗑️ por cada orden (con confirmación)
   - Botón "Eliminar todas" con selector de modo:
     - Todas las órdenes
     - Solo modo simulation
     - Solo modo live

### Archivos modificados
- `client/src/pages/InstitutionalDca.tsx`
- `client/src/hooks/useInstitutionalDca.ts` (hooks useDeleteOrder, useDeleteAllOrders ya existían)

### Commit: `6dc0b70`

----

## 2026-03-28 — FIX: Reparación Completa IDCA - Migración, Simulación, Órdenes (WINDSURF FIX)

### Problemas reportados y solucionados

1. **Error: columna "last_manual_edit_at" does not exist**
   - Creada migración SQL: `migrations/add_idca_audit_columns.sql`
   - Columnas añadidas: `last_manual_edit_at`, `last_manual_edit_reason`, `edit_history_json`, `skipped_safety_levels`, `skipped_levels_detail`
   - Ejecutar en VPS: `docker exec krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -f /app/migrations/add_idca_audit_columns.sql`

2. **Reset simulación no borra posiciones ni historial**
   - Nueva función `resetSimulation()` en `IdcaRepository.ts`
   - Ahora borra: ciclos de simulación, órdenes asociadas, eventos del modo simulación
   - Retorna estadísticas detalladas: cyclesClosed, ordersDeleted, eventsDeleted

3. **Botones para borrar órdenes en historial**
   - Nuevos endpoints:
     - `DELETE /orders/:id` - Borrar orden individual
     - `DELETE /orders?mode=&cycleId=` - Borrar en masa
   - Nuevas funciones en repositorio: `deleteOrder`, `deleteOrdersByCycle`, `deleteAllOrders`
   - Nuevos hooks React: `useDeleteOrder`, `useDeleteAllOrders`

4. **No carga resumen / No deja cambiar a modo simulación**
   - Verificados endpoints y hooks tras correcciones
   - Si persiste, requiere aplicar migración SQL primero

### Archivos modificados
- `migrations/add_idca_audit_columns.sql` (nuevo)
- `server/services/institutionalDca/IdcaRepository.ts`
- `server/routes/institutionalDca.routes.ts`
- `client/src/hooks/useInstitutionalDca.ts`

### Commit: `cf6fac4`

----


---

## 2026-03-25 — FEAT: Implementación completa Recovery Cycle (Multi-Ciclo por Drawdown Profundo)

### Objetivo
Implementar el sistema completo de ciclos de recuperación por drawdown profundo: cuando un ciclo principal entra en drawdown ≥25%, el bot puede abrir un ciclo recovery adicional con capital reducido y TP conservador.

### Cambios implementados

#### A) Tipos y Schema
- **`IdcaTypes.ts`**: `IdcaCycleType` extendido a `"main" | "plus" | "recovery"`, nuevo `RecoveryConfig` interface con 21 parámetros configurables
- **`shared/schema.ts`**: nueva columna `recovery_config_json` en `institutional_dca_config` con defaults seguros (`enabled: false`)
- **`server/storage.ts`**: migración automática para `recovery_config_json`

#### B) Repository
- **`IdcaRepository.ts`**: 3 nuevas queries: `getActiveRecoveryCycles()`, `getClosedRecoveryCyclesCount()`, `getTotalPairExposureUsd()`

#### C) Engine — 6 funciones nuevas (~600 líneas)
- **`getRecoveryConfig()`**: parser de config JSON con defaults
- **`checkRecoveryActivation()`**: evaluación completa con 7 gate checks (drawdown, max ciclos, exposición, cooldown, market score, capital, rebote)
- **`executeRecoveryEntry()`**: apertura de ciclo recovery con compra base, TP conservador, safety buy levels
- **`manageRecoveryCycle()`**: gestión completa (auto-close si main cierra/recupera, max duración, TP check, trailing, safety buys, risk warning)
- **`checkRecoverySafetyBuy()`**: safety buys del recovery con cooldown de 30min
- **`closeRecoveryCycle()`**: cierre con venta final, PnL, wallet update, evento + Telegram
- **`emitRecoveryRiskWarning()`**: alerta cuando exposición del par se acerca al límite
- Hook en `processPair()` después de la lógica Plus Cycle

#### D) Eventos y Alertas — 5 event types
- `recovery_cycle_eligible` 🟡 — drawdown alcanza umbral, vigilando rebote
- `recovery_cycle_started` 🔄 — ciclo recovery abierto con datos completos
- `recovery_cycle_blocked` 🛡️ — bloqueado por restricciones de seguridad
- `recovery_cycle_closed` 📊 — cerrado con PnL, duración, motivo
- `recovery_cycle_risk_warning` ⚠️ — exposición acumulada elevada

#### E) Catálogo y Formatter
- **`IdcaReasonCatalog.ts`**: 5 nuevas entradas con títulos, templates y emojis
- **`IdcaMessageFormatter.ts`**: 5 nuevos cases en switch de technicalSummary

#### F) UI — IdcaEventCards.tsx
- 5 nuevas entradas en `EVENT_CATALOG` con mensajes humanos contextuales ricos
- Cada evento muestra datos de drawdown, capital, exposición, TP, motivos de bloqueo, resultado PnL
- Mapeo de close reasons a texto humano (TP alcanzado, trailing exit, main cerrado, etc.)

### Parámetros de seguridad (defaults)
- `enabled: false` — deshabilitado por defecto
- `activationDrawdownPct: 25` — solo en drawdown profundo
- `maxRecoveryCyclesPerMain: 1` — máximo 1 recovery por main
- `capitalAllocationPct: 10` — solo 10% del capital del módulo
- `maxRecoveryCapitalUsd: 500` — tope absoluto
- `recoveryTpPctBtc: 2.5` / `recoveryTpPctEth: 3.0` — TP conservador
- `maxRecoveryDurationHours: 168` — máximo 7 días
- `requireReboundConfirmation: true` — no comprar en caída libre

### Archivos modificados (8)
- `server/services/institutionalDca/IdcaTypes.ts`
- `server/services/institutionalDca/IdcaEngine.ts`
- `server/services/institutionalDca/IdcaRepository.ts`
- `server/services/institutionalDca/IdcaReasonCatalog.ts`
- `server/services/institutionalDca/IdcaMessageFormatter.ts`
- `client/src/components/idca/IdcaEventCards.tsx`
- `shared/schema.ts`
- `server/storage.ts`

---

## 2026-03-25 — FEAT: Eventos de revisión de ciclo enriquecidos + Diseño Recovery Cycle

### Objetivo
1. Mejorar los eventos `cycle_management` para que muestren qué evaluó el bot, qué conclusión sacó, y datos de proximidad a triggers.
2. Diseñar el sistema completo de Multi-Ciclo Recovery por Drawdown Profundo (diseño previo a implementación).

### Cambios implementados (Revisión de ciclo)

#### A) IdcaEngine.ts — CycleReviewDiagnosis
- **Nuevo tipo `CycleReviewDiagnosis`**: captura qué revisó el bot (protección, trailing, safety buy, salida), si tomó acción, distancias a triggers, trigger más cercano.
- **`buildReviewConclusion()`**: genera conclusiones contextuales humanas:
  - "Ciclo revisado: muy cerca del próximo safety buy"
  - "Ciclo revisado: protección activa, drawdown profundo"
  - "Trailing activo: precio cerca del stop de protección"
  - "Ciclo revisado: en espera, sin acción"
- **Evento emitido DESPUÉS de evaluación** (antes se emitía antes): ahora incluye `actionTaken` real comparando estado pre/post.
- **Payload enriquecido**: `distToNextSafety`, `distToTp`, `distToProtectionStop`, `distToTrailingActivation`, `nearestTrigger`, `nearestTriggerDist`, `isProtectionArmed`, `actionTaken`.

#### B) IdcaEventCards.tsx — cycle_management visual
- Nuevo entry en catálogo visual con icono 🔵, categoría info.
- `getHumanSummary`: genera texto contextual dinámico basado en PnL, proximidad a triggers, protección.
- **DataPills nuevas** en vista expandida: Dist. Safety Buy, Dist. TP, Dist. Protección, Dist. Trailing, Max Drawdown — con colores semánticos (ámbar si < 1%, verde si cerca de TP).

#### C) IdcaReasonCatalog.ts
- Actualizado `cycle_management`: título "Ciclo bajo seguimiento", template mejorado.

### Diseño Recovery Cycle (solo propuesta)
- Documento completo en `docs/IDCA_RECOVERY_CYCLE_DESIGN.md`
- Incluye: propuesta funcional, `RecoveryConfig` (20+ parámetros), riesgos y mitigaciones, arquitectura backend, 5 event types con mensajes humanos, alertas Telegram con formato visual, cambios UI, distinción visual main/plus/recovery, recomendación final.
- **5 alertas específicas**: `recovery_cycle_eligible`, `recovery_cycle_started`, `recovery_cycle_blocked`, `recovery_cycle_closed`, `recovery_cycle_risk_warning`.

### Archivos modificados
- `server/services/institutionalDca/IdcaEngine.ts` — CycleReviewDiagnosis + evento enriquecido
- `client/src/components/idca/IdcaEventCards.tsx` — cycle_management entry + DataPills de distancias
- `server/services/institutionalDca/IdcaReasonCatalog.ts` — catalog actualizado

### Archivos creados
- `docs/IDCA_RECOVERY_CYCLE_DESIGN.md` — diseño completo de recovery cycle

### Commits
- `8a3d36c` — feat(idca): enriched cycle review events with diagnosis context

---

## 2026-03-25 — FEAT: Rediseño UX completo de Eventos IDCA (tarjetas con doble capa)

### Objetivo
Reemplazar la tabla plana de eventos por un sistema visual moderno de tarjetas con doble capa: humana (siempre visible) + técnica (expandible).

### Cambios implementados
- **Nuevo componente `IdcaEventCards.tsx`** (~530 líneas) con catálogo de 18 event types
- Cada evento: icono, color semántico, título humano, resumen en lenguaje natural, pills de datos clave
- Vista expandida: acción del bot, grid de datos clave, detalle técnico colapsable con JSON copiable
- Colores: verde (positivo), rojo (negativo), ámbar (warning), azul (info), gris (sistema)
- Reemplazados `EventsLogPanel` + `LiveMonitorPanel` antiguos
- Filtros preservados: severidad, tipo, búsqueda, exportación CSV/JSON

### Commit
- `51e167d` — feat(idca): redesign events UI — modern card-based system with dual layer

---

## 2026-03-26 — FEAT: IDCA Visibilidad y Seguimiento (Telegram + UI)

### Objetivo
Mejorar significativamente la visibilidad y seguimiento del módulo IDCA tanto en alertas Telegram como en la interfaz web.

### Cambios realizados

#### A) Telegram — Mensajes ricos y contextuales (`IdcaMessageFormatter.ts`)
- **FormatContext expandido** con 12 nuevos campos: `maxBuyCount`, `nextBuyPrice`, `nextBuyLevelPct`, `protectionActivationPct`, `trailingActivationPct`, `trailingMarginPct`, `totalCapitalReserved`, `totalFeesUsd`, `protectionArmed`, `trailingActive`, `stopPrice`, `prevAvgEntry`
- **`formatTelegramMessage()` reescrito completo** — cada tipo de evento genera un mensaje visual con:
  - Iconos por sección (📦 par, 💵 precio, 📊 cantidad, 💰 capital, etc.)
  - Etiqueta modo `[🧪 SIM]` / `[🟢 LIVE]`
  - Bloques estructurados: datos principales, estado del ciclo, resultado, resumen
  - Comentarios inteligentes contextuales (mejora promedio, compras restantes, resultado)
- **19 tipos de evento** con formato dedicado: cycle_started, base_buy, safety_buy, protection_armed, trailing_activated, tp_armed, trailing_exit, breakeven_exit, emergency_close, buy_blocked, smart_adjustment, module_drawdown, imported_position, imported_closed, plus_cycle_activated, plus_cycle_closed, etc.

#### B) Telegram — Notifier enriquecido (`IdcaTelegramNotifier.ts`)
- **`alertCycleStarted`**: ahora incluye maxBuyCount, nextBuyPrice, protectionActivationPct, trailingActivationPct, totalCapitalReserved
- **`alertBuyExecuted`**: nuevo parámetro `prevAvgEntry` para mostrar mejora del promedio; incluye maxBuyCount, nextBuyPrice, protectionActivationPct, trailingActivationPct, protectionArmed
- **`alertProtectionArmed`**: migrado de HTML hardcoded a usar `formatTelegramMessage()` con trailingActivationPct
- **`alertTrailingActivated`**: migrado de HTML hardcoded a usar `formatTelegramMessage()`
- **`alertTrailingExit`**: añadido avgEntry, capitalUsed, totalFeesUsd (suma fees de todas las órdenes del ciclo)
- **`alertBreakevenExit`**: añadido avgEntry, capitalUsed, durationStr, totalFeesUsd, pnlUsd

#### C) Catálogo de eventos (`IdcaReasonCatalog.ts`)
- Nuevas entradas: `protection_armed`, `trailing_activated` con títulos, plantillas y emojis

#### D) UI — HistoryTab transformado (`InstitutionalDca.tsx`)
- **Vista dual**: botones "Ciclos" / "Órdenes" para elegir perspectiva
- **Vista Ciclos** (nueva, por defecto):
  - Barra agregada: total ciclos, wins/losses/neutral, PnL total
  - Tarjetas por ciclo cerrado con borde color resultado (verde/rojo/gris)
  - Icono resultado (✅/🔴/⚖️), par, modo, badges, duración, compras, motivo cierre
  - PnL en USD y % prominente
  - Expandible con detalle completo:
    - **PnL Breakdown**: capital invertido, realizado bruto, fees, PnL neto, PnL %
    - **Timeline del ciclo**: eventos filtrados (sin cycle_management) con fecha, severidad y título
    - **Tabla de órdenes**: fecha, tipo, lado, precio, cantidad, valor, fees, motivo
- **Vista Órdenes**: tabla plana clásica mantenida como alternativa

#### E) UI — CycleDetailRow mejorado
- **Badges de protección/trailing** para ciclos activos:
  - 🛡️ Protección ARMADA (con precio stop) / Protección pendiente
  - 🎯 Trailing ACTIVO (con margen % y precio máximo) / Trailing pendiente

#### F) UI — Traducciones y hooks
- `EVENT_TITLE_ES`: añadidos `protection_armed`, `trailing_activated`, `imported_position_created`, `imported_position_closed`, `plus_cycle_activated`, `plus_cycle_closed`
- Nuevos hooks: `useIdcaClosedCycles(limit)`, `useIdcaCycleEvents(cycleId)`

#### G) Engine (`IdcaEngine.ts`)
- `checkSafetyBuy`: pasa `prevAvgEntry` al llamar `telegram.alertBuyExecuted()`

### Archivos modificados
1. `server/services/institutionalDca/IdcaMessageFormatter.ts` — FormatContext + formatTelegramMessage rewrite
2. `server/services/institutionalDca/IdcaTelegramNotifier.ts` — Todas las funciones de alerta enriquecidas
3. `server/services/institutionalDca/IdcaReasonCatalog.ts` — 2 nuevas entradas
4. `server/services/institutionalDca/IdcaEngine.ts` — prevAvgEntry en safety buy
5. `client/src/pages/InstitutionalDca.tsx` — HistoryTab rewrite + CycleDetailRow badges + EVENT_TITLE_ES
6. `client/src/hooks/useInstitutionalDca.ts` — 2 nuevos hooks

### Compilación
✅ `tsc --noEmit` limpio, sin errores

---

## 2026-03-24 — REFACTOR: Lógica de salida IDCA + 3 sliders de control

### Problema
La lógica de salida del IDCA tenía dos defectos principales:
1. **Break-even cerraba el ciclo** — Al alcanzar pnl>0.5% y detectar caída, ejecutaba `executeBreakevenExit()` que vendía todo. El BE debería ser solo protección, no salida.
2. **TP era venta parcial dura** — Al alcanzar el `takeProfitPct` (~4%), ejecutaba `armTakeProfit()` que hacía venta parcial inmediata. Debería solo activar trailing sin vender.

### Solución: Nuevo flujo de salida

| Etapa | Antes | Ahora |
|-------|-------|-------|
| +1.0% (configurable) | Nada | **Protección armada**: stop en break-even (NO vende) |
| +3.5% (configurable) | Venta parcial + trailing | **Trailing activado**: tracking máximo (NO vende) |
| Trailing roto | Venta restante | **Cierre real**: vende cuando el trailing salta |
| Precio < stop | Cierre completo (breakeven) | Cierre solo si protección armada y precio cae al stop |

### Cambios realizados

#### A) Schema (`shared/schema.ts`)
- `institutionalDcaAssetConfigs`: 3 nuevos campos
  - `protectionActivationPct` (decimal 5,2, default 1.00) — Slider 1
  - `trailingActivationPct` (decimal 5,2, default 3.50) — Slider 2
  - `trailingMarginPct` (decimal 5,2, default 1.50) — Slider 3
- `institutionalDcaCycles`: 2 nuevos campos
  - `protectionArmedAt` (timestamp) — cuándo se armó la protección
  - `protectionStopPrice` (decimal 18,8) — precio del stop de protección

#### B) Migración SQL (`migrations/add_idca_exit_sliders.sql`)
- ALTER TABLE para ambas tablas con IF NOT EXISTS

#### C) Backend (`server/services/institutionalDca/IdcaEngine.ts`)
- `handleActiveState()` completamente reescrita:
  1. Lee 3 valores de slider desde `assetConfig`
  2. Arma protección (stop en avgEntry) al alcanzar `protectionActivationPct`
  3. Activa trailing (sin venta parcial) al alcanzar `trailingActivationPct`
  4. Cierra ciclo si precio cae a `protectionStopPrice` (protección saltó)
  5. Sigue evaluando safety buys normalmente

#### D) Telegram (`server/services/institutionalDca/IdcaTelegramNotifier.ts`)
- `alertProtectionArmed()` — nueva alerta cuando se arma protección
- `alertTrailingActivated()` — nueva alerta cuando se activa trailing

#### E) Frontend (`client/src/pages/InstitutionalDca.tsx`)
- Sección "Cuándo vender" reemplazada con 3 sliders nuevos:
  - 🔵 **Activación de protección** (0.3–2.5%, polaridad Temprana↔Tardía)
  - 🟢 **Activación del trailing** (1.5–7.0%, polaridad Antes↔Después)
  - 🟠 **Margen del trailing** (0.3–3.5%, polaridad Ceñido↔Amplio)
- Cada slider tiene: título, polaridad, leyenda, bloque dinámico amarillo, detalle técnico
- Resumen visual del flujo: `+1.0% → Protección → +3.5% → Trailing → -1.5% → Cierre`
- Mantiene toggle de Trailing dinámico (ATR) y sección avanzada de guardrails

#### F) Hook (`client/src/hooks/useInstitutionalDca.ts`)
- `IdcaAssetConfig`: añadidos `protectionActivationPct`, `trailingActivationPct`, `trailingMarginPct`

### Ejemplo: antes vs después

**ANTES** (ciclo BTC a $100K, avg entry $97K):
- +0.5%: detecta caída → `executeBreakevenExit()` → **VENDE TODO** a $97.5K
- +4.0%: `armTakeProfit()` → **venta parcial** 30% a $100.9K + trailing

**AHORA** (mismos valores):
- +1.0% ($98K): **arma protección** (stop en $97K), NO vende
- +3.5% ($100.4K): **activa trailing**, NO vende, tracking máximo
- Precio sigue a $102K: trailing sigue, stop sube
- Precio cae -1.5% desde máximo ($100.5K): **cierra** con beneficio real

### Archivos modificados
- `shared/schema.ts` — 5 nuevos campos
- `migrations/add_idca_exit_sliders.sql` — NUEVO
- `server/services/institutionalDca/IdcaEngine.ts` — handleActiveState reescrito
- `server/services/institutionalDca/IdcaTelegramNotifier.ts` — 2 nuevas alertas
- `client/src/pages/InstitutionalDca.tsx` — 3 sliders con UX completa
- `client/src/hooks/useInstitutionalDca.ts` — tipo actualizado

### ⚠️ Acción requerida al deploy
Ejecutar migración en la DB del NAS/VPS:
```sql
-- migrations/add_idca_exit_sliders.sql
```

---

## 2026-03-22 — REFACTOR: Reorganización Settings→Trading + Sliders Maestros

### Objetivo
Mover todo el contenido de trading desde Settings.tsx (Ajustes del Sistema) a Strategies.tsx (Trading), reorganizándolo en tabs temáticos con sliders maestros 0-100, leyendas explicativas y bloques dinámicos amarillos.

### Cambios realizados

#### A) Nuevos componentes creados (`client/src/components/trading/`)
- **`MasterSlider.tsx`** — Componente reutilizable de slider maestro 0-100 con:
  - Etiquetas de polaridad izquierda/derecha
  - Leyenda fija de 2 líneas en español
  - Bloque dinámico amarillo que se actualiza al mover el slider
  - Sección expandible con parámetros reales
  - Función `lerp()` exportada para interpolación lineal
- **`MercadoTab.tsx`** — Tab "Mercado" con:
  - Slider maestro "Protección de Coste" (0-100): controla filtro de spread de forma intuitiva
  - Horario de Trading (movido desde Settings)
  - Detección de Régimen de Mercado + Router por Régimen (movido desde Settings)
- **`RiesgoTab.tsx`** — Tab "Riesgo" con:
  - Slider maestro "Agresividad de Riesgo" (0-100): controla risk per trade y exposición
  - Modo de Posición (SINGLE/DCA/SMART_GUARD) (movido desde Settings)
  - Configuración SMART_GUARD (min entry, max lots) (movido desde Settings)
  - Base de Cálculo de Exposición (movido desde Strategies config avanzado)
- **`SalidasTab.tsx`** — Tab "Salidas" mejorado con:
  - SL/TP/Trailing con leyendas + bloques dinámicos amarillos
  - Motor de Salidas Inteligente (Adaptive Exit Engine) (movido desde Settings)
  - Configuración manual SG (BE, trail, TP fijo, scale-out) (movido desde Settings)
  - Cards de mecanismos avanzados (SmartGuard, Time-Stop, Smart Exit, Circuit Breaker)
- **`EntradasTab.tsx`** — Tab "Entradas" mejorado con:
  - Slider de Exigencia de Señales con leyenda + bloque dinámico amarillo
  - Umbrales por régimen con ajuste fino avanzado
  - Protección Anti-Reentrada con Hybrid Guard

#### B) Modificaciones en `Strategies.tsx`
- Añadidos 2 nuevos tabs: **Mercado** y **Riesgo** (visibles siempre, no solo en modo avanzado)
- Reemplazado contenido inline de tabs Entradas y Salidas por componentes nuevos
- Eliminadas secciones de "Tamaño de Trade" y "Control de Exposición" (ahora en RiesgoTab)
- Eliminadas variables de estado locales no usadas (localSL, localTP, etc.)
- Limpiados imports no usados

#### C) Limpieza de `Settings.tsx`
- Eliminadas ~820 líneas de contenido de trading:
  - Horario de Trading
  - Filtro de Spread (completo con dinámico, umbrales, alertas Telegram)
  - Modo de Posición + config SMART_GUARD completa
  - Detección de Régimen + Router por Régimen
  - Motor de Salida Adaptativo (Adaptive Exit Engine)
  - TradingConfigDashboard (presets + Hybrid Guard)
  - PairOverridesSection + PairOverrideFields
- Limpiada interfaz BotConfig (solo campos de sistema + log retention)
- Eliminado import de TradingConfigDashboard
- Limpiados imports de lucide no usados

### Archivos modificados
- `client/src/components/trading/MasterSlider.tsx` (NUEVO)
- `client/src/components/trading/MercadoTab.tsx` (NUEVO)
- `client/src/components/trading/RiesgoTab.tsx` (NUEVO)
- `client/src/components/trading/SalidasTab.tsx` (NUEVO)
- `client/src/components/trading/EntradasTab.tsx` (NUEVO)
- `client/src/pages/Strategies.tsx` (MODIFICADO — de 980 a ~505 líneas)
- `client/src/pages/Settings.tsx` (MODIFICADO — de 2051 a ~995 líneas)

### Resultado
- Settings.tsx: Solo contenido de sistema (DRY RUN, Telegram, Logs, IA, NAS, System Info)
- Strategies.tsx: Todo el contenido de trading organizado en 8 tabs:
  Configuración | Entradas | Salidas | Mercado | Riesgo | Métricas | Motor | Smart Exit
- 2 sliders maestros nuevos con UX explicativa completa
- Todos los sliders existentes enriquecidos con leyendas y bloques dinámicos
- Compilación TypeScript limpia (0 errores)

---

## 2026-03-21 — HOTFIX CRÍTICO: Multi-SELL / Venta saldo extra (FASE 0)

### Problema
Bug crítico de seguridad en producción: el bot ejecutaba múltiples órdenes SELL sobre la misma posición y/o vendía saldo no asignado (externo/hold) del exchange. Manifestaciones:
1. TimeStop disparaba SELL repetidamente cada ciclo sin eliminar la posición
2. Múltiples flujos de salida (SL/TP, SmartGuard, SmartExit, TimeStop) podían disparar SELL concurrentes sobre el mismo lote en el mismo ciclo
3. La reconciliación "UP" absorbía saldo externo del exchange en la posición del bot
4. Posiciones aparecían como "huérfanas" tras ventas repetidas que agotaban el balance
5. TimeStop se clasificaba como STOP_LOSS en logs/Telegram (taxonomía incorrecta)

### Causas raíz identificadas
1. **TimeStop no limpiaba posición tras venta exitosa** — En `checkSmartGuardExit()`, tras llamar `executeTrade()` para TimeStop, la función hacía `return` sin llamar `deletePosition()` ni `deletePositionFromDBByLotId()`. Siguiente ciclo: posición seguía en memoria → TimeStop re-evaluaba (aún expirada) → otro SELL.
2. **Sin lock de salida por posición** — No existía mecanismo para bloquear SELLs concurrentes. `checkStopLossTakeProfit()` y `evaluateOpenPositionsWithSmartExit()` se ejecutaban secuencialmente en el mismo ciclo y ambos podían disparar SELL sobre el mismo lote. El campo `isClosing` existía en SmartExitEngine pero nunca se establecía.
3. **Reconciliación UP absorbía saldo externo** — Si el balance real del activo era mayor que `position.amount`, el código aumentaba `position.amount` al balance real (para dust ≤$5). Esto podía absorber holdings externos del usuario.
4. **Sin circuit breaker** — No había detección ni bloqueo de intentos de venta repetidos en ventana corta.
5. **Taxonomía TIMESTOP→STOP_LOSS** — La cadena "TimeStop" contiene "stop", lo que provocaba clasificación incorrecta antes de evaluar "timestop" específicamente.

### Solución aplicada

#### A) Exit Lock System (`exitManager.ts`)
- `exitLocks: Map<string, number>` — Lock por lotId con TTL de 2 minutos (auto-release)
- `acquireExitLock(lotId)` / `releaseExitLock(lotId)` / `isExitLocked(lotId)`
- Todo sell ahora requiere lock. Si el lock está tomado, el SELL se bloquea y se logea.

#### B) Circuit Breaker (`exitManager.ts`)
- `sellAttempts: Map<string, number[]>` — Rastreo de intentos por lotId en ventana de 60s
- `checkCircuitBreaker(lotId)` — Máximo 1 intento por ventana
- Si se dispara: log crítico + alerta Telegram + bloqueo del SELL

#### C) safeSell() Method (`exitManager.ts`)
- Método centralizado que integra: circuit breaker → exit lock → cap de cantidad → executeTrade → cleanup
- Garantiza que sellAmount nunca exceda `position.amount`
- Elimina posición de memoria y DB inmediatamente tras éxito

#### D) TimeStop Cleanup Fix (`exitManager.ts`)
- TimeStop ahora usa `safeSell()` que limpia posición automáticamente
- Si safeSell falla, verifica balance real para detectar huérfanas

#### E) Reconciliación UP Eliminada (`exitManager.ts`)
- ELIMINADA la reconciliación hacia arriba (aumentar position.amount al balance real)
- Ahora solo se logea como advertencia: "Balance real mayor — IGNORADO (FASE 0 safe mode)"
- Solo se ajusta posición hacia ABAJO (balance real < registrado)

#### F) SmartGuard Sells Protegidos (`exitManager.ts`)
- Bloque de venta final usa lock + circuit breaker + try/finally
- sellAmount nunca se aumenta por balance real (solo se reduce)
- cappedSellAmount = `Math.min(sellAmount, position.amount)`

#### G) SmartExit Sells Protegidos (`tradingEngine.ts`)
- Usa `position.amount` en lugar de `Math.min(position.amount, assetBalance)`
- Verifica `isExitLocked()` y `checkCircuitBreaker()` antes de intentar SELL
- Adquiere lock, ejecuta en try/finally

#### H) Manual Close Protegido (`tradingEngine.ts`)
- Verifica `isExitLocked()` antes de proceder
- Retorna error si la posición está bloqueada por otro cierre en curso

#### I) Taxonomía Corregida (`tradingEngine.ts`)
- TIMESTOP se detecta ANTES que "STOP" genérico en ambos bloques de clasificación
- Patrón: `"TIMESTOP"` o `("TIME" + "STOP" + "EXPIRADO")` → `"TIME_STOP"`
- STOP_LOSS solo matchea si NO contiene "TIME"

### Archivos modificados
- `server/services/exitManager.ts` — Exit locks, circuit breaker, safeSell, fix TimeStop cleanup, eliminar reconciliación UP, proteger todos los sells
- `server/services/tradingEngine.ts` — Proteger SmartExit sell, manual close, fix taxonomía exitType
- `server/services/botLogger.ts` — Nuevos EventTypes: CIRCUIT_BREAKER_BLOCKED, EXIT_LOCK_BLOCKED, SAFE_SELL_SUCCESS, SAFE_SELL_FAILED

### Validación
- TypeScript compila sin errores (`npx tsc --noEmit`)
- Todos los flujos de salida (TimeStop, SL/TP, Trailing, SmartGuard, SmartExit, Manual) protegidos por exit lock + circuit breaker
- Cantidad de venta limitada estrictamente a position.amount
- Balance externo del exchange nunca absorbido
- Posiciones eliminadas inmediatamente tras venta exitosa

### Riesgos residuales
- Si el exchange tarda >2min en responder y el lock expira, teóricamente podría haber un segundo intento. El circuit breaker de 60s con max 1 intento mitiga esto.
- El FillWatcher asíncrono podría confirmar fills tardíos tras eliminar la posición. Esto es por diseño (fill se registra como trade pero la posición ya no existe).

---

## 2026-03-21 — FEAT: Eventos de gestión de ciclos para visibilidad UI

### Problema
El sistema IDCA mostraba heartbeat logs pero la UI consola seguía sin movimiento. Los ciclos activos (normales e importados) no generaban eventos durante la fase de gestión, solo durante compras/ventas.

### Causa
La función `manageCycle()` actualizaba precios y PnL pero no creaba eventos visibles. La UI solo mostraba eventos de base de datos, no logs genéricos.

### Solución
- **`IdcaEngine.ts`**: Añadido evento `cycle_management` en `manageCycle()` 
- Formato: `Gestión ciclo: PnL=+0.05%, Precio=70924.50`
- Severidad: debug para no saturar el stream principal
- Se ejecuta cada tick para cada ciclo activo

### Archivos modificados
- `server/services/institutionalDca/IdcaEngine.ts` — Eventos de gestión en manageCycle()

### Commit
- `ad7482a` — feat: Add cycle management events for UI visibility

---

## 2026-03-20 — FEAT: Heartbeat logging en IDCA scheduler

### Problema
Tras desplegar los fixes de drawdown/Telegram, la UI mostraba "sin movimiento" en la consola en tiempo real. El scheduler ejecutaba ticks correctamente (health: isRunning=true, tickCount>0, lastError=null) pero no generaba logs visibles porque ningún par cumplía condiciones de compra/venta.

### Causa
La `CONSOLA EN TIEMPO REAL` solo muestra eventos de base de datos (compras, ventas, alertas). Cuando el scheduler evalúa pares sin generar eventos, no hay actividad visible para el usuario.

### Solución
- **`IdcaEngine.ts`**: Añadido log de heartbeat al final de cada tick con formato:
  `[IDCA][TICK #N] mode=X | BTC/USD:+0.5% | ETH/USD:-1.2%`
- Muestra el PnL no realizado de cada par activo, o "waiting" si no hay ciclo, o "ERR" si falló

### Archivos modificados
- `server/services/institutionalDca/IdcaEngine.ts` — Heartbeat logging en runTick

### Commit
- `85bdef3` — feat: Add heartbeat logging to IDCA scheduler ticks for visibility

---

## 2026-03-20 — FIX: Spam de alertas drawdown + cooldown Telegram ignorado

### Problema
Al importar un ciclo manual con importe erróneo, el drawdown del módulo se disparaba (hasta 4190357019.99%). Tras borrar el ciclo erróneo, el drawdown bajó pero seguía superando el límite (44.41% > 15%). El resultado fue **un evento + alerta Telegram CADA MINUTO** (cada tick del scheduler) sin ningún cooldown.

### Causa raíz (2 bugs)

**Bug 1 — Sin cooldown en `checkModuleDrawdown()`**:
La función se ejecuta cada tick (~60s). Cuando detectaba drawdown > max, creaba un nuevo evento en DB + alerta Telegram sin memoria de cuándo fue la última alerta.

**Bug 2 — Telegram `canSend()` bypass**:
`alertModuleDrawdownBreached()` y `alertEmergencyClose()` tenían la condición `if (!enabled && !chatId) return;`. Esto solo retornaba si **ambos** eran falsos. Cuando el cooldown de Telegram estaba activo, `canSend()` devolvía `{ chatId: "algo", enabled: false }`, pero la condición era `true && false = false` → **continuaba enviando**.

### Solución

- **`IdcaEngine.ts`**: Cooldown de 30 minutos entre alertas de drawdown. Re-alerta solo si:
  - Han pasado ≥30 min, O
  - El drawdown saltó ≥5% respecto al último alertado
  - Reset automático del cooldown cuando el drawdown se recupera

- **`IdcaTelegramNotifier.ts`**: Corregida condición `!enabled && !chatId` → `!enabled` en:
  - `alertModuleDrawdownBreached()`
  - `alertEmergencyClose()`

### Archivos modificados
- `server/services/institutionalDca/IdcaEngine.ts` — Cooldown 30min en checkModuleDrawdown
- `server/services/institutionalDca/IdcaTelegramNotifier.ts` — Fix bypass cooldown Telegram

### Commits
- `cb38b99` — fix: Add 30min cooldown to drawdown alerts
- `780cacf` — fix: Telegram cooldown bypass bug

---

## 2026-03-20 — FASE 1: Corrección error nonce + Coordinación API privada

### Problema
Error `EAPI:Invalid nonce` intermitente en Kraken. Auditoría completa determinó que la causa más probable es overlap de deploy (contenedor viejo aún procesando mientras el nuevo arranca, ambos con nonces independientes sobre la misma API key). Dentro de un proceso único, el `krakenRateLimiter` con concurrency=1 ya serializa las llamadas correctamente.

### Causa raíz confirmada
- **Overlap de deploy**: Al reiniciar contenedor Docker, hay una ventana donde dos instancias comparten la misma API key con contadores de nonce independientes en memoria.
- **RevolutX no usa nonce** — usa firma Ed25519 con timestamp. El error `EAPI:Invalid nonce` es 100% Kraken.
- **Nonce en memoria**: `lastNonce` se reseteaba a 0 en cada reinicio, lo que podía generar nonces menores que los del proceso anterior si este aún estaba activo.

### Solución implementada

#### A) NonceManager centralizado (`server/services/exchanges/NonceManager.ts`) — NUEVO
- Generador monotónico: `nonce = max(Date.now() * 1000, lastNonce + 1)`
- **Padding de arranque de 10s**: Al inicializar, `lastNonce = (Date.now() + 10000) * 1000` para garantizar que nonces del nuevo proceso siempre superen cualquier nonce del proceso anterior
- Singleton `krakenNonceManager` exportado
- Stats de diagnóstico: lastNonce, callCount, startupPaddingMs

#### B) BalanceCache compartido (`server/services/exchanges/BalanceCache.ts`) — NUEVO
- Cache con TTL 5s para balances de cualquier exchange
- Evita llamadas redundantes de getBalance() desde múltiples módulos
- Se invalida automáticamente tras placeOrder/cancelOrder
- Stats: hits, misses, entries

#### C) KrakenService mejorado (`server/services/kraken.ts`)
- Usa `krakenNonceManager.generate()` en vez del generador local
- `getBalance()` usa BalanceCache (cache hit evita llamada API)
- `placeOrder()`, `placeOrderRaw()`, `cancelOrder()` invalidan BalanceCache

#### D) RevolutXService mejorado (`server/services/exchanges/RevolutXService.ts`)
- **Rate limiter FIFO**: Cola con 250ms mínimo entre peticiones (configurable via `REVOLUTX_MIN_TIME_MS`)
- `getBalance()` usa BalanceCache
- `placeOrder()` invalida BalanceCache
- Stats de rate limiter expuestas

#### E) krakenRateLimiter mejorado (`server/utils/krakenRateLimiter.ts`)
- Tracking de origen de módulo (campo `origin` opcional en `schedule()`)
- Contadores: totalCalls, totalErrors
- Logging automático para llamadas lentas (>2s) o con error
- Formato: `[KrakenRL] origin=X waited=Yms duration=Zms queue=N`

#### F) ExchangeFactory + Endpoint diagnóstico
- `ExchangeFactory.getDiagnostics()` — retorna estado completo del sistema de coordinación
- Endpoint `GET /api/exchange-diagnostics` — nonce stats, rate limiter stats, balance cache stats, exchange status

### Archivos modificados
- `server/services/exchanges/NonceManager.ts` — NUEVO
- `server/services/exchanges/BalanceCache.ts` — NUEVO
- `server/services/kraken.ts` — NonceManager + BalanceCache
- `server/services/exchanges/RevolutXService.ts` — Rate limiter + BalanceCache
- `server/utils/krakenRateLimiter.ts` — Origin tracking + stats
- `server/services/exchanges/ExchangeFactory.ts` — getDiagnostics()
- `server/routes.ts` — Endpoint /api/exchange-diagnostics

### Verificaciones
- TypeScript build: OK (0 errores)
- Todas las llamadas privadas Kraken siguen pasando por krakenRateLimiter (concurrency=1)
- Nonce padding 10s protege contra overlap de deploy
- BalanceCache reduce llamadas redundantes

---

## 2026-03-20 — FASE 2: Eliminar ciclos manuales/importados

### Descripción
Permite eliminar ciclos manuales/importados que se crearon por error, con validaciones de seguridad y confirmación fuerte.

### Reglas de negocio
1. **Solo ciclos manual/importados** (`isImported=true` OR `sourceType='manual'`)
2. **Sin actividad post-importación** → Hard delete (ciclo + órdenes + eventos)
3. **Con ventas post-importación** → Soft delete (archivado con status='archived')
4. **Ciclos no manuales** → Bloqueado, error 400

### Backend
- `IdcaRepository.deleteManualCycle(cycleId)` — Lógica de eliminación con validaciones
- `DELETE /api/institutional-dca/cycles/:id/manual` — Endpoint con validación, evento de trazabilidad y notificación Telegram
- Evento `manual_cycle_deleted` con payload completo (action, cycleId, pair, reason, deletedBy)
- `IdcaTelegramNotifier.sendRawMessage()` — Para enviar notificación de eliminación

### Frontend
- Hook `useDeleteManualCycle()` — Mutation DELETE con invalidación de queries
- Botón "Eliminar" (icono papelera) visible solo en ciclos manuales/importados no cerrados
- Modal de confirmación con:
  - Datos del ciclo (par, tipo, estado, capital, fecha importación)
  - Aviso de que ciclos con actividad post-importación se archivan
  - Botones Cancelar / Eliminar con loading state
- Toast con resultado: eliminado, archivado, o error

### Archivos modificados
- `server/services/institutionalDca/IdcaRepository.ts` — deleteManualCycle()
- `server/routes/institutionalDca.routes.ts` — DELETE endpoint
- `server/services/institutionalDca/IdcaTelegramNotifier.ts` — sendRawMessage()
- `client/src/hooks/useInstitutionalDca.ts` — useDeleteManualCycle()
- `client/src/pages/InstitutionalDca.tsx` — Botón eliminar + modal confirmación

### Verificaciones
- TypeScript build: OK (0 errores)
- Solo ciclos manuales muestran opción eliminar
- Ciclos no manuales no muestran botón
- Endpoint valida tipo de ciclo antes de eliminar
- Con actividad post-importación → archiva en vez de borrar

---

## 2026-03-20 — FIX: Auto-migración columnas IDCA (ciclos no aparecían)

### Problema
Los ciclos de simulación dejaron de aparecer en el tab "Ciclos" tras el deploy del commit anterior. Causa: las 6 nuevas columnas (`is_manual_cycle`, `exchange_source`, `estimated_fee_pct`, `estimated_fee_usd`, `fees_override_manual`, `import_warning_acknowledged`) fueron añadidas al schema de Drizzle pero no existían en la tabla PostgreSQL real. Drizzle genera `SELECT ... is_manual_cycle ...` y PostgreSQL responde `column does not exist`, haciendo que TODAS las queries de ciclos fallen.

### Solución
- **server/storage.ts** — Añadidas las 6 columnas IDCA al array de migraciones de `runSchemaMigration()` con `ADD COLUMN IF NOT EXISTS`
- **server/routes.ts** — Llamada proactiva a `runSchemaMigration()` justo antes de inicializar el módulo IDCA, para que las columnas existan cuando se registren las rutas

### Resultado
Al hacer deploy, la app automáticamente crea las columnas faltantes al arrancar. No se requiere ejecutar SQL manual ni `drizzle-kit push`.

---

## 2026-03-20 — IDCA: Ciclo Manual + Exchange + Fees + Bug Fix Simulación

### Descripción
Mejora la función "Importar Posición Abierta" para permitir importar posiciones manuales aunque ya haya ciclos activos del mismo par (etiquetándolas como CICLO MANUAL). Añade desplegable de exchange con Revolut X por defecto, autocalcula fees según presets y permite edición manual. Corrige bug de ciclos de simulación no visibles en CyclesTab.

### Archivos Modificados
- **shared/schema.ts** — Nuevas columnas: `is_manual_cycle`, `exchange_source`, `estimated_fee_pct`, `estimated_fee_usd`, `fees_override_manual`, `import_warning_acknowledged`
- **server/services/institutionalDca/IdcaExchangeFeePresets.ts** — NUEVO: Presets de fees por exchange (Revolut X 0.09%, Kraken configurable, Otro)
- **server/services/institutionalDca/IdcaTypes.ts** — Campos nuevos en `ImportPositionRequest`: `isManualCycle`, `exchangeSource`, `estimatedFeePct`, `estimatedFeeUsd`, `feesOverrideManual`, `warningAcknowledged`
- **server/services/institutionalDca/IdcaRepository.ts** — `getImportableStatus()` ahora devuelve `hasActiveCycle` y permite importar siempre (ya no bloquea)
- **server/services/institutionalDca/IdcaEngine.ts** — `importPosition()` relaja validación para manual (solo exige warningAcknowledged), guarda exchange/fees/manual en ciclo
- **server/services/institutionalDca/IdcaMessageFormatter.ts** — FormatContext ampliado con `isManualCycle`, `exchangeSource`, `estimatedFeePct`, `estimatedFeeUsd`
- **server/services/institutionalDca/IdcaTelegramNotifier.ts** — `alertImportedPosition()` con 8 params: manual, exchange, fees, warning convivencia
- **server/routes/institutionalDca.routes.ts** — Nuevo `GET /exchange-fee-presets` + actualizado `POST /import-position` con campos nuevos
- **client/src/hooks/useInstitutionalDca.ts** — `IdcaCycle` ampliado + `useExchangeFeePresets()` hook + `ImportPositionPayload` actualizado + `ImportableStatus` con `hasActiveCycle`
- **client/src/pages/InstitutionalDca.tsx** — Modal reescrito con exchange dropdown, fees auto/manual, warning convivencia con checkbox obligatorio, badges MANUAL + EXCHANGE, detalle expandido con exchange/fees, filtro por mode en CyclesTab (fix bug simulación)

### Características
1. **CICLO MANUAL** — Permite importar posiciones manuales aunque ya existan ciclos activos del mismo par
2. **Exchange dropdown** — Revolut X (defecto), Kraken, Otro con presets de fees
3. **Autocálculo fees** — Fee USD = capital × feePct/100, recalculada al cambiar exchange/cantidad/precio
4. **Fees editables** — Campo editable para % y USD; si se modifica, se marca `feesOverrideManual`
5. **Restaurar fee preset** — Botón "Restaurar fee por defecto del exchange" visible si fee fue editada
6. **Warning convivencia** — Si hay ciclo activo del mismo par, muestra aviso rojo + checkbox obligatorio
7. **Badges visuales** — IMPORTADO (cyan), MANUAL (fuchsia), SOLO SALIDA (amber), GESTIÓN COMPLETA (verde), EXCHANGE (slate)
8. **Detalle expandido** — Muestra exchange, fee%, feeUSD, [fee manual], nota descriptiva para ciclos manuales
9. **Telegram mejorado** — Tipo: CICLO MANUAL, Exchange, Fee estimada %, Fee estimada USD, aviso convivencia
10. **Bug fix** — Filtro por mode (Simulación/Live/Todos modos) en CyclesTab + limit subido a 100

### Notas Técnicas
- Revolut X: maker 0%, taker 0.09% (preset oficial)
- Kraken: fee configurable (no hardcodeada por producto/volumen)
- `isManualCycle = true` si sourceType="manual" O se marca explícitamente
- No se bloquea importación manual con ciclo activo existente; se exige `warningAcknowledged`
- Sin sourceType="manual" y con ciclo activo, SÍ se bloquea (como antes)
- Snapshot ampliado con exchange, fees, feesOverride, hadActiveCycleAtImport

---

## 2026-03-20 — IDCA: Importar Posición Abierta (Import Open Position)

### Descripción
Nueva funcionalidad que permite importar manualmente una posición abierta de BTC o ETH al módulo Institutional DCA. El bot gestiona la posición desde el punto de importación sin reconstruir historial. Incluye modo "Solo Salida" (solo TP/trailing/breakeven) y "Gestión Completa" (compras adicionales + Plus cycles permitidos).

### Archivos Modificados
- **shared/schema.ts** — Nuevas columnas en `institutional_dca_cycles`: `is_imported`, `imported_at`, `source_type`, `managed_by`, `solo_salida`, `import_notes`, `import_snapshot_json`
- **server/services/institutionalDca/IdcaTypes.ts** — Tipos `ImportPositionRequest`, `ImportSourceType`, `ImportManagedBy`
- **server/services/institutionalDca/IdcaRepository.ts** — Funciones `hasActiveCycleForPair()`, `getImportableStatus()`, `createImportedCycle()`
- **server/services/institutionalDca/IdcaReasonCatalog.ts** — Eventos `imported_position_created`, `imported_position_closed`
- **server/services/institutionalDca/IdcaMessageFormatter.ts** — Campos `soloSalida`, `sourceType` en `FormatContext` + switch cases para formateo técnico y Telegram
- **server/services/institutionalDca/IdcaEngine.ts** — Función `importPosition()` exportada + guards en `evaluatePair` (skip plus si soloSalida) y `handleActiveState` (skip safety buys si soloSalida)
- **server/services/institutionalDca/IdcaTelegramNotifier.ts** — Alertas `alertImportedPosition()`, `alertImportedClosed()`
- **server/routes/institutionalDca.routes.ts** — Endpoints `GET /importable-status`, `POST /import-position`, `PATCH /cycles/:id/solo-salida`
- **client/src/hooks/useInstitutionalDca.ts** — Hooks `useImportableStatus()`, `useImportPosition()`, `useToggleSoloSalida()` + campos import en `IdcaCycle`
- **client/src/pages/InstitutionalDca.tsx** — Componente `ImportPositionModal` con formulario 2 pasos + botón "Importar Posición" en CyclesTab + badges IMPORTADO/SOLO SALIDA/GESTIÓN COMPLETA en `CycleDetailRow` + toggle soloSalida en panel expandido

### Características
1. **Modal de importación** — Formulario con par, cantidad, precio medio, capital, origen, solo salida, notas + paso de confirmación
2. **Validaciones** — No permite importar si ya hay ciclo activo para el par; valida campos requeridos y tipos
3. **Modo Solo Salida** — Solo gestiona salidas (TP, trailing, breakeven); no hace compras ni activa Plus
4. **Modo Gestión Completa** — Permite safety buys, Plus cycles y lógica IDCA completa
5. **Toggle en tiempo real** — Se puede cambiar soloSalida en ciclos activos importados desde la UI
6. **Badges visuales** — Indicadores claros de IMPORTADO, SOLO SALIDA o GESTIÓN COMPLETA
7. **Eventos humanos** — `imported_position_created` y `imported_position_closed` con mensajes en español
8. **Alertas Telegram** — Notificaciones al importar y al cerrar posiciones importadas
9. **Snapshot** — Se guarda JSON con datos originales de importación para auditoría
10. **Sin historial falso** — No se crean órdenes ficticias; buyCount=1 como referencia

### Notas Técnicas
- La migración DB se aplica automáticamente por Drizzle push
- Pares permitidos: BTC/USD, ETH/USD
- `sourceType`: manual | normal_bot | exchange | external
- `managedBy`: siempre "idca" al importar
- El ciclo importado usa `cycleType: "main"` para compatibilidad con el motor
- La barra lateral izquierda cyan distingue visualmente los ciclos importados

---

## 2026-03-19 — IDCA: Rediseño Config Tab + Ciclos Expandibles en Resumen

### Commit
- `b2270ea` — Rediseño completo pestaña Config + ciclos expandibles en Resumen

### Cambios

**1. Ciclos expandibles en pestaña Resumen**
- Los ciclos activos en la pestaña Resumen ahora usan `CycleDetailRow` (igual que en Ciclos)
- Se pueden expandir para ver órdenes, TP breakdown, etc. directamente desde el dashboard principal

**2. Rediseño completo de la pestaña Config — 4 bloques**

La pestaña Config se reorganizó de múltiples cards técnicas a **4 bloques claros**:

- **Bloque 1 — Dinero y límites** (sliders rojos): capital asignado, exposición módulo/asset, drawdown, límites combinados BTC/ETH, proteger principal
- **Bloque 2 — Cuándo comprar** (sliders azules): min dip BTC/ETH, smart mode, rebound confirm, bloqueos (breakdown, spread, presión venta), BTC gate, sizing adaptativo, activos habilitados
- **Bloque 3 — Cuándo vender** (sliders verdes): TP base BTC/ETH, trailing BTC/ETH, TP dinámico, trailing dinámico ATR, breakeven, sección colapsable "Ajustes finos del TP dinámico" con guardrails
- **Bloque 4 — Compras extra y Ciclo Plus** (sliders ámbar/cyan): safety orders BTC/ETH, ciclo Plus con reveal condicional (solo visible si está habilitado)

**3. Componentes nuevos**

- **`ColorSlider`** — Slider Radix con dot de color, valor grande visible, descripción. Colores: red, green, blue, cyan, amber, purple
- **`ConfigBlock`** — Card wrapper con icono, título y descripción del bloque
- **`ToggleField` mejorado** — Ahora acepta prop `desc` para mostrar explicación debajo del toggle

**4. Mejoras UX**

- Cada control tiene explicación en castellano visible (no oculta en tooltip)
- Sliders estilo Estrategias: anchos, con valor numérico grande, coloreados por tipo
- Sección avanzada TP colapsable para no saturar la vista principal
- Plus config solo visible cuando está habilitado (progressive disclosure)
- Más separación vertical, divisores suaves, cards limpias

### Archivos Modificados
- `client/src/pages/InstitutionalDca.tsx`

### Verificación
- ✅ TypeScript compila limpio (0 errores)
- ✅ No se modificó backend ni lógica
- ✅ Todos los campos de configuración preservados

---

## 2026-03-20 — IDCA: Expansión Triple — Vista Expandible + TP Dinámico + Ciclo Plus

### Resumen
Implementación en 3 fases continuas de mejoras al módulo Institutional DCA:
1. **FASE 1** — Vista expandible de ciclos con lazy loading de órdenes
2. **FASE 2** — Take Profit Dinámico con config JSONB, cálculo centralizado y sliders UI
3. **FASE 3** — Ciclo Plus táctico con activación, entradas, cierre y eventos

### Commits
- `e56af96` — FASE 1: Vista expandible de ciclos
- `40e3110` — FASE 2: Dynamic Take Profit system + Plus Cycle config UI
- `2f4a7ed` — FASE 3: Ciclo Plus complete engine + events + UI

### FASE 1 — Vista Expandible de Ciclos
- **useIdcaCycleOrders** hook con lazy loading y caching por ciclo
- **CycleDetailRow** con chevron expand/collapse
- Subtabla de órdenes con fecha, tipo, lado, precio, cantidad, valor, fees, slippage, motivo humano
- Totales acumulados al pie de la subtabla

### FASE 2 — Take Profit Dinámico
**Migración 021:**
- Config: `dynamic_tp_config_json` JSONB, `plus_config_json` JSONB
- Cycles: `tp_breakdown_json` JSONB, `cycle_type` TEXT, `parent_cycle_id` INT, `plus_cycles_completed` INT

**Tipos:**
- `DynamicTpConfig` (20 campos: base TP, reducciones, ajustes vol/rebote, guardrails main/plus)
- `TpBreakdown` (resultado desglosado del cálculo)
- `DynamicTpInput`, `PlusConfig`, `IdcaCycleType`

**SmartLayer:**
- `computeDynamicTakeProfit()` — evolución de `computeAdaptiveTp` con 4 factores: base → buyCount adj → volatility adj → rebound/score adj → clamp guardrails

**Engine:**
- `getDynamicTpConfig()` + `getReboundStrength()` helpers
- Ambos call sites de `computeAdaptiveTp` reemplazados por `computeDynamicTakeProfit`
- `tpBreakdownJson` almacenado en ciclo al crear y en cada safety buy

**UI:**
- `SliderField` component reutilizable
- `DynamicTpConfigSection` — 4 grupos: Base TP, Ajustes por Compras, Rebote/Volatilidad, Guardrails Main/Plus
- `PlusCycleConfigSection` — 4 grupos: Activación, Capital/Riesgo, Entradas, Salida
- TP breakdown inline en ciclos expandidos

### FASE 3 — Ciclo Plus
**Repository:**
- `getActivePlusCycle(pair, mode, parentCycleId)` — busca plus activo por parent
- `getClosedPlusCyclesCount(parentCycleId)` — cuenta plus cerrados
- `getActiveCycle` ahora filtra por `cycleType='main'`

**Engine — Activación (`checkPlusActivation`):**
5 guardias secuenciales:
1. Main agotado (todas las safety orders usadas)
2. Max plus cycles por main no alcanzado
3. Dip extra desde avg del main ≥ `activationExtraDipPct`
4. Rebound confirmado (si configurado)
5. Exposición por asset dentro de límites

**Engine — Gestión (`managePlusCycle`):**
- PnL update cada tick
- Auto-close si main cierra (`autoCloseIfMainClosed`)
- TP check → cierre directo (sin partial sell)
- Trailing logic con trailing pct específico de plus
- Safety buys con cooldown + dip steps + dynamic TP recalc

**Engine — Cierre (`closePlusCycle`):**
- Final sell con fees/slippage
- Realized PnL calculation
- Simulation wallet update
- Live sell execution
- Human event + Telegram notification

**Eventos:**
- `plus_cycle_activated` — "Ciclo Plus activado"
- `plus_safety_buy_executed` — "Compra de seguridad Plus ejecutada"
- `plus_cycle_closed` — "Ciclo Plus cerrado"
- `FormatContext` extendido: `parentCycleId`, `realizedPnl`, `closeReason`

**UI:**
- Badge PLUS púrpura en ciclos tipo plus
- Parent cycle ID en info line
- TP% actual visible en resumen de ciclo

### Archivos Modificados
- `db/migrations/021_idca_dynamic_tp.sql` (NUEVO)
- `script/migrate.ts`
- `shared/schema.ts`
- `server/services/institutionalDca/IdcaTypes.ts`
- `server/services/institutionalDca/IdcaSmartLayer.ts`
- `server/services/institutionalDca/IdcaEngine.ts`
- `server/services/institutionalDca/IdcaRepository.ts`
- `server/services/institutionalDca/IdcaReasonCatalog.ts`
- `server/services/institutionalDca/IdcaMessageFormatter.ts`
- `client/src/hooks/useInstitutionalDca.ts`
- `client/src/pages/InstitutionalDca.tsx`

### Verificación
- ✅ TypeScript compila limpio (`npx tsc --noEmit` — 0 errors)
- ✅ Migración 021 registrada en migrate.ts
- ✅ Plus desactivado por defecto (`enabled: false`)
- ✅ Dynamic TP backward compatible (usa adaptive TP toggle existente)

### Deploy STG
```bash
cd /opt/krakenbot-staging
git pull origin main
docker compose -f docker-compose.staging.yml up -d --build
# Migración 021 se ejecuta automáticamente al arrancar
```

---

## 2026-03-19 — IDCA: Sistema de Mensajes Humanos Dual (Castellano Natural + Técnico)

### Cambio
Refactorización completa del sistema de logs, eventos y alertas del módulo Institutional DCA.
Se implementó un sistema de mensajes de dos niveles: explicación humana en castellano natural + resumen técnico compacto.

**Arquitectura nueva:**
1. **IdcaReasonCatalog.ts** — Catálogo centralizado de ~35 reason_codes con títulos humanos, templates de mensajes en castellano, emojis y severidades por defecto
2. **IdcaMessageFormatter.ts** — Formatter centralizado que recibe contexto del evento y genera: `humanTitle`, `humanMessage`, `technicalSummary`. Incluye formatters específicos para Telegram, Monitor y Orders
3. **Integración en IdcaEngine.ts** — Helper `createHumanEvent()` que envuelve `repo.createEvent()` con generación automática de campos humanos. Todos los `createEvent` y `createOrder` del engine ahora generan campos humanos
4. **Telegram reformateado** — Todas las alertas de `IdcaTelegramNotifier.ts` usan `formatTelegramMessage()` del formatter centralizado. Mensajes en castellano con estructura: título + explicación + datos estructurados
5. **UI Monitor Tiempo Real** — Muestra líneas con formato: `[fecha] SEVERIDAD PAR | Título humano | Resumen técnico`
6. **UI Log de Eventos** — Nuevas columnas: Motivo (humanTitle), Detalle técnico (technicalSummary), Tipo interno (eventType). Filas clickeables que expanden la explicación humana completa
7. **UI Historial de Órdenes** — Columna Motivo muestra `humanReason` en vez de `triggerReason` técnico

**Campos nuevos en BD (migración 020):**
- `institutional_dca_events`: `reason_code`, `human_title`, `human_message`, `technical_summary`
- `institutional_dca_orders`: `human_reason`

**Compatibilidad:** No se eliminó ningún campo existente. Los campos `event_type`, `message`, `trigger_reason` siguen presentes. La lógica, filtros y API existentes no se rompen.

### Archivos Creados
- `server/services/institutionalDca/IdcaReasonCatalog.ts`
- `server/services/institutionalDca/IdcaMessageFormatter.ts`
- `db/migrations/020_idca_human_messages.sql`

### Archivos Modificados
- `shared/schema.ts` — Añadidos campos humanos en events y orders
- `script/migrate.ts` — Registrada migración 020
- `server/services/institutionalDca/IdcaEngine.ts` — Import formatter, helper createHumanEvent, todos los createEvent/createOrder usan campos humanos
- `server/services/institutionalDca/IdcaTelegramNotifier.ts` — Todas las alertas usan formatTelegramMessage centralizado
- `client/src/pages/InstitutionalDca.tsx` — Monitor con líneas humanas, Log con columnas humanas expandibles, Historial con humanReason

---

## 2026-03-18 — IDCA Nueva Pestaña "Guía" con Documentación Completa

### Cambio
Añadida pestaña "Guía" al módulo Institutional DCA con documentación completa del módulo.

**Secciones incluidas:**
1. **¿Qué es Institutional DCA?** — Explicación del concepto y funcionamiento de ciclos de compra
2. **Independencia del Bot Principal** — Detalla que IDCA es 100% independiente (BD, scheduler, capital, compras, ventas) con excepción de Pausa Global
3. **Barra de Controles** — Documentación de IDCA ON/OFF, modos (Disabled/Simulation/Live), Pausar Global, Emergency Close
4. **Pestañas del Módulo** — Descripción de cada una de las 8 pestañas
5. **Configuración Detallada** — Explicación de cada campo: Capital y Exposición, Smart Mode, Config por Asset
6. **Simulación vs Live** — Tabla comparativa con diferencias exactas
7. **Ciclo de Vida de una Operación** — Flujo paso a paso: detección dip → compra base → safety orders → trailing → cierre
8. **Preguntas Frecuentes** — 7 preguntas comunes sobre independencia, modos, emergencia, reinicios

### Archivos Modificados
- `client/src/pages/InstitutionalDca.tsx` — Añadido `GuideTab`, `GuideSection`, icono `BookOpen`, grid 8 columnas

---

## 2026-03-18 — IDCA Pestaña Eventos Mejorada: Monitor Tiempo Real + Log

### Cambio
Reescrita la pestaña "Eventos" del módulo IDCA con dos subventanas:

**1. Monitor Tiempo Real:**
- Barra de estado: scheduler activo/detenido, modo, toggle, pausa global, ticks, último tick, último error
- Consola estilo terminal (fondo negro, font-mono) con eventos coloreados por severidad
- Auto-scroll con botón pausar/reanudar
- Botón copiar al portapapeles
- Botón descargar como `.log`
- Refresh automático cada 10-15s vía React Query

**2. Log de Eventos:**
- Filtros: severidad (info/warn/error/critical), tipo de evento (dropdown dinámico), búsqueda texto libre
- Tabla completa: severidad, fecha, tipo, par, modo, mensaje, ID
- Coloreado por severidad (fondo + texto)
- Cabecera sticky al hacer scroll
- Contador de resultados filtrados vs total
- Copiar todos los filtrados al portapapeles
- Descargar como CSV
- Descargar como JSON

### Archivos Modificados
- `client/src/pages/InstitutionalDca.tsx` — Reescrita `EventsTab()` con `LiveMonitorPanel()` y `EventsLogPanel()`

### Imports añadidos
- React: `useRef`, `useEffect`, `useCallback`
- Lucide: `ClipboardCheck`, `Copy`, `Filter`, `Radio`, `Search`, `Terminal`

---

## 2026-03-18 — IDCA Auto-Migración en script/migrate.ts

### Cambio
Añadida la ejecución automática de `db/migrations/019_institutional_dca.sql` al script de auto-migración `script/migrate.ts`, siguiendo el patrón `tryExecuteFile()` existente.

### Archivos Modificados
- `script/migrate.ts` — Añadido bloque `INSTITUTIONAL DCA MODULE (019)` al final de `runMigration()`.

### Cadena de ejecución
1. `Dockerfile` → `CMD ["sh", "-c", "npx tsx script/migrate.ts && npm start"]`
2. `docker-compose.yml` → `npx tsx script/migrate.ts && npm start`
3. `script/migrate.ts` → `tryExecuteFile(db, "019_institutional_dca.sql", "institutional_dca")`

### Resultado
La migración SQL se ejecuta automáticamente al arrancar el contenedor Docker. No requiere intervención manual. Es idempotente (CREATE TABLE IF NOT EXISTS + INSERT WHERE NOT EXISTS).

---

## 2026-07-XX — MÓDULO INSTITUTIONAL DCA (IDCA) — Implementación Completa

### Objetivo
Nuevo módulo independiente de DCA institucional, completamente aislado del bot principal. Opera solo BTC/USD y ETH/USD con capital reservado, modos simulation/live, smart mode con indicadores gratuitos, y UI completa con 7 subpestañas.

### Archivos Creados (11 nuevos)

#### Backend
- **`shared/schema.ts`** — 9 tablas nuevas añadidas al final:
  - `trading_engine_controls` — Toggles independientes (normal bot + IDCA + global pause)
  - `institutional_dca_config` — Config global del módulo (~60 campos)
  - `institutional_dca_asset_configs` — Config por par (BTC/USD, ETH/USD)
  - `institutional_dca_cycles` — Ciclos DCA con estado completo
  - `institutional_dca_orders` — Órdenes granulares con fees/slippage
  - `institutional_dca_events` — Audit trail completo
  - `institutional_dca_backtests` — Resultados de backtests
  - `institutional_dca_simulation_wallet` — Wallet virtual para simulación
  - `institutional_dca_ohlcv_cache` — Cache local de velas OHLCV
- **`db/migrations/019_institutional_dca.sql`** — Migración SQL con CREATE TABLE, indexes y seed data
- **`server/services/institutionalDca/IdcaRepository.ts`** — Data access layer completo (CRUD para todas las tablas)
- **`server/services/institutionalDca/IdcaTypes.ts`** — Types, enums, interfaces del módulo
- **`server/services/institutionalDca/IdcaSmartLayer.ts`** — Smart mode: ATR, EMA, RSI, market score (0-100), trailing dinámico, TP adaptativo, sizing adaptativo, rebound detection, learning micro-adjustments
- **`server/services/institutionalDca/IdcaTelegramNotifier.ts`** — Alertas Telegram propias con prefijo [SIMULACIÓN], cooldown, toggles por tipo
- **`server/services/institutionalDca/IdcaEngine.ts`** — Motor principal con scheduler independiente, engines de entry/safety/TP/trailing/breakeven/emergency, mode transitions, drawdown check
- **`server/services/institutionalDca/index.ts`** — Barrel export
- **`server/routes/institutionalDca.routes.ts`** — 20+ endpoints API bajo `/api/institutional-dca/*` incluyendo CRUD, summary, emergency close, health, telegram test, export CSV

#### Frontend
- **`client/src/hooks/useInstitutionalDca.ts`** — 15+ hooks React Query con mutations
- **`client/src/pages/InstitutionalDca.tsx`** — Página completa con 7 subpestañas: Resumen, Config, Ciclos, Historial, Simulación, Eventos, Telegram

### Archivos Modificados (3)
- **`server/routes.ts`** — Registro de rutas IDCA + auto-start scheduler al inicio
- **`client/src/App.tsx`** — Ruta `/institutional-dca` añadida
- **`client/src/components/dashboard/Nav.tsx`** — Enlace "IDCA" en navegación con icono CircleDollarSign

### Características Implementadas
- **Aislamiento total** — Sin compartir lógica, tablas, posiciones ni PnL con bot principal
- **Toggles independientes** — normal_bot_enabled, institutional_dca_enabled, global_trading_pause
- **Modos** — disabled / simulation (wallet virtual, fees simulados) / live (órdenes reales)
- **Smart Mode gratuito** — Market score compuesto, ATR trailing dinámico, TP adaptativo por buyCount y volatilidad, sizing adaptativo (aggressive/balanced/defensive), BTC gate para ETH, learning con micro-ajustes
- **Safety Orders** — Niveles configurables por par con cooldown entre compras
- **TP/Trailing** — Venta parcial dinámica + trailing stop con soporte breakeven
- **Emergency Close** — Botón de pánico que cierra todas las posiciones IDCA
- **Max Drawdown Global** — Pausa automática del módulo al superar límite
- **Telegram propio** — Alertas independientes con toggles granulares, prefijo [SIMULACIÓN]
- **Export CSV** — Descarga de órdenes y ciclos en formato CSV
- **Health endpoint** — Estado del scheduler, último tick, errores

### Notas Técnicas
- El módulo usa `ExchangeFactory` para obtener precios y datos OHLCV (igual que el bot principal)
- Los live orders se loguean pero no se ejecutan automáticamente hasta validación en staging
- La simulación aplica fees (0.4%) y slippage (0.1%) configurables
- El scheduler corre cada 60s por defecto, configurable desde DB/UI

---

## 2026-01-XX — FASE C: Unified Entry Gate — runUnifiedEntryGate + Guard C1 + FillWatcher SELL snapshot

### Objetivo
Cerrar el riesgo crítico de bypass de hard guards en cycle mode, unificar la arquitectura de entrada BUY para todos los pipelines, añadir logs estructurados de trazabilidad, alertas Telegram al bloquear, y completar el snapshot SELL post-fill para órdenes asíncronas.

### Mapa de pipelines auditado

| Función | Pipeline | EntryDecisionContext | evaluateHardGuards | executeTrade("buy") |
|---|---|---|---|---|
| `analyzeWithCandleStrategy` (ln 1575) | candle | ✅ ln 1638 | ✅ ln 1687 | — (retorna señal) |
| `analyzePairAndTradeWithCandles` (ln 4046) | candle | (usa señal previa) | (evaluado arriba) | ✅ ln 4917 |
| `analyzePairAndTrade` (ln 3037) | cycle | ❌ | ❌ (previo) | ✅ ln 3846 |

**Gap crítico:** cycle mode usaba `analyzeWithStrategy` (ticker-based, sin candle data) → sin guards de calidad → riesgo de BUY en TRANSITION sin validación.

### Cambios implementados

#### 1. `EntryDecisionContext.ts` — `runUnifiedEntryGate()`
- Nuevo interfaz `UnifiedEntryGateParams` / `UnifiedEntryGateResult`
- Función `runUnifiedEntryGate()` — gate único obligatorio para todos los pipelines BUY
- **Guard C1: `CYCLE_TRANSITION_LOW_CONFIDENCE`**: bloquea cycle mode en TRANSITION si `signalConfidence < 0.80` (proxy de calidad sin candle data, vs umbral estándar 0.60)
- Para candle/early_momentum: acepta `entryCtx` + `guardResult` ya evaluados, los propaga sin re-evaluar
- Genera `decisionId` único por decisión (`ugd-{pair}-{pipeline}-{ts}`)

#### 2. `tradingEngine.ts` — Logs estructurados en TODOS los pipelines

**Candle mode (`analyzeWithCandleStrategy`):**
- `[ENTRY_PIPELINE]` al inicio del bloque BUY con pipeline/strategy/regime/confidence/signals
- `[ENTRY_APPROVED]` después de que guards pasan

**Candle mode (`analyzePairAndTradeWithCandles`):**
- `[ENTRY_ORDER_SUBMIT]` justo antes de `executeTrade("buy")` con volume/usd/price

**Cycle mode (`analyzePairAndTrade`):**
- `[ENTRY_PIPELINE]` al inicio del bloque BUY
- `runUnifiedEntryGate()` antes de `executeTrade` → Guard C1
- `[ENTRY_HARD_GUARD_BLOCK]` + `updatePairTrace(blockReasonCode: "HARD_GUARD")` + Telegram `sendSignalRejectionAlert` cuando guard bloquea
- `[ENTRY_HARD_GUARD_WARN]` para warnings no-bloqueantes
- `[ENTRY_APPROVED]` + `[ENTRY_ORDER_SUBMIT]` cuando gate aprueba

#### 3. `tradingEngine.ts` — `BlockReasonCode`
- Añadido `"HARD_GUARD"` al union type `BlockReasonCode`

#### 4. `FillWatcher.ts` — `onSellCompleted` callback
- Nuevo campo `onSellCompleted` en `WatcherConfig` con summary completo: `exitPrice`, `totalAmount`, `totalCostUsd`, `pnlUsd`, `pnlPct`, `feeUsd`, `entryPrice`, `executedAt`
- Llamado en **ambos** caminos de fill SELL: con posición (ln 614) y sin posición (ln 705)
- En `tradingEngine.ts`: callback implementado en SELL FillWatcher → `[FILL_SELL_COMPLETED]` log + `sendSellAlert()` con P&L completo, `holdDuration` calculado, `exitType` por reason

### Tags de log del pipeline (verificable en VPS)
```
[ENTRY_PIPELINE]        — inicio de procesamiento BUY (todos los pipelines)
[ENTRY_CONTEXT_BUILT]  — EntryDecisionContext construido (candle/early_momentum)
[ENTRY_DATA_VALIDATION] — validateEntryMetrics ejecutado
[ENTRY_HARD_GUARD_BLOCK] — guard bloquea entrada (candle o cycle)
[ENTRY_HARD_GUARD_WARN]  — warning no-bloqueante
[ENTRY_APPROVED]        — gate aprueba la entrada
[ENTRY_ORDER_SUBMIT]    — orden BUY a punto de enviarse
[FILL_SELL_COMPLETED]   — SELL async confirmado con P&L
```

### Tests (`entryDecisionContext.test.ts`)
- **FASE 6 — 7 nuevos tests (GU1-GU7)**:
  - GU1: cycle TRANSITION conf=70% → BLOCKED (Guard C1)
  - GU2: cycle TRANSITION conf=85% → APPROVED
  - GU3: cycle TREND conf=60% → APPROVED (Guard C1 no aplica)
  - GU4: cycle regime=null conf=60% → APPROVED
  - GU5: candle passthrough guardResult.blocked=false → APPROVED
  - GU6: candle passthrough guardResult bloqueado → propaga blockers
  - GU7: boundary cycle TRANSITION conf=0.80 exacto → APPROVED

**Total tests: 83/83 ✅ · tsc: clean ✅**

---

## 2026-01-XX — FIX: SELL Snapshot Telegram — P&L, entryPrice, holdDuration, exitType

### Objetivo
Corregir la ausencia de datos en las alertas Telegram de venta (SELL snapshots). Las alertas llegaban vacías (sin P&L, sin precio de entrada, sin duración) porque los datos ya computados no se pasaban al método de notificación.

### Causa Raíz — ROOT CAUSE

**`executeTrade` SELL path: P&L computado pero no pasado a sendSellAlert**

La función `executeTrade` calcula P&L completo en dos lugares:
1. Líneas 5977-6001: `tradeRealizedPnlUsd`, `tradeRealizedPnlPct` — accesibles en scope exterior
2. Líneas 6274-6285: `pnlGross`, `pnlNet` — scoped al `if(sellContext)` interior

Pero al llamar `sendSellAlert` en línea ~6386, se pasaba:
- ❌ `pnlUsd`: no pasado (comentario "will be calculated by calling function" — mentira, nadie lo hacía)
- ❌ `pnlPct`: no pasado
- ❌ `entryPrice`: no pasado
- ❌ `openedAt`: no pasado
- ❌ `holdDuration`: no pasado
- ❌ `exitType`: detección case-sensitive → "Stop-Loss" NO contiene "STOP" → todos clasificados como "MANUAL"

**Consecuencia:** El template `buildTradeSellHTML` mostraba "N/D" en P&L, sin precio entrada, sin duración, exitType="MANUAL" para todo.

### Auditoría de pipelines de entrada (FASE A3)
| Pipeline | Usa evaluateHardGuards | Observación |
|---|---|---|
| `analyzePairAndTradeWithCandles` (candle mode) | ✅ | Guards 1-6 activos |
| Early Momentum dentro de candle mode | ✅ | Guards 1-6 activos |
| `analyzePairAndTrade` (cycle mode, ln 3801) | ❌ | NO llama evaluateHardGuards — RIESGO RESIDUAL documentado |

### Cambios Implementados

**1. telegram/templates.ts — SimpleTradeSellContext extendido**
- Añadidos: `entryPrice?: number | string`, `regime?: string`
- `buildTradeSellHTML`: muestra precio entrada (📌), régimen y estrategia cuando disponibles
- Trigger truncado a 120 chars para evitar mensajes gigantes con reasons largas de Smart Exit

**2. telegram.ts — sendSellAlert actualizado**
- Nuevos campos opcionales en ctx: `entryPrice`, `regime`, `strategyLabel`
- Pasa los nuevos campos a `SimpleTradeSellContext`

**3. tradingEngine.ts — executeTrade SELL path (fix principal)**
- Usa `tradeRealizedPnlUsd` (ya en scope) → `netPnlUsd`
- Calcula `pnlGross` y `pnlPct` gross desde `sellContext.entryPrice`
- Calcula `feeTotal` como `|gross - net|`
- Extrae `openedAt` y `holdDuration` de `sellContext.openedAt`
- `exitType` detection: case-insensitive, cubre STOP_LOSS, TAKE_PROFIT, BREAK_EVEN, TRAILING_STOP, TIME_STOP, SMART_EXIT, SCALE_OUT, EMERGENCY, MANUAL
- Pasa `regime` desde `strategyMeta`, `strategyLabel` desde var ya computada

**4. tradingEngine.ts — manualClose**
- Añadido `entryPrice: entryPrice` al `sendSellAlert` (ya tenía P&L correcto)

### Pipelines de venta — Única fuente de verdad
| Path | Via | Snapshot | Datos |
|---|---|---|---|
| Smart Exit | `executeTrade` | ✅ CORREGIDO | P&L + entryPrice + holdDuration |
| SL / TP / Trailing | `executeTrade` (via ExitManager) | ✅ CORREGIDO | P&L + entryPrice + holdDuration |
| Time Stop | `executeTrade` (via ExitManager) | ✅ CORREGIDO | P&L + entryPrice + holdDuration |
| Break Even / Scale Out | `executeTrade` (via ExitManager) | ✅ CORREGIDO | P&L + entryPrice + holdDuration |
| Cierre Manual (Live) | `manualClose` directa | ✅ ya funcionaba | Ahora + entryPrice |
| Cierre Manual (DRY_RUN) | inline en manualClose | ✅ funciona | basic template |
| PendingFill SELL (async Kraken) | FillWatcher | ⚠️ Solo "pending" message | FillWatcher no envía snapshot post-fill — riesgo residual |

### Riesgos Residuales
- **Cycle mode sin guards**: `analyzePairAndTrade` (cycle) no usa `evaluateHardGuards` — entries con vol bajo en TRANSITION pueden pasar por este pipeline. Requiere sprint separado con QA cuidadoso.
- **PendingFill SELL**: Para órdenes Kraken async, FillWatcher confirma la orden pero no envía SELL snapshot post-fill. El usuario recibe "⏳ Orden SELL enviada" pero no el snapshot completo con P&L. Requiere actualización de FillWatcher.

---

## 2026-01-XX — FIX: Auditoría Anti Round-Trip — Entry Quality Floor + Fee-Aware Exit

### Objetivo
Auditoría completa del flujo Entry → Hold → Smart Exit para identificar y eliminar operaciones round-trip basura (buy-sell casi inmediatas o flat con comisiones negativas). Caso real analizado: BTC/USD compra 12:52, salida 21:40, PnL +0.00% (pérdida neta en comisiones).

### Causa Raíz (ROOT CAUSE) — TIPO A: Entry demasiado laxo

**BTC/USD caso analizado:**
- Entrada: volumeRatio=0.30x, isExpansion=false, regime=TRANSITION, confidence=88%
- Salida 8h48m después: MTF_ALIGNMENT_LOSS(score=2) + STAGNATION(score=1) = 3 = threshold exacto
- PnL: +0.00% gross = pérdida neta tras comisiones

**Por qué pasó el entry:**
- Guard 3 (LOW_VOL_EXTENDED_PRICE) requiere AMBAS condiciones: vol < 0.8x **Y** priceVsEma20 > 0.5%
- Con 0.30x vol pero priceVsEma20=0.149% (< 0.5%), la guard NO se activó
- No existía guard standalone para volumen muy bajo en TRANSITION
- NO_EXPANSION y LOW_VOLUME eran solo warnings (no bloqueantes)

**Por qué el Smart Exit era CORRECTO:**
- MTF degradó a neutral/bearish → MTF_ALIGNMENT_LOSS
- Posición 528 minutos a PnL plano → STAGNATION
- 6/6 ciclos de confirmación → muy conservador
- El Smart Exit funcionó bien; el problema estaba en la entrada

### Protecciones Anti Round-Trip existentes (antes de este fix)
| Protección | Estado | Observación |
|---|---|---|
| `minPositionAgeSec: 30` | ❌ Insuficiente | Solo 30 segundos de gracia |
| `stagnationMinutes: 10` | ✅ Funciona | Espera 10 min mínimo |
| `extraLossThresholdPenalty: 1` | ✅ Funciona | +1 al threshold si PnL≤0 |
| `confirmationCycles: 3-6` | ✅ Conservador | 6/6 en el caso BTC |
| Guard 3: LOW_VOL_EXTENDED_PRICE | ⚠️ Parcial | Requiere ambas condiciones |
| Anti-FOMO (RSI>65+BB%>85) | ✅ Funciona | No aplica a este caso |

### Cambios Implementados

**1. EntryDecisionContext.ts — Guard 5: TRANSITION_LOW_VOLUME (nueva)**
- Bloquea BUY si `volumeRatio < 0.45x` en régimen TRANSITION
- Cubre entradas con participación de mercado insignificante (caso BTC: 0.30x bloqueado)
- Sin condición adicional de precio — volumen bajo solo ya es suficiente en TRANSITION

**2. EntryDecisionContext.ts — Guard 6: TRANSITION_WEAK_SETUP (nueva)**
- Bloquea BUY si `isExpansion=false` Y `volumeRatio < 0.60x` en TRANSITION
- Cubre el rango 0.45x–0.59x cuando el expansión detector confirma que no hay expansión real
- Ambas guards son acumulativas: Guard 5 cubre vol < 0.45, Guard 6 cubre 0.45–0.59 + noExpansion

**3. SmartExitEngine.ts — Fee-Band Threshold Bump (nuevo)**
- Nuevo campo `feeBandPct: number` en `SmartExitConfig` (default: 0.25%)
- Si `|pnlPct| <= feeBandPct` (posición flat dentro del coste de comisiones), se requiere `score >= effectiveThreshold + 1`
- Previene salidas al +0.00% que resultan en pérdida neta
- Nuevo campo `suppressedByFeeBand: boolean` en `SmartExitDecision`
- Nuevo event type `"SUPPRESSED"` en `buildTelegramSnapshot`

**4. tradingEngine.ts — Log + Telegram para exit suprimido**
- Log `[SMART_EXIT_FEE_BAND_SUPPRESS]` con score, threshold y razones cuando se suprime
- Alerta Telegram con subtype `smart_exit_suppressed`

**5. telegram.ts + schema.ts — Nuevo subtype**
- `smart_exit_suppressed` añadido a `AlertSubtype` y `alertPreferencesSchema`
- Configurable desde la UI de Notificaciones

### Umbrales implementados
| Guard | Threshold | Racional |
|---|---|---|
| TRANSITION_LOW_VOLUME | vol < 0.45x | <45% participación = no hay interés real |
| TRANSITION_WEAK_SETUP | isExp=false + vol < 0.60x | Sin expansión detectada + vol bajo = setup débil |
| feeBandPct | 0.25% | Cubre comisiones típicas (maker ~0.10% × 2 + spread) |

### Tests añadidos (FASE 5 — 12 nuevos tests)
- **G5.1-G5.3**: TRANSITION_LOW_VOLUME bloquea con vol=0.30x en TRANSITION
- **G5b**: Guard NO aplica en TREND (selectivo por régimen)
- **G5c**: vol=0.60x en TRANSITION no bloquea Guard5
- **G6.1-G6.2**: TRANSITION_WEAK_SETUP bloquea con isExpansion=false + vol=0.50x
- **G6b**: isExpansion=true + vol=0.50x NO bloquea Guard6
- **G6c**: vol=0.70x (≥ threshold) NO bloquea Guard6
- **G-BTC.1-G-BTC.2**: Caso real BTC/USD confirmado bloqueado
- **Total tests**: 71/71 ✅

### Tags de log para trazabilidad
```
[ENTRY_HARD_GUARD_BLOCK]          → entrada bloqueada (ya existía)
[SMART_EXIT_FEE_BAND_SUPPRESS]    → exit suprimido por fee-band (nuevo)
```
Filtrar en VPS:
```bash
docker compose -f docker-compose.staging.yml logs -f | grep -E "TRANSITION_LOW_VOL|TRANSITION_WEAK|FEE_BAND_SUPPRESS"
```

### Riesgos y Consideraciones
- **Riesgo feeBandPct**: En posiciones con pérdida real (PnL < -feeBandPct), el ajuste NO aplica — la lógica solo suprime cuando la posición es genuinamente flat
- **Riesgo Guard5/6**: Se aplica SOLO a TRANSITION; TREND y CHOP no se ven afectados
- **Casos edge**: Si expansionResult es null (ciclos muy tempranos), Guard 6 se omite silenciosamente — Guard 5 sigue activa
- **Retrocompatibilidad**: Todas las configuraciones nuevas tienen defaults seguros; código existente no se rompe

---

## 2026-03-15 — REFACTOR: Auditoría y Unificación del Sistema de Notificaciones Telegram

### Objetivo
Auditoría completa + unificación de todo el sistema de notificaciones/alertas de Telegram. Centralizar toda la configuración en la pestaña "Notificaciones" de la UI.

### Hallazgos de la Auditoría

**Rutas duplicadas eliminadas:**
- `server/routes/telegram.routes.ts` registraba rutas `/api/integrations/telegram/*` que **duplicaban** las rutas `/api/telegram/*` ya definidas en `server/routes.ts`.
- La ruta `/api/integrations/telegram/send` tenía un **BUG crítico**: creaba `new TelegramService()` sin inicializar (token/chatId nunca configurados), por lo que los mensajes enviados desde ahí **nunca llegaban**.
- El frontend **nunca usaba** estas rutas duplicadas (usa `/api/telegram/*`).

**Schema incompleto (`alertPreferencesSchema`):**
- Faltaban 11 subtipos de alerta: `trade_timestop`, `trade_pending`, `trade_filled`, `trade_spread_rejected`, `daily_report`, `error_critical`, `smart_exit_threshold`, `smart_exit_executed`, `smart_exit_regime`, `entry_intent`.
- El tipo `AlertSubtype` en `telegram.ts` no incluía subtipos de FISCO ni `entry_intent`.

**Toggles globales sin UI en Notificaciones:**
- `buySnapshotAlertsEnabled` — existía en `bot_config` pero sin toggle en la UI de Notificaciones.
- `spreadTelegramAlertEnabled` — existía en `bot_config` pero sin toggle en la UI de Notificaciones.

**Categorías de alerta ausentes en la UI:**
- Smart Exit Engine (threshold, executed, regime)
- FISCO (sync diario/manual, informe generado, error sync)
- Spread rechazado, Intención de entrada, Reporte diario
- Órdenes pendientes/completadas, Errores críticos

**Código duplicado detectado (pendiente de limpieza):**
- `escapeHtml()` — definida en `telegram.ts` Y en `telegram/templates.ts`
- `formatSpanishDate()` — definida en ambos archivos
- `formatDuration()` — definida en ambos archivos
- `buildPanelUrlFooter()` vs `buildPanelFooter()` — funcionalidad duplicada
- Templates legacy en `telegram.ts` (buildBotStartedHTML, etc.) vs versiones modulares en `telegram/templates.ts`

### Cambios Aplicados

**1. Schema unificado (`shared/schema.ts`):**
- `alertPreferencesSchema` ahora incluye **todos** los 30 subtipos de alerta organizados por categoría: Trading (12), Riesgo/Smart Guard (4), Estrategia (2), Informes/Sistema (4), Errores (3), FISCO (4), Entry Intent (1).
- Tipo `AlertPreferences` generado automáticamente desde Zod.

**2. Backend — Tipo `AlertSubtype` alineado (`server/services/telegram.ts`):**
- Añadidos subtipos faltantes: `trade_pending`, `trade_filled`, `daily_report`, `error_critical`, todos los `fisco_*`, `entry_intent`.
- Tipo ahora 100% alineado con `alertPreferencesSchema`.

**3. Backend — Rutas duplicadas eliminadas (`server/routes.ts`):**
- Removido el registro de `telegram.routes.ts` (líneas 829-833). Las rutas duplicadas `/api/integrations/telegram/*` ya no se registran.
- Las rutas canónicas `/api/telegram/*` en `routes.ts` siguen funcionando.

**4. Frontend — Rediseño completo de Notificaciones (`client/src/pages/Notifications.tsx`):**
- **Header**: Indicadores en tiempo real (estado conexión, canales activos, tipos de alerta).
- **Sección 1 — Mensaje de prueba**: Diseño compacto con selector de destino.
- **Sección 2 — Alertas Globales** (NUEVA): Toggles maestros para `nonceErrorAlertsEnabled`, `signalRejectionAlertsEnabled`, `buySnapshotAlertsEnabled`, `spreadTelegramAlertEnabled`.
- **Sección 3 — Destino de Alertas Especiales**: Errores críticos y rechazo de señales en layout side-by-side.
- **Sección 4 — Cooldowns**: Sección colapsable con grid compacto de 5 cooldowns.
- **Sección 5 — Canales de Telegram**: Canales con preferencias de alerta expandibles por chat. 7 categorías con 30 subtipos, cada uno con tooltip explicativo.
- **Sección 6 — Resumen**: Footer con inventario de todas las categorías.
- **7 categorías de alerta**: Trading, Riesgo/Smart Guard, Estrategia/Régimen, Informes/Sistema, Errores/Sistema, Fiscal/FISCO, Entry Intent.

### Archivos Modificados
- `shared/schema.ts` — alertPreferencesSchema ampliado (11 subtipos nuevos)
- `server/services/telegram.ts` — AlertSubtype alineado con schema
- `server/routes.ts` — Removido registro de telegram.routes.ts duplicado
- `client/src/pages/Notifications.tsx` — Rediseño completo de la UI

### Pendiente (próxima iteración)
- Migrar templates legacy a las versiones modulares

---

## 2026-03-15 — FASE FINAL: Verificación, Limpieza e Integración del Sistema de Notificaciones Telegram

### Objetivo
Garantizar que el sistema unificado de notificaciones Telegram es completo, que TODAS las alertas pasan por `sendAlertWithSubtype`, que la UI refleja exactamente el backend, y que no queda código legacy.

### Cambios Aplicados

**1. Helpers duplicados eliminados (`server/services/telegram.ts`):**
- `escapeHtml`, `formatSpanishDate`, `formatDuration` → eliminadas las definiciones locales duplicadas.
- Ahora se importan desde `server/services/telegram/templates.ts` (fuente canónica).

**2. Integración FISCO (`server/services/FiscoTelegramNotifier.ts`):**
- Añadido `mapToUnifiedSubtype()` que mapea tipos internos FISCO a subtipos unificados (`fisco_sync_daily`, `fisco_sync_manual`, `fisco_report_generated`, `fisco_error_sync`).
- `sendToConfiguredChat()` refactorizado: ahora usa `sendAlertWithSubtype` para broadcasting (respeta `alertPreferences` por chat) + envío al chat dedicado FISCO si no está ya registrado como chat activo (evita doble envío).
- Añadido `"fisco"` a `AlertType` y caso `"fisco"` en `shouldSendToChat`.

**3. Integración Smart Exit (verificada — ya integrado):**
- `tradingEngine.ts` ya usaba `sendAlertWithSubtype` correctamente con `smart_exit_threshold`, `smart_exit_executed`, `smart_exit_regime`.

**4. Migración masiva de `sendAlertToMultipleChats` → `sendAlertWithSubtype`:**
- `telegram.ts`: `sendBuyAlert` → `trade_buy`, `sendSellAlert` → `trade_sell`, `sendOrderPending` → `trade_pending`, `sendAlert` → `error_api`, `sendErrorAlert` → `error_api`, `sendCriticalError` → `error_critical`, `sendSignalRejectionAlert` → `trade_spread_rejected`, `sendBuyExecutedSnapshot` → `trade_buy`, `sendTradeNotification` → `trade_buy`, `sendSystemStatus` → `system_bot_started`, `sendBalanceAlert` → `balance_exposure`, HybridGuard (Watch/Reentry/Executed) → `trade_buy`.
- `exitManager.ts`: SmartGuard alerts → `trade_trailing`, position closures → `trade_sell`, forced sells → `trade_stoploss`.
- `test.routes.ts`: 4 SmartGuard test events → `trade_trailing`.
- `tradingEngine.ts`: pair cooldown → `system_bot_paused`, SELL blocked → `system_bot_paused`.
- `market.routes.ts`: trade sync detection → `trade_filled`.

**5. Envíos directos `sendMessage` migrados:**
- `tradingEngine.ts:7090`: BUY bloqueado por métricas → `sendAlertWithSubtype("trades", "trade_spread_rejected")`.
- `positions.routes.ts:467`: Posición huérfana eliminada → `sendAlertWithSubtype("system", "system_bot_paused")` + HTML corregido.
- Solo quedan 2 `sendMessage` directos intencionales: endpoints de test de conectividad en `routes.ts`.

**6. Archivo legacy eliminado:**
- `server/routes/telegram.routes.ts` eliminado del disco (ya estaba desregistrado de `routes.ts`).

**7. Validación UI ↔ Backend:**
- 29 subtipos en `alertPreferencesSchema` = 29 subtipos en `AlertSubtype` = 29 toggles en UI (`ALERT_SUBTYPES`).
- 6 categorías en UI: Trading (12), Riesgo/Smart Guard (4), Estrategia/Régimen (2), Informes/Sistema (4), Errores/Sistema (3), Fiscal/FISCO (4).
- No existen toggles fantasma ni subtypes sin toggle.

**8. Build TypeScript: 0 errores (verificado múltiples veces con `tsc --noEmit`).**

### Archivos Modificados
- `server/services/telegram.ts` — helpers eliminados, imports corregidos, AlertType ampliado, todas las llamadas migradas a sendAlertWithSubtype
- `server/services/FiscoTelegramNotifier.ts` — integrado con sistema unificado vía sendAlertWithSubtype
- `server/services/exitManager.ts` — 3 llamadas migradas a sendAlertWithSubtype
- `server/services/tradingEngine.ts` — 3 llamadas migradas a sendAlertWithSubtype
- `server/routes/test.routes.ts` — 4 llamadas migradas a sendAlertWithSubtype
- `server/routes/market.routes.ts` — 1 llamada migrada a sendAlertWithSubtype
- `server/routes/positions.routes.ts` — 1 sendMessage migrado a sendAlertWithSubtype

### Archivos Eliminados
- `server/routes/telegram.routes.ts` — dead code (rutas duplicadas /api/integrations/telegram/*)

### Criterios de Finalización Cumplidos
- ✔ Solo existe un sistema de alertas (`sendAlertWithSubtype`)
- ✔ Todos los envíos pasan por `sendAlertWithSubtype` (excepto 2 test endpoints intencionales)
- ✔ UI refleja exactamente backend (29 subtipos, 6 categorías)
- ✔ No hay rutas legacy
- ✔ No hay helpers duplicados
- ✔ Trading, Smart Exit y FISCO integrados
- ✔ Build limpio (0 errores TypeScript)

---

## 2026-03-14 — FIX CRÍTICO: Snapshot Telegram BUY nunca se enviaba en candle-mode

### Problema
El usuario ejecutó una compra XRP/USD a las 04:15 (89.17 XRP @ $1.4819) y no recibió el snapshot de compra en Telegram. Solo recibió el mensaje "⏳ Orden BUY enviada" (notificación de orden pendiente) pero no el snapshot técnico completo.

### Causa Raíz
En `analyzePairAndTradeWithCandles` (candle mode), el bloque `sendBuyExecutedSnapshot` estaba anidado **dentro** del bloque condicional:
```typescript
if (success && !this.dryRunMode && hgCfg?.enabled && hgInfo) {
  // ... HybridGuard stuff ...
  sendBuyExecutedSnapshot(...)  // ← NUNCA ejecuta si hgInfo == null
}
```
Para cualquier BUY normal (sin Hybrid Guard watch activo), `hgInfo = null`, por lo que el bloque completo no ejecutaba y el snapshot nunca se enviaba. El bot lleva tiempo enviando BUYs sin snapshot Telegram.

**Nota**: El cycle mode (`analyzePairAndTrade`) no tenía este bug — `sendBuyExecutedSnapshot` ya estaba en su propio `if (success)` independiente.

### Fix Aplicado
Movido `sendBuyExecutedSnapshot` fuera del bloque `if (hgInfo)` a su propio bloque `if (success)` en `tradingEngine.ts`:
```typescript
}  // cierra if(hgInfo)

// BUY snapshot Telegram alert — fires for ALL successful BUY (not only HybridGuard reentries)
if (success && this.telegramService.isInitialized()) {
  sendBuyExecutedSnapshot(...)
}
```

### Contexto adicional (00:15 vs 04:15)
- **00:15**: BUY XRP/USD bloqueado correctamente por MTF_STRICT (mtfAlignment=-0.33 < umbral 0.10). Mensaje Telegram de rechazo era correcto.
- **04:15**: 4 horas después, MTF alignment mejoró y el BUY pasó todos los filtros. La orden se ejecutó correctamente en RevolutX. El snapshot NO llegó por este bug.

### Archivos modificados
- `server/services/tradingEngine.ts` — bloque `sendBuyExecutedSnapshot` movido fuera del scope `if(hgInfo)` en candle mode (~línea 4868→4898)

### Verificación
- TypeScript: exit 0
- Tests: 60/60

---

## 2026-06 — VERIFICACIÓN TÉCNICA COMPLETA: Motor de Entrada (EntryDecisionContext)

### Objetivo
Verificación técnica completa del refactor del motor de entrada. Fases 1-6 ejecutadas.

### Hallazgos de la auditoría (FASE 1 — Revisión de código)

#### ✅ Confirmado correcto
- `buildEntryDecisionContext` se construye una sola vez por par/ciclo en `analyzeWithCandleStrategy`
- `validateEntryMetrics` + `evaluateHardGuards` se ejecutan antes del anti-cresta para señales BUY normales
- Snapshot Telegram (`sendBuyExecutedSnapshot`) lee exclusivamente de `lastEntryContext` — fuente única de verdad
- `SmartExitEngine.ts` y `exitManager.ts` calculan sus propios indicadores para salidas — no afectados
- Modo ciclo (`analyzePairAndTrade`) es independiente, sin impacto del refactor

#### ⚠️ Issues identificados y corregidos

**Issue 1 (MEDIO): Early Momentum bypasaba hard guards**
- Cuando `earlyMomentumEnabled=true` y la estrategia retornaba "hold", el camino Early Momentum podía crear un BUY sin pasar por `validateEntryMetrics`/`evaluateHardGuards`
- **Fix**: Se añade bloque de guards explícito para Early Momentum BUY en `analyzeWithCandleStrategy`

**Issue 2 (BAJO): mean_reversion_simple dejaba contexto stale**
- En régimen RANGE → `mean_reversion_simple`, `lastEntryContext` quedaba con valores del ciclo momentum anterior
- El snapshot mostraría indicadores de momentum obsoletos como si fueran del momento de la compra
- **Fix**: `this.lastEntryContext.delete(pair)` justo después de seleccionar `mean_reversion_simple`

**Issue 3 (MEDIO): Faltaban logs de trazabilidad**
- `validateEntryMetrics` ejecutaba en silencio — sin log correlacionado con `decisionId`
- No existía log `[ENTRY_APPROVED]` cuando un BUY pasaba todos los guards
- **Fix**: Añadidos `[ENTRY_DATA_VALIDATION]` y `[ENTRY_APPROVED]` en `tradingEngine.ts`

**Issue 4 (MEDIO): `decisionId` no llegaba al snapshot Telegram**
- El `[ENTRY_CONTEXT_BUILT]` log tenía `decisionId` pero el snapshot BUY no lo incluía
- Imposible correlacionar logs de decisión con compra ejecutada
- **Fix**: `decisionId` añadido como parámetro en `sendBuyExecutedSnapshot` (telegram.ts) y en la llamada (tradingEngine.ts)

#### ℹ️ Issues documentados (no corregidos — bajo impacto)
- `signal.ema10/ema20/macdHist/macdHistSlope` en `TradeSignal` son dead code (calculados pero no leídos downstream). Sin impacto funcional.
- `volumeRatio` usa bases distintas: 10-candle en señal (para VOLUME_OVERRIDE) vs 20-candle en contexto (para guards). Inconsistencia documentada, umbrales opuestos hacen conflicto prácticamente imposible.

### Tests creados (FASE 2+3 — Verificación funcional)

**Archivo**: `server/services/__tests__/entryDecisionContext.test.ts`
**Resultado**: 60/60 tests ✅
**Cobertura**:
- CASO A: datos completos → BUY permitido, todos los campos del snapshot disponibles
- CASO B: <20 velas → DATA_INCOMPLETE blocker, ema10/ema20/volumeRatio=null
- CASO C: MACD slope muy negativo en TRANSITION → MACD_STRONGLY_NEGATIVE_TRANSITION blocker
- CASO D: vol<0.8x + price>0.5% sobre EMA20 → LOW_VOL_EXTENDED_PRICE blocker
- CASO E: campos snapshot consistentes con precio real (priceVsEma20Pct ↔ ema20)
- CASO F: estructura completa de blockers/warnings/missingMetrics verificada
- 3.1-3.7: 20+ invariantes de consistencia lógica validados

### Archivos modificados
- `server/services/tradingEngine.ts` — 4 fixes (Early Momentum guards, stale context, logs, decisionId en snapshot call)
- `server/services/telegram.ts` — añadido `decisionId` a `sendBuyExecutedSnapshot`
- `server/services/__tests__/entryDecisionContext.test.ts` — NUEVO: 60 tests funcionales

### Tags de log disponibles post-fix
```
[ENTRY_CONTEXT_BUILT]      — contexto construido (ema10, ema20, vol, macdSlope, complete, decisionId)
[ENTRY_DATA_VALIDATION]    — resultado de validateEntryMetrics (complete, missing[])
[ENTRY_HARD_GUARD_BLOCK]   — BUY bloqueado por hard guard (blockers[])
[ENTRY_HARD_GUARD_WARN]    — advertencias no bloqueantes
[EARLY_MOMENTUM_GUARD_BLOCK] — Early Momentum BUY bloqueado por contexto incompleto
[ENTRY_APPROVED]           — BUY pasa todos los guards
[MED_EXPANSION]            — resultado del detector de expansión
```

### Compilación
TypeScript `--noEmit --skipLibCheck`: **exit 0** (sin errores)

---

---

## 2026-06 — FEAT: Anti-Cresta Refactor + MomentumExpansionDetector + BUY Snapshot (Partes A-F)

### Descripción
Refactorización del sistema Anti-Cresta para que el bloqueo sea duro (no solo un watch sin efecto), nuevo módulo detector de expansión de momentum, reglas de entrada tardía, y alerta Telegram con snapshot técnico en cada BUY ejecutado.

### Bug raíz corregido (CRÍTICO)
**`analyzeWithCandleStrategy` — Anti-Cresta watch sin hard block:**
El check de liberación de watch (líneas ~1587-1599) sólo anotaba `signal.hybridGuard` cuando se cumplían las condiciones, pero si NO se cumplían, la ejecución caía sin bloquear la compra. Resultado: el watch era cosmético — la compra se ejecutaba igual. Mismo bug en MTF_STRICT (líneas ~1748-1761). Ambos corregidos con `else` de bloqueo duro.

### Archivos creados
- **`server/services/MomentumExpansionDetector.ts`** — Módulo puro y sin estado para detectar expansiones de momentum saludables:
  - `evaluateMomentumExpansion(ctx)` retorna `{ isExpansion, score, confidence, reasons, metrics }`
  - 7 condiciones positivas: STRONG_BODY, CLOSE_NEAR_HIGH, VOLUME_EXPANSION, HEALTHY_EMA_DISTANCE, EMA_EXPANDING, MACD_ACCELERATING, MICRO_BREAKOUT
  - 1 penalización: UPPER_WICK_EXHAUSTION
  - `isExpansion = score >= 5`
- **`server/services/__tests__/momentumExpansionDetector.test.ts`** — 20 tests (todos pass)
- **`server/services/__tests__/antiCrestaWatch.test.ts`** — 19 tests del bug fix y release logic (todos pass)

### Archivos modificados

#### `server/services/tradingEngine.ts`
- **Import añadido:** `evaluateMomentumExpansion`, `MomentumExpansionContext`, `MomentumExpansionResult` desde `./MomentumExpansionDetector`
- **Método nuevo:** `shouldReleaseAntiCrestaWatch({ priceVsEma20Pct, volumeRatio, lastClosedCandle, hybridCfg, expansionResult })` — verifica 4 condiciones: distancia EMA20, wick, volumen, y detector score >= 5
- **buyMetrics extendido:** se computa `expansionResult` via `evaluateMomentumExpansion` cuando hay >= 27 velas cerradas. Se emite log `[MED_EXPANSION]` y se asigna a `signal.momentumExpansion`
- **Anti-Cresta watch fix:** si watch ANTI_CRESTA activo + condiciones NO mejoradas → `return hold` con log `[ANTI_CRESTA_WATCH_ACTIVE]`. Si mejoradas → `signal.hybridGuard` + `HYBRID_REENTRY`. Log `[ANTI_CRESTA_RELEASE_CHECK]`
- **MTF_STRICT watch fix:** mismo patrón — hard block con log `[MTF_STRICT_WATCH_ACTIVE]`
- **Parte E — Late Entry Rules** (solo si no hay watch liberado):
  - `priceVsEma20Pct > 0.012` → `[LATE_ENTRY_BLOCK] LATE_ENTRY_EXTENDED`
  - `upperWickRatio > 0.35` → `[LATE_ENTRY_BLOCK] LATE_ENTRY_WICK`
  - `volumeRatio < 1.0 && priceVsEma20Pct > 0.005` → `[LATE_ENTRY_BLOCK] LATE_ENTRY_LOW_VOL`
  - `closeLocation < 0.6 && priceVsEma20Pct > 0.005` → `[LATE_ENTRY_BLOCK] LATE_ENTRY_CLOSE_LOW`
- **Snapshot BUY:** tras `executeTrade` exitoso en modo candle y ciclo, llama a `telegramService.sendBuyExecutedSnapshot(...)`
- **Anti-Cresta trigger log mejorado:** `[ANTI_CRESTA_BLOCK]` con TTL

#### `server/services/strategies.ts`
- Campo opcional añadido a `TradeSignal`: `momentumExpansion?: { isExpansion, score, confidence, reasons, metrics }` — transporta el resultado del detector hasta el punto de ejecución

#### `server/services/telegram.ts`
- **Método nuevo:** `sendBuyExecutedSnapshot(ctx)` — alerta configurable con:
  - Datos del trade: par, exchange, precio, volumen, total
  - Motivo: estrategia, régimen, confianza, señales
  - Snapshot técnico: EMA10/20, MACD slope, volumeRatio, priceVsEma20Pct, expansion score/reasons
  - Estado Anti-Cresta: passed / watch_released / not_triggered
  - Toggle: `botConfig.buySnapshotAlertsEnabled` (default `true`)

#### `shared/schema.ts`
- **Columna nueva:** `buySnapshotAlertsEnabled: boolean("buy_snapshot_alerts_enabled").notNull().default(true)` — requiere `npm run db:push` en deploy

### Nuevos logs a monitorizar
| Log | Qué indica |
|-----|-----------|
| `[MED_EXPANSION]` | Evaluación del detector por cada BUY candidato |
| `[ANTI_CRESTA_RELEASE_CHECK]` | Intento de liberación de watch Anti-Cresta |
| `[ANTI_CRESTA_WATCH_ACTIVE]` | Bloqueo duro por watch activo (BUG FIX) |
| `[MTF_STRICT_WATCH_ACTIVE]` | Bloqueo duro MTF_STRICT watch activo (BUG FIX) |
| `[ANTI_CRESTA_BLOCK]` | Anti-Cresta disparado (watch creado) |
| `[LATE_ENTRY_BLOCK]` | Compra tardía bloqueada por reglas Parte E |
| `[BUY_SNAPSHOT_BUILD]` | Construcción del snapshot Telegram |
| `[BUY_SNAPSHOT_TELEGRAM]` | Envío del snapshot (o skip si toggle disabled) |

### Post-deploy: Acción requerida
```bash
npm run db:push  # Añadir columna buy_snapshot_alerts_enabled
```

---

## 2026-03-11 — FEAT: Smart Exit Engine (Experimental)

### Descripción
Implementación completa del Smart Exit Engine — sistema experimental de salida dinámica que evalúa posiciones abiertas usando señales de deterioro técnico, pérdida de condiciones de entrada, y régimen de mercado.

### Archivos creados
- **`server/services/SmartExitEngine.ts`** — Módulo principal con:
  - Detección de régimen de mercado (TREND/CHOP/VOLATILE) via ADX, EMA slopes, ATR%
  - 9 señales de deterioro modulares: EMA Reversal, MACD Reversal, Volume Drop, MTF Alignment Loss, Orderbook Imbalance, Exchange Flows, Entry Signal Deterioration, Stagnation, Market Regime Adjustment
  - Sistema de scoring con contribuciones por señal
  - Confirmación temporal configurable (ciclos consecutivos)
  - Builder de entry context snapshot para deterioro de señal
  - Helpers de notificación Telegram con cooldown y one-alert-per-event
  - Builder de mensajes Telegram para 3 tipos de evento
  - Endpoint de diagnóstico
- **`client/src/components/strategies/SmartExitTab.tsx`** — UI completa con:
  - Interruptor master ON/OFF con badge experimental
  - Sliders para umbral base, ciclos de confirmación, penalización en pérdida, edad mínima
  - Umbrales por régimen (TREND/CHOP/VOLATILE) con colores
  - Toggles individuales para cada señal de deterioro con badge de score
  - Sección de notificaciones Telegram con granularidad por evento

### Archivos modificados
- **`shared/schema.ts`** — Añadida columna JSONB `smart_exit_config` en bot_config
- **`server/services/tradingEngine.ts`** — Integración en trading loop:
  - Import del SmartExitEngine
  - Campo `entryContext` en interfaz OpenPosition
  - Método `evaluateOpenPositionsWithSmartExit()` ejecutado cada ciclo después de SL/TP
  - Entry context snapshot al crear nueva posición
  - Cache de decisiones (`smartExitDecisions`) expuesta para diagnóstico
  - Alertas Telegram para threshold hit, executed exit, regime change
- **`server/services/botLogger.ts`** — Nuevos EventTypes: SMART_EXIT_THRESHOLD_HIT, SMART_EXIT_EXECUTED, SMART_EXIT_REGIME_CHANGE
- **`server/routes/positions.routes.ts`** — Nuevo endpoint `GET /api/positions/smart-exit-diagnostics` + Smart Exit state incluido en `GET /api/open-positions`
- **`client/src/pages/Strategies.tsx`** — Nueva tab "Smart Exit" con icono FlaskConical
- **`client/src/pages/Terminal.tsx`** — Sección Smart Exit en diálogo de detalle de posición con score, régimen, confirmación, y señales activas

### Prioridad de exits
Stop Loss > Smart Exit > Take Profit > Trailing Stop

### Seguridad
- Desactivado por defecto (`enabled: false`)
- No interfiere con SL/TP/Trailing existentes
- Requiere confirmación temporal (default 3 ciclos)
- Penalización extra si posición en pérdida
- Edad mínima de posición (default 30s)
- Logs detallados para cada evaluación

---

## 2026-03-10 — FEAT: Refresh SmartGuard snapshots para posiciones abiertas

### Problema
Las posiciones abiertas antes del deploy tienen un `configSnapshot` con valores ANTIGUOS (ej: `sgTrailDistancePct=1.5` en vez de `0.85`, `sgScaleOutEnabled=false` en vez de `true`). Los nuevos cambios de exit optimization no se aplicaban a estas posiciones.

### Solución
- **Nuevo método:** `TradingEngine.refreshSmartGuardSnapshots()` — actualiza los parámetros SG del snapshot para TODAS las posiciones abiertas SMART_GUARD con la config actual
- **Nuevo endpoint:** `POST /api/positions/refresh-snapshots` — invoca el método anterior
- Actualiza tanto la memoria (Map) como la base de datos (DB)
- Log detallado de cada posición actualizada (valores old → new)

### Uso post-deploy
```bash
curl -X POST http://localhost:5000/api/positions/refresh-snapshots
```
Respuesta: `{ success: true, updated: N, skipped: M, details: [...] }`

### Archivos modificados
- `server/services/tradingEngine.ts` — Nuevo método `refreshSmartGuardSnapshots()`
- `server/routes/positions.routes.ts` — Nuevo endpoint `POST /api/positions/refresh-snapshots`
- `server/services/botLogger.ts` — Nuevo EventType `SG_SNAPSHOT_REFRESH`

---

## 2026-03-10 — FIX: Exit Optimization no funcionaba — UI mostraba estado client-side, Progressive BE no rastreaba nivel

### Problema reportado
- Solo se recibieron alertas de trailing en XRP, no en BTC/SOL/ETH
- Break-Even marcado "ACTIVO" en UI pero no protegía realmente las posiciones
- Las salidas y seguimiento no funcionaban como se esperaba

### Root cause (4 bugs encontrados)

#### Bug 1: UI `calculateExitStatus` calculaba estado CLIENT-SIDE
- **Archivo:** `client/src/pages/Terminal.tsx` (función `calculateExitStatus`)
- La UI calculaba si BE/Trailing estaban activos comparando P&L actual vs umbrales → estimación
- NO leía los campos reales del servidor (`sgBreakEvenActivated`, `sgTrailingActivated`, `sgCurrentStopPrice`)
- **Fix:** Reescrita la función para usar estado REAL de la posición desde el servidor

#### Bug 2: Field names incorrectos en config query
- **Archivo:** `client/src/pages/Terminal.tsx` (query `botConfig`)
- `sgBePct` → debía ser `sgBeAtPct` (campo Drizzle real)
- `sgTpPct` → debía ser `sgTpFixedPct`
- `sgTimeStopHours` → debía ser `timeStopHours`
- Esto causaba fallback a valores hardcoded incorrectos (2.5%, 5.0%, 48h)
- **Fix:** Corregidos todos los field names para coincidir con el schema Drizzle

#### Bug 3: Progressive BE no actualizaba `beProgressiveLevel` cuando trailing stop ya era más alto
- **Archivo:** `server/services/exitManager.ts` (paso 5b)
- Si el trailing stop ya era > progressive BE stop, el nivel no se actualizaba
- Esto impedía el rastreo de milestones y las alertas de nivel
- **Fix:** Ahora siempre actualiza el nivel (milestone tracking), solo el stop price se cambia si es más alto

#### Bug 4: UI no mostraba stop price real, nivel progresivo, ni estado scale-out
- **Archivo:** `client/src/pages/Terminal.tsx` (dialog de posición)
- No se mostraba el precio de stop real del servidor
- No se mostraba el nivel progresivo de BE (1/3, 2/3, 3/3)
- No se mostraba si scale-out se había ejecutado
- **Fix:** Añadidos campos SmartGuard al interface + mostrados en el dialog

### Por qué solo XRP recibió alertas de trailing
- Las posiciones BTC/SOL/ETH ya tenían `sgTrailingActivated=true` del código ANTERIOR (pre-deploy)
- XRP probablemente cruzó el umbral +2% DESPUÉS del deploy, activando la alerta con el nuevo código
- **Esto es comportamiento correcto**: las alertas son one-shot por evento

### Archivos modificados
- `server/services/exitManager.ts` — Fix Progressive BE level tracking
- `client/src/pages/Terminal.tsx` — Fix calculateExitStatus, field names, dialog UI
- `CORRECCIONES_Y_ACTUALIZACIONES.md` — Documentación

---

## 2026-03-08 — FEAT: Pro Exit Optimization (ATR Dynamic Trailing + Progressive BE + Trail Decay)

### Problema reportado
Trade TON/USD alcanzó +2.03% de ganancia pero cerró en -0.4% pérdida. El `trailDistancePct` (1.5%) era casi igual al `trailStartPct` (2.0%), dejando solo 0.5% de margen bruto — insuficiente para cubrir fees round-trip (~0.8%) y slippage.

### Investigación
Auditoría completa de todas las features de exit del bot + investigación de bots profesionales (3Commas, Bitsgap, Pionex, Aesir). Se identificaron 3 mejoras estándar de la industria que el bot ya tenía parcialmente implementadas pero desconectadas:

### Cambios implementados

#### 1. Progressive Break-Even (3Commas SL Breakeven) — conectado al flujo SmartGuard
- **Archivo:** `server/services/exitManager.ts` (paso 5b, entre trailing update y stop hit check)
- El código `calculateProgressiveBEStop()` ya existía (L480-514) pero NO estaba conectado al flujo `checkSmartGuardExit()`
- Ahora se ejecuta automáticamente cuando BE está activado y hay ganancia positiva
- **Niveles:** +1.5% → stop en roundTripFee | +3.0% → stop en fee+0.5% buffer | +5.0% → stop en fee+1% buffer
- Actúa como **piso mínimo**: el stop nunca baja por debajo del nivel progresivo alcanzado
- Envía alerta Telegram por cada nivel alcanzado

#### 2. Trailing Dinámico basado en ATR (estándar 3Commas/Bitsgap pro)
- **Archivos:** `exitManager.ts`, `tradingEngine.ts`
- Nueva interfaz: `IExitManagerHost.getATRPercent(pair)` → retorna ATR% cacheado
- Cache de ATR% se actualiza cada ciclo de análisis (velas y ciclos)
- **Fórmula:** `effectiveTrailDist = min(configDist, max(0.3%, ATR × 1.5))`
- En mercados tranquilos (ATR bajo) → trailing más tight → protege más ganancia
- En mercados volátiles (ATR alto) → más espacio → evita stops prematuros
- Cap máximo: nunca excede el valor configurado por el usuario

#### 3. Trail Distance Decay temporal (Aesir/Cryptomaton inspired)
- El trailing se estrecha automáticamente con la edad de la posición
- **Fórmula:** `decayFactor = max(0.5, 1 - ageHours/72 × 0.5)`
- A las 0h: factor = 1.0 (distancia completa)
- A las 36h: factor = 0.75 (75% de distancia)
- A las 72h+: factor = 0.5 (50% de distancia — mínimo)
- Libera capital más rápido en posiciones estancadas

#### 4. Config defaults optimizados
- `sgTrailDistancePct`: 1.50% → **0.85%** (más ajustado para crypto spot)
- `sgScaleOutEnabled`: false → **true** (venta parcial activada por defecto)
- Fallbacks actualizados en `exitManager.ts` y `tradingEngine.ts`

### Impacto en caso TON/USD (simulado)
Con las mejoras activas:
- A +1.5%: BE activado, Progressive BE L1 → stop en ~+0.8% (entry + fees)
- A +2.0%: Scale-out vende 35% con +2% ganancia asegurada. Trailing con 0.85% distancia × decay → stop en +1.15%
- **Resultado estimado: +$0.50-0.70 neto** en vez de -$0.46

### Archivos modificados
- `server/services/exitManager.ts` — Progressive BE integrado, ATR dynamic trailing, trail decay
- `server/services/tradingEngine.ts` — ATR% cache per pair, getATRPercent en exit host
- `server/services/botLogger.ts` — Nuevo EventType `SG_PROGRESSIVE_BE`
- `shared/schema.ts` — Defaults actualizados (trailDistancePct, scaleOutEnabled)

### Logs de diagnóstico
- `EXIT_EVAL`: ahora incluye `trailDistancePctConfig`, `atrPct`, `decayFactor`, `positionAgeHours`, `beProgressiveLevel`
- `SG_PROGRESSIVE_BE`: log + alerta Telegram cuando un nivel progresivo sube el stop
- Trailing update logs muestran distancia efectiva vs configurada

---

## 2026-03-07 — FIX C: Intermediate Cycle ya NO es veto absoluto — permite ejecución con señal cacheada válida

### Problema reportado
En logs de staging (17:30-18:00 UTC):
- `intermediateBlockApplied=true` permanente durante todo el intervalo intrabar
- Señal cacheada válida (BUY/SELL con signals >= minRequired, confidence >= 0.6) nunca se ejecutaba
- El ciclo intermedio actuaba como **veto absoluto** de ejecución, incluso con señal operable
- Todos los risk checks reales (NO_POSITION, MAX_LOTS, COOLDOWN, etc.) quedaban sin evaluar

### Root cause
El bloque `shouldPollForNewCandle() === false` hacía `continue` incondicional, saltando toda la lógica de ejecución. La señal cacheada existía pero nunca se reevaluaba contra los risk checks reales.

### Fix aplicado — `server/services/tradingEngine.ts`

**A) Cache enriquecido con datos de señal**
- `LastFullAnalysisCache` ahora incluye `rawSignal` (BUY/SELL/NONE), `confidence`, `lastCandle` (OHLCCandle)
- `cacheFullAnalysis()` almacena estos campos al completar cada análisis

**B) Intermediate Passthrough condicional**
- Cuando `shouldPollForNewCandle()` retorna `false`, evalúa si la señal cacheada es elegible:
  - `rawSignal` es BUY o SELL
  - `signalsCount >= minSignalsRequired`
  - `confidence >= 0.6`
  - `lastCandle` existe en cache
- Si elegible **Y** rate-limit permite (120s entre intentos): llama `analyzePairAndTradeWithCandles()` con vela cacheada
- Si no elegible o rate-limited: bloqueo intermedio estándar con razón explícita

**C) Skip staleness/chase gates en ejecución intermedia**
- `analyzePairAndTradeWithCandles()` acepta `intermediateExec: boolean = false`
- Cuando `intermediateExec=true`: staleness gate y chase gate se desactivan (la vela cacheada es intencionalmente "vieja")
- Todos los demás risk checks permanecen activos: cooldown, maxLots, exposure, minOrder, spread, regime, Smart Guard, AI filter, etc.

**D) Rate-limiter para ejecución intermedia**
- `lastIntermediateExecAttempt` Map: evita re-intentar cada 5s
- Cooldown de 120s entre intentos de ejecución intermedia por par
- Se resetea automáticamente cuando se detecta vela nueva (`isNewCandleClosed`)

**E) Logs diagnósticos nuevos**
- `[INTERMEDIATE_EXEC]`: señal elegible, ejecutando con vela cacheada (cachedSignal, signals, confidence, candleAgeSec)
- `[INTERMEDIATE_EXEC_START]`: inicio de re-ejecución dentro de `analyzePairAndTradeWithCandles`
- `[INTERMEDIATE_DIAG]`: señal elegible pero rate-limited, o bloqueo por razón específica
- Razones explícitas de bloqueo: "sin señal direccional", "señales insuficientes", "confianza baja", "rate-limit", etc.

### Bloqueos reales que siguen activos (NO afectados por este fix)
- Cooldown de par / anti-ráfaga / stop-loss
- MaxLots per pair (SINGLE/SMART_GUARD)
- Exposure / minOrder / fondos insuficientes
- Spread filter
- Regime TRANSITION pause
- Smart Guard señales insuficientes
- AI Filter / Shadow
- Market Metrics Gate
- NO_POSITION (para SELL)

### Resultado esperado en logs
```
[INTERMEDIATE_EXEC] BTC/USD: signalEligible=true signalSource=cached cachedSignal=SELL signals=3/3 confidence=0.85 candleAgeSec=300 → executing with cached candle
[INTERMEDIATE_EXEC_START] BTC/USD/15m: re-executing cached signal with candle openAt=... intermediateExec=true (staleness/chase gates skipped)
// → señal pasa por TODOS los risk checks → puede ser bloqueada por NO_POSITION u otro risk check REAL
```

---

## 2026-03-07 — FIX CRÍTICO: Vela cerrada no detectada + Intermediate Gate bloqueando señales válidas

### Problema reportado
En logs de producción (14:30-14:32 UTC):
- `lastCandleClosedAt` clavado en `14:00:00.000Z` cuando ya existían cierres 14:15 y 14:30
- `isIntermediateCycle=true` en TODOS los pares durante >2 minutos
- Señales válidas (ETH 5/3, SOL 5/3, BTC 4/3, XRP 4/3) bloqueadas con `finalSignal=NONE`
- `finalReason="Ciclo intermedio - sin vela 15m cerrada"` erróneo

### Causa raíz: BUG A — `shouldPollForNewCandle()` calcula mal el próximo cierre

**Antes (buggy):**
```typescript
const nextExpectedClose = Math.floor(nowSec / intervalSec) * intervalSec + intervalSec;
// A las 14:30 → nextExpectedClose = 14:45 (cierre del slot ACTUAL del reloj)
// Window [-30s,+10s] de 14:45 = [14:44:30, 14:45:10]
// 14:30:04 NO está en la ventana → returns false ❌
```

**Después (fix):**
```typescript
const nextUnprocessedClose = lastTs + 2 * intervalSec;
// lastTs=14:00 → nextUnprocessedClose = 14:30 (cierre de la vela NO procesada)
// Window [-30s,+10s] de 14:30 = [14:29:30, 14:30:10]
// 14:30:04 SÍ está en la ventana → returns true ✅
```

### Causa raíz: BUG B — `lastCandleClosedAt` mostraba openTime, no closeTime

`candle.time` en Kraken = openTime de la vela. La vela 14:00-14:15 tiene `time=14:00`.
El trace mostraba `lastCandleClosedAt=14:00:00` cuando el cierre real es 14:15.

**Fix:** `candle.time + intervalSec` → muestra closeTime correcto.

### Archivos modificados

| Archivo | Función | Cambio |
|---|---|---|
| `server/services/tradingEngine.ts` | `shouldPollForNewCandle()` | Reemplazar `nextExpectedClose` (clock-aligned) por `nextUnprocessedClose` (lastTs + 2×interval) + catch-up logging |
| `server/services/tradingEngine.ts` | `runTradingCycle()` | Logs diagnóstico: `[INTERMEDIATE_DIAG]`, `[CANDLE_NEW]`, `[CANDLE_SAME]` con timing detallado |
| `server/services/tradingEngine.ts` | `analyzePairAndTradeWithCandles()` | Fix `lastCandleClosedAt` → usa closeTime real (candle.time + intervalSec) |
| `server/services/tradingEngine.ts` | `cacheFullAnalysis()` call | Fix `candleClosedAt` en cache → closeTime real |
| `server/services/tradingEngine.ts` | `initPairTrace()` | Mejorar `rawReason`/`finalReason` para ciclos intermedios (mensajes más claros) |

### Logs de diagnóstico añadidos
```
[CANDLE_POLL] ETH/USD/15m CATCH-UP: missed window → polling
[CANDLE_NEW] ETH/USD/15m openAt=...T14:15:00Z closeAt=...T14:30:00Z prevCloseAt=...T14:15:00Z
[CANDLE_SAME] ETH/USD/15m candleTime=...T14:00:00Z == lastProcessed
[INTERMEDIATE_DIAG] ETH/USD: intermediateBlockApplied=true lastCandleClosedAt=... expectedNextClose=... candleAgeSec=... signals=5/3
```

### Validación esperada post-deploy
- `lastCandleClosedAt` debe avanzar cada 15 minutos (14:15→14:30→14:45→...)
- Señales con signalsCount≥minSignalsRequired NO deben bloquearse por ciclo intermedio
- `[CANDLE_NEW]` debe aparecer ~cada 15 minutos por par
- `[INTERMEDIATE_DIAG]` no debe aparecer con candleAgeSec > 900+60

---

## 2026-03-06 — FEAT: Volume Breakout Override (FASE 9)

### Objetivo
Capturar breakouts tempranos con volumen institucional incluso cuando el filtro MTF rechazaría la señal. Ejemplo real: `volumeRatio=2.80, mtfAlignment=-0.33` → señal rechazada injustamente.

### Cambios implementados

| Archivo | Cambio |
|---|---|
| `shared/config-schema.ts` | Feature flag `volumeBreakoutOverrideEnabled: false` (default off) en schema + defaults |
| `client/src/components/strategies/FeatureFlagsTab.tsx` | Toggle "Volume Breakout Override" (FASE 9, riesgo medio, icono Flame) |
| `server/services/tradingEngine.ts` | Lógica override dentro de `if (mtfBoost.filtered)`: si flag activo + `vol≥2.5x` + `ADX≥20` + `alignment>-0.40` + `regime≠RANGE` → bypass MTF con confidence reducida (×0.9, max 0.85) |
| `server/services/tradingEngine.ts` | Campo `volumeBreakoutOverride?: boolean` en `DecisionTraceContext` para auditoría |

### Condiciones de activación (todas requeridas)
- `volumeBreakoutOverrideEnabled = true`
- `signal.action === "buy"`
- `volumeRatio >= 2.5`
- `ADX >= 20`
- `mtfAlignment > -0.40`
- `regime !== "RANGE"`

### Logging
```
[MTF_BREAKOUT_OVERRIDE] ETH/USD vol=2.80 mtf=-0.33 ADX=24 regime=TRANSITION
```
Signal reason incluye: `BREAKOUT_OVERRIDE(vol=2.80, mtf=-0.33)` → fluye a Telegram automáticamente.

### Seguridad
- Flag `false` por defecto → cero cambio de comportamiento hasta activar
- Confianza reducida 10% cuando se activa override
- No se activa en RANGE ni con MTF extremadamente negativo (<-0.40)

---

## 2026-03-06 — FIX: Rate Limiting Kraken + Hot-Reload Feature Flags

### Problemas detectados en logs de producción

| # | Problema | Severidad |
|---|---|---|
| 1 | **Rate limiting Kraken**: Polling 5s (FASE 1) con 5 pares causa `"EGeneral:Too many requests"` frecuentes | CRÍTICO |
| 2 | **Hot-reload roto**: Endpoint PUT feature-flags emitía `"configUpdated"` pero listener espera `"config:updated"` con payload `{configId}` | ALTO |

### Correcciones

| Archivo | Cambio |
|---|---|
| `server/services/tradingEngine.ts` | **NUEVO método `shouldPollForNewCandle()`**: Cálculo alineado al reloj (`Math.floor(now/interval)*interval + interval`), ventana acotada [-30s, +10s] del cierre esperado, y dedup para evitar re-consultar vela ya procesada. Reduce llamadas API de ~60/min a ~3-8/min |
| `server/services/tradingEngine.ts` | Integración del guard en `runTradingCycle()`: ciclos intermedios saltan API call cuando no toca |
| `server/routes/config.ts` | Fix evento: `configService.emit("config:updated", { configId: activeConfigId })` (antes: `"configUpdated"`, string plano) |

### Impacto
- **Antes**: 5 pares × 12 scans/min = ~60 OHLC calls/min → rate limiting frecuente
- **Después**: Solo ~5-10 OHLC calls/min (cerca del cierre de vela) → sin rate limiting
- Hot-reload de feature flags desde UI ahora dispara correctamente `loadDynamicConfig()` en TradingEngine

---

## 2026-07-12 — FEAT: UI Motor Adaptativo — Pestaña Feature Flags en Estrategias

### Objetivo
Proporcionar interfaz visual para activar/desactivar los feature flags del Adaptive Momentum Engine sin necesidad de editar configuración JSON manualmente.

### Cambios implementados

| Archivo | Cambio |
|---|---|
| `server/routes/config.ts` | Endpoints `GET/PUT /api/config/feature-flags` — lee/escribe flags del config activo, emite evento hot-reload |
| `server/services/botLogger.ts` | Añadido `FEATURE_FLAGS_UPDATED` a `EventType` |
| `client/src/components/strategies/FeatureFlagsTab.tsx` | **NUEVO** — Componente con 8 toggles Switch, badges de riesgo, descripciones, estado en tiempo real |
| `client/src/pages/Strategies.tsx` | Nueva pestaña "Motor Adaptativo" con icono Brain |

### Ubicación en UI
**Estrategias → Motor Adaptativo** (3ª pestaña junto a Configuración y Métricas)

### Características
- 8 toggles independientes con descripción, fase, y nivel de riesgo (bajo/medio/alto)
- Hot-reload: cambios se aplican sin reiniciar el bot (emit `config:updated`)
- Refetch automático cada 10s para sincronizar estado
- Fallback a defaults si no hay config activa (muestra warning)
- Log `FEATURE_FLAGS_UPDATED` en cada cambio para auditoría

---

## 2026-07-12 — FEAT: Adaptive Momentum Engine — Feature Flags + 10 fases implementadas

### Objetivo
Evolucionar el motor de trading de un sistema de señal simple a un **Adaptive Momentum Engine** con capacidad de aprendizaje, scoring y adaptación al régimen de mercado. Implementación faseada con feature flags (todos `false` por defecto → cero cambio de comportamiento hasta activar).

### Análisis previo realizado
- Revisión completa de arquitectura: `tradingEngine.ts`, `strategies.ts`, `regimeDetection.ts`, `regimeManager.ts`, `mtfAnalysis.ts`, `indicators.ts`, `schema.ts`, `config-schema.ts`, `telegram.ts`
- Conflictos identificados y mitigados: rate limits API (FASE 1), incompatibilidad tipos OHLC/OHLCCandle (FASE 6), `CONFIRM_SCANS_REQUIRED` ya implementado en RegimeManager (FASE 4)
- Orden de implementación elegido por seguridad: 0 → 4 → 1 → 3 → 5 → 6 → 7 → 8 → 9 → 10 → 2

### Fases implementadas

#### FASE 0 — Sistema de Feature Flags
- **`shared/config-schema.ts`**: Añadido `featureFlagsSchema`, `defaultFeatureFlags` (todos `false`), `FeatureFlags` type, integrado en `globalConfigSchema.featureFlags`
- **`server/services/tradingEngine.ts`**: Import de `defaultFeatureFlags + FeatureFlags`, helper `getFeatureFlags()` que lee de `dynamicConfig?.global?.featureFlags ?? defaults`
- **Patrón**: Igual a `hybridGuard` (JSONB en `config_preset`) → hot-reload sin migración de DB

#### FASE 1 — CandleClose Trigger (5s polling)
- **`server/services/tradingEngine.ts`**: `getIntervalForStrategy(strategy, signalTimeframe?)` — si `candleCloseTriggerEnabled=true` y modo vela, devuelve 5000ms en vez de 30000ms
- **Resultado**: Detección de cierre de vela en <5s vs <30s actual
- **Seguridad**: Kraken OHLC pública permite ~1 req/s; 3 pares × 5s = 0.6 req/s ✅

#### FASE 2 — Early Momentum Entry (vela en progreso)
- **`server/services/tradingEngine.ts`**: En `analyzeWithCandleStrategy`, evaluación de la vela ACTUAL (abierta) cuando signal=HOLD y `earlyMomentumEnabled=true`
- **Condiciones estrictas**: bodyRatio ≥ 0.70, volumeRatio ≥ 1.8x, ATR% ≥ 1%
- **Confianza baja**: 0.55 (marcado como `vela en progreso` en el reason)

#### FASE 3 — Signal Accumulator
- **`server/services/signalAccumulator.ts`**: NUEVO módulo con `SignalAccumulator` class (singleton). BUY/SELL += 1; HOLD × 0.9 (decay). Reset si sin actividad >15min.
- **`server/services/tradingEngine.ts`**: Import y uso en `analyzePairAndTradeWithCandles`. Si `signalAccumulatorEnabled=true`, boost confidence hasta +0.10 proporcional al score acumulado.

#### FASE 4 — Régimen Histéresis
- **`server/services/regimeManager.ts`**: `hysteresisEnabled: boolean`, `setHysteresisEnabled(enabled)`, `getCandidateDiag(pair)` — cuando `regimeHysteresisEnabled=true`, confirmScans = 5 (vs 3 actual)
- **`server/services/tradingEngine.ts`**: `loadDynamicConfig()` propaga flag al RegimeManager vía `setHysteresisEnabled()`

#### FASE 5 — Signal Scoring Engine
- **`server/services/strategies.ts`**: `SIGNAL_WEIGHTS` table (8 indicadores con pesos 0.8-2.5). `momentumCandlesStrategy` calcula `buyScore`/`sellScore` en paralelo al count. Si `signalScoringEnabled=true`, paths score-based se activan (umbral 6.5). Score incluido en `TradeSignal.signalScore`

#### FASE 6 — MTF Dinámico con ATR%
- **`server/services/strategies.ts`**: `applyMTFFilter(…, atrPct?, dynamicMtfEnabled?)` — cuando activo en TRANSITION, threshold dinámico ATR-based: >3% ATR → 0.25, >2% → 0.20, >1% → 0.15, else → 0.10
- **`server/services/tradingEngine.ts`**: ATR% calculado inline sobre OHLC[] en `analyzeWithCandleStrategy`, pasado al filtro MTF

#### FASE 7 — Volume Override
- **`server/services/tradingEngine.ts`**: Si `volumeOverrideEnabled=true` y `volumeRatio ≥ 2.5`, se omite el check MTF_STRICT (el breakout de volumen supera al filtro de tendencia)

#### FASE 8 — Price Acceleration Filter
- **`server/services/strategies.ts`**: `priceAcceleration` calculado en `momentumCandlesStrategy` → `d2/|d1|` de últimas 3 velas cerradas
- **`server/services/tradingEngine.ts`**: Si `priceAccelerationFilterEnabled=true` y `priceAcceleration < -0.5`, BUY se bloquea antes del pipeline MTF

#### FASE 9 — Logging Ampliado
- **`server/services/tradingEngine.ts`**: `DecisionTraceContext` extendida con: `signalScore`, `signalVolumeRatio`, `priceAcceleration`, `accumBuyScore`, `accumSellScore`, `regimeCandidate`, `regimeCandidateCount`, `atrPct`, `volumeOverrideTriggered`, `priceAccelBlocked`, `featureFlagsActive`
- `updatePairTrace` en `analyzePairAndTradeWithCandles` propaga todos estos campos

#### FASE 10 — Alertas Telegram Enriquecidas
- **`server/services/telegram.ts`**: `sendSignalRejectionAlert` extendida con `filterType: "MTF_STRICT" | "ANTI_CRESTA" | "PRICE_ACCEL" | "VOLUME_OVERRIDE"` y context con `signalScore`, `priceAcceleration`, `accumBuyScore`, `accumSellScore`, `atrPct`, `featureFlagsActive`

### Archivos modificados
| Archivo | Cambios |
|---|---|
| `shared/config-schema.ts` | FASE 0: featureFlagsSchema + defaultFeatureFlags + globalConfigSchema |
| `server/services/tradingEngine.ts` | FASE 0-9: helper flags, scan interval, acumulador, histéresis, ATR, volume override, price accel, logging |
| `server/services/strategies.ts` | FASE 5-8: SIGNAL_WEIGHTS, signalScore, volumeRatio, priceAcceleration, applyMTFFilter extendido |
| `server/services/regimeManager.ts` | FASE 4: hysteresisEnabled, setHysteresisEnabled, getCandidateDiag |
| `server/services/telegram.ts` | FASE 10: sendSignalRejectionAlert extendido |
| `server/services/signalAccumulator.ts` | FASE 3: NUEVO módulo SignalAccumulator |

### Auditoría post-implementación (6 fixes)

| # | Tipo | Fix aplicado |
|---|---|---|
| 1 | **BUG** | Falta flag `dynamicMtfEnabled` — FASE 6 y FASE 7 estaban atadas al mismo `volumeOverrideEnabled`. Añadido flag propio. |
| 2 | **BUG** | Log `REGIME_CANDIDATE` mostraba `/3` hardcoded en vez de `/confirmScans` dinámico (5 con histéresis). |
| 3 | **BUG** | FASE 2 confidence=0.55 siempre bloqueada por gate 0.60. Subido a 0.62. |
| 4 | **ISSUE** | Hold return en `momentumCandlesStrategy` no incluía `signalScore`/`volumeRatio`/`priceAcceleration`. Añadidos. |
| 5 | **ISSUE** | 3 llamadas redundantes a `getFeatureFlags()` en `analyzeWithCandleStrategy`. Consolidadas en una. |
| 6 | **BUG** | FASE 2 Early Momentum bypaseaba filtros ANTI_CRESTA y MTF. Añadido guard MTF bearish + RSI>70. |

### Estado de flags en producción (post-deploy)
**Todos desactivados por defecto.** Para activar progresivamente via UI config_preset:
```json
{
  "global": {
    "featureFlags": {
      "candleCloseTriggerEnabled": false,
      "earlyMomentumEnabled": false,
      "signalAccumulatorEnabled": false,
      "regimeHysteresisEnabled": false,
      "signalScoringEnabled": false,
      "dynamicMtfEnabled": false,
      "volumeOverrideEnabled": false,
      "priceAccelerationFilterEnabled": false
    }
  }
}
```

---

## 2026-03-05 — FIX: Diagnóstico UI + Ciclo Intermedio + Guard SELL sin contexto (OBJ-A/B/C)

### Problema
1. **OBJ-A (UI)**: El endpoint `/api/scan/diagnostic` mostraba datos de señal **obsoletos** para pares en ciclo intermedio (14 de cada 15 minutos en modo velas 15m). `lastScanResults` sólo se actualizaba durante análisis completos, por lo que entre cierres de vela la UI podía mostrar `BUY` (del último análisis completo) cuando el par estaba bloqueado por ciclo intermedio.
2. **OBJ-B (isIntermediateCycle)**: La lógica de `isIntermediateCycle` es **correcta por diseño**. Entre cierres de vela 15m (la mayoría del tiempo), el sistema espera. La inconsistencia entre pares con diferente `lastCandleClosedAt` dentro del mismo scan es efecto del procesamiento secuencial: si una vela cierra a mitad de scan, los pares procesados antes ven la vela antigua. No es un bug.
3. **OBJ-C (sellContext)**: Cuando existía balance real en el exchange pero sin posición rastreada en el bot (`existingPosition=null`), el SELL llegaba hasta `executeTrade()` con `sellContext=undefined`, generando un log `[ERROR]` innecesario. El bloqueo era correcto pero el manejo era sucio (error downstream en vez de warning upstream).

### Causa raíz
- **OBJ-A**: `lastScanResults.set()` nunca se llamaba en el path de ciclo intermedio (lines 2201-2204 del scan loop), dejando datos del último análisis completo como estado visible.
- **OBJ-C**: Doble validación: `NO_POSITION` check (lines 3057/4033) sólo bloquea si `assetBalance <= 0`, dejando pasar el caso "balance real sin posición rastreada" (orphan). Este caso llegaba a `executeTrade` sin `sellContext`.

### Cambios realizados
- **`server/services/tradingEngine.ts`** — 3 cambios:
  1. **OBJ-A (línea ~2201)**: En el `else` del ciclo intermedio (`isNewCandleClosed=false`), se actualiza `lastScanResults` con `signal: "NONE"` y `reason: "Ciclo intermedio - sin vela 15m cerrada"`. Garantiza que `/api/scan/diagnostic` (y la UI Monitor) refleje el estado actual real, no datos stale del último análisis completo.
  2. **OBJ-C (línea ~3204)**: Guard upstream en `analyzePairAndTrade` — si `existingPosition` es null antes del SELL, se emite `botLogger.warn("SELL_BLOCKED_NO_CONTEXT")`, se actualiza el trace con `blockReasonCode: "NO_POSITION"` y se retorna limpiamente sin llegar a `executeTrade`.
  3. **OBJ-C (línea ~4176)**: Mismo guard upstream en `analyzePairAndTradeWithCandles`.

### Comportamiento post-fix
- **UI Monitor / Diagnóstico**: La columna "Razón" muestra "Ciclo intermedio - sin vela 15m cerrada" en lugar de señal stale del último análisis completo.
- **SELL sin contexto**: Log cambia de `[ERROR]` a `[WARN]`, trace queda con `finalReason: "SELL sin posición rastreada — bloqueado antes de ejecutar orden"`. No se intenta ninguna orden.
- **isIntermediateCycle**: Comportamiento sin cambio (correcto). Documentado como diseño intencional.

---

## 2026-03-04 — FIX: Módulo Market Metrics — toggle bloqueado y providers "No disponible"

### Problema
El panel de Métricas mostraba todos los proveedores como "No disponible" y el toggle de activación no persistía al guardarse.

### Causas raíz identificadas
1. **`marketMetricsConfig` no estaba en el schema Drizzle** (`shared/schema.ts`) → `updateBotConfig({ marketMetricsConfig })` era silenciosamente ignorado por el ORM → el toggle nunca guardaba el estado
2. **`providerStatus` inicia como Map vacío** (todos `available: false`) → `refresh()` no corre con `enabled=false` (default) → DeFiLlama y CoinMetrics aparecen como "No disponible" aunque son gratuitos
3. **No había proveedor gratuito de derivados** → CoinGlass requiere API key → sin alternativa libre para OI/funding rate

### Cambios realizados
- **`shared/schema.ts`** — Añadido `marketMetricsConfig: jsonb("market_metrics_config")` al schema Drizzle de `bot_config`. Fix crítico: sin esto Drizzle ignoraba la columna en updates
- **`server/services/marketMetrics/providers/IMetricsProvider.ts`** — Añadido campo `optional: boolean` a la interfaz
- **`server/services/marketMetrics/providers/BinanceFuturesProvider.ts`** — NUEVO proveedor gratuito (sin API key): Open Interest (USD) y Funding Rate (%) vía Binance Futures public API. Sustituye a CoinGlass si no hay `COINGLASS_API_KEY`
- **`server/services/marketMetrics/providers/*.ts`** — Añadido `optional` a cada provider: `false` para DeFiLlama/CoinMetrics/Binance (gratuitos), `true` para WhaleAlert/CoinGlass (requieren key)
- **`server/services/marketMetrics/MarketMetricsService.ts`** — Selección dinámica de provider derivados: Binance si no hay `COINGLASS_API_KEY`, CoinGlass si hay. Añadido `refreshForced()` (ignora enabled). Expone `configured` y `optional` por provider en `getProviderStatuses()`
- **`server/routes/marketMetrics.routes.ts`** — `/refresh` ahora usa `refreshForced()` → permite actualizar datos aunque el módulo esté desactivado
- **`client/src/components/strategies/MarketMetricsTab.tsx`** — Lógica de display por estado de provider: verde=disponible, azul=disponible sin fetch, ámbar=opcional sin key, rojo=error. Botón "Actualizar datos" siempre habilitado. Añadido Binance a la lista de providers

### Resultado esperado post-fix
- DeFiLlama (Stablecoins) → Disponible (azul → verde tras primer refresh)
- CoinMetrics (Flujos) → Disponible (azul → verde tras primer refresh)
- WhaleAlert (Ballenas) → Opcional — sin API key (ámbar)
- Binance Futures (Derivados) → Disponible (azul → verde tras primer refresh)
- Toggle de activación: funciona correctamente, persiste en DB

---

## 2026-01-XX — FEAT: Módulo Market Metrics (métricas de mercado como plugin)

### Resumen
Implementación completa del módulo de Métricas de Mercado como plugin opcional no intrusivo. El módulo evalúa flujos de capital, liquidez (stablecoins), apalancamiento (derivados) y actividad de ballenas antes de cada orden BUY, pudiendo PERMITIR, AJUSTAR o BLOQUEAR la operación. Diseñado con fail-safe total: si los datos fallan o el módulo está desactivado, el bot opera exactamente igual que antes (passthrough). Integrado en un único punto en `tradingEngine.ts`.

### Arquitectura
- **Plugin pattern**: El módulo no modifica ninguna estrategia ni filtro existente
- **Único punto de integración**: `applyMarketMetricsGate()` llamado justo antes de `executeTrade("buy")` en ambos modos (ciclo y candle)
- **Fail-safe**: Cualquier excepción en el gate → passthrough automático, nunca bloquea
- **Modo observación**: Registra evaluaciones en DB pero nunca bloquea ni ajusta (ideal para validar)
- **Modo activo**: Aplica BLOQUEAR o AJUSTAR según score de riesgo calculado

### Fases completadas

#### FASE 1: Módulo core (tipos, engine, service)
- `server/services/marketMetrics/MarketMetricsTypes.ts` — Tipos: `RiskLevel`, `Bias`, `MetricsAction`, `MetricsMode`, `MarketMetricsDecision`, `MetricSnapshot`, `MarketMetricsConfig`, `DEFAULT_METRICS_CONFIG`, `makePassthroughDecision()`
- `server/services/marketMetrics/MarketMetricsEngine.ts` — Motor de evaluación: scoring por 6 métricas (netflow, whale inflow, stablecoins, OI, funding rate, liquidaciones), umbrales base, multiplicadores de sensibilidad, cálculo de acción PERMITIR/AJUSTAR/BLOQUEAR
- `server/services/marketMetrics/MarketMetricsService.ts` — Orquestador de ingesta y lectura de métricas desde DB
- `server/services/marketMetrics/index.ts` — Re-exportaciones del módulo

#### FASE 2: Proveedores de datos
- `server/services/marketMetrics/providers/IMetricsProvider.ts` — Interfaz `IMetricsProvider` con `fetch(): ProviderFetchResult`
- `server/services/marketMetrics/providers/DeFiLlamaProvider.ts` — Suministro/contracción de stablecoins (gratis, sin API key)
- `server/services/marketMetrics/providers/CoinMetricsProvider.ts` — Flujos netos hacia exchanges (gratis con límites)
- `server/services/marketMetrics/providers/WhaleAlertProvider.ts` — Inflow de ballenas a exchanges (requiere `WHALE_ALERT_API_KEY`)
- `server/services/marketMetrics/providers/CoinGlassProvider.ts` — Open Interest, Funding Rate, Liquidaciones (requiere `COINGLASS_API_KEY`)

#### FASE 3: Migración DB
- `db/migrations/018_market_metrics.sql` — Tablas `market_metrics_snapshots` y `market_metrics_evaluations`. Columna `market_metrics_config` JSONB en `bot_config`

#### FASE 4: Scheduler de ingesta
- `server/routes.ts` — Cron `0 */4 * * *` (cada 4h, configurable via `MARKET_METRICS_CRON` env). Primer refresh a los 30s del arranque si `enabled=true`

#### FASE 5 & 6: Engine integrado en tradingEngine
- `server/services/tradingEngine.ts` — Método privado `applyMarketMetricsGate()` al final de la clase. Integrado en dos puntos: línea ~3001 (modo ciclo) y línea ~3973 (modo candle), justo antes de `executeTrade("buy")`. Alertas Telegram en castellano natural cuando acción=BLOQUEAR

#### FASE 7: UI
- `client/src/components/strategies/MarketMetricsTab.tsx` — Tab completo con: toggle habilitado, selector modo (observación/activo), sensibilidad, aplicar a BUY/SELL, estado de proveedores, últimas métricas
- `client/src/pages/Strategies.tsx` — Añadida navegación por pestañas "Configuración" y "Métricas". Import de `MarketMetricsTab`

#### FASE 8: API Routes
- `server/routes/marketMetrics.routes.ts` — Endpoints: `GET /api/market-metrics/config`, `POST /api/market-metrics/config`, `GET /api/market-metrics/status`, `GET /api/market-metrics/snapshots`, `POST /api/market-metrics/refresh`
- `server/storage.ts` — Métodos: `saveMarketMetricSnapshot()`, `getLatestMarketMetrics()`, `saveMarketMetricEvaluation()` en interfaz `IStorage` y clase `DatabaseStorage`

#### FASE 9: Alertas Telegram
- Mensaje en castellano natural: "⚠️ BUY bloqueado — Riesgo de mercado. Par: X. Riesgo: ALTO (score N). Sesgado: BAJISTA. Razones: ..."
- Máximo 2 razones por alerta
- Solo se envía en modo activo (nunca en observación)

### Configuración por defecto
```json
{
  "enabled": false,
  "mode": "observacion",
  "applyToBuy": true,
  "applyToSell": false,
  "sensitivity": "normal"
}
```

### Variables de entorno opcionales
- `WHALE_ALERT_API_KEY` — Activa WhaleAlert provider
- `COINGLASS_API_KEY` — Activa CoinGlass provider (OI, funding, liquidaciones)
- `MARKET_METRICS_CRON` — Override del cron de ingesta (default: `0 */4 * * *`)

### Instrucciones de activación en producción
1. Ejecutar migración: `psql -U krakenstaging -d krakenbot_staging -f db/migrations/018_market_metrics.sql`
2. Deploy en VPS staging
3. Activar en UI: Estrategias → Métricas → Módulo habilitado → Modo: Observación
4. Dejar 24-48h en observación para validar evaluaciones en DB
5. Si evaluaciones son coherentes, cambiar a modo Activo

### Regresión
- Con `enabled: false` (default): comportamiento idéntico al anterior, cero impacto
- Con providers fallando: passthrough automático
- Con cualquier error en el gate: passthrough automático (fail-safe)

---

## 2026-03-03 — FEAT: Retención de Logs Configurable desde UI (Opción D)

### Resumen
Implementación completa de gestión automática del crecimiento de `server_logs` y `bot_events`. La tabla `server_logs` había alcanzado 837 MB (1.5M filas, 88% del espacio total de DB). Se implementa un scheduler interno Node.js con política de retención configurable desde el dashboard de ajustes, sin depender de cron externos.

### Diagnóstico previo
- `server_logs`: 837 MB — 1,506,139 filas — **88% de la DB**
- `bot_events`: 100 MB
- Total DB: 952 MB
- El script `scripts/purge-events.sh` existía pero el cron del VPS no estaba verificado como activo
- Función `purgeOldLogs()` y endpoint `/api/admin/purge-logs` ya existían pero sin scheduler automático interno

### Archivos Creados
- `db/migrations/017_log_retention_config.sql` — Añade 8 columnas a `bot_config`: `log_retention_enabled`, `log_retention_days`, `events_retention_enabled`, `events_retention_days`, `last_log_purge_at`, `last_log_purge_count`, `last_events_purge_at`, `last_events_purge_count`
- `server/services/LogRetentionScheduler.ts` — Scheduler singleton. Se inicializa al arrancar el servidor. Corre purga cada 24h (o al startup si hace >23h desde última purga). Lee configuración de `bot_config`. Registra filas eliminadas y timestamp de última purga.

### Archivos Modificados
- `shared/schema.ts` — Añadidas 8 columnas de retención al Drizzle table `botConfig`
- `server/routes/admin.routes.ts` — Importa `logRetentionScheduler`. Añade `GET /api/admin/retention-status` y `POST /api/admin/run-retention-purge`
- `server/routes.ts` — Inicializa `LogRetentionScheduler` al startup (después de `FiscoKrakenRetryWorker`)
- `server/storage.ts` — Añade 8 columnas de retención a `checkSchemaHealth()` y `runSchemaMigration()` (auto-migración Docker)
- `client/src/pages/Settings.tsx` — Añade card "Retención de Logs" con: contadores de filas actuales, toggle on/off por tabla, selector de días (3/5/7/14/30 para logs; 7/14/30 para eventos), estado de última purga, botón "Purgar ahora" (manual)

### Comportamiento del Scheduler
- **Arranque**: comprueba si han pasado >23h desde `lastLogPurgeAt`. Si es así, purga inmediatamente.
- **Interval**: cada 24h vuelve a comprobar y purgar si corresponde
- **DELETE seguro**: usa `WHERE timestamp < cutoffDate` (nunca TRUNCATE)
- **VACUUM**: no ejecutado por el scheduler (PostgreSQL autovacuum lo gestiona)
- **Sin bloqueo de trading**: operación asíncrona independiente del motor de trading

### Defaults
- `server_logs`: retención 7 días activada (estabiliza tabla en ~840 MB con volumen actual)
- `bot_events`: retención 14 días activada

### Endpoints Nuevos
- `GET /api/admin/retention-status` — Estado actual: filas totales, configuración, última purga
- `POST /api/admin/run-retention-purge` — Purga manual inmediata

---

## 2026-03-08 — FEAT: Comisiones reales de exchanges en FISCO (Kraken + RevolutX)

### Resumen
Implementación de captura de fees reales por operación en el sistema fiscal FIFO.

### Diagnóstico previo
- **Kraken**: fees ya se capturaban correctamente desde el ledger (`received.fee + spent.fee`) ✅
- **RevolutX**: `feeEur` hardcodeado a 0 con comentario "fees are embedded in the spread" ❌
- **FIFO engine**: ya usa `feeEur` correctamente — en compras suma al coste base, en ventas descuenta del gain ✅

### Cambio 1 — `RevolutXService.ts`: `getHistoricalOrders()`
- Añadido `total_fee: number` al tipo de retorno y al objeto acumulado
- Captura desde raw API: `o.total_fee ?? o.fee_amount ?? o.fee ?? o.commission ?? o.fees?.total_value ?? '0'`
- Si la API no devuelve fee (campo ausente o 0), el valor queda en 0 y el normalizer aplica fallback

### Cambio 2 — `normalizer.ts`: `normalizeRevolutXOrders()`
- Añadido `total_fee: number` a la interfaz `RevolutXOrder`
- Lógica de fee (prioridad):
  1. **Fee real de API** si `order.total_fee > 0` → se convierte a EUR al tipo de cambio del momento
  2. **Fallback estimado**: `totalInQuote × 0.0009` (0.09% taker fee publicado por RevolutX)
- Fórmula: `feeEur = (quoteAsset === 'EUR') ? feeInQuote : feeInQuote × usdEurRate`

### Cambio 3 — `FiscoSyncService.ts`: upsert para actualizar fees
- Cambiado `onConflictDoNothing()` → `onConflictDoUpdate({ target: [exchange, externalId], set: { feeEur: sql\`excluded.fee_eur\` } })` en **ambos** métodos: `syncKraken()` y `syncRevolutX()`
- Añadido import `sql` de drizzle-orm
- Efecto: re-sync diario actualiza automáticamente el `fee_eur` de operaciones existentes si el valor cambia

### Impacto en FIFO
- **Compras RevolutX**: `costEur = totalEur + feeEur` → coste base aumenta ~0.09% (correcto fiscalmente, la comisión es parte del precio de adquisición)
- **Ventas RevolutX**: `gainLoss = proceedsEur - costBasisEur - feePortion` → la comisión reduce la ganancia (correcto)
- Para actualizar datos históricos: ejecutar "Sincronizar" en la UI FISCO (Pipeline completo DELETE+REINSERT)

### Nota sobre RevolutX API
RevolutX usa arquitectura Coinbase Advanced Trade. El campo fee en `/api/1.0/orders/historical` puede llamarse `total_fee`, `fee_amount`, `fee` o `commission`. El código intenta todos. Si no hay campo, aplica el 0.09% estimado.

---

## 2026-03-04 — FIX: Doble scheduler FISCO + Mejoras retry RATE_LIMIT

### Resumen
Fix bloqueante de doble scheduler (2 syncs paralelos a las 08:30) + 4 mejoras de robustez detectadas en auditoría post-deploy.

### P1 CRÍTICO — Eliminar cron inline redundante en routes.ts

**Archivo:** `server/routes.ts`

- **Bug**: Existían 2 schedulers independientes disparando a las 08:30:
  - A) `cron.schedule(fiscoCron, ...)` inline en `routes.ts` → llamaba `GET /api/fisco/run` → `saveFiscoToDB` (DELETE+INSERT)
  - B) `fiscoScheduler.initialize()` → `FiscoScheduler.executeDailySync()` → `syncAllExchanges()`
- **Consecuencias**: Doble consumo de rate limit Kraken, doble Telegram, condición de carrera en `DELETE FROM fisco_operations/lots/disposals`
- **Fix**: Eliminado completamente el bloque inline de `routes.ts` (líneas 203-328). Scheduler oficial es único: `FiscoScheduler.initialize()` en línea ~636
- El endpoint `/api/fisco/run` sigue existiendo para uso manual

### P2 CRÍTICO — scheduleRetry() movido a FiscoScheduler.executeDailySync()

**Archivo:** `server/services/FiscoScheduler.ts`

- Añadido import estático: `import { fiscoKrakenRetryWorker } from "./FiscoKrakenRetryWorker"`
- En `executeDailySync()` tras `syncAllExchanges()`: busca `results.find(r => r.exchange === 'Kraken' && r.status === 'error')`, detecta `EAPI:Rate limit` en el mensaje
- En el `catch` de `executeDailySync()`: detecta RATE_LIMIT incluso en fallo global (no depende de que RevolutX funcione para programar retry)
- En ambos casos: llama `fiscoKrakenRetryWorker.scheduleRetry()` + `sendKrakenRetryScheduled(nextRetryAt, retryCount+1, 'RATE_LIMIT')`

### P3 MEDIO — Reset diario completo del estado retry

**Archivo:** `server/services/FiscoKrakenRetryWorker.ts`

- **Bug**: `resetExhausted()` solo reseteaba filas con `status='exhausted'`. Filas `resolved` del día anterior mantenían `retryCount` alto → primer retry del nuevo día usaba delay largo (ej: 20m en vez de 5m)
- **Fix**: `resetExhausted()` ahora resetea TODAS las filas de `exchange='kraken'` a `retryCount=0, status='resolved'` sin filtrar por status

### P4 BAJO — Telegram muestra intento real

**Archivo:** `server/services/FiscoKrakenRetryWorker.ts` + `FiscoScheduler.ts`

- **Bug**: `sendKrakenRetryScheduled(nextRetryAt, 0, ...)` siempre mostraba attempt=1 (hardcoded 0)
- **Fix**: `scheduleRetry()` ahora retorna `{ nextRetryAt: Date; retryCount: number }` en vez de solo `Date`. FiscoScheduler usa `retryCount + 1` como número de intento real

### P5 BAJO — Doble delay eliminado en paginación Kraken

**Archivo:** `server/services/kraken.ts`

- **Bug**: `RATE_LIMIT_DELAY = 3500ms` en ambos loops de paginación + `callKraken 500ms` = ~4s/página
- **Fix**: `RATE_LIMIT_DELAY = 1000ms` — efectivo 1.5s/página. Para ledger completo (~20 páginas): 30s vs 84s anteriores
- Comportamiento seguro mantenido: `callKraken` sigue gestionando errores RATE_LIMIT reales

---

## 2026-03-04 — FEAT: Cron fiscal 08:30 + Rate limiter Kraken + Retry worker Kraken

### Resumen
Tres mejoras de robustez para la sincronización fiscal:
1. Cron fiscal movido de 08:00 a 08:30 (Europe/Madrid)
2. Rate limiter global para TODAS las llamadas a la API de Kraken
3. Worker de reintento persistente para Kraken cuando RATE_LIMIT (backoff exponencial + Telegram)

---

### TASK 1 — Cron fiscal 08:00 → 08:30 (Europe/Madrid)

**Archivos:** `server/services/FiscoScheduler.ts`, `server/routes.ts`

- `FiscoScheduler.ts`: cron `'0 8 * * *'` → `'30 8 * * *'`, `setHours(8,0)` → `setHours(8,30)`, log actualizado
- `routes.ts`: default `FISCO_DAILY_SYNC_CRON` de `'0 8 * * *'` → `'30 8 * * *'`, comentario actualizado
- `FiscoTelegramNotifier.ts`: etiqueta `getTriggerLabel('scheduler')` actualizada a `08:30`

---

### TASK 2 — Reintento Kraken con backoff persistente (RATE_LIMIT)

**Archivos nuevos:**
- `server/services/FiscoKrakenRetryWorker.ts`: worker que corre cada minuto, detecta retries pendientes en DB, ejecuta `syncKrakenOnly`, aplica backoff con jitter ±20%
- Backoff: +5m, +10m, +20m, +40m, +60m, +60m (máx 6 intentos)
- Reset automático a medianoche para `exhausted`

**Archivos modificados:**
- `shared/schema.ts`: tabla `fisco_sync_retry` (exchange, retryCount, nextRetryAt, lastErrorCode, lastErrorMsg, status)
- `script/migrate.ts`: `CREATE TABLE IF NOT EXISTS fisco_sync_retry`
- `server/services/FiscoSyncService.ts`: `syncKrakenOnly(runId)` expuesto como método público
- `server/services/FiscoTelegramNotifier.ts`: métodos `sendKrakenRetryScheduled`, `sendKrakenRetryRecovered`, `sendKrakenRetryExhausted`
- `server/routes/fisco.routes.ts`: endpoint `GET /api/fisco/run-kraken` (solo Kraken, devuelve 429 en RATE_LIMIT)
- `server/routes.ts`: inicializa `fiscoKrakenRetryWorker.initialize()` al arrancar; cuando el cron obtiene 207+RATE_LIMIT → llama `scheduleRetry()` + `sendKrakenRetryScheduled()`

**Flujo:**
1. Cron 08:30 → `/api/fisco/run` → 207 parcial con Kraken RATE_LIMIT
2. `routes.ts` detecta el error → `fiscoKrakenRetryWorker.scheduleRetry()` → guarda en DB con `nextRetryAt = now + 5m±20%`
3. Telegram: `⚠️ Kraken RATE_LIMIT, reintento programado HH:MM`
4. Worker tick cada minuto: si `nextRetryAt <= now` → llama `syncKrakenOnly()`
5. Si OK → `status='resolved'` + Telegram `✅ Kraken RECUPERADO`
6. Si RATE_LIMIT de nuevo → `retryCount++`, nuevo `nextRetryAt` con backoff
7. Si `retryCount >= 6` → `status='exhausted'` + Telegram `🔴 REINTENTOS AGOTADOS`
8. A medianoche → reset `exhausted` → listo para el día siguiente

---

### TASK 3 — Rate limiter global Kraken

**Archivos nuevos:**
- `server/utils/krakenRateLimiter.ts`: cola FIFO con `minTime` entre llamadas (default 500ms), concurrencia configurable
- Config: `KRAKEN_MIN_TIME_MS=500`, `KRAKEN_CONCURRENCY=1` (env vars)
- Error tipado: si Kraken responde `EAPI:Rate limit`, lanza `{ errorCode: 'RATE_LIMIT' }`

**Archivos modificados:**
- `server/services/kraken.ts`:
  - Import `krakenRateLimiter`
  - Nuevo método privado `callKraken<T>(fn)` → wrapper del limiter
  - `executeWithNonceRetry`: `operation()` → `this.callKraken(operation)` (todas las llamadas privadas)
  - Calls públicos: `loadPairMetadata`, `getTicker`, `getTickerRaw`, `getAssetPairs`, `getOHLC` → `this.callKraken(() => ...)`

---

> Registro detallado de cambios, fixes y mejoras en el sistema de trading autónomo.  
> Documentación completa de problemas resueltos y decisiones técnicas.

---

## 2026-03-03 — FIX: INCIDENCIA — fisco-daily-sync HTTP 500 + MTF snapshot N/A

### Resumen
Dos incidencias detectadas el 03/03/2026 a través de alertas Telegram en staging.

### FIX A — fisco-daily-sync: nunca HTTP 500 global por fallo de un exchange (CRÍTICO)

**Archivos:** `server/routes/fisco.routes.ts`, `server/routes.ts`

**Bug raíz**: `/api/fisco/run` llamaba `krakenService.getLedgers({ fetchAll: true })` sin try/catch por exchange. Cuando Kraken devolvió `EAPI:Rate limit exceeded`, la excepción propagaba hasta el handler global → HTTP 500 → el cron de `routes.ts` lanzaba error.

**Fix en `fisco.routes.ts`**:
- Envuelto fetch de Kraken en try/catch individual. Si falla: registrar en `exchangeErrors[]` y continuar con RevolutX.
- Envuelto fetch de RevolutX en try/catch individual. Ídem.
- Detección específica de rate limit Kraken: mensaje contiene `EAPI:Rate limit` → `errorCode: "RATE_LIMIT"` (en vez de genérico `SYNC_ERROR`).
- Si TODOS los exchanges fallan (0 operaciones) → 500 con breakdown.
- Si AL MENOS UNO tiene datos → continuar FIFO + retornar **HTTP 207** con `status: "partial_success"` y `exchange_errors: [...]`.

**Fix en `routes.ts` cron**:
- Cambiado `if (!response.ok)` por `if (response.status >= 500)`. Los status 200/207 ya no se tratan como error.
- Notificación Telegram actualizada: si 207 → `⚠️ SINCRONIZACIÓN FISCAL PARCIAL` con lista de exchanges fallidos + `errorCode`.
- Mensaje incluye `❌ Kraken: RATE_LIMIT — EAPI:Rate limit exceeded` para traceabilidad.

**Comportamiento esperado tras fix**:
- Kraken falla por rate limit → RevolutX sincroniza correctamente → respuesta 207 → notificación `⚠️ PARCIAL` en Telegram (no error).
- Solo se genera alerta de error si AMBOS exchanges fallan simultáneamente.

### FIX B — MTF_STRICT snapshot: currentPrice/ema20/volumeRatio = N/A (ALTO)

**Archivo:** `server/services/tradingEngine.ts`

**Bug raíz**: En `analyzeWithCandleStrategy`, las métricas BUY (`currentPrice`, `ema20`, `volumeRatio`, `priceVsEma20Pct`) se calculaban dentro del bloque `ANTI_CRESTA` (scoped al `if`), por lo que no estaban disponibles cuando el bloque `MTF_STRICT` llamaba a `sendSignalRejectionAlert`. El alert se enviaba sin esos campos → todos aparecían como "N/A" en el snapshot de Telegram.

**Fix**:
- Extraídas las métricas BUY en un bloque `buyMetrics` ANTES de ambos filtros (ANTI_CRESTA y MTF).
- El bloque ANTI_CRESTA ahora desestructura `{ ema20, currentPrice, priceVsEma20Pct, volumeRatio } = buyMetrics`.
- El bloque MTF_STRICT pasa `buyMetrics.{campo}` tanto a `sendSignalRejectionAlert` como a `maybeCreateHybridReentryWatch`.

**Nota sobre mtfAlignment=-0.70/-0.33**: Estos valores son **comportamiento esperado** por cuantización de la fórmula `twoAligned`:
- Si `twoAligned=true` y `shortTerm !== "neutral"`: alignment = -0.7 (totalScore < 0)
- Si `twoAligned=true` pero `shortTerm === "neutral"`: cae al branch `else` → alignment = totalScore/4.5 ≈ -0.33

No es un bug. Los valores son deterministas según la combinación de tendencias 5m/1h/4h.

---

## 2026-03-02 — FIX: Motor IA/ML — Fixes críticos pipeline (Fixes #1-#4)

### Resumen
Cuatro fixes críticos identificados en la Fase 1 de verificación del Motor IA/ML. El pipeline existía pero estaba roto en dos puntos críticos: (1) el entrenamiento nunca funcionaba por incompatibilidad de formato JSON y (2) el filtro predictivo no estaba conectado al flujo de trading.

### FIX #1 — mlTrainer.py: Formato JSON incompatible TS↔Python (CRÍTICO)
**Archivo:** `server/services/mlTrainer.py`
- **Bug**: TypeScript enviaba `{train: [...], val: [...]}` pero Python iteraba el objeto como si fuera un array, obteniendo solo las claves "train" y "val". Resultado: `complete_samples = []` siempre → entrenamiento fallaba con "Not enough samples: 0".
- **Fix**: Detectar formato del JSON: si es `dict` → concatenar `train + val`; si es `list` → usarlo directamente.
- **Fix**: Eliminar filtro `isComplete` (no existe en `training_trades`, solo existe `labelWin`).
- **Fix**: Usar `AI_MODEL_DIR` env var en lugar de `/tmp/models` hardcodeado.

### FIX #2 — tradingEngine.ts: AI filter no integrado en flujo de trading (CRÍTICO)
**Archivo:** `server/services/tradingEngine.ts`
- **Bug**: `filterEnabled` y `shadowEnabled` existían en DB pero nadie los leía en el motor de trading. `aiService.predict()` nunca se llamaba antes de ejecutar un BUY.
- **Fix**: Bloque `=== AI FILTER / SHADOW MODE ===` inyectado justo antes de `executeTrade` en el flujo BUY candles (`analyzePairAndTradeWithCandles`):
  - Lee `aiCfg.filterEnabled` y `aiCfg.shadowEnabled` de DB.
  - Si alguno activo: calcula features reales → llama `aiService.predict(features)`.
  - Si `filterEnabled` y `!prediction.approve` → bloquea BUY con `blockReasonCode: "AI_FILTER_BLOCK"`.
  - Si `shadowEnabled` → guarda predicción en `ai_shadow_decisions` sin bloquear.
- Añadido `"AI_FILTER_BLOCK"` al union type `BlockReasonCode`.

### FIX #3 — tradingEngine.ts: Features hardcodeadas (rsi: 50) (ALTO)
**Archivo:** `server/services/tradingEngine.ts`
- **Bug**: El sample collection usaba `rsi: 50` fijo. El modelo se entrenaría con features ficticias.
- **Fix**: Nuevo método privado `buildAiFeatures(pair, timeframe, confidence, spreadPct)`:
  - Obtiene velas desde el exchange (cache existente).
  - Calcula RSI-14, MACD (line/signal/hist), Bollinger Bands (upper/middle/lower), ATR-14, EMA-12, EMA-26.
  - Calcula priceChange1h/4h/24h desde velas históricas (12/48/100 periodos de 5m).
  - Calcula volume24hChange como ratio últimas 5 vs previas 5 velas.
  - Fallback a features vacías si no hay suficientes velas (≥27 requeridas).

### FIX #4 — Persistencia del modelo fuera de /tmp (MEDIO)
**Archivos:** `server/services/aiService.ts`, `server/services/mlTrainer.py`, `docker-compose.staging.yml`
- **Bug**: Modelo guardado en `/tmp/models/` → se perdía en cada reinicio del contenedor Docker.
- **Fix**: Variable de entorno `AI_MODEL_DIR` con fallback a `/tmp/models`.
- **Fix docker-compose.staging.yml**: Añadido `AI_MODEL_DIR=/app/ml_models` + volumen persistente `ai_models_staging:/app/ml_models`.

### Estado del Motor IA/ML tras fixes

| Componente | Antes | Después |
|------------|-------|---------|
| Backfill | ✅ FUNCIONA | ✅ Sin cambios |
| Labeling | ✅ FUNCIONA | ✅ Sin cambios |
| Training | ❌ NO FUNCIONA | ✅ FUNCIONA (Fix #1) |
| AI Filter activo | ❌ NO CONECTADO | ✅ INTEGRADO (Fix #2) |
| Shadow Mode | ❌ NO CONECTADO | ✅ INTEGRADO (Fix #2) |
| Features realistas | ❌ rsi=50 fijo | ✅ RSI/MACD/BB/ATR/EMA reales (Fix #3) |
| Persistencia modelo | ⚠️ /tmp (efímero) | ✅ Volumen Docker persistente (Fix #4) |

### Nota: umbral mínimo de entrenamiento
El modelo requiere 300 samples etiquetados (actualmente 163). Hasta alcanzar 300, el filtro activo no se puede activar (`canActivate=false`). El shadow mode sí puede activarse (registra predicciones sin bloquear) para monitorear el comportamiento del modelo en tiempo real una vez entrenado.

---

## 2026-03-02 — FEAT: MTF Threshold Dinámico por ADX + Mejora de datos MTF (Fase 1 + 2)

### Descripción
Reducción de overfiltering en régimen TRANSITION mediante threshold MTF dinámico basado en ADX. Mejora de calidad y actualidad de los datos multi-timeframe.

### Problema resuelto
El filtro MTF en TRANSITION usaba un threshold hardcodeado de 0.30 para compras. En mercados con ADX bajo (16–20), este threshold bloqueaba señales de rebote legítimas, causando sequías operativas de varios días a pesar de movimientos del 5–6%.

### FASE 1 — Threshold dinámico por ADX en TRANSITION

**Archivo:** `server/services/strategies.ts` → `applyMTFFilter()`
- Nueva firma: `applyMTFFilter(signal, mtf, regime, adx?: number)`
- Lógica dinámica solo para `TRANSITION`:
  - `ADX < 20` → threshold = **-0.10** (mercado débil, permite rebotes)
  - `ADX 20–24` → threshold = **0.00** (neutral)
  - `ADX ≥ 25` → threshold = **0.15** (tendencia formándose)
  - `ADX undefined` → threshold = **0.30** (fallback al comportamiento anterior)
- RANGE y TREND: sin cambios
- Log enriquecido: `"MTF insuficiente en TRANSITION (-0.44 < 0.00, ADX=22, 5m=neutral/1h=bearish/4h=bearish)"`

**Archivo:** `server/services/tradingEngine.ts`
- `analyzeWithCandleStrategy()`: añadido parámetro `adx?: number`
- `analyzePairAndTradeWithCandles()`: captura `earlyRegimeAdx = regimeAnalysis.adx` y lo propaga a los 3 call sites de `analyzeWithCandleStrategy()`
- Delegate `applyMTFFilter()` actualizado para pasar `adx`

### FASE 2 — Mejora de datos MTF

**Archivo:** `server/services/mtfAnalysis.ts`
- **5m: `slice(-50)` → `slice(-100)`** — mayor historial para EMA/HH/LL del corto plazo (~8.3h contexto vs ~4.1h anterior)
- 1h y 4h: sin cambio (mantienen `slice(-50)`)
- Nuevo método `MtfAnalyzer.invalidate(pair)` para eliminar cache bajo demanda

**Archivo:** `server/services/tradingEngine.ts`
- Nuevo delegate `invalidateMtfCache(pair)` → `this.mtfAnalyzer.invalidate(pair)`
- En cierre de vela 15m (`isNewCandleClosed`): **`invalidateMtfCache(pair)` se llama ANTES de `analyzePairAndTradeWithCandles()`** → garantiza datos MTF frescos en cada evaluación completa, sin impactar ciclos intermedios

### Criterios de aceptación
- ✅ Logs muestran threshold dinámico real con ADX en TRANSITION
- ✅ Reason incluye componentes 5m/1h/4h del MTF
- ✅ 5m usa 100 velas; 1h y 4h conservan 50
- ✅ MTF se refresca en cada cierre de vela 15m (no usa caché de hasta 5 min)
- ✅ Sin cambios en scoring MTF (`analyzeMultiTimeframe`), TREND ni RANGE

---

## 2026-02-27 — FEAT: Smart TimeStop — TTL por activo con multiplicadores de régimen

### Descripción
TimeStop rediseñado como stop temporal real con TTL inteligente per-asset/mercado, multiplicadores por régimen de mercado, y política de cierre configurable.

### Funcionalidad
1. **TTL per-asset**: Cada par tiene su propio TTL base en la tabla `time_stop_config` (ej: BTC=48h, SOL=24h)
2. **Multiplicador por régimen**: `TTL_final = clamp(TTL_base * factorRegime, minTTL, maxTTL)`
   - TREND: factor 1.2-1.5 (más tiempo para capturar tendencias)
   - RANGE: factor 0.7-0.8 (cortar posiciones estancadas más rápido)
   - TRANSITION: factor 0.9-1.0 (neutral)
3. **Cierre real al expirar**: El bot ejecuta VENTA (closeReason=TIMESTOP) al expirar el TTL
4. **Excepción UI toggle**: Si timeStopDisabled=true, NO ejecuta venta pero SÍ registra el evento
5. **Política de cierre**: Market (default) o Limit con fallback a Market tras X segundos
6. **Alertas Telegram**: Mensajes diferenciados para expirado+cerrado, expirado+desactivado
7. **Configuración wildcard**: Fila `*:spot` como fallback si un par no tiene config específica
8. **Fallback legacy**: Si no existe tabla `time_stop_config`, usa `bot_config.timeStopHours`

### Nuevos Archivos
- `db/migrations/016_time_stop_smart_config.sql` — Migración: tabla + seeds (BTC, ETH, SOL, XRP, wildcard)
- `server/services/TimeStopService.ts` — Servicio: cálculo TTL inteligente, caché in-memory 5min
- `server/routes/timestop.routes.ts` — API CRUD: GET/PUT/DELETE /api/config/timestop + preview TTL

### Archivos Modificados
- `shared/schema.ts` — Tabla Drizzle `timeStopConfig` + types + insert schema
- `server/storage.ts` — Métodos: getTimeStopConfigs, getTimeStopConfigForPair, upsertTimeStopConfig, deleteTimeStopConfig
- `server/services/exitManager.ts` — checkTimeStop y checkSmartGuardExit reescritos para usar Smart TimeStop
- `server/services/exitManager.ts` — IExitManagerHost: nuevo método `getMarketRegime(pair)`
- `server/services/tradingEngine.ts` — createExitHost: implementa `getMarketRegime` via RegimeManager
- `server/services/botLogger.ts` — Nuevos EventTypes: TIME_STOP_EXPIRED_DISABLED, TIME_STOP_CLOSE, TIME_STOP_LIMIT_FALLBACK
- `server/routes.ts` — Registro de rutas TimeStop

### API Endpoints
- `GET /api/config/timestop` — Lista todas las configs
- `GET /api/config/timestop/:pair` — Config para un par (con fallback wildcard)
- `GET /api/config/timestop/:pair/preview` — Preview TTL calculado por régimen
- `PUT /api/config/timestop` — Upsert config (crear/actualizar)
- `DELETE /api/config/timestop/:id` — Eliminar config

### Valores Seed por Defecto
| Par | TTL Base | Factor TREND | Factor RANGE | Min TTL | Max TTL |
|-----|----------|-------------|-------------|---------|---------|
| BTC/USD | 48h | 1.500 | 0.700 | 6h | 240h |
| ETH/USD | 36h | 1.300 | 0.750 | 4h | 168h |
| SOL/USD | 24h | 1.200 | 0.800 | 3h | 120h |
| XRP/USD | 24h | 1.200 | 0.800 | 3h | 120h |
| * (default) | 36h | 1.200 | 0.800 | 4h | 168h |

---

## 2026-02-27 — FIX: Comandos Telegram actualizados + alertas FISCO

### Problemas
1. Comandos FISCO (`/informe_fiscal`, `/fiscal`, `/reporte`, `/impuestos`) no aparecían en la lista de comandos de Telegram
2. `handleInformeFiscal` hacía full sync desde 2020 + usaba plantilla HTML vieja ("KrakenBot Fiscal")
3. `/ayuda` no mostraba sección FISCO
4. `/menu` no tenía botón "Informe Fiscal"
5. Callback `logs_page_` no estaba manejado (paginación de logs rota)
6. `handleInformeFiscal` verificaba `defaultChat` como auth — bloqueaba uso legítimo

### Correcciones
1. **`types.ts`**: Añadidos 4 comandos FISCO a `TELEGRAM_COMMANDS`
2. **`handleInformeFiscal`**: Reescrito — sin sync, llama a `/api/fisco/report/existing` (misma plantilla que UI), envía como archivo HTML adjunto al chat que lo solicita
3. **`handleAyuda`**: Añadida sección "📄 FISCO (Fiscal)" con los 4 comandos
4. **`handleMenu`**: Añadido botón "📄 Informe Fiscal" con callback `MENU_FISCO`
5. **`handleCallbackQuery`**: Añadido case `MENU_FISCO` + handling dinámico para `logs_page_` y `logs_info`
6. Eliminada plantilla HTML duplicada/obsoleta `generateFiscalReport` de telegram.ts

### Archivos Modificados
- `server/services/telegram/types.ts` — TELEGRAM_COMMANDS con FISCO
- `server/services/telegram.ts` — handleInformeFiscal, handleAyuda, handleMenu, callbacks

---

## 2026-02-27 — FIX: Pipeline Informe→Telegram (schema + notifier + sync innecesaria)

### Problemas
1. `fisco_alert_config` tenía columnas incorrectas → error `column "sync_daily_enabled" does not exist`
2. `fisco_sync_history` tenía columnas incorrectas → error `column "triggered_by" does not exist`
3. `FiscoTelegramNotifier` usaba `storage.getDefaultChat()` (chat global) en vez del chatId configurado en FISCO
4. Botón "Informe → Telegram" hacía full sync desde 2020 antes de generar informe → rate limit Kraken

### Correcciones
1. **Self-healing tables** (`fiscoAlerts.routes.ts`): `ensureFiscoTables()` valida columnas clave (`sync_daily_enabled`, `triggered_by`). Si faltan → DROP + CREATE con schema correcto.
2. **FiscoTelegramNotifier** (`FiscoTelegramNotifier.ts`): Todos los métodos (`sendToConfiguredChat`, `sendHtmlReport`, `sendTextReport`, `getAlertConfig`) ahora leen el `chatId` directamente de `fisco_alert_config` (el canal seleccionado en la UI), no del default chat global. Eliminado import `storage`.
3. **Pipeline sin sync** (`fiscoAlerts.routes.ts`): Botón "Informe → Telegram" ahora solo genera informe desde datos existentes en DB y lo envía. Sin sync previa (el botón "Sincronizar" ya existe para eso).

### Archivos Modificados
- `server/routes/fiscoAlerts.routes.ts` — Self-healing tables + pipeline sin sync
- `server/services/FiscoTelegramNotifier.ts` — Usa chatId de config FISCO

---

## 2026-02-26 — FEAT: Selector de canal Telegram para alertas FISCO

### Cambios
1. **Selector de canal en tab "Alertas Telegram"** (`Fisco.tsx`): Dropdown con todos los canales Telegram activos (TECNICO, CANAL ERRORES, CANAL TRADES). El usuario elige a qué canal enviar informes y alertas fiscales.
2. **Backend PUT `/api/fisco/alerts/config`**: Acepta `chatId` del body para cambiar canal destino. Ya no depende de un "default chat" global.
3. **Backend GET `/api/fisco/alerts/config`**: Busca config existente en DB directamente, sin depender del default chat.
4. **Warning visual**: Muestra aviso amarillo si no hay canal seleccionado aún.

### Archivos Modificados
- `client/src/pages/Fisco.tsx` — Selector canal Telegram + query telegramChats
- `server/routes/fiscoAlerts.routes.ts` — GET/PUT independientes de default chat

---

## 2026-02-26 — FIX: Crash startup VPS (revolutxService undefined) + Auto-migración tablas FISCO

### Problema
La app crasheaba al iniciar en VPS con `ReferenceError: revolutxService is not defined` en `routes.ts`.

### Causa Raíz
En `routes.ts` línea 51, se usaba shorthand property `revolutxService` (minúscula x), pero el import real es `revolutXService` (mayúscula X). TypeScript no detecta el error porque la propiedad del interface `RouterDeps` se llama `revolutxService`, pero en runtime la variable `revolutxService` no existe — solo existe `revolutXService`.

### Correcciones
1. **FIX `routes.ts`**: Cambiado `revolutxService,` → `revolutxService: revolutXService,` (asignación explícita).
2. **Auto-migración tablas FISCO en `script/migrate.ts`**: Añadidas migraciones `CREATE TABLE IF NOT EXISTS` para:
   - `fisco_alert_config` — configuración de alertas por chat
   - `fisco_sync_history` — historial de sincronizaciones
   - `fisco_operations` — operaciones importadas de exchanges
   - `fisco_lots` — lotes FIFO de compra
   - `fisco_disposals` — ventas con ganancia/pérdida

### Archivos Modificados
- `server/routes.ts` — Fix asignación revolutxService
- `script/migrate.ts` — Auto-creación tablas FISCO

---

## 2026-02-26 — FEAT: Panel UI Alertas FISCO + Fixes críticos de rutas

### Cambios Implementados

1. **Nueva tab "Alertas Telegram" en Fisco.tsx**: Panel completo con toggles Switch para activar/desactivar cada tipo de alerta (sync diaria, sync manual, informe generado, errores). Incluye preferencias de notificación (notificar siempre, umbral de resumen). Guardado automático al cambiar cada toggle.
2. **Historial de sincronización**: Tabla con fecha, modo, origen, estado y duración de cada sync. Botón "Sync Manual" integrado.
3. **Card info comandos Telegram**: Muestra los 4 comandos disponibles (`/informe_fiscal`, `/fiscal`, `/reporte`, `/impuestos`).
4. **FIX endpoint PUT `/api/fisco/alerts/config`**: Cambiado de validación full-schema a partial update (soporta enviar solo un campo). Upsert automático con defaults.
5. **FIX orden de rutas**: `/api/fisco/sync/history` movida ANTES de `/api/fisco/sync/:runId` para evitar que Express capture "history" como parámetro `:runId`.

### Archivos Modificados
- `client/src/pages/Fisco.tsx` — Tab "Alertas Telegram" completa (toggles, historial, comandos info)
- `server/routes/fiscoAlerts.routes.ts` — PUT partial update + orden correcto de rutas

---

## 2026-02-26 — FEAT: Módulo FISCO Expandido (Alertas Telegram + Sync Automático + Informe → Telegram)

### Resumen
Ampliación completa del módulo FISCO para:
1. Alertas Telegram configurables desde la UI (toggles + canal destino)
2. Sincronización automática diaria Exchange → Bot a las 08:00 (Europe/Madrid)
3. Botón UI + comando Telegram `/informe_fiscal` para: sync → generar informe → enviar a Telegram
4. **REGLA CRÍTICA**: El informe fiscal usa EXACTAMENTE la misma plantilla existente (`generateBit2MePDF`), sin cambios

### Nuevos Archivos Creados
- `server/services/FiscoSyncService.ts` — Servicio unificado de sincronización para todos los exchanges (Kraken + RevolutX). Importa trades, depósitos, retiros, staking. Guarda historial en DB con runId/mode/status.
- `server/services/FiscoTelegramNotifier.ts` — Envío de alertas configurables. Tipos: sync_daily, sync_manual, report_generated, sync_error. Mensajes HTML profesionales con emojis, resumen/detalle según umbral (>30 ops = resumen).
- `server/services/FiscoScheduler.ts` — Job cron diario a las 08:00 Europe/Madrid. Ejecuta sync completo y envía alerta. Singleton con initialize/shutdown.
- `server/routes/fiscoAlerts.routes.ts` — Endpoints API: GET/PUT alertas config, POST sync manual, POST generar informe, GET sync status/history, GET health check.

### Archivos Modificados
- `shared/schema.ts` — Nuevas tablas: `fisco_alert_config` (toggles alertas, chat destino, umbral), `fisco_sync_history` (historial syncs con runId). Tipos Zod + insert schemas. AlertPreferences extendido con alertas FISCO.
- `server/storage.ts` — Interfaz IStorage extendida + implementación DatabaseStorage: CRUD para fisco_alert_config y fisco_sync_history.
- `server/routes.ts` — Registro de rutas fiscoAlerts + inicialización del FiscoScheduler en startup.
- `server/routes/types.ts` — RouterDeps extendido con krakenService y revolutxService.
- `server/services/telegram.ts` — Nuevos comandos: `/informe_fiscal`, `/fiscal`, `/reporte`, `/impuestos`. Control de acceso (solo chat configurado). Pipeline: sync → generar informe real → enviar.
- `client/src/pages/Fisco.tsx` — Nuevo botón "Informe → Telegram" (verde, icono Send). Mutación `generateAndSend` que llama a `/api/fisco/report/generate`. Estados: Generando/Enviado/Error.

### Correcciones de Auditoría (bugs detectados y corregidos)
1. **FiscoSyncService**: Campos `rawJson`/`raw` corregidos a `rawData` + `pair` (campos reales de NormalizedOperation). Método `getOrderHistory` corregido a `getHistoricalOrders` (método real de RevolutXService). Eliminado `updatedAt` de fiscoSyncHistory (no existe en schema).
2. **FiscoTelegramNotifier**: `sendTelegramMessage` corregido a `telegramService.sendToChat()` (firma real). `(storage as any).db` corregido a importar `db` directamente.
3. **FiscoScheduler**: Cron `'0 7 * * *'` corregido a `'0 8 * * *'` con timezone Europe/Madrid (el timezone ya maneja la hora directamente).
4. **generateExistingFiscalReport**: Mock HTML reemplazado por llamada real a `/api/fisco/annual-report` + generación HTML idéntica a la plantilla del frontend.
5. **Schema**: `insertFiscoSyncHistorySchema` corregido para permitir `startedAt`.

### Endpoints API Nuevos
- `GET /api/fisco/alerts/config` — Obtener configuración alertas FISCO
- `PUT /api/fisco/alerts/config` — Actualizar configuración
- `POST /api/fisco/sync/manual` — Sincronización manual (async, devuelve runId)
- `GET /api/fisco/sync/:runId` — Estado de sync por runId
- `GET /api/fisco/sync/history` — Historial de sincronizaciones
- `POST /api/fisco/report/generate` — Pipeline completo: sync → report → telegram
- `GET /api/fisco/report/existing` — Obtener informe sin sincronizar
- `GET /api/fisco/alerts/health` — Health check de servicios FISCO

### Comandos Telegram Nuevos
- `/informe_fiscal` — Pipeline completo (sync + report + envío)
- `/fiscal`, `/reporte`, `/impuestos` — Alias del anterior
- Control de acceso: solo chat por defecto configurado

---

## 2026-02-25 — FIX: Correcciones PDF Fiscal (branding, datos, normalización, 2024)

### Cambios Implementados

1. **Branding PDF**: Sustituido "KRAKENBOT.AI" por "Gestor Fiscal de Criptoactivos" en todas las páginas. Variable centralizada `BRAND_LABEL`.
2. **Tabla agregada por activo**: Añadida tabla "B) Resumen por activo (agregado)" que fusiona exchanges, debajo de la tabla "A) Por activo y exchange". Ambas con fila "Total año".
3. **Origen de Datos**: Sustituido "genesis" por etiqueta dinámica basada en exchanges presentes en el informe (ej: "Kraken + Revolutx").
4. **Cuenta**: Sustituido "BÓSIM" por "Cuenta Principal" en PDF y dashboard.
5. **EUR.HOLD normalizado**: Añadidos mappings para tickers Kraken con sufijos (.HOLD, .S, .M, .F, .P) en `normalizer.ts`. Fallback con regex para futuros sufijos. Balance de Kraken en Section D ahora se normaliza via `krakenService.normalizeAsset()`.
6. **Selector de años 2024+**: El selector ahora muestra siempre años desde 2024 hasta el actual, independientemente de si hay datos en DB. Permite generar informes vacíos para verificar.

### Diagnóstico: Operaciones 2024 faltantes
- El pipeline `/api/fisco/run` ya usa `fetchAll: true` sin filtro de fecha → trae historial completo de Kraken y RevolutX.
- Si no aparecen operaciones 2024, es porque: (a) no se ha ejecutado sync tras el deploy, o (b) las APIs de los exchanges no devuelven datos de ese periodo (Kraken sí guarda todo; RevolutX puede tener límite).
- **Solución**: Ejecutar "Sincronizar Datos" desde la UI. El pipeline traerá todo el historial disponible y 2024 aparecerá si existen operaciones.

### Archivos Modificados
- `client/src/pages/Fisco.tsx` — Branding, labels dinámicos, tabla agregada, selector años
- `server/services/fisco/normalizer.ts` — ASSET_MAP ampliado, normalización con fallback regex
- `server/routes/fisco.routes.ts` — Normalización de balance Kraken en Section D

---

## 2026-02-25 — FEAT: Observabilidad D2/MINI-B en PAIR_DECISION_TRACE

### Resumen
Enriquecimiento del log `PAIR_DECISION_TRACE` con campos diagnósticos `spreadDiag` y `timingDiag` para validar D2 (MarkupTracker/spread) y MINI-B (staleness/chase) sin necesidad de señal BUY activa.

### Campos Añadidos
- **`spreadDiag`**: `{ markupSource, markupPct, markupSamples, markupEma }` — muestra la fuente de markup (fixed/dynamic), el porcentaje aplicado, muestras en EMA y valor EMA actual.
- **`timingDiag`**: `{ candleAgeSec, lastCandleCloseIso }` — edad en segundos de la última vela cerrada y su timestamp ISO.

### Validación (2026-02-25 13:46–13:52 UTC)
- 24 trazas analizadas (12 scans × 2 pares): **100% con campos presentes**
- `markupSource=fixed`, `markupPct=0.8`, `markupSamples=0` → correcto (sin fills recientes)
- `candleAgeSec` crece ~30s entre scans → coherente con ciclo de 30s
- 0 errores, 0 crasheos

### Archivos Modificados
- `server/services/tradingEngine.ts` — Interfaz `DecisionTraceContext` + método `emitPairDecisionTrace`

### Commit
- `ccf537e` — `feat(observability): enriquecer PAIR_DECISION_TRACE con spreadDiag y timingDiag`

---

## 2026-02-24 — FIX: Verificación y corrección de errores Sistema FISCO

### Problemas Detectados y Corregidos

1. **Estructura JSX rota** — `</SectionCard>` y `)}` duplicados/huérfanos en líneas 679-681 que rompían la compilación
2. **Modal fuera del componente** — El modal de lotes FIFO estaba renderizado fuera del `return()` del componente React
3. **CardContent condicional huérfano** — Restos del antiguo sistema collapsible `)}` que impedían el render
4. **TypeError en URLSearchParams** — `parseInt()` pasado como argumento a `.set()` que requiere `string`
5. **Endpoint disposals sin filtro asset** — El modal no podía filtrar ventas por activo específico
6. **Rangos rápidos faltantes** — Añadidos botones 7d, 30d, YTD, Todo en el date picker del Anexo
7. **Hint en Section B** — Añadido texto "Haz clic en un activo para ver el desglose por lotes FIFO"
8. **Click-away en modal** — Cierre del modal al hacer clic fuera con `stopPropagation`

### Archivos Modificados
- `client/src/pages/Fisco.tsx` — Reescritura completa sección tabs (líneas 516-950)
- `server/routes/fisco.routes.ts` — Filtro asset en endpoint `/api/fisco/disposals`

---

## 2026-02-24 — FEAT: Mejoras integrales Sistema FISCO

### Resumen Ejecutivo
Se han implementado todas las correcciones solicitadas para el módulo FISCO, mejorando la organización, UX y funcionalidad del sistema fiscal.

### Cambios Implementados

#### 1. Subpestaña "ANEXO – EXTRACTO DE TRANSACCIONES"
- **Problema**: Estaba integrada dentro de la pestaña Fisco sin separación clara
- **Solución**: 
  - Crear estructura de tabs con `Tabs` y `TabsContent`
  - Separar en "Resumen Fiscal" y "Anexo: Extracto de Transacciones"
  - Mejorar navegación y organización visual

#### 2. Operaciones Recientes y Filtro de Fechas
- **Orden**: Corregido para mostrar operaciones en orden descendente (DESC)
  - Modificado `ORDER BY executed_at DESC` en `/api/fisco/operations`
- **Filtro de Fechas**: Implementado date-range picker moderno
  - Reemplazado inputs `<input type="date">` por componentes `Calendar` + `Popover`
  - Añadido `date-fns` con locale español para formato `dd/MM/yyyy`
  - Mejor UX con selección visual y controles intuitivos

#### 3. Resumen de Ganancias y Pérdidas (Detalle por Lotes)
- **Funcionalidad**: Modal con detalles completos FIFO por activo
- **Implementación**:
  - Filas clicables en Section B para abrir modal
  - Queries para lotes (`/api/fisco/lots`) y disposals (`/api/fisco/disposals`)
  - Modal con dos tablas: "Lotes de Compra (FIFO)" y "Ventas y Ganancias/Pérdidas"
  - Información completa: fechas, cantidades, costos, método FIFO

#### 4. Activos Considerados en el Cálculo
- **Problema**: Solo consideraba activos operados por el bot
- **Solución**:
  - Obtener balances actuales de Kraken y RevolutX
  - Combinar con activos de operaciones históricas
  - Inicializar todos los activos en Section D para asegurar visibilidad
  - Considerar operaciones manuales, transferencias, staking

#### 5. Histórico Completo de Operaciones
- **Problema**: No aparecían operaciones anteriores a 2025
- **Solución**:
  - Modificado pipeline FISCO para eliminar límites de fecha
  - Kraken: `fetchAll: true` (ya recuperaba todo)
  - RevolutX: Eliminado `startMs` para obtener historial completo
  - Logs actualizados para indicar "FULL HISTORY - NO LIMIT"

#### 6. Sincronización Automática Exchange → Bot
- **Requerimiento**: Sincronización diaria 08:00 con notificaciones Telegram
- **Implementación**:
  - Scheduler con `node-cron` a las 08:00 (Europe/Madrid)
  - Llamada a `/api/fisco/run` para sincronización completa
  - Notificaciones Telegram para éxito y errores
  - Variables de entorno: `FISCO_DAILY_SYNC_CRON` y `FISCO_DAILY_SYNC_TZ`

### Archivos Modificados

#### Frontend
- `client/src/pages/Fisco.tsx`
  - Nueva estructura con tabs
  - Date-range picker moderno
  - Modal para detalles de lotes
  - Handlers para interacciones

#### Backend
- `server/routes/fisco.routes.ts`
  - Orden DESC en operaciones
  - Inclusión de todos los activos del exchange
  - Historial completo sin límites
- `server/routes.ts`
  - Scheduler FISCO diario 08:00
  - Notificaciones Telegram integradas

### Dependencias Añadidas
- `date-fns` - Para manejo de fechas y locale español

### Variables de Entorno
```bash
# FISCO Daily Sync (opcional, valores por defecto incluidos)
FISCO_DAILY_SYNC_CRON=0 8 * * *
FISCO_DAILY_SYNC_TZ=Europe/Madrid
```

### Beneficios Alcanzados
1. **Organización**: Separación clara entre resumen fiscal y extracto detallado
2. **UX**: Date picker moderno e intuitivo
3. **Transparencia**: Detalle completo de cálculos FIFO por activo
4. **Completitud**: Todos los activos del exchange considerados
5. **Historial**: Acceso a operaciones completas sin límite artificial
6. **Automatización**: Sincronización diaria automática con notificaciones

---

## 2026-02-24 — FIX/FEAT: Mejora calidad de entradas (D1 + D2 + MINI-B + Observabilidad)

### Problema
Entradas que nacen en rojo pese a spread filter endurecido. Causa raíz: discrepancia entre precio de referencia (Kraken) y precio de ejecución (RevolutX), timing tardío tras cierre de vela.

### Cambios implementados

**D1 — Coherencia de precio de ejecución**
- `tradingEngine.ts`: Guarda `krakenReferencePrice` antes de que se sobrescriba con el fill real de RevolutX
- Calcula `realEntryCostPct = (executedPrice - krakenRef) / krakenRef * 100` tras cada BUY
- Alimenta automáticamente al `MarkupTracker` para aprendizaje dinámico
- Log `[D1_ENTRY_COST]` con krakenRef, executed, realEntryCostPct

**D2 — Markup dinámico por par (sin llamadas extra a RevolutX)**
- Nuevo servicio `server/services/MarkupTracker.ts`: EMA rolling de `realEntryCostPct` por par
- `spreadFilter.ts`: usa markup dinámico cuando `dynamicMarkupEnabled=true` (default)
- Fallback a markup fijo si <3 samples históricos
- Floor 0.10%, Cap 5.00% para sanidad
- Campo `markupSource` ("dynamic"/"fixed"/"none") + `markupSamples` + `markupEma` en SpreadCheckDetails

**MINI-B — Timing gates (staleness + chase)**
- **Staleness gate**: bloquea si `candleAge > stalenessMaxSec` (default 60s para 5min candles)
- **Chase gate**: bloquea si `currentPrice > candleClose + chaseMaxPct%` (default 0.50%)
- Reason codes: `STALE_CANDLE_BLOCK`, `CHASE_BLOCK`
- Solo aplica en modo velas (candle mode), no en ciclos

**Observabilidad**
- Log `[ENTRY_QUALITY]` en cada BUY permitido: regime, spreadKraken, markupUsed, markupSource, spreadEff, threshold, stalenessAge, chaseDelta, candleClose, currentPrice, signals
- `botLogger` event types: `ENTRY_QUALITY_ALLOWED`, `D1_ENTRY_COST`
- Cada bloqueo incluye reason code + valores numéricos para calibración

**Config / Feature flags** (schema + DB)
- `dynamic_markup_enabled` (boolean, default true)
- `staleness_gate_enabled` (boolean, default true)
- `staleness_max_sec` (integer, default 60)
- `chase_gate_enabled` (boolean, default true)
- `chase_max_pct` (decimal, default 0.50)

### Archivos modificados
- `server/services/MarkupTracker.ts` (NUEVO)
- `server/services/spreadFilter.ts`
- `server/services/tradingEngine.ts`
- `server/services/botLogger.ts`
- `shared/schema.ts`
- `CORRECCIONES_Y_ACTUALIZACIONES.md`

---

## 2026-02-23 — FEAT: FISCO UI Rediseño Completo estilo Bit2Me

### Objetivo
Rediseño total de la interfaz FISCO para replicar la jerarquía visual y estructura de informes de Bit2Me. Vista principal = resumen anual (no listado de operaciones).

### Cambios Backend
- **Nuevo endpoint `/api/fisco/annual-report?year=&exchange=`** — Devuelve las 4 secciones del informe en una sola llamada:
  - **Sección A**: Resumen de ganancias y pérdidas derivadas de transmisiones (gains/losses/total)
  - **Sección B**: Desglose por activo (ticker, exchange, tipo, valor transmisión, valor adquisición, gan/pérd)
  - **Sección C**: Rendimiento de capital mobiliario (staking, masternodes, lending, distribuciones)
  - **Sección D**: Visión general de cartera (saldo 01/01, entradas, salidas, saldo 31/12 por activo)
  - Contadores: operaciones importadas + operaciones con valoración EUR pendiente
  - Última sincronización

### Cambios UI (`client/src/pages/Fisco.tsx`)
- **Barra superior**: Selector de año grande + filtro exchange + botón Sincronizar + botón Generar PDF
- **Contadores visibles**: Operaciones importadas + valoración pendiente + última sincronización
- **Sección A**: Tabla simple ganancias/pérdidas/total (cabecera azul, estilo Bit2Me)
- **Sección B**: Tabla por activo con valor transmisión, valor adquisición, ganancia/pérdida
- **Sección C**: Tabla capital mobiliario (staking/masternodes/lending/distribuciones)
- **Sección D**: Tabla cartera con saldos inicio/fin de año y movimientos
- **Sección E (Anexo)**: Operaciones completas en sección colapsable con filtros (fecha, activo, exchange, tipo)
- **PDF multi-página**: Genera HTML descargable con 4 páginas separadas replicando las tablas Bit2Me

### Diseño Visual
- Cabeceras de tabla azul claro (`bg-blue-500/10`)
- Números alineados a la derecha con font-mono
- Formato EUR con 2 decimales y separador de miles (es-ES)
- Filas totales destacadas en azul
- Sin gráficos complejos — tablas limpias y claras
- Operaciones completas solo en Anexo colapsable

### Archivos modificados
- `server/routes/fisco.routes.ts` — Nuevo endpoint `/api/fisco/annual-report`
- `client/src/pages/Fisco.tsx` — Reescritura completa estilo Bit2Me

---

## 2026-02-20 — FEAT: Módulo FISCO Completo — Control Fiscal FIFO en EUR

### Objetivo
Sistema fiscal completo: extracción de datos de exchanges → normalización → motor FIFO → persistencia DB → UI interactiva. Todo en EUR conforme a legislación española (IRPF).

### Arquitectura

```
Kraken API (ledger)  ──┐
                       ├─→ Normalizer ──→ FIFO Engine ──→ DB (PostgreSQL) ──→ UI React
RevolutX API (orders) ─┘       │                │
                          EUR Rates (ECB)   Gain/Loss calc
```

### Problema resuelto: RevolutX sin campo `side`
- El endpoint `/api/1.0/trades/private/{symbol}` NO incluye `side` (buy/sell).
- **Solución**: Usar `/api/1.0/orders/historical` que SÍ devuelve `side`, `filled_quantity`, `average_fill_price`.
- Limitación: máx 1 semana por consulta → iteración automática semana a semana.

### Fix: Rate limit Kraken + RevolutX fecha inicio
- Kraken: delay entre llamadas paginadas de 2s → 3.5s
- Kraken fetch-all: ejecución secuencial (no paralela) para evitar `EAPI:Rate limit exceeded`
- RevolutX: fecha inicio por defecto de 2020 → 2025 (evita 260+ semanas vacías)
- RevolutX: soporte `?start=` query param para rango personalizado

### Archivos creados/modificados

| Archivo | Cambio |
|---|---|
| `server/services/exchanges/RevolutXService.ts` | `getHistoricalOrders()` — iteración por semanas, cursor, filtro `state=filled` |
| `server/services/kraken.ts` | `getLedgers()` — deposits, withdrawals, staking, trades con paginación. Rate limit 3.5s |
| `server/services/fisco/normalizer.ts` | **NUEVO** — Normaliza Kraken ledger + RevolutX orders → formato unificado `NormalizedOperation` |
| `server/services/fisco/fifo-engine.ts` | **NUEVO** — Motor FIFO: lotes por compra, consume FIFO en ventas, calcula gain/loss EUR |
| `server/services/fisco/eur-rates.ts` | **NUEVO** — Conversión USD→EUR via ECB API con cache 4h + fallback |
| `server/routes/fisco.routes.ts` | Endpoints completos: test, fetch-all, run (pipeline), operations, lots, disposals, summary |
| `server/routes.ts` | Registra `fisco.routes.ts` |
| `db/migrations/015_fisco_tables.sql` | **NUEVO** — Tablas: `fisco_operations`, `fisco_lots`, `fisco_disposals`, `fisco_summary` + índices |
| `shared/schema.ts` | Tablas Drizzle: `fiscoOperations`, `fiscoLots`, `fiscoDisposals`, `fiscoSummary` + tipos |
| `client/src/pages/Fisco.tsx` | **NUEVO** — UI completa con 4 sub-pestañas: Resumen, Operaciones, Lotes FIFO, Ganancias |
| `client/src/App.tsx` | Ruta `/fisco` registrada |
| `client/src/components/dashboard/Nav.tsx` | Link FISCO con icono Calculator en navegación |

### Endpoints API disponibles
- `GET /api/fisco/test-apis` — Prueba rápida de ambas APIs
- `GET /api/fisco/fetch-all?exchange=kraken|revolutx` — Descarga completa de un exchange
- `GET /api/fisco/run` — **Pipeline completo**: fetch → normalize → FIFO → save DB. Acepta `?year=2026` y `?start=2025-01-01`
- `GET /api/fisco/operations` — Operaciones normalizadas desde DB. Filtros: `?year=`, `?asset=`, `?type=`
- `GET /api/fisco/lots` — Lotes FIFO desde DB. Filtros: `?asset=`, `?open=true`
- `GET /api/fisco/disposals` — Disposiciones con gain/loss. Filtro: `?year=`
- `GET /api/fisco/summary` — Resumen anual por activo

### Motor FIFO
- Cada compra crea un lote con coste en EUR (precio + fee)
- Cada venta consume lotes en orden FIFO (más antiguo primero)
- Si se vende más de lo que hay en lotes, se crea disposición con coste base 0 + warning
- Conversiones (USD↔USDC), deposits, withdrawals se registran pero no generan eventos fiscales

### Principio de diseño
> **Exchange-First**: Datos fiscales SIEMPRE de las APIs de los exchanges, nunca de la DB del bot. Garantiza captura de operaciones manuales, deposits, withdrawals y staking.

### Verificación
- `npx tsc --noEmit` → 0 errores
- APIs verificadas en staging: Kraken 253 trades + 535 ledger, RevolutX 80+ orders con side
- Rate limit fix verificado: sin errores EAPI en fetch-all secuencial

---

## 2026-02-21 — REFACTOR: Extracción strategies.ts + alertBuilder.ts de tradingEngine.ts

### Objetivo
Continuar reducción del monolito `tradingEngine.ts` extrayendo bloques cohesivos y testables.

### Extracciones realizadas

| Módulo | Líneas | Funciones extraídas |
|---|---|---|
| `strategies.ts` | 698 | `momentumStrategy`, `meanReversionStrategy`, `scalpingStrategy`, `gridStrategy`, `momentumCandlesStrategy`, `meanReversionSimpleStrategy`, `applyMTFFilter` |
| `alertBuilder.ts` | 247 | `buildTimeStopAlertMessage`, `sendTimeStopAlert`, `checkExpiredTimeStopPositions`, `forceTimeStopAlerts` |

### Patrón de extracción
- **strategies.ts**: Funciones puras (sin side-effects). Reciben datos de mercado, devuelven `TradeSignal`. Indicadores importados de `indicators.ts`.
- **alertBuilder.ts**: Patrón host-interface (`IAlertBuilderHost`). El engine implementa el adaptador para inyectar dependencias (telegram, precios, DB).
- En `tradingEngine.ts`, los métodos originales quedan como thin delegations de 1 línea.

### Resultado
- `tradingEngine.ts`: 6550 → **5767 líneas** (−783, −12%)
- Total módulos extraídos: 8 (exitManager, indicators, regimeDetection, regimeManager, spreadFilter, mtfAnalysis, **strategies**, **alertBuilder**)
- `npm run check` = 0 errores

### Tests añadidos
- `server/services/__tests__/strategies.test.ts` — **33 tests** (7 estrategias + MTF filter)
- `server/services/__tests__/alertBuilder.test.ts` — **30 tests** (message builder, alert dispatch, expired check, force alerts)
- Total tests del proyecto: 5 test suites, 63+ assertions nuevas

### Arquitectura actualizada

```
tradingEngine.ts    5767 líneas  (core trading loop, execution, entry logic)
├── exitManager.ts      1404 líneas  (SL/TP, SmartGuard, TimeStop, alert throttle)
├── strategies.ts        698 líneas  (momentum, meanReversion, scalping, grid, candles, MTF filter)
├── indicators.ts        296 líneas  (EMA, RSI, MACD, Bollinger, ATR, ADX)
├── regimeDetection.ts   273 líneas  (detectMarketRegime, params)
├── regimeManager.ts     319 líneas  (cache, confirmación, DB)
├── spreadFilter.ts      208 líneas  (spread gating, alertas)
├── mtfAnalysis.ts       198 líneas  (MTF fetch/cache, trend)
└── alertBuilder.ts      247 líneas  (Time-Stop alerts, host interface)
```

---

## 2026-02-20 — AUDIT: Verificación integral del proyecto (commit `0c38751`)

### Hallazgos del audit vs estado real

| Hallazgo del audit | Estado real | Veredicto |
|---|---|---|
| `routes.ts` tiene 4000+ líneas | **822 líneas** + 10 route modules en `server/routes/` | ✅ YA MODULARIZADO |
| `tradingEngine.ts` monolito 8000+ líneas | **6550 líneas** (-26%) + 6 módulos extraídos | ✅ PARCIALMENTE RESUELTO |
| `openPositions` Map se pierde en restart | `loadOpenPositionsFromDB()` + `recoverPendingFillPositionsFromDB()` en `start()` | ✅ YA TIENE RECOVERY |
| `sgAlertThrottle` volátil | `exitManager.ts` líneas 177-183: carga desde DB + persiste cada update | ✅ YA TIENE PERSISTENCIA DB |
| Sin capa de servicio | RouterDeps pattern + route modules por dominio | ✅ ADECUADO |
| Tests insuficientes | 3 test files + telegram templates test | ⚠️ MEJORABLE (no crítico) |
| Sin recovery automático de estado | Fail-closed safety check en `manualBuyForTest()` + DB persistence | ✅ IMPLEMENTADO |

### Arquitectura actual (post-refactor)

```
tradingEngine.ts    6550 líneas  (core trading loop, strategies, execution)
├── exitManager.ts      1404 líneas  (SL/TP, SmartGuard, TimeStop, alert throttle)
├── indicators.ts        296 líneas  (EMA, RSI, MACD, Bollinger, ATR, ADX)
├── regimeDetection.ts   273 líneas  (detectMarketRegime, params)
├── regimeManager.ts     319 líneas  (cache, confirmación, DB)
├── spreadFilter.ts      208 líneas  (spread gating, alertas)
└── mtfAnalysis.ts       198 líneas  (MTF fetch/cache, trend)

routes.ts            822 líneas  (startup, health, config endpoints)
├── trades.routes.ts         (CRUD trades, sync, FIFO, performance)
├── positions.routes.ts      (open-positions, buy, close, orphan)
├── admin.routes.ts          (purge, rebuild, backfill, indexes)
├── market.routes.ts         (balance, prices, trade, reconcile)
├── events.routes.ts         (events & logs)
├── ai.routes.ts             (AI, environment, DB diagnostics)
├── test.routes.ts           (test & debug)
├── telegram.routes.ts       (Telegram endpoints)
├── backups.routes.ts        (backup management)
└── config.ts                (configuration)
```

### Encoding fix pase 2 (commit `0c38751`)
- Patrones adicionales corregidos: `≈` `→` `≥` `ℹ` `⏳` `É` `Ú` `Á`
- Scanner exhaustivo: **0 mojibake residual** confirmado
- `npm run check` = 0 errores

---

## 2026-02-20 — FIX: Reparación encoding UTF-8 en alertas Telegram (commit `bacb179`)

### Problema
- `tradingEngine.ts` contenía **217 instancias de mojibake** (double-encoding Win-1252→UTF-8)
- Emojis se mostraban como `ðŸ¤–` en vez de 🤖, acentos como `Ã³` en vez de ó
- Afectaba TODAS las alertas Telegram: Time-Stop, Bot Started/Stopped, Trades, Errors, etc.

### Causa raíz
- El archivo fue guardado en algún momento con encoding Windows-1252 interpretando bytes UTF-8
- Cada byte UTF-8 fue mapeado a su equivalente Win-1252 y re-codificado como UTF-8

### Solución
- Script PowerShell (`fix-encoding.ps1`) con 3 fases:
  1. **Phase 0**: Reparar literales `u{XXXX}` de un intento previo (PS 5.1 no soporta backtick-u)
  2. **Phase 1**: Reemplazar emojis 4-byte restantes (💡🔄🟢🔴💵)
  3. **Phase 2+3**: Símbolos 3-byte (━•⏰⚠⚡⚙⏸) y acentos (óéáúíñÓÍÑü)
- **22+ tipos de patrones** corregidos, **426 líneas** afectadas
- `npm run check` = 0 errores post-fix

---

## 2026-02-19 — REFACTOR: Modularización de tradingEngine.ts (Fase 2)

### Cambios realizados

#### 1. Tests de executeTrade (commit `35c6c50`)
- Creado `server/services/__tests__/executeTrade.test.ts`
- **39 test cases, 73 assertions** — 100% pass
- Cobertura: pair validation, sellContext gating, order ID resolution, order execution resolution, P&L calculation (con fees reales/estimadas, breakeven, micro-cap), DCA average price, minimum validation, position sell P&L (full/parcial), edge cases
- Patrón: funciones puras extraídas de `executeTrade`, test runner custom (`npx tsx`)

#### 2. Persistencia de sgAlertThrottle en DB (commit `cee829a`)
- Nueva tabla `alert_throttle` en `shared/schema.ts` (key UNIQUE, last_alert_at)
- Métodos en `server/storage.ts`: `getAlertThrottle`, `upsertAlertThrottle`, `deleteAlertThrottleByPrefix`, `loadAlertThrottles`
- `ExitManager` carga throttle desde DB al arrancar, persiste escrituras (fire-and-forget)
- Prefijos: `sg:` para SmartGuard alerts, `ts:` para TimeStop notifications
- Auto-migración: `CREATE TABLE IF NOT EXISTS` en `runSchemaMigration()`
- **Impacto**: Throttle sobrevive reinicios del bot (no más alertas SG duplicadas)

#### 3. Extracción de indicadores técnicos (commit `7133f56`)
- Creado `server/services/indicators.ts` — funciones puras exportadas
- Funciones: `calculateEMA`, `calculateRSI`, `calculateVolatility`, `calculateMACD`, `calculateBollingerBands`, `calculateATR`, `calculateATRPercent`, `detectAbnormalVolume`, `wilderSmooth`, `calculateADX`
- Tipos: `PriceData`, `OHLCCandle`
- `tradingEngine.ts` delega via thin wrappers — **-259 líneas**

#### 4. Extracción de detección de régimen (commit `0a85a5e`)
- Creado `server/services/regimeDetection.ts` — funciones puras exportadas
- Funciones: `detectMarketRegime`, `getRegimeAdjustedParams`, `calculateAtrBasedExits`, `shouldPauseEntriesDueToRegime`
- Tipos: `MarketRegime`, `RegimeAnalysis`, `RegimePreset`, `AtrExitResult`
- Constantes: `REGIME_PRESETS`, `REGIME_CONFIG`
- `tradingEngine.ts` delega via thin wrappers — **-223 líneas**

#### 5. Extracción de RegimeManager stateful (commit `e972ac0`)
- Creado `server/services/regimeManager.ts` — clase `RegimeManager` con interfaz `IRegimeManagerHost`
- Métodos movidos: `getMarketRegimeWithCache`, `applyRegimeConfirmation`, `sendRegimeChangeAlert`, `getRegimeMinSignals`, `computeHash`, `computeParamsHash`, `computeReasonHash`, `getRegimeState`, `upsertRegimeState`
- Estado migrado: `regimeCache`, `lastRegime`, `dynamicConfig` (sincronizado via `setDynamicConfig()`)
- Dead code eliminado: `regimeAlertThrottle`, `emaMisalignCount`, `REGIME_ALERT_THROTTLE_MS`
- Tipos duplicados eliminados: `PriceData`, `OHLCCandle`, `MarketRegime`, `RegimeAnalysis`, `RegimePreset`, `REGIME_PRESETS`, `REGIME_CONFIG` (ahora importados de `indicators.ts` y `regimeDetection.ts`)
- Imports muertos eliminados: `createHash`, `regimeState`, `RegimeState`, `db`, `eq`, `sql`
- **-268 líneas** (+ ~120 líneas de tipos/imports limpiados)

#### 6. Extracción de SpreadFilter
- Creado `server/services/spreadFilter.ts` — clase `SpreadFilter` con interfaz `ISpreadFilterHost`
- Funciones puras exportadas: `calculateSpreadPct`, `getSpreadThresholdForRegime`
- Métodos movidos: `checkSpreadForBuy`, `sendSpreadTelegramAlert`
- Estado migrado: `spreadAlertCooldowns` (anti-spam cooldown por par+exchange)
- Tipo exportado: `SpreadCheckResult`, `SpreadCheckDetails`
- **-158 líneas**

#### 7. Extracción de MtfAnalyzer
- Creado `server/services/mtfAnalysis.ts` — clase `MtfAnalyzer` con interfaz `IMtfAnalysisHost`
- Funciones puras exportadas: `analyzeTimeframeTrend`, `analyzeMultiTimeframe`, `emitMTFDiagnostic`
- Tipos exportados: `MultiTimeframeData`, `TrendAnalysis`
- Estado migrado: `mtfCache` (cache 5min por par)
- Constantes movidas: `MTF_DIAG_ENABLED`, `MTF_CACHE_TTL`
- Eliminados de tradingEngine.ts: interfaces locales `MultiTimeframeData`, `TrendAnalysis`
- **-149 líneas**

### Reducción total de tradingEngine.ts
- **Antes**: 8865 líneas (original monolítico)
- **Post ExitManager**: 7661 líneas (-1204)
- **Post indicators.ts**: 7430 líneas (-231)
- **Post regimeDetection.ts**: 7207 líneas (-223)
- **Post regimeManager.ts + cleanup**: 6856 líneas (-351)
- **Post spreadFilter.ts**: 6699 líneas (-157)
- **Post mtfAnalysis.ts**: 6549 líneas (-150)
- **Reducción total**: **-2316 líneas (-26.1%)**

### Archivos creados/modificados
- `server/services/__tests__/executeTrade.test.ts` (nuevo)
- `server/services/indicators.ts` (nuevo)
- `server/services/regimeDetection.ts` (nuevo)
- `server/services/regimeManager.ts` (nuevo)
- `server/services/spreadFilter.ts` (nuevo)
- `server/services/mtfAnalysis.ts` (nuevo)
- `server/services/exitManager.ts` (modificado — persistencia throttle)
- `server/services/tradingEngine.ts` (modificado — delegaciones + cleanup)
- `server/storage.ts` (modificado — métodos alert_throttle)
- `shared/schema.ts` (modificado — tabla alert_throttle)

---

## 2026-02-XX — REFACTOR: Extracción de ExitManager desde tradingEngine.ts

### Motivación
- `tradingEngine.ts` era un archivo monolítico de **8865 líneas** con toda la lógica del bot
- La lógica de salida (SL/TP, SmartGuard, Time-Stop, Fee-Gating) estaba fuertemente acoplada
- Difícil de testear, mantener y razonar sobre el flujo de salidas

### Cambios realizados
- **tradingEngine.ts reducido de 8865 → 7660 líneas** (-1205 líneas, ~14%)
- Creado `server/services/exitManager.ts` (1374 líneas) con:
  - Interfaz `IExitManagerHost` para inyección de dependencias (patrón delegación)
  - Clase `ExitManager` con toda la lógica de salida
  - Tipos exportados: `OpenPosition`, `ConfigSnapshot`, `ExitReason`, `FeeGatingResult`

| Método extraído | Descripción | Líneas aprox. |
|----------------|-------------|---------------|
| `checkStopLossTakeProfit` | Dispatcher principal SL/TP | ~50 |
| `checkSinglePositionSLTP` | Legacy SL/TP + reconciliación | ~365 |
| `checkSmartGuardExit` | SmartGuard: BE, Trailing, Scale-out, TP fijo | ~475 |
| `sendSgEventAlert` | Alertas Telegram para eventos SmartGuard | ~115 |
| `shouldSendSgAlert` | Throttle de alertas SG | ~12 |
| `isRiskExit` | Clasificación de exit tipo risk | ~4 |
| `getAdaptiveExitConfig` | Config dinámica de exit desde DB | ~20 |
| `calculateMinCloseNetPct` | Cálculo mínimo neto para cierre | ~4 |
| `checkFeeGating` | Validación fee-gating | ~35 |
| `checkTimeStop` | Time-Stop soft/hard | ~130 |
| `calculateProgressiveBEStop` | Break-even progresivo (3 niveles) | ~40 |

### Patrón de arquitectura
- **Delegación via interfaz**: `TradingEngine` crea un adapter `IExitManagerHost` en `createExitHost()`
- Los métodos privados de `TradingEngine` se exponen al `ExitManager` sin cambiar su visibilidad
- Métodos que aún se usan internamente (`getAdaptiveExitConfig`, `calculateMinCloseNetPct`, etc.) tienen delegaciones thin al `ExitManager`
- Estado movido: `sgAlertThrottle`, `timeStopNotified` ahora pertenecen a `ExitManager`

### Verificación
- `npm run check` (tsc) pasa con **0 errores** después de la extracción
- Toda la funcionalidad de salida mantiene exactamente el mismo comportamiento
- La llamada `this.exitManager.checkStopLossTakeProfit(...)` reemplaza `this.checkStopLossTakeProfit(...)`

### Archivos modificados
- `server/services/tradingEngine.ts` (reducido ~14%)
- `server/services/exitManager.ts` (nuevo — 1374 líneas)

---

## 2026-02-XX — REFACTOR: Modularización completa de routes.ts

### Motivación
- `routes.ts` era un archivo monolítico de **5117 líneas** con todos los endpoints API mezclados
- Difícil de mantener, navegar y debuggear
- Alto riesgo de conflictos en merges

### Cambios realizados
- **routes.ts reducido de 5117 → 821 líneas** (solo orquestador + config/startup)
- Creada interfaz `RouterDeps` en `server/routes/types.ts` para inyección de dependencias
- Extraídos **10 módulos de rutas** por dominio:

| Módulo | Endpoints | Líneas aprox. |
|--------|-----------|---------------|
| `backups.routes.ts` | backup CRUD, restore, download | ~140 |
| `events.routes.ts` | events, server-logs | ~170 |
| `ai.routes.ts` | AI analysis, environment, DB diagnostic | ~300 |
| `test.routes.ts` | test/debug, critical-alert test | ~650 |
| `telegram.routes.ts` | Telegram chat CRUD, send message | ~120 |
| `admin.routes.ts` | purge-*, rebuild-*, legacy-*, backfill, indexes | ~350 |
| `trades.routes.ts` | trades listing, closed, performance, P&L, sync kraken, FIFO, cleanup | ~600 |
| `positions.routes.ts` | open-positions, buy, close, orphan, time-stop | ~480 |
| `market.routes.ts` | market, balance, prices, trade kraken/revolutx, sync-revolutx, reconcile | ~1100 |

### Verificación
- `npm run check` (tsc) pasa con **0 errores** después de cada extracción
- Todos los endpoints mantienen exactamente la misma funcionalidad
- Imports limpiados: solo quedan los necesarios en el orquestador

### Archivos modificados
- `server/routes.ts` (reducido ~84%)
- `server/routes/types.ts` (nuevo)
- `server/routes/backups.routes.ts` (nuevo)
- `server/routes/events.routes.ts` (nuevo)
- `server/routes/ai.routes.ts` (nuevo)
- `server/routes/test.routes.ts` (nuevo)
- `server/routes/telegram.routes.ts` (nuevo)
- `server/routes/admin.routes.ts` (nuevo)
- `server/routes/trades.routes.ts` (nuevo)
- `server/routes/positions.routes.ts` (nuevo)
- `server/routes/market.routes.ts` (nuevo)

---

## 2026-02-19 — AUDITORÍA + FIX: Pipeline de Salidas (BE/Trailing/Exits) + Alertas Telegram

### Problema reportado
- Una venta se tuvo que hacer **manualmente** porque el bot NO ejecutó BE ni trailing.
- No llegaban alertas Telegram de seguimiento (BE armado, trailing actualizado, salida ejecutada).
- Cuando `executeTrade` fallaba (orden rechazada por el exchange), la posición quedaba abierta **sin ningún log ni alerta**.

### Diagnóstico (hipótesis confirmadas)

#### H3 — CONFIRMADA: EXIT_ORDER_FAILED silencioso
En `checkSmartGuardExit` y `checkSinglePositionSLTP`, cuando `executeTrade()` devuelve `false`:
```ts
const success = await this.executeTrade(...);
if (success && ...) { /* Telegram */ }
if (success) { /* cerrar posición */ }
// ← NO había else: fallo silencioso, posición quedaba abierta sin log ni alerta
```

#### Bug adicional: estado BE/trailing no persistido antes de venta
El `savePositionToDB` solo ocurría si `!shouldSellFull && !shouldScaleOut`. Si en el mismo tick se activaba BE y el stop ya estaba cruzado, el estado `sgBreakEvenActivated=true` y `sgCurrentStopPrice` **no se guardaban en DB** antes de intentar la venta. Si la venta fallaba, el estado se perdía en el siguiente restart.

#### Bug adicional: EXIT_MIN_VOLUME_BLOCKED silencioso
Cuando `sellAmount < minVolume`, el bot retornaba silenciosamente sin log ni alerta. La posición quedaba abierta indefinidamente.

### Solución implementada

#### 1. `server/services/botLogger.ts` — Nuevos EventTypes
Añadidos: `EXIT_EVAL`, `EXIT_TRIGGERED`, `EXIT_ORDER_PLACED`, `EXIT_ORDER_FAILED`, `EXIT_MIN_VOLUME_BLOCKED`, `BREAKEVEN_ARMED`, `TRAILING_UPDATED`, `POSITION_CLOSED_SG`, `TRADE_PERSIST_FAIL`

#### 2. `server/services/tradingEngine.ts` — `checkSmartGuardExit`
- **EXIT_EVAL**: log al inicio de cada evaluación (posId, pair, price, beArmed, trailingArmed, stopPrice, thresholds)
- **BREAKEVEN_ARMED**: botLogger.info cuando BE se activa (además del log existente)
- **TRAILING_UPDATED**: botLogger.info cuando trailing step sube
- **Fix crítico**: `savePositionToDB` ahora se llama cuando `positionModified=true` **siempre** (antes solo si `!shouldSellFull && !shouldScaleOut`) → estado BE/trailing persiste aunque la venta falle
- **EXIT_TRIGGERED**: log antes de intentar la orden
- **EXIT_ORDER_PLACED**: log de intento de orden
- **EXIT_ORDER_FAILED**: botLogger.error + alerta Telegram 🚨 cuando `executeTrade` devuelve `false`
- **EXIT_MIN_VOLUME_BLOCKED**: botLogger.warn + alerta Telegram ⚠️ cuando `sellAmount < minVolume`
- **POSITION_CLOSED_SG**: botLogger.info cuando posición se cierra exitosamente

#### 3. `server/services/tradingEngine.ts` — `checkSinglePositionSLTP` (modo legacy)
Mismo patrón: `EXIT_TRIGGERED`, `EXIT_ORDER_PLACED`, `EXIT_ORDER_FAILED` (con Telegram), `EXIT_MIN_VOLUME_BLOCKED` (con Telegram), `POSITION_CLOSED_SG`

#### 4. `server/services/__tests__/exitPipeline.test.ts` — Tests mínimos
11 tests, 31 asserts — todos PASS:
- T1-T3: Break-even (activación, no-activación, stop hit)
- T4-T6: Trailing (activación, update ratchet, stop hit)
- T7: Ultimate SL emergencia
- T8-T9: Idempotencia (BE y trailing no se re-activan)
- T10: Sin precio válido (guard en caller)
- T11: Fixed TP

### Nota técnica: por qué no se ejecutaba BE/trailing
El motor SÍ ejecuta `checkSmartGuardExit` en cada tick (cada `intervalMs` según estrategia). La lógica de BE/trailing era correcta. El problema era:
1. Si `executeTrade` fallaba (ej: balance insuficiente, error de API, minOrderUsd), el fallo era silencioso → nadie sabía que la posición debía cerrarse.
2. El estado BE/trailing no se persistía si la venta se intentaba en el mismo tick que se activó → tras restart, el bot no sabía que BE estaba armado.

### Cómo validar en STG
```bash
# 1. Deploy normal
cd /opt/krakenbot-staging && git pull origin main
docker compose -f docker-compose.staging.yml up -d --build

# 2. Verificar logs de EXIT_EVAL periódicos (cada tick, por posición abierta)
curl "http://5.250.184.18:3020/api/logs?type=EXIT_EVAL&limit=10"

# 3. Cuando precio sube >= beAtPct: verificar BREAKEVEN_ARMED
curl "http://5.250.184.18:3020/api/logs?type=BREAKEVEN_ARMED&limit=5"

# 4. Cuando precio sube >= trailStartPct: verificar SG_TRAILING_ACTIVATED
curl "http://5.250.184.18:3020/api/logs?type=SG_TRAILING_ACTIVATED&limit=5"

# 5. Cuando trailing sube: verificar TRAILING_UPDATED
curl "http://5.250.184.18:3020/api/logs?type=TRAILING_UPDATED&limit=10"

# 6. Cuando stop se cruza: verificar EXIT_TRIGGERED → EXIT_ORDER_PLACED → POSITION_CLOSED_SG
curl "http://5.250.184.18:3020/api/logs?type=EXIT_TRIGGERED&limit=5"
curl "http://5.250.184.18:3020/api/logs?type=POSITION_CLOSED_SG&limit=5"

# 7. Si algo falla: EXIT_ORDER_FAILED aparece en logs Y llega alerta Telegram 🚨
curl "http://5.250.184.18:3020/api/logs?type=EXIT_ORDER_FAILED&limit=5"
```

### Archivos modificados
- `server/services/botLogger.ts` — 9 nuevos EventTypes
- `server/services/tradingEngine.ts` — checkSmartGuardExit + checkSinglePositionSLTP
- `server/services/__tests__/exitPipeline.test.ts` — 11 tests nuevos

---

## 2026-02-09 — FEATURE: Portfolio Summary unificado + P&L profesional (3 métricas)

### Problema
1. **Dashboard "Rendimiento del Portafolio"** mostraba un P&L total calculado con FIFO interno que no coincidía con la suma de `realizedPnlUsd` de los trades individuales.
2. **Terminal header badge** mostraba el mismo valor (unrealized P&L de posiciones abiertas) en ambas pestañas (Posiciones e Historial).
3. El P&L Realizado del Historial era solo de la página visible (paginado), no el total global.
4. FIFO del performance mezclaba buys de Kraken y RevolutX en la misma cola.

### Solución implementada: Opción A + E (3 métricas + endpoint unificado)

#### Nuevo endpoint: `/api/portfolio-summary`
- **Single source of truth** para métricas de P&L del portafolio.
- Devuelve:
  - `realizedPnlUsd` — suma de `realizedPnlUsd` de TODOS los SELLs filled
  - `unrealizedPnlUsd` — suma de (precio actual - entry price) × amount para posiciones abiertas
  - `totalPnlUsd` — realizado + no realizado
  - `todayRealizedPnl` — P&L realizado de hoy
  - `winRatePct`, `wins`, `losses`, `totalSells`, `openPositions`
- Auto-refresh cada 30 segundos en frontend.

#### Dashboard: 3 métricas separadas
- **P&L Realizado** (verde/rojo) — ganancias/pérdidas de trades cerrados
- **P&L No Realizado** (cyan/naranja) — ganancias/pérdidas latentes de posiciones abiertas
- **P&L Total** (verde/rojo con borde primario) — suma de ambos
- Métricas secundarias: Win Rate, Trades (W/L), Max Drawdown, P&L Hoy

#### Terminal: header badge context-aware
- **Tab Posiciones** → "P&L Abierto: +$X.XX" (unrealized global de portfolio-summary)
- **Tab Historial** → "P&L Realizado: -$X.XX" (realized global de portfolio-summary, NO paginado)

#### Fix `/api/performance`
- Acepta `realizedPnlUsd = 0` (antes saltaba al FIFO para trades con P&L exactamente 0)
- FIFO por `pair::exchange` (antes mezclaba Kraken y RevolutX)

### Archivos modificados
- `server/routes.ts` — nuevo endpoint `/api/portfolio-summary`, fix `/api/performance`
- `client/src/components/dashboard/ChartWidget.tsx` — 3 métricas + portfolio-summary query
- `client/src/pages/Terminal.tsx` — portfolio-summary query + header badge context-aware

---

## 2026-02-06 — FEATURE: Filtro de Spread funcional (v2) — Kraken proxy + RevolutX markup

### Problema
El filtro de spread existía en código pero **NUNCA funcionó** (dead code):
- `isSpreadAcceptable()` leía `tickerData.b[0]` / `tickerData.a[0]` (formato Kraken raw)
- Pero se llamaba con `getTicker()` que devuelve `{ bid: number, ask: number }` (tipo `Ticker`)
- Resultado: `bid = 0, ask = 0` → `spreadPct = 0` → **siempre acceptable**
- El umbral era hardcoded: `const MAX_SPREAD_PCT = 0.5`
- `maxSpreadPct` del schema de config nunca se leía
- RevolutX no tiene orderbook fiable → `bid=ask=last` → spread siempre 0

### Solución implementada: Opción B (Kraken proxy + markup RevolutX)

#### Arquitectura
- **Fuente de datos**: siempre `getDataExchange().getTicker()` (Kraken) — única fuente fiable de bid/ask
- **Para Kraken**: `spreadEffective = spreadKraken`
- **Para RevolutX**: `spreadEffective = spreadKraken + revolutxMarkupPct` (configurable, default 0.8%)
- **Un solo punto de decisión**: `checkSpreadForBuy()` llamado desde ambos flujos (cycle + candles)
- **Solo BUY**: nunca bloquea SELL, SL, TP ni forceClose

#### Cálculo
```
mid = (bid + ask) / 2
spreadKrakenPct = ((ask - bid) / mid) * 100
spreadEffectivePct = spreadKrakenPct + (tradingExchange === "revolutx" ? revolutxMarkupPct : 0)
```

#### Umbrales dinámicos por régimen (configurable desde UI)
| Régimen | Default | Descripción |
|---------|---------|-------------|
| TREND | 1.50% | Alto volumen → exigir mejor fill |
| RANGE | 2.00% | Menos volumen → algo más permisivo |
| TRANSITION | 2.50% | Intermedio |
| Cap | 3.50% | Hard limit absoluto (nunca permitir más) |
| Floor | 0.30% | Si spread < floor, siempre OK (micro-ruido) |

Si `dynamicSpread.enabled = false`, usa un umbral fijo `spreadMaxPct`.

#### Fail-safe
Si `bid <= 0` o `ask <= 0`: log `SPREAD_DATA_MISSING` + **no operar** (skip BUY).

#### Alerta Telegram
- Cuando se bloquea una BUY por spread, envía mensaje con:
  - Par, exchange, régimen
  - Spread Kraken, markup RevolutX (si aplica), spread efectivo, umbral
  - Bid/ask
- **Anti-spam**: cooldown configurable por (par + exchange), default 10 min
- **Best-effort**: si Telegram falla, no rompe el motor de trading

#### Log estructurado (SPREAD_REJECTED)
```json
{
  "event": "SPREAD_REJECTED",
  "pair": "BTC/USD",
  "regime": "TREND",
  "tradingExchange": "revolutx",
  "dataExchange": "kraken",
  "bid": 50000.00,
  "ask": 50100.00,
  "mid": 50050.00,
  "spreadKrakenPct": 0.1998,
  "revolutxMarkupPct": 0.80,
  "spreadEffectivePct": 0.9998,
  "thresholdPct": 1.50,
  "decision": "REJECT"
}
```

#### Ejemplo de mensaje Telegram
```
🤖 KRAKEN BOT 🇪🇸
━━━━━━━━━━━━━━━━━━━
🚫 BUY bloqueada por spread

📊 Detalle:
   Par: BTC/USD
   Exchange: revolutx
   Régimen: TREND
   Spread Kraken: 0.200%
   Markup RevolutX: +0.80%
   Spread Efectivo: 1.000%
   Umbral máximo: 1.50%
   Bid: $50000.00 | Ask: $50100.00
⏰ 2026-02-06 21:30:00 UTC
━━━━━━━━━━━━━━━━━━━
```

### Parámetros configurables (UI: Settings → Filtro de Spread)
| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `spreadFilterEnabled` | true | Activar/desactivar filtro |
| `spreadDynamicEnabled` | true | Umbrales por régimen vs fijo |
| `spreadMaxPct` | 2.00 | Umbral fijo (cuando dynamic=false) |
| `spreadThresholdTrend` | 1.50 | Umbral para régimen TREND |
| `spreadThresholdRange` | 2.00 | Umbral para régimen RANGE |
| `spreadThresholdTransition` | 2.50 | Umbral para régimen TRANSITION |
| `spreadCapPct` | 3.50 | Hard cap absoluto |
| `spreadFloorPct` | 0.30 | Spread < floor → siempre OK |
| `spreadRevolutxMarkupPct` | 0.80 | Estimación adicional para RevolutX |
| `spreadTelegramAlertEnabled` | true | Enviar alerta Telegram al bloquear |
| `spreadTelegramCooldownMs` | 600000 | Cooldown anti-spam (10 min default) |

### Archivos modificados
- `shared/schema.ts` — 11 nuevas columnas en `bot_config` para spread filter
- `shared/config-schema.ts` — `maxSpreadPct` ya existía en `exchangeConfigSchema`
- `server/services/tradingEngine.ts` — Eliminado `MAX_SPREAD_PCT` hardcode, eliminado `isSpreadAcceptable()` roto, nuevo `checkSpreadForBuy()` + `getSpreadThresholdForRegime()` + `sendSpreadTelegramAlert()`
- `server/services/botLogger.ts` — Nuevos eventos: `SPREAD_REJECTED`, `SPREAD_DATA_MISSING`
- `server/services/telegram.ts` — Nuevo subtipo: `trade_spread_rejected`
- `client/src/pages/Settings.tsx` — Card completa "Filtro de Spread" con todos los campos editables
- `db/migrations/013_spread_filter_config.sql` — Migración para nuevas columnas
- `server/services/__tests__/spreadFilter.test.ts` — 30 tests unitarios (cálculo, régimen, floor/cap, markup, missing data)

### Tests
```
npx tsx server/services/__tests__/spreadFilter.test.ts
→ 30 passed, 0 failed ✅
```

---

## 2026-02-06 — FIX: P&L a 0 en gráfica de rendimiento y historial de operaciones

### Problema
El P&L (Profit & Loss) aparecía como **0** o **null** en:
1. **Gráfica "Rendimiento del Portafolio"** (Dashboard → ChartWidget)
2. **Historial de Operaciones** (Terminal → tabla de trades cerrados)

### Causas Raíz Identificadas

#### Causa 1: `/api/performance` incluía trades no-filled con price=0
- `storage.getTrades()` devolvía trades `pending` con `price=0`
- Un BUY pending con `price=0` sobreescribía el precio real del último BUY
- Al llegar un SELL, `lastBuyPrice > 0` era `false` → **P&L no se calculaba**
- Además, solo guardaba UN buy por par (sin FIFO), perdiendo trades parciales

#### Causa 2: `/api/trades/closed` incluía trades no-filled
- El filtro `baseValidity` permitía trades `pending`/`cancelled` en el resultado
- Trades sin `realizedPnlUsd` mostraban `-` en la UI

#### Causa 3: Muchos SELL no tenían P&L calculado en la DB
- FillWatcher inserta trades sin P&L y luego intenta reconciliar con `tryRecalculatePnlForPairExchange`
- Si el reconcile fallaba (exchange/pair mismatch, trades no-filled mezclados), el P&L quedaba `null`
- No existía mecanismo de backfill/reparación masiva

### Cambios Implementados

#### `server/storage.ts`
- **`getFilledTradesForPerformance(limit)`**: Nuevo método que devuelve solo trades `filled` con `price > 0` y `amount > 0`, ordenados por `executedAt`
- **`rebuildPnlForAllSells()`**: Nuevo método de backfill masivo FIFO por par+exchange. Recalcula P&L neto (incluyendo fees) para todos los SELL que tengan `realizedPnlUsd = NULL`. Respeta el orden FIFO y consume cantidades de BUYs previos
- **`getClosedTrades()`**: Filtro cambiado de `baseValidity` (que incluía non-filled) a `status='filled' AND price>0 AND amount>0` explícito
- Ambos métodos añadidos al interface `IStorage` y a `DatabaseStorage`

#### `server/routes.ts`
- **`GET /api/performance`**: Reescrito completamente:
  - Usa `getFilledTradesForPerformance()` en vez de `getTrades()` (solo trades válidos)
  - FIFO con cola de BUYs por par (soporta múltiples buys parciales)
  - **Prioriza `realizedPnlUsd` del DB** cuando existe (más preciso, incluye fees reales)
  - Fallback a cálculo FIFO solo para sells sin P&L en DB
  - Consume FIFO incluso cuando usa P&L del DB para mantener sincronía
- **`POST /api/trades/rebuild-pnl`**: Nuevo endpoint para recalcular P&L masivamente
- **Auto-rebuild al startup**: 10s después de arrancar, ejecuta `rebuildPnlForAllSells()` en background

#### `client/src/pages/Terminal.tsx`
- **Botón "Recalcular P&L"** en el header del Historial de Operaciones
- Mutation `rebuildPnlMutation` que llama a `POST /api/trades/rebuild-pnl`
- Invalida queries de `closedTrades` y `performance` tras éxito
- Indicador de loading (spinner) durante la operación

### Archivos Modificados (v1)
- `server/storage.ts` — 2 nuevos métodos + interface + fix filtro getClosedTrades
- `server/routes.ts` — rewrite /api/performance + nuevo endpoint rebuild-pnl + auto-rebuild startup
- `client/src/pages/Terminal.tsx` — botón Recalcular P&L + mutation

### Fix v2 — Correcciones adicionales P&L

#### Problema residual: BUY trades mostraban "$0.0%" en P&L
- Algunos BUY tenían `realizedPnlUsd = "0.00000000"` en la DB (string truthy)
- El API y frontend los interpretaban como P&L = 0 y mostraban "+$0.00 (+0.0%)"
- **Fix**: Solo devolver/mostrar `realizedPnlUsd` cuando `trade.type === 'sell'`

#### Auto-rebuild P&L después de cada sync
- **Kraken sync** (`POST /api/trades/sync`): Ya calculaba P&L inline, ahora también ejecuta `rebuildPnlForAllSells()` para cubrir sells sin match
- **RevolutX sync** (`POST /api/trades/sync-revolutx`): NO calculaba P&L → ahora ejecuta `rebuildPnlForAllSells()` automáticamente
- Respuesta de ambos endpoints incluye `pnlRebuilt` con el número de trades actualizados

#### Flujo automático de P&L (sin intervención manual)
1. **Al cerrar posición** → `tradingEngine.forceClosePosition()` guarda P&L directamente
2. **FillWatcher** → Detecta fill de sell → `tryRecalculatePnlForPairExchange()`
3. **Sync Kraken/RevolutX** → Después de importar trades → `rebuildPnlForAllSells()`
4. **Startup del servidor** → 10s después de arrancar → `rebuildPnlForAllSells()`
5. **Manual** → Botón "Recalcular P&L" en Terminal (último recurso)

#### Archivos Modificados (v2)
- `server/routes.ts` — `/api/trades/closed`: solo P&L para SELL; sync-kraken y sync-revolutx: auto-rebuild
- `client/src/pages/Terminal.tsx` — Solo mostrar P&L para SELL trades

---

## 2026-02-01 — FEAT: Hybrid Guard (Re-entry) para señales BUY filtradas (ANTI_CRESTA / MTF_STRICT)

### Objetivo
Cuando una señal BUY es filtrada por:
- `ANTI_CRESTA` (anti-fomo / compra tardía sobre EMA20 con volumen alto)
- `MTF_STRICT` (filtro multi-timeframe estricto)

…se crea un “watch” temporal. Si en ciclos posteriores el mercado mejora (pullback a EMA20 o mejora MTF), el bot puede re-intentar la entrada sin perder el contexto.

### Cambios implementados

#### Base de datos (migraciones)
- `db/migrations/006_hybrid_reentry_watches.sql`
  - Crea tabla `hybrid_reentry_watches` + índices para lookup de watches activos y cleanup.
- `db/migrations/012_order_intents_hybrid_guard.sql`
  - Añade columnas a `order_intents`:
    - `hybrid_guard_watch_id` (INT)
    - `hybrid_guard_reason` (TEXT)

#### Startup / Migración automática
- `script/migrate.ts`
  - Asegura que se aplican:
    - `007_order_intents.sql`
    - `012_order_intents_hybrid_guard.sql`
  - Mantiene `006_hybrid_reentry_watches.sql` en el flujo de migración.

#### Schema compartido (Drizzle)
- `shared/schema.ts`
  - Añade tabla `hybrid_reentry_watches` (Drizzle) y tipos:
    - `HybridReentryWatch`
    - `InsertHybridReentryWatch`
  - Extiende `order_intents` con:
    - `hybridGuardWatchId`
    - `hybridGuardReason`

#### Storage (DB layer)
- `server/storage.ts`
  - Implementa métodos Hybrid Guard:
    - `getActiveHybridReentryWatch`
    - `recentlyCreatedHybridReentryWatch`
    - `insertHybridReentryWatch`
    - `markHybridReentryWatchTriggered`
    - `expireHybridReentryWatches`
    - `countActiveHybridReentryWatchesForPair` (para respetar `maxActiveWatchesPerPair`)

#### Trading Engine (core)
- `server/services/tradingEngine.ts`
  - Crea watch al bloquear BUY por `ANTI_CRESTA` o `MTF_STRICT`.
  - Re-entry:
    - `ANTI_CRESTA`: permite re-entry si `|priceVsEma20Pct| <= reentryMaxAbsPriceVsEma20Pct`.
    - `MTF_STRICT`: permite re-entry si `mtfAlignment >= reentryMinAlignment`.
  - Respeta límites:
    - `maxActiveWatchesPerPair`.
    - TTL (`ttlMinutes`) y cooldown (`cooldownMinutes`).
  - Persistencia de trazabilidad:
    - Propaga `hybridGuard` hacia `executionMeta` y lo guarda en `order_intents`.
  - Seguridad:
    - En `DRY_RUN` no marca watches como `triggered`.

#### Telegram
- `server/services/telegram.ts`
  - Nuevas alertas Hybrid Guard:
    - `sendHybridGuardWatchCreated`
    - `sendHybridGuardReentrySignal`
    - `sendHybridGuardOrderExecuted`

#### Config / UI
- `shared/config-schema.ts`
  - Añade `global.hybridGuard` con defaults y validación Zod.
- `server/services/ConfigService.ts`
  - Normaliza configs con Zod para aplicar defaults (incluye `global.hybridGuard`).
- `client/src/components/dashboard/TradingConfigDashboard.tsx`
  - Sección de configuración Hybrid Guard en el dashboard.


## 2026-01-31 — FIX CRÍTICO: SELL RevolutX (pendingFill) se ejecuta pero no aparece en Operaciones

### Síntoma
- Telegram notifica: `⏳ Orden SELL enviada` (pendiente de confirmación)
- RevolutX confirma la ejecución (orden completada)
- En el panel del bot NO aparece la operación (tabla `trades` sin registro)

### Caso real (STAGING)
- `order_intents.id=23`
- `client_order_id=ac3bf6b8-7316-4537-8c5b-c03e884509aa`
- `exchange_order_id=b77ddd5b-f299-4a9d-a83d-413bf803d604`
- BotEvents:
  - `SG_EMERGENCY_STOPLOSS` (caída ~-12%)
  - `ORDER_ATTEMPT`
  - `ORDER_PENDING_FILL`

### Causa Raíz
En RevolutX, algunas órdenes retornan `pendingFill=true` (aceptadas sin fill inmediato). Para SELL:
- Se enviaba el mensaje de Telegram.
- Se persistía `order_intent` como `accepted`.
- Pero NO se garantizaba la reconciliación del fill → no se insertaba el trade en `trades`.

### Solución Implementada
1) `server/services/tradingEngine.ts`:
- Iniciar `FillWatcher` también para órdenes SELL en `pendingFill`.

2) `server/services/FillWatcher.ts`:
- Persistir el trade aunque no exista `open_position` (caso SELL).
- En verificación por timeout (late fill), persistir trade y tratar como éxito incluso sin posición.
- `fillId` derivado de `getOrder` ahora es estable (`${exchangeOrderId}-fill`) para evitar duplicados.

### Impacto
- ✅ Los SELL `pendingFill` quedan persistidos en `trades`.
- ✅ El historial de Operaciones refleja la venta.
- ✅ Se evita que un SELL ejecutado quede “invisible” en UI.

### Nota (migraciones)
- Se ajustó `db/migrations/005_trades_origin_and_dedupe.sql` para ignorar `duplicate_table` (42P07) al recrear la constraint `trades_exchange_pair_trade_id_key`, evitando logs de error no-bloqueantes en startup.

### Mejora UI (trazabilidad)
- `client/src/pages/Terminal.tsx`: En **Posiciones Abiertas**, se muestra el `lotId` completo y un botón para copiar el lote (evita tener que buscar el ID en DB cuando hay incidencias/duplicados).

### Fix trazabilidad de build (BUILD_COMMIT)
- Problema: en contenedor aparecía `/bin/sh: git: not found` y `[startup] BUILD_COMMIT: unknown`.
- `server/services/environment.ts`: `getGitCommit()` deja de ejecutar `git` vía shell y usa `spawnSync` (silencioso) solo como fallback, priorizando `VERSION`.
- `server/services/BackupService.ts`: métricas de backup leen `VERSION` para `botVersion` y evitan dependencia de `git` dentro del contenedor.
- `Dockerfile`: prioriza `VERSION` existente (no lo sobreescribe si tiene hash) y solo usa `GIT_COMMIT` como fallback.
- `scripts/stamp-version.sh`: estampa `VERSION` en el VPS antes del build (`git rev-parse --short HEAD`) sin incluir `.git` en el build context.
- `scripts/deploy-staging.sh`: helper para hacer el deploy de STAGING con `VERSION` estampado.

## 29-ENE-2026: Fix conflicto de doble instancia en ErrorAlertService

**Problema identificado:**
- ErrorAlertService creaba una NUEVA instancia de TelegramService al enviar alertas
- El bot principal ya estaba corriendo con su propia instancia haciendo polling
- Dos instancias intentando polling → Error 409 Conflict de Telegram
- ErrorAlertService detectaba "bot not initialized" y no enviaba alertas

**Análisis del problema:**
- **Instancia 1**: Bot principal (inicializado al startup) haciendo polling con lock
- **Instancia 2**: ErrorAlertService creaba nueva instancia para enviar alertas
- **Conflicto**: `ETELEGRAM: 409 Conflict: terminated by other getUpdates request`
- **Resultado**: ErrorAlertService no podía enviar alertas críticas ni de rechazo

**Solución aplicada (2 commits):**

**Commit 1 (a5dba88): Inyectar instancia global**
```typescript
// server/routes.ts (líneas 138-140)
// Inyectar telegramService global en ErrorAlertService para evitar conflictos 409
errorAlertService.setTelegramService(telegramService);
console.log("[startup] TelegramService injected into ErrorAlertService");
```

**Commit 2 (e95f923): Modificar getTelegramService() para usar instancia inyectada**
```typescript
// server/services/ErrorAlertService.ts (líneas 54-73)
private async getTelegramService(): Promise<any> {
  // Si ya hay una instancia inyectada, usarla (evita conflicto 409)
  if (this.telegramService) {
    return this.telegramService;
  }
  
  // Import dinámico solo cuando se necesita (ESM compatible)
  const telegramModule = await import("./telegram");
  this.telegramService = new telegramModule.TelegramService();
  // ... inicialización solo si no hay instancia inyectada
}
```

**Verificación del fix:**
- ✅ `[startup] TelegramService injected into ErrorAlertService` en logs
- ✅ Alertas críticas llegan al chat `-1003504297101`
- ✅ Sin errores 409 en logs de Telegram
- ✅ Endpoint `/api/test/critical-alert` funciona correctamente

**Nota sobre alertas de rechazo:**
- Las alertas de rechazo (`sendSignalRejectionAlert`) solo se activan para `MTF_STRICT` y `ANTI_CRESTA`
- Rechazos por `MIN_ORDER_ABSOLUTE` no usan este sistema (por diseño)
- Para probar alertas de rechazo se necesita una señal real que sea filtrada por MTF/Anti-Cresta

**Impacto:**
- ✅ ErrorAlertService reutiliza instancia global del bot
- ✅ Eliminado conflicto de doble polling
- ✅ Sistema de alertas completamente funcional
- ✅ Alertas críticas y de rechazo operativas (cuando corresponde)

---

## 2026-01-29 20:32 — FIX: HTML inválido en alertas críticas de Telegram

### Problema Detectado
Las alertas críticas fallaban con error 400 de Telegram: "Tag 'span' must have class 'tg-spoiler'". El HTML usaba etiquetas `<span>` con estilos CSS que Telegram no permite.

### Solución Implementada
Reemplazar etiquetas `<span style="color: ...">` con emojis para indicar severidad:

```typescript
// Antes (causaba error 400):
MEDIUM: '<span style="color: #FFA500">', // Naranja
HIGH: '<span style="color: #FF4444">', // Rojo fuerte
CRITICAL: '<span style="color: #FF0000; font-weight: bold">' // Rojo brillante

// Después (compatible con Telegram):
MEDIUM: '🟡', // Amarillo/naranja
HIGH: '🔴', // Rojo
CRITICAL: '🚨' // Rojo crítico
```

### Archivos Modificados
- `server/services/ErrorAlertService.ts` - Reemplazado HTML span con emojis para severidad

### Impacto
- ✅ Alertas críticas ahora se envían correctamente a Telegram
- ✅ Elimina error 400 "can't parse entities"
- ✅ Más visual y compatible con formato de Telegram

---

## 2026-01-29 19:59 — MEJORA: Endpoint de test para alertas críticas

### Problema Detectado
No había forma de probar que las alertas críticas se enviaban correctamente al chat configurado sin generar un error real.

### Solución Implementada
Nuevo endpoint `/api/test/critical-alert` para enviar alertas críticas de prueba.

```bash
curl -X POST http://localhost:3020/api/test/critical-alert \
  -H "Content-Type: application/json" \
  -d '{"type":"PRICE_INVALID","message":"Test de alerta","pair":"BTC/USD"}'
```

### Archivos Modificados
- `server/routes.ts` - Añadido endpoint `/api/test/critical-alert` dentro de `registerRoutes()`

### Impacto
- ✅ Permite verificar configuración de alertas críticas por chat
- ✅ Útil para testing de integración con Telegram

---

## 2026-01-29 14:45 — MEJORA: Filtros Avanzados Anti-Cresta y MTF Estricto + Alertas de Rechazo

### Problema Detectado
Análisis de las posiciones abiertas del **28/01/2026** que quedaron en negativo:
- **SOL/USD 20:00** - Entró con 5/0 señales pero SIN confirmación MTF → -2.44%
- **SOL/USD 21:30** - Entró con 4/1 señales pero SIN confirmación MTF → -2.37%
- **ETH/USD 21:15** - Entró con volumen 2.1x en sobrecompra → -2.28%
- **ETH/USD 20:00** - Entró con confirmación MTF → -0.70% (menor pérdida)

**Patrón identificado:** Compras en regímenes TRANSITION sin suficiente confirmación MTF, y compras tardías con volumen alto (cresta).

### Solución Implementada

#### 1) Filtro MTF Estricto por Régimen
Nuevos umbrales en `applyMTFFilter()`:
- **TRANSITION**: Exige MTF alignment >= 0.30 para compras
- **RANGE**: Exige MTF alignment >= 0.20 para compras

```typescript
if (regime === "TRANSITION" && mtf.alignment < 0.3) {
  return { filtered: true, reason: "MTF insuficiente en TRANSITION", filterType: "MTF_STRICT" };
}
```

#### 2) Filtro Anti-Cresta (evita compras tardías)
Bloquea compras cuando se detecta:
- Volumen > 1.5x del promedio de 20 períodos
- Y precio > 1% sobre EMA20

```typescript
if (volumeRatio > 1.5 && priceVsEma20Pct > 0.01) {
  return { action: "hold", reason: "Anti-Cresta: Volumen alto en sobrecompra" };
}
```

#### 3) Alertas de Telegram para Rechazos Específicos
Nueva función `sendSignalRejectionAlert()` que envía alerta detallada cuando:
- Filtro **MTF_STRICT** bloquea una señal BUY
- Filtro **ANTI_CRESTA** bloquea una señal BUY

Incluye snapshot JSON copiable para debugging.

#### 4) Chat de destino configurable (por tipo de alerta)
- Las alertas de rechazo pueden enviarse a **un chat específico** (o a todos) vía UI.
- Las alertas de errores críticos ahora respetan el chat seleccionado en UI también cuando se envían desde `TelegramService`.

### Archivos Modificados
- `server/services/telegram.ts` - Nueva función `sendSignalRejectionAlert()` con configuración
- `server/services/tradingEngine.ts`:
  - `applyMTFFilter()` - Añadido parámetro `regime` y umbrales estrictos
  - `analyzeWithCandleStrategy()` - Añadido filtro anti-cresta y alertas de rechazo
- `shared/schema.ts` - Campos `signalRejectionAlertsEnabled` y `signalRejectionAlertChatId` en tabla `botConfig`
- `server/storage.ts` - Health-check + auto-migración de schema para nuevos campos
- `client/src/pages/Notifications.tsx` - Toggle y selector de chat para alertas de rechazo, y corrección de selector de chat de errores críticos

### Impacto Esperado
- ✅ Evitaría 2/4 compras problemáticas del 28/01 (SOL sin MTF)
- ✅ Evitaría compras tardías en momentum agotado
- ✅ Alertas informativas para análisis posterior
- ✅ Reduce compras contra tendencia mayor en regímenes inestables

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

## 2026-03-12 — FIX: Rate-limit backoff en MTF y candle fetch + telegram warn cosmético

### Problema raíz
Los logs mostraban `["EGeneral:Too many requests"]` para BTC/USD repitiéndose cada 5 segundos en dos puntos:

1. **`mtfAnalysis.ts` — Loop infinito MTF**: Cuando `getMultiTimeframeData` fallaba por rate-limit de Kraken, retornaba `null` sin actualizar la caché. El siguiente ciclo (5s) encontraba la caché vacía y reintentaba → mismo error → bucle infinito.

2. **`tradingEngine.ts` — Loop infinito candle**: `getLastClosedCandle` fallaba por rate-limit → retornaba `null` → `lastEvaluatedCandle` nunca se actualizaba → `shouldPollForNewCandle` veía `lastTs=0` → retornaba `true` en cada ciclo → reintento perpetuo cada 5s.

3. **`telegram.ts` — WARN innecesario**: `sendAlertWithSubtype` emitía `console.warn` cuando `balance_exposure` no tenía chat configurado, aunque el mensaje SÍ se enviaba correctamente vía fallback al `defaultChatId`.

### Fix aplicado

#### `server/services/mtfAnalysis.ts`
- **Campo nuevo:** `rateLimitBackoff: Map<string, number>` (pair → retry-after timestamp)
- **Constante nueva:** `MTF_RATE_LIMIT_BACKOFF_MS = 120_000` (2 minutos de cooldown)
- **Lógica:** Si el fetch falla por rate-limit → activa backoff 2min + retorna caché stale si disponible. Durante backoff, usa caché stale en vez de reintentar. Limpia backoff en fetch exitoso.
- **Log nuevo:** `[MTF_RATE_LIMIT]` y `[MTF_BACKOFF]` para trazabilidad.

#### `server/services/tradingEngine.ts`
- **Campo nuevo:** `candleFetchBackoff: Map<string, number>` (pair:tf → retry-after timestamp)
- **Constante nueva:** `CANDLE_FETCH_BACKOFF_MS = 60_000` (60s cooldown)
- **Lógica:** Si `getLastClosedCandle` falla por rate-limit → activa backoff 60s + retorna `null` silencioso. Durante backoff, la función retorna `null` inmediatamente sin llamar a la API. Limpia backoff en fetch exitoso.
- **Log nuevo:** `[CANDLE_RATE_LIMIT]` al activar backoff.

#### `server/services/telegram.ts`
- Downgrade de `console.warn` a `console.log` en el caso de fallback a `defaultChatId` — el mensaje se envía correctamente, el warn era ruido innecesario en logs.

### Resultado esperado
- BTC/USD (y cualquier otro par) deja de generar errores de rate-limit repetitivos cada 5s
- MTF usa caché stale durante el backoff → el análisis continúa con datos recientes aunque con ligero delay
- Logs más limpios sin WARNs falsos de Telegram

### Verificación
- `npx tsc --noEmit` → 0 errores TS

---

## 2026-07-XX — REFACTOR: Auditoría Motor de Entrada — EntryDecisionContext

### Problema raíz (auditoría completa)

Se identificaron múltiples inconsistencias críticas en el motor de entrada:

1. **EMA10/EMA20 calculadas 5 veces** en archivos distintos con slices de datos diferentes, causando que el snapshot Telegram mostrara valores distintos a los usados para la decisión.

2. **`volumeRatio` con bases inconsistentes**: `strategies.ts` usaba promedio de **10 velas**, mientras `buyMetrics` en `tradingEngine.ts` usaba promedio de **20 velas** → los guards de VOLUME_EXPANSION y VOLUME_OVERRIDE podían contradecirse.

3. **Bug crítico en snapshot BUY**: `ema20: expSnap?.metrics?.priceVsEma20Pct != null ? undefined : undefined` — ternario muerto que siempre retornaba `undefined`. El snapshot NUNCA mostraba el valor de EMA20.

4. **`ema10` nunca llegaba al snapshot**: No existía ruta desde el cálculo hasta `sendBuyExecutedSnapshot`.

5. **Sin hard guards estructurales**: Una señal BUY podía ejecutarse con MACD muy negativo en régimen TRANSITION, o con price extendido sobre EMA20 pero volumen débil.

6. **ATR% recalculado 3 veces** en `analyzeWithCandleStrategy` para diferentes propósitos.

7. **Estrategias no retornaban indicadores calculados**: `momentumCandlesStrategy` calculaba EMA10/EMA20/MACD internamente pero no los exponía en el `TradeSignal`.

### Solución implementada

#### NUEVO: `server/services/EntryDecisionContext.ts`
- **`EntryDecisionContext`**: interfaz única con todos los indicadores del ciclo (ema10, ema20, prevEma10, prevEma20, macdHist, prevMacdHist, macdHistSlope, avgVolume20, volumeRatio, priceVsEma20Pct, atrPct, lastCandle, prevCandle, expansionResult, mtfAlignment, missingMetrics, blockers, warnings).
- **`buildEntryDecisionContext()`**: calcula todos los indicadores UNA SOLA VEZ por ciclo/par. Base unificada de 20 velas para `volumeRatio` (mismo que expansion detector).
- **`validateEntryMetrics()`**: verifica que todos los indicadores requeridos son válidos. Muta `dataComplete` y `missingMetrics`.
- **`evaluateHardGuards()`**: bloqueos estructurales antes de ejecutar BUY:
  - `DATA_INCOMPLETE`: métricas requeridas faltantes/inválidas
  - `MACD_STRONGLY_NEGATIVE_TRANSITION`: slope < -0.003 en régimen TRANSITION
  - `LOW_VOL_EXTENDED_PRICE`: volumeRatio < 0.8 con precio > 0.5% sobre EMA20
  - `MTF_STRONGLY_NEGATIVE`: alineación MTF < -0.6

#### `server/services/strategies.ts`
- **`TradeSignal`** ampliado: campos `ema10?`, `ema20?`, `macdHist?`, `macdHistSlope?`
- **`momentumCandlesStrategy`**: retorna `ema10`, `ema20`, `macdHist`, `macdHistSlope` en señales BUY

#### `server/services/tradingEngine.ts`
- **Campo nuevo**: `lastEntryContext: Map<string, EntryDecisionContext>` — almacena el contexto por par
- **`analyzeWithCandleStrategy`**:
  - Llama `buildEntryDecisionContext()` UNA vez, almacena en `lastEntryContext`
  - Log `[ENTRY_CONTEXT_BUILT]` con todos los valores calculados
  - Expansion detector usa valores del contexto (sin recalcular EMA/MACD)
  - Hard guards antes de anti-cresta con alerta Telegram `HARD_GUARD`
  - Anti-cresta lee de `entryCtx.*` en vez de `buyMetrics.*`
  - MTF rejection alerts usan `entryCtx.*` en vez de `buyMetrics.*`
  - ATR% para MTF: `const atrPctForMtf = entryCtx.atrPct ?? undefined` (sin recalcular)
- **`analyzePairAndTradeWithCandles`** (snapshot BUY):
  - Lee `snapshotCtx = this.lastEntryContext.get(pair)`
  - **FIX bug**: `ema20: snapshotCtx?.ema20` (antes: siempre `undefined`)
  - **FIX nuevo**: `ema10: snapshotCtx?.ema10` (antes: nunca disponible)
  - `macdHistSlope`, `volumeRatio`, `priceVsEma20Pct` desde contexto con fallback a expSnap

#### `server/services/telegram.ts`
- `sendSignalRejectionAlert()`: acepta `"HARD_GUARD"` como nuevo `filterType` válido

### Resultado esperado
- Snapshot BUY ahora muestra EMA10/EMA20 correctos (ya no `N/A`)
- Snapshot y guards usan exactamente los mismos valores calculados
- `volumeRatio` unificado en base 20 velas en todo el pipeline
- Señales con datos incompletos o contradictorios bloqueadas antes de ejecutar
- Log `[ENTRY_CONTEXT_BUILT]` permite auditar todos los indicadores por ciclo
- Log `[ENTRY_HARD_GUARD_BLOCK]` con `decisionId` para trazabilidad completa

### Archivos modificados
- `server/services/EntryDecisionContext.ts` (NUEVO)
- `server/services/strategies.ts`
- `server/services/tradingEngine.ts`
- `server/services/telegram.ts`
- `CORRECCIONES_Y_ACTUALIZACIONES.md`

### Verificación
- `npx tsc --noEmit` → 0 errores TS

---

## 2026-03-22 — REFACTORING COMPLETO UI/UX (FASES 1-13)

### Objetivo
Refactorización completa de la interfaz de usuario y modelo de configuración del bot de trading, ejecutada en fases secuenciales sin interrupciones.

### FASE 1: Auditoría completa UI/código
- Generado `AUDIT_FASE1.md` con mapa de duplicidades, solapamientos y dependencias IDCA
- Identificadas secciones duplicadas entre Settings, Strategies y TradingConfigDashboard
- Mapeadas todas las rutas, componentes y fuentes de verdad

### FASE 2: Nueva arquitectura de navegación
- `Nav.tsx`: Agrupación de enlaces en 3 categorías con separadores visuales:
  - **TRADING**: Panel, Trading, Terminal, IDCA
  - **ANÁLISIS**: Monitor, Cartera, Alertas
  - **SISTEMA**: Sistema, APIs
- Renombradas etiquetas: ESTRATEGIAS→TRADING, NOTIFICACIONES→ALERTAS, INTEGRACIONES→APIS
- `MobileTabBar.tsx`: Actualizado para reflejar nueva nomenclatura

### FASE 3: Reasignación funcional
- `Settings.tsx`: Eliminado import muerto `SignalThresholdConfig`, eliminada card duplicada "Alertas y Notificaciones", título actualizado a "Sistema"
- `Strategies.tsx`: Título actualizado a "Trading"

### FASE 4: Modo Simple/Avanzado
- Toggle `Simple/Avanzado` en header de Trading (persistido en localStorage)
- **Modo Simple**: Solo tab Configuración con secciones esenciales (Estrategia, Riesgo, Pares)
- **Modo Avanzado**: Tabs adicionales (Métricas, Motor Adaptativo, Smart Exit) + secciones avanzadas (Señal Momentum, Tamaño Trade, Exposición)

### FASE 5-6: Pestaña Entradas
- Nueva tab "Entradas" visible en ambos modos
- **Slider de Exigencia de Señales** (1-10): Ajusta umbrales proporcional por régimen
  - Tendencia: valor base, Rango: +1 (más estricto), Transición: -1 (más ágil)
- **Ajuste fino por régimen** (solo modo avanzado): Sliders individuales
- **Protección Anti-Reentrada**: Cards informativos de cooldowns
- Conectado a API `/api/trading/signals/config`

### FASE 7: Pestaña Salidas
- Nueva tab "Salidas" visible en ambos modos
- **Control de Salidas**: Sliders SL/TP/Trailing con ejemplo visual dinámico
- **Mecanismos Avanzados**: SmartGuard, TimeStop, SmartExit, Circuit Breaker
- **Prioridad de salida** documentada visualmente

### FASE 8-9/10: Eliminación de duplicidades
- Eliminada sección "Control de Riesgo Automático" de tab Configuración
- Controles SL/TP/Trailing exclusivamente en tab "Salidas"

### FASE 12-13: UX responsive
- Clase CSS `scrollbar-hide` para scroll horizontal invisible en tabs
- Tab bar móvil con scroll edge-to-edge

### Archivos modificados
- `client/src/components/dashboard/Nav.tsx`
- `client/src/components/mobile/MobileTabBar.tsx`
- `client/src/pages/Settings.tsx`
- `client/src/pages/Strategies.tsx`
- `client/src/index.css`
- `AUDIT_FASE1.md` (NUEVO)

### Commits
- `899fed8` — FASE 2+3: Nav + pages renamed
- `4f0cb99` — FASE 4: Simple/Advanced toggle
- `3e4a782` — FASE 5-6: Entradas tab
- `0c9e38c` — FASE 7: Salidas tab
- `8f91ddd` — FASE 8-9/10: Remove duplicates
- `c7f187b` — FASE 12-13: UX responsive

### Verificación global
- `npx tsc --noEmit` → 0 errores TS en cada fase

---
