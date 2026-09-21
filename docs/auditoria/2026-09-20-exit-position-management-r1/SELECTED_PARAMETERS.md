# SELECTED_PARAMETERS — Exit R1 WFO

Grid: `staleSinceLastMfeMinutes × staleMaxR × mfeGivebackActivateR × mfeGivebackPct × atrTrailMult × feeAwareBreakEven` — 96 combos/fold (cap 100).
Entry: V4 FROZEN @ threshold 0.30 (production). Fees: taker 0.09%.

## Parámetros seleccionados por fold (mejor score en TRAIN)

| Fold | Train | Test | Combo seleccionado | Train score | Train trades |
|------|-------|------|--------------------|-------------|--------------|
| 0 | 2026-03-15→06-13 | 06-13→07-13 | `stale180_r0.5_gb1.2@0.4_atr2_fa0` | -1.14 | 24 |
| 1 | 2026-04-14→07-13 | 07-13→08-12 | `stale180_r0.5_gb1.2@0.4_atr2_fa0` | 0.19 | 21 |
| 2 | 2026-05-14→08-12 | 08-12→09-11 | `stale180_r0.5_gb0.8@0.6_atr2.5_fa0` | -0.52 | 12 |

## Params del combo dominante (folds 0-1)

```json
{
  "staleSinceLastMfeMinutes": 180,
  "staleMaxR": 0.5,
  "mfeGivebackActivateR": 1.2,
  "mfeGivebackPct": 0.4,
  "atrTrailMult": 2.0,
  "feeAwareBreakEven": false
}
```

Fold 2 diverge: `gb0.8@0.6_atr2.5` (activación de giveback más temprana, trail más ancho).

## Veredicto de selección

**NO SE PROMUEVE NINGÚN PARÁMETRO A PRODUCCIÓN.**

- Los train scores son débiles/negativos (-1.14, 0.19, -0.52) con pocos trades
  (12-24/fold) → selección con poca señal estadística.
- OOS agregado: E1 net=141.24 PF=1.175 < E0 net=217.22 PF=1.262.
- E1 pierde en 2 de 3 folds y en el agregado.
- `feeAwareBreakEven=false` ganó en los 3 folds → el BE fee-aware no aporta.

E0 (`DEFAULT_SPOT_EXIT_CONFIG` + Entry V4 @0.30) permanece como baseline de
producción. Sin cambios en parámetros de producción.
