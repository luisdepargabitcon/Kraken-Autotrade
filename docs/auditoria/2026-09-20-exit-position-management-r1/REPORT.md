# REPORT — Spot Exit Position Management R1

Fecha: 2026-09-21
Rama: `research/spot-exit-r1`
Alcance: gestión de salida (exit-only). Entry V4 @0.30 congelado. Sin deploy, sin REAL.

## 1. Forense E0 (ventana completa)

84 trades | netPnl **-85.19** | PF **0.931** | maxDD 328.40 | giveback medio **0.49R** | MFE medio 0.567R

| Par | Trades | Net | PF | WR | maxDD |
|-----|--------|-----|----|----|-------|
| BTC/USD | 12 | +156.42 | 2.119 | 58.3% | 68.22 |
| ETH/USD | 20 | -175.67 | 0.469 | 30.0% | 220.68 |
| SOL/USD | 31 | +120.01 | 1.320 | 41.9% | 136.67 |
| XRP/USD | 21 | -185.95 | 0.528 | 23.8% | 217.63 |

Motivación R1 confirmada: giveback ~0.5R sobre MFE medio 0.57R → gran parte del
MFE se devuelve. ETH/XRP concentran la pérdida.

## 2. Defectos (detalle en DEFECTS_AUDIT.md)

- **A CONFIRMADO**: `timeEfficiencyNoProgressMinutes` mide desde apertura, no desde último MFE → E1-A lo corrige.
- **B/C/D CONFIRMADOS como config muerta**: `trailingStepPct`, `regimeExit*`, `defensiveMaxAdversePctR` (deuda documentada, no corregida).
- E/G/H no confirmados (ratchet monótono, sin velas pre-entry ni futuras). F parcial (etiquetado BE vs TRAILING, sin impacto económico).

## 3. WFO — metodología

3 folds walk-forward (90d train / 30d test / 30d step), 96 combos/fold, selección
por `objectiveScore` en train multi-par. Entry V4 @0.30 fijo. Fees taker 0.09%.
Fixed-cohort gate por fold: replay de entradas E0 congeladas con evaluador E0 debe
reproducir salidas exactas — **ALL PASS, 0 mismatches**.

## 4. Resultados OOS por fold

| Fold | Test window | E1 net | E1 PF | E0 net | E0 PF | Ganador |
|------|-------------|--------|-------|--------|-------|---------|
| 0 | 06-13→07-13 | -75.79 | 0.262 | -80.16 | 0.190 | E1 (+4.4) |
| 1 | 07-13→08-12 | -18.47 | 0.806 | +5.41 | 1.060 | E0 (+23.9) |
| 2 | 08-12→09-11 | +235.50 | 1.386 | +291.96 | 1.457 | E0 (+56.5) |
| **OOS** | | **141.24** | **1.175** | **217.22** | **1.262** | **E0** |

## 5. Comparación E0 vs E1 — OOS agregado

| Métrica | E0 | E1 | Δ |
|---------|-----|-----|---|
| Trades (turnover) | 59 | 58 | -1 |
| Net PnL | 217.22 | 141.24 | **-75.98** |
| PF | 1.262 | 1.175 | -0.087 |
| Expectancy | 3.682 | 2.435 | -1.25 |
| Max DD | 275.98 | 209.36 | +66.6 (E1 mejor) |
| Win rate | 40.7% | 39.7% | -1.0pt |
| Fees | 262.38 | 259.33 | -3.05 |
| Gross PnL | 479.60 | 400.56 | -79.04 |
| Duración media | 186 min | 207 min | +21 min |
| MFE medio (R) | 0.668 | 0.693 | +0.025 |
| Giveback medio (R) | 0.506 | 0.555 | +0.049 (E1 peor) |
| Capture ratio (MFE>0.05) | -0.429 | -0.538 | -0.109 (E1 peor) |

## 6. Por par (OOS)

| Par | E0 net / PF | E1 net / PF | Δ net |
|-----|-------------|-------------|-------|
| BTC/USD | +177.71 / 3.209 | +110.18 / 2.296 | **-67.5** |
| ETH/USD | +19.86 / 1.151 | -10.67 / 0.923 | **-30.5** |
| SOL/USD | +138.84 / 1.410 | +130.14 / 1.413 | -8.7 |
| XRP/USD | -119.19 / 0.570 | -88.42 / 0.671 | **+30.8** |

## 7. Robustez

- Fixed-cohort gate: 3/3 folds PASS (cohort E0 reproduce salidas exactas).
- Tests R1: 14/14 PASS (ver TEST_RESULTS.md) — temporalidad, invarianza E0,
  monotonicidad, prioridad emergency, sin per-pair fields.
- Determinismo: dos ejecuciones completas del WFO produjeron resultados idénticos.
- Selección débil: train scores negativos en folds 0 y 2, con 12-24 trades → el
  mejor combo no es estadísticamente robusto.

## 8. Veredicto

**FAIL — E1 no supera a E0 en OOS.** E1 reduce maxDD (-66.6) pero sacrifica
-75.98 net (-35%), empeora giveback (+0.049R) y capture ratio. Solo mejora XRP.
La hipótesis E1 (stale-desde-MFE + giveback protection + ATR ratchet) no genera
edge neto en este grid/ventana.

**Decisión**: mantener E0 en producción. No se promueve ningún parámetro.
El defecto A (no-progress desde apertura) sigue siendo real pero su corrección
aislada no paga en OOS; posible causa: stale exit protege de trades que E0 deja
sangrar, pero el giveback cap recorta ganadores que E0 deja correr hasta trailing.

Deuda pendiente documentada: config muerta B/C/D, métrica capture no robusta,
findIndex O(n²) en cohort replay, guard de regimeContext en DEFENSIVE.
