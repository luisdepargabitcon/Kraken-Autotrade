# IDCA — Matriz de rutas de entrada/compra

Fecha: 2026-11-27 (WP7a; actualizado WP7b)
Alcance: rutas autónomas e importadas de **entrada/compra** IDCA en `server/services/institutionalDca/IdcaEngine.ts`. No cubre ventas salvo cuando un guard de venta pendiente bloquea una compra. No se han cambiado porcentajes, distancias ni pesos.

## Lectura común

- `evaluatePair` (`IdcaEngine.ts:1271`) es el despachador por par y modo.
- `performEntryCheck` es la evaluación de entrada inicial dentro de `checkEntry` (`IdcaEngine.ts:2009`).
- En `simulation` no se envía orden al exchange: se calcula fee/slippage simulados y se persisten ciclo/orden como simulados.
- En `live` las compras pasan por `executeRealBuyWithGuard` (`IdcaEngine.ts:5235`) y `submitAndReconcile` de `IdcaLiveOrderReconciler`; el ciclo o contabilidad solo se confirma tras fill reconciliado.
- Los guards repetidos en varias rutas son: par habilitado, modo, capital/exposición, cooldown, pending-exit y datos suficientes. La tabla indica la forma real encontrada; “—” significa que no existe guard explícito en esa ruta.

## Matriz

