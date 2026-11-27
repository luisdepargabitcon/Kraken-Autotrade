# SEGURIDAD DE EJECUCIÓN Y LOW_API — Issue #20 (Revisión 2)

Runtime auditado: `3ae1831` (md5 verificado, E-004). Fecha UTC 2026-11-27. SOLO LECTURA. No se ha invocado ninguna ruta mutativa ni se ha enviado ninguna orden.
Principio P0: **Kraken = solo datos. Revolut X = único venue de trading. SHADOW/simulación = nunca órdenes reales.**

## 1. Estado efectivo (E-010, E-011, E-013, E-014)

| Parámetro | Valor runtime | Fuente |
|---|---|---|
| `api_config.trading_exchange / active_exchange / data_exchange` | revolutx / revolutx / kraken | DB read-only |
| Claves Kraken (presencia) | key=presente, secret=presente, connected=t, enabled=t | DB (solo booleanos) |
| Claves Revolut X (presencia) | presentes, connected=t, enabled=t | DB |
| `TRADING_ENABLED` | **no definida → por defecto `true`** | env del contenedor (solo esta variable) |
| `bot_config` | is_active=t, dry_run_mode=t, spot_execution_mode=SHADOW | DB |
| IDCA | enabled=t, **mode=live** | DB |
| GRID BTC/USD | mode=SHADOW, execution_policy=MAKER_ONLY, taker_fallback_enabled=t (guardado), protective_taker_fallback_enabled=t | DB |
| Puerto app | 0.0.0.0:3020→5000, **accesible desde Internet (HTTP 200 en `/`)** | ss + 1 GET externo a `/` |
| Permisos de la clave Kraken (trade sí/no) | **NO_VERIFICADO** (requiere llamada privada o panel) | — |

## 2. Matriz de rutas de ejecución (runtime 3ae1831)

| # | Ruta / disparador | Modo | Guard antes de la llamada mutativa | Destino real | Fallback | Alcanzable hoy | Prueba | Estado |
|---|---|---|---|---|---|---|---|---|
| R1 | `POST /api/trade` (market.routes.ts:278-330) | cualquiera | TRADING_ENABLED (por defecto true), `krakenService.isInitialized()` | **Kraken addOrder** | — | **SÍ: red pública + sin auth + claves presentes** | estática + red (no invocado) | **P0 H-001** |
| R2 | `POST /api/config/active-exchange` (routes.ts:587-) → `ExchangeFactory.setActiveExchange('kraken')` | — | `krakenConnected` (=t) | cambia el trading a Kraken para todos los motores | — | **SÍ** | estática | **P0 H-003** |
| R3 | `POST /api/config/kraken` / `/api/config/revolutx` | — | ninguno | sustituye las credenciales | — | SÍ | estática | P0 (H-002) |
| R4 | `ExchangeFactory.getExchange('revolutx')` (ExchangeFactory.ts:37-51) | todos | `revolutXService.isInitialized()` | **Kraken si RX no inicializado** | silencioso (console.warn) | condicional: arranque sin claves RX, `revolutx_enabled=false` o fallo de init | estática | P0/P1 H-004 |
| R5 | `initializeFromConfig` (ExchangeFactory.ts:168-212) | arranque | `exchangeEnabled[tradingEx]` + init | por defecto `'kraken'` si la config no indica otro o RX deshabilitado | — | condicional | estática | P1 H-004 |
| R6 | IDCA `executeExit` (IdcaEngine.ts:198-307) | live **y simulation** | ninguno por modo antes de placeOrder (L232-233) | getTradingExchange() (RX hoy) | R4 | hoy no (IDCA live); sí si el modo pasa a simulation | estática + DB (0 órdenes sim con id) | **P0 latente H-005** |
| R7 | IDCA buy/sell live (IdcaEngine.ts:~4950, ~5195) | live | validación de balance + isInitialized | getTradingExchange() | R4 | sí (legítimo, RX) | runtime: 1 venta RX 02:46Z | OK con R4 |
| R8 | IdcaExecutionManager.executeSimple (L174-) | importado por Engine/Cleanup/Validation | NO_VERIFICADO el modo en todos los llamantes | getTradingExchange() | R4 | NO_VERIFICADO | estática parcial | pendiente |
| R9 | IdcaExitExecutor (L76, L188) vía `processTriggeredExitInstructions` + ruta institutionalDca | NO_VERIFICADO | NO_VERIFICADO | getTradingExchange() | R4 | NO_VERIFICADO | — | pendiente |
| R10 | tradingEngine.executeTrade / cierre manual (L6671, L7770) | SPOT legacy | `dryRunMode` antes (L6336, L7663) | getTradingExchange() | R4 | dryRun=t; entradas legacy deshabilitadas | estática + log | OK con R4 |
| R11 | `POST /api/positions/:pair/buy` y `/close` | — | TRADING_ENABLED + motor (dryRun) | getTradingExchange() | R4 | sin auth | estática parcial | P1 (perímetro) |
| R12 | `POST /api/trade/revolutx` (market.routes.ts:331-) | — | TRADING_ENABLED, allowlist de pares, RX init | **Revolut X real** | — | **SÍ, sin auth** | estática | P0 perímetro (H-002) |
| R13 | GRID `gridExecutionService.placeOrder` (post_only) | REAL | circuit breaker, límite diario | Revolut X | — | **no: el servicio no está importado en ningún sitio** | estática (git grep) | OK |
| R14 | GRID SHADOW protective taker | SHADOW | — | simulado (`[SHADOW]`) | — | sí (simulado) | estática | P2 H-024 |
| R15 | Telegram (`telegram.ts:1319, 1445`) | — | solo lecturas (balance, ticker Kraken) | — | — | — | estática | OK (lectura) |
| R16 | FISCO (`krakenService.getLedgers/getTradesHistory`) | — | lecturas privadas legítimas | Kraken (lectura) | — | sí | estática | OK; exige la clave Kraken con permiso Query |

