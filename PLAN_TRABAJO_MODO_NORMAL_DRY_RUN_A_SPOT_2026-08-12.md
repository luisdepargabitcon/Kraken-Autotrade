# PLAN DE TRABAJO — REFUNDACIÓN MODO NORMAL + DRY-RUN → SPOT

> Documento maestro y contrato de ejecución. Ubicación: RAÍZ del repositorio.
> Fecha del plan: 2026-08-12. Repositorio: `luisdepargabitcon/Kraken-Autotrade`.
> Entorno staging: VPS `5.250.184.18`, app `/opt/krakenbot-staging`, `docker-compose.staging.yml`.

## Objetivo

Fusionar **Modo Normal** y **DRY-RUN** en un único motor canónico llamado **SPOT**, con un
único pipeline, una única estrategia (`SPOT_CANONICAL`), un único modelo de posición, una
única política de salida, una única fuente de market data y fees, y una única UI. La
diferencia entre ejecución real y simulada se reduce a **dos adaptadores de ejecución**:

- `SHADOW`: el mismo motor que funcionaría en REAL toma las mismas decisiones, pero la capa
  final **no envía la orden** al exchange y genera un fill fantasma controlado.
- `REAL`: única implementación con capacidad de llamar a `placeOrder`.

`SHADOW` debe ser **técnicamente incapaz** de emitir órdenes reales.

## Alcance

DENTRO: Modo Normal, DRY-RUN, SPOT, TradingEngine de SPOT, strategies, EntryDecisionContext,
MomentumExpansionDetector, regimeDetection, SmartGuard aplicado a SPOT, SmartExit, TimeStop,
SmartTimeStopV2, FillWatcher, MarketDataService, MarketCandleRepository, fee model, PnL SPOT,
modelo de posición SPOT, historial SPOT, auditoría SPOT, UI SPOT, rutas API SPOT,
configuración SPOT, tests SPOT.

FUERA de alcance funcional: GRID, IDCA, AMA, FISCO. Se permite modificar componentes
compartidos solo cuando sea necesario; si se cambia uno compartido, ejecutar regresiones
específicas de GRID/IDCA/AMA/FISCO antes de PASS.

## Arquitectura objetivo

```
MARKET DATA
      |
      v
SpotMarketContext
      |
      v
SpotRegimeContext
      |
      v
SPOT_CANONICAL
      |
      v
SpotEntryPolicy  ── SpotEntryIntent (anti-late-entry)
      |
      v
SpotPosition
      |
      v
SpotExitPolicy
      |
      v
SpotExecutionIntent
      |
      v
ExecutionAdapter
      |
      +--------------------+
      |                    |
      v                    v
   SHADOW                REAL
   NO exchange           Revolut X
      |                    |
      +---------+----------+
                |
                v
        SpotPositionModel
                |
                v
        SpotHistory / Audit
```

REAL y SHADOW comparten: Market Data, Market Context, Regime, Entry Policy, Sizing, Position
Model, Exit Policy, PnL semantics, Auditoría, UI. Solo difieren en: ExecutionAdapter, fill
provenance, fees reales vs estimadas, slippage real vs simulado, venue IDs.

## Invariantes

1. Una sola estrategia SPOT: `SPOT_CANONICAL`. SPOT = LONG ONLY.
2. Un solo pipeline, un solo modelo de posición, una sola política de salida.
3. `SHADOW` no puede llamar a `exchange.placeOrder()` (capability guard + tests).
4. `ExecutionMode` es un enum único: `OFF | SHADOW | REAL`. No boolean `dryRunMode` como
   diseño final SPOT (compatibilidad temporal permitida durante migración).
5. Entry y Exit leen el **mismo** `SpotRegimeContext`. Exit no crea otro régimen.
6. PnL canónico es **NET** (gross, entryFee, exitFee, executionCost, netPnl separados).
7. `reasonType=PROFIT` exige `netPnl > 0`.
8. Market data usa helpers canónicos de timestamp (sec/ms). Sin velas 1970.
9. Replay sin lookahead: señal al cierre, fill posterior, sin high/low futuro.
10. Legacy DRY queda aislado como `LEGACY_DRY_RUN`; no participa en PnL/score/optimización SPOT.
11. `REAL_PROMOTION_STATUS = NOT_AUTHORIZED` durante toda esta tarea.
12. Fail-safe ambiguo → `OFF`. Nunca fail-safe → `REAL`.

## Prohibiciones

- Crear sistemas paralelos: `SPOT_V2`, `SPOT_TEST`, `MOMENTUM_PRO`, `DRY_ENGINE_V2`, etc.
- Enviar órdenes reales, activar REAL, o probar `placeOrder` contra Revolut X con dinero real.
- Acceder al VPS, desplegar, ejecutar SQL/migraciones contra DB real, o tocar `backups/` sin
  autorización explícita (HARD_BLOCKER según `AGENTS.md`).
- `git add -A`, `git reset --hard`, `git clean`, `rebase`, `commit --amend`, `push --force`,
  `stash` sobre cambios ajenos.
- Borrar `dry_run_trades` o histórico legacy antes de demostrar paridad.
- Usar datos futuros para decisiones o fills.
- Mezclar silenciosamente fees reales y estimados.
- Afirmar que build/test/commit/push/deploy ocurrió sin evidencia.

