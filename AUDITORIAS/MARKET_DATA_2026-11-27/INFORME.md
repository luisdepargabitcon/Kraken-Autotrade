# PROTOCOLO 1 — Auditoría integral de Market Data, fuentes, indicadores y seguridad LOW_API (Issue #20, Revisión 2)

- **Fecha de ejecución (UTC):** 2026-11-27 12:08Z – 12:25Z (lecturas VPS) · redacción 12:20Z– · **continuación TANGO 2026-11-27 tarde (solo análisis local/estático, sin nuevo acceso al VPS)**
- **Tipo:** SOLO AUDITORÍA. Sin cambios operativos, sin órdenes, sin POST, sin SQL de escritura.
- **Estado:** **SIN APROBAR** — continuación tras contraauditoría TANGO; pendiente de nueva revisión TANGO (ver §9 para lo que falta).
- **Saneamiento (TANGO):** el repositorio es público. Esta versión retira detalle operativo de red, topología y reproducción de la exposición que figuraba en la primera publicación. El detalle necesario para la contención se traslada al propietario por canal privado. Los IDs de hallazgos no cambian.
- **Documentos hermanos:** [FUENTES.csv](FUENTES.csv) · [FLUJO_CONSUMIDORES.csv](FLUJO_CONSUMIDORES.csv) · [CALIDAD_INDICADORES.csv](CALIDAD_INDICADORES.csv) · [SEGURIDAD_LOW_API.md](SEGURIDAD_LOW_API.md) · [EVIDENCIAS.md](EVIDENCIAS.md) · [PLAN_CORRECCION.md](PLAN_CORRECCION.md)
- **Etiquetas:** CONFIRMADO_CODIGO (ruta:líneas@SHA), CONFIRMADO_RUNTIME (UTC + evidencia saneada), MEDIDO (ventana/denominador/método), HIPOTESIS, NO_VERIFICADO.
- **IDs:** F-xxx fuentes, H-xxx hallazgos, E-xxx evidencias (definidas en EVIDENCIAS.md). Severidad (P0–P3) y confianza (Alta/Media/Baja) son ejes separados.

## 0. Resumen ejecutivo

1. **P0 — Ruta de ejecución alcanzable en Kraken desde Internet (H-001, H-002, H-003).** El runtime expone `POST /api/trade`, que llama directamente a `krakenService.placeOrder` (market.routes.ts:278-330@3ae1831). No pasa por ExchangeFactory ni hay autenticación. El único guard es `TRADING_ENABLED`, que en el contenedor **no está definida**, de modo que vale `true` por defecto (E-011). Las claves privadas de Kraken **existen** en `api_config` y constan como `kraken_connected=t` y `kraken_enabled=t` (E-010). La aplicación **responde desde Internet** (verificado con una única lectura GET, E-012; detalle de red omitido a propósito en esta versión saneada). No se ha reproducido ni probado la llamada mutativa. Tampoco se ha verificado si la clave de Kraken tiene permiso de trading (NO_VERIFICADO — lo confirma el propietario en el panel). Desde 2026-01-10 no consta ningún trade en Kraken (E-030). Se comunicó al propietario de inmediato en la sesión. La propuesta de contención por fases está en SEGURIDAD_LOW_API.md §5 y requiere autorización aparte.
2. **P0 latente — IDCA `executeExit` llama a `placeOrder` en cualquier modo (H-005).** Si IDCA pasara a `simulation`, una salida (TP, BE o TimeStop) enviaría una **venta market real** al exchange de trading. Hoy IDCA está en `live` (E-014). No hay evidencia de que haya ocurrido: las órdenes de simulación no tienen `exchange_order_id` (E-031).
3. **P0/P1 — ExchangeFactory tiene Kraken como valor por defecto y como fallback silencioso (H-004).** Si Revolut X no está inicializado, `getExchange('revolutx')` devuelve Kraken. Hoy el runtime opera en Revolut X: `trading_exchange=revolutx` (E-010) y el último fill real ha sido en Revolut X (E-020).
4. **Lo que se ejecuta en el VPS no es `main` (H-008).** El contenedor `krakenbot-staging-app` corre una imagen del 2026-09-20 construida desde `3ae1831` (`integration/staging-spot-v4`). Ese commit **no desciende** de `main@47d79db`: hay 101 commits en runtime que no están en `main` y 43 en `main` que no están en runtime. Los ficheros auditados coinciden por md5 con `3ae1831` (E-004). Lleva **17 529 reinicios** acumulados (E-003). Todos los hallazgos se han verificado sobre `3ae1831`, señalando las diferencias con `main`.
5. **LOW_API degradado (H-006, H-007).** En una ventana de 28,5 h (E-021, E-022):
   - En modo SHADOW, el GRID llama en cada tick de planificación a `getBalance` y `getTicker` de Revolut X (gridCapitalAllocator.ts:64-88). Son unas 1 143 rondas con 5 GET firmados cada una, y **las 5 715 dieron 401**.
   - Hubo 66 respuestas 429 en `listPrivateTrades` y 66 en `getFills`.
   - La cola de rate-limit solo cubre `getBalance`. No se tiene en cuenta `Retry-After`.
