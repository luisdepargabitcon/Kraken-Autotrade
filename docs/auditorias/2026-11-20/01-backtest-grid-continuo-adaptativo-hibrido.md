# Backtest comparado: Grid continuo, Grid adaptativo e híbrido

**ID:** `AUD-20261120-01` · **Corte:** 20-11-2026 · **Estado:** estudio offline SHADOW, **NINGUNA ALTERNATIVA VALIDADA NI APROBADA PARA REAL**.

## Entregables originales (Google Drive privado)
- [Informe HTML interactivo](https://drive.google.com/file/d/1c2neZninoRhDHHqcXhs9fTJRnbdZXa_q/view), resultados mensuales/diarios y por operación, costes y gráfico de cartera.
- [ZIP reproducible](https://drive.google.com/file/d/1S--xzVf8yLtrBUivu0NYicWMnb5WpnbK/view): motor Python, tests de reconciliación, libro de 342 cierres en dos escenarios y 660 días-escenario.
- [Datos OHLCV originales](https://drive.google.com/file/d/1mabq79pmGblzj5PACEXy-5Yn4AQUTZT_/view): Binance Spot 5m, 1h, 4h, velas cerradas; archivo previamente validado.
- SHA-256 ZIP reproducible: `b544c87dee9caee1b6a86debff3fe0dbc6510fd911c1910aac41f44b47695b6b`.

## Alcance y supuestos

- Periodo 01/08 a 18/11/2026 inclusive, UTC, 110 días, calentamiento julio 2026.
- 10.000 USDT iniciales; **Grid únicamente BTCUSDT**, swing **BTCUSDT + ETHUSDT**; ninguna operación SOL, XRP, GRAM.
- Sin apalancamiento; **base** comisión 0,09% y slippage 0,05%, ambos por lado; **estrés** 0,15% y 0,15%, ambos por lado.
- Grid geométrico de 4 órdenes BUY bajo centro (EMA20 1h actualizada diariamente), mínimo de separación suficiente para 0,5% neto con costes y buffer; máximo 5 ciclos Grid, 10% por ciclo, 60% exposición; stop hipotético -5% y salida a 7 días. `1 BUY -> 1 SELL` con target fijo individual: no FIFO ni alteración al cambiar régimen/rango.
- Fills LIMIT **hipotéticos** confirmados por penetración de 0,05% en OHLC de 5 minutos. Cuando stop y target se tocan en la misma vela se prioriza stop.
- **Continuo**: usa esa rejilla todos los días independientemente del régimen.
- **Adaptativo**: exacta misma rejilla, solo nuevas entradas si BTC muestra régimen lateral (ADX/BB/EMA con datos cerrados); las salidas pendientes se respetan.
- **Híbrido**: Grid en lateral, swing BTC/ETH en tendencia alcista mediante RSI1h, MACD y EMA4h, sin nuevas compras en régimen adverso. Swing con riesgo nominal <= 0,5% NAV, stop ATR y objetivo +2,2R.
- Patrimonio diario marcado a liquidación (no solo PnL realizado); drawdown calculado sobre valor liquidable cada 5 minutos. Se liquidan posiciones al finalizar la ventana para comparabilidad.

## Resultados (USDT), coste base

| Política | Ventas | Ganadoras | Neto | Máximo drawdown liquidable |
|---|---:|---:|---:|---:|
| Grid continuo | 92 | 74 | **-166,95** | -4,932% |
| Grid adaptativo | 41 | 30 | **-173,05** | **-3,057%** |
| Híbrido Grid + swing | 53 | 34 | **-241,88** | -3,964% |

| Mes de evaluación, UTC | Grid continuo | Grid adaptativo | Híbrido |
|---|---:|---:|---:|
| Agosto | +71,95 | +35,40 | -67,55 |
| Septiembre | +167,44 | +39,75 | +90,05 |
| Octubre | -63,62 | -97,68 | -114,91 |
| Noviembre (1-18) | -342,73 | -150,52 | -149,47 |
| **Total** | **-166,95** | **-173,05** | **-241,88** |

## Estrés de costes

| Política | Neto, USDT | Máximo drawdown |
|---|---:|---:|
| Grid continuo | -447,47 | -6,268% |
| **Grid adaptativo** | **-297,56** | **-3,870%** |
| Híbrido | -450,19 | -5,292% |

Referencia adicional: BTC buy-and-hold en los mismos 110 días, con 100% capital invertido, +0,64 USDT neto y drawdown de 28,844% al coste base. Mantener efectivo 100% = 0 USDT. **No son equivalentes en exposición ni riesgo.**

## Verificación y límites materiales

- Se verificaron independientemente los 342 cierres sumados entre base/estrés, 660 registros día-escenario, reconciliación de contabilidad PnL de ventas/patrimonio y condición real OHLC de las entradas Grid. HTML probado en Chromium escritorio 1365px y Android viewport 390px; sin errores de JS ni desbordamiento horizontal.
- **No reprodujimos el Grid desplegado**. Este es un motor nuevo de investigación; no cambiamos el código de ejecución, ciclos, DB ni VPS.
- **MAKER_ONLY incompatible con stops garantizados:** salidas por stop/timeout suponen contraparte, fees y deslizamiento fijos; bajo política estrictamente post-only podrían no ejecutarse. Esto es una limitación crítica para convertir esta simulación en diseño ejecutable.
- Fuente Binance USDT, no Revolut X/Kraken USD con cotizaciones bid/ask efectivas. No se modelan colas de órdenes, profundidad L2, latencia ni fills reales.
- El histórico se usó en otras optimizaciones previas, **sin holdout verdaderamente intacto**. Los números no demuestran futura rentabilidad.
- No se modificaron configuraciones/órdenes de operación REAL. La alternativa con menor drawdown es Grid adaptativo, pero todas tienen PnL final negativo; **no implementar ninguna en trading REAL sobre esta evidencia**.

**Decisión sugerida:** mantener esta comparación como baseline de investigación, auditar diferencias respecto al engine MAKER_ONLY, y validar otra ventana futura o histórico intacto antes de cualquier despliegue.
