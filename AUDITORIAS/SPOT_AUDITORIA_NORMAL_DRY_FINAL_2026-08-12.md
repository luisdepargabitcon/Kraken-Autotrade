# SPOT — AUDITORÍA FINAL NORMAL vs DRY
**Fecha:** 2026-08-12
**Base SHA:** `a5ddbce188c4bdbc15f5b2880c4932d3847f3290` (origin/main)
**Rama:** `refactor/spot-canonical-shadow-20260812`
**Estado:** COMPLETADO — matriz de divergencias trazable contra código actual (HEAD).

> Auditoría de solo lectura. No se modificó código. Todas las citas son `file:line` contra
> el árbol en `a5ddbce`. Documentos previos (`FASE1_AUDITORIA_ARQUITECTURA.md` 2026-03-30,
> `FASE2_CORRECCION_DRY_RUN.md` 2026-03-30) se usaron como contexto pero se re-verificaron
> contra HEAD.

---

## 1. MATRIZ PRINCIPAL DE DIVERGENCIAS

| # | Capa | NORMAL (dryRunMode=false) | DRY (dryRunMode=true) | Diferencia | Riesgo | Destino SPOT |
|---|------|--------------------------|----------------------|------------|--------|--------------|
| 1 | PnL sell | NET: `gross - entryFee - exitFee` (`tradingEngine.ts:7276-7285`) | GROSS: `(price - entry) * vol` sin fees (`tradingEngine.ts:6515-6516`) | DRY infla PnL ~0.8-1.0% (round-trip fees) | **CRÍTICO** | PnL NET canónico único |
| 2 | Daily PnL tracking | `this.dailyPnL += pnlNet` (`tradingEngine.ts:7285`) | No actualiza `dailyPnL` | Daily loss limit NO se aplica en DRY | **ALTO** | RiskManager único aplica en ambos |
| 3 | Fill simulation | Exchange real: slippage, spread, partial fills, FillWatcher (`tradingEngine.ts:6671-6891`) | Fill perfecto a precio de señal, sin slippage/spread (`tradingEngine.ts:6400-6599`) | DRY asume fills imposibles | **CRÍTICO** | SpotShadowAdapter con slippage/spread estimados |
| 4 | TimeStop | `TimeStopService` (`exitManager.ts:513,1215`) | `TimeStopService` + `SmartTimeStopV2` (DRY-only, `exitManager.ts:1267-1269`) | Dos motores TimeStop | **ALTO** | Un solo SpotExitPolicy.TimeEfficiency |
| 5 | Régimen (vocabulario) | `TREND/RANGE/TRANSITION` (`regimeDetection.ts:12`) | Mismo para entrada; `TREND/CHOP/VOLATILE` en SmartExit (`SmartExitEngine.ts:25`) | Dos vocabularios sin mapping | **ALTO** | SpotRegimeContext único |
| 6 | Tabla DB | `open_positions` + `trades` + `trade_fills` + `lot_matches` | `dry_run_trades` + `dry_run_trades_archive` (`schema.ts:465-519`) | Tablas separadas, schemas distintos | **MEDIO** | Migración aditiva con `executionMode` |
| 7 | API endpoints | `/api/positions`, `/api/trades/*`, `/api/portfolio-summary` | `/api/dryrun/positions,history,summary,clear,backfill,exit-audit,timestop-audit` (`dryrun.routes.ts`) | 7 endpoints paralelos | **MEDIO** | `/api/spot/*` unificado; legacy deprecated |
| 8 | UI | Pestañas POSICIONES + HISTORIAL (`Terminal.tsx:1053,1061`) | Pestañas DRY RUN + HIST. DRY (`Terminal.tsx:1069,1077`) | UI completamente separada | **MEDIO** | UI SPOT unificada con badge mode |
| 9 | Score/KPI | `/api/portfolio-summary` (realized PnL aggregate) | `/api/dryrun/summary` (Smart Strategy Score 0-100, `dryrun.routes.ts:269-376`) | Scoring separado, no comparable | **MEDIO** | KPIs SPOT unificados, no mezclados |
| 10 | Telegram | Sin throttle, sin prefijo | Throttle 15min/pair+type (`tradingEngine.ts:6572-6597`), prefijo `[DRY_RUN]` (`telegram.ts:2364`) | Throttle + etiqueta distintos | **BAJO** | Telegram unificado con badge mode |
| 11 | Persistencia posición | `saveOpenPositionByLotId` a `open_positions` | Skip DB save (`tradingEngine.ts:2752`), solo in-memory + `dry_run_trades` | Persistencia distinta | **BAJO** | SpotPositionModel único |
| 12 | Carga posición | Desde `open_positions` (`tradingEngine.ts:2540-2630`) | Desde `dryRunTrades` (`tradingEngine.ts:2532-2741`) | Carga distinta | **BAJO** | Carga unificada con filtro mode |
| 13 | Slot counting | Open + pending fills + intents (`tradingEngine.ts:1033`) | Solo open, asume ejecución instantánea (`tradingEngine.ts:1033-1038`) | DRY no modela latencia | **BAJO** | Slot counting único con pending en SHADOW |
| 14 | Fee source | `getTakerFeePct()` → `ExchangeFactory.getTradingExchangeFees()` → RevolutX 0.09% | Mismo `getTakerFeePct()` | **Misma fuente** | **NINGUNO** | SpotFeeModel canónico |
| 15 | Fee fallback | `KRAKEN_FEE_PCT = 0.40` si factory falla (`tradingEngine.ts:123-135`) | Mismo fallback | Kraken fee filtra si error | **MEDIO** | Sin fallback Kraken; fail explícito |
| 16 | Hardcodes Kraken | `FALLBACK_MINIMUMS` Kraken (`tradingEngine.ts:505-513`), pair mapping (`kraken.ts:563-629`) | Mismo | Kraken-specific | **MEDIO** | Exchange-agnostic; Kraken solo como data |
| 17 | SmartGuard | Idéntico (mode-agnostic) | Idéntico | Sin divergencia | **NINGUNO** | Reutilizar |
| 18 | Sizing | Idéntico (`tradingEngine.ts:4110-4128,5306-5317`) | Idéntico | Sin divergencia | **NINGUNO** | Reutilizar + riskUsd |
| 19 | Regime detection (entrada) | `getMarketRegimeWithCache` (`tradingEngine.ts:4732-4758`) | Mismo | Sin divergencia en entrada | **NINGUNO** | SpotRegimeContext único |
| 20 | Strategy voting | `signalAccumulator` + `minSignalsRequired=5` (`strategies.ts:114`) | Mismo | Heterogéneo (+1/+2) | **MEDIO** | SPOT_CANONICAL reemplaza voting |
| 21 | intermediateExec | Bypass staleness/chase si `intermediateExec=true` (`tradingEngine.ts:5138,5171`) | No usa intermediateExec | Bypass existe pero DRY no lo usa | **BAJO** | SpotEntryIntent elimina bypass |
| 22 | SmartExit | Config toggle `enabled=false` (`SmartExitEngine.ts:66`), ambos modos | Mismo | Experimental, no mode-gated | **MEDIO** | Lógica buena → SpotExitPolicy |
| 23 | MFE/MAE | `auditMetrics.ts` existe | Mismo | Compartido | **NINGUNO** | Integrar en SpotAudit |
| 24 | Timestamps sec/ms | Kraken devuelve seconds (`kraken.ts:550`); conversión `*1000` dispersa (`mtfAnalysis.ts:152`, `tradingEngine.ts:3518-3519`) | Mismo | Sin helper canónico | **ALTO** | normalizeCandleTimestampMs() |
| 25 | MTF | 5m/1h/4h via `getOHLC` (`mtfAnalysis.ts:245-247`); 15m NO se fetchea en MTF | Mismo | Falta 15m en MTF; sin close-time helper | **MEDIO** | SpotMarketContext con 4tf |

