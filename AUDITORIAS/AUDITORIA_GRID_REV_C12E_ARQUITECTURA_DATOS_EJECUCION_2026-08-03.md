# AUDITORIA - REV-C12E: Arquitectura Kraken-Datos / Revolut X-Ejecucion

**Fecha:** 2026-08-03
**Rama:** `review/grid-rev-c12a-20260731`
**HEAD base:** `d230635b1af976790fd5d5408db941978475c46a`
**Fase:** REV-C12E - Separacion arquitectonica datos/ejecucion

---

## 1. Matriz comparativa Momentum/IDCA/Grid

| Modulo | Datos (ticker/bid/ask/last) | Ejecucion | Confirmacion fills |
|--------|----------------------------|-----------|-------------------|
| **Momentum** | Kraken / MarketDataService | Exchange configurado | Respuesta del exchange |
| **IDCA** | Kraken / MarketDataService | Trading exchange (Revolut X cuando configurado) | getOrder / getFills |
| **Grid actual (pre-REV-C12E)** | Bandas Kraken + ticker directo Revolut X | Revolut X | getOrder / getFills |
| **Grid objetivo (REV-C12E)** | Kraken / MarketDataService | Revolut X post_only | getOrder / getFills |

---

## 2. Causa arquitectonica

`GRID_NATIVE_TICKER_DEPENDENCY = ARCHITECTURAL_DIVERGENCE`

El Grid era el unico modulo que llamaba `revolutXService.getTicker()` directamente para obtener bid/ask/last. Cuando el endpoint de order-book/trades de Revolut X falla (404, timeout, etc.), el Grid quedaba bloqueado aunque:
- Las constraints del par si estuvieran disponibles
- Las bandas Kraken si estuvieran calculadas
- Las funciones de ejecucion (placeOrder, cancelOrder) si estuvieran operativas

`REVOLUT_X_GENERAL_FAILURE = FALSE` - Revolut X no esta averiado. El servicio esta inicializado y las constraints se resuelven. El problema era que el Grid dependia de un endpoint de ticker publico que no es necesario para la planificacion.

---

## 3. Llamadas directas encontradas inicialmente

| Call site | Archivo | Linea | Proposito |
|-----------|---------|-------|-----------|
| `revolutXService.getTicker` | gridIsolatedEngine.ts | 1349 | tick() normal |
| `revolutXService.getTicker` | gridIsolatedEngine.ts | 5034 | rebuild manual |
| `allow_taker` | gridExecutionService.ts | 320 | taker fallback |
| `GRID_LEVEL_TAKER_FALLBACK` | gridExecutionService.ts | 305 | log de fallback |
| `_taker` clientOrderId | gridExecutionService.ts | 319, 326 | ID de orden taker |
| `usedTakerFallback: true` | gridExecutionService.ts | 330 | flag de resultado |
| `source: "REVOLUT_X_TICKER"` | gridIsolatedEngine.ts | 1350, 5035 | fuente del snapshot |

---

## 4. Llamadas directas eliminadas

| Call site | Estado post-REV-C12E |
|-----------|---------------------|
| `revolutXService.getTicker` en tick() | **ELIMINADO** - reemplazado por `MarketDataService.getFreshTickerSnapshot` |
| `revolutXService.getTicker` en rebuild | **ELIMINADO** - reemplazado por `MarketDataService.getFreshTickerSnapshot` |
| `allow_taker` executionInstruction | **ELIMINADO** - solo `post_only` |
| `GRID_LEVEL_TAKER_FALLBACK` log | **ELIMINADO** - reemplazado por `GRID_LEVEL_POST_ONLY_EXHAUSTED` |
| `_taker` clientOrderId | **ELIMINADO** - nunca se genera |
| `usedTakerFallback: true` | **ELIMINADO** - siempre `false` |
| `source: "REVOLUT_X_TICKER"` | **ELIMINADO** - reemplazado por `source: "KRAKEN_MARKET_DATA"` |

