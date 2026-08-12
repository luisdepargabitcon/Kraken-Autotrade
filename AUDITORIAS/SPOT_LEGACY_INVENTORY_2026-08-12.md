# SPOT — INVENTARIO Y CLASIFICACIÓN DE CÓDIGO LEGACY
**Fecha:** 2026-08-12
**Base SHA:** `a5ddbce188c4bdbc15f5b2880c4932d3847f3290`
**Rama:** `refactor/spot-canonical-shadow-20260812`
**Estado:** COMPLETADO — clasificación trazable contra HEAD.

> Inventario de solo lectura. No se modificó código. Clasificación: KEEP / REFACTOR /
> MIGRATE / DEPRECATE / DELETE_AFTER_PARITY.

---

## MATRIZ DE CLASIFICACIÓN

| # | File | Clasificación | Justificación (file:line) | Destino SPOT |
|---|------|---------------|---------------------------|--------------|
| 1 | `server/services/strategies.ts` | PARTIAL_KEEP | `momentumCandlesStrategy` (line 453) y `meanReversionSimpleStrategy` (line 663) usados activamente (`tradingEngine.ts:1917,2323,2325,2328,4774`). `momentumStrategy` (75), `meanReversionStrategy` (165), `scalpingStrategy` (260), `gridStrategy` (357) solo en path legacy (`tradingEngine.ts:5860-5869`) — código muerto | Extraer momentumCandles a SpotSignalGenerator; DELETE 4 estrategias muertas tras paridad |
| 2 | `server/services/EntryDecisionContext.ts` | KEEP | Fuente única para pipeline de entrada (line 4-14). `buildEntryDecisionContext` (89), `validateEntryMetrics` (210), `evaluateHardGuards` (226+) | Migración directa a SPOT_CANONICAL |
| 3 | `server/services/MomentumExpansionDetector.ts` | KEEP | Módulo puro stateless (line 1-11). Scoring 7 puntos (82-89), `evaluateMomentumExpansion` (93) | Integrar en SpotSignalGenerator/SpotEntryContext |
| 4 | `server/services/SmartExitEngine.ts` | MIGRATE → DEPRECATE | Exit dinámico experimental (line 1-10). Lógica buena: detección deterioro técnico (231-400). `enabled: false` default (66) | Migrar lógica de señales a SpotExitPolicy.DynamicExit; deprecate tras paridad |
| 5 | `server/services/SmartExitStateManager.ts` | MIGRATE | Persiste estado por pair+positionId (line 1-5). State machine (15-20), `evaluateTransition` (55) | Migrar a SpotExitPolicy.StateManager |
| 6 | `server/services/SmartTimeStopV2.ts` | MIGRATE → DEPRECATE | DRY RUN ONLY (line 4-8, `realEnabled: false` line 63). Lógica buena: scores trend/momentum/risk (218-358) | Migrar market score a SpotExitPolicy.TimeEfficiency; deprecate tras paridad |
| 7 | `server/services/TimeStopService.ts` | MIGRATE | Smart TimeStop con TTL per-asset y regime multipliers (line 1-4). Soft mode con profit threshold (34-35) | Migrar TTL + regime multipliers a SpotExitPolicy.TimeEfficiency |
| 8 | `server/services/exitManager.ts` | REFACTOR | Monolito 1897 líneas (line 1-10). SL/TP/SMART_GUARD/TimeStop/fee-gating. Exit lock (184-191) | Refactorizar en SpotExitPolicy con sub-módulos |
| 9 | `server/routes/dryrun.routes.ts` | DEPRECATE | 7 endpoints DRY-specific (line 1-1240). `/api/dryrun/positions,history,summary,clear,backfill,exit-audit,timestop-audit` | Deprecate tras migrar a `/api/spot/*` unificado |
| 10 | `server/services/TradeSnapshotService.ts` | KEEP/MIGRATE | Hooks non-blocking (line 4-7). Source isolation: REAL/DRY_RUN/SHADOW/IDCA_SIMULATION (6). `onBotSpotEntry` (96), `onBotSpotExit` (102) | Keep; ya soporta SPOT modes. Updates menores de interface |
| 11 | `server/services/TradeMetricsTracker.ts` | KEEP/MIGRATE | Samplea MFE/MAE/drawdown cada 5min (line 1-8). In-memory peak tracking (17-26) | Keep; integrar con SpotMetricsTracker |
| 12 | `server/services/auditMetrics.ts` | KEEP | Funciones puras MFE/MAE/Profit Capture/Exit Efficiency (line 1-5). Sin DB, sin side effects (3). `computeMfePnlUsd` (47), `computeProfitCapturePct` (105) | Keep; utility compartida para audit metrics |
| 13 | `server/services/regimeDetection.ts` | REFACTOR | Funciones puras régimen (line 1-5). `detectMarketRegime` (85), `REGIME_PRESETS` (37). ATR exit calc (205) — hardcode `TAKER_FEE_PCT=0.40` (216) | Refactorizar en SpotRegimeContext como módulo puro |
| 14 | `server/services/regimeManager.ts` | REFACTOR | Régimen stateful con confirmación/caching (line 1-4). `RegimeManager` class (32), `upsertRegimeState` (102) | Refactorizar en SpotRegimeContext como manager stateful |
| 15 | `server/services/mtfAnalysis.ts` | REFACTOR | MTF fetch/cache (line 1-4). `MtfAnalyzer` class (214). Solo 5m/1h/4h (245-247), falta 15m | Refactorizar en SpotMarketContext con 4 timeframes |
| 16 | `server/services/MarketDataService.ts` | KEEP | Cache unificado market data (line 1-6). Single-flight (113). TTL per-timeframe (91-102). Compartido | Keep; servicio compartido para todos componentes SPOT |
| 17 | `server/services/signalAccumulator.ts` | DEPRECATE | Persiste señales entre scans (line 1-8). Gated by `signalAccumulatorEnabled` (8, default false). Reemplazado por SPOT_CANONICAL | Deprecate; funcionalidad reemplazada por SPOT_CANONICAL |
| 18 | `server/services/capitalEfficiencyGate.ts` | KEEP/REFACTOR | Previene entries dust/micro (line 1-6). 5 reglas: min notional, dust block, expected profit, slot efficiency, capital unavailable (70-125) | Refactorizar en SpotRiskManager como entry gate |
| 19 | `server/services/spreadFilter.ts` | KEEP/REFACTOR | Spread gating (line 1-4). Dynamic markup desde MarkupTracker (118). RevolutX markup (113-136) | Refactorizar en SpotRiskManager como spread gate |
| 20 | `server/services/FillWatcher.ts` | KEEP | Monitorea fills en tiempo real (line 1-12). Polling 3-5s (9). FIFO PnL (76-189). REAL only | Keep; REAL-only fill monitoring |
| 21 | `server/services/executors/ShadowExecutor.ts` | REFACTOR | Mirrors trading sin órdenes reales (line 1-14). Escribe a `training_trades` (6-7). NUNCA llama exchange API (10) | Refactorizar en SpotShadowExecutionAdapter |
| 22 | `server/services/executors/ITradeExecutor.ts` | REFACTOR | Interface compartida Real/DryRun/Shadow (line 1-11). `TradeIntent` (13), `TradeResult` (27) | Refactorizar en SpotExecutionAdapter interface |
| 23 | `client/src/pages/Terminal.tsx` | REFACTOR | UI Normal/DRY separada (line 252-253). `OpenPosition` (61-108), `DryRunSummary` (169-229) | Rename Normal→SPOT, unificar DRY, consolidar interfaces |
| 24 | `server/services/tradingEngine.ts` | REFACTOR | Monolito 8194 líneas (line 1-100). Importa todas estrategias (64-72). Entry/exit mezclados | Extraer path SPOT a SpotEngine; keep legacy para paridad |

