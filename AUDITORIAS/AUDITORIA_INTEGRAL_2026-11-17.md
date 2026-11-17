# AUDITORÍA INTEGRAL INICIAL — NEXA / Kraken-Autotrade
**Fecha:** 2026-11-17 (Europe/Madrid)  
**Repositorio:** https://github.com/luisdepargabitcon/Kraken-Autotrade  
**Rama auditada:** `main`  
**Commit base comprobado en GitHub:** `9ca8506336b331a10da9f496b743ca4788cbfbfc` (2026-08-30)  
**Estado:** INFORME FORENSE ESTÁTICO + EVIDENCIA VISUAL, **SIN VALIDACIÓN RUNTIME**.  
**Operativa:** cero órdenes, cero cambios de código/configuración/DB/VPS, cero despliegues. El único cambio autorizado es incorporar este informe documental a GitHub.

> **Alcance y honestidad:** se inspeccionó el árbol completo del repositorio y, de forma focalizada, los motores SPOT, IDCA, Grid, rutas HTTP, Docker, guardas de riesgo, salida y documentación. No se hizo ejecución de pruebas ni lectura de DB/logs en vivo: la conectividad SSH al VPS no estuvo disponible desde esta sesión. Una auditoría funcional completa requiere cotejar el commit realmente desplegado y los historiales operativos; este documento **no certifica la versión en ejecución** ni la seguridad de la exposición externa.

## 1. Evidencia aportada por el usuario
- Pantalla **SPOT**: 167 operaciones, acierto 28,1 %, `profit factor=0,68`, PnL histórico **−845,01 USD**. Entradas etiquetadas `V4 SOFT QUALITY`; historial visible de salidas por «Pérdida estructura», «Eficiencia temporal» y «EMERGENCY», con pérdidas de ~0,5 % a ~3,5 % en las filas mostradas.
- Pantalla **IDCA / DCA Inteligente**: BTC y ETH activos, **SIMULATION**, 0 compras, 0 ciclos activos, capital asignado 2.000 USD; BTC caída 2,72 % y ETH 2,66 % frente a requisito mostrado 1,30 %, mensaje «Falta confirmación de rebote».
- Historial **IDCA**: 31 ciclos, 26 ganadores, 2 perdedores, 3 neutrales, **PnL total −445,92 USD**. La alta proporción de ciclos ganadores no compensa las pérdidas agregadas: auditar magnitud de pérdidas, comisiones y motivos.
- **Grid:** el usuario observa búsqueda repetida de niveles/rangos sin apertura de compras. No se aportó un log de bloqueo por tick en esta solicitud.
- **Advertencia temporal:** las capturas no prueban que los números correspondan a un único corte contable ni que la versión desplegada sea idéntica al repositorio. No sumar PnL de motores como si fueran un solo libro mayor.

## 2. Veredicto ejecutivo
**NO APTO PARA APROBACIÓN DE NUEVA OPERATIVA REAL hasta corregir o descartar P0/P1.** La pérdida SPOT es real en el historial presentado; el mecanismo exacto de cada cierre requiere reconstruir operaciones. IDCA y Grid presentan rutas de bloqueo demostrables en código; no es correcto deducir que todas sean bugs: varias son guardas deliberadas, pero su combinación y diagnóstico son problemáticos.

### Hallazgos priorizados