6. **Market Metrics: se ingiere pero no decide nada (H-013).** La configuración está en `enabled=true`, `mode=activo`, `applyToBuy` y `applyToSell` a true (E-013). `market_metrics_evaluations` tiene **0 filas en toda su historia** (E-016). Precisión TANGO: cero evaluaciones **persistidas** no equivale a cero invocaciones — el gate `applyMarketMetricsGate` solo se invoca desde el pipeline de entrada del SPOT legacy (tradingEngine.ts:4480 y 5672), que está deshabilitado (supervisor-only, E-026), así que la ausencia de filas es consistente con **cero invocaciones**; no se ha encontrado ninguna otra vía de invocación ni evidencia de llamadas con fallo de persistencia. IDCA, GRID y SPOT V4 **no** consumen el gate en absoluto (búsqueda estática exhaustiva). Es decir: el módulo está "activo" en configuración pero no tiene consumidor efectivo alguno.
   - Binance Futures y DeFiLlama funcionan.
   - CoinMetrics no devuelve datos (tier gratuito), Whale Alert y CoinGlass no tienen credencial.
   - Defectos confirmados en el motor (fixtures, E-040):
     - El OI se guarda en USDT absolutos y se compara con un umbral de +15 %, así que suma 1 punto siempre que el dato es fresco (H-010).
     - El funding de BTC se usa como fallback de otros activos, pero la frescura se mide con la clave del activo pedido (H-011).
     - Con todos los datos stale, la decisión sale "favorable" (H-012).
     - Alcance limitado (TANGO): la afirmación "BLOQUEAR inalcanzable" aplica **únicamente** al conjunto de proveedores operativos hoy (Binance OI/funding + DeFiLlama) y a la sensibilidad `conservador` evaluada en el fixture; con más proveedores activos otra sensibilidad podría alcanzar niveles superiores (H-012).
7. **IDCA: el score de mercado es el bloqueo más frecuente y tiene dos defectos medidos (H-016, H-017).** `market_score_too_low` aparece en 1 909 de los 2 687 eventos de bloqueo de los últimos 7 días (ETH 1 320, BTC 589; E-032). Precisión TANGO: los eventos de bloqueo pueden llevar varios motivos a la vez; el recuento **no demuestra causalidad económica ni que sea el motivo exclusivo** de cada bloqueo.
   - En el score de BTC usado como input para ETH, la EMA50 es en realidad la EMA20 previa. Sobre 718 velas 1h reales, la diferencia es de |Δ| p50=1, p95=2 y máx=3 puntos, y en 8 de 519 ventanas el **score de BTC en aislamiento** cruza el umbral 50. Matiz TANGO: esto NO significa 8 compras de ETH modificadas; el efecto final sobre el score de ETH depende del peso `btc_condition` y del resto de componentes, y no se ha medido el impacto en decisiones reales de compra.
   - El volumen relativo está fijo en 1/1, de modo que el componente siempre vale 50. El ratio real va de 0,23 (p05) a 3,09 (p95).
8. **Calidad de velas: correcta en runtime, regresión en `main` (H-009, H-020).** `market_candles` está completa y sin huecos: 0 pasos irregulares, 0 filas de 1970, 0 timestamps futuros y una sola fuente, kraken (E-033, E-034). Pero:
   - `main` elimina la normalización s/ms de `MarketCandleRepository`. Desplegar `main` volvería a escribir velas fechadas en 1970.
   - `institutional_dca_ohlcv_cache` ya tiene 606 filas de 1970 por par, escritas entre marzo y abril de 2026 (E-035).
