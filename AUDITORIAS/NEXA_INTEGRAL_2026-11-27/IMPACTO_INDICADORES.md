# Impacto de indicadores — medición pública acotada

Comando: `npx tsx scripts/measure_indicator_impact.ts`. Fuentes públicas Kraken OHLC sin claves: BTC/USD y ETH/USD, 1h, últimas ~720 velas (2 peticiones HTTP). Snapshot y hashes en `data_public/`; resultados JSON en `IMPACTO_INDICADORES.json`.

## Resultados principales

- BTC: MACD completo -261.5923 vs truncado -261.9541; diferencia absoluta 0.3618; desacuerdo de signo del histograma 0.15% de ventanas evaluadas.
- ETH: MACD completo -9.8315 vs truncado -9.8417; diferencia absoluta 0.0101; desacuerdo de signo 0.15%.
- Series planas en datos reales: 0 ticks en BTC y ETH; el caso RSI plano no apareció en esta muestra.
- ATR BTC SMA 583.1357 vs Wilder 524.8938: SMA +11.096%.
- ATR ETH SMA 18.0621 vs Wilder 16.8271: SMA +7.339%.
- Score proxy ETH con EMA50 estricta: 63. El proxy de historia corta queda no disponible porque la semántica estricta exige warm-up real; esto evidencia fail-closed, pero no constituye una comparación completa contra la implementación histórica EMA20-desplazada.
- Ablation de volumen relativo: no completada en esta iteración; la política implementada en WP4a bloquea por defecto cuando falta volumen fiable.

## Límites

Muestra pequeña y ventana corta; proxy analítico, no replay del motor; no usa compras reales ni evidencia rentabilidad; no afirma causalidad. Los datos son públicos y publicables.