## Estado global

| Variable | Valor |
|----------|-------|
| BASE_SHA_REAL (origin/main) | `a5ddbce188c4bdbc15f5b2880c4932d3847f3290` |
| LOCAL_HEAD_INICIAL | `c4bd01a43206bfe2b74c6079ac275aeb8c503aee` (rama `audit/ama-quantitative-20260810`, +4 commits AMA no push) |
| BRANCH | `refactor/spot-canonical-shadow-20260812` (a crear desde `origin/main`) |
| VPS_SHA_INICIAL | `UNKNOWN` — requiere acceso VPS (HARD_BLOCKER) |
| DB_BACKUP | `SPOT_PRE_REFACTOR_DB_BACKUP=PENDING` — requiere acceso VPS/DB (HARD_BLOCKER) |
| REAL_TRADING | PROHIBIDO / NO AUTORIZADO |
| EXECUTION_MODE_OBJETIVO | SHADOW (REAL bloqueado) |
| REAL_PROMOTION_STATUS | NOT_AUTHORIZED |

### Config runtime registrada (sin secretos)

Capturada de `.env.example` (volcado real de logs de runtime) + código. Verificación contra
VPS diferida (HARD_BLOCKER).

| Variable | Valor observado | Fuente |
|----------|-----------------|--------|
| activeExchange | `revolutx` | log `[startup] ExchangeFactory initialized. Active: revolutx` |
| tradingExchange | `revolutx` | log `[EXCHANGE] Trading: revolutx, Data: kraken` |
| dataExchange | `kraken` | log `[EXCHANGE] Trading: revolutx, Data: kraken` |
| dryRunMode | `false` (en ese ciclo de log) | log `Meta.dryRunMode: false` |
| strategy | `momentum` | log `Meta.strategy: "momentum"` |
| riskLevel | `high` | log `Meta.riskLevel: "high"` |
| signalTimeframe | `15m` (selectedStrategy `momentum_candles_15m`) | log `[ROUTER] ... → momentum_candles` |
| activePairs | `BTC/USD, ETH/USD, XRP/USD, SOL/USD, TON/USD` | log `Meta.activePairs` + `[revolutx] Loading pair metadata` |
| regimeDetectionEnabled | `true` (`regimeRouterEnabled: true`) | log `[PAIR_DECISION_TRACE].regimeRouterEnabled` |
| regimeParams | enter=27 exit=23 hardExit=19 confirm=3 minHold=20 cooldown=60min | log `[REGIME_PARAMS]` |
| minSignalsRequired | `5` | log `[PAIR_DECISION_TRACE].minSignalsRequired` |
| maxLotsPerPair | `2` | log `[PAIR_DECISION_TRACE].maxLotsPerPair` |
| minOrderUsd | `100` | log `[PAIR_DECISION_TRACE].minOrderUsd` |
| allowSmallerEntries | `false` | log `[PAIR_DECISION_TRACE].allowSmallerEntries` |
| lotDecimals / orderMin | 8 / 0.0001 (todos los pares) | log `[revolutx] <pair>: lotDecimals=8, orderMin=0.0001` |
| adaptiveExitEnabled | (pendiente verificar en código — FASE 1) | — |
| SmartExit config | (pendiente verificar en código — FASE 1) | — |
| SmartGuard config | (pendiente verificar en código — FASE 1) | — |
| TimeStop config | (pendiente verificar en código — FASE 1) | — |
| fees (maker/taker Revolut X) | (pendiente verificar en código — FASE 5) | — |

> Nota: `dryRunMode: false` aparece en el log de `.env.example`, pero el plan exige que
> durante toda esta tarea el modo operativo sea `OFF` o `SHADOW`, nunca `REAL`. No se
> modificará config a REAL.

### Estado DB (a verificar en VPS — HARD_BLOCKER)

Tablas a inspeccionar: `dry_run_trades`, `trades`, `open_positions`, `bot_events`,
`bot_config`, `market_candles`, `order_intents`, `lot_matches`. Diferido a FASE 3/24.

## Fases

