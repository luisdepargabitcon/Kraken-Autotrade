# Inventario de divergencias de indicadores

Estado WP4b: librería común creada, sin sustitución automática de consumidores productivos salvo `computeEmaStrict` de IDCA, cuya semántica es idéntica y queda como wrapper.

| Consumidor | Ubicación | Convención actual | Divergencia | Estado |
|---|---|---|---|---|
| IDCA | `server/services/institutionalDca/IdcaSmartLayer.ts` | RSI Wilder con serie plana=100 | La librería soporta `legacy100` pero por defecto marca plana como unreliable/50 | No migrado para no cambiar score productivo |
| IDCA | `IdcaSmartLayer.computeATR` | ATR SMA de TR | La librería exige `method:'sma'` explícito | No migrado aún |
| SPOT | `server/services/indicators.ts` | MACD/Bollinger/RSI con ventanas históricas y políticas propias | Puede diferir por truncamiento, RSI plano=100 y warm-up | No migrado; requiere medición de impacto |
| AMA | `amaHwmBar.ts` | ATR propio | Convención debe verificarse antes de migrar | No migrado |
| Bollinger consumidores | varios | desviación habitualmente poblacional o implícita | La librería fija poblacional y `flat_band` sin NaN | No migrado |

Criterio: las migraciones solo se harán donde la semántica sea idéntica o tras evidencia de impacto.