9. **Incidente propio, ya revertido (E-099).** Por un error de redirección escribí 177 MB de logs del contenedor en `/tmp` del VPS (2026-11-27 12:11:50Z). Lo detecté y borré en unos 12 s; el borrado quedó verificado. No afectó a la aplicación, a la DB ni a otros ficheros. Lo registro para que se evalúe.

## 1. Versiones GitHub / VPS (E-001…E-005)

| Elemento | Valor | Etiqueta |
|---|---|---|
| main GitHub verificado | `47d79db3f7065e0e54481447129f2f88e9225fe2` (2026-11-20) | CONFIRMADO_CODIGO |
| Rama documental | `audit/market-data-sources-20261127` desde `origin/main@47d79db` | — |
| Checkout VPS `/opt/krakenbot-staging` | `3ae18319b8c0b68c9374241db65f8ef9bdd39a57`, rama `integration/staging-spot-v4`, 4 untracked | CONFIRMADO_RUNTIME 12:08Z |
| Imagen `krakenbot-staging-krakenbot-staging-app` | creada 2026-09-20T11:12:20Z; `dist/index.cjs` 2026-09-20 | CONFIRMADO_RUNTIME |
| Contenedor | StartedAt 2026-11-24T22:46:54Z, RestartCount=17529, policy unless-stopped | CONFIRMADO_RUNTIME |
| Ficheros fuente en `/app` vs `3ae1831` | md5 idénticos en 7/7 ficheros auditados | CONFIRMADO_RUNTIME |
| `VERSION` en contenedor | `1560557` (no coincide con el SHA; dato obsoleto) | CONFIRMADO_RUNTIME |
| Relación `3ae1831`↔`main` | no es ancestro; 101 commits solo en runtime, 43 solo en main | CONFIRMADO_CODIGO |
| Segunda instancia `kraken-bot-app` | node:20-alpine, código antiguo, sin credenciales, `is_active=f`, puerto 3000 no accesible desde fuera (H-026) | CONFIRMADO_RUNTIME |

Diferencias de `main` respecto a runtime en los módulos auditados: `MarketDataService.ts` (−97 líneas en main), `MarketCandleRepository.ts` (main sin normalización), `RevolutXService.ts`, `routes.ts` y GRID (main sin V3.1/V3.2, sin protective taker). Son **idénticos** en ambos `ExchangeFactory.ts`, `kraken.ts`, `IdcaEngine.ts`, `IdcaSmartLayer.ts`, `marketMetrics/**` y `market.routes.ts` (comprobado con `git diff --stat`).

## 2. Tabla compacta proveedor → uso (ver FUENTES.csv)

| ID | Proveedor/recurso | Integrado | Configurado | Operativo (ventana) | Última observación válida | Modo métricas | Uso por motor |
|---|---|---|---|---|---|---|---|
| F-001 | Kraken REST público (Ticker/OHLC) | Sí | dataExchange forzado kraken | OPERATIVA (1 timeout/28,5h) | velas 5m 12:05Z | — | IDCA, GRID (referencia), SPOT, AMA, UI |
| F-002 | Kraken REST privado | Sí | claves presentes, connected/enabled=t | NO_UTILIZADA para trading (último trade 2026-01-10); FISCO lecturas | NO_VERIFICADO | — | FISCO (lectura), **/api/trade (capacidad de orden)** |
| F-003 | Revolut X privado (órdenes/fills/balances) | Sí | trading/active=revolutx | DEGRADADA (429 en fills/trades) | fill real 02:46Z | — | IDCA live, SPOT, GRID (balance), FISCO sync |
| F-004 | Revolut X "ticker" (orderbook/trades) | Sí | — | SIN_DATOS (401 en 5715/5715) | ninguna | — | GRID capitalAllocator, /api/prices/portfolio |
| F-006/007 | Binance Futures OI / funding | Sí | activo si no hay COINGLASS_API_KEY | OPERATIVA (44/7d/símbolo) | OI 11:55Z, funding 08:00Z | activo (sin evaluar) | NO_UTILIZADA |
| F-008 | DeFiLlama stablecoins | Sí | gratuito | OPERATIVA con calidad dudosa | 12:00Z | activo (sin evaluar) | NO_UTILIZADA |
| F-009 | CoinMetrics community | Sí | gratuito | SIN_DATOS (tier gratuito) | nunca | — | NO_UTILIZADA |
| F-010 | Whale Alert | Sí | sin clave | SIN_CREDENCIAL | nunca | — | NO_UTILIZADA |
| F-011 | CoinGlass | Sí | sin clave | SIN_CREDENCIAL (no instanciado) | nunca | — | NO_UTILIZADA |
| F-012 | CoinGecko | Sí | gratuito | NO_VERIFICABLE (sin log de éxito/fallo) | NO_VERIFICADO | — | UI cartera, FISCO EUR |
| F-013 | BCE (EUR) | Sí | gratuito | fuera de alcance (FISCO) | — | — | FISCO |

