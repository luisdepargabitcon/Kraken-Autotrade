# SEGURIDAD DE EJECUCIÓN Y LOW_API — Issue #20 (Revisión 2, actualización TANGO)

Runtime auditado: `3ae1831` (md5 verificado, E-004). Fecha UTC 2026-11-27. SOLO LECTURA. No se ha invocado ninguna ruta mutativa ni se ha enviado ninguna orden.
Principio P0: **Kraken = solo datos. Revolut X = único venue de trading. SHADOW/simulación = nunca órdenes reales.**

> **Nota de saneamiento (TANGO):** el repositorio es público. Esta versión elimina el detalle operativo de red, topología y reproducción que figuraba en la primera publicación. El detalle necesario para la contención se trata con el propietario por canal privado. Los identificadores de hallazgos y la matriz de rutas se mantienen.

## 1. Estado efectivo (fuentes: DB read-only y entorno del contenedor, E-010…E-014)

| Parámetro | Valor runtime | Fuente |
|---|---|---|
| `api_config.trading_exchange / active_exchange / data_exchange` | revolutx / revolutx / kraken | DB read-only |
| Claves Kraken (presencia) | key y secret presentes; connected=t; enabled=t | DB (solo booleanos, sin valores) |
| Claves Revolut X (presencia) | presentes; connected=t; enabled=t | DB |
| `TRADING_ENABLED` | no definida → por defecto `true` en el código | entorno del contenedor |
| `bot_config` | is_active=t, dry_run_mode=t, spot_execution_mode=SHADOW | DB |
| IDCA | enabled=t, mode=live | DB |
| GRID BTC/USD | mode=SHADOW, execution_policy=MAKER_ONLY | DB |
| Exposición de red de la API | **la aplicación responde desde Internet sin autenticación** (verificado con una única lectura GET; detalle omitido a propósito) | E-012 (saneado) |
| Permisos de la clave Kraken (trade sí/no) | **NO_VERIFICADO** (solo lo puede confirmar el propietario en el panel de Kraken) | — |

## 2. Matriz completa de rutas de ejecución (análisis estático runtime `3ae1831` y `main`; sin invocar rutas mutativas)

Convención: **guard efectivo** = comprobación que realmente impide la orden en la configuración actual. **Alcanzabilidad** = si hoy, con la configuración efectiva, la ruta puede terminar en una orden real.

