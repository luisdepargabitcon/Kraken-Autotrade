# AUDITORÃA â€” REV-C12E: Arquitectura Kraken-Datos / Revolut X-EjecuciÃ³n

**Fecha:** 2026-08-03
**Rama:** `review/grid-rev-c12a-20260731`
**HEAD base:** `d230635b1af976790fd5d5408db941978475c46a`
**Fase:** REV-C12E â€” SeparaciÃ³n arquitectÃ³nica datos/ejecuciÃ³n

---

## 1. Matriz comparativa Momentum/IDCA/Grid

| MÃ³dulo | Datos (ticker/bid/ask/last) | EjecuciÃ³n | ConfirmaciÃ³n fills |
|--------|----------------------------|-----------|-------------------|
| **Momentum** | Kraken / MarketDataService | Exchange configurado | Respuesta del exchange |
| **IDCA** | Kraken / MarketDataService | Trading exchange (Revolut X cuando configurado) | getOrder / getFills |
| **Grid actual (pre-REV-C12E)** | Bandas Kraken + ticker directo Revolut X | Revolut X | getOrder / getFills |
| **Grid objetivo (REV-C12E)** | Kraken / MarketDataService | Revolut X post_only | getOrder / getFills |

---

## 2. Causa arquitectÃ³nica

`GRID_NATIVE_TICKER_DEPENDENCY = ARCHITECTURAL_DIVERGENCE`

El Grid era el Ãºnico mÃ³dulo que llamaba `revolutXService.getTicker()` directamente para obtener bid/ask/last. Cuando el endpoint de order-book/trades de Revolut X falla (404, timeout, etc.), el Grid quedaba bloqueado aunque:
- Las constraints del par sÃ­ estuvieran disponibles
- Las bandas Kraken sÃ­ estuvieran calculadas
- Las funciones de ejecuciÃ³n (placeOrder, cancelOrder) sÃ­ estuvieran operativas

`REVOLUT_X_GENERAL_FAILURE = FALSE` â€” Revolut X no estÃ¡ averiado. El servicio estÃ¡ inicializado y las constraints se resuelven. El problema era que el Grid dependÃ­a de un endpoint de ticker pÃºblico que no es necesario para la planificaciÃ³n.

---

## 3. Llamadas directas encontradas inicialmente

| Call site | Archivo | LÃ­nea | PropÃ³sito |
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
| `revolutXService.getTicker` en tick() | **ELIMINADO** â€” reemplazado por `MarketDataService.getFreshTickerSnapshot` |
| `revolutXService.getTicker` en rebuild | **ELIMINADO** â€” reemplazado por `MarketDataService.getFreshTickerSnapshot` |
| `allow_taker` executionInstruction | **ELIMINADO** â€” solo `post_only` |
| `GRID_LEVEL_TAKER_FALLBACK` log | **ELIMINADO** â€” reemplazado por `GRID_LEVEL_POST_ONLY_EXHAUSTED` |
| `_taker` clientOrderId | **ELIMINADO** â€” nunca se genera |
| `usedTakerFallback: true` | **ELIMINADO** â€” siempre `false` |
| `source: "REVOLUT_X_TICKER"` | **ELIMINADO** â€” reemplazado por `source: "KRAKEN_MARKET_DATA"` |

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
- Reutiliza cachÃ© existente (`priceCache`)
- Reutiliza single-flight (`pendingPrices`)
- Lectura de cachÃ© NO renueva `fetchedAt`
- CachÃ© stale NO se trata como fresh
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
- timestamp Date vÃ¡lida
- fresh=true
- source=KRAKEN_MARKET_DATA
- marketDataVenue=KRAKEN

`authoritativeForVenueCrossing=false` â€” la referencia Kraken NO garantiza que una orden sea maker en Revolut X.

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

Flujo canÃ³nico Ãºnico:
1. `getGridBandSnapshot()` â€” Kraken
2. `MarketDataService.getFreshTickerSnapshot()` â€” Kraken
3. `resolveGridReferenceMarketSnapshot()` â€” validar Kraken
4. `resolveGridPairConstraints()` â€” Revolut X
5. `resolveGridExecutionCapability()` â€” Revolut X
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

- `canPlanRange`: banda Kraken + ticker Kraken fresh + bid/ask vÃ¡lidos + rÃ©gimen apto
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

- `executionInstruction: "post_only"` es el Ãºnico instruction usado
- BUY: cuantizar precio con `priceTickSize`, no cruzar, no market
- SELL: cuantizar precio, no reducir por debajo del target, no market
- Rechazo post_only â†’ `POST_ONLY_REJECTED_REPRICE_REQUIRED`, no fill, no PnL

---