**Granularidad de FUENTES.csv (justificación TANGO):** las filas agrupan pares/timeframes cuando el conector, la configuración y el comportamiento en runtime son idénticos (p. ej. Kraken OHLC cubre los 5 pares y 5 timeframes con el mismo código y TTL por timeframe). Se separan en filas distintas cuando difieren estado operativo, credencial, unidad o consumidores (F-001 OHLC vs F-001b Ticker; F-003 privado vs F-004 ticker firmado 401). Excepciones declaradas: F-012 CoinGecko y F-020 ML quedan a nivel recurso por falta de evidencia de runtime; F-018 research es offline. Dentro de cada fila, la columna `par_o_activo` y `timeframe` enumeran el desglose completo.

## 3. Arquitectura AS-IS (runtime 3ae1831)

```
Kraken REST público ─► kraken.ts(getTicker/getOHLC, KrakenRL) ─► MarketDataService (cache memoria TTL, single-flight)
                                                                  ├─► persistCandles ─► market_candles (DB, source=kraken)
                                                                  ├─► getFreshTickerSnapshot (fail-closed, procedencia) ─► GRID referencia
                                                                  ├─► getPrice/getTicker (stale-on-error, 0 si no hay caché) ─► IDCA/SPOT/AMA/UI
                                                                  └─► getCandles (incluye vela en formación) ─► IDCA ohlcCache ─► IdcaSmartLayer(EMA/RSI/ATR/score) ─► GATE entrada IDCA
DB market_candles ─(fallback, ms, sin filtro source, fetchedAt=now)─► MarketDataService
Binance Futures / DeFiLlama / CoinMetrics / WhaleAlert / CoinGlass ─► MarketMetricsService (cron 4h + arranque) ─► market_metrics_snapshots
      └─► getLatestMetrics(metric:asset, edad=tsIngested) ─► MarketMetricsEngine ─► tradingEngine.applyMarketMetricsGate (SPOT legacy, sin entradas → 0 evaluaciones)
Ejecución (último tramo):
  IDCA live ─► ExchangeFactory.getTradingExchange() ─► RevolutXService.placeOrder  (fallback silencioso a Kraken si RX no inicializado)
  SPOT/tradingEngine ─► getTradingExchange().placeOrder (DRY_RUN gate)
  GRID ─► SHADOW simulado; gridExecutionService NO importado (sin órdenes reales posibles)
  HTTP /api/trade ─► krakenService.placeOrder DIRECTO  (sin auth, TRADING_ENABLED por defecto true)
  HTTP /api/trade/revolutx ─► revolutXService.placeOrder DIRECTO (sin auth)
```

## 4. Hallazgos priorizados

