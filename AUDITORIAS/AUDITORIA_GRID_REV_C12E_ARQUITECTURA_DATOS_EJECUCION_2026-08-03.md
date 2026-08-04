# AUDITORÃƒÂA Ã¢â‚¬â€ REV-C12E: Arquitectura Kraken-Datos / Revolut X-EjecuciÃƒÂ³n

**Fecha:** 2026-08-03
**Rama:** `review/grid-rev-c12a-20260731`
**HEAD base:** `d230635b1af976790fd5d5408db941978475c46a`
**Fase:** REV-C12E Ã¢â‚¬â€ SeparaciÃƒÂ³n arquitectÃƒÂ³nica datos/ejecuciÃƒÂ³n

---

## 1. Matriz comparativa Momentum/IDCA/Grid

| MÃƒÂ³dulo | Datos (ticker/bid/ask/last) | EjecuciÃƒÂ³n | ConfirmaciÃƒÂ³n fills |
|--------|----------------------------|-----------|-------------------|
| **Momentum** | Kraken / MarketDataService | Exchange configurado | Respuesta del exchange |
| **IDCA** | Kraken / MarketDataService | Trading exchange (Revolut X cuando configurado) | getOrder / getFills |
| **Grid actual (pre-REV-C12E)** | Bandas Kraken + ticker directo Revolut X | Revolut X | getOrder / getFills |
| **Grid objetivo (REV-C12E)** | Kraken / MarketDataService | Revolut X post_only | getOrder / getFills |

---

## 2. Causa arquitectÃƒÂ³nica

`GRID_NATIVE_TICKER_DEPENDENCY = ARCHITECTURAL_DIVERGENCE`

El Grid era el ÃƒÂºnico mÃƒÂ³dulo que llamaba `revolutXService.getTicker()` directamente para obtener bid/ask/last. Cuando el endpoint de order-book/trades de Revolut X falla (404, timeout, etc.), el Grid quedaba bloqueado aunque:
- Las constraints del par sÃƒÂ­ estuvieran disponibles
- Las bandas Kraken sÃƒÂ­ estuvieran calculadas
- Las funciones de ejecuciÃƒÂ³n (placeOrder, cancelOrder) sÃƒÂ­ estuvieran operativas

`REVOLUT_X_GENERAL_FAILURE = FALSE` Ã¢â‚¬â€ Revolut X no estÃƒÂ¡ averiado. El servicio estÃƒÂ¡ inicializado y las constraints se resuelven. El problema era que el Grid dependÃƒÂ­a de un endpoint de ticker pÃƒÂºblico que no es necesario para la planificaciÃƒÂ³n.

---

## 3. Llamadas directas encontradas inicialmente

| Call site | Archivo | LÃƒÂ­nea | PropÃƒÂ³sito |
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
| `revolutXService.getTicker` en tick() | **ELIMINADO** Ã¢â‚¬â€ reemplazado por `MarketDataService.getFreshTickerSnapshot` |
| `revolutXService.getTicker` en rebuild | **ELIMINADO** Ã¢â‚¬â€ reemplazado por `MarketDataService.getFreshTickerSnapshot` |
| `allow_taker` executionInstruction | **ELIMINADO** Ã¢â‚¬â€ solo `post_only` |
| `GRID_LEVEL_TAKER_FALLBACK` log | **ELIMINADO** Ã¢â‚¬â€ reemplazado por `GRID_LEVEL_POST_ONLY_EXHAUSTED` |
| `_taker` clientOrderId | **ELIMINADO** Ã¢â‚¬â€ nunca se genera |
| `usedTakerFallback: true` | **ELIMINADO** Ã¢â‚¬â€ siempre `false` |
| `source: "REVOLUT_X_TICKER"` | **ELIMINADO** Ã¢â‚¬â€ reemplazado por `source: "KRAKEN_MARKET_DATA"` |

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
- Reutiliza cachÃƒÂ© existente (`priceCache`)
- Reutiliza single-flight (`pendingPrices`)
- Lectura de cachÃƒÂ© NO renueva `fetchedAt`
- CachÃƒÂ© stale NO se trata como fresh
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
- timestamp Date vÃƒÂ¡lida
- fresh=true
- source=KRAKEN_MARKET_DATA
- marketDataVenue=KRAKEN

