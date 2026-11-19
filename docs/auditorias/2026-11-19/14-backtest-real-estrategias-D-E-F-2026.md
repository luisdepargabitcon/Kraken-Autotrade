# Backtest histórico completo de estrategias D, E y F — NEXA SPOT

**ID:** `AUD-20261119-14` · **Fecha:** 2026-11-19 · **Estado:** ejecuciones simuladas completadas y verificadas; **NINGUNA ESTRATEGIA RENTABLE O VALIDADA PARA REAL**.

### Entregas privadas

- [Informe HTML autocontenido: días, meses, operaciones y coste normal/estrés](https://drive.google.com/file/d/1Xh8S02_yLQm7in3aSCMLCnPuVcnHxbhp/view)
- [CSV de 632 operaciones de ambos escenarios](https://drive.google.com/file/d/11KqEiySf3J02fmsNPEzIjo7rorlIGTLB/view)
- [CSV de 1.540 observaciones diarias](https://drive.google.com/file/d/1P2oB4zF8ujD7j4sx5QWck2W73lPE16on/view)
- [ZIP reproducible: simulador, validación, metodología y resultados](https://drive.google.com/file/d/1Dgn0NLQIWGWZv_guNU9a_CRVHpWyB3my/view)
- [Datos de mercado originales verificables (5 activos, Binance Spot)](https://drive.google.com/file/d/1mabq79pmGblzj5PACEXy-5Yn4AQUTZT_/view)
- [Carpeta privada de auditorías](https://drive.google.com/drive/folders/1af2Guko1FXpzbxQ0fYAMiZP2oGAtzNn5)

> Repositorio público: **solo agregados, metodología y enlaces de acceso privado**. No se publican listas completas de posiciones, datos de cuenta, órdenes ni información personal.

## 1. Alcance y datos

Reproducción cronológica desde 01/08/2026 00:00 UTC hasta 18/11/2026 23:55 UTC, con *warmup* desde 01/07/2026. No se recicla el PnL de las 167 operaciones históricas: el motor evalúa las reglas sobre la **serie temporal completa** y genera sus propias entradas y salidas.

- Mercado: **Binance SPOT cotizado en USDT** (BTC, ETH, SOL, XRP, GRAM), no Kraken/USD ni Revolut X.
- Fuente de datos: ZIP de [auditoría AUD-20261119-13](13-datos-ohlcv-descarga-verificada-cinco-activos.md). 110 fuentes verificados con SHA-256, ninguna falta de velas de 5m en los intervalos listados.
- Ticker: Binance retiró TONUSDT en junio de 2026, y desde el 2 de julio utiliza GRAMUSDT con conversión 1:1 según su anuncio oficial. **No asumir** que los fills o el mercado GRAMUSDT son los del bot TON/USD de otros exchanges.
- Capital inicial separado por escenario: **10.000 USDT**. Compra spot; nada de cortos, apalancamiento, ni dinero real.
- Datos de velas cerradas: entradas a la apertura de la siguiente 5m cuando la señal 15m/1h/4h ya ha terminado. Se evalúan stops y objetivos con rangos de 5m, **stop antes de objetivo si ambas cotas se tocan en una vela**; huecos al abrir a precio de apertura.
- Coste **BASE**: comisión 0,09 % por lado + deslizamiento fijo 0,05 % por lado.
- Coste **ESTRÉS**: comisión 0,15 % por lado + deslizamiento fijo 0,15 % por lado.
- Límite D/E: máximo **dos posiciones** simultáneas, máximo **25 %** de patrimonio por entrada, y riesgo nominal apuntado a **0,25 %** de patrimonio por posición, sin incluir posibles gaps y costes. Límite F: hasta 2 activos con 25 % de cartera por activo; el resto queda en USDT.
- Se cierra cualquier posición abierta al final de la muestra, para conciliar patrimonio final con ventas.

## 2. Estrategias ejecutadas

**D — Compresión Bollinger + ruptura con confirmación**
- Ancho BB 1h en el 20 % inferior respecto a 72 cierres horarios previos, con compresión registrada entre las seis últimas barras completas.
- Cierre 15m superior al máximo de las 20 velas anteriores; volumen 15m ≥1,2 veces su media de 20 periodos anteriores.
- Confirmación de 4h: cierre > EMA20 > EMA50 y EMA20 creciendo.
- Stop basado en 1,5×ATR15m, acotado entre 0,7 % y 5 %; objetivo 2,5R, salida temporal 36h; pausa de 6h tras pérdida por activo.

**E — Falsa ruptura de soporte, retorno al rango**
- Barrida bajo el mínimo de las 20 velas anteriores de 15m, y recuperación en la vela misma o las dos siguientes; confirmar cierre por encima del soporte y vela verde.
- ADX 1h < 20 y precio 4h > 98 % de EMA20; no comprar si la relación objetivo/riesgo al siguiente precio de apertura es <1,2.
- Stop bajo mínimo de barrida menos 0,15×ATR15m; objetivo a mitad del rango previo; máximo 12h; pausa tras pérdida 3h.

**F — Rotación de fuerza relativa con protección**
- Revisión una vez al día a las 00:00 UTC, con momentum 24h y 72h de los cinco activos dividido por volatilidad realizada; seleccionar hasta dos.
- Seleccionables únicamente si momentum positivo y tendencia 4h (precio > EMA20 > EMA50); condición global de mercado: BTC 4h > EMA50; efectivo si no cumple.
- Stop 2×ATR4h entre 2 % y 8 %. Sin ajuste diario del tamaño de posiciones supervivientes (evita rotación innecesaria); pausa de 24h tras un stop.

## 3. Resultados BASE (10.000 USDT)

| Estrategia | Ventas | Ganadoras | Neto USDT | Rentabilidad | Retroceso máx. cierre diario | Comisiones USDT |
|---|---:|---:|---:|---:|---:|---:|
| D | 84 | 24 | **−598,18** | **−5,982 %** | −5,982 % | 356,68 |
| E | 192 | 45 | **−1.586,27** | **−15,863 %** | −15,863 % | 795,40 |
| F | 41 | 12 | **−288,60** | **−2,886 %** | −12,498 % | 190,67 |

Comparadores de referencia: **50 % BTC / 50 % efectivo: +0,32 USDT**; **50 % dividido a partes iguales entre los cinco activos / 50 % efectivo: −407,12 USDT**. La exposición temporal y los stops de estas referencias no son equivalentes a D/E/F.

### Desglose mensual — variación del patrimonio al cierre diario en USDT

| Mes de 2026 | D | E | F |
|---|---:|---:|---:|
| Agosto | −263,54 | −488,98 | **+759,40** |
| Septiembre | −278,09 | −488,40 | **−745,63** |
| Octubre | −29,33 | −479,10 | −214,19 |
| Noviembre (1–18) | −27,23 | −129,79 | −88,19 |
| **TOTAL neto exacto** | **−598,18** | **−1.586,27** | **−288,60** |

*Diferencias de ±0,01 USDT entre suma de filas redondeadas y total se deben a operar con valor diario sin redondear y publicar las filas en céntimos.* El patrimonio diario valora posiciones todavía abiertas (realizado + no realizado), por lo que no equivale exactamente a ventas cerradas durante el mes.

### Resultado con costes de estrés

| Estrategia | Ventas | Neto USDT |
|---|---:|---:|
| D | 84 | **−1.193,16** |
| E | 190 | **−2.763,64** |
| F | 41 | **−601,22** |

## 4. Controles técnicos realizados

- Pruebas automáticas verificaron **14 escenarios** (D/E/F + cuatro comparadores, con base y estrés), 110 cierres diarios por escenario, 632 ventas en el libro consolidado y 110 fuentes verificadas.
- Se cuadraron patrimonio final, suma de PnL por ventas y suma de diferencias diarias con tolerancia de redondeo.
- Se comprobó que las entradas y salidas ocurren en marcas de tiempo de 5 minutos, no tienen cronología negativa y que los cierres por stop/objetivo usan la regla y el descuento de deslizamiento esperados.
- Se corrigió un error detectado en la primera iteración: el trade recién abierto **también está expuesto al rango de su primera vela 5m**. Las cifras publicadas son las de la ejecución corregida.
- El motor impone saldo de efectivo no negativo y dos posiciones como máximo en D/E/F.
- El HTML contiene los datos offline; comprobados en navegador Chromium tanto en viewport móvil como escritorio: gráfico, cambio de coste, tablas mensuales y diarias, detalle de día y filtros de operaciones, sin errores JavaScript.
- Manifiesto SHA-256 del paquete reproducible incluido dentro del ZIP; ZIP final SHA-256: `654c69b7d958412e1e6a6ceba88ab33fa69cfa202eba96a10a8c2a07344d0008`.

## 5. Interpretación y recomendaciones

**Ninguna D/E/F obtuvo beneficio neto positivo** en el ensayo. F pierde menos en total, pero su drawdown diario y la caída de septiembre impiden considerarla una estrategia defensiva demostrada. Los filtros D y E generaron operaciones perdedoras incluso en momentos con indicadores aparentemente apropiados; gestionar bien entradas, tamaño y régimen continúa siendo prioritario. **No se deben reducir stops o alterar parámetros a posteriori solo para convertir el total en positivo**.

Limitaciones: ejecución hipotética a partir de OHLC de Binance y suponer deslizamiento fijo; el precio real bid/ask en Revolut X o Kraken puede diferir. El peor drawdown intradiario puede ser mayor que el calculado al cierre diario. La muestra agosto–noviembre ya ha sido examinada extensamente, por lo que los datos no son un verdadero test fuera de muestra. Noviembre es parcial. No hay validación prospectiva de beneficio futuro.

Siguiente paso razonable: congelar especificaciones, adquirir un horizonte nuevo y/o datos del mercado de ejecución, auditar precios bid/ask, evaluar sensibilidad a costes y usar SHADOW prospectivo sin operar con dinero real.

**Seguridad:** Todo el trabajo fue una simulación offline a partir de archivos históricos públicos. **NO** se modificó el VPS, motor, estrategia, credenciales, órdenes ni se fusionó código operativo del bot.