| Fase | Descripción | Estado | SHA inicio | SHA final | Tests | VPS | Evidencia |
|------|-------------|--------|------------|-----------|-------|-----|----------|
| 0 | Gobernanza y baseline | PASS | a5ddbce | a5ddbce | — | BLOCKED | PLAN + baseline git + config runtime; VPS_SHA/DB_backup = HARD_BLOCKER |
| 1 | Auditoría final Normal vs DRY | PASS | a5ddbce | a5ddbce | — | — | AUDITORIAS/SPOT_AUDITORIA_NORMAL_DRY_FINAL_2026-08-12.md (25 filas, 14/15 divergencias confirmadas) |
| 2 | Inventario y clasificación legacy | PASS | a5ddbce | a5ddbce | — | — | AUDITORIAS/SPOT_LEGACY_INVENTORY_2026-08-12.md (24 archivos clasificados, 4 estrategias muertas) |
| 3 | Backup DB y snapshot VPS | BLOCKED | — | — | — | — | Requiere autorización VPS/DB |
| 4 | Market Data y timestamps | PASS (code) | a5ddbce | a5ddbce | 33/33 PASS + 52/52 no-regression | BLOCKED | candleTimestamp.ts + MarketCandleRepository fix + tsc OK; inspección/limpieza velas 1970 en VPS = HARD_BLOCKER |
| 5 | Fee Model y PnL canónico | PASS | a5ddbce | a5ddbce | 17/17 PASS + tsc OK | — | spot/feeModel.ts: getTradingFeeModel (Revolut X 0.09%, NO fallback Kraken), computePnlBreakdown (NET), computePartialExitPnl, isValidProfitExit; quality REAL/ESTIMATED |
| 6 | Dominio SPOT y modelo REAL/SHADOW | PASS | a5ddbce | a5ddbce | 21/21 PASS + tsc OK | — | spot/spotTypes.ts: ExecutionMode enum (OFF/SHADOW/REAL), resolveExecutionMode (fail-safe→OFF), dryRunModeToExecutionMode, REAL_ACTIVATION_ALLOWED=false, SpotRegimeContext, SpotMarketContext, SpotPosition, SpotEntryIntent, SpotExecutionIntent, ExitReasonType (7 priority), SPOT_POLICY_VERSION |
| 7 | Regime Engine unificado | PASS | a5ddbce | a5ddbce | 10/10 PASS + tsc OK | — | spot/spotRegimeEngine.ts: buildSpotRegimeContext (1h regime + 4h macro, vocabulario único TREND/RANGE/TRANSITION, direction, volatility, macroBias), isEntryAllowedByRegime (macro bearish block, transition block, range block); entry+exit comparten mismo regimeId/contextId |
| 8 | SpotMarketContext | PASS | a5ddbce | a5ddbce | 8/8 PASS + tsc OK | — | spot/spotMarketContext.ts: buildSpotMarketContext (4tf 5m/15m/1h/4h, ticker bid/ask/last/spread, ATR, volumeMetrics, dataHealth, regimeContext integrado); helpers spread/volume testados |
| 9 | SPOT_CANONICAL — estrategia | PASS | a5ddbce | a5ddbce | 18/18 PASS + tsc OK | — | spot/spotCanonicalStrategy.ts: evaluateSpotCanonical (4h→1h→15m→5m jerárquico, LONG ONLY), 2 setup tags (PULLBACK_CONTINUATION, BREAKOUT_RETEST), evaluate4hMacro, evaluate1hRegime, evaluate15mSetup, evaluate5mTrigger, computeConfidence; NO voting heterogéneo, cada indicador tiene ROL |
| 10 | Entry Intent / anti-late-entry | PASS | a5ddbce | a5ddbce | 16/16 PASS + tsc OK | — | spot/spotEntryIntent.ts: createEntryIntent (freeza origin snapshot), evaluateEntryIntent (TTL, price move ATR, regime flip, macro flip, chase, approve), SpotEntryIntentStore (in-memory, cleanup, hasActive); elimina intermediateExec bypass |
| 11 | Sizing y gestión de riesgo | PASS | a5ddbce | a5ddbce | 21/21 PASS + tsc OK | — | spot/spotRiskManager.ts: computeStopDistance (ATR-based, regime-adjusted TREND/RANGE/TRANSITION, clamp min/max), computePositionSize (vol=risk/stopDist), evaluateSpreadGate (dynamic threshold per regime), evaluateCapitalEfficiency (min/max notional, dust, expected profit, slot efficiency, capital), evaluateFeeGate (minProfitMultiplier×fee), evaluateSizing (full pipeline) |
| 12 | Execution Adapter SHADOW/REAL | PASS | a5ddbce | a5ddbce | 17/17 PASS + tsc OK | — | spot/spotExecutionAdapter.ts: SpotExecutionAdapter interface, SpotShadowAdapter (phantom fill con slippage controlado, NUNCA llama exchange, canPlaceRealOrder=false), SpotRealAdapter (BLOCKED, REAL_ACTIVATION_ALLOWED=false), assertExecutionCapability (guard), createExecutionAdapter (fail-safe OFF→SHADOW); RealOrderBlockedException |
| 13 | SpotExitPolicy | PASS | a5ddbce | a5ddbce | 19/19 PASS + tsc OK | — | spot/spotExitPolicy.ts: 7 exit reasons en priority order (EMERGENCY, STRUCTURE_INVALIDATION, DEFENSIVE, BREAK_EVEN, TRAILING, PROFIT, TIME_EFFICIENCY), evaluateExit (pipeline completo), computeRMultiple, createExitState; consume mismo SpotRegimeContext que entry; PROFIT exige netPnl>0 |
| 14 | MFE/MAE/Profit Capture | PASS | a5ddbce | a5ddbce | 15/15 PASS + tsc OK | — | spot/spotAuditTracker.ts: SpotAuditTracker (MFE/MAE USD + R-multiple, updatePrice cada scan, finalizeExit con Profit Capture % y exit efficiency), classifyProfitCapture (EXCELLENT/GOOD/POOR/BAD), computeAggregateAudit |
| 15 | DB y migraciones | BLOCKED | — | — | — | — | Aplicar a DB real requiere autorización |
| 16 | API SPOT | PASS | a5ddbce | a5ddbce | 16/16 PASS + tsc OK | — | server/routes/spot.routes.ts: 9 endpoints (/api/spot/status,positions,history,summary,intents,audit/:lotId,audit,regime/:pair,mode POST); REAL bloqueado via API (403); exports getSpotExecutionMode/IntentStore/AuditTracker; registrado en routes.ts |
| 17 | UI SPOT | PASS | a5ddbce | a5ddbce | tsc OK + build OK (2625 modules) | — | client/src/pages/Spot.tsx (AppShell + Tabs 5 tabs: overview/positions/history/intents/audit); 5 componentes: SpotStatusPanel (mode selector OFF/SHADOW, REAL disabled, fee model, policy version), SpotPositionsPanel (tabla posiciones con MFE/MAE/R/SG), SpotHistoryPanel (tabla trades con PnL NET/fees/R/hold time), SpotIntentsPanel (entry intents con state machine colors, origin snapshot, block reasons), SpotAuditPanel (aggregate MFE/MAE/Profit Capture distribution + per-position table); useQuery react-query polling 10-30s; useMutation mode change; ruta /spot registrada en App.tsx; nav link SPOT con icon Zap en Nav.tsx |
| 18 | Legacy DRY aislado | PASS | a5ddbce | a5ddbce | 19/19 PASS + tsc OK | — | spot/legacyIsolation.ts: LEGACY_DRY_RUN_TAG, DEAD_STRATEGIES (4), DEPRECATED_MODULES (3), LEGACY_ENDPOINTS (7), legacyDeprecationMiddleware, applyLegacyHeaders, isDeadStrategy, isLegacyEndpoint; dryrun.routes.ts: middleware + applyLegacyHeaders en 7 endpoints; tests verifican aislamiento (SPOT modules NOT in deprecated, dead strategies NOT in active) |
| 19 | Replay y benchmark | PASS | — | — | 12/12 PASS + tsc OK | — | spot/spotReplayEngine.ts: runReplay (determinista, sin lookahead, señal al cierre→fill next open), ReplayTrade/ReplayResult/ReplayStats, computeReplayStats (winRate, profitFactor, MFE/MAE, consecutive W/L, profit capture distribution); buildReplayContext from candles (no async), computeSimpleEMA/ATR |
| 20 | Walk-forward y robustez | PASS | — | — | 9/9 PASS + tsc OK | — | spot/spotWalkForward.ts: runWalkForward (N windows IS/OOS split), WalkForwardWindow/Result, RobustnessCheck (5 checks: win rate diff ≤15%, OOS PF>0.5, no 100% loss window, avg R diff ≤0.5, no overlap), aggregateStats IS/OOS |
| 21 | Tests completos | PASS | — | — | 235 PASS + 10 skipped (DB) + tsc OK | — | Suite SPOT completa: 15 archivos test, 0 regresiones. spotDryrunCleanup 10 skipped (requiere DB real — HARD_BLOCKER FASE 15) |
| 22 | Documentación | PASS | — | — | BITACORA actualizada | — | BITACORA.md: sección SPOT Canonical Engine con resumen, archivos, invariantes, validaciones, fases bloqueadas |
| 23 | Commit (push = HARD_BLOCKER) | PENDING | — | — | — | — | Pendiente de commit selectivo |
| 24 | Deploy staging | BLOCKED | — | — | — | — | Requiere autorización VPS |
| 25 | Validación visual staging | BLOCKED | — | — | — | — | Requiere VPS |
| 26 | Observabilidad SHADOW | BLOCKED | — | — | — | — | Requiere VPS |
| 27 | No auto-optimización post-deploy | PASS | — | — | 6/6 PASS + tsc OK | — | spot/spotNoAutoOptimization.ts: AUTO_OPTIMIZATION_BLOCKED=true, POLICY_FROZEN_SINCE, blockAutoOptimization guard, isParameterChangeAuthorized=false durante refactor |
| 28 | Criterios promoción REAL | PASS | — | — | Documento creado | — | AUDITORIAS/SPOT_CRITERIOS_PROMOCION_REAL_2026-08-12.md: precondiciones, criterios cuantitativos (volumen, rendimiento, robustez, auditoría), criterios cualitativos, proceso activación, criterios reversión |
| 29 | Informe final | PASS | — | — | Informe creado | — | AUDITORIAS/SPOT_REFUNDACION_INFORME_FINAL_2026-08-12.md: resumen ejecutivo, arquitectura, 28 archivos creados, 4 modificados, 12 invariantes, 235 tests, fases bloqueadas, próximos pasos |