`authoritativeForVenueCrossing=false` Ã¢â‚¬â€ la referencia Kraken NO garantiza que una orden sea maker en Revolut X.

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

Flujo canÃƒÂ³nico ÃƒÂºnico:
1. `getGridBandSnapshot()` Ã¢â‚¬â€ Kraken
2. `MarketDataService.getFreshTickerSnapshot()` Ã¢â‚¬â€ Kraken
3. `resolveGridReferenceMarketSnapshot()` Ã¢â‚¬â€ validar Kraken
4. `resolveGridPairConstraints()` Ã¢â‚¬â€ Revolut X
5. `resolveGridExecutionCapability()` Ã¢â‚¬â€ Revolut X
6. Build `GridPlanningGate`

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

- `canPlanRange`: banda Kraken + ticker Kraken fresh + bid/ask vÃƒÂ¡lidos + rÃƒÂ©gimen apto
- `canCreateRange`: canPlanRange + constraints Revolut X verificadas + MAKER_ONLY + post_only
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

**Execution capability (Revolut X):**
- REVOLUT_X_NOT_INITIALIZED
- REVOLUT_X_CONSTRAINTS_UNAVAILABLE
- REVOLUT_X_CONSTRAINTS_STALE
- POST_ONLY_NOT_ENFORCED
- TAKER_FALLBACK_NOT_DISABLED
- LEGACY_TAKER_POLICY_BLOCKED

**Post-only rejection:**
- POST_ONLY_REJECTED_REPRICE_REQUIRED

---

## 11. post_only obligatorio

- `executionInstruction: "post_only"` es el ÃƒÂºnico instruction usado
- BUY: cuantizar precio con `priceTickSize`, no cruzar, no market
- SELL: cuantizar precio, no reducir por debajo del target, no market
- Rechazo post_only Ã¢â€ â€™ `POST_ONLY_REJECTED_REPRICE_REQUIRED`, no fill, no PnL

---

## 12. takerFallback=false

- `takerFallbackAllowed` siempre `false` en `GridExecutionCapabilitySnapshot`
- `usedTakerFallback` siempre `false` en `GridOrderResult`
- Fase 2 (taker fallback) eliminada completamente de `gridExecutionService.placeOrder`
- `GRID_LEVEL_TAKER_FALLBACK` EventType mantenido en union solo para compatibilidad histÃƒÂ³rica

---

## 13. Fills exclusivamente getOrder/getFills

- No se infieren fills desde precio Kraken
- ConfirmaciÃƒÂ³n exclusivamente via Revolut X `getOrder()` / `getFills()`
- Sin confirmaciÃƒÂ³n: no abrir ciclo, no cerrar ciclo, no actualizar quantityFilled, no PnL

---

## 14. Archivos modificados

| Archivo | Tipo | Cambio |
|---------|------|--------|
| `server/services/MarketDataService.ts` | Modificado | +`MarketTickerSnapshot` interface, +`getFreshTickerSnapshot` method |
| `server/services/gridIsolated/gridIsolatedTypes.ts` | Modificado | +tipos REV-C12E (GridReferenceMarketSnapshot, GridExecutionCapabilitySnapshot, GridPlanningGate, reason codes) |
| `server/services/gridIsolated/gridIsolatedEngine.ts` | Modificado | tick() y rebuild usan MarketDataService, imports nuevos |
| `server/services/gridIsolated/gridExecutionService.ts` | Modificado | Eliminada fase taker fallback, solo post_only |
| `server/services/gridIsolated/gridExecutionMarketSnapshot.ts` | Modificado | Acepta source KRAKEN_MARKET_DATA |
| `server/services/botLogger.ts` | Modificado | +4 nuevos EventType |
| `server/services/__tests__/gridIsolatedEngine.test.ts` | Modificado | Tests REV-C12C actualizados a REV-C12E (mocks Kraken) |
| `server/services/gridIsolated/__tests__/gridCircuitBreakerV3.test.ts` | Modificado | Mock MarketDataService actualizado |
| `server/services/gridIsolated/__tests__/gridCycleOwnedV3Engine.test.ts` | Modificado | Test E-S3 actualizado para source binance |

