# EVIDENCIAS — Issue #20 (Revisión 2)

Todas las lecturas se hicieron desde el equipo local por SSH. En la DB se usó `BEGIN READ ONLY` + `default_transaction_read_only=on` + `statement_timeout=8000` + `lock_timeout=1000`, y se terminó siempre con `ROLLBACK`. No se ha publicado ningún valor secreto, saldo, orden individual, IP privada ni volcado de logs. No hubo POST ni invocación de endpoints mutativos. Única excepción a "cero escrituras": E-099.

Plantilla de consulta: `docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=8000 -c lock_timeout=1000' <db> psql -X -A ... <<< "BEGIN READ ONLY; <SELECT>; ROLLBACK;"`. Se verificó `current_setting('transaction_read_only')=on`.

## Versiones y runtime
| ID | UTC | Comando (saneado) | Resultado |
|---|---|---|---|
| E-001 | 12:05Z | `git fetch origin; git rev-parse origin/main` (local) | `47d79db3f7065e0e54481447129f2f88e9225fe2` |
| E-002 | 12:08Z | VPS `cd /opt/krakenbot-staging && git rev-parse HEAD; git rev-parse --abbrev-ref HEAD; git status --porcelain \| wc -l` | `3ae18319…`, `integration/staging-spot-v4`, 4 untracked (artifacts/, audits/, backups/, spotReplayRunner.ts) |
| E-003 | 12:08Z | `docker ps`; `docker inspect --format` limitado a State/RestartCount/Cmd/Mounts/Ports (sin env) | app: StartedAt 2026-11-24T22:46:54Z, RestartCount 17529, unless-stopped, 0.0.0.0:3020→5000; imagen creada 2026-09-20T11:12:20Z |
| E-004 | 12:09Z | `md5sum` de 7 ficheros en `/app` frente a `git show 3ae1831:<f> \| md5sum` | 7/7 coinciden (ExchangeFactory, MarketDataService, MarketMetricsEngine, IdcaEngine, market.routes, gridIsolatedEngine, RevolutXService) |
| E-005 | local | `git merge-base --is-ancestor 3ae1831 origin/main`; `git rev-list --count` en ambos sentidos | NO ancestro; 101 commits solo en runtime, 43 solo en main |
| E-006 | 12:10Z | `kraken-bot-app`: ps, logs agregados; DB `kraken-bot-db` read-only (booleanos) | sin claves, `is_active=f`, error recurrente `relation telegram_chats does not exist` |