---

## 5. MarketTickerSnapshot Kraken

**Archivo:** `server/services/MarketDataService.ts`

```typescript
export interface MarketTickerSnapshot {
  pair: string;
  ticker: Ticker;
  marketDataVenue: "KRAKEN";
  source: "KRAKEN_MARKET_DATA";
  fetchedAt: Date;
  ageMs: number;
  maxAgeMs: number;
  fresh: boolean;
  cached: boolean;
}

async getFreshTickerSnapshot(pair: string, maxAgeMs?: number): Promise<MarketTickerSnapshot | null>
```

- Usa `ExchangeFactory.getDataExchange()` (siempre Kraken)
- Verifica `ExchangeFactory.getDataExchangeType() === "kraken"`
- Reutiliza cache existente (`priceCache`)
- Reutiliza single-flight (`pendingPrices`)
- Lectura de cache NO renueva `fetchedAt`
- Cache stale NO se trata como fresh
- TTL inicial 45.000 ms
- Inyectable en tests via `maxAgeMs`
- Devuelve `null` fail-closed cuando faltan datos

---

## 6. GridReferenceMarketSnapshot

**Archivo:** `server/services/gridIsolated/gridReferenceMarketResolver.ts`

Valida estrictamente:
- pair exacto
- bid finito y > 0
- ask finito y > bid
- last finito y > 0
- timestamp Date valida
- fresh=true
- source=KRAKEN_MARKET_DATA
- marketDataVenue=KRAKEN

`authoritativeForVenueCrossing=false` - la referencia Kraken NO garantiza que una orden sea maker en Revolut X.

---

## 7. GridExecutionCapabilitySnapshot

**Archivo:** `server/services/gridIsolated/gridExecutionCapabilityResolver.ts`

Deriva exclusivamente de:
- `revolutXService.isInitialized()`
- `resolveGridPairConstraints()`
- `executionPolicy === MAKER_ONLY`
- `takerFallbackEnabled === false`

NO llama a `revolutXService.getTicker()`.

---

## 8. resolveGridPlanningContext

**Archivo:** `server/services/gridIsolated/gridPlanningContextResolver.ts`

Flujo canonico unico:
1. `getGridBandSnapshot()` - Kraken
2. `MarketDataService.getFreshTickerSnapshot()` - Kraken
3. `resolveGridReferenceMarketSnapshot()` - validar Kraken
4. `resolveGridPairConstraints()` - Revolut X
5. `resolveGridExecutionCapability()` - Revolut X
6. `buildGridExecutionMarketSnapshot()` - execution snapshot
7. `gridCapitalAllocator.allocate()` - allocation
8. `splitSymmetricLevels()` - split simetrico
9. `resolveGridProfessionalProjectionContext()` - projection context
10. `computeGateTtl()` - TTL
11. Build `GridPlanningGate` con blockers

---

## 9. GridPlanningGate

```typescript
export interface GridPlanningGate {
  canPlanRange: boolean;
  canCreateRange: boolean;
  canSubmitMakerOrder: boolean;
  allowCycleExits: true;
  referenceMarket: GridReferenceMarketSnapshot | null;
  executionCapability: GridExecutionCapabilitySnapshot | null;
  blockers: string[];
  evaluatedAt: string;
}
```

- `canPlanRange`: banda Kraken + ticker Kraken fresh + bid/ask validos + regimen apto
- `canCreateRange`: marketAndCapabilityReady + allocation + split + projection + TTL + 0 blockers
- `canSubmitMakerOrder`: capability verificada + post_only + no legacy policy
- `allowCycleExits`: siempre `true`

---

## 10. Reason codes

