# Anexo técnico a AUD-20261120-02 — hallazgos de código comprobados

**Documento principal de esta auditoría:** [AUD-20261120-02 — informe integral](02-auditoria-integral-motores-config-fuentes-codigo.md). **Identificador del anexo: AUD-20261120-02-A.**

**Fecha:** 20/11/2026. **Corte de fuentes:** main, commit ee497e60aae16f5e22116e7133c92e287db377ac, anterior a este informe.
**Tipo:** auditoría estática independiente de GitHub (árbol completo: 2.209 entradas / 2.122 archivos, 2.209 no significa 2.209 archivos de código). Inspección dirigida de motores, arranques, rutas, datos y configuración.
**Límites:** SIN acceso al VPS, SIN DB ni logs runtime; SIN pruebas ejecutadas de npm, red, HTTP, trading ni verificaciones de estado actual. Se distinguen hechos del código, riesgos e hipótesis. **Ningún motor ha sido activado ni modificado**.

## 1. Inventario de cuatro motores INDEPENDIENTES

| Motor | Puntos de entrada / fuente | Configuración y arranque encontrado | Situación comprobable |
|---|---|---|---|
| **SPOT / Swing / Momentum principal** | [TradingEngine](../../../server/services/tradingEngine.ts), [strategies.ts](../../../server/services/strategies.ts), SmartExitEngine, ExitManager, RegimeManager | server/routes.ts instancia TradingEngine y arranca si botConfig.isActive y Kraken está inicializado; lee storage.getBotConfig y otra configuración dinámica ConfigService | Código extenso e implementado. No se verificó su estado activo en staging. «Swing» no aparece como motor autónomo separado; comprobar si es modo/estrategia dentro de SPOT. |
| **IDCA institucional** | [IdcaEngine](../../../server/services/institutionalDca/IdcaEngine.ts), IdcaExecutionManager, IdcaExitManager, IdcaSmartLayer, IdcaSliderConfig | Independiente; arranca si institutionalDcaEnabled, mode distinto de disabled y globalTradingPause desactivado. Rutas institutionalDca.routes.ts e idcaHybrid.routes.ts | Código de ejecución/ciclos/sliders implementado, pero no se comprobaron los ajustes efectivos de DB ni si hay compras activas. |
| **GRID aislado** | [gridIsolatedEngine](../../../server/services/gridIsolated/gridIsolatedEngine.ts), gridCycleStartupService, gridExecutionService, gridRiskManager y targets por ciclo | Arranque propio, limitado a SHADOW e isActive=true y migraciones OK. Página GridIsolated.tsx, rutas gridIsolated.routes.ts | Motor independiente de los otros tres; ciclos 1 BUY → 1 SELL y lógica maker separadas. Estado de staging y orden real sin inspeccionar. |
| **AMA — Acumulación Macro Adaptativa** | [amaRuntimeService](../../../server/services/ama/amaRuntimeService.ts), amaSchedulerRunner, amaShadowExecutor, amaAdaptivePlanner, amaRealExecutionGateway | Scheduler propio iniciado desde server/index.ts (cada 60 s). Estados OFF, LAB, REPLAY, SHADOW_SCENARIO, SHADOW_LIVE y gates para REAL | Modo REAL **NO listo** para considerar operativo: ejecución final aún placeholder, aunque hay runtime persistente, laboratorio y SHADOW. |

La independencia de procesos y política de cada motor **no implica** independencia de datos físicos: hay servicios comunes de MarketDataService, ExchangeFactory, DB PostgreSQL, portfolioGlobal, FISCO, Telegram y gestión de cambios. **No se ha demostrado** todavía que todas las vías de compra compitan correctamente por un presupuesto/reserva global.

## 2. Inventario de fuentes de datos

