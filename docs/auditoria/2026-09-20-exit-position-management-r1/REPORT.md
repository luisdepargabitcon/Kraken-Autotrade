# REPORT — Spot Exit Position Management R1 (metodología corregida)

Fecha: 2026-09-21 · Rama: `research/spot-exit-r1`
Alcance: exit-only. Entry V4 congelada. SHADOW. Sin deploy, sin REAL, sin GRID.
Base: RESEARCH_BASE_SHA=368b19d11cc9fa5949aad623cedaa6a44259a636.

## 0. Corrección metodológica aplicada

El WFO inicial comparaba E0 vs E1 con threshold 0.30 en todos los folds, grid
truncado por orden (144→slice(100)) y sin cohort E1. Corregido:

- **Thresholds históricos por fold**: `[0.50, 0.30, 0.30]` en TRAIN y TEST.
- **Grid balanceado exacto**: 96 combos (3×2×2×2×2×2), assert `grid.length===96`.
- **Fixed-cohort E0 vs E1**: mismas entradas E0 congeladas replayed con ambos
  evaluadores (FIXED_COHORT_E0_VS_E1.csv) + gate de reproducción E0.
- **Production-030 secundario**: E0@0.30 vs E1@0.30 (params E1 del WFO histórico).
- **Capture/giveback**: capture solo sobre trades con `mfeR > 0.05` (mean+median+n);
  giveback = `mfeR - rMultiple` (mean+median). Agregado defectuoso anterior
  descartado como métrica principal.
- `downloadKrakenZips.ts` eliminado de la rama (ajeno a Exit R1).

## 1. Forense E0 (sin cambios — válido)

84 trades | netPnl **-85.19** | PF **0.931** | maxDD 328.40 | giveback medio **0.49R**.
ETH (PF 0.469) y XRP (PF 0.528) concentran la pérdida.

## 2. Defectos (DEFECTS_AUDIT.md — sin cambios)

A confirmado (no-progress desde apertura); B/C/D config muerta; E/G/H descartados; F parcial.

## 3. WFO — 3 folds, 96 combos, thresholds históricos

| Fold | Thr | Train | Test | Best E1 | Tr.score (trades) |
|------|-----|-------|------|---------|-------------------|
| 0 | 0.50 | 03-15→06-13 | 06-13→07-13 | stale120_r0.3_gb0.8@0.6_atr2_fa0 | -0.88 (5) |
| 1 | 0.30 | 04-14→07-13 | 07-13→08-12 | stale180_r0.5_gb1.2@0.4_atr2_fa0 | 0.19 (21) |
| 2 | 0.30 | 05-14→08-12 | 08-12→09-11 | stale180_r0.5_gb0.8@0.6_atr2.5_fa0 | -0.52 (12) |

Cohort gate FIXED_COHORT_REPRODUCES_E0: **3/3 PASS, 0 mismatches**.

## 4. Path-dependent OOS por fold

| Fold | Test | E1 net/PF | E0 net/PF | Ganador |
|------|------|-----------|-----------|---------|
| 0 | 06-13→07-13 | 0.00 / — (0 trades) | 0.00 / — (0 trades) | empate |
| 1 | 07-13→08-12 | -18.47 / 0.806 | +5.41 / 1.060 | E0 (+23.9) |
| 2 | 08-12→09-11 | +235.50 / 1.386 | +291.96 / 1.457 | E0 (+56.5) |

Fold 0 @0.50 no produjo entradas en test → el OOS agregado descansa sobre folds 1-2.

## 5. Path-dependent OOS agregado

| Métrica | E0 | E1 | Δ (E1−E0) |
|---------|-----|-----|-----------|
| Trades | 52 | 51 | -1 |
| Net | **297.38** | 217.03 | **-80.35** |
| PF | **1.408** | 1.308 | -0.100 |
| Expectancy | **5.719** | 4.255 | -1.46 |
| Max DD | 275.98 | **209.36** | +66.6 (E1 mejor) |
| Win rate | 42.3% | 41.2% | -1.1pt |
| Fees | 220.89 | 217.83 | -3.06 |
| Duración media | 192 min | 213 min | +21 min |
| Capture mean (mfeR>0.05, n=35) | **-0.359** | -0.466 | -0.107 |
| Giveback mean (R) | **0.519** | 0.577 | +0.058 (E1 peor) |

## 6. Por par (OOS)

| Par | E0 net / PF | E1 net / PF | Δ net |
|-----|-------------|-------------|-------|
| BTC/USD | +177.71 / 3.209 | +110.18 / 2.296 | **-67.5** |
| ETH/USD | +45.01 / 1.423 | +14.48 / 1.127 | **-30.5** |
| SOL/USD | +169.83 / 1.588 | +156.76 / 1.600 | -13.1 |
| XRP/USD | -95.17 / 0.624 | -64.40 / 0.737 | **+30.8** |

## 7. Fixed-cohort E0 vs E1 (mismas entradas congeladas)

| Métrica | E0 | E1 | Δ |
|---------|-----|-----|---|
| Trades | 52 | 52 | 0 |
| Net | **297.38** | 182.24 | **-115.14** |
| PF | **1.408** | 1.246 | -0.162 |
| Capture mean | **-0.359** | -0.466 | -0.107 |
| Giveback mean | **0.519** | 0.578 | +0.059 (E1 peor) |

Atribución limpia: sobre las MISMAS entradas, E1 empeora -115.14 (-39%).

## 8. Production-030 (E1 params del WFO histórico, thr=0.30 en todos los folds)

| Métrica | E0 | E1 | Δ |
|---------|-----|-----|---|
| Trades | 59 | 58 | -1 |
| Net | **217.22** | 118.81 | **-98.41** |
| PF | **1.262** | 1.147 | -0.116 |
| Expectancy | 3.682 | 2.048 | -1.63 |
| Max DD | 275.98 | **209.36** | +66.6 (E1 mejor) |
| Capture mean | **-0.429** | -0.560 | -0.131 |
| Giveback mean | **0.506** | 0.562 | +0.056 (E1 peor) |

## 9. Robustez

- Fixed-cohort gate: 3/3 PASS (0 mismatches). Tests: 26/26 PASS.
- Fold 0 sin trades OOS → evidencia sobre 2 folds efectivos.
- E1 solo gana en XRP (+30.8); pierde BTC, ETH, SOL. **ROBUSTNESS=LOW**.
- Train scores débiles (5-21 trades, scores negativos en folds 0/2).

## 10. Veredicto

**FAIL → FINAL_VERDICT=KEEP_E0.**

Con la metodología corregida E1 vuelve a perder en las TRES comparaciones:
path-dependent (-80.35), fixed-cohort (-115.14) y production-030 (-98.41).
E1 reduce DD (-66.6) pero empeora net, PF, expectancy, capture y giveback.
El defecto A (no-progress desde apertura) es real pero su corrección aislada
no paga OOS; el giveback cap recorta ganadores que E0 deja correr.

No se promueve ningún parámetro. E0 permanece en producción.