| ID | Gravedad | Hallazgo | Estado |
|---|---|---|---|
| SEC-01 | **P0** | Configuración de despliegue con secretos por defecto públicos, puertos publicados y ausencia de capa de autenticación visible en rutas mutadoras | Confirmado en código; alcance externo sin verificar |
| SEC-02 | **P0** | Socket Docker accesible dentro del contenedor de aplicación; registro indiscriminado de respuestas JSON de API | Confirmado en código; explotación no comprobada |
| OPS-01 | **P0** | GitHub main termina 2026-08-30; no se pudo comprobar SHA runtime; pantalla SPOT presenta etiquetas/versiones no localizadas en el motor consultado | Divergencia a resolver; no afirmar identidad runtime |
| SPOT-01 | **P1** | Smart Exit puede liquidar por score con PnL negativo; usa PnL bruto y no aplica el gate económico del ExitManager en su ruta de venta | Confirmado en código; uso en runtime no verificado |
| SPOT-02 | **P1** | Smart Exit backfillea contexto de entrada histórico con datos de mercado actuales y un recuento supuesto, pudiendo distorsionar «deterioro» | Confirmado en código |
| SPOT-03 | **P1** | Asimetría de rentabilidad: 167 operaciones, PF 0,68; requiere análisis de MFE/MAE, stop, trailing, coste y motivos por trade | Confirmado visualmente; causa individual pendiente |
| IDCA-01 | **P1** | Múltiples veto-gates en serie: dip, rebote, confirmación confluencia, precio máximo de ejecución, VWAP/score/saldo; puede haber 0 compras aun con dip suficiente | Confirmado en código |
| IDCA-02 | **P1** | `smartAdjustmentEnabled=false` descrito como «solo diagnóstico», pero un `NO_ENTRY` de confluencia sigue añadiendo bloqueo efectivo | Confirmado en código; decisión de producto por aclarar |
| IDCA-03 | **P1** | En el caso límite, trigger del rebote supera el precio máximo permitido: ventana de ejecución vacía hasta alcanzar un suelo más profundo | Posibilidad matemática demostrada, frecuencia runtime desconocida |
| IDCA-04 | **P2** | Estado de trailing-buy guardado en `Map` en memoria, sin restauración persistida identificada en el componente | Confirmado en el componente, recuperación global por verificar |
| GRID-01 | **P1** | Un `bandSnapshot=null` termina el tick ANTES de procesar SELL de ciclos SHADOW abiertos, pese a la garantía declarada de priorizar salidas | Confirmado en código |
| GRID-02 | **P1** | El permiso de crear rangos exige varios orígenes frescos/validados, asignación, split, proyección y TTL; sin desglose por tick en runtime es imposible saber qué frena cada compra | Confirmado en código; motivo actual pendiente |
| GRID-03 | **P2** | Bloqueo histórico por régimen `moderate` está corregido en main; verificar versión desplegada y que no se trate de recaída | Corrección confirmada en main |
| REPO-01 | **P2** | Gran cantidad de archivos operativos/adjuntos y duplicidades de blobs bajo control de versiones | Confirmado en árbol |
| QA-01 | **P1** | No existe evidencia de pruebas completas SPOT/IDCA/Grid posteriores al último commit en main; workflows del árbol focalizados en AMA | Cobertura CI insuficiente para certificar todos los motores |
| PORT-01 | **P2** | Tres motores con cálculos/configuraciones separados; auditar exposición agregada efectiva, presupuesto y reservas por exchange | Riesgo de integración, no fallo demostrado |

## 3. Seguridad: prioridad absoluta