| ID | Sev | Conf | Título | Etiqueta | Evidencia |
|---|---|---|---|---|---|
| H-001 | P0 | Alta | `POST /api/trade` envía órdenes a Kraken sin auth; TRADING_ENABLED por defecto true; claves Kraken presentes | CONFIRMADO_CODIGO + CONFIRMADO_RUNTIME (exposición) | E-010, E-011, E-012, E-050 |
| H-002 | P0 | Alta | La API de la aplicación responde desde Internet sin autenticación pese a la regla de firewall existente (detalle de red omitido a propósito; en canal privado); afecta a todas las rutas mutativas (`/api/trade/revolutx`, `/api/config/*`, positions, IDCA, grid) | CONFIRMADO_RUNTIME | E-012, E-051 |
| H-003 | P0 | Alta | `POST /api/config/active-exchange` admite `kraken` como trading | CONFIRMADO_CODIGO | E-052 |
| H-004 | P0/P1 | Alta | ExchangeFactory: Kraken por defecto y fallback silencioso a Kraken si Revolut X no está inicializado | CONFIRMADO_CODIGO | E-053 |
| H-005 | P0 latente | Alta | IDCA `executeExit` hace placeOrder real en cualquier modo; cierra ciclo sin confirmación fuera de live | CONFIRMADO_CODIGO; sin ocurrencia observada | E-054, E-031 |
| H-006 | P1 | Alta (código) / Media (atribución) | GRID SHADOW consulta getBalance+getTicker de Revolut X en cada planificación; 5 715 GET 401/28,5h | CONFIRMADO_CODIGO + MEDIDO (correlación) | E-021, E-055 |
| H-007 | P1 | Alta | Rate-limit Revolut X parcial (solo getBalance en cola, sin Retry-After); 429 en fills/trades | CONFIRMADO_CODIGO + MEDIDO | E-022, E-056 |
| H-008 | P1 | Alta | Runtime ≠ main; 17 529 reinicios; VERSION obsoleto | CONFIRMADO_RUNTIME | E-001…E-005 |
| H-009 | P1 | Alta | `main` elimina la normalización s/ms de MarketCandleRepository (regresión al desplegar) | CONFIRMADO_CODIGO | E-057 |
| H-010 | P1 | Alta | OI absoluto (USDT) comparado con umbral de cambio 15 % → 1 punto permanente si fresco | CONFIRMADO_CODIGO + fixture + datos | E-040a, E-015 |
| H-011 | P1 | Alta | Fallback de funding BTC con staleness del activo pedido; edad medida por tsIngested, no tsProvider | CONFIRMADO_CODIGO + fixture + datos | E-040b, E-015 |
| H-012 | P2 | Alta | Todo stale → available/PERMITIR "favorable"; NaN se trata como "normal"; con los proveedores operativos y la sensibilidad evaluadas el máximo alcanzable es 4 (BLOQUEAR fuera de alcance **en ese conjunto**) | fixture (alcance limitado al conjunto evaluado) | E-040c |
| H-013 | P1 | Alta | Market Metrics activo en config pero sin consumidor efectivo: el gate solo se invoca desde el SPOT legacy deshabilitado; 0 evaluaciones persistidas es consistente con 0 invocaciones | CONFIRMADO_RUNTIME + CONFIRMADO_CODIGO | E-013, E-016, E-061 |
| H-014 | P2 | Media | Ráfagas de ingesta (~3,7k snapshots/semana frente a ~42 esperadas con cron 4h); 997 624 snapshots acumulados. La atribución a reinicios es HIPOTESIS (cron de arranque + cron 4h solapados); no verificada contra los 17 529 reinicios | MEDIDO (volumen); causa HIPOTESIS | E-017 |
| H-015 | P2 | Media | DeFiLlama: símbolos duplicados (3 filas por refresh), valores extremos GUSD; clave sin source | MEDIDO | E-015 |
| H-016 | P1 | Alta | IDCA: EMA50 de BTC para ETH = EMA20 previa | CONFIRMADO_CODIGO + MEDIDO | E-041, E-032 |
| H-017 | P1 | Alta | IDCA: volumen relativo fijo 1/1 (componente constante 50) | CONFIRMADO_CODIGO + MEDIDO | E-041, E-042 |
| H-018 | P2 | Alta | IDCA: usa la vela en formación; EMA semilla=primer valor; EMA50 con periodo reducido si hay menos de 50 velas | CONFIRMADO_CODIGO + fixture | E-043, E-058 |
| H-019 | P3 | Alta | ATR es SMA del TR (no Wilder), 0,2 % sintético; RSI coincide con Wilder | fixture | E-044 |
| H-020 | P1 | Alta | Mezcla s/ms entre Kraken (s) y fallback DB (ms); `upsertOhlcv c.time*1000` incondicional; 606 filas de 1970 por par | CONFIRMADO_CODIGO + CONFIRMADO_RUNTIME | E-035, E-058 |
| H-021 | P2 | Alta | Fallback DB sin filtro source y con fetchedAt=now (parece fresco); hoy una sola fuente | CONFIRMADO_CODIGO + RUNTIME | E-033, E-059 |
| H-022 | P1 | Alta | `getPrice` devuelve 0 en error sin caché; getPrice/getTicker devuelven stale sin metadatos (también en FISCO rebuild); solo GRID usa fail-closed | CONFIRMADO_CODIGO | E-059 |
| H-023 | P2 | Media | TTL 1h=90 min y 4h=4 h: la última vela cerrada puede tener ~2,5 h / ~8 h; PRICE_TTL 45 s frente a BITACORA 30 s | CONFIRMADO_CODIGO + MEDIDO parcial | E-034, E-059 |
| H-024 | P2 | Alta | GRID SHADOW: el protective taker efectivo = valor guardado (true) en runtime; REAL bloqueado; gridExecutionService no conectado | CONFIRMADO_CODIGO + RUNTIME | E-014, E-060 |
| H-025 | P2 | Media | 34/39 ventas IDCA live sin `exchange_order_id` en la tabla de órdenes. Matiz TANGO: esto no equivale a órdenes inexistentes — exige contraste con la reconciliación (fills/closed orders del venue) antes de cualquier conclusión; la causa es HIPOTESIS | MEDIDO; causa HIPOTESIS | E-031, E-020 |
| H-026 | P3 | Alta | Contenedor legacy `kraken-bot-app` vivo (sin credenciales, inactivo) | CONFIRMADO_RUNTIME | E-006 |
| H-027 | P3 | Baja | `market_candles` ocupa 733 MB para 112k filas. Matiz TANGO: el bloat por upserts es HIPOTESIS, no causa verificada (no se midió dead tuples ni rellenado de índices) | MEDIDO (tamaño); causa HIPOTESIS | E-033 |
| H-028 | P1 | Alta | `POST /api/positions/:pair/close` no tiene guard `TRADING_ENABLED` ni `confirm` (asimetría con buy); hoy mitigado por dryRun=t. Es acción de reducción de riesgo: la contención no debe bloquearla, sino autenticarla y auditarla | CONFIRMADO_CODIGO | E-062 |
| H-029 | P3 | Alta | VWAP anclado correcto frente a referencia independiente (diff=0 en fixtures); sigma con ventana extendida deliberada; vwap semanal/mensual usa reloj de pared | fixture 6/6 | E-045 |
| H-030 | P2 | Alta | Bollinger `percentB` = NaN con precios planos (división 0/0) y se propaga sin guard | fixture | E-045 |
| H-031 | P2 | Alta | MACD de indicators.ts usa ventanas truncadas (EMA12 sobre 12 velas, EMA26 sobre 26): desviación ~30 % y desacuerdo de signo del histograma en 24 % de ventanas sintéticas; consumidor: EntryDecisionContext (SPOT legacy) | fixture | E-045 |
| H-032 | P2 | Alta | Dos RSI distintos conviven: indicators.ts (media simple de toda la historia, hasta 13,4 puntos de desviación, serie plana → 100) usado por SPOT canonical/v3; IdcaSmartLayer Wilder correcto usado por IDCA | fixture + código | E-045 |
| H-033 | P1 | Alta | `IdcaExecutionManager` (órdenes simples/child/TWAP) no tiene guard de modo y usaría `getTradingExchange()` directamente; hoy sin llamador operativo (solo diagnósticos) | CONFIRMADO_CODIGO (latente) | E-063 |
| H-034 | P3 | Alta | AMA real no puede ejecutar: el gateway no cablea la orden al exchange (documentado en el propio código) y no tiene llamadores; SPOT V4 REAL bloqueado en compile-time (`REAL_ACTIVATION_ALLOWED=false`); GRID real solo en modo REAL_* — los tres dependen de cambios futuros | CONFIRMADO_CODIGO | E-063, E-064 |