---

## 2. CONFIRMACIÓN DE LAS 15 DIVERGENCIAS ESPECÍFICAS DEL PLAN

### 2.1 DRY PnL bruto vs LIVE PnL neto — **CONFIRMADO**
- DRY: `tradingEngine.ts:6515-6516` — `(price - entryPrice) * volume` (GROSS, sin fees)
- LIVE: `tradingEngine.ts:7276-7285` — `gross - proratedEntryFee - exitFee` (NET)
- Impacto: DRY infla ~0.8-1.0% por round-trip fees (0.09% × 2 = 0.18% Revolut X; o 0.40% × 2 = 0.80% si fallback Kraken)

### 2.2 SmartTimeStopV2 DRY-only — **CONFIRMADO**
- `SmartTimeStopV2.ts:4-8` — header "DRY RUN ONLY", `realEnabled: false`
- `exitManager.ts:1267` — `if (this.host.isDryRunMode())` gatea la invocación
- `exitManager.ts:1269` — `evaluateSmartTimeStopV2({...})`
- Normal usa solo `TimeStopService` (`exitManager.ts:513,1215`)

### 2.3 intermediateExec y bypass — **CONFIRMADO (con matiz)**
- `tradingEngine.ts:5138` — `stalenessGateEnabled = (...) && !intermediateExec`
- `tradingEngine.ts:5171` — `chaseGateEnabled = (...) && !intermediateExec`
- Matiz: DRY no usa intermediateExec directamente, pero el bypass existe en el código compartido. SpotEntryIntent debe eliminar esta semántica.