## 15. Archivos nuevos

| Archivo | PropÃƒÂ³sito |
|---------|-----------|
| `server/services/gridIsolated/gridReferenceMarketResolver.ts` | Resolver mercado referencia Kraken |
| `server/services/gridIsolated/gridExecutionCapabilityResolver.ts` | Resolver capacidad ejecuciÃƒÂ³n Revolut X |
| `server/services/gridIsolated/gridPlanningContextResolver.ts` | Resolver contexto planificaciÃƒÂ³n ÃƒÂºnico |
| `server/services/gridIsolated/__tests__/gridReferenceMarketResolver.test.ts` | 15 tests |
| `server/services/gridIsolated/__tests__/gridExecutionCapabilityResolver.test.ts` | 12 tests |
| `server/services/gridIsolated/__tests__/gridExecutionServiceTakerFallback.test.ts` | 11 tests |

## 16. Archivos excluidos

- `server/services/exchanges/ExchangeFactory.ts` Ã¢â‚¬â€ NO modificado
- `server/services/exchanges/RevolutXService.ts` Ã¢â‚¬â€ NO modificado
- `server/services/institutionalDca/*` Ã¢â‚¬â€ NO modificado
- Momentum Ã¢â‚¬â€ NO modificado
- Telegram Ã¢â‚¬â€ NO modificado
- FISCO Ã¢â‚¬â€ NO modificado
- SPOT Ã¢â‚¬â€ NO modificado
- `shared/schema.ts` Ã¢â‚¬â€ NO modificado
- migrations Ã¢â‚¬â€ NO modificadas
- docker Ã¢â‚¬â€ NO modificado
- credenciales Ã¢â‚¬â€ NO modificadas

---

## 17. Tests REV-C12E

| Suite | Tests | Estado |
|-------|-------|--------|
| gridReferenceMarketResolver.test.ts | 15 | Ã¢Å“â€¦ |
| gridExecutionCapabilityResolver.test.ts | 12 | Ã¢Å“â€¦ |
| gridExecutionServiceTakerFallback.test.ts | 11 | Ã¢Å“â€¦ |
| gridIsolatedEngine.test.ts (REV-C12E block) | 14 | Ã¢Å“â€¦ |
| **Total nuevos** | **52** | Ã¢Å“â€¦ |

---

## 18. Matriz Grid completa

| MÃƒÂ©trica | Valor |
|---------|-------|
| Archivos | 22 |
| Tests | 507 |
| Fallidos | 0 |
| Pasados | 507 |

---

## 19. Validaciones

| Check | Resultado |
|-------|-----------|
| `npx tsc --noEmit` | Ã¢Å“â€¦ limpio |
| `npm run build` | Ã¢Å“â€¦ success |
| `git diff --check` | Ã¢Å“â€¦ sin whitespace errors |

---

## 20. Recuentos estÃƒÂ¡ticos finales (cÃƒÂ³digo productivo Grid)

| PatrÃƒÂ³n | Operativo | Comentarios | Tests | Total |
|--------|-----------|-------------|-------|-------|
| `revolutXService.getTicker` | **0** | 4 | 0 | 4 |
| `allow_taker` | **0** | 3 | 2 | 5 |
| `GRID_LEVEL_TAKER_FALLBACK` | **0** (EventType union) | 0 | 2 | 3 |
| `usedTakerFallback: true` | **0** | 0 | 0 | 0 |
| `_taker` IDs | **0** | 1 | 1 | 2 |
| `REVOLUT_X_TICKER` source | **0** | 0 | 1 (fixture) | 1 |
| `orderType: market` | **0** | 0 | 0 | 0 |