---

## ESTRATEGIAS MUERTAS (DELETE_AFTER_PARITY)

| Strategy | File:line | Última referencia | Estado |
|----------|-----------|-------------------|--------|
| `momentumStrategy` | `strategies.ts:75` | `tradingEngine.ts:5860` (legacy path) | Muerta — path legacy no ejecutado |
| `meanReversionStrategy` | `strategies.ts:165` | `tradingEngine.ts:5863` (legacy path) | Muerta — path legacy no ejecutado |
| `scalpingStrategy` | `strategies.ts:260` | `tradingEngine.ts:5866` (legacy path) | Muerta — path legacy no ejecutado |
| `gridStrategy` (legacy) | `strategies.ts:357` | `tradingEngine.ts:5869` (legacy path) | Muerta — path legacy no ejecutado |

## ESTRATEGIAS ACTIVAS (migrar a SPOT_CANONICAL)

| Strategy | File:line | Call sites activos | Destino |
|----------|-----------|-------------------|---------|
| `momentumCandlesStrategy` | `strategies.ts:453` | `tradingEngine.ts:1917,2323` | SpotSignalGenerator |
| `meanReversionSimpleStrategy` | `strategies.ts:663` | `tradingEngine.ts:2325,2328,4774` | SpotSignalGenerator (evaluar si KEEP en SPOT LONG ONLY) |