**Reference market (Kraken):**
- REFERENCE_MARKET_UNAVAILABLE
- REFERENCE_MARKET_STALE
- REFERENCE_MARKET_BID_INVALID
- REFERENCE_MARKET_ASK_INVALID
- REFERENCE_MARKET_LAST_INVALID
- REFERENCE_MARKET_PAIR_MISMATCH
- REFERENCE_MARKET_SOURCE_INVALID
- REFERENCE_MARKET_FUTURE_TIMESTAMP
- REFERENCE_MARKET_TIMESTAMP_INVALID

**Execution capability (Revolut X):**
- REVOLUT_X_NOT_INITIALIZED
- REVOLUT_X_CONSTRAINTS_UNAVAILABLE
- REVOLUT_X_CONSTRAINTS_STALE
- REVOLUT_X_CONSTRAINTS_PAIR_MISMATCH
- REVOLUT_X_PRICE_TICK_INVALID
- REVOLUT_X_QUANTITY_STEP_INVALID
- POST_ONLY_NOT_ENFORCED
- TAKER_FALLBACK_NOT_DISABLED
- LEGACY_TAKER_POLICY_BLOCKED

**Post-only rejection:**
- POST_ONLY_REJECTED_REPRICE_REQUIRED

**Planning context:**
- ALLOCATION_INPUT_MISSING
- ALLOCATION_FAILED
- SYMMETRIC_SPLIT_FAILED
- PLANNING_CONTEXT_INCOMPLETE
- TTL_STALE
- TTL_VALID_UNTIL_MISSING

---

## 11. post_only obligatorio

- `executionInstruction: "post_only"` es el unico instruction usado
- BUY: cuantizar precio con `priceTickSize`, no cruzar, no market
- SELL: cuantizar precio, no reducir por debajo del target, no market
- Rechazo post_only -> `POST_ONLY_REJECTED_REPRICE_REQUIRED`, no fill, no PnL

---

## 12. takerFallback=false

- `takerFallbackAllowed` siempre `false` en `GridExecutionCapabilitySnapshot`
- `usedTakerFallback` siempre `false` en `GridOrderResult`
- Fase 2 (taker fallback) eliminada completamente de `gridExecutionService.placeOrder`
- `GRID_LEVEL_TAKER_FALLBACK` EventType mantenido en union solo para compatibilidad historica

---

## 13. Fills exclusivamente getOrder/getFills

- No se infieren fills desde precio Kraken
- Confirmacion exclusivamente via Revolut X `getOrder()` / `getFills()`
- Sin confirmacion: no abrir ciclo, no cerrar ciclo, no actualizar quantityFilled, no PnL

---

## 14. Archivos modificados

| Archivo | Tipo | Cambio |
|---------|------|--------|
| `server/services/MarketDataService.ts` | Modificado | +`MarketTickerSnapshot` interface, +`getFreshTickerSnapshot` method, +provenance CachedPrice |
| `server/services/gridIsolated/gridIsolatedTypes.ts` | Modificado | +tipos REV-C12E (GridReferenceMarketSnapshot, GridExecutionCapabilitySnapshot, GridPlanningGate, reason codes) |
| `server/services/gridIsolated/gridIsolatedEngine.ts` | Modificado | tick() y rebuild usan orquestador, buildRangeProposal fail-closed |
| `server/services/gridIsolated/gridExecutionService.ts` | Modificado | Eliminada fase taker fallback, solo post_only |
| `server/services/gridIsolated/gridExecutionMarketSnapshot.ts` | Modificado | Acepta source KRAKEN_MARKET_DATA, TTL 45s, frescura corregida |
| `server/services/gridIsolated/gridPlanningContextResolver.ts` | Modificado | Orquestador unico con allocation+split+projection+TTL+gate |
| `server/services/gridIsolated/gridReferenceMarketResolver.ts` | Modificado | Fail-closed con recalculo ageMs |
| `server/services/gridIsolated/gridExecutionCapabilityResolver.ts` | Modificado | Fail-closed con priceTickSize/quantityStep/pair validation |
| `server/services/gridIsolated/buildGridMarketViewModel.ts` | Modificado | buildDataSourceInfo usa rutas reales ExecutionGateType |
| `client/src/components/grid/GridMarketPanel.tsx` | Modificado | Sin fallbacks inventados |
| `server/services/botLogger.ts` | Modificado | +4 nuevos EventType |
| `server/services/__tests__/gridIsolatedEngine.test.ts` | Modificado | Tests REV-C12C/E actualizados (mocks Kraken, expiresAt valido) |
| `server/services/__tests__/marketDataFreshTickerSnapshot.test.ts` | Modificado | +27 tests provenance y TTL |
| `server/services/gridIsolated/__tests__/gridPlanningContextResolver.test.ts` | Modificado | +tests gate fail-closed con allocation/split/projection/TTL |
| `server/services/gridIsolated/__tests__/gridCycleOwnedV3Engine.test.ts` | Modificado | Test E-S6 corregido (fetchedAt stale) |
| `server/services/__tests__/gridProfessionalProjectionContext.test.ts` | Modificado | Fixture validSnapshot con executionVenue |

