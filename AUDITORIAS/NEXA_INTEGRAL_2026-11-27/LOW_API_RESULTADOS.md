# LOW_API Revolut X — Resultados WP5

Fecha: 2026-11-27
Rama: `feature/nexa-integral-20261127`

## Alcance

WP5 implementa el diseño LOW_API para Revolut X sin contactar el venue real, sin DB real, sin credenciales y sin enviar órdenes. Toda la validación es local con `fetch` falso, relojes inyectados/falsos y mocks.

Commits de implementación:

- `9ddc5c3` — scheduler priorizado Revolut X.
- `cf28ed6` — migración de llamadas firmadas al scheduler.
- `b78f1c5` — endurecimiento de `BalanceCache`.
- `b0c4517` — valoración SHADOW sin consultas privadas propias.
- `1b64555` — `publicOnly` para constraints SHADOW y pruebas de workload ampliadas.

## Diseño implementado

### Scheduler común

Archivo: `server/services/exchanges/RevolutXRequestScheduler.ts`

Propiedades:

- concurrencia 1 para todas las llamadas firmadas;
- espaciado mínimo configurable (`REVOLUTX_MIN_TIME_MS`, 250 ms por defecto);
- cola por prioridad con envejecimiento para evitar inanición;
- cooldown global ante 429/503;
- `Retry-After` soportado en segundos y fecha HTTP;
- backoff exponencial acotado con jitter cuando no hay `Retry-After`;
- reloj, `sleep` y `random` inyectables;
- reintentos solo para GET idempotentes, máximo 2 reintentos;
- POST/DELETE nunca se reintentan;
- 401/403 no se reintentan y alimentan el circuit breaker existente por endpoint;
- single-flight opcional para GET concurrentes;
- métricas por endpoint y clase expuestas en `getRateLimiterStats()`.

### Tabla de clases

| Clase | Uso | Endpoints/métodos asignados |
|---|---|---|
| `P0_EXECUTION` | ejecución sensible a latencia | `placeOrder`, `cancelOrder` |
| `P1_RECONCILIATION` | verdad de órdenes/fills para conciliación | `getOrder`, `getFills`, `listPrivateTrades` |
| `P2_BALANCE` | balance de cuenta | `getBalance` |
| `P3_HISTORY` | histórico, metadata/configuración y market-data firmado | `getHistoricalOrders`, `configuration/pairs`, ticker/order-book/trades/OHLC firmados |

Excepción deliberada documentada: `configuration/pairs` no se reintenta dentro del scheduler porque tiene fallback público inmediato y los contratos/tests existentes exigen máximo una petición autenticada antes del fallback. El resto de GET firmados conserva la política acotada de reintento.

### Single-flight

- En el scheduler la clave es `método + ruta + query normalizada` (parámetros ordenados).
- Aplica a GET de lectura (`getOrder`, `getFills`, balance, histórico, trades y metadata firmada).
- No aplica a POST/DELETE.
- En balance existe además coalescing en `BalanceCache`; ambas capas son compatibles.

### BalanceCache

Archivo: `server/services/exchanges/BalanceCache.ts`

Cambios:

- `get()` ya no borra la entrada caducada; devuelve `null`, pero `getWithMeta()` conserva dato, edad real y `stale:true`.
- `invalidate()` incrementa una generación por exchange.
- Una petición en vuelo iniciada antes de invalidar no puede repoblar la caché ni compartirse con llamadas posteriores.
- Las llamadas posteriores a invalidar inician una petición de la nueva generación.
- `coalescedCalls` cuenta llamadas compartidas dentro de la generación correcta.
- El saldo `stale` no se usa para autorizar órdenes: `getBalance()` fuerza una petición fresca cuando la entrada caducó.

### Grid SHADOW

Archivo principal: `server/services/gridIsolated/gridCapitalAllocator.ts`

Cambios:

- La valoración BTC usa `MarketDataService.getPricePoint("BTC/USD")`, no ticker firmado de Revolut X.
- Solo se acepta precio con `validity === "valid"`, precio positivo y edad ≤ 5 minutos.
- Si el precio falta, es inválido o está obsoleto:
  - `valuationStatus === "partial"`;
  - `btcValuationReason` explica la causa;
  - el capital se calcula conservadoramente solo con USD;
  - se emite log/evento `GRID_CAPITAL_VALUATION_PARTIAL`.
- En modo `SHADOW`, el allocator no llama a `exchange.getBalance()`.
- En SHADOW usa únicamente `balanceCache.getWithMeta("revolutx")` si el snapshot existe y no está stale.
- Si no hay snapshot fresco, usa el capital de referencia ya existente de configuración (`gridWalletInitialUsd`), marca partial y emite `GRID_SHADOW_BALANCE_UNKNOWN`.
- El modo y el capital de referencia se pasan desde `gridPlanningContextResolver` y desde la ruta de auditoría/simulación del engine.
- Cuando la configuración es `mode:"SHADOW"`, el resolver pide constraints con `publicOnly:true`; se usa el endpoint público de configuración y no el endpoint autenticado `configuration/pairs`. REAL conserva la resolución autenticada con fallback público.

## Workload simulado