## 5. Respuestas a los puntos específicos de la Revisión 2

- **Open Interest:** BinanceFuturesProvider guarda `sumOpenInterestValue` (USDT, nivel absoluto: 2,4e8–6,1e9 en 7 días). El motor lo compara con `oiChangePct=15` sin transformarlo antes. En toda la ruta (provider → `saveMarketMetricSnapshot` → `getLatestMetrics` → `evalOpenInterest`) no hay conversión a %. El fixture confirma que 5,7e9 constante puntúa igual que +15 %. No hay equivalencia con CoinGlass: ese provider no está instanciado (H-010).
- **Funding Rate:** la unidad está bien (fundingRate×100 = %), con umbrales de 0,05 % y 0,1 % por periodo de 8 h. El valor absoluto ignora el signo. Para TON, sin dato propio, se usa el de BTC y la frescura se lee de `funding_rate:TON`, que no existe y cuenta como 0 ms: el dato pasa por fresco aunque tenga horas. La edad se mide desde la ingesta: el funding de 08:00Z, ingerido a las 12:00Z, figura con edad 0 (H-011).
- **Frescura:** distinguir dato de ingesta (H-011), caché de MDS (H-022, H-023) y fallback DB con `fetchedAt=now` (H-021). Solo GRID usa `getFreshTickerSnapshot` fail-closed.
- **EMA50:** está mal usada en el score de BTC para ETH (H-016). Con menos de 50 velas el periodo se reduce y basta con 20 (H-018). En runtime normal llegan 720 velas 1h de Kraken (E-058), así que el periodo efectivo es 50.
- **Volumen:** en IDCA está fijo en 1/1 (H-017). Kraken `getOHLC` usa el índice 6, que es el volumen correcto (el 5 es VWAP), según la documentación oficial. MarketMetrics no usa volumen.
- **Procedencia:** `market_candles` tiene source=kraken en el 100 % de los casos. El caché de precios marca `KRAKEN_MARKET_DATA` o `MANUAL_OR_UNKNOWN`, pero `getPrice`/`getTicker` no exponen la procedencia a IDCA/SPOT. Las snapshots de métricas usan la clave `metric:asset`, sin source (H-015).