| # | Ruta / disparador | Guard efectivo hoy | Destino de la orden | Alcanzable hoy | Estado |
|---|---|---|---|---|---|
| R1 | `POST /api/trade` (market.routes.ts:278-330, idéntico en main) | Solo `TRADING_ENABLED` (indefinida → true) y `krakenService.isInitialized()` (=t) | **Kraken `placeOrder` directo** (sin ExchangeFactory) | **SÍ** — y la API no tiene autenticación (index.ts:30-60; auth solo en admin.routes y WS) | **P0 H-001** |
| R2 | `POST /api/config/active-exchange` → `setActiveExchange('kraken')` | Solo que la clave conste como conectada (=t) | Cambia el trading de **todos** los motores a Kraken | **SÍ** | **P0 H-003** |
| R3 | `POST /api/config/kraken` / `/api/config/revolutx` | Ninguno | Sustituye credenciales en caliente | **SÍ** | **P0 H-002** |
| R4 | `ExchangeFactory.getExchange('revolutx')` con RX no inicializado | Ninguno: `console.warn` y sigue | **Fallback silencioso a Kraken** en cualquier motor que use `getTradingExchange()` | Condicional (caída de init RX o `revolutx_enabled=false`) | **P0/P1 H-004** |
| R5 | `ExchangeFactory.initializeFromConfig` | Default `'kraken'` si la config no fuerza otro valor | Igual que R4 en arranque | Condicional | P1 H-004 |
| R6 | IDCA `executeExit` automático (IdcaEngine.ts:198-307) | **Ninguno por modo**: `placeOrder` (L232-233) se ejecuta con cualquier `mode`, incluido `simulation`. El único guard por modo es la verificación de balance, solo en live | `getTradingExchange()` (RX hoy; Kraken vía R4) | Hoy sin impacto visible porque IDCA está en `live` (las ventas reales son la operación prevista). **Defecto activo**: si el modo pasa a `simulation`, las salidas automáticas (TP/BE/TimeStop) seguirían enviando **ventas market reales** | **P0 latente H-005** — confirmado en código |
| R7 | IDCA compras/ventas live (`executeRealBuyWithGuard` ~4952, `executeRealSell` ~5195) | Validación de balance + `isInitialized` + confirmación de fill | `getTradingExchange()` = Revolut X (legítimo) | Sí — venta real observada 02:46Z (E-020) | OK (salvo R4) |
| R8 | `IdcaExecutionManager` (executeSimple/childOrders/TWAP, L174-300) | **Ninguno por modo** en el propio manager | `getTradingExchange()` | **NO alcanzable hoy**: importado pero sin ningún llamador operativo; solo se usa `generateExecutionDiagnostics` en `IdcaValidationService` (ruta `validation/run-full`) | Latente P1 — guard inexistente si se cablea |
| R9 | `IdcaExitExecutor` / `processTriggeredExitInstructions` (IdcaExitExecutor.ts:527+) | **Correcto**: `mode==="simulation"` → `executeSimulationSell` (contable, sin exchange); `live` → `executeLiveSell` | Según modo | Sí, y se comporta según el modo | OK — verificado en código; corrige el "NO_VERIFICADO" previo |
| R10 | `tradingEngine` legacy entradas/cierres (L6671, L7770) | `dryRunMode` (=t en DB) + entradas legacy deshabilitadas (supervisor-only, E-026) | `getTradingExchange()` | No para entradas; cierres manuales dependen de dryRun | OK con R4 |
| R11 | `POST /api/positions/:pair/buy` | `TRADING_ENABLED` + `confirm=true` + motor vivo | `tradingEngine.manualBuyForTest` → `getTradingExchange()` | Sin auth; bloqueado solo por el flag compartido | P1 (perímetro) |
| R11b | `POST /api/positions/:pair/close` | **Sin `TRADING_ENABLED` ni `confirm`** — solo posición existente y motor vivo; dentro, `forceClosePosition` sí consulta `dryRunMode` (=t hoy) | Venta real vía `getTradingExchange()` si dryRun=f | Asimetría de guards respecto a buy; hoy mitigado por dryRun=t. Nota: un cierre es acción de reducción de riesgo — ver §5 fase 2 para no romper la gestión legítima | P1 H-028 |
| R12 | `POST /api/trade/revolutx` (market.routes.ts:331-) | `TRADING_ENABLED` + allowlist de pares + RX init | **Revolut X real** | **SÍ, sin auth** | **P0 perímetro H-002** |
| R13 | GRID `gridExecutionService` (post-only, circuit breaker, límite diario) | Solo se invoca en modos `REAL_LIMITED`/`REAL_FULL` (gridIsolatedEngine.ts:5865); SHADOW nunca lo llama | Revolut X directo | **NO** — config efectiva SHADOW | OK por configuración; sin guard adicional si el modo cambia por API (`/api/grid-isolated/mode` sin auth) |
| R14 | GRID protective taker en SHADOW | — | Simulado | Sí (simulado) | P2 H-024 |
| R15 | AMA real (`amaRealExecutionGateway.executeRealOrder`) | 5 gates: feature flag `AMA_REAL_EXECUTION_ENABLED` + state machine + autorización + pre-trade gates + reserva portfolio | **Ninguno: el gateway no cablea la orden al exchange** — el propio código documenta que la integración con el exchange queda para una fase futura; además no hay ningún llamador de `executeRealOrder` fuera del gateway | **NO** | OK hoy; riesgo diferido a cuando se cablee |
| R16 | AMA shadow scenarios | n/a | Phantom fills (`amaShadowExecutor`) | Simulado | OK |
| R17 | SPOT V4 REAL (`spotEngine`) | **`REAL_ACTIVATION_ALLOWED = false` en compile-time** (spotEngine.ts:705-706) — activar REAL lanza error aunque se pida por API | `SpotRealAdapter` → `ExchangeFactory.getTradingExchange()` | **NO** (bloqueo estático) | OK hoy; si se habilita, hereda R4 |
| R18 | SPOT V4 SHADOW | — | `generatePhantomFill` — nunca llama al exchange | Simulado | OK |
| R19 | IDCA `manual-buy` / `close-manual` / `emergency close-all` / exit-instructions (rutas institutionalDca) | Por modo: simulation → contable; live → `executeRealSell` (correcto). Sin auth | Revolut X en live | Sí — gestión legítima de posiciones que la contención debe preservar (§5) | OK funcional / P1 perímetro |
| R20 | Telegram | Solo lecturas | — | — | OK |
| R21 | FISCO (`getLedgers`/`getTradesHistory` Kraken) | Lectura privada legítima | Kraken lectura | Sí | OK; exige mantener una clave Kraken con permiso Query |

**Consumidores web/APK (client/src):** la UI llama a `close-manual`, `manual-buy`, `emergency/close-all` (useInstitutionalDca.ts:750,966,1052) y a `/api/config/active-exchange` (Integrations.tsx:98). No se han encontrado llamadas UI a `/api/trade` (kraken) ni a `positions/:pair/buy|close`. No hay consumidor APK en este repo. Conclusión: las rutas mutativas de la UI son las de gestión IDCA y configuración de exchange — todas sin autenticación.

Observaciones de runtime (ventana 28,5 h, E-020): 1 orden real IDCA en Revolut X. 0 llamadas a `POST /api/trade`. Último trade en Kraken registrado: 2026-01-10 (origin=sync) (E-030).

## 3. GRID: referencia Kraken vs llamadas firmadas a Revolut X en SHADOW (H-006)