| Ruta | Función / archivo:línea | Guards de modo/capital/exposición/cooldown/pending-exit | Configuración efectiva que la gobierna | Ejecución | Cobertura de tests existente |
|---|---|---|---|---|---|
| Entrada inicial autónoma | `evaluatePair` `IdcaEngine.ts:1271` → `checkEntry` `IdcaEngine.ts:2009` → `performEntryCheck` | par desactivado pasa a exit-only; `mode` separa sim/live; datos OHLC/ancla; market score/contexto; distancia efectiva; rebote si `requireReboundConfirmation`; capital se dimensiona desde capital asignado; no hay cooldown de nueva entrada inicial equivalente al de safety; pending-exit se evalúa en ancla dinámica si hay ciclo, pero no aplica a una primera entrada sin ciclo | `entryMode`, `minDipPct`/resolver dinámico, `entryUiJson`, `dynamicDistanceConfigJson`, `vwapEnabled`, `requireReboundConfirmation`, `reboundMinPct`, sliders, market-score, capital global | live: `executeRealBuyWithGuard(..., "initial", cycleId=0)` y crea ciclo tras fill; simulation: fee/slippage simulados y `repo.createCycle` + `repo.createOrder` | parcial/indirecta: `idcaEngineGateE2E.test.ts`, `entryMode.test.ts`, `IdcaDistanceResolver.test.ts`, tests de VWAP/reference/config; no hay test directo completo de fill live inicial + creación de ciclo |
| Entrada inicial por observación | `checkEntry(..., observeOnly=true)` `IdcaEngine.ts:2009` | mismos guards de entrada inicial, pero si está permitido solo registra `entry_observed` y retorna | misma que entrada inicial | ninguna; explícitamente no ejecuta | parcial: aparece en tests de gates/diagnóstico, sin matriz exhaustiva de todos los bloqueos |
| Trailing buy VWAP principal | armado/seguimiento en `evaluatePair` (`IdcaEngine.ts` zona 1500-1760) → `checkEntry` con `trailingBuyEntry` | par habilitado; datos de velas suficientes y VWAP fiable; estado del `TrailingBuyManager`; distancia efectiva; umbral de rebote; overshoot máximo; stale reference; después sigue todos los guards de `performEntryCheck` | `trailingBuyConfig`/estado en memoria, `reboundMinPct`, sliders (`entryUiJson`), VWAP, distancia efectiva, `maxExecutionOvershootPct`; en `v2_candidate` se congela `resolveTrailingBuyCanonicalParams` | si dispara, entra por la misma ruta de entrada inicial: live reconciled o simulación | parcial: `IdcaTrailingBuyReferenceRefresh.test.ts`, `idcaTrailingBuyTelegramState.test.ts`, `idcaTrailingBuyCanonical.test.ts`, tests de dynamic rebound; hueco: ejecución end-to-end live/sim del trigger VWAP principal |
| Trailing buy nivel 1 / ladder ATRP | bloque `trailingBuyLevel1ConfigJson` en `evaluatePair` (zona 1771+) → entrada inicial si dispara | configuración habilitada, nivel objetivo, ladder ATRP si aplica, estado trailing, luego guards normales de entrada | `trailingBuyLevel1ConfigJson`, `ladderAtrpConfigJson`, distancia efectiva, VWAP/ATRP; en `v2_candidate` se congela `resolveTrailingBuyCanonicalParams` con trailing estático explícito de L1 | misma ejecución de entrada inicial | parcial: `idcaLadderAtrp.test.ts`; hueco: integración trigger L1 → compra real/simulada; parámetros canónicos unitarios en `idcaTrailingBuyCanonical.test.ts` |
| Safety buy principal | `manageCycle` → `checkSafetyBuy` `IdcaEngine.ts:3040` | máximo de compras; pending-exit explícito; cooldown `cooldownMinutesBetweenBuys`; precio ≤ `nextBuyPrice`; rebote si `requireReboundConfirmation`; exposición de módulo y activo; modo separa ejecución | `safetyOrdersJson`, `maxSafetyOrders`, `cooldownMinutesBetweenBuys`, `requireReboundConfirmation`, `reboundMinPct`, exposiciones globales, sizing adaptativo | live: `executeRealBuyWithGuard(..., "safety", cycle.id)` y actualiza ciclo tras fill; simulation: recalcula contabilidad simulada y crea orden | parcial: tests de reconciliación/guards/PNL y cooldown indirectos; hueco: tabla completa de todos los bloqueos y de la variante de rebote por call-site |
| PLUS activation | `evaluatePair` → `checkPlusActivation` `IdcaEngine.ts:5652` | main agotado si `requireMainExhausted`; máximo de plus por main; dip extra desde referencia de main; rebote mediante `getReboundStrength`; exposición por par; pending-exit explícito del main; modo separa ejecución | `plusConfigJson` (`getPlusConfig`), ladder/safety para definir agotamiento, capital allocation, max exposure, TP/trailing plus | live: `executeRealBuyWithGuard(..., "plus", cycleId=0)` y crea ciclo plus tras fill; simulation: crea ciclo/orden simulados | hueco relevante: no se encontró test directo específico de activación plus con todos los guards; solo cobertura indirecta de tipos/config |
| PLUS safety buy | `managePlusCycle` → `checkPlusSafetyBuy` `IdcaEngine.ts:6004` | máximo `maxPlusEntries`; cooldown entre compras plus; precio ≤ `nextBuyPrice`; modo separa ejecución; no hay guard pending-exit explícito en esta función (depende de gestión del ciclo padre) | `plusConfigJson`, `entryDipSteps`, cooldown plus, capital reservado del ciclo plus, TP adaptativo | live: `executeRealBuyWithGuard(..., "safety", plusCycle.id)`; simulation: actualiza ciclo y orden simulada | hueco: sin test directo localizado de plus safety buy |
| Recovery activation | `evaluatePair` → `checkRecoveryActivation` `IdcaEngine.ts:6934` | drawdown/disparador recovery; cooldown tras compra main; cooldown entre recovery; market score mínimo; capital disponible en simulación; rebote si configurado; pending-exit/gestión del main según flujo anterior | `recoveryConfigJson` (`getRecoveryConfig`), min market score, capital recovery, cooldowns, rebote, exposición | si pasa, `executeRecoveryEntry` `IdcaEngine.ts:7076`; live reconciled y simulation contable | parcial: hay tests de scope/reconciliación, pero hueco de matriz completa de activación recovery |
| Recovery safety buy | `manageRecoveryCycle` → `checkRecoverySafetyBuy` `IdcaEngine.ts:7365` | máximo de compras recovery, cooldown, nivel de siguiente compra, capital/exposición según config recovery; live reconciled | `recoveryConfigJson`, steps/distancias recovery, cooldowns, capital | live: `executeRealBuyWithGuard`; simulation: actualización simulada | hueco: sin test directo localizado de recovery safety buy |
| Posición importada — creación | `importPosition` `IdcaEngine.ts:698` | valida convivencia/ciclo activo y confirmación manual; no envía compra al exchange porque representa posición existente; modo viene en request | request de importación, `soloSalida`, asset config para ladder/safety, fee estimado | no ejecuta `placeOrder`; crea ciclo importado y metadatos | parcial: `idcaManualBuy.test.ts` e import-related tests de UI/API; hueco de reconciliación exhaustiva con exchange real |
| Posición importada — compras posteriores | `evaluatePair` gestiona `importedCycles` (`IdcaEngine.ts:1347`) y permite plus/recovery si `!soloSalida` | `soloSalida` bloquea compras adicionales; par desactivado bloquea compras; plus/recovery aplican sus propios guards | misma config plus/recovery y asset config | mismas rutas plus/recovery live/simuladas | parcial/indirecta; hueco de integración importada + plus/recovery |
| Híbrida/observador | `idcaHybridDecisionService.evaluate` en `evaluatePair` (`IdcaEngine.ts` zona 1479) y observer en ciclos | si modo híbrido real decide `block_buy`, se salta `checkEntry`; errores no fatales; observer read-only en ciclos activos | `idcaHybridDecisionService` y configuración híbrida | no ejecuta por sí mismo; bloquea o deja continuar la ruta autónoma | parcial: `idcaHybrid.test.ts`, `idcaHybridEventMapper.test.ts`; hueco de interacción completa hybrid+trailing+entry |
| Simulación vs live | ramas dentro de cada ejecución | live exige fill reconciliado; simulation calcula fee/slippage y persiste resultado simulado; no se mezclan contabilidades | `simulationFeePct`, `simulationSlippagePct`, config live/guards de ejecución | live: reconciler; simulation: escritura directa simulada | buena para reconciler unitario (`idcaLiveOrderReconciler.test.ts`, scope tests); hueco: matriz end-to-end por cada tipo de compra |