---

## 15. Commit tecnico inicial

**SHA:** `fde1bf9`
**Mensaje:** `fix(grid-rev-c12e): separar datos Kraken y ejecucion Revolut X`

---

## 16. Commit documental inicial

**SHA:** `9841b45`
**Mensaje:** `docs(grid-rev-c12e): documentar arquitectura y validacion pre-merge`

---

## 17. Commit tecnico correcciones

**SHA:** `33094e5`
**Mensaje:** `fix(grid-rev-c12e): cerrar orquestador unico y trazabilidad Kraken`

Cambios:
- Orquestador unico real `resolveGridPlanningContext`
- Trazabilidad cache Kraken (CachedPrice provenance)
- Frescura y TTL unicos 45s
- Reference market fail-closed
- Execution capability fail-closed
- Codigos Kraken/Revolut X diferenciados
- UX sin fallbacks inventados

---

## 18. Commit documental correcciones

**SHA:** `7ff42bd`
**Mensaje:** `docs(grid-rev-c12e): documentar correcciones post-verificacion independiente`

---

## 19. Validacion pre-merge (commit 9841b45)

| Check | Estado |
|-------|--------|
| `npm run check` | OK limpio |
| `npm run build` | OK success |
| Matriz Grid (26 files, 734 tests) | OK 0 failures |
| Client Grid (5 files, 39 tests) | OK 0 failures |
| `marketDataFreshTickerSnapshot.test.ts` (27 tests) | OK 0 failures |
| `gridPlanningContextResolver.test.ts` (38 tests) | OK 0 failures |
| `gridExecutionCapabilityResolver.test.ts` (22 tests) | OK 0 failures |

---

## 20. Estado pre-merge

```
DONE: FALSE
HARD_BLOCKER: FALSE
TASK_STATUS: REV-C12E implementada localmente y validada; pendiente commit y verificacion independiente
NEXT_ACTION: commit selectivo y revision independiente en GitHub
DEPLOY_AUTHORIZED: FALSE
MIGRATION_REQUIRED: FALSE
```

**APTO_PARA_COMMIT_REV-C12E_EN_RAMA_DE_REVISION**

---

## 21. Correcciones post-verificacion independiente (2026-08-04)

### 21.1 Orquestador unico real (resolveGridPlanningContext)

Problema: resolveGridMarketAndConstraints solo resolvia mercado + constraints, pero allocation, split, projection context y TTL se llamaban por separado.

Correccion: resolveGridPlanningContext ahora es el orquestador canonico unico que resuelve exactamente una vez: band, ticker Kraken, reference market, constraints Revolut X, execution capability, execution snapshot, allocation, split, projection context, TTL y gate. tick() y rebuildRangeAndLevels lo reutilizan.