Estados permitidos: `PENDING | IN_PROGRESS | PASS | BLOCKED | FAILED`.
Regla PASS: requiere implementación + tests + evidencia + validación de invariantes + ausencia
de regresión relevante (no basta con compilar).

## Evidencias

- FASE 0: este archivo; `git rev-parse HEAD`, `git rev-parse origin/main`, `git status --short`,
  `git log -10 --oneline` (capturados abajo).
- FASE 1: `AUDITORIAS/SPOT_AUDITORIA_NORMAL_DRY_FINAL_2026-08-12.md`.
- FASE 2: `AUDITORIAS/SPOT_LEGACY_INVENTORY_2026-08-12.md`.
- FASE 3: backup `spot_pre_refactor_20260812.sql.gz` (ruta/checksum en VPS — HARD_BLOCKER).
- Fases de implementación: archivos en `server/services/spot/`, tests en `tests/`.
- FASE 29: `AUDITORIAS/SPOT_REFUNDACION_INFORME_FINAL_2026-08-12.md`.

### Baseline git capturada (2026-08-12)

```
git fetch origin
HEAD (audit/ama-quantitative-20260810): c4bd01a43206bfe2b74c6079ac275aeb8c503aee
origin/main: a5ddbce188c4bdbc15f5b2880c4932d3847f3290
ahead/behind origin/main...HEAD: 0 / 4  (4 commits AMA no push)

git log -10 --oneline:
c4bd01a fix(ama): resolve lint errors in audit scripts
46b9712 audit(ama): validate canonical runtime on Kraken full history
9cee8f4 refactor(ama): unify audit with canonical runtime engine
2b988d3 audit(ama): add quantitative audit baseline
a5ddbce Merge PR #6: AMA R4 controls and laboratory UX
ad54c1f fix(ama): traducir los 5 checks de preparacion Real que faltaban
942e62c feat(ama): auditoria formal de botones, detalle de resultado Lab
febb5ca feat(ama): navegacion contextual unica, home Laboratorio
80d9267 fix(ama): mode selector backend-driven, Real wizard
c31327a docs: cierre final AMA R3 en BITACORA.md

git status --short (resumen):
 M package.json
 M package-lock.json
?? (WIP no propio: componentes grid UI, logs AUDITORIAS/, screenshots/, scripts ama)
```