Observaciones de runtime (28,5 h, E-020): 1 orden real IDCA en Revolut X (final_sell, estado filled→pendingFill→reconciliada). 0 llamadas a `POST /api/trade`. Último trade en Kraken registrado: 2026-01-10 (origin=sync) (E-030).

## 3. GRID: referencia Kraken vs ejecución Revolut X (REV-C12E/G)

- Referencia: `MarketDataService.getFreshTickerSnapshot` (fail-closed, procedencia KRAKEN_MARKET_DATA). En los logs aparece `source=GRID_ISOLATED`, `ticker_last`, mode SHADOW (E-023).
- **Pero** `gridCapitalAllocator.getTotalBalanceUsd` (gridCapitalAllocator.ts:64-88@3ae1831, idéntico en main) llama a `ExchangeFactory.getTradingExchange().getBalance()` y `.getTicker("BTC/USD")` de Revolut X dentro de `allocate()`, que se invoca desde `gridPlanningContextResolver` en cada planificación. Es una reintroducción indirecta de `getTicker` de Revolut X en el bucle GRID (H-006).
- Política efectiva: `getEffectiveExecutionPolicy` SHADOW→MAKER_ONLY y `getEffectiveTakerFallbackEnabled` SHADOW→false. En cambio `getEffectiveProtectiveTakerFallbackEnabled` SHADOW→valor guardado (true) y REAL→false (gridIsolatedTypes.ts:133-139, 206-223). El efecto es que el taker protector simulado está activo en SHADOW (H-024). Esto no existe en main.

## 4. LOW_API Revolut X — métricas observadas (MEDIDO, ventana 2026-11-26T07:43:58Z → 2026-11-27T12:1xZ, ~28,5 h, logs Docker; E-021, E-022)

