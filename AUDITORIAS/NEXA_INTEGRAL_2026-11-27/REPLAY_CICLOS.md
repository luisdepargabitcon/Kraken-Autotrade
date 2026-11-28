# REPLAY CAUSAL DE CICLOS IDCA — harness y resultados (NO CONCLUYENTE)

**Estado: harness causal completado y ejecutado sobre datos públicos. NO es evidencia de rentabilidad. Ninguna variante activada. SIN APROBAR.**

## Qué es y qué no es

`scripts/idca_cycle_replay.ts` simula la máquina de estados completa del ciclo DCA (entrada por dip, compras de seguridad escalonadas, TP con trailing, cierre) de forma **causal**: en cada vela cerrada solo se usa información estrictamente pasada. A diferencia del replay de señales, aquí hay capital, escalones, precio medio, drawdown y tiempo de exposición.

**No es el motor productivo.** Límites declarados:
- no reproduce hybrid/confluencia/BE adaptativo/ATRP dinámico ni la máquina de salidas completa del engine;
- referencia de entrada = máximo rodante de 72 velas (proxy del anchor);
- fees paramétricos 0,09 %, sin slippage; una posición por par;
- datos Bitstamp 1h (proxy, no el venue real);
- **no hay stop-loss**: como en el motor real sin stop configurado, las posiciones perdedoras NO se cierran — permanecen abiertas.

Datos: 6000 velas 1h BTC/ETH Bitstamp (hashes en `REPLAY_CICLOS_RESULTADOS.json`, reproducible offline).

## Resultados (capital 100 USD/ciclo)

| activo | variante | ciclos | cerrados | win* | PnL total | avg % | maxDD intra-ciclo | exposición |
|---|---|---|---|---|---|---|---|---|
| BTC | A0_legacy | 20 | 19 | 1,0 | +23,18 | +2,07 | 24,3 % | 85 % |
| BTC | A2_candidate_deep | 14 | 13 | 1,0 | +19,13 | +2,68 | 23,3 % | 80 % |
| BTC | A3_no_safety | 15 | 14 | 1,0 | +29,22 | +2,09 | 26,1 % | 87 % |
| ETH | A0_legacy | 34 | 33 | 1,0 | +40,05 | +1,92 | 32,7 % | 88 % |
| ETH | A2_candidate_deep | 25 | 24 | 1,0 | +30,26 | +2,57 | 30,9 % | 82 % |
| ETH | A3_no_safety | 24 | 23 | 1,0 | +41,83 | +1,82 | 36,2 % | 93 % |

\* **win=1,0 es un artefacto mecánico, no un resultado**: sin stop-loss, los ciclos solo cierran en ganancia (TP/trailing alcista); los perdedores quedan abiertos (1 ciclo abierto al final en cada variante) y su pérdida no computa en `totalPnlUsd`. La magnitud real del riesgo está en el **drawdown intra-ciclo del 23-36 %** y en la exposición del 80-93 % del tiempo.

## Lectura causal honesta

1. Ninguna variante domina: A2 mejora avg% y reduce exposición pero opera menos; A3 (sin safeties) gana más en este tramo alcista de muestra pero con el mayor drawdown — exactamente el perfil que los safeties existen para absorber en tramos bajistas.
2. La muestra (marzo-noviembre 2026) no incluye un mercado bajista prolongado; en ese escenario los ciclos abiertos acumularían drawdown sin cerrar — el riesgo real del diseño sin stop.
3. Estos números **no** evidencian rentabilidad del bot ni de ninguna variante: son un instrumento de comparación causal de parámetros. La evaluación definitiva requiere el replay sobre la copia privada autorizada de ciclos reales (config real, fills reales, BE/trailing combinados del §7) — pendiente del acceso por canal privado.

## Reproducibilidad

```
npx tsx scripts/idca_cycle_replay.ts
```
Salida: `REPLAY_CICLOS_RESULTADOS.json` (con sha256 de los datasets).