Archivo: `server/services/gridIsolated/__tests__/gridShadowLowApiWorkload.test.ts`

Escenario: 6 horas comprimidas con fake timers, un ciclo de planificación cada 5 minutos = 72 ciclos.

Resultados medidos en la ejecución local:

| Medición | Resultado |
|---|---:|
| Caracterización del comportamiento previo, una valoración directa por ciclo | 72 llamadas privadas de balance |
| WP5 SHADOW, 72 ciclos | 0 llamadas a `exchange.getBalance()` |
| WP5 SHADOW constraints, 72 resoluciones `publicOnly` | 0 llamadas firmadas a `/api/1.0/configuration/pairs`; 72 llamadas públicas de configuración |
| Ciclos con snapshot fresco inicial | 1 ciclo `complete` |
| Ciclos posteriores con snapshot stale en el workload comprimido | 71 ciclos `partial`, usando `gridWalletInitialUsd` |
| Snapshot fresco SHADOW con BTC | 0 fetches privados; usa precio público y total USD+BTC valorado |
| Precio BTC con edad > 5 min | `partial`, capital solo-USD |
| Precio BTC ausente/unknown | `partial`, capital solo-USD |

Interpretación: como el TTL de `BalanceCache` es 5 s y el ciclo simulado es de 5 min, el snapshot inicial queda stale en casi todo el workload. Esto es intencionalmente conservador: SHADOW no repuebla por sí mismo el balance y usa la referencia configurada cuando el snapshot compartido no está fresco. En producción un snapshot fresco solo puede proceder de actividad REAL/manual compartida, nunca de una consulta iniciada por planificación SHADOW.

## Inventario de consumidores privados relacionados con Grid

Revisión estática con grep de métodos privados (`getBalance`, `getOrder`, `getFills`, `listPrivateTrades`, `getHistoricalOrders`, `placeOrder`, `cancelOrder`):

| Consumidor | Hallazgo | Acción WP5 |
|---|---|---|
| `gridCapitalAllocator` | Antes valoraba con balance privado propio también en planificación | Corregido para SHADOW: snapshot/cache o referencia configurada |
| `gridModeLockService.runUnlockChecks()` | Llama `revolutXService.getBalance()` | No corregido: es verificación explícita para desbloquear REAL, no planificación SHADOW |
| `gridReconciliationRunner.snapshotBalance()` | Llama `revolutXService.getBalance()` al reconciliar | No corregido: reconciliación manual/operativa, no planificación SHADOW automática |
| `gridExecutionService` | Contiene `placeOrder`/`cancelOrder` reales | SHADOW no lo usa; no se encontraron llamadas productivas del engine SHADOW a este servicio |
| `FillWatcher` / trading engine spot | Polling privado de fills/órdenes tras órdenes reales | Fuera de planificación SHADOW del grid; ahora pasa por scheduler si usa RevolutXService |
| Rutas `market.routes.ts` de cartera/reconcile | Llamadas privadas explícitas iniciadas por usuario/operación | No son planificación SHADOW automática; no modificadas |
| Rutas `fisco.routes.ts` | Histórico Revolut X bajo demanda | Clasificado como `P3_HISTORY`; no modificado funcionalmente |

## Resultados de validación focalizada

- `revolutXRequestScheduler.test.ts`: 9/9.
- `balanceCacheConcurrency.test.ts`: 4/4.
- `gridShadowLowApiWorkload.test.ts`: 6/6.
- Batería focalizada final de 10 ficheros Revolut X/Grid: 243/243.
- `npx tsc --noEmit`: exit 0.
- Suite completa final: 7221 tests totales, 7142 passed, 43 failed preexistentes, 36 pending; 2131 suites, 2077 passed, 54 failed.
- Comparación contra `suite_wp4d.json`: 0 regresiones; 43 fallan en ambos con mensajes idénticos; 23 claves nuevas y 2 ausentes son artefacto de codificación/mojibake en dos nombres IDCA ya existentes, no eliminación funcional; 21 tests WP5 realmente nuevos.

## Matriz H-006/H-007

| Hallazgo | Estado WP5 | Evidencia |
|---|---|---|
| H-006 ticker/precio firmado usado en planificación Grid | Implementado en la ruta de valoración del allocator: precio BTC por contrato público `MarketDataService.getPricePoint`, con partial explícito si no es válido | `gridShadowLowApiWorkload.test.ts` |
| H-007 ráfagas/429 LOW_API | Implementado scheduler común, prioridades, cooldown, reintentos acotados, single-flight y BalanceCache generacional | `revolutXRequestScheduler.test.ts`, `balanceCacheConcurrency.test.ts` |

## Límites

- No se contactó Revolut X.
- No es una medición de producción ni de latencia real del venue.
- El workload es una simulación local comprimida; no prueba límites reales de la API.
- `configuration/pairs` conserva no-reintento por compatibilidad del fallback público ya establecido.
- La ausencia de fetch privado SHADOW depende de que el allocator y el resolver reciban `config.mode === "SHADOW"`; las rutas de planificación principales ya lo propagan.
- El endpoint público de configuración puede seguir consultándose en SHADOW; el objetivo medido es cero llamadas firmadas/privadas originadas por esa planificación, no cero tráfico público.