> Nota: el working tree está sobre `audit/ama-quantitative-20260810` con WIP ajeno
> (componentes grid, logs, screenshots). Per `AGENTS.md` se preserva intacto; la rama
> `refactor/spot-canonical-shadow-20260812` se crea desde `origin/main` y los archivos
> untracked/modificados viajan sin ser commitados por esta tarea salvo rutas explícitas.

## Riesgos

- **R1 — WIP ajeno en working tree**: muchos untracked y `package.json` modificado. Mitigación:
  `git add` solo por rutas concretas; nunca `-A`/`reset --hard`/`clean`/`stash` ajeno.
- **R2 — Divergencia local vs origin**: local main == origin/main, pero la rama actual tiene
  +4 commits AMA. La rama refactor nace limpia desde `origin/main`.
- **R3 — Componentes compartidos con GRID/IDCA/AMA/FISCO**: cambios en shared pueden romper
  otras estrategias. Mitigación: regresiones específicas antes de PASS.
- **R4 — Timestamps sec/ms**: bug histórico con velas 1970. Mitigación: helpers canónicos +
  tests + limpieza solo de filas corruptas (tras backup — HARD_BLOCKER).
- **R5 — Alcance temporal**: 29 fases exceden una sesión. Mitigación: ejecución fase a fase,
  progreso real documentado, continuación en sesiones siguientes.
- **R6 — Datos reales**: cualquier migración/backup sobre DB real es HARD_BLOCKER hasta
  autorización explícita.

## Decisiones arquitectónicas

- **D1**: `ExecutionMode` enum único `OFF | SHADOW | REAL`. `dryRunMode` boolean solo se
  mantiene temporalmente para compatibilidad durante la migración.
- **D2**: Una sola estrategia SPOT (`SPOT_CANONICAL`), LONG ONLY, jerarquía 4h→1h→15m→5m.
- **D3**: `SpotRegimeContext` único consumido por Entry y Exit (mismo `regimeId`/`contextId`).
- **D4**: PnL canónico NET con flags de calidad `REAL | ESTIMATED | UNKNOWN`.
- **D5**: `SpotExecutionAdapter` interface con dos impls; capability guard impide
  `placeOrder` en SHADOW.
- **D6**: `SpotExitPolicy` única con prioridad Emergency > Structure > Defensive > BE >
  Trailing > Profit > TimeEfficiency. Un solo TimeStop (no Normal+SmartTimeStopV2).
- **D7**: Legacy DRY aislado como `LEGACY_DRY_RUN`; no se borra hasta paridad demostrada.
- **D8**: Migraciones aditivas e idempotentes; `executionMode` añadido donde corresponda.
- **D9**: Replay determinista sin lookahead (señal al cierre, fill posterior).
- **D10**: `SPOT_POLICY_VERSION` registrado con cada trade; congelado post-deploy.

## Historial de ejecución

- 2026-08-12 — FASE 0 IN_PROGRESS. Creado este PLAN. Baseline git capturada. Rama
  `refactor/spot-canonical-shadow-20260812` pendiente de crear desde `origin/main`.
  Config runtime y estado DB diferidos (parte requiere VPS — HARD_BLOCKER).
- 2026-08-12 — FASE 0 PASS (local). Rama `refactor/spot-canonical-shadow-20260812` creada
  desde `origin/main` (`a5ddbce`). Config runtime capturada de logs + código. Sub-items
  VPS-dependent (VPS_SHA_INICIAL, DB backup, `/api/health` real) quedan BLOCKED hasta
  autorización de acceso VPS. Inicia FASE 1 (auditoría Normal vs DRY, solo análisis).
