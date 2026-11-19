# NEXA SPOT — Tres estrategias nuevas investigadas en documentación y comunidades

**ID:** `AUD-20261119-12` · **Fecha:** 2026-11-19 · **Estado:** estudio y simulación *solo histórica SHADOW*; ninguna estrategia validada ni aprobada.  
**HTML ampliado interactivo (Drive privado):** [Laboratorio 174 configuraciones](https://drive.google.com/file/d/1pk4g4dIkvnsrmTnvO8yicDt9K92S4tuu/view). Se **actualizó en el mismo archivo** de la versión anterior de 168; conserva el mismo enlace.  
**Todas las operaciones / decisiones (Drive privado):** [CSV 6 variantes](https://drive.google.com/file/d/19g_23o3ZCnwpN9lNeIa4BhHnvJEk_86L/view).  
**Paquete de reproducción offline (Drive privado):** [ZIP con HTML, fuente OPS, scripts y resultados](https://drive.google.com/file/d/1wcveT6FfPT-AUXYtE59dJxFrReFkH4rj/view). Incluye un script de reproducción autónomo probado, que solo necesita Python estándar.  
**Origen:** [Comparativa de filtros A/B por fechas](10-comparativa-estrategias-A-B-diaria-mensual.md); [laboratorio original de 168 configuraciones](11-laboratorio-168-estrategias-spot.md).

> El repositorio es **público**: esta ficha publica metodología y agregados, nunca los identificadores o precios de las operaciones individuales, credenciales o respaldos privados. Se ha trabajado sobre 167 entradas y ventas **SHADOW** históricas; NO sobre operaciones realizadas con dinero real.

## 1. Investigación de fuentes externas

Se revisaron documentación técnica de [Hummingbot Controllers](https://hummingbot.org/strategies/v2-strategies/controllers/), su código fuente [MACD + Bollinger `macd_bb_v1`](https://github.com/hummingbot/hummingbot/blob/master/controllers/directional_trading/macd_bb_v1.py), [Freqtrade estrategia e indicadores](https://www.freqtrade.io/en/stable/strategy-customization/) y sus [Protecciones](https://www.freqtrade.io/en/stable/plugins/). Se contrastaron riesgos metodológicos y falsos giros en debates de [Reddit sobre pullback vs reversal](https://www.reddit.com/r/algotrading/comments/1up7s8q/is_there_an_indicator_or_combination_of/) y [validación de bots y sobreajuste](https://www.reddit.com/r/algotrading/comments/1s90wgr/built_a_crypto_futures_bot_now_stuck_and_can_not/).

En la documentación se describen enfoques con MACD/Bollinger, recuperación de tendencias y `StoplossGuard`/cooldown. **No se ha afirmado que los participantes de los foros hayan verificado rentabilidades reales** ni que los resultados de NEXA reproduzcan exactamente las implementaciones de las herramientas citadas. Las estrategias D/E usan proxies calculables a partir de los indicadores previos a las entradas históricas.

## 2. Tres propuestas técnicamente diferenciadas

### D · Impulso acelerado (proxy Hummingbot direccional)

Permite una entrada histórica si se cumplen simultáneamente:
- Momentum de las 3 últimas velas de 15m `m3 >= +0,20%`.
- Momentum de las 6 últimas velas de 15m `m6 > +0,10%`.
- **Aceleración**: `m3 > (m6/2) + 0,10 puntos porcentuales`.
- Cuerpo de vela 15m positivo y pendiente EMA20 1h positiva.

Este filtro aproxima la idea de impulso reciente relativamente fuerte frente al conjunto anterior. **No calcula auténtico MACD, Bollinger ni señales nuevas**. Entradas con datos nulos se rechazan.

### E · Retroceso y recuperación (proxy reversión dentro de tendencia)

Se admite una entrada histórica si `m3 <= 0%` y `m6 > +0,20%`, cuerpo de la vela 15m `> +0,10%` y pendiente EMA20 1h positiva. La lógica busca un retroceso reciente en un contexto anterior alcista con indicio de recuperación. **No usa RSI, Bollinger, precio respecto a medias ni confirmación de soporte reales**. El posible rebote no impide una invalidación posterior.

### F · Guard contra racha de pérdidas (adaptación de Freqtrade)

Tras **dos operaciones aceptadas del mismo par que cierran consecutivamente en negativo dentro de 6 horas**, bloquear nuevas compras de ese par **4 horas desde el segundo cierre**. La regla usa solo cierres ya conocidos al evaluar la siguiente entrada. Se comprueba en ejecuciones con una o dos posiciones concurrentes por par.

**Importante:** es una adaptación, NO la implementación exacta de `StoplossGuard` de Freqtrade, porque aquí se cuentan cierres netos negativos por cualquier motivo, no exclusivamente órdenes `stoploss`. No liquida posiciones abiertas ni establece un límite máximo de pérdida.

## 3. Resultados históricos sobre las mismas 167 entradas

La selección de entradas es cronológica, preservando las ventas originales, el PnL neto registrado y la prioridad temporal de los cierres. La prueba extra de fricción resta un **0,10% del nocional inicial** a cada trade admitido. Esto es un análisis histórico de **filtrado y exposición**, no un backtest completo de ejecución.

| Estrategia | Máx. posiciones/par | Compras admitidas | Ganadoras | PnL registrado USD | Con fricción adicional 0,10% |
|---|---:|---:|---:|---:|---:|
| D Impulso | 1 | 29 | 12 | **+52,74** | **−12,93** |
| D Impulso | 2 | 46 | 17 | **−138,25** | **−235,06** |
| E Retroceso | 1 | 5 | 2 | **−52,59** | **−63,57** |
| E Retroceso | 2 | 8 | 3 | **−78,25** | **−93,97** |
| F Guard rachas | 1 | 84 | 23 | **−342,82** | **−554,45** |
| F Guard rachas | 2 | 146 | 45 | **−510,40** | **−882,25** |

**NEXA referencia:** 167 operaciones, **−845,01 USD** con precisión sin redondear, **−845,00 USD** al sumar los PnL individuales a céntimos. El escenario con 1 sola posición por par sin nuevos filtros tenía **−440,88 USD**; F con 1 posición mejora a −342,82 USD, pero sigue perdiendo. D con una posición parece positivo solo antes de añadir más fricción.

### Desglose mensual, con 1 posición por par (USD)

| Mes de entrada | D · Aceleración | E · Retroceso | F · Guard |
|---|---:|---:|---:|
| Agosto | +337,04 | +18,39 | +611,46 |
| Septiembre | −82,47 | −36,51 | −721,46 |
| Octubre | −176,73 | 0,00 (sin compras) | −173,25 |
| Noviembre | −25,10 | −34,47 | −59,57 |
| **Total** | **+52,74** | **−52,59** | **−342,82** |

- Las **46 operaciones D** y las **8 E** están contenidas en las **112** seleccionadas por A de 3/4 confirmaciones. D y E no identifican nuevas oportunidades que A hubiera rechazado.
- Las ocho entradas E no satisfacen B medio; la regla se comporta como un filtro de pullback diferente del filtro de impulso positivo.
- La mejor variante de D en esta prueba es **frágil**: con coste adicional del 0,10% pasa a negativo. Octubre y noviembre también fueron negativos sin ese coste.
- F bloquea en el escenario de dos posiciones **21 compras**; su comparación directa con BASE supone el mismo máximo de posiciones, no un cambio de tamaño.
- **Ninguna de las tres familias demuestra una rentabilidad resistente** al cambio de mes, a costes adicionales y al sesgo retrospectivo.

## 4. Comparación con A/B y conclusión

La investigación anterior halló una candidata histórica **B exigente + 1 posición/par: +399,32 USD**, pero dependiente de algunas operaciones grandes y sin holdout independiente. Los tres enfoques ahora evaluados tampoco superan la validación robusta: D/E son subfiltros más específicos de A, F es una regla de protección de exposición y ninguna reconstruye todos los candidatos que el motor habría generado al cambiar capital o tiempos de salida.

No se debe combinar ad hoc la mejor parte de agosto de una estrategia con la mejor parte de septiembre de otra: esto seleccionaría los resultados **después de observarlos**. La próxima prueba válida exige especificar reglas antes de nuevas muestras, datos 15m/1h/4h cerrados auditables, registros de señal y rechazo, bid/ask ejecutables y capacidad de repetir el bot completo sin ver el futuro.

## 5. Entrega y trazabilidad

- El **HTML anterior** de 168 configuraciones se amplió a **174 configuraciones**; **66 selecciones distintas**. Conserva el explorador, los resultados diarios/mensuales, ranking, fricciones y CSV dinámicos, e incorpora D/E/F en filtros y una nueva sección con metodología/fuentes.
- Se verificó la ejecución de JavaScript en navegador Chromium para seleccionar D, E, F y fricción extra con uno/dos lotes; sin errores de página.
- El paquete ZIP incluye un script independiente con **biblioteca estándar de Python**, probado tras descomprimir en carpeta aislada, y reproduce las seis combinaciones y tres tasas de fricción.
- El código y las fuentes privadas del usuario permanecen en Drive, no en este repositorio público.

**Prohibido inferir resultados futuros o considerar las estrategias aptas para trading REAL. Este trabajo es documental y offline: no se modificó el VPS, el bot, el motor, las posiciones, órdenes ni la configuración.**