## Huecos principales de test

1. No existe una matriz end-to-end que recorra cada tipo de compra (`initial`, `trailing VWAP/L1`, `safety`, `plus`, `plus safety`, `recovery`, `recovery safety`) en ambos modos.
2. Los guards están testeados de forma dispersa; no hay tabla de verdad única de cooldown + exposición + capital + pending-exit por ruta.
3. `detectRebound` se usa en contextos heterogéneos y algunos call sites descartan `open`; antes de WP7a no había test de paridad call-site por variante.
4. PLUS y recovery safety tienen la cobertura más débil localizada.
5. Las rutas importadas tienen cobertura de creación/importación, pero menos cobertura de compras posteriores gestionadas.


## Actualización WP7b — confluencia y fuente canónica de trailing buy

### Confluencia explícita

- `resolveIdcaEntryPolicy` incorpora `confluenceEnforcement: "diagnostic" | "enforced"`.
- El default productivo es `diagnostic`; `enforced` solo sobrevive con `version: "v2_candidate"` en `simulation`, `shadow` o `replay`. En `live` o modo desconocido se fuerza `diagnostic` con warning.
- En `enforced`, `WATCH` añade `confluence_watch`; `ARM_TRAILING` arma el `TrailingBuyManager` existente y bloquea la compra directa con `confluence_arm_trailing` hasta que el trailing gatilla; cuando la evaluación ya viene de `trailingBuyEntry`, ese bloqueo no se re-aplica; `NORMAL_ENTRY` y `HIGH_CONFIDENCE_ENTRY` no añaden bloqueo.
- `DEFENSIVE_SAFETY_BUY` solo es admisible en la ruta `checkSafetyBuy`; si aparece en entrada inicial se trata como `WATCH`. Nunca elimina hard gates ni bloqueos de datos, precio, exposición o límites de safety.
- Cobertura: `idcaConfluenceEnforcement.test.ts` (21 tests) cubre clases × diagnóstico/enforcement × simulation/live, hard gates, exposición, entrada inicial y safety.

### Trailing buy canónico

- Nueva función pura `resolveTrailingBuyCanonicalParams` en `IdcaTrailingBuyCanonical.ts` produce una única estructura con `minPrice`, `effectiveThresholdPct`, `mode`, `reference`, `maxExecutablePrice`, `validUntil` y `reason`.
- En `v2_candidate`, el armado VWAP, el armado Level 1 y el armado por confluencia `ARM_TRAILING` calculan esa estructura una vez y `TrailingBuyManager` la reutiliza al seguir, disparar y revalidar.
- `static` conserva un trailing porcentual fijo y usa un máximo ejecutable acotado sobre la activación; `dynamic` delega en `resolveIdcaDynamicRebound` y congela el resultado. No se mezclan simultáneamente umbrales estáticos y dinámicos en el estado canónico.
- Un disparo canónico queda reservado con `pendingTrigger` antes de la revalidación de entrada. Si `performEntryCheck` añade cualquier bloqueo, se libera la reserva y el trailing permanece armado; si la compra se completa, se confirma y consume una sola vez. Si la ejecución live falla antes de crear ciclo, también se libera. Esto evita duplicados síncronos simples y no persigue precio ni amplía el máximo.
- Expiración por `validUntil` cancela el estado. Armar dos veces con el mismo trailing canónico es idempotente y no crea un segundo estado.
- Persistencia real: la migración/tabla `030_idca_trailing_buy_state` corresponde en el código actual a `idca_trailing_buy_telegram_state`, una tabla de anti-spam/notificaciones Telegram. Contiene `armedAt`, `triggerPrice` y `localLow`, pero no contiene la estructura canónica completa ni el estado ejecutivo del `TrailingBuyManager`. Por tanto **no es persistencia suficiente del trailing ejecutivo**. Como WP7b prohíbe migraciones, no se habilitó recuperación real desde DB. Se añadieron `serializeState`/`restoreState` y test de reinicio simulado en memoria para fijar la semántica esperada (válido se restaura, expirado se descarta), pero no se afirma persistencia real entre procesos.
- Cobertura: `idcaTrailingBuyCanonical.test.ts` (12 tests) cubre parámetros únicos, static/dynamic, validación, idempotencia, precio sobre máximo, reserva/confirmación/liberación, expiración, reinicio simulado y golden legacy. `IdcaTrailingBuyReferenceRefresh.test.ts` e `idcaExecutionScopeFlow.test.ts` siguen verdes.