### SEC-01 — Superficie HTTP y credenciales
- [Docker staging](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/docker-compose.staging.yml) incluye valores predeterminados concretos para contraseña PostgreSQL y token de administración WebSocket. **No reproducir esos valores ni reutilizarlos en informes públicos.** Validar si se usan efectivamente; rotar bajo autorización.
- El mismo compose publica PostgreSQL `5435:5432` y app `3020:5000` sin bind de loopback explícito. La exposición exterior depende del firewall/proxy no inspeccionados.
- `.env` y `.env.stg` están rastreados en Git, y `.gitignore` no los excluye. Algunas credenciales tienen placeholders, pero la URL DB contiene usuario/contraseña de loopback; ninguna debe mantenerse en repo público.
- [server/index.ts:21](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/index.ts#L21) registra `httpServer` sin TLS dentro de la app. Las capturas muestran acceso directo por IP sin indicación de HTTPS seguro; revisar terminación TLS aguas arriba.
- [server/routes.ts:394](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/routes.ts#L394) define `GET/POST /api/config` y [server/routes.ts:486](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/routes.ts#L486) configuración de credenciales de exchange. [server/routes/institutionalDca.routes.ts:80](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/routes/institutionalDca.routes.ts#L80) expone `PATCH /controls` y [server/routes/gridIsolated.routes.ts:813](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/routes/gridIsolated.routes.ts#L813) expone `POST /config` y `POST /mode`. No se aprecia autorización en esas rutas ni middleware global de autenticación en [server/index.ts:25](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/index.ts#L25). **No se probó acceso anónimo real**, que puede estar filtrado fuera del código.
- Exigir autenticación central, MFA cuando sea aplicable, autorización separada para cambios de modo/órdenes, rate limiting, HTTPS y cierre de accesos públicos innecesarios antes de reactivar REAL.

### SEC-02 — Impacto de una intrusión
- [server/index.ts:33](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/index.ts#L33) registra el JSON de **toda** respuesta `/api` en logs. Aplicar logging por allowlist, excluyendo contenido de configuración, tokens, claves y datos personales.
- [docker-compose.staging.yml](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/docker-compose.staging.yml) monta `/var/run/docker.sock` dentro del contenedor app; una vulneración web podría afectar al host/otros contenedores. Retirar o aislar mediante servicio específico con permisos mínimos.
- Verificar credenciales de Kraken, Revolut X, base de datos, Telegram, WebSocket, token del terminal y acceso SSH, SIN imprimir valores en logs o esta auditoría. Rotaciones y firewall exigen autorización independiente.

## 4. SPOT — explicación técnica de pérdidas

### SPOT-01 — Salida por señales con posibilidad de pérdida
- [server/services/tradingEngine.ts:2897](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/tradingEngine.ts#L2897) calcula `pnlPct` a partir de precio actual y entrada, **sin restar fees ni slippage**.
- [server/services/SmartExitEngine.ts:436](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/SmartExitEngine.ts#L436) ajusta el score para PnL negativo, pero `minPnlLossPct=0` por defecto (deshabilitado, [server/services/SmartExitEngine.ts:65](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/SmartExitEngine.ts#L65)). La barrera de comisiones es un aumento del **umbral de score**, no una prohibición matemática de cierre a pérdida. Una confirmación suficiente activa `shouldExit` incluso con PnL negativo.
- [server/services/tradingEngine.ts:3055](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/tradingEngine.ts#L3055) ejecuta `executeTrade(..., "sell", ...)` si `decision.shouldExit`, sin llamar allí al `checkFeeGating` que sí existe en [server/services/exitManager.ts:433](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/exitManager.ts#L433).
- El ExitManager tiene override económico legítimo para STOP_LOSS, EMERGENCY, DAILY_LOSS_LIMIT y TIME_STOP_HARD ([server/services/exitManager.ts:405](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/exitManager.ts#L405)), pero hay que distinguir pérdidas aceptadas por riesgo de liquidaciones causadas por calidad de señal.
- No está probado que Smart Exit estuviese habilitado en todas las 167 operaciones ni que causase las filas visibles de «Pérdida estructura». Reconstruir cada exitReason **real**, no inferirlo por traducción UI.

### SPOT-02 — Contexto de entrada fabricado para legacy
- [server/services/tradingEngine.ts:2953](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/tradingEngine.ts#L2953) genera un `entryContext` histórico usando **velas actuales**; si no localiza el número de señales original, supone `3`. Ese dato se persiste.
- [server/services/SmartExitEngine.ts:369](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/SmartExitEngine.ts#L369) usa `ctx.entrySignalsCount - currentSignals` para disparar `ENTRY_SIGNAL_DETERIORATION` de score 2 o 3. Es incorrecto tratar un contexto reconstruido como una fotografía real de la entrada.
- Propuesta: distinguir `entryContextSource=ACTUAL_AT_ENTRY | LEGACY_ESTIMATED`; el segundo no debe generar una venta autónoma por deterioro sin validación separada.

### SPOT-03 — Problema de ganancias no protegidas
Las capturas muestran operaciones que terminan perdiendo; para afirmar que antes ganaban falta histórico intratrade. Evaluar por operación: `maxFavorableExcursionPct` (MFE), `maxAdverseExcursionPct` (MAE), `highestPrice`, stop activo, activación de trailing, break-even, tiempos, ticks, motivos de venta y costes. Contrastar [server/services/exitManager.ts:1457](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/exitManager.ts#L1457) y [server/services/tradingEngine.ts:3055](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/tradingEngine.ts#L3055). **No cambiar parámetros ni prometer que salir siempre en verde sea viable**: los stops de riesgo pueden requerir pérdidas, pero deben ser explicables, limitadas y consistentes.

## 5. IDCA — por qué no compra

### IDCA-01 — Caída mínima != permiso definitivo
- [server/services/institutionalDca/IdcaEngine.ts:3728](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/institutionalDca/IdcaEngine.ts#L3728) verifica ciclo existente, exposición, wallet, OHLCV, fiabilidad de referencia, distancia, VWAP semanal, gate BTC para ETH y puntuación.
- [server/services/institutionalDca/IdcaEngine.ts:4355](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/institutionalDca/IdcaEngine.ts#L4355) añade `no_rebound_confirmed` cuando `requireReboundConfirmation` está activo, incluso si el precio ha caído por encima del mínimo.
- [server/services/institutionalDca/IdcaEngine.ts:4376](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/institutionalDca/IdcaEngine.ts#L4376) añade hard blockers y `confluence_no_entry`; [server/services/institutionalDca/IdcaEngine.ts:4466](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/institutionalDca/IdcaEngine.ts#L4466) concede compra solo si `blocks.length === 0`.
- Por ello «caída 2,72 % vs exigida 1,30 %» y «sin compras» son **compatibles con el código** si falta la confirmación de rebote. Debe verificarse si el bloqueo es temporal y razonable o está perpetuamente activo.

### IDCA-02 — Confluencia supuestamente diagnóstica que veta
- [server/services/institutionalDca/IdcaEngine.ts:4419](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/institutionalDca/IdcaEngine.ts#L4419) agrega `confluence_hard_blocked` / `confluence_no_entry` pese a que [server/services/institutionalDca/IdcaEngine.ts:4412](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/institutionalDca/IdcaEngine.ts#L4412) pasa `smartAdjustmentEnabled:false` con comentario «solo diagnóstico». Ese indicador no desactiva el veto `NO_ENTRY`. Revisar si la semántica esperada era «solo distancia» o «solo observación» y unificar comentario, contrato y ejecución.

### IDCA-03 — Incompatibilidad geométrica en rebote marginal
- [server/services/institutionalDca/IdcaDynamicReboundResolver.ts:128](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/institutionalDca/IdcaDynamicReboundResolver.ts#L128) calcula `reboundTriggerPrice = localLow*(1+reboundPct/100)`.
- [server/services/institutionalDca/IdcaDynamicReboundResolver.ts:140](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/institutionalDca/IdcaDynamicReboundResolver.ts#L140) calcula `maxExecutionPrice=reference*(1-retainedDropPct/100)` y `retainedDropPct>=requiredDistancePct`.
- Caso ilustrativo, no operación real: referencia 100, caída requerida 1,3 %, low 98,70 y rebote 0,3 %: trigger 98,9961 > máximo 98,70. Se necesita un nuevo mínimo más bajo para tener intersección; [server/services/institutionalDca/IdcaEngine.ts:4221](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/institutionalDca/IdcaEngine.ts#L4221) rechaza la compra fuera de máximo.
- Comprobar cuántos eventos caen en `rebound_trigger_not_reached`, `max_execution_price_exceeded`, `trailing_buy_execution_too_high` y por qué los trailing rearmados desaparecen. No relajar automáticamente este control: puede impedir compras peligrosas en falso rebote.

### IDCA-04 — Estado volátil
- [server/services/institutionalDca/TrailingBuyManager.ts:71](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/institutionalDca/TrailingBuyManager.ts#L71) conserva estados en `Map`; [server/services/institutionalDca/TrailingBuyManager.ts:224](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/institutionalDca/TrailingBuyManager.ts#L224) los actualiza y desarma. No existe persistencia/rehidratación dentro de ese componente. Verificar efecto de restart/redeploy y si hay restauración desde otros servicios.

## 6. GRID — por qué «busca niveles» pero no compra

### GRID-01 — Salidas SHADOW bloqueadas si falta banda
- [server/services/gridIsolated/gridIsolatedEngine.ts:1252](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/gridIsolated/gridIsolatedEngine.ts#L1252) pide `getGridBandSnapshot`; si no existe, `return` en [server/services/gridIsolated/gridIsolatedEngine.ts:1264](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/gridIsolated/gridIsolatedEngine.ts#L1264).
- El procesamiento de salidas `processOpenCyclesShadow` sucede después, en [server/services/gridIsolated/gridIsolatedEngine.ts:1328](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/gridIsolated/gridIsolatedEngine.ts#L1328). **Si falta banda, no llega a comprobar salidas SHADOW existentes**. Es un fallo de robustez de la prioridad de cierre declarada; se debe ensayar caso precio fresco + banda ausente + SELL objetivo cruzado. No modificar ciclos legacy ni cambiar objetivos sin autorización.

### GRID-02 — Planificación estricta y falta de razón única
- [server/services/gridIsolated/gridPlanningContextResolver.ts:216](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/gridIsolated/gridPlanningContextResolver.ts#L216) requiere banda apta; precio/mercado de referencia verificables, capacidad de ejecución, allocation, split par, proyección, microestructura y TTL.
- [server/services/gridIsolated/gridPlanningContextResolver.ts:332](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/gridIsolated/gridPlanningContextResolver.ts#L332) crea rango solo si **todas** las comprobaciones dan OK. Si falla una, no habrá niveles ni compras. Es una protección legítima, pero el panel debe explicar el veto canónico por tick y su duración.
- [server/services/gridIsolated/gridIsolatedEngine.ts:1482](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/gridIsolated/gridIsolatedEngine.ts#L1482) solo crea rango cuando no hay rango activo y `allowNewRange` es true; falta verificar si el VPS acumula eventos `GRID_SHADOW_NO_VIABLE_RANGE`, `EXECUTION_MARKET_SNAPSHOT_UNAVAILABLE`, `PLANNING_CONTEXT_INCOMPLETE`, `MARKET_REGIME_UNKNOWN`, `BAND_NOT_SUITABLE_FOR_GRID` o limitaciones de capital.
- La corrección `moderate -> normal_lateral` **sí existe** en [server/services/gridIsolated/gridProfessionalProjectionContext.ts:159](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/gridIsolated/gridProfessionalProjectionContext.ts#L159); `BITACORA.md` documenta el bloqueo previo del 09-08. No presentarlo como bug actual confirmado sin cotejar el SHA desplegado.
- La geometría uniforme y los targets propios V3 ya están documentados en `AUDITORIAS/AUDITORIA_GRID_UNIFORME_GEOMETRICO_2026-08-06.md`; evitar regresiones y no recalcular targets existentes.

## 7. Arquitectura, duplicidades y calidad
- El árbol completo tiene **2.098 blobs**, **234 archivos test/spec**, **29 informes en AUDITORIAS/** antes de este documento; `.local/` + `attached_assets/` suman **1.114 blobs y ~180,2 MB**. Hay **23 grupos de SHA repetido** (49 copias de archivos, incluidos assets duplicados). No es necesariamente doble ejecución, pero penaliza higiene, revisión, seguridad y tamaño.
- `.gitignore` no excluye `.env`, `.env.stg`, `.local`. Proponer limpieza en **rama aparte**, previo inventario y garantía de no destruir fuentes no reemplazables.
- Hay clasificadores de régimen separados para SPOT ([server/services/regimeDetection.ts:1](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/regimeDetection.ts#L1)), IDCA ([server/services/institutionalDca/IdcaConfluenceEngine.ts:542](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/institutionalDca/IdcaConfluenceEngine.ts#L542)) y Grid ([server/services/gridIsolated/gridBandAdapter.ts:95](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/9ca8506336b331a10da9f496b743ca4788cbfbfc/server/services/gridIsolated/gridBandAdapter.ts#L95)). Son estrategias distintas, no duplicados lógicamente probados, pero deben compartir datos frescos, precio de ejecución y vocabulario de diagnóstico.
- `PortfolioAllocationGuard` modela presupuestos globales; no se identificó llamada directa a ese guard desde los métodos centrales SPOT/IDCA/Grid examinados. Verificar integración por ejecución, reservas y exchange antes de declarar aislamiento patrimonial.
- La rama `main` no está protegida según la API de GitHub. En `.github/workflows` del árbol solo figuran dos workflows AMA. Las ejecuciones recientes consultadas también son de agosto de 2026, no validan el comportamiento actual de los tres motores.
- Desfase documental: `README.md` presenta «WINDSURF CHESTER BOT», mientras las capturas muestran «NEXA Crypto Suite». **La cadena de versión del SPOT visible en la captura y la etiqueta V4 SOFT QUALITY no se localizaron en el motor SPOT revisado de `main`**. No equiparar UI y fuente sin hashes/rutas y build stamp.

## 8. Plan obligatorio de contraauditoría runtime (READ-ONLY)
1. Identidad: en VPS y contenedor obtener `git rev-parse HEAD`, rama, timestamp de build, `VERSION`, imagen/container ID, fecha de arranque, rutas montadas y SHA `origin/main`. **No hacer git pull, build, deploy, compose up/down, SQL mutador ni restart**.
2. Seguridad: confirmar qué puertos son accesibles fuera, quién termina TLS, autenticación real y controles por ruta; verificar que credenciales predeterminadas no están en uso sin imprimirlas.
3. SPOT: exportar de modo lectura las 167 operaciones con id, par, entrada/salida, fees, saldo antes/después, motivo interno, modo LIVE/DRY, versión estrategia, PnL canónico, MFE/MAE, highest price, trailing/break-even y score de salida. Conciliar exactamente −845,01 USD, PF 0,68 y 28,1 %. Agrupar por motivo y par.
4. SPOT pruebas deterministas: precio sube 1 % y cae 2 %; Smart Exit con y sin fees; stop/trailing solapados; cierre idempotente; contextos legacy estimados; ejecución maker/taker; pérdidas de estructura, time stop y emergencia. Evaluar expectancy `win_rate*avg_win - loss_rate*avg_loss` y drawdown.
5. IDCA: para cada par extraer **todas** las razones del último `ENTRY_CHECK`, modo real/simulación, saldo libre, VWAP, ancla y edad, dip y mínimo, reboundPct, localLow, trigger, maxExecutionPrice, conf-score y clase de confluencia; histórico 48–72 h de blockers (conteo + duración). Conciliar 31 ciclos y −445,92 USD.
6. IDCA replay: caída insuficiente; caída suficiente sin rebote; rebote válido; rebote que sobrepasa precio máximo; salto de precio; latencia; reinicio con trailing armado; BTC bloquea ETH; modo observador vs simulación vs LIVE.
7. Grid: 48–72 h de estado y eventos por tick: regime, bandWidth, ATR, suitability, priceFresh, constraints, execution policy, maker-only, gate TTL, allocation, levels solicitados/viables, rango activo, propuestas rechazadas, targets y salidas antiguas. Reproducir banda ausente con target SELL abierto. No alterar ciclos.
8. Cartera y fiscal: verificar que Spot, IDCA, Grid y AMA no contabilizan doble las reservas ni venden HOLD ajeno; aislar FIFO, costes, maker/taker, comisiones, PnL realizado/no realizado y reserva AEAT.
9. Tests: `npm run check`, suites SPOT/IDCA/Grid/portfolio, `npm run build`, suite completa y reporte de fallos exactos; no aceptar tests rojos preexistentes sin evidencia, ni suprimir tests.
10. Entregar una matriz `finding → archivo:línea → evento real → causa raíz → reproducción → propuesta → test → prioridad`. **Implementación y deploy requieren autorización nueva**. Mantener REAL desactivado mientras no haya verificación de seguridad y reconciliación, mediante controles autorizados por el propietario (no desde esta auditoría).

## 9. Protocolo de corrección recomendado (sin ejecutar)
- **P0:** revisar protección del panel, autenticación, tokens de configuración, puertos, socket Docker y secreto por defecto; rotar credenciales con autorización. Verificar hash en ejecución.
- **P1 SPOT:** reconstruir pérdidas y separar cierres de riesgo deliberados de ventas por score sin garantía económica; proponer cambios en SHADOW y testearlos.
- **P1 IDCA:** mostrar bloqueo primario + secundarios, comprobar viabilidad geométrica del rebote y eliminar contradicciones de semántica «diagnóstica».
- **P1 GRID:** desacoplar evaluación de salidas de ausencia de banda si hay precio fiable y target persistido; mantener política maker-only y obligaciones antiguas.
- **P2:** simplificar UI, reportes canónicos, limpieza de archivos, cobertura CI y unificación de telemetría/cartera.

## 10. Límites y estado
- Verificación GitHub: **SÍ**, SHA base de `main` registrado.
- Análisis estático dirigido de rutas, motores y despliegue: **SÍ**.
- Inventario de blobs/duplicidades: **SÍ**.
- Validación de historial con datos crudos de base de datos: **NO**.
- Estado efectivo del VPS, autenticación perimetral, backups y logs: **NO VERIFICADO**.
- Ejecución de tests o backtests: **NO**.
- Cambios funcionales / operaciones reales / VPS: **NINGUNO**.
- **Veredicto: AUDITORÍA ESTÁTICA FECHADA, PENDIENTE DE CONTRASTACIÓN FORENSE EN VIVO; NO APROBAR REAL.**

**Nota:** este documento no contiene passwords, tokens, claves privadas ni los valores exactos de secretos descubiertos.