## Seguridad
| ID | Evidencia | Resultado |
|---|---|---|
| E-010 | `SELECT (kraken_api_key<>'') ..., kraken_connected, kraken_enabled, (revolutx_*<>''), revolutx_connected, revolutx_enabled, trading_exchange, data_exchange, active_exchange FROM api_config` | Kraken: key/secret presentes, connected=t, enabled=t. RX: presentes, t, t. trading=revolutx, data=kraken, active=revolutx |
| E-011 | `docker exec … sh -s` que imprime solo `TRADING_ENABLED, NODE_ENV, DRY_RUN*, LOW_API, ENV_TAG, REVOLUTX_ENABLED` y los **nombres** de variables que casan con proveedores | TRADING_ENABLED=__UNSET__, NODE_ENV=production. Nombres: solo `REVOLUTX_SYNC_ENABLED` (sin COINGLASS/WHALE/COINMETRICS) |
| E-012 | `ss -ltn`; `iptables -S DOCKER-USER`; `iptables -t nat -S DOCKER`; **un** `curl -m 8 http://<ip-publica>:3020/` (GET a la raíz estática) desde fuera | 3020 escucha en 0.0.0.0/[::]. DOCKER-USER `--dport 3020 -j DROP` en ens6, pero el DNAT reescribe a :5000 y la regla no actúa. Respuesta externa **HTTP 200 en 0,07 s**. :3000 externo → sin respuesta |
| E-013 | `SELECT market_metrics_config, is_active, dry_run_mode, spot_execution_mode … FROM bot_config` | `{"mode":"activo","enabled":true,"applyToBuy":true,"applyToSell":true,"sensitivity":"conservador","stalenessMaxMs":{…}}`, actualizado 2026-11-26 22:46Z |
| E-014 | `institutional_dca_config` / `grid_isolated_configs` (columnas de modo y política) | IDCA enabled=t mode=live smart=t btcGate=t. GRID BTC/USD SHADOW MAKER_ONLY taker_fallback=t protective_taker=t |
| E-020 | logs: `grep "POST /api/trade\|placeOrder\|[LIVE][SELL] Placing"` (IDs y cantidades redactados) | 1 venta IDCA live en Revolut X 2026-11-27T02:46Z (filled, pendingFill). 0 `POST /api/trade` (la coincidencia era `/api/trades/sync-revolutx`) |
| E-021 | logs: `grep -A4 "signedGetJson error: {"`, agregado por path | 5 paths × 1143 = 5715, todos `401 Unauthorized` |
| E-022 | logs: líneas `[revolutx]` normalizadas y agregadas | Balances fetched 1167; getFills 401 210; getFills 429 66; listPrivateTrades 429 66; placeOrder 1 |
| E-023 | logs GRID | `[GRID_SHADOW_EXECUTION_PRICE] … (ticker_last)`, source GRID_ISOLATED, mode SHADOW |
| E-024 | logs `[MDS]` agregados | p. ej. BTC price 2621 hit / 110 miss; 1h 2283 hit / 14 miss; 1 `REST request timed out` (getOHLC 4h) → 1 USING_DB_FALLBACK |
| E-025 | logs `[express] GET` agregados por ruta | 20 `GET /api/prices/portfolio` en la ventana |
| E-026 | logs | `SPOT runtime owner is active … Legacy new entries DISABLED. Supervisor-only mode.` |
| E-030 | `SELECT exchange, origin, count(*), max(date) FROM trades GROUP BY 1,2` | kraken/sync 239, último 2026-01-10. revolutx engine/spot_engine/sync |
| E-031 | `institutional_dca_orders` agregado por mode/side/has_exchange_id; ciclos simulation | simulation: 6 buys, 0 sells con id. live sells: 5 con id, 34 sin id (final_sell 24 hasta 2026-11-27) |
| E-032 | `institutional_dca_events` entry_check_blocked 7d, `jsonb_array_elements(payload_json->'blockReasons')` | 2687 eventos. market_score_too_low 1909 (ETH 1320, BTC 589), insufficient_dip 1545, … ventana 2026-11-20T20:47Z → 2026-11-27T12:14Z |
| E-050…E-060 | Referencias de código @3ae1831 (idénticas en main salvo indicación) | E-050 market.routes.ts:278-330. E-051 index.ts:30-60 sin auth (auth solo en admin.routes/WS). E-052 routes.ts:587- active-exchange. E-053 ExchangeFactory.ts:22-28, 37-51, 168-212. E-054 IdcaEngine.ts:198-307 (placeOrder L232-233 sin guard de modo). E-055 gridCapitalAllocator.ts:64-88. E-056 RevolutXService.ts:182-331, 486-527, 561-619. E-057 MarketCandleRepository.ts:85-141 (runtime normaliza; main no). E-058 IdcaEngine.ts:4255-4335, 4720-4790. E-059 MarketDataService.ts:92-104, 148-212, 325-418, 463-538, 620-770. E-060 gridIsolatedTypes.ts:133-139, 206-223; `git grep gridExecutionService` = sin importadores |

## Datos de mercado / métricas
| ID | Consulta | Resultado |
|---|---|---|
| E-015 | `market_metrics_snapshots` últimos 7 días, agregado por source/metric/asset (n, min/max ingest, max tsProvider, min/avg/max) | Binance OI y funding 44/símbolo. OI BTC 5.41e9–6.11e9 USDT. Funding BTC −0.0061…0.0099 %. tsProvider funding 08:00Z frente a ingest 12:00Z. DeFiLlama 44 (BUSD/GUSD/USDP 132). Sin filas de CoinMetrics/Whale/CoinGlass |
| E-016 | `SELECT count(*), min(ts), max(ts) FROM market_metrics_evaluations` | **0 filas** |
| E-017 | snapshots de OI BTC por semana (histórico) | ~45–100/semana hasta 2026-08-24; 1738–3741/semana del 2026-08-31 al 10-05 y del 11-02 al 11-16; 30 la semana del 11-23 |
| E-018 | logs MarketMetrics | 4 refresh/ventana; coinmetrics "no disponible en tier gratuito" (BTC/ETH/SOL/XRP) |
| E-033 | `market_candles` agregado por pair/timeframe/source (n, min/max open_time, 1970, futuras, abiertas, vol NULL/0, OHLC inválido); `pg_total_relation_size`; índices | ver CALIDAD Q-001…Q-004. 733 MB, ~112k filas |
| E-034 | `lag(open_time)` por partición | 0 pasos irregulares |
| E-035 | `institutional_dca_ohlcv_cache` agregados | 606 filas de 1970 por par, creadas 2026-03-18..04-12 |
| E-036 | Documentación oficial de Kraken OHLC (consultada 2026-11-27) | 720 entradas; la última siempre sin cerrar; intervalos 1…21600 |