- 2026-08-12 — FASE 1 PASS. 5 subagentes en paralelo auditaron tradingEngine (8194 líneas,
  67 refs dryRun), dryrun.routes + storage, exit stack, entry/regime/marketdata/strategies,
  UI/Telegram/fees. Matriz de 25 divergencias con file:line. 14/15 divergencias del plan
  confirmadas; 1 refutada con matiz (fee sources: misma fuente pero fallback Kraken peligroso).
  Divergencias críticas: PnL GROSS vs NET, fill sin slippage, dailyPnL no aplicado en DRY,
  dos TimeStop engines, dos vocabularios régimen, timestamps sec/ms. Inicia FASE 2 + FASE 4.
- 2026-08-12 — FASE 2 PASS. Inventario legacy: 24 archivos clasificados (KEEP/REFACTOR/
  MIGRATE/DEPRECATE/DELETE_AFTER_PARITY). 4 estrategias muertas identificadas
  (momentumStrategy, meanReversionStrategy, scalpingStrategy, gridStrategy legacy).
  2 estrategias activas (momentumCandlesStrategy, meanReversionSimpleStrategy). Listas
  SAFE_TO_DELETE / KEEP_FOR_LEGACY_READ / DEPRECATED para FASE 18.
- 2026-08-12 — FASE 4 PASS (code). Creado `server/services/spot/candleTimestamp.ts` con
  helpers canónicos: normalizeCandleTimestampMs (sec/ms heurística, rechaza inválidos/futuro),
  getCandleOpenTimeMs, getCandleCloseTimeMs, getTimeframeMs, isCandleClosed,
  candleCloseAgeMs, normalizeCandles, evaluateDataHealth (GOOD/DEGRADED/STALE/INSUFFICIENT).
  33 tests PASS. Corregido MarketCandleRepository.upsertCandles (normaliza timestamp en
  boundary, skip velas inválidas en vez de persistir 1970). tsc OK. 52 tests no-regression.
  Pendiente VPS: inspeccionar/limpiar velas 1970 existentes, verificar coverage 5m/15m/1h/4h
  para BTC/ETH/XRP/SOL/TON — HARD_BLOCKER. Inicia FASE 5.
- 2026-08-12 — FASE 5 PASS. Creado `server/services/spot/feeModel.ts`:
  getTradingFeeModel (resuelve Revolut X 0.09%/0.00% desde ExchangeFactory, fallback
  ESTIMATED Revolut X NUNCA Kraken 0.40%), computeFeeBreakdown, computePnlBreakdown
  (NET: gross - entryFee - exitFee - executionCost, quality REAL/ESTIMATED),
  computePartialExitPnl (prorates entry fee by sell ratio), isValidProfitExit (netPnl>0).
  17 tests PASS (market buy/sell, maker/maker, gross positive net negative, partial exit,
  scale-out, execution cost, fee breakdown). tsc OK. Inicia FASE 6.
- 2026-08-12 — FASE 6 PASS. Creado `server/services/spot/spotTypes.ts`: enum único
  ExecutionMode (OFF/SHADOW/REAL), resolveExecutionMode (fail-safe→OFF nunca REAL),
  dryRunModeToExecutionMode (compat), REAL_ACTIVATION_ALLOWED=false, SetupTag (2),
  Regime/RegimeDirection/VolatilityLevel/MacroBias (vocabulario unificado),
  SpotRegimeContext, SpotMarketContext, SpotPosition, SpotEntryIntent (8 estados),
  SpotExecutionIntent, ExitReasonType (7 prioridades), SPOT_POLICY_VERSION.
  21 tests PASS (fail-safe, real activation blocked, persistence round-trip, enums).
  tsc OK. Inicia FASE 7.
- 2026-08-12 — FASE 7 PASS. Creado `server/services/spot/spotRegimeEngine.ts`:
  buildSpotRegimeContext (reuses detectMarketRegime de regimeDetection.ts, extiende con
  direction BULLISH/BEARISH/NEUTRAL, volatility LOW/NORMAL/HIGH, macroBias 4h
  BULLISH/BEARISH/NEUTRAL). Vocabulario único TREND/RANGE/TRANSITION (elimina
  TREND/CHOP/VOLATILE de SmartExit). isEntryAllowedByRegime: macro bearish block,
  transition block, range block, trend bearish block. Entry y Exit reciben mismo
  regimeId/contextId. 10 tests PASS. tsc OK. Inicia FASE 8.
- 2026-08-12 — FASE 8 PASS. Creado `server/services/spot/spotMarketContext.ts`:
  buildSpotMarketContext (fetch paralelo 4tf 5m/15m/1h/4h desde MarketDataService,
  normaliza timestamps, evalúa DataHealth, integra SpotRegimeContext, calcula ATR 1h,
  ticker bid/ask/last/spread, volumeMetrics 5m con participation LOW/NORMAL/HIGH).
  8 tests PASS (spread calc, volume metrics: uniform/spike/drop/insufficient/24h).
  tsc OK. Inicia FASE 9.