- La referencia de precio usa `MarketDataService.getFreshTickerSnapshot` (fail-closed, procedencia Kraken).
- **Pero** `gridCapitalAllocator.getTotalBalanceUsd` (gridCapitalAllocator.ts:64-88, idéntico en main) llama en cada planificación a `getTradingExchange().getBalance()` y `.getTicker("BTC/USD")` — es decir, GET firmados a Revolut X incluso en SHADOW. En la ventana: 5 715 GET firmados, el 100 % con 401 (E-021). El fallo de ticker se ignora y el capital se calcula solo con USD.
- Política efectiva: SHADOW → MAKER_ONLY, taker fallback off; protective taker usa el valor guardado (true) — efecto simulado (H-024).

## 4. LOW_API Revolut X — métricas observadas (MEDIDO, ventana ~28,5 h de logs Docker; E-021, E-022)

| Endpoint / evento | Recuento | Resultado | Atribución |
|---|---|---|---|
| orderbook/trades firmados (5 paths) | 5 715 | 401 Unauthorized (100 %) | GRID allocator (correlación de cadencia ~90 s con el bucle de planificación; atribución por correlación, no por contador) |
| `Balances fetched` | 1 167 | 200 | GRID allocator + otros consumidores (desagregación NO MEDIDA) |
| `getFills` | 210 + 66 | 401 / 429 | fill watcher (motor exacto NO VERIFICADO) |
| `listPrivateTrades` | 66 | 429 | sync de trades |
| `placeOrder` | 1 | ok | IDCA live |

- Implementación (H-007): la cola de rate-limit `scheduleRL` solo la usa `getBalance`; el resto llama a `fetch` directo; no se respeta `Retry-After`; hay circuit breaker parcial por endpoint.
- Límite de evidencia: Docker solo retiene ~28,5 h de logs; la ventana de 7 días pedida no existe en esta fuente y no se ha vuelto a acceder al VPS para buscarla.

## 5. Propuesta de contención y recuperación por fases (NO ejecutada — requiere autorización expresa del propietario por canal privado)

Principios: reversible en cada fase; **preservar la gestión legítima de posiciones** (IDCA live debe poder seguir vendendo en Revolut X; FISCO debe poder seguir leyendo Kraken); pruebas aisladas antes de cada cambio; sin desplegar `main` ni fusionar las ramas divergentes.

- **Fase 0 — decisiones del propietario (sin tocar el sistema):** confirmar permisos de la clave Kraken en el panel; decidir el canal de acceso remoto legítimo a la UI; autorizar la fase 1.
- **Fase 1 — perímetro (infra, sin código):** que la API deje de ser alcanzable desde Internet y el acceso remoto quede detrás de un canal autenticado. Verificación: lectura externa sin respuesta; lectura por el canal autorizado correcta. Reversible. Detalle técnico exacto por canal privado.
- **Fase 2 — credencial Kraken:** rotar la clave por una de **solo Query** (suficiente para datos y para FISCO). Verificación: lecturas FISCO siguen funcionando; cualquier intento de orden en Kraken es rechazado por el propio venue. Esto contiene R1/R4/R5 aunque el código no cambie. Precaución: no borrar la clave antes de confirmar que FISCO y los datos no dependen de permisos adicionales.
- **Fase 3 — código de contención (rama aparte, nunca merge directo a runtime):** guard de modo en `executeExit` (R6) y en `IdcaExecutionManager` (R8); `KRAKEN_EXECUTION_FORBIDDEN` en `krakenService.placeOrder/cancelOrder`; eliminar el fallback silencioso R4 (fail-closed con alerta); quitar `kraken` de active-exchange y de la UI; autenticación en rutas mutativas; guards simétricos en positions buy/close **sin impedir cierres de reducción de riesgo legítimos** (R11b: registrar y alertar, no bloquear ventas de salida en Revolut X).
- **Fase 4 — fail-closed de venue:** si Revolut X no está disponible no se abren órdenes nuevas (`VENUE_UNAVAILABLE`); reconciliación idempotente por `clientOrderId` con backoff y respeto de `Retry-After`; cola de salidas protectoras con alerta sin desviar a otro venue; SHADOW aislado por construcción.
- **Fase 5 — recuperación y convergencia de ramas:** plan para reconciliar `integration/staging-spot-v4` con `main` (101/43 commits divergentes) antes de cualquier despliegue; sin fecha ni ejecución en esta orden.
- Pruebas aisladas sugeridas (mocks, sin red): T1 placeOrder Kraken siempre rechazado; T2 fallback RX→Kraken imposible; T3 `executeExit(simulation)` 0 llamadas a placeOrder; T4 active-exchange kraken → 400; T5 SHADOW sin GET firmados RX; T6 429 con Retry-After espera ≥N s; T7 API no alcanzable desde fuera y sí por el canal autorizado.

## 6. Límites de evidencia declarados

- Permisos de la clave Kraken: NO_VERIFICADO (no se ha hecho ninguna llamada privada de prueba; lo confirma el propietario).
- IPv6: NO_VERIFICADO.
- Logs de 7 días: no disponibles en Docker; no se ha vuelto a acceder al VPS.
- Causa de los 17 529 reinicios: NO_VERIFICADO — no atribuir a ninguna causa concreta sin análisis de arranque.
- No se repetirá acceso a producción para completar estos puntos sin evaluación de seguridad previa; el análisis local y las evidencias existentes se han agotado primero, como pide TANGO.