## 6. Propuesta TO-BE (solo diseño; sin implementar)

1. **Separación dura de venues de ejecución:** un único `ExecutionVenueGuard` server-side, previo a cualquier `placeOrder`/`cancelOrder` (incluidos los clientes directos), con allowlist `{revolutx}`. `krakenService.placeOrder`/`placeOrderRaw`/`cancelOrder` deben lanzar `KRAKEN_EXECUTION_FORBIDDEN` incondicionalmente. Eliminar el fallback de ExchangeFactory: si Revolut X no está inicializado, el resultado debe ser `VENUE_UNAVAILABLE` fail-closed. Retirar `kraken` de `POST /api/config/active-exchange` y del botón de Integrations.
2. **Perímetro HTTP:** la API no debe ser alcanzable desde Internet y el acceso remoto debe ir por un canal autenticado; añadir autenticación a todo `/api` mutativo. Detalle técnico exacto por canal privado. Pendiente de autorización separada (SEGURIDAD_LOW_API.md §5).
3. **Modo explícito en ejecución:** `executeExit` y todos los `placeOrder` IDCA deben exigir `mode==="live"` dentro de la propia función que envía la orden. En `simulation`, registrar una orden simulada.
4. **LOW_API Revolut X:** un scheduler único para todas las llamadas privadas, con prioridades (fills/órdenes/protecciones > balance > histórico), honrar `Retry-After`, circuit breaker por endpoint y caché de balance compartida. Prohibir `getTicker` de Revolut X fuera de la ejecución; valorar el BTC del GRID con Kraken.
5. **Market Data con procedencia:** un contrato `{value, source, venue, tsSource, tsIngested, fresh, isClosed}` en `getCandles`/`getPrice`. Normalizar a ms en la frontera del adapter, no del repositorio. Filtrar el fallback DB por source, devolver su `fetchedAt` real y no incluir velas abiertas en los indicadores.
6. **Market Metrics:** guardar el OI como serie y calcular el Δ% 24h. Medir la edad por `tsProvider` y la cadencia natural. Si falta dato del activo, el resultado debe ser "ausente", no fallback a BTC. Tratar NaN como ausente. Si todo está stale, devolver `available=false`. Decidir si se conecta a IDCA o se retira la UI de "activo". Añadir source a la clave.
7. **Indicadores centralizados:** una librería interna única, con tests de referencia (EMA con semilla SMA, ATR Wilder, RSI Wilder, VWAP anclado), calentamiento mínimo explícito y solo velas cerradas. Preferible a una API externa por coste, latencia y reproducibilidad (§7).

## 7. Alternativas de proveedores (documentación oficial consultada 2026-11-27)