## Nota de seguridad

Esta matriz es inventario. No implica activación de variantes ni cambios de comportamiento. WP7a mantiene la política por defecto en `legacy`.

## Actualización WP7c — plan efectivo ATRP y exposición con intenciones pendientes

### ATRP vs `safetyOrdersJson`

Hallazgo: antes de WP7c el ladder ATRP se usaba para visualización/trailing en algunas rutas, pero la creación de ciclo y `checkSafetyBuy` seguían dimensionando y programando compras desde `safetyOrdersJson` o pesos de perfil. La discrepancia queda cuantificada en `idcaAtrpEffectivePlan.test.ts`: con ancla 100 y ATRP 2/4/6 %, el primer safety ATRP es 4 %/96, mientras un `safetyOrdersJson` legacy de 3 % produciría 97; con distribución 33.33/33.33/33.33 el redondeo canónico queda 33.33/33.33/33.34 y suma exactamente 100.

Cambio aislado: solo cuando `resolveIdcaEntryPolicy` resuelve `version="v2_candidate"` en simulation/shadow/replay y `ladderAtrpEnabled` está activo, el motor calcula un plan completo ATRP con `includeInactiveLevels` y lo usa como fuente efectiva de:

- distancia del nivel base (`level=0`) en `performEntryCheck`;
- pesos de base y safety en `checkEntry`/`checkSafetyBuy`;
- trigger y porcentaje del siguiente nivel safety persistidos en `nextBuyPrice`/`nextBuyLevelPct`;
- número máximo efectivo de compras del ladder.

En esa variante el resolver dinámico/confluencia no reemplaza la distancia ATRP; legacy sigue usando exactamente `safetyOrdersJson`, pesos de perfil y overlays previos. Cobertura: `idcaAtrpEffectivePlan.test.ts` (4 tests) y casos ATRP iniciales/safety en `idcaConfluenceEnforcement.test.ts` (total del archivo 23 tests).

### Pesos, reserva, mínimo de orden, fills parciales y pendientes

- Pesos: `normalizeAtrpLevelWeightsTo100` normaliza a 100 % con redondeo de 2 decimales y ajuste residual en el último nivel; test incluye distribución incompleta 20/30/40 ⇒ 22.22/33.33/44.45.
- Reserva: el sizing v2 usa `capitalReservedUsd` del ciclo y los pesos ATRP efectivos; el test safety reproducible usa reserva 1000, nivel 1=33.33 %, precio 95 ⇒ cantidad 3.508421 BTC aproximada y siguiente nivel 6 %/94.
- Mínimo de orden y ajuste de capital live siguen delegados en `liveGuard.validateLiveBuyIntention`; no se cambiaron.
- Fills parciales/idempotencia siguen cubiertos por `idcaLiveOrderReconciler.test.ts`: aceptación sin fill, rechazo terminal, uncertain, parcial→fill, dedupe de fills, misma `intentKey` una sola llamada y recuperación tras reinicio.
- Exposición con órdenes pendientes: brecha no cerrada. Los guards de exposición actuales suman principalmente `capitalUsedUsd` de ciclos activos; no incorporan de forma general el valor residual de `order_intents` en `submitting/accepted_pending/uncertain/partial` antes de su aplicación. El reconciliador sí impide reenvío idempotente y bloquea una segunda orden del mismo ciclo+lado+par (`IDCA_ORDER_SCOPE_PENDING`), pero eso no equivale a incluir el pendiente en exposición global. No se implementó en WP7c porque los intents son live-only mientras la política experimental exige simulation/shadow/replay, y una corrección global cambiaría comportamiento productivo legacy prohibido. Además el intent no almacena precio/quote objetivo fiable para valorar el remanente sin introducir una nueva migración o contrato. Queda documentado como hueco explícito.

### Override VWAP mensual `aggressive_quality`

El override existente no fue activado ni modificado funcionalmente; solo se extrajo a helper puro para documentarlo numéricamente. Si VWAP mensual=100 y precio=94.99, el sesgo es `aggressive` y fuerza `aggressive_quality`; el primer tramo pasa de 15 % (`defensive`) a 30 %, es decir duplica la base prevista por el perfil de riesgo. En el borde exacto 95 no aplica el override agresivo (`<95` estricto); entre 95 y 100 conserva el perfil previo con sesgo `balanced`; en 100 o más fuerza `defensive`. Esto confirma que el descuento mensual puede anular el perfil prudente derivado del market score y permitir una compra mayor de la que el riesgo indicaría. Queda descrito como candidato de ensayo separado, sin activación.