| Fuente / capa | Evidencia del repositorio | Estado de uso |
|---|---|---|
| **Kraken: ticker y velas OHLCV** | MarketDataService + ExchangeFactory.getDataExchange | Fuente efectiva forzada **al inicializar** ExchangeFactory, no se ha comprobado su salud runtime. |
| **Revolut X: ejecución, balances, bid/ask** | RevolutXService, ExchangeFactory.getTradingExchange, sync de operaciones diario | Adaptador presente. Riesgo: getExchange('revolutx') puede caer a Kraken si Revolut X no está inicializado. Exige auditoría de vías de orden. |
| **Caché en memoria** | MarketDataService con TTL y single-flight | Implementado; edad de caché no siempre equivale a edad real de la última vela. |
| **PostgreSQL de velas** | MarketCandleRepository y getCandlesFromDb | Fallback implementado; devuelve series si hay al menos 7 velas, no valida ahí la edad del último cierre. |
| **DeFiLlama** | marketMetrics/providers/DeFiLlamaProvider.ts | Proveedor opcional complementario, no probado en runtime ni como input efectivo de compras. |
| **CoinMetrics Community** | marketMetrics/providers/CoinMetricsProvider.ts | Proveedor opcional; cobertura y disponibilidad runtime no comprobadas. |
| **Whale Alert** | marketMetrics/providers/WhaleAlertProvider.ts | Activación ligada a clave/config; no asumir cobertura sin ver registros. |
| **Binance Futures / CoinGlass** | marketMetrics/MarketMetricsService.ts | Selección condicional por presencia de COINGLASS_API_KEY; métricas auxiliares de futuros. |
| **AMA: macro, ETF, L2, derivados, CoinMetrics** | amaMacroSource, amaEtfSource, amaL2Source, amaDerivativesSource, amaCoinMetrics, amaSeedTypes | Parte de estos archivos son **tipos o validadores**, NO ingestas automáticas verificadas; algunas fuentes están catalogadas como solo investigación o deshabilitadas. |
| **Histórico descargado Binance SPOT 2026** | [AUD-20261119-13](../2026-11-19/13-datos-ohlcv-descarga-verificada-cinco-activos.md) | Dataset offline para backtest. No se ha probado conexión al flujo de órdenes actual. |

## 3. Inventario de configuraciones y posibles dobles fuentes de verdad

- **SPOT:** storage.getBotConfig / updateBotConfig (API /api/config) coexiste con ConfigService de tradingConfig JSONB/presets, cuyos valores TradingEngine carga como dynamicConfig. Es preciso demostrar por campo cuál prevalece.
- **SPOT avanzado:** shared/config-schema.ts define **nueve feature flags** con defaults false (señales por cierre de vela, momentum temprano, scoring, histéresis de régimen, MTF/volumen...). TradingEngine dispone de getFeatureFlags. No declarar que funcionen o estén activos sin estado efectivo y prueba A/B.
- **IDCA:** IdcaRepository controla enabled/mode/pausa; IdcaSliderConfig declara sliders como origen de umbrales y getEffectiveEntryConfig. Hay derivador implementado, pero **no está acreditado el uso de cada slider en cada decisión y fill**.
- **GRID:** gridIsolatedTypes, propio engine y rutas con niveles/targets/ciclos; NO equiparar su configuración a la función antigua gridStrategy de strategies.ts.
- **AMA:** amaRuntimeService y amaRepository gestionan mandato, ciclos, estado y kill switch; amaSeedTypes contiene políticas seed y taxonomía de fuentes; modo, readiness y autorización REAL son conceptos distintos.
- **Transversales:** ExchangeFactory (venue de datos vs venue de órdenes), MarketDataService, marketMetrics, PortfolioAllocationGuard/PortfolioIntegrationAdapter, FISCO y Telegram. **No se ha verificado** la aplicación uniforme del control global de capital.

## 4. Hallazgos probados o riesgos concretos