### 2.4 Regímenes duplicados — **CONFIRMADO**
- Vocabulario A: `TREND/RANGE/TRANSITION` (`regimeDetection.ts:12`) — entrada
- Vocabulario B: `TREND/CHOP/VOLATILE` (`SmartExitEngine.ts:25`) — SmartExit
- Sin mapping layer entre ambos

### 2.5 Código experimental SmartExit — **CONFIRMADO**
- `SmartExitEngine.ts:2` — "Experimental dynamic exit system"
- `SmartExitEngine.ts:66` — `enabled: false` por defecto (feature flag, no mode-gated)
- Disponible para ambos modos vía config toggle

### 2.6 Lógica de strategy voting — **CONFIRMADO**
- `strategies.ts:75-163` (momentumStrategy): votos heterogéneos EMA +1, RSI +2, MACD +1, Bollinger +1, volume +1, trend +1
- `strategies.ts:114` — `minSignalsRequired = 5`
- `signalAccumulator.ts:11` — `ACCUMULATOR_THRESHOLD = 3`
- RSI oversold (+2) al mismo nivel conceptual que EMA bullish (+1) — heterogéneo

### 2.7 Diferencias de modelo de posición — **PARCIAL**
- Estructura `OpenPosition` idéntica (`tradingEngine.ts:394-407`)
- Persistencia distinta: DRY skip DB (`tradingEngine.ts:2752`), LIVE a `open_positions`
- Carga distinta: DRY desde `dryRunTrades` (`tradingEngine.ts:2532`), LIVE desde `open_positions`

### 2.8 Diferencias UI — **CONFIRMADO**
- `Terminal.tsx:1053,1061` — POSICIONES, HISTORIAL (Normal)
- `Terminal.tsx:1069,1077` — DRY RUN, HIST. DRY (DRY)
- Queries separadas: `/api/dryrun/*` (`Terminal.tsx:389-421`)
- Interfaces separadas: `DryRunTrade` (`Terminal.tsx:135-161`) vs `OpenPosition` (`Terminal.tsx:110-133`)
- KPIs NO mezclados (cada tab tiene sus métricas) — `Terminal.tsx:933-943`

### 2.9 Endpoints separados — **CONFIRMADO**
- 7 endpoints `/api/dryrun/*` (`dryrun.routes.ts:13-1238`) sin equivalente Normal directo
- Normal: `/api/positions`, `/api/trades/closed`, `/api/portfolio-summary`

### 2.10 Tablas separadas — **CONFIRMADO**
- `dry_run_trades` (`schema.ts:465-495`): `simTxid`, `normalizedReason`, `excludedFromPnl`, `auditBatchId`, `effectiveDecisionContextJson`
- `trades` (`schema.ts:266-286`): `exchange`, `origin`, `executedByBot`, `orderIntentId`, `krakenOrderId`, `executedAt`
- `dry_run_trades_archive` (`schema.ts:498-519`)