| Endpoint / evento | Recuento | Código | Motor probable |
|---|---|---|---|
| `/api/1.0/order_book/BTC-USD`, `/orderbook/BTC-USD`, `/trades/BTC-USD`, `/trades/public/BTC-USD`, `/trades/public/BTC-USD/last` | 1 143 cada uno (5 715) | **401 Unauthorized (100 %)** | GRID allocator (H-006) |
| `Balances fetched` | 1 167 | 200 | GRID allocator + otros |
| `getFills(/fills)` | 210 | 401 "Unauthenticated access" | IDCA/fill watcher (NO_VERIFICADO) |
| `getFills` | 66 | 429 | IDCA |
| `listPrivateTrades` | 66 | 429 | sync de trades |
| `placeOrder` | 1 | ok | IDCA live |

- Cadencia: unas 40 rondas de ticker por hora, es decir, una cada ~90 s.
- Total estimado: ≥7 000 peticiones privadas firmadas en 28,5 h, y más del 80 % fallaron.
- Implementación (H-007):
  - `scheduleRL` (RevolutXService.ts:486-514) serializa con un mínimo de 250 ms, pero **solo lo usa `getBalance`** (L527).
  - `signedGetJson`, órdenes, fills y trades llaman a `fetch` directamente.
  - No se trata la cabecera `Retry-After`.
  - Hay circuit breaker por endpoint (L182-331) de uso parcial.
- No hay contadores persistentes por endpoint, así que el volumen por motor es NO MEDIDO (solo correlación de logs).

## 5. Propuesta de contención (REQUIERE AUTORIZACIÓN SEPARADA — no ejecutada)

Orden de menor a mayor impacto. Todas son reversibles:
1. **Perímetro (sin tocar código):** publicar el puerto solo en loopback (`127.0.0.1:3020:5000` en compose) o corregir DOCKER-USER con `-m conntrack --ctorigdstport 3020 --ctdir ORIGINAL -j DROP`, y verificar también IPv6. Acceso remoto por túnel SSH o proxy con autenticación. Reversible al quitar la regla.
2. **Kill-switch de Kraken:** `TRADING_ENABLED=false` no sirve como kill-switch solo para Kraken, porque el flag es común y también bloquearía Revolut X (`/api/trade/revolutx`, posiciones). La medida equivalente sin código es retirar o rotar la clave Kraken por una con permisos **solo Query** (consulta de fondos y ledgers para FISCO). La decide el propietario en el panel de Kraken.
3. **Código (fase posterior):**
   - `KRAKEN_EXECUTION_FORBIDDEN` en `krakenService.placeOrder/placeOrderRaw/cancelOrder`.
   - ExchangeFactory sin fallback y con `tradingExchange` restringido a `revolutx`.
   - Quitar `kraken` del endpoint active-exchange y del botón de Integrations.
   - Guard `mode==="live"` dentro de `executeExit`.
   - Autenticación en `/api` mutativo.
4. **Fail-closed sin Revolut X:**
   - Si Revolut X no está disponible, no se crean órdenes nuevas (`VENUE_UNAVAILABLE`).
   - Las órdenes pendientes y los fills se reconcilian por `clientOrderId` de forma idempotente, con backoff.
   - Las salidas protectoras quedan en cola con alerta y no se desvían a otro venue.
   - SHADOW queda aislado por construcción: no importa adaptadores de ejecución.

## 6. Pruebas sugeridas (locales, con mocks y sin red)

- T1: `krakenService.placeOrder` lanza error siempre (incluido con `TRADING_ENABLED=true`).
- T2: `ExchangeFactory.getExchange('revolutx')` con RX no inicializado → error, nunca Kraken.
- T3: `executeExit(mode="simulation")` → 0 llamadas a `placeOrder` (spy).
- T4: `POST /api/config/active-exchange {kraken}` → 400.
- T5: `gridCapitalAllocator.allocate` en SHADOW → 0 llamadas a `revolutXService.getTicker` (spy).
- T6: scheduler RX: 429 con `Retry-After: N` → la siguiente petición espera ≥N s.
- T7 (infra): GET externo a :3020 → timeout. GET por túnel → 200.