### H01 — P1 — Configuración dataExchange recibida pero ignorada al arranque. CONFIRMADO
[ExchangeFactory.ts líneas 168–211](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/server/services/exchanges/ExchangeFactory.ts#L168-L211): initializeFromConfig recibe dataExchange, pero fija this.dataExchange='kraken' independientemente del valor guardado. Existe setDataExchange para cambio posterior, que no se ha trazado. **Lo confirmado es que el ajuste no se aplica en el arranque**, no que no pueda cambiar nunca. Acción: reflejar Kraken como fijo en la UI o aplicar verdaderamente el valor y registrar effectiveDataVenue.

### H02 — P1 — Fallback de velas puede aparentar frescura aunque la vela sea antigua. CAMINO CONFIRMADO, IMPACTO POR MOTOR PENDIENTE
[MarketDataService.ts 145–210](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/server/services/MarketDataService.ts#L145-L210), [384–443](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/server/services/MarketDataService.ts#L384-L443). Al usar fallback DB, la comprobación aquí es tener ≥7 velas; el caché se reescribe con fetchedAt=ahora, sin exigir cierre reciente de la serie. **Matiz:** hay un getFreshTickerSnapshot estricto para Kraken; no atribuir este fallo a todos los consumidores sin comprobar su ruta. Acción: conservar último timestamp real de vela, procedencia y bloqueo por antigüedad.

### H03 — P1 / BLOQUEADOR REAL AMA — Gateway de ejecución puede indicar executed=true sin crear orden. CONFIRMADO
[amaRealExecutionGateway.ts 60–200](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/server/services/ama/amaRealExecutionGateway.ts#L60-L200). El método dice expresamente que enviar la orden al exchange es fase futura. Tras gates y reserva devuelve executed:true, orderId:null. **No supone una orden real ejecutada.** Debe impedirse que UI/monitorización contabilicen esa señal como ejecución. Mantener REAL bloqueado.

### H04 — P1 — AMA puede atribuir frescura a una consulta reciente, no a un ticker reciente. CONFIRMADO EN CÓDIGO
[amaMarketRuntimeService.ts 20–140](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/server/services/ama/amaMarketRuntimeService.ts#L20-L140) define analysisTimestamp=new Date().toISOString() después de recuperar ticker; [amaRealLimitedService.ts 110–158](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/server/services/ama/amaRealLimitedService.ts#L110-L158) comprueba esa marca temporal. Riesgo de dar como fresco un dato recuperado del caché. No autorizar REAL con origen/edad dudosos o dataQuality STALE.

### H05 — P1 — El arranque del servidor ejecuta operaciones que PUEDEN escribir DB. CONFIRMADO EN CÓDIGO
[server/routes.ts 200–237](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/server/routes.ts#L200-L237) ejecuta runSchemaMigration / AutoMigrationRunner / ensureFiscoV2Schema. [routes.ts 1894–1912](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/server/routes.ts#L1894-L1912) inicia rebuildPnlForAllSells e IDCA historical duplicate cleanup. No se ha consultado si alteraron datos en el VPS. **No reiniciar/deploy sin auditoría de efectos e idempotencia.**

### H06 — P2 — ConfigService tolera configuración inválida devolviéndola sin sanear. CONFIRMADO
[ConfigService.ts 47–59](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/server/services/ConfigService.ts#L47-L59): si el schema safeParse falla, retorna la config original casteada. Existe skipValidation como opción de actualización. Debe distinguirse config escrita, validada y efectiva.

### H07 — P2 — AMA conserva un servicio antiguo explícitamente marcado STUB. CONFIRMADO EL ARCHIVO
[amaService.ts](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/server/services/ama/amaService.ts) contiene DEVELOPMENT_SCAFFOLD_ONLY / NOT_SOURCE_OF_TRUTH y estado en memoria; las rutas principales importan [amaRuntimeService.ts](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/server/services/ama/amaRuntimeService.ts). **No hay prueba de que el stub sea invocado en runtime**. Auditar imports antes de retirarlo.

### H08 — P2 — Dos «Grid» de generaciones diferentes. CONFIRMADO; NO CONFUNDIR
[strategies.ts gridStrategy](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/server/services/strategies.ts#L357-L453) es un generador de señales del SPOT tradicional; [gridIsolatedEngine.ts](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/server/services/gridIsolated/gridIsolatedEngine.ts) es un motor de ciclos independiente. Falta identificar si el gridStrategy antiguo sigue seleccionable en la configuración actual.

### H09 — P2 — AMA aún declara TODO sobre reconciliación en el scheduler. CONFIRMADO
[amaSchedulerRunner.ts 95–103](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/server/services/ama/amaSchedulerRunner.ts#L95-L103): TODO Wire portfolio reconciliation when available. Aunque exista PortfolioIntegrationAdapter, no se puede dar por implementado en este tick.

### H10 — P1 potencial — Fallback Revolut X→Kraken en fábrica de exchange. CÓDIGO CONFIRMADO, ORDEN EQUIVOCADA NO DEMOSTRADA
[ExchangeFactory.ts 37–58](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/server/services/exchanges/ExchangeFactory.ts#L37-L58). Si Revolut X no está inicializado, getExchange('revolutx') puede devolver krakenService. Otras vías validan isInitialized; falta auditar cada caller capaz de ejecutar órdenes. Recomendación: exigir coincidencia del venue requerido con el real o bloquear orden.

### H11 — P2 — Repositorio público con archivos de entorno y residuos. PRESENCIA CONFIRMADA; SECRETOS PRODUCTIVOS NO DEMOSTRADOS
En árbol main figuran .env y .env.stg versionados, .env.example de unos 127 KB, .local/ (717 elementos), attached_assets/ (397) y AiMl.tsx.backup / scripts temporales. Los campos de claves de .env/.env.stg inspeccionados tienen aspecto de plantillas; su URL DB apunta a loopback. No publicar valores en informes. Auditar contenido, historial Git y .gitignore; si hubo credenciales reales expuestas, rotarlas. No borrar sin autorización.

### H12 — P2 — Flags, métricas y controles UI: habilitado ≠ aplicado. PENDIENTE DE VALIDACIÓN TOTAL
[shared/config-schema.ts 70–93](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/shared/config-schema.ts#L70-L93) presenta nueve flags false por defecto; [TradingEngine 617–627](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/server/services/tradingEngine.ts#L617-L627) tiene lectura. [MarketMetricsService.ts 35–70](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/ee497e60aae16f5e22116e7133c92e287db377ac/server/services/marketMetrics/MarketMetricsService.ts#L35-L70) distingue refresh automático condicionado y refreshForzado que ignora el flag deliberadamente. **No se ha demostrado que todos los controles UI alteren decisiones**: requiere prueba individual.

## 5. Matriz de veredictos y falsos positivos a evitar

| Afirmación | Veredicto |
|---|---|
| La selección dataExchange de DB se respeta al arrancar | **NO; anulación por Kraken confirmada** |
| AMA ya puede ejecutar órdenes REAL | **NO; gateway sin envío real** |
| Una respuesta executed:true de AMA prueba fill | **NO; orderId puede ser null** |
| IDCA usa todos los sliders en su decisión final | **SIN VERIFICAR** (existe derivador) |
| Todos los modos usan la misma protección global de presupuesto | **SIN VERIFICAR** |
| SPOT, IDCA, GRID y AMA están ahora encendidos | **SIN VERIFICAR SIN RUNTIME** |
| Los nueve feature flags funcionan en config activa | **SIN VERIFICAR** |
| Todos los proveedores externos suministran datos frescos | **SIN VERIFICAR** |
| Grid de signals y Grid aislado son el mismo motor | **FALSO; implementaciones distintas** |
| La presencia de .env prueba fuga de credenciales reales | **NO DEMOSTRADO**; revisar historial |
| El informe garantiza que tests pasan o código desplegado coincide | **NO**; no se ejecutaron tests ni se inspeccionó VPS |

## 6. Siguiente fase de AUDITORÍA, sin implementar correcciones todavía

**Prioridad P0/P1:** (a) cerrar el falso executed de AMA, manteniendo REAL bloqueado; (b) trazar cada camino de orden y evitar fallback de venue; (c) demostrar por motor que el capital global es reservado y liberado sin dobles gastos; (d) bloquear decisiones basadas en datos sin marca temporal del proveedor; (e) documentar las escrituras de startup.

**Pruebas de cableado de configuración:** crear matriz por CADA control visible con 8 columnas: Motor / UI / Ruta API / Tabla o JSONB / Valor guardado / Valor efectivo leído / Condición que modifica / Test + log; clasificar Aplicado, Solo UI, Solo almacenado, Deshabilitado por diseño, Legacy, Placeholder, No verificable. No ejecutar POST en producción ni activar REAL.

**Deuda:** mapear importaciones del AMA stub, usos de gridStrategy antiguo, .backup, temporales, .local y fuentes AMA research; retirar únicamente con autorización, pruebas y commits independientes.

**Controles:** ejecutar tests y TypeScript/build en un entorno local aislado; cotejar con runtimes de staging mediante endpoints de SOLO LECTURA si se autoriza; no usar SSH para modificar nada, no reiniciar servicios, no hacer migraciones, no tocar ciclos ni targets.

## Estado y límites

- **Auditoría estática completada en el alcance revisado. No equivalencia a auditoría runtime exhaustiva.**
- **No se ha tocado VPS, DB, API operativa, configuración ni motores.**
- **No hay autorización para fixes, despliegues ni órdenes reales.**
- Cualquier afirmación de funcionamiento concreto necesita pruebas locales y lecturas del entorno. Un hallazgo de código no implica que se haya producido el fallo en operaciones históricas.