## Fixtures locales (E-040…E-044)
- Fichero: [fixtures/marketDataAudit.fixture.ts](fixtures/marketDataAudit.fixture.ts). Para ejecutarlo hay que copiarlo a `server/__audit20__/marketDataAudit.test.ts` en un checkout de `3ae1831`. Importa los módulos **reales** `MarketMetricsEngine`, `MarketMetricsTypes` e `IdcaSmartLayer` (puros, sin red, credenciales ni DB).
- Comando: `AUDIT20_CANDLES=<psv local> npx vitest run server/__audit20__/marketDataAudit.test.ts` → **12/12 pasados** (2026-11-27 ~13:18 hora local), vitest del repo.
- La muestra histórica (E-041) usa 718 velas 1h BTC/USD públicas de Kraken leídas de `market_candles` (SELECT read-only, 30 días). El fichero queda local y **no se publica**; solo se publican agregados.
- Resultados (`AUDIT20_RESULTS`):
  - E-040a OI: abs → 1 punto; 15 → 1; 14.9 → 0.
  - E-040b funding: TON con BTC stale de 10 h → 2 puntos; BTC → 0 ("desactualizado").
  - E-040c: NaN → 0 "normal"; todo stale → available=true, PERMITIR "Condiciones de mercado favorables"; valores runtime → score 1 PERMITIR; máximo alcanzable → 4 MEDIO AJUSTAR.
  - E-041 BTC score para ETH: |Δ| p50=1, p95=2, máx=3; 8/519 cruces del umbral 50.
  - E-042: volumen fijo → 66 frente a 71 (×3) y 62 (×0,2); ratio real p05=0.229, p50=0.722, p95=3.091.
  - E-043 EMA: diferencia relativa 0.235 % (i=49), 0.031 % (i=99), 9.5e-6 % (i=299).
  - E-044: RSI diferencia 0; ATR SMA 2.7500 frente a Wilder 2.7444 (0.20 %).

## E-099 — Incidente: escritura involuntaria en el VPS (comunicado, revertido)
- **Qué:** al preparar una agregación de logs ejecuté por error una redirección de shell en el VPS: `docker logs -t krakenbot-staging-app > /tmp/.ignore_never_written`. Creó un fichero de 177 245 580 bytes en `/tmp` del host (mtime 2026-11-27 12:11:50Z) con el log completo del contenedor.
- **Corrección:** lo detecté en el paso siguiente. Hice `rm -f -- /tmp/.ignore_never_written` y verifiqué su ausencia a las 12:12:02Z (unos 12 s después).
- **Alcance:** solo `/tmp` del host. Sin cambios en app, DB, contenedores, configuración ni otros ficheros.
- **Medida posterior:** todas las agregaciones siguientes se hicieron por tubería a stdout local, sin redirecciones en el VPS. Es contrario al requisito de cero escrituras y lo dejo registrado para la evaluación de TANGO.

## Diff documental
Solo ficheros nuevos en `AUDITORIAS/MARKET_DATA_2026-11-27/` y una entrada breve en `BITACORA.md`. Sin código operativo. Verificado con `git diff --check` y revisión de secretos (ver comentario del commit/PR).

## Tareas y pendientes
| Tarea | Estado | Motivo / siguiente paso |
|---|---|---|
| P0 seguridad (rutas, venue, LOW_API) | HECHO (estático + runtime) | R8/R9 IDCA ExecutionManager/ExitExecutor: modo de los llamantes NO_VERIFICADO |
| Inventario de fuentes runtime | HECHO | F-005, F-012, F-020 NO_VERIFICADO |
| Trazabilidad de consumidores | PARCIAL | AMA y SPOT V4 (C-022) NO_VERIFICADO |
| Calidad / fixtures | HECHO para EMA/RSI/ATR/score/MM | VWAP anclado, Bollinger, MACD NO_VERIFICADO |
| LOW_API 7 días | NO_VERIFICADO | Docker solo retiene 28,5 h; `server_logs` no consultado |
| Permisos de la clave Kraken | NO_VERIFICADO | lo revisa el propietario en el panel |
| Causa de los 17 529 reinicios | NO_VERIFICADO | análisis de logs de arranque en otra sesión |
| IPv6 :3020 externo | NO_VERIFICADO | — |
| Comentarios en Issue #20 y PR | **BLOQUEADO** | `gh` sin autenticar en este equipo (`gh auth login` o GH_TOKEN). La rama se sube por SSH |