### 21.2 Trazabilidad cache Kraken (CachedPrice provenance)

CachedPrice ahora incluye marketDataVenue y source. putPrice manual se marca MANUAL_OR_UNKNOWN y no se acepta como fuente Kraken.

### 21.3 Frescura y TTL unicos 45s

Default cambiado a 45_000. Validacion de maxAgeMs (finite, > 0).

### 21.4 Reference market fail-closed

Recalcula ageMs independientemente. Valida todos los campos fail-closed.

### 21.5 Execution capability fail-closed

expiresAt=null bloquea. Valida priceTickSize/quantityStep. isInitialized() se captura una vez.

### 21.6 Codigos Kraken/Revolut X diferenciados

REFERENCE_MARKET_* cuando fuente es Kraken. Nuevos codigos: REVOLUT_X_CONSTRAINTS_PAIR_MISMATCH, REVOLUT_X_PRICE_TICK_INVALID, REVOLUT_X_QUANTITY_STEP_INVALID.

### 21.7 UX sin fallbacks inventados

GridMarketPanel elimina fallbacks y muestra "-" cuando no hay datos.

---

## 22. Correcciones tras segunda verificacion independiente (2026-08-04)

### 22.1 Rebuild manual reutiliza contexto pre-resuelto

Problema: manualRebuildPlannedLevels obtenia planningContextRebuild pero no reutilizaba completamente allocation ni projectionContextResult. buildRangeProposal recibia allocation pero no projection context. rebuildRangeAndLevels se llamaba sin parametros pre-resueltos.

Correccion: manualRebuildPlannedLevels ahora extrae rebuildAllocation y rebuildProjectionContext del orquestador. Valida: allocation !== null, projectionContext !== null, ttl.fresh === true, validUntil !== null, gate.canCreateRange === true. buildRangeProposal recibe ambos. rebuildRangeAndLevels recibe ambos.

### 22.2 buildRangeProposal fail-closed

Problema: buildRangeProposal tenia fallbacks `preResolvedAllocation ?? await gridCapitalAllocator.allocate(...)` y resolvia projection context cuando no se proporcionaba.

Correccion: allocation y projection context son obligatorios. Si falta alguno, devuelve `{ ok: false, reasonCode: "PLANNING_CONTEXT_INCOMPLETE" }`. Eliminadas llamadas a gridCapitalAllocator.allocate, resolveGridProfessionalProjectionContext y Math.floor(allocation.levelsCount / 2) dentro de buildRangeProposal.

### 22.3 Gate canCreateRange fail-closed

Problema: canCreateRange solo exigia market + capability. No exigia allocation, split, projection ni TTL.

Correccion: Separado marketAndCapabilityReady de canCreateRange. canCreateRange ahora exige: marketAndCapabilityReady === true, allocation !== null, symmetricSplit?.ok === true, projectionContextResult?.ok === true, ttl.fresh === true, ttl.validUntil !== null, blockers.length === 0.

Nuevos blockers:
- ALLOCATION_INPUT_MISSING (sin allocationInput)
- ALLOCATION_FAILED (allocation throw)
- SYMMETRIC_SPLIT_FAILED (split falla)
- TTL_STALE (ttl.fresh false)
- TTL_VALID_UNTIL_MISSING (validUntil null)

### 22.4 Frescura invertida corregida

Problema: En buildGridExecutionMarketSnapshot el camino sin timestamp usaba `fetchedAt.getTime() - acquiredAt.getTime() > maxAgeMs` (direccion invertida).

Correccion: `acquiredAt.getTime() - fetchedAt.getTime() >= maxAgeMs` -> stale. Validacion de fetchedAt Date valida, acquiredAt Date valida, fetchedAt no excesivamente futuro, maxAgeMs finito y > 0.

### 22.5 UX fuentes correctas

Problema: buildDataSourceInfo usaba rutas inexistentes `executionGate.executionVenue` y `executionGate.constraintsSource`.

