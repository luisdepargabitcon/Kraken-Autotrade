# Auditoría integral de arquitectura NEXA — motores, fuentes, configuraciones y código heredado

**ID:** AUD-20261120-02  
**Fecha:** 20/11/2026  
**Fuente inspeccionada:** GitHub público \`luisdepargabitcon/Kraken-Autotrade\`, rama \`main\`, HEAD de partida \`ee497e60aae16f5e22116e7133c92e287db377ac\`.  
**Método:** revisión independiente de archivos exactos de GitHub, árbol completo (2.209 entradas, 2.122 blobs), código de inicio, rutas, configuraciones, fuentes, motores y servicios de cartera. **No se realizaron órdenes, POST, migraciones ni modificaciones en VPS o DB.**  
**Limitación importante:** NO auditado en ejecución: el puerto SSH y los puertos web de staging no fueron accesibles desde el entorno de esta sesión. No se consultaron configuraciones efectivas de DB, procesos, env real, estado de exchanges, órdenes o logs en VPS. Tampoco se ejecutó la suite completa de pruebas con el repositorio instalado. Los resultados son **estáticos** salvo donde se indique.

## Veredicto ejecutivo

**NECESITA CORRECCIONES Y CONTRAAUDITORÍA DE RUNTIME ANTES DE APROBAR REAL.**  
Los cuatro motores tienen lógica separada, pero comparten procesos, dependencias y/o recursos. Hay discrepancias de configuración, fuentes de datos con fallbacks de frescura, endpoints de mutación que requieren verificación de control de acceso y una ruta de AMA con un placeholder comprobado que informa \`executed=true\` sin enviar una orden. **No inferir que el bot REAL esté operando ni que cualquier protección esté habilitada en staging hasta leer el runtime.**

### Clasificación usada
- **CONFIRMADO**: se ve inequívocamente en el código, no requiere ejecutar la aplicación.
- **RIESGO**: vía posible según código; se necesita comprobar alcanzabilidad y estado runtime antes de afirmar impacto.
- **CONDICIONAL**: implementación real, pero solo opera si se cumplen modo, flags, credenciales, scheduler o rango.
- **NO VERIFICADO**: requiere runtime, DB, intercambio o pruebas E2E.

## 1. Inventario exacto de motores y modos

| Sistema | Código principal | Rutas y pantallas | Modos / comportamiento | Estado probado por código |
|---|---|---|---|---|
| **SPOT NORMAL / SWING** | [tradingEngine.ts](../../../../server/services/tradingEngine.ts), [strategies.ts](../../../../server/services/strategies.ts), [exitManager.ts](../../../../server/services/exitManager.ts) | [Strategies.tsx](../../../../client/src/pages/Strategies.tsx), [Settings.tsx](../../../../client/src/pages/Settings.tsx); rutas config/positions/trades | \`dryRunMode\` o LIVE, SINGLE/SMART_GUARD, momentum/reversión/scalping/grid **dentro del SPOT normal**; modo de escaneo ciclo, 5m, 15m, 1h | Implementado, arranque condicionado a \`bot_config.isActive\` y Kraken inicializado; estado actual no comprobado |
| **IDCA institucional** | [IdcaEngine.ts](../../../../server/services/institutionalDca/IdcaEngine.ts), [IdcaRepository.ts](../../../../server/services/institutionalDca/IdcaRepository.ts), [IdcaExecutionManager.ts](../../../../server/services/institutionalDca/IdcaExecutionManager.ts) | [institutionalDca.routes.ts](../../../../server/routes/institutionalDca.routes.ts), [InstitutionalDca.tsx](../../../../client/src/pages/InstitutionalDca.tsx) | \`disabled / simulation / live\`; ciclo base + compras de seguridad; ladder ATRP, entrada dinámica, smart/confluence y overlays | Motor y scheduler separados; arranca si toggle IDCA, modo permitido y sin pausa global aplicable |
| **GRID AISLADO** | [gridIsolatedEngine.ts](../../../../server/services/gridIsolated/gridIsolatedEngine.ts), [gridIsolatedTypes.ts](../../../../server/services/gridIsolated/gridIsolatedTypes.ts) | [gridIsolated.routes.ts](../../../../server/routes/gridIsolated.routes.ts), [GridIsolated.tsx](../../../../client/src/pages/GridIsolated.tsx) | \`OFF / SHADOW / REAL_LIMITED / REAL_FULL\`; Grid propio con niveles, versiones de rango, ciclos y SELL asociados. SHADOW normaliza \`MAKER_ONLY\` | Engine distinto de SPOT y de overlay IDCA; autoarranque SHADOW condicionado al modo, activo y migraciones |
| **AMA / Acumulación Macro Adaptativa** | [amaRuntimeService.ts](../../../../server/services/ama/amaRuntimeService.ts), [amaSchedulerRunner.ts](../../../../server/services/ama/amaSchedulerRunner.ts), [amaAdaptivePlanner.ts](../../../../server/services/ama/amaAdaptivePlanner.ts) | [ama.routes.ts](../../../../server/routes/ama.routes.ts), [Ama.tsx](../../../../client/src/pages/Ama.tsx) | \`OFF / LAB / REPLAY / SHADOW_SCENARIO / SHADOW_LIVE / REAL_LIMITED / REAL_FULL\`. Scheduler de 60 segundos y puertas de autorización | SHADOW tiene camino de ejecución; algunas fuentes y reconciliación son parciales; REAL tiene placeholder en gateway. REAL_FULL bloqueado por política |

**Distinciones obligatorias:**
1. El botón **“Grid Trading” del SPOT normal** llama a \`gridStrategy\` dentro de [strategies.ts](../../../../server/services/strategies.ts) y **no activa el Grid aislado**. El SPOT normal también ofrece mean_reversion y scalping; no hay que etiquetarlos como motores separados.
2. El **IdcaGridOverlay** es una capa interna de IDCA y **no equivale al Grid aislado**. Véase [IdcaGridOverlay.ts](../../../../server/services/institutionalDca/IdcaGridOverlay.ts).
3. AMA no es el IDCA antiguo con otro nombre: tiene tablas, modos, scheduler, replays y políticas propios.
4. La independencia de estrategias no equivale a independencia física de saldo, exchange, cachés, FISCO, Telegram ni proceso Node.

## 2. Arranques y ejecución efectiva

Según [server/routes.ts](../../../../server/routes.ts) y [server/index.ts](../../../../server/index.ts):
- SPOT: construye \`TradingEngine\`; se inicia si \`botConfig.isActive\` y Kraken está inicializado (aprox. líneas 370–374 de routes.ts).
- IDCA: registra rutas propias y consulta \`getTradingEngineControls()\` + \`getIdcaConfig()\`; arranca scheduler cuando IDCA está habilitado, modo distinto de disabled y \`globalTradingPause=false\` (aprox. 376–387).
- Grid: registra rutas separadas y llama \`initializeGridShadowAtStartup()\` únicamente tras migraciones correctas. La rutina exige modo SHADOW y activo ([gridCycleStartupService.ts](../../../../server/services/gridIsolated/gridCycleStartupService.ts)).
- AMA: el servidor inicia el scheduler cada 60s; el tick examina estado, HWM, kill switch y modo, ejecutando solo SHADOW_LIVE si los bloqueos lo permiten ([amaSchedulerRunner.ts](../../../../server/services/ama/amaSchedulerRunner.ts)).
- Existen otros schedulers comunes: Telegram, FISCO, Market Metrics, limpieza de velas/logs y métricas de operaciones.

**Ojo:** en el arranque se invocan rutinas que **pueden modificar DB**: \`storage.runSchemaMigration\`, \`AutoMigrationRunner\`, \`ensureFiscoV2Schema\`, \`rebuildPnlForAllSells\` y una limpieza histórica de duplicados IDCA. La presente auditoría NO arrancó el bot ni ejecutó ninguna de ellas.

## 3. Fuentes de datos: reales, condicionales y catalogadas

| Fuente | Consumidores / ruta | Estado real que demuestra el código |
|---|---|---|
| **Kraken API pública** | [MarketDataService.ts](../../../../server/services/MarketDataService.ts), SPOT, IDCA, Grid, AMA | Fuente operativa de ticker/OHLCV con cache TTL; Grid tiene API estricta \`getFreshTickerSnapshot\`. |
| **Kraken API privada** | [kraken.ts](../../../../server/services/kraken.ts), [ExchangeFactory.ts](../../../../server/services/exchanges/ExchangeFactory.ts) | Servicio para balances/órdenes sujeto a credenciales y modo. No probar conectividad real. |
| **Revolut X** | [RevolutXService.ts](../../../../server/services/exchanges/RevolutXService.ts), ExchangeFactory | Adaptador operativo de trading sujeto a credenciales; **no es necesariamente fuente OHLCV**: la inicialización fuerza \`dataExchange=kraken\`. |
| **PostgreSQL market candles** | [MarketCandleRepository.ts](../../../../server/services/marketData/MarketCandleRepository.ts) | Caché histórico/fallback. No garantiza por sí mismo actualidad de la última vela. |
| **Binance Futures** | [BinanceFuturesProvider.ts](../../../../server/services/marketMetrics/providers/BinanceFuturesProvider.ts) | Provider real de OI/funding cuando no hay clave CoinGlass; exige conectividad y refresh de Market Metrics. |
| **DeFiLlama** | [DeFiLlamaProvider.ts](../../../../server/services/marketMetrics/providers/DeFiLlamaProvider.ts) | Provider público de stablecoins; opcional por módulo. |
| **Coin Metrics Community** | [CoinMetricsProvider.ts](../../../../server/services/marketMetrics/providers/CoinMetricsProvider.ts) | Provider real con limitaciones del tier gratuito. Distinto del catálogo de fuentes de AMA. |
| **Whale Alert** | [WhaleAlertProvider.ts](../../../../server/services/marketMetrics/providers/WhaleAlertProvider.ts) | Condicionado a \`WHALE_ALERT_API_KEY\`; si falta, no disponible; no implica que haya señales de ballenas operativas. |
| **CoinGlass** | [CoinGlassProvider.ts](../../../../server/services/marketMetrics/providers/CoinGlassProvider.ts) | Condicionado a \`COINGLASS_API_KEY\`; sustituye proveedor Binance Futures en la selección de Market Metrics. |
| **AMA: Coin Metrics Pro/archivo, macro, ETF, derivados, L2, Bitcoin Core** | [amaSeedTypes.ts](../../../../server/services/ama/amaSeedTypes.ts) y módulos \`ama*Source.ts\` | Varias definiciones son **taxonomía, validadores o investigación**, no ingesta real ni señales con capacidad de ejecutar compras. Coin Metrics Pro figura explícitamente DISABLED/BLOCKED. |

El laboratorio externo con OHLCV de **Binance SPOT/USDT** de noviembre está en Drive privado. **No significa** que los motores operativos de NEXA hayan cambiado su feed a Binance; el código productivo sigue consultando Kraken salvo la familia Market Metrics.

## 4. Configuraciones y quién las consume

| Configuración / origen | Quién debe usarla | Estado observado |
|---|---|---|
| \`bot_config\` (BD) | SPOT normal: estrategia, pares, dry-run, risk, SG, router, stop, etc. | **EN USO** para arranque/scan; tiene valores por defecto. |
| \`trading_config\` (JSON activo, ConfigService) | SPOT normal: feature flags, umbrales y config dinámica | **EN USO PARCIAL**; el método update/activate no emite el evento que escucha TradingEngine. El endpoint específico de feature flags sí emite. |
| \`api_config\` + ExchangeFactory | Credenciales, \`tradingExchange\`, \`dataExchange\`, \`activeExchange\` | **EN USO PARCIAL**: trading venue seleccionable; \`dataExchange\` se fuerza a Kraken al inicializar. |
| \`marketMetricsConfig\` de bot_config | Market Metrics / filtro SPOT | **DESACTIVADO POR DEFECTO**, modo observación por defecto. Habilitar recolección no equivale necesariamente a bloquear compras. |
| \`idca_config\` + \`idca_asset_config\` | IDCA y sus sliders, modo/ladder/entradas/salidas | **EN USO CON CONDICIONES**; \`GET /api/institutional-dca/config/effective\` permite comparar derivada/legacy. |
| \`grid_isolated_configs\`, versiones de rango y ciclos | Grid aislado | **CONFIGURACIÓN PROPIA**. En SHADOW se fuerza maker-only aunque persistiera política legacy. |
| \`ama_*\` y env AMA | AMA: modo, mandatos, HWM, límites, autorizaciones | **EN DESARROLLO / MODOS BLOQUEADOS** según guardas; la tabla 080 AMA se mantiene fuera de AutoMigrationRunner automático en routes.ts. |
| Presupuestos / reservas \`portfolio_*\` | Servicio de cartera global, activos y modos | **IMPLEMENTADO EN SERVICIO**, pero integración preorden de SPOT, IDCA y Grid no acreditada en los núcleos principales inspeccionados. |

**No llamar “configuración común” a un parámetro solo porque aparezca en Ajustes:** los cuatro motores leen diferentes tablas y no comparten automáticamente stoploss, cooldown, modo SIMULACIÓN, tasas, sizing ni kill-switch. \`globalTradingPause\` se comprueba en el arranque IDCA; no se ha acreditado un kill switch universal que alcance simultáneamente los cuatro motores.

## 5. Hallazgos priorizados y evidencia

| ID | Gravedad | Estado | Hallazgo, efecto y fuente |
|---|---|---|---|
| **A-01** | **CRÍTICA** | **CONFIRMADO** | [AMA RealExecutionGateway.ts líneas 154–201](../../../../server/services/ama/amaRealExecutionGateway.ts): tras reservar capital, el gateway incluye literalmente **“Actual exchange order placement would happen here”** y devuelve \`executed:true\` con \`orderId:null\` **sin enviar la orden**. Un llamador puede interpretar éxito ficticio. NO habilitar AMA REAL sobre esta ruta. |
| **A-02** | **CRÍTICA POTENCIAL** | **RIESGO, exposición no verificada** | [server/index.ts](../../../../server/index.ts) y rutas por motor: no se observa middleware global de autenticación/autorización en Express antes de handlers de mutación. Algunos endpoints admin usan token, pero otros registran cambios de configuración/mode/operaciones sin un guard propio visible. Verificar proxy, red, roles y protección de endpoint **antes de REAL**. No se ha demostrado accesibilidad desde Internet. |
| **A-03** | ALTA | CONFIRMADO | [ExchangeFactory.ts líneas 37–59 y 168–210](../../../../server/services/exchanges/ExchangeFactory.ts): la inicialización **ignora \`config.dataExchange\`** y fija Kraken; además, \`getExchange("revolutx")\` puede devolver servicio Kraken si Revolut no inicializado. Aislar fallo de trading venue de un fallback silencioso. No se ha demostrado ejecución equivocada real. |
| **A-04** | ALTA | CONFIRMADO | [ConfigService.ts líneas 188–324](../../../../server/services/ConfigService.ts) guarda/activa configs, pero **no emite** \`config:updated\` o \`config:activated\`; [tradingEngine.ts líneas 5933–5950](../../../../server/services/tradingEngine.ts) sí escucha esos eventos. [routes/config.ts líneas 369–402](../../../../server/routes/config.ts) emite explícitamente solo al modificar feature flags. **El guardado o activación genérica puede no aplicarse en caliente**. |
| **A-05** | ALTA | CONFIRMADO | [tradingEngine.ts líneas 2398–2417 y 5950–5967](../../../../server/services/tradingEngine.ts): \`loadDynamicConfig()\` aplica \`global.dryRunMode\`, pero al terminar el arranque se sobrescribe con \`bot_config.dryRunMode\` salvo entorno Replit. **Dos fuentes de verdad** para una protección crucial; valor efectivo depende del orden de carga/actualización. |
| **A-06** | ALTA | CONFIRMADO | [MarketDataService.ts líneas 148–210, 389–438](../../../../server/services/MarketDataService.ts): el fallback de velas desde DB o caché devuelve series sin verificar su última marca horaria; marcar \`fetchedAt=Date.now()\` al recuperar DB puede confundir edad de cache con edad de mercado. El endpoint estricto \`getFreshTickerSnapshot\` de Grid es una excepción positiva, no garantía universal. |
| **A-07** | ALTA | CONFIRMADO | [AMA market view líneas 25–150](../../../../server/services/ama/amaMarketRuntimeService.ts) obtiene \`getTicker\`, pero marca \`analysisTimestamp\` con hora actual, y dataQuality puede quedar FRESH cuando solo existen HWM y ≥7 velas. [MarketDataService.getTicker líneas 276–320](../../../../server/services/MarketDataService.ts) puede devolver ticker viejo al fallar actualización. **Riesgo de falsa frescura** en AMA, sujeto a flujo efectivo. |
| **A-08** | ALTA | RIESGO | [portfolio/PortfolioIntegrationAdapter.ts](../../../../server/services/portfolio/PortfolioIntegrationAdapter.ts) implementa reserva/lock y lo usa AMA; no se encontró consumo directo del adaptador en núcleos de SPOT, IDCA y Grid revisados. Por tanto **no está demostrado** que haya presupuesto y reserva atómicos transversales para cuatro motores. Auditar una compra concurrente por modo. |
| **A-09** | ALTA | RIESGO | [server/index.ts líneas 34–50](../../../../server/index.ts): loguea el cuerpo JSON de respuestas de **todas las rutas API**. Potencial exposición de información de saldos, configuración o datos sensibles en logs. Comprobar que las respuestas reales estén redactadas y que los logs tengan acceso limitado. |
| **A-10** | ALTA | CONFIRMADO | Repo GitHub **público** contiene \`.env\`, \`.env.stg\`, \`.env.example\`, y cientos de archivos \`.local/state\` versionados. Los \`.env\` pequeños contienen claves de trading de ejemplo y conexión de DB **loopback**, sin confirmar secretos productivos. \`.env.example\` supera 127 KB. Auditar historial de exposición y limpiar por fases; nunca copiar valores al informe. |
| **A-11** | MEDIA | CONFIRMADO | [institutionalDca.routes.ts líneas 689 y 960](../../../../server/routes/institutionalDca.routes.ts): se registra **dos veces** POST /telegram/test. Express resuelve la primera, dejando la segunda como ruta redundante/inaccesible en condiciones normales. |
| **A-12** | MEDIA | CONFIRMADO | [IdcaEngine.ts líneas 1789–1812](../../../../server/services/institutionalDca/IdcaEngine.ts): con ladder ATRP activo se **ignora \`safetyOrdersJson\` legacy** para evitar doble ejecución, aunque siga almacenado. No es automáticamente un bug, pero hay que mostrar claramente cuál de las dos configuraciones es efectiva. |
| **A-13** | MEDIA | CONFIRMADO | [MarketMetricsTypes.ts líneas 80–97](../../../../server/services/marketMetrics/MarketMetricsTypes.ts) define \`enabled:false\` y modo \`observacion\`; [MarketMetricsService.ts](../../../../server/services/marketMetrics/MarketMetricsService.ts) no refresca automáticamente si disabled; [tradingEngine.ts líneas 8050+](../../../../server/services/tradingEngine.ts) registra evaluación, pero modo observación no bloquea. **Un panel poblado no demuestra filtro de riesgo activado**. |
| **A-14** | MEDIA | CONFIRMADO | [amaSchedulerRunner.ts línea 101](../../../../server/services/ama/amaSchedulerRunner.ts) tiene \`TODO: Wire portfolio reconciliation when available\`. AMA puede tener scheduler y tick activos sin esa integración periódica completa. |
| **A-15** | MEDIA | CONFIRMADO | [routes.ts líneas 60–66](../../../../server/routes.ts) excluye migración inicial AMA \`080\` del runner automático. Instalación con rutas/scheduler no prueba que el esquema AMA exista; gate/DB deben validarse por entorno. |
| **A-16** | MEDIA | CONFIRMADO | SPOT: [Strategies.tsx líneas 38–43](../../../../client/src/pages/Strategies.tsx) ofrece \`momentum\`, \`mean_reversion\`, \`scalping\` y \`grid\`; [tradingEngine.ts líneas 5855–5874](../../../../server/services/tradingEngine.ts) tiene implementaciones para scan \`cycle\`. **El Grid SPOT NO es Grid aislado** y no hereda sus protecciones/ciclos/maker-only. |
| **A-17** | MEDIA | CONTRATO CONTRADICTORIO | [tradingEngine.ts líneas 275, 299, 323–326, 4014](../../../../server/services/tradingEngine.ts): \`sgAllowUnderMin\` se marca DEPRECATED/ignorado en comentarios, pero aún se usa en una condición de validación. No afirmar que está totalmente muerto sin trazar cuál rama se llama; eliminar la ambigüedad documental y probar ambos valores. |
| **A-18** | MEDIA | RIESGO | [tradingEngine.ts línea 1319](../../../../server/services/tradingEngine.ts) trata \`TRADING_ENABLED\` ausente como true; [shared/schema.ts](../../../../shared/schema.ts) define \`dryRunMode\` default false. Hay controles posteriores, pero los **valores por defecto no son fail-closed** para un despliegue mal configurado. Auditar flags reales antes de reinicio. |
| **A-19** | MEDIA | RIESGO | [MarketDataService.ts líneas 250–320](../../../../server/services/MarketDataService.ts): si falla ticker/price se puede devolver caché caducada. Algunos consumidores podrían usarla sin freshness gate propio. Comparar método de datos efectivo para cada decisión y salida. |
| **A-20** | MEDIA | CONFIRMADO | [strategies.ts líneas 705–745](../../../../server/services/strategies.ts): mean reversion en router de SPOT emite **BUY**, pero la emisión SELL por señal está comentada intencionalmente para preservar salidas SMART_GUARD. No prometer una reversión simétrica compra/venta; salida depende del exit manager. |
| **A-21** | MEDIA | RIESGO | El servidor registra endpoints \`test/debug\`, config y funciones de mantenimiento junto a los operativos. La seguridad de acceso no se puede evaluar solo por existencia de handlers; restringirlos por entorno y probar roles (sin ejecutar rutas mutantes). |
| **A-22** | BAJA | CONFIRMADO | Carga histórica/temporal: archivo \`client/src/pages/AiMl.tsx.backup\`, scripts \`tmp-check-config-db.*\`, \`vps_commands*\`, políticas maker/taker legacy mantenidas para lectura de registros, compatibilidad de safety orders IDCA y planificador AMA legacy. No borrar nada automáticamente: identificar referencias/imports e historial antes de retirar. |

### Hallazgos que NO deben presentarse como errores demostrados
- Que los cuatro motores estén operando actualmente. **Sin acceso a DB/runtime**, no confirmado.
- Que una clave API REAL esté expuesta. Los \`.env\` inspeccionados muestran ejemplos/DB loopback; no se recorrió exhaustivamente historial Git.
- Que la ausencia de middleware Express implique acceso externo: podría existir red privada, proxy o cortafuegos.
- Que el presupuesto global esté inutilizado en todos los modos: el servicio sí existe, pero falta cobertura end-to-end de todos los compradores.
- Que Grid REAL o AMA REAL hayan enviado órdenes incorrectas. No se cursaron ni consultaron órdenes.
- Que los tests actuales pasen. Solo se detectaron pruebas fuente y workflows, no se ejecutó npm/vitest.

## 6. Código heredado y limpieza segura

### Heredado pero puede ser necesario
- En SPOT hay rutas/escaneos de ciclo y velas, SG y configuraciones antiguas simultáneas; conservar hasta trazabilidad DB/call graph.
- En IDCA: safety orders antiguas, VWAP legacy, modo simulación y datos importados; al activar ATRP algunas se ignoran intencionalmente.
- En Grid: políticas legacy de maker/taker, targets simétricos históricos y cierres ligados a rango antiguo. El SHADOW activo normaliza maker-only; no reescribir ciclos existentes.
- En AMA: seed/legacy planner, fuentes de investigación y contratos de ejecución incompletos.

### Candidatos de higiene, **sin eliminación aprobada**
- Archivos temporales/backup y scripts de mantenimiento del root; no asumir que son basura si Cascade/VPS los invoca.
- \`.local/state\` y datos de entorno versionados: revisar sensibilidad y reducir exposición del repositorio.
- Eliminación de duplicación de rutas y confusiones de etiquetas Grid SPOT vs Grid aislado.
- Unificar origen de configuración y construir matriz campo → BD → UI → endpoint → resolver → gate → orden, con prueba de cambio efectivo y rollback.
- Cada flag de UI debe mostrar: **almacenado, efectivo, habilitado, motivo si no aplica, última lectura por engine**.

## 7. Tabla de comprobaciones de runtime imprescindibles (solo GET y comandos read-only)

**No ejecutar esta lista en esta auditoría: acceso VPS no disponible.** Si se autoriza una fase técnica de contraauditoría, leer desde una sesión autenticada y proteger toda salida sensible.

| Prueba | Qué comparar | Resultado actual |
|---|---|---|
| Estado SPOT | config activa, \`dryRunMode\`, \`TRADING_ENABLED\`, pares/estrategia, slots, órdenes, motor real | NO VERIFICADO |
| SPOT configuración avanzada | JSON \`trading_config\`, feature flags, \`config:activated/updated\`, runtime y último reload | NO VERIFICADO |
| SPOT configuración de riesgo | \`sgAllowUnderMin\`, SG, spread, timestop, router, métricas; valor UI vs valor resuelto | NO VERIFICADO |
| Exchange | \`tradingExchange\`, \`dataExchange\`, conexión real, comisiones, pares, fallback, provenance | NO VERIFICADO |
| Velas | último timestamp 5m/15m/1h/4h, venue, TTL real, DB fallback, autocache, decisión ante stale | NO VERIFICADO |
| IDCA | GET config, controls, asset configs y GET config/effective por par; modo, toggle, ATRP, safetyOrders, trailing y límites | NO VERIFICADO |
| Grid | GET config/status/monitor/audit y ciclos pendientes; SHADOW MAKER_ONLY, source, freshness, targets, cero órdenes REAL | NO VERIFICADO |
| AMA | GET status/readiness/HWM/mandato/portfolio y kill switch; modo real, schema 080 y autorización | NO VERIFICADO |
| Portfolio común | presupuesto por modo y activo, locks/reservas y deduplicación; simultaneidad entre SPOT/IDCA/Grid/AMA | NO VERIFICADO |
| Fuentes externas | estado/latencia/error/edad efectiva de cada provider; \`enabled\` vs ingestión/filtro | NO VERIFICADO |
| Seguridad API | proxy/red, tokens, autenticación de roles para GET y mutaciones, logs sanitizados | NO VERIFICADO |
| Pruebas | check TS, vitest por módulo, integración DB/staging, tests de configuración y de no-orden | NO EJECUTADAS |

### Checklist de pruebas de software propuesto
1. ConfigService: update y activate deben reflejarse en configuración de TradingEngine **sin reiniciar** o indicarse explícitamente que requieren reinicio.
2. Dry-run SPOT: comparar tabla de bot, JSON avanzado, flags de entorno y ruta de ejecución efectiva; fail-closed ante conflicto.
3. Mercado: feed declarado vs feed usado; fallo de proveedor no produce sustitución de venue de trading ni dato stale etiquetado FRESH.
4. IDCA: slider entrada → valor derivado → llamada al gate → motivo de aceptación/rechazo; ATRP ON/OFF.
5. Grid: modo SHADOW, maker-only, rangos anteriores y obligaciones SELL no se alteran; no órdenes REAL.
6. AMA: gateway **no devuelve éxito** si no existe orden confirmada; reservar capital no es ejecutar; aislar REAL hasta implementar y verificarlo.
7. Cartera: dos motores pretendiendo gastar los mismos USD, reservas y locks atómicos, reconciliación tras reinicio.
8. API: acceso sin credenciales a rutas de mutación debe fallar; confirmar en infraestructura real y con pruebas de integración protegidas.
9. Logs: ninguna respuesta API con tokens/secretos/balances sensibles queda en logs completos.
10. Migraciones de startup y jobs: no alteran histórico fuera de alcance; no ejecutar ninguna durante simple auditoría.

## 8. Decisión, prioridad y siguiente fase

**No se autoriza ningún cambio de estrategia ni paso a REAL con esta auditoría estática.** La prioridad es:
1. **P0:** bloquear en diseño la falsa ejecución AMA; revisar autorización API efectiva antes de exponer modos reales; verificar ausencia de claves efectivas públicas.
2. **P1:** unificar/determinar \`dryRunMode\`, hot-reload de ConfigService, evitar fallback silencioso de venue, y exigir timestamps de velas/ticker válidos.
3. **P1:** probar reserva de cartera entre motores y configuración efectiva de IDCA/Grid/AMA.
4. **P2:** corregir rutas duplicadas, etiquetar fuentes conceptuales/no operativas y retirar código heredado *solo tras* inventario de dependencias.

**Acción siguiente recomendada:** contraauditoría técnica READ-ONLY de runtime en staging y pruebas locales sin cambios de código, seguida de informe de discrepancias campo por campo con evidencia; si se detecta falla de acceso/seguridad, suspender activación REAL. Se necesita acceso read-only funcional al entorno y a logs **sin copiar credenciales**. El TCP de staging/SSH no fue accesible en esta sesión, por lo que el estado operativo no se puede certificar.

**Cambios realizados en esta tarea:** únicamente documentación de auditoría en GitHub. **Cero cambios** en código de trading, VPS, DB, configuración, ciclos u órdenes.
