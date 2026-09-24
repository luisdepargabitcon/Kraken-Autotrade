# SELECTED_PARAMETERS — Risk R1 WFO

Grid: `lowQualityBelow{0.45,0.55} × lowQualityMult{0.5,0.75} × highAtrPctAbove{2.0,2.5,3.0} × highVolMult{0.5,0.75}` = **24 combos/fold** (≤64).
Selección TRAIN: `netToDD = net / max(maxDD, 10)` — métrica ajustada a riesgo, no PnL absoluto.
Entry histórico por fold: [0.50, 0.30, 0.30]. Exit E0. Stop inicial intacto.

## Selección por fold

| Fold | Thr | Combo | Train net | Train PF | Train DD | netToDD | Trades |
|------|-----|-------|-----------|----------|----------|---------|--------|
| 0 | 0.50 | `lq0.55@0.5_hv2@0.5` | -21.84 | 0.316 | 31.96 | -0.684 | 5 |
| 1 | 0.30 | `lq0.55@0.5_hv2@0.5` | -76.59 | 0.482 | 78.93 | -0.970 | 26 |
| 2 | 0.30 | `lq0.45@0.75_hv2@0.5` | -140.11 | 0.385 | 156.20 | -0.897 | 15 |

## Params del combo dominante (folds 0-1)

```json
{ "lowQualityBelow": 0.55, "lowQualityMult": 0.5, "highAtrPctAbove": 2.0, "highVolMult": 0.5 }
```

## Veredicto de selección

**NO SE PROMUEVE NINGÚN PARÁMETRO — KEEP_R0.**

- Train netToDD negativo en los 3 folds → no hubo candidato sano siquiera en train.
- OOS: R1 net=64.15 PF=1.094 netDD=0.233 vs R0 net=297.38 PF=1.408 netDD=1.078.
- Fixed cohort: R1 200.69 < U75 223.03 → sin edge adaptativo vs control uniforme.
- R1_AVG_RISK_MULTIPLIER=0.769; R1_TOTAL_RISK_DEPLOYED=2150 (vs R0 2600).

El sizing R0 (`riskPerTradeUsd=50`) permanece sin cambios.