### 2.11 Fee sources distintas — **REFUTADO (misma fuente, pero fallback peligroso)**
- Ambos usan `getTakerFeePct()` → `ExchangeFactory.getTradingExchangeFees()` → RevolutX 0.09%
- PERO: fallback `KRAKEN_FEE_PCT = 0.40` (`tradingEngine.ts:123`) si factory falla
- Hardcodes Kraken adicionales: `regimeDetection.ts:216` (0.40), `amaCapacityResearch.ts:213-214` (0.26/0.16)
- `bot_config.taker_fee_pct` NO se usa como fuente (solo display en UI)

### 2.12 Hardcodes de Kraken — **CONFIRMADO**
- `tradingEngine.ts:123` — `KRAKEN_FEE_PCT = 0.40`
- `tradingEngine.ts:505-513` — `FALLBACK_MINIMUMS` (Kraken mins)
- `kraken.ts:563-629` — pair mapping Kraken-specific
- `ExchangeFactory.ts:146-147` — fees Kraken hardcoded en status
- `regimeDetection.ts:216` — `TAKER_FEE_PCT = 0.40`

### 2.13 Fill simulation distinta de LIVE — **CONFIRMADO**
- DRY: fill perfecto a precio de señal, `simTxid = DRY-${Date.now()}`, instantáneo (`tradingEngine.ts:6400-6599`)
- LIVE: `placeOrder` market, FillWatcher, partial fills, reconcile via sync (`tradingEngine.ts:6671-6891`)
- `SLIPPAGE_BUFFER_PCT = 0.20` existe (`tradingEngine.ts:124`) pero solo para fee calc, no para fill price

### 2.14 Diferencias Telegram — **CONFIRMADO (menor)**
- DRY: throttle 15min/pair+type (`tradingEngine.ts:6572-6597`), prefijo `[DRY_RUN]` (`telegram.ts:2364`)
- LIVE: sin throttle
- Templates compartidos (`telegram/templates.ts`); PnL semantics no difieren a nivel template

### 2.15 Diferencias de score — **CONFIRMADO**
- DRY: Smart Strategy Score 0-100 (`dryrun.routes.ts:269-376`): clean PnL (25), risk (25), exit quality (20), stats (15), ops (10), sample (5)
- Normal: `/api/portfolio-summary` — realized PnL aggregate, per-exchange
- Métricas no comparables directamente

---

## 3. HALLAZGOS ADICIONALES NO LISTADOS EN EL PLAN

### 3.1 Daily loss limit no aplicado en DRY
- `tradingEngine.ts:7285` — `this.dailyPnL += pnlNet` solo en LIVE
- DRY nunca actualiza `dailyPnL` → daily loss limit (`tradingEngine.ts:3191-3221`) no se aplica
- **Riesgo ALTO**: SHADOW debe aplicar risk limits idénticos a REAL

### 3.2 15m no fetcheado en MTF
- `mtfAnalysis.ts:245-247` — solo 5m, 1h, 4h
- 15m se obtiene por otra vía (candle close event en tradingEngine)
- SpotMarketContext debe incluir 15m explícitamente

### 3.3 Expire stale DRY positions
- `tradingEngine.ts:2665-2671` — DRY expira posiciones >7 días
- LIVE no tiene este mecanismo (depende de TimeStop/exit)
- SpotPositionModel debe unificar la política de expiración

### 3.4 Kraken pair format hardcode
- `kraken.ts:605-616` — mapeo `BTC/USD → XXBTZUSD` etc.
- Revolut X usa formato distinto (`BTC-USD`)
- Data exchange = Kraken (correcto), pero no hay capa de abstracción de pair format

### 3.5 `excludedFromPnl` / `auditBatchId` solo en DRY
- `schema.ts:489-493` — columnas de auditoría solo en `dry_run_trades`
- Normal `trades` no tiene estas columnas
- Migración SPOT debe añadir equivalentes a tabla unificada

---

