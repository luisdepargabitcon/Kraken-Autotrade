# Market Metrics — alcanzabilidad por sensibilidad

Fecha: 2026-11-27  
Alcance: análisis estático de alcanzabilidad. No cambia umbrales ni activa el filtro.

## Criterio

El motor redondea `scoreRaw × SENSITIVITY_MULTIPLIERS[sensibilidad]`. Para que una compra pueda recibir `BLOQUEAR` en modo activo debe alcanzar riesgo `ALTO`, es decir `score > SCORE_THRESHOLDS.MEDIUM.max` (estrictamente mayor que 4).

## Tabla

| Conjunto de proveedores | Sensibilidad | Score bruto máximo | Score final máximo | BLOQUEAR alcanzable |
|---|---:|---:|---:|---|
| Binance Futures + DeFiLlama | conservador | 5 | 4 | No |
| Binance Futures + DeFiLlama | normal | 5 | 5 | Sí |
| Binance Futures + DeFiLlama | agresivo | 5 | 7 | Sí |
| Binance Futures | conservador | 3 | 2 | No |
| Binance Futures | normal | 3 | 3 | No |
| Binance Futures | agresivo | 3 | 4 | No |
| DeFiLlama | conservador | 2 | 1 | No |
| DeFiLlama | normal | 2 | 2 | No |
| DeFiLlama | agresivo | 2 | 3 | No |
| Todos los proveedores | conservador | 11 | 8 | Sí |
| Todos los proveedores | normal | 11 | 11 | Sí |
| Todos los proveedores | agresivo | 11 | 15 | Sí |

## Lectura acotada

- Con el conjunto operativo mínimo esperado `Binance Futures + DeFiLlama`, `BLOQUEAR` sí es matemáticamente alcanzable en sensibilidad `normal` y `agresivo`, pero solo si las tres métricas disponibles alcanzan simultáneamente su puntuación máxima.
- En sensibilidad `conservador`, ese mismo conjunto no puede alcanzar `BLOQUEAR` porque el máximo final es 4.
- Con solo Binance Futures o solo DeFiLlama, `BLOQUEAR` no es alcanzable en ninguna sensibilidad actual.
- Con todos los proveedores operativos, `BLOQUEAR` sí es alcanzable en todas las sensibilidades.

## Recomendación

No activar un filtro bloqueante basado en estas métricas sin validación empírica posterior. Esta tabla demuestra únicamente alcanzabilidad matemática del scoring actual; no demuestra calidad predictiva, cobertura real ni estabilidad operativa de los proveedores.