---

## LISTAS DE SEGURIDAD PARA FASE 18

### SAFE_TO_DELETE (tras paridad demostrada + tests PASS)
- `momentumStrategy` (`strategies.ts:75-163`)
- `meanReversionStrategy` (`strategies.ts:165-264`)
- `scalpingStrategy` (`strategies.ts:260-356`)
- `gridStrategy` legacy (`strategies.ts:357-452`)
- `signalAccumulator.ts` (reemplazado por SPOT_CANONICAL)
- `SmartTimeStopV2.ts` (tras migrar lógica a SpotExitPolicy)
- `SmartExitEngine.ts` (tras migrar lógica a SpotExitPolicy)

### KEEP_FOR_LEGACY_READ (no borrar, aislar)
- `dry_run_trades` table → `LEGACY_DRY_RUN`
- `dry_run_trades_archive` table
- `dryrun.routes.ts` → endpoints deprecated pero accesibles para auditoría legacy
- `Terminal.tsx` pestañas DRY RUN / HIST. DRY → mover a Auditoría → Legacy DRY

### DEPRECATED (marcar, no borrar hasta migración UI completa)
- `/api/dryrun/*` endpoints
- `dryRunMode` boolean (reemplazado por `ExecutionMode` enum)
- `intermediateExec` bypass semantics (eliminadas en SpotEntryIntent)

---

## RESUMEN POR CLASIFICACIÓN

| Clasificación | Count | Archivos |
|---------------|-------|----------|
| KEEP | 6 | EntryDecisionContext, MomentumExpansionDetector, MarketDataService, auditMetrics, FillWatcher, TradeSnapshotService |
| KEEP/MIGRATE | 3 | TradeSnapshotService, TradeMetricsTracker, capitalEfficiencyGate, spreadFilter |
| REFACTOR | 8 | exitManager, regimeDetection, regimeManager, mtfAnalysis, Terminal.tsx, tradingEngine, ShadowExecutor, ITradeExecutor |
| MIGRATE → DEPRECATE | 3 | SmartExitEngine, SmartTimeStopV2, TimeStopService |
| DEPRECATE | 3 | dryrun.routes, signalAccumulator, dryRunMode boolean |
| DELETE_AFTER_PARITY | 4 | momentumStrategy, meanReversionStrategy, scalpingStrategy, gridStrategy legacy |

---

**FIN FASE 2**