| Proveedor | Par BTC/ETH | OHLCV REST | Profundidad por llamada | Notas |
|---|---|---|---|---|
| Kraken (actual) | BTC/USD, ETH/USD | `/0/public/OHLC` intervalos 1,5,15,30,60,240,1440,10080,21600 | 720 velas; la última siempre en formación | Cubre 30m y 15d. Más histórico vía `/public/Trades` (docs.kraken.com/api-reference/market-data/get-ohlc-data) |
| Coinbase Exchange | BTC-USD, ETH-USD | `/products/{id}/candles` granularidades 60–86400 s | 300 velas | No publica velas sin ticks; no está pensado para polling (docs.cdp.coinbase.com) |
| Bitstamp | btcusd, ethusd | `/api/v2/ohlc/{pair}/` step 60–259200 | 1000 | 400 req/s, 10 000/10 min; `exclude_current_candle` (bitstamp.net/api) |
| Binance Spot | BTCUSDT (no USD) | klines | — | Denominación USDT distinta de USD; restricciones geográficas NO_VERIFICADAS; no mezclar con USD |
| Binance Futures (actual métricas) | BTCUSDT perp | `openInterestHist` | máx 500, solo el último mes, 1000 req/5 min por IP | Unidad USDT (developers.binance.com) |
| Bitfinex | tBTCUSD | candles | NO_VERIFICADO en esta sesión | — |

Recomendación (HIPOTESIS de diseño): mantener Kraken como fuente principal y añadir **Bitstamp o Coinbase solo como contraste** de precio de cierre, en series separadas por venue y sin mezclar volúmenes. Revolut X sigue siendo solo de ejecución.

## 8. Plan priorizado (resumen; el plan completo por fases con pruebas y preservación de la gestión legítima está en [PLAN_CORRECCION.md](PLAN_CORRECCION.md))

| Orden | Hallazgos | Acción | Prueba de aceptación | Reversible |
|---|---|---|---|---|
| 1 | H-001/002/003 | Contención perimetral + guard Kraken + quitar Kraken de active-exchange | GET externo a :3020 sin respuesta; test unitario `krakenService.placeOrder` lanza error; POST active-exchange kraken → 400 | Sí |
| 2 | H-004/H-005 | Fail-closed del venue + modo explícito en executeExit | mocks: RX no inicializado → sin orden; simulation → 0 llamadas a placeOrder | Sí |
| 3 | H-006/H-007 | Scheduler Revolut X + eliminar getTicker en el GRID | contador de requests por endpoint; 0 401 de ticker; 429 → backoff | Sí |
| 4 | H-008/H-009 | Reconciliar runtime y main antes de cualquier deploy; portar normalización | diff runtime/main revisado; test de upsert con segundos → fecha correcta | Sí |
| 5 | H-016/H-017/H-018/H-020/H-022 | Correcciones técnicas de indicadores IDCA (no estrategia) | fixtures de CALIDAD_INDICADORES; replay #19 | Sí |
| 6 | H-010…H-015 | Rediseño de Market Metrics o retirada de "activo" | fixtures E-040 invertidos | Sí |

## 9. Qué falta / NO_VERIFICADO (motivo → impacto → siguiente paso seguro)

Límites de evidencia declarados (TANGO): no se ha vuelto a acceder a producción para completar estos puntos, por evaluación de seguridad; se agotó primero el análisis local y las evidencias existentes.

- **Permisos de la clave Kraken** (trade sí/no): no se pueden comprobar sin llamada privada → no sabemos si H-001 ejecutaría de verdad → el propietario debe revisarlo en el panel de Kraken.
- **Ventana de 7 días de logs:** Docker solo conserva ~28,5 h → las métricas LOW_API cubren esa ventana → evaluar si merece acceso adicional en una fase posterior con plan revisado.
- **Causa de los 17 529 reinicios:** no verificada → no atribuir a ninguna causa concreta (la tormenta de peticiones en arranque es HIPOTESIS) → requiere análisis de logs de arranque en otra sesión.
- **IPv6:** no se ha comprobado la accesibilidad externa por IPv6.
- **Reconciliación de ventas sin `exchange_order_id` (H-025):** pendiente de contraste con fills/closed orders del venue.
- **VWAP/Bollinger/MACD:** ya auditados numéricamente en la continuación TANGO (Q-020…Q-025, fixtures autocontenidos en `fixtures/`). AMA/SPOT V4/GRID trazados de forma estática completa (SEGURIDAD_LOW_API.md §2, R13–R18).

**Estado final: SIN APROBAR — pendiente de nueva revisión TANGO tras la entrega saneada.**