## 4. ARQUITECTURA ACTUAL (DIAGRAMA DE DIVERGENCIA)

```
                    ┌─── NORMAL (dryRunMode=false) ───┐
                    │  open_positions + trades         │
                    │  NET PnL                         │
                    │  Real fills (slippage/spread)    │
                    │  TimeStopService                 │
                    │  dailyPnL enforced               │
                    │  /api/positions, /api/trades/*   │
                    │  UI: POSICIONES + HISTORIAL      │
                    │  No Telegram throttle            │
                    └──────────────────────────────────┘
tradingEngine.ts
(dryRunMode boolean)
                    ┌─── DRY (dryRunMode=true) ───────┐
                    │  dry_run_trades                  │
                    │  GROSS PnL (no fees)             │
                    │  Perfect fills (no slippage)     │
                    │  TimeStopService + SmartTimeStopV2│
                    │  dailyPnL NOT enforced            │
                    │  /api/dryrun/* (7 endpoints)     │
                    │  UI: DRY RUN + HIST. DRY         │
                    │  Telegram throttle 15min         │
                    └──────────────────────────────────┘

COMPARTIDO (idéntico en ambos):
  - Regime detection (entrada): TREND/RANGE/TRANSITION
  - SmartGuard
  - Sizing logic
  - Signal accumulator / strategy voting
  - OpenPosition structure
  - EntryDecisionContext
  - MomentumExpansionDetector
  - ExitManager (SL/TP/BE/Trailing/ScaleOut)
  - Fee source (getTakerFeePct)

DIVERGENTE EN EXIT:
  - SmartExit: TREND/CHOP/VOLATILE (separate regime, config-gated, not mode-gated)
  - SmartTimeStopV2: DRY-only
```

---

## 5. ARQUITECTURA OBJETIVO SPOT (POST-FUSIÓN)

```
                    ┌─── SPOT (ExecutionMode enum) ───┐
                    │  SpotPositionModel (único)       │
                    │  NET PnL canónico (único)        │
                    │  SpotExecutionAdapter             │
                    │    ├─ SHADOW: fill simulado       │
                    │    │   (spread/slippage estimados)│
                    │    │   NO placeOrder (guard)      │
                    │    └─ REAL: placeOrder            │
                    │  SpotExitPolicy (única)           │
                    │    └─ TimeEfficiency (único)      │
                    │  SpotRegimeContext (único)        │
                    │  RiskManager (único, ambos modos) │
                    │  /api/spot/* (unificado)          │
                    │  UI SPOT (única, badge mode)      │
                    │  Telegram (único, badge mode)     │
                    └──────────────────────────────────┘

LEGACY (aislado, solo lectura):
  - dry_run_trades → LEGACY_DRY_RUN
  - /api/dryrun/* → deprecated
  - SmartTimeStopV2 → lógica buena migrada a SpotExitPolicy; código original deprecado
  - SmartExit experimental → lógica buena migrada a SpotExitPolicy; código original deprecado
```

---

## 6. VEREDICTO DE FASE 1

| Criterio | Estado |
|----------|--------|
| Matriz capa/Normal/DRY/diferencia/riesgo/destino | **Completa** (25 filas) |
| 15 divergencias específicas del plan verificadas | **14 confirmadas, 1 refutada con matiz** (fee sources: misma fuente pero fallback peligroso) |
| Trazabilidad file:line contra HEAD | **Completa** |
| Sin implementación (solo análisis) | **Cumplido** |

**FASE 1 = PASS.**

### Divergencias críticas a resolver primero (orden de impacto):
1. **PnL GROSS vs NET** (CRÍTICO) — FASE 5
2. **Fill simulation sin slippage** (CRÍTICO) — FASE 12
3. **Daily PnL no aplicado en DRY** (ALTO) — FASE 11
4. **Dos TimeStop engines** (ALTO) — FASE 13
5. **Dos vocabularios de régimen** (ALTO) — FASE 7
6. **Timestamps sec/ms sin helper** (ALTO) — FASE 4
7. **Tablas/endpoints/UI separados** (MEDIO) — FASE 15/16/17

---

**FIN FASE 1**
