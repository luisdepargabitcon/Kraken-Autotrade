# SELECTED_PARAMETERS — Exit R1 WFO (metodología corregida)

Grid balanceado EXACTO: `staleSinceLastMfeMinutes(3) × staleMaxR(2) × mfeGivebackActivateR(2) × mfeGivebackPct(2) × atrTrailMult(2) × feeAwareBreakEven(2)` = **96 combos/fold**, sin truncado.
Entry V4 FROZEN — threshold histórico por fold: `HISTORICAL_ENTRY_THRESHOLDS = [0.50, 0.30, 0.30]` (fold0 vivió bajo 0.50; folds 1-2 bajo 0.30). Fees: taker 0.09%.

## Parámetros seleccionados por fold (mejor objectiveScore en TRAIN)

| Fold | Entry thr | Train | Test | Combo seleccionado | Train score | Train trades |
|------|-----------|-------|------|--------------------|-------------|--------------|
| 0 | **0.50** | 2026-03-15→06-13 | 06-13→07-13 | `stale120_r0.3_gb0.8@0.6_atr2_fa0` | -0.88 | **5** |
| 1 | 0.30 | 2026-04-14→07-13 | 07-13→08-12 | `stale180_r0.5_gb1.2@0.4_atr2_fa0` | 0.19 | 21 |
| 2 | 0.30 | 2026-05-14→08-12 | 08-12→09-11 | `stale180_r0.5_gb0.8@0.6_atr2.5_fa0` | -0.52 | 12 |

## Observaciones de selección

- Fold 0 @0.50: solo 5 trades en train y **0 en test** → selección sin señal;
  el fold no aporta trades OOS en ninguna política.
- `feeAwareBreakEven=false` vuelve a ganar en los 3 folds → el BE fee-aware
  no aporta en este grid.
- `staleMaxR=0.5` domina en folds 1-2; fold 0 eligió 0.3 con 5 trades (ruido).

## Veredicto de selección

**NO SE PROMUEVE NINGÚN PARÁMETRO A PRODUCCIÓN.**

- OOS path-dependent: E1 net=217.03 PF=1.308 < E0 net=297.38 PF=1.408.
- Fixed-cohort (mismas entradas): E1 net=182.24 < E0 net=297.38 (Δ=-115.14).
- Production-030: E1 net=118.81 < E0 net=217.22 (Δ=-98.41).
- Train scores débiles/negativos con 5-21 trades/fold → selección no robusta.

E0 (`DEFAULT_SPOT_EXIT_CONFIG` + Entry V4) permanece como baseline de producción.