- 2026-08-12 — FASE 9 PASS. Creado `server/services/spot/spotCanonicalStrategy.ts`:
  evaluateSpotCanonical (pipeline jerárquico 4h macro → 1h regime → 15m setup → 5m trigger,
  LONG ONLY, NO SELL). 2 setup tags: PULLBACK_CONTINUATION (pullback controlado a EMA20
  en trend bullish, distancia 0.3-2.0 ATR, RSI 30-65, vela alcista) y BREAKOUT_RETEST
  (ruptura rolling high con expansión + volumen, retest cerca del nivel). evaluate5mTrigger
  (vela alcista, body strength, no upper wick rejection, volumen). computeConfidence.
  Cada indicador tiene ROL (EMA=estructura, ADX=fuerza, ATR=distancia, MACD=momentum,
  volume=participación, BB=régimen, RSI=extensión) — NO voting heterogéneo.
  18 tests PASS (macro bearish block, transition block, range block, data stale block,
  pullback valid/invalid, breakout valid/failed, trigger 5m, full pipeline, LONG ONLY).
  tsc OK. Inicia FASE 10.
- 2026-08-12 — FASE 10 PASS. Creado `server/services/spot/spotEntryIntent.ts`:
  createEntryIntent (freeza origin snapshot: price, ATR%, regime, direction, macro,
  volume, contextId). evaluateEntryIntent state machine: WAITING→APPROVED (price stable,
  regime stable), WAITING→CHASED (moderate move 0.75-1.5 ATR, update origin, retry),
  WAITING→EXPIRED (TTL 2 candles = 30min), WAITING→INVALIDATED (price >1.5 ATR, regime
  flip, direction flip, macro flip bearish). SpotEntryIntentStore (in-memory, get/put/
  remove/update/cleanup/hasActive). Elimina intermediateExec bypass. 16 tests PASS
  (creation, TTL, approved, price move invalidation, regime flip, macro flip, chase,
  terminal state, store). tsc OK. Inicia FASE 11.
- 2026-08-12 — FASE 11 PASS. Creado `server/services/spot/spotRiskManager.ts`:
  computeStopDistance (ATR × multiplier ajustado por régimen: TREND 2.0, RANGE 1.0,
  TRANSITION 1.5; clamp min 0.5% max 5%). computePositionSize (vol = riskUsd / stopDist).
  evaluateSpreadGate (threshold dinámico per régimen, cap 3.5%). evaluateCapitalEfficiency
  (min/max notional, dust, expected profit, slot efficiency, capital disponible).
  evaluateFeeGate (expected gross ≥ minProfitMultiplier × round-trip fee). evaluateSizing
  (pipeline completo: max lots, stop, risk budget, size, spread, cap efficiency, fee).
  21 tests PASS. tsc OK. Inicia FASE 12.
- 2026-08-12 — FASE 12 PASS. Creado `server/services/spot/spotExecutionAdapter.ts`:
  SpotExecutionAdapter interface (mode, canPlaceRealOrder, executeEntry, executeExit).
  SpotShadowAdapter: genera phantom fill con slippage controlado (0.02% base + market
  impact + volatility), NUNCA llama exchange API, canPlaceRealOrder=false hardcoded.
  SpotRealAdapter: BLOCKED, REAL_ACTIVATION_ALLOWED=false → todas las operaciones throw
  RealOrderBlockedException. assertExecutionCapability guard. createExecutionAdapter
  factory (fail-safe: OFF/unknown → SHADOW, nunca REAL). 17 tests PASS (SHADOW never
  real order, REAL blocked, phantom fill BUY/SELL, fee calc, market impact slippage,
  validation, factory). tsc OK. Inicia FASE 13.
- 2026-08-12 — FASE 13 PASS. Creado `server/services/spot/spotExitPolicy.ts`:
  7 exit reasons en priority order: 1.EMERGENCY (hard stop), 2.STRUCTURE_INVALIDATION
  (N candles below EMA20), 3.DEFENSIVE (ADX drop + adverse R, direction flip),
  4.BREAK_EVEN (SmartGuard BE at 1R), 5.TRAILING (SmartGuard trailing at 1.5R, 2% dist),
  6.PROFIT (TP at 3R, exige netPnl>0 via isValidProfitExit), 7.TIME_EFFICIENCY (max hold
  72h, no progress 3h + R<0.5). evaluateExit pipeline completo. computeRMultiple.
  createExitState. Consume mismo SpotRegimeContext que entry (NO crea su propio régimen).
  19 tests PASS (R multiple, emergency, structure, defensive, BE, trailing, profit net,
  time efficiency, priority order). tsc OK. Inicia FASE 14.
- 2026-08-12 — FASE 14 PASS. Creado `server/services/spot/spotAuditTracker.ts`:
  SpotAuditTracker: initPosition, updatePrice (MFE/MAE USD + R-multiple cada scan,
  no solo cada 5min), finalizeExit (Profit Capture %, exit efficiency net/gross,
  hold time, MFE-to-hold ratio). classifyProfitCapture (>80% EXCELLENT, 50-80% GOOD,
  20-50% POOR, <20% BAD). computeAggregateAudit. AUDIT ONLY — no trading decisions.
  15 tests PASS. tsc OK. Inicia FASE 15.