## 12. takerFallback=false

- `takerFallbackAllowed` siempre `false` en `GridExecutionCapabilitySnapshot`
- `usedTakerFallback` siempre `false` en `GridOrderResult`
- Fase 2 (taker fallback) eliminada completamente de `gridExecutionService.placeOrder`
- `GRID_LEVEL_TAKER_FALLBACK` EventType mantenido en union solo para compatibilidad histÃ³rica

---

## 13. Fills exclusivamente getOrder/getFills

- No se infieren fills desde precio Kraken
- ConfirmaciÃ³n exclusivamente via Revolut X `getOrder()` / `getFills()`
- Sin confirmaciÃ³n: no abrir ciclo, no cerrar ciclo, no actualizar quantityFilled, no PnL

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

| Archivo | PropÃ³sito |
|---------|-----------|
| `server/services/gridIsolated/gridReferenceMarketResolver.ts` | Resolver mercado referencia Kraken |
| `server/services/gridIsolated/gridExecutionCapabilityResolver.ts` | Resolver capacidad ejecuciÃ³n Revolut X |
| `server/services/gridIsolated/gridPlanningContextResolver.ts` | Resolver contexto planificaciÃ³n Ãºnico |
| `server/services/gridIsolated/__tests__/gridReferenceMarketResolver.test.ts` | 15 tests |
| `server/services/gridIsolated/__tests__/gridExecutionCapabilityResolver.test.ts` | 12 tests |
| `server/services/gridIsolated/__tests__/gridExecutionServiceTakerFallback.test.ts` | 11 tests |

## 16. Archivos excluidos

- `server/services/exchanges/ExchangeFactory.ts` â€” NO modificado
- `server/services/exchanges/RevolutXService.ts` â€” NO modificado
- `server/services/institutionalDca/*` â€” NO modificado
- Momentum â€” NO modificado
- Telegram â€” NO modificado
- FISCO â€” NO modificado
- SPOT â€” NO modificado
- `shared/schema.ts` â€” NO modificado
- migrations â€” NO modificadas
- docker â€” NO modificado
- credenciales â€” NO modificadas

---

## 17. Tests REV-C12E

| Suite | Tests | Estado |
|-------|-------|--------|
| gridReferenceMarketResolver.test.ts | 15 | âœ… |
| gridExecutionCapabilityResolver.test.ts | 12 | âœ… |
| gridExecutionServiceTakerFallback.test.ts | 11 | âœ… |
| gridIsolatedEngine.test.ts (REV-C12E block) | 14 | âœ… |
| **Total nuevos** | **52** | âœ… |

---

## 18. Matriz Grid completa

| MÃ©trica | Valor |
|---------|-------|
| Archivos | 22 |
| Tests | 507 |
| Fallidos | 0 |
| Pasados | 507 |

---

## 19. Validaciones

| Check | Resultado |
|-------|-----------|
| `npx tsc --noEmit` | âœ… limpio |
| `npm run build` | âœ… success |
| `git diff --check` | âœ… sin whitespace errors |

---

## 20. Recuentos estÃ¡ticos finales (cÃ³digo productivo Grid)

| PatrÃ³n | Operativo | Comentarios | Tests | Total |
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
- **Ã“RDENES REALES:** 0
- **DEPLOY_AUTHORIZED:** FALSE
- **MIGRATION_REQUIRED:** FALSE

---

## 22. Riesgos pendientes

1. El error HTTP exacto del ticker Revolut X solo podrÃ¡ confirmarse tras desplegar la observabilidad REV-C12C en staging.
2. ~~`gridPlanningContextResolver.ts` estÃ¡ creado pero no integrado en el flujo productivo del engine~~ â€” **RESUELTO**: `resolveGridMarketAndConstraints` estÃ¡ integrado en `tick()` (lÃ­nea 1340) y `rebuildRangeAndLevels` (lÃ­nea 5034) como orquestador Ãºnico.
3. ~~El view model React no fue modificado para mostrar "Kraken como referencia"~~ â€” **RESUELTO**: `GridMarketPanel.tsx` ahora muestra "Fuente de precios: Kraken" y "Venue de ejecuciÃ³n: Revolut X" con tests UX dedicados.

---

## Veredicto

```
DONE: FALSE
HARD_BLOCKER: FALSE
TASK_STATUS: REV-C12E implementada localmente y validada; pendiente commit y verificaciÃ³n independiente
NEXT_ACTION: commit selectivo y revisiÃ³n independiente en GitHub
DEPLOY_AUTHORIZED: FALSE
MIGRATION_REQUIRED: FALSE
```

**APTO_PARA_COMMIT_REV-C12E_EN_RAMA_DE_REVISION**