Correccion: Usa rutas reales ExecutionGateType:
- `executionGate.executionMarketSnapshot.executionVenue`
- `executionGate.executionMarketSnapshot.source`
- `executionGate.pairConstraints.source`

Constraints Revolut X se etiquetan desde pairConstraints.source, nunca desde executionMarketSnapshot.source (Kraken).

Resultados:
- Fuente de precios: Kraken
- Venue de ejecucion: Revolut X
- Constraints: Revolut X

### 22.6 Encoding UTF-8 reparado

Problema: Auditoria con BOM U+FEFF y mojibake.

Correccion: Archivo reescrito desde texto limpio. UTF-8 sin BOM, LF. Validado con Node: sin BOM, sin mojibake.

---

## 23. Validacion tras segunda verificacion

| Check | Estado |
|-------|--------|
| `npm run check` | OK limpio (exit 0) |
| `npm run build` | OK success (exit 0) |
| `git diff --check` | OK sin whitespace errors |
| Matriz Grid completa (37 files, 934 tests) | OK 0 failures |
| `gridPlanningContextResolver.test.ts` (50 tests) | OK 0 failures |
| `gridCycleOwnedV3Engine.test.ts` (52 tests) | OK 0 failures |
| `gridIsolatedEngine.test.ts` (50 tests) | OK 0 failures |
| `gridProfessionalProjectionContext.test.ts` (104 tests) | OK 0 failures |

### 23.1 Tests gate canCreateRange fail-closed

1. sin allocationInput -> canCreateRange=false (ALLOCATION_INPUT_MISSING)
2. allocation valida -> continua
3. allocation throw -> canCreateRange=false (ALLOCATION_FAILED)
4. levelsCount impar -> canCreateRange=false (SYMMETRIC_SPLIT_FAILED)
5. projection context fail -> canCreateRange=false
6. TTL stale -> canCreateRange=false
7. validUntil null -> canCreateRange=false
8. contexto integro -> canCreateRange=true
9. blockers no vacios -> canCreateRange=false
10. allowCycleExits=true en todos los fallos

### 23.2 Verificacion orquestador unico

- gridCapitalAllocator.allocate en gridIsolatedEngine.ts (flujo productivo): 0 llamadas
- resolveGridProfessionalProjectionContext en gridIsolatedEngine.ts (flujo productivo): 0 llamadas
- Math.floor(allocation.levelsCount en gridIsolatedEngine.ts (flujo productivo): 0 usos
- Allocator se llama exactamente 1 vez por evaluacion (orquestador)
- Projection context se llama exactamente 1 vez por evaluacion (orquestador)

---

## 24. Estado tras segunda verificacion

```
DONE: FALSE
HARD_BLOCKER: FALSE
TASK_STATUS: REV-C12E corregida tras segunda verificacion independiente; pendiente commit y push de correccion
NEXT_ACTION: commit y posterior verificacion independiente
DEPLOY_AUTHORIZED: FALSE
MIGRATION_REQUIRED: FALSE
```

**APTO_PARA_COMMIT_REV-C12E_CORRECCION_EN_RAMA_DE_REVISION**

---

## 25. Alcance permitido

- server/services/gridIsolated/gridPlanningContextResolver.ts
- server/services/gridIsolated/gridIsolatedEngine.ts
- server/services/gridIsolated/gridExecutionMarketSnapshot.ts
- server/services/gridIsolated/buildGridMarketViewModel.ts
- client/src/components/grid/GridMarketPanel.tsx
- tests relacionados
- server/services/MarketDataService.ts (solo si defecto restante demostrado)
- los cuatro documentos REV-C12

## 26. Alcance excluido

- ExchangeFactory
- RevolutXService
- IDCA
- Momentum
- Telegram funcional
- FISCO
- SPOT
- schema
- migrations
- docker
- credenciales
- deploy scripts