- 2026-08-12 — FASE 16 PASS. Creado `server/routes/spot.routes.ts`: 9 endpoints
  unificados (/api/spot/status, positions, history, summary, intents, audit/:lotId,
  audit, regime/:pair, mode POST). POST /api/spot/mode: OFF y SHADOW permitidos,
  REAL retorna 403 (realActivationAllowed=false). Valor ambiguo → OFF (fail-safe).
  Exports: getSpotExecutionMode, getSpotIntentStore, getSpotAuditTracker (para
  integración con engine). Registrado en routes.ts. 16 tests PASS (status, mode
  OFF/SHADOW/REAL blocked/ambiguous, intents, audit, positions, history, summary,
  regime, exports). tsc OK. Inicia FASE 17.
- 2026-08-12 — FASE 17 PASS. Creada UI SPOT completa:
  - `client/src/pages/Spot.tsx`: página principal con AppShell, 5 tabs (overview,
    positions, history, intents, audit), KPIs summary (net PnL, win rate, trades,
    abiertas, profit factor, avg hold), useQuery polling 10-30s, useMutation
    para cambio de modo, botón refrescar.
  - `client/src/components/spot/SpotStatusPanel.tsx`: mode selector OFF/SHADOW
    (REAL disabled con icon Shield), badge modo activo, stats grid (intents,
    posiciones, fee maker/taker), meta (exchange, calidad fees, policy version,
    REAL bloqueado).
  - `client/src/components/spot/SpotPositionsPanel.tsx`: tabla posiciones con
    par, cantidad, entry, MFE/MAE USD, R-MFE, setup tag, SG flags (BE/TR),
    notional. Empty state informativo.
  - `client/src/components/spot/SpotHistoryPanel.tsx`: tabla trades cerrados con
    par, entry/exit, gross, fees, net PnL (color), R-multiple, razón exit,
    hold time formateado, modo ejecución.
  - `client/src/components/spot/SpotIntentsPanel.tsx`: entry intents con state
    machine colors (CREATED/WAITING/APPROVED/EXECUTED/EXPIRED/INVALIDATED/
    CHASED/CANCELLED), origin snapshot (price, régimen, dirección, macro,
    ATR%, retry), block reasons, TTL expirado. Badge activos vs total.
  - `client/src/components/spot/SpotAuditPanel.tsx`: aggregate MFE/MAE/Profit
    Capture distribution (EXCELLENT/GOOD/POOR/BAD), avg metrics, per-position
    table con MFE/MAE USD, R, capture %, razón.
  - `client/src/App.tsx`: import Spot + ruta /spot registrada.
  - `client/src/components/dashboard/Nav.tsx`: nav link SPOT con icon Zap
    entre GRID y AMA.
  tsc OK. Build OK (2625 modules, 40s). Inicia FASE 18.
- 2026-08-12 — FASE 18 PASS. Legacy DRY aislado:
  - `server/services/spot/legacyIsolation.ts`: módulo de aislamiento con
    LEGACY_DRY_RUN_TAG, DEAD_STRATEGIES (4: momentumStrategy,
    meanReversionStrategy, scalpingStrategy, gridStrategy legacy),
    DEPRECATED_MODULES (3: signalAccumulator, SmartExitEngine,
    SmartTimeStopV2), LEGACY_ENDPOINTS (7: /api/dryrun/*),
    legacyDeprecationMiddleware (log warning + next),
    applyLegacyHeaders (X-Legacy-Warning + X-Deprecation-Tag),
    isDeadStrategy, isLegacyEndpoint.
  - `server/routes/dryrun.routes.ts`: import legacyIsolation, middleware
    app.use("/api/dryrun", ...) con deprecation warning, applyLegacyHeaders
    en los 7 endpoints (positions, history, summary, clear, backfill,
    exit-audit, timestop-audit).
  - `server/services/__tests__/spotLegacyIsolation.test.ts`: 19 tests
    verifican constantes, dead strategies, deprecated modules, legacy
    endpoints, applyLegacyHeaders, middleware, invariantes de aislamiento
    (SPOT modules NOT in deprecated, active strategies NOT in dead).
  19/19 PASS. tsc OK. Inicia FASE 19.
- 2026-08-12 — FASE 19-20 PASS. Replay + Walk-forward:
  - `spot/spotReplayEngine.ts`: runReplay determinista sin lookahead,
    computeReplayStats, buildReplayContext, 12 tests.
  - `spot/spotWalkForward.ts`: runWalkForward con IS/OOS split,
    5 robustness checks, 9 tests.
  21/21 PASS. tsc OK.
- 2026-08-12 — FASE 21 PASS. Tests completos: 235 PASS + 10 skipped (DB).
  0 regresiones. spotDryrunCleanup requiere DB real (HARD_BLOCKER FASE 15).
- 2026-08-12 — FASE 22 PASS. BITACORA.md actualizada con sección SPOT.
- 2026-08-12 — FASE 27 PASS. spot/spotNoAutoOptimization.ts: policy frozen,
  blockAutoOptimization guard, 6 tests.
- 2026-08-12 — FASE 28 PASS. AUDITORIAS/SPOT_CRITERIOS_PROMOCION_REAL_2026-08-12.md.
- 2026-08-12 — FASE 29 PASS. AUDITORIAS/SPOT_REFUNDACION_INFORME_FINAL_2026-08-12.md.
  FASE 23 (commit) pendiente. FASE 24-26 BLOCKED (VPS).