---

## 21. Estado

- **MERGE:** NO
- **DEPLOY:** NO
- **VPS:** NO
- **DB:** NO
- **Ãƒâ€œRDENES REALES:** 0
- **DEPLOY_AUTHORIZED:** FALSE
- **MIGRATION_REQUIRED:** FALSE

---

## 22. Riesgos pendientes

1. El error HTTP exacto del ticker Revolut X solo podrÃƒÂ¡ confirmarse tras desplegar la observabilidad REV-C12C en staging.
2. ~~`gridPlanningContextResolver.ts` estÃƒÂ¡ creado pero no integrado en el flujo productivo del engine~~ Ã¢â‚¬â€ **RESUELTO**: `resolveGridMarketAndConstraints` estÃƒÂ¡ integrado en `tick()` (lÃƒÂ­nea 1340) y `rebuildRangeAndLevels` (lÃƒÂ­nea 5034) como orquestador ÃƒÂºnico.
3. ~~El view model React no fue modificado para mostrar "Kraken como referencia"~~ Ã¢â‚¬â€ **RESUELTO**: `GridMarketPanel.tsx` ahora muestra "Fuente de precios: Kraken" y "Venue de ejecuciÃƒÂ³n: Revolut X" con tests UX dedicados.

---

## Veredicto

```
DONE: FALSE
HARD_BLOCKER: FALSE
TASK_STATUS: REV-C12E implementada localmente y validada; pendiente commit y verificaciÃƒÂ³n independiente
NEXT_ACTION: commit selectivo y revisiÃƒÂ³n independiente en GitHub
DEPLOY_AUTHORIZED: FALSE
MIGRATION_REQUIRED: FALSE
```

**APTO_PARA_COMMIT_REV-C12E_EN_RAMA_DE_REVISION**


---

## 23. Correcciones post-verificacion independiente (2026-08-04)

### 23.1 Orquestador unico real (resolveGridPlanningContext)

Problema: resolveGridMarketAndConstraints solo resolvia mercado + constraints, pero allocation, split, projection context y TTL se llamaban por separado.

Correccion: resolveGridPlanningContext ahora es el orquestador canonico unico que resuelve exactamente una vez: band, ticker Kraken, reference market, constraints Revolut X, execution capability, execution snapshot, allocation, split, projection context, TTL y gate. tick() y rebuildRangeAndLevels lo reutilizan.

### 23.2 Trazabilidad cache Kraken (CachedPrice provenance)

CachedPrice ahora incluye marketDataVenue y source. putPrice manual se marca MANUAL_OR_UNKNOWN y no se acepta como fuente Kraken.

### 23.3 Frescura y TTL unicos 45s

Default cambiado a 45_000. Validacion de maxAgeMs (finite, > 0).

### 23.4 Reference market fail-closed

Recalcula ageMs independientemente. Valida todos los campos fail-closed.

### 23.5 Execution capability fail-closed

expiresAt=null bloquea. Valida priceTickSize/quantityStep. isInitialized() se captura una vez.

### 23.6 Codigos Kraken/Revolut X diferenciados

REFERENCE_MARKET_* cuando fuente es Kraken. Nuevos codigos: REVOLUT_X_CONSTRAINTS_PAIR_MISMATCH, REVOLUT_X_PRICE_TICK_INVALID, REVOLUT_X_QUANTITY_STEP_INVALID.

### 23.7 UX sin fallbacks inventados

GridMarketPanel elimina fallbacks ?? "Kraken", ?? "Revolut X" y muestra "?" cuando no hay datos.

### 23.8 Validacion

- npm run check: limpio
- npm run build: success
- Matriz Grid (26 files, 734 tests): 0 failures
- Client Grid (5 files, 39 tests): 0 failures
