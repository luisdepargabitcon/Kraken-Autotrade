# REPORT — Spot Adaptive Risk R1 (risk reduction only)

Fecha: 2026-09-24 · Rama: `research/spot-risk-r1`
Base: `eca997b` (Exit R1 cerrado, KEEP_E0). SHADOW. Sin deploy, sin REAL.
Entry V4 congelada (thr histórico [0.50,0.30,0.30]). Exit E0 congelado. Stop inicial intacto.

## 1. R0 baseline (congelado, documentado)

`DEFAULT_SPOT_RISK_CONFIG`: riskPerTradeUsd=50, maxRiskPerPairUsd=100,
minOrderUsd=100, maxOrderUsd=5000, maxLotsPerPair=2, slAtrMultiplier=2.0
(×0.5 RANGE / ×0.75 TRANSITION), stop 0.5–5%, spread gates, minExpectedProfit=5,
minSlotEfficiency=50%, dust=10, minProfitMultiplier=2.
Sizing: `volume = riskUsd / stopDistanceUsd`. Fees taker 0.09%.

## 2. Forensic R0 (R0_FORENSIC.csv / R0_RISK_BUCKETS.csv)

84 trades, net -85.19 (ventana completa, thr 0.30). Concentración de riesgo malo:

| Dimensión | Bucket | Trades | Net | PF |
|-----------|--------|--------|-----|-----|
| qualityScore | 0.45–0.55 | 16 | **-268.45** | **0.148** |
| qualityScore | 0.55–0.70 | 10 | +238.48 | 7.030 |
| qualityScore | 0.30–0.45 | 58 | -55.22 | ~0.93 |
| atrPct | ≥3 | 2 | **-111.17** | 0.000 |
| atrPct | 2–3 | 4 | +124.99 | 4.760 |
| openPositions | 0 vs 1 | 66/18 | -70/-15 | 0.930/0.936 (sin diferencia) |
| exitReason | EMERGENCY | 5 | -292.77 | avgR -1.09 |

**Factores justificados por datos**: A) calidad débil (score <0.55) y
B) volatilidad alta (atrPct). Exposición descartada (sin diferenciación PF).

## 3. R1 policy (spotAdaptiveRiskR1.ts)

`effectiveRiskUsd = baseRiskUsd × m`, `m = min(triggered reductions)`, clamp
[0.25, 1.0]. Fuentes: lowQualityBelow×lowQualityMult + highAtrPctAbove×highVolMult.
Grid: lq{0.45,0.55}×lqm{0.5,0.75}×hv{2.0,2.5,3.0}×hvm{0.5,0.75} = **24 combos**.

## 4. WFO — 3 folds, selección netToDD en TRAIN

| Fold | Thr | Best R1 | Train netToDD (trades) |
|------|-----|---------|------------------------|
| 0 | 0.50 | lq0.55@0.5_hv2@0.5 | -0.684 (5) |
| 1 | 0.30 | lq0.55@0.5_hv2@0.5 | -0.970 (26) |
| 2 | 0.30 | lq0.45@0.75_hv2@0.5 | -0.897 (15) |

Selección débil: todos los train netToDD negativos.

## 5. Path-dependent OOS (test folds)

| Pol | Trades | Net | PF | DD | net/DD | Risk dep. | Avg risk | Worst | maeMean |
|-----|--------|-----|----|----|--------|-----------|----------|-------|---------|
| **R0** | 52 | **297.38** | **1.408** | 275.98 | **1.078** | 2600 | 50.00 | -64.46 | 0.307 |
| R1 | 57 | 64.15 | 1.094 | 275.27 | 0.233 | 2150 | 37.72 | **-78.73** | 0.338 |
| U75 | 58 | 73.68 | 1.105 | 285.71 | 0.258 | 2175 | 37.50 | -78.73 | 0.333 |
| U50 | 59 | 118.20 | 1.252 | **190.47** | 0.621 | 1475 | 25.00 | -52.48 | 0.327 |

R1/U75/U50 abren MÁS trades (57–59 vs 52): menor tamaño libera slots/capital
→ efecto path-dependent real, pero no compensa.

## 6. Por par (OOS, R0 vs R1 net)

| Par | R0 | R1 | U75 | U50 |
|-----|-----|-----|------|------|
| BTC | **177.71** | 64.52 | 29.78 | 88.93 |
| ETH | **45.01** | -36.62 | -20.57 | -13.71 |
| SOL | **169.83** | 135.15 | 135.85 | 90.56 |
| XRP | -95.17 | -98.90 | -71.38 | **-47.59** |

## 7. Fixed cohort (mismas entradas/salidas, solo size)

| Pol | Net | Risk deployed |
|-----|-----|---------------|
| R0 | **297.38** | 2600 |
| R1 (avgMult=0.769) | 200.69 | 2000 |
| U75 | 223.03 | 1950 |
| U50 | 148.69 | 1300 |

**R1 (200.69) < U75 (223.03)** con riesgo desplegado comparable (~0.77 vs 0.75)
→ la reducción adaptativa NO aporta edge sobre simplemente bajar todo el riesgo.

## 8. Production-030 (params R1 del WFO histórico, thr=0.30)

| Pol | Net | PF | DD | net/DD |
|-----|-----|----|----|--------|
| R0 | **217.22** | 1.262 | 275.98 | 0.787 |
| R1 | 24.07 | 1.033 | 275.27 | 0.087 |
| U75 | 13.56 | 1.017 | 285.71 | 0.047 |
| U50 | 78.12 | 1.150 | 190.47 | 0.410 |

## 9. PASS criteria — todos fallan

- PF ≥ R0: 1.094 < 1.408 ✗
- net/DD mejora ≥10%: 0.233 vs 1.078 → -78% ✗
- DD mejora material: 275.27 ≈ 275.98 ✗ (sin mejora)
- Net ≥85% R0: 64.15 = 21.6% ✗
- Worst-loss tail mejora: -78.73 < -64.46 ✗ (peor)
- Supera control uniforme comparable: R1(0.769 avg) 200.69 < U75 223.03 ✗
- Sin deterioro extremo por par: ETH pasa de +45 a -36.6 ✗

## 10. Veredicto

**FINAL_VERDICT=KEEP_R0.**

La reducción adaptativa R1 no solo no mejora a R0 — es peor que un control
uniforme de riesgo equivalente (U75). La zona de calidad 0.45–0.55 que motivó
el factor A era mala en el forensic completo pero su reducción no se traduce en
edge OOS (los trades de baja calidad también contienen ganadores que se recortan).
Ninguna variable futura usada; temporalidad verificada por tests (38/38 con
exitR1). R0 permanece congelado como baseline de producción.
