# Investigación F-SPOT-03 — Umbrales de protección y conservación de ganancias

**ID:** `AUD-20261119-09` · **Fecha:** 2026-11-19 · **Estado:** investigación documental realizada; cambios de estrategia **NO AUTORIZADOS**.  
**Vinculación:** [Informe fallos SPOT](08-informe-fallos-spot-2026-11-19.md) · [Auditoría forense de protecciones](04-protecciones-forense.md).  
**Informe privado ampliado:** [Google Docs (restringido)](https://docs.google.com/document/d/1dg_i33nl5tF-vU-xloYNr4gO7BwYieKMD-nlIbB4lWU/edit).  
**Código histórico:** commit `3ae18319b8c0b68c9374241db65f8ef9bdd39a57`; no hay confirmación del código efectivamente desplegado en VPS. Durante esta comprobación el directorio histórico `server/services/spot` no está en `main`.

## 1. Qué está verificado

La política histórica [`spotExitPolicy.ts`](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/3ae18319b8c0b68c9374241db65f8ef9bdd39a57/server/services/spot/spotExitPolicy.ts) contiene:
- `breakEvenActivateAtPctR=1`, `breakEvenStopPctR=0`: BE se arma a **1R bruto** y coloca el stop en **precio de entrada**, sin asegurar equilibrio tras fees y slippage.
- `trailingActivateAtPctR=1.5`, `trailingDistancePct=2`: trailing a **1,5R bruto**, distancia **2 % del precio**; no 2 % de R.
- `profitTargetR=3`: objetivo a **3R** con verificación neta sobre `ticker.last`, no un fill ejecutable garantizado.
- `computeRMultiple=(last-entry)*amount/riskUsd`: ignora comisiones, bid/ask, spread y ejecución posterior.
- `evaluateExit` revisa EMERGENCY, STRUCTURE_INVALIDATION y DEFENSIVE antes de armar/evaluar BE o trailing.
- La estrategia de tamaño [`spotRiskManager.ts`](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/3ae18319b8c0b68c9374241db65f8ef9bdd39a57/server/services/spot/spotRiskManager.ts) usa `riskPerTradeUsd=50` por defecto: umbrales ilustrativos **50/75/150 USD brutos**, sujetos al `riskUsd` efectivo.

**Nueva incoherencia interna a revisar:** el gate de eficiencia de entrada estima beneficio para `entryPrice + 2*stopDistanceUsd` (**2R**), mientras el objetivo `PROFIT` se activa a **3R**. El 2R de sizing es una extrapolación mecánica, no una previsión de mercado. No se ha probado causalidad con pérdidas.

## 2. Comprobación independiente de 167 ventas SPOT SHADOW

| Universo / nivel máximo favorable bruto | Operaciones | Cerraron ganando | Cerraron perdiendo |
|---|---:|---:|---:|
| Todas las ventas | 167 | 47 | 120 |
| MFE ≥ 50 USD | **21** | 17 | 4 |
| MFE ≥ 75 USD | **14** | 14 | 0 |
| MFE ≥ 150 USD | **6** | 6 | 0 |

- **106** operaciones alcanzaron MFE bruto positivo y acabaron perdiendo; **102** no llegaron al BE 1R y **ninguna** al trailing 1,5R.
- Medianas MFE bruto: ganadoras **42,03 USD**, las 106 positivas y perdedoras **7,26 USD**. Las comisiones medianas de las 106 fueron **4,65 USD**; el pico neto teórico mediano fue de alrededor de **2,61 USD**.
- **30 de las 47 ganadoras** tampoco llegaron a 50 USD brutos. Un stop más temprano afectaría a muchas ganadoras, no solo a las perdedoras.
- Las **12 ganadoras** que finalizaron por PROFIT (6) o TRAILING (6) sumaron **+1.373,30 USD**, un **75,3 %** de los beneficios de las 47 ganadoras. Conservar sus recorridos es condición esencial de cualquier mejora.
- Agosto parcial (41 ventas): 15 alcanzaron MFE≥50; 11 ≥75; seis ≥150. Septiembre (115 ventas): seis alcanzaron ≥50; tres ≥75; ninguna ≥150. Los distintos regímenes y composición de entradas se deben estudiar por separado.
- **MFE es retrospectivo, bruto y muestreado**: alcanzar el nivel no implica que se hubiese activado ni ejecutado el stop en ese precio. Kraken OHLC y fills Revolut X SHADOW no son equivalentes.

## 3. Qué probaron las auditorías previas (no inferencias)

| Escenario in-sample | Neto de la cohorte | Diferencia vs. histórico |
|---|---:|---:|
| Original (167 posiciones) | **−845,01 USD** | — |
| TP fijo +10 USD netos | −1.733,32 USD | −888,31 USD |
| Trailing +15 USD netos; distancia 0,35 %, suelo +5 | −1.429,46 USD | −584,45 USD |
| Trailing +15 USD netos; distancia 1 %, suelo +5 | −1.216,46 USD | −371,45 USD |
| Mejor de 70 trailing evaluados | −1.073,25 USD | −228,24 USD |
| Protección progresiva desde +10 USD netos | −915,38 USD | −70,37 USD |
| Protección ATR 2× | −879,12 USD | −34,11 USD |
| Control retrospectivo de exposición sin nueva protección | −11,34 USD | +833,67 USD |
| Control retrospectivo exposición + protección progresiva | −48,73 USD | +796,28 USD |

**Interpretación:** las pruebas de protección temprana **no mejoraron** los resultados de estos 167 registros. Las intervenciones sobre exposición mostraron mayor impacto aparente, pero sin replay integral de todas las señales y sin holdout no acreditan rentabilidad. En la protección progresiva solo seis de las 106 perdedoras activaron protección con velas 15m cerradas, mientras 39 ganadoras la armaron y 15 fueron cerradas antes.

## 4. Riesgos específicos que no deben mezclarse

1. **Cobertura tardía de la ganancia:** umbrales por R bruto, pero coste y ganancia disponible reales son netos y sensibles a bid.
2. **BE no cubre fees:** con fee 0,09 % por lado, solo equilibrar fees exige **~0,18016 %** de alza del precio ejecutado respecto al precio de compra, antes de spread/slippage.
3. **Trailing 2 % del precio no normalizado:** a 2.500 USD de notional equivale a ~50 USD de retroceso; a 4.000, a ~80 USD. En esta muestra había 17 lotes >3.750 USD, pero ninguno de los 14 que alcanzaron MFE≥75 pertenecía a ese grupo: riesgo de diseño **no pérdida observada**.
4. **Protección virtual y prioridad de estructura:** la política puede retornar antes de revisar stops de beneficio, y muestrear cada ~60s implica saltos y retrasos. No confundir con órdenes nativas confirmadas.
5. **Datos insuficientes para optimizar:** máximos de velas 15m no prueban bid negociable y faltan ticks, señales rechazadas, fills y estados de cartera completos.
6. **Stop real en el venue como línea de investigación:** Revolut X publica soporte de órdenes TP/SL, condicionales y OCO por [Ayuda España](https://help.revolut.com/es-ES/help/wealth/cryptocurrencies/crypto-exchange/trading/question-how-does-tp-sl-work/) y [API](https://developer.revolut.com/docs/api/revolut-x-crypto-exchange). Debe verificarse compatibilidad de cuenta/par/API y gestión de posiciones antes de considerar integración; no garantizar precio de ejecución.

## 5. Qué se necesitaría para valorar una corrección

- Identificar **configuración y commit realmente desplegados**, sin inferirlos desde una revisión histórica.
- Pruebas aisladas de R/fee/bid/ask/stop BE y trailing; prioridad de EMERGENCY/STRUCTURE y persistencia de protección tras reinicio.
- Repetición conservadora sobre señales cronológicas **admitidas y rechazadas**, con slippage, costes, competencia por capital, fills y stops con activación posterior a la observación (sin mirar el futuro).
- Evaluar por separado políticas de BE neto, trailing adaptado a volatilidad y control de exposición; comparar agosto/septiembre y nuevas ventanas no utilizadas para elegir umbrales.
- **Criterio de aceptación:** mejora de rentabilidad neta y drawdown fuera de muestra, con protección a la baja, sin perder sistemáticamente los 12 ganadores grandes. Aprobar cambios únicamente por decisión expresa del usuario.

## 6. Fuentes primarias y límites

- [Auditoría de trailing y parciales](02-trailing-15-usd.md): 70 trailing y 15 variantes parciales.
- [TP de +10 USD netos](03-take-profit-10-usd.md): 61 operaciones alcanzaban TP en un modelo favorable, resultado peor.
- [Simulación de cuatro cambios](05-cuatro-cambios.md): protección progresiva, ATR y exposición.
- [Políticas dinámicas](06-salidas-dinamicas.md): replays con EMA, ATR, momentum y fricción.
- [Informe general 167 SPOT](../2026-11-18/01-spot-167.md) y evidencias originales en [Drive privado](https://drive.google.com/drive/folders/1af2Guko1FXpzbxQ0fYAMiZP2oGAtzNn5).
- [ATR y stops, Schwab](https://www.schwab.com/learn/story/4-volatility-metrics-to-inform-your-trades); [walk-forward, QuantConnect](https://www.quantconnect.com/docs/v2/writing-algorithms/optimization/walk-forward-optimization).

**Conclusión:** F-SPOT-03 describe una cobertura tardía **constatada**, pero la solución no es simplemente adelantar BE/trailing/TP. La modificación de estrategia no está aprobada. **Ningún cambio de VPS, bot, configuración, datos de producción ni trading.**
