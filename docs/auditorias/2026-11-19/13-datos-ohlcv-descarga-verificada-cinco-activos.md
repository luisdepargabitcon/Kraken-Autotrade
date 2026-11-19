# Datos OHLCV descargados y verificados para backtesting D/E/F

**ID:** `AUD-20261119-13` · **Fecha:** 2026-11-19 · **Estado:** DESCARGA PÚBLICA **VERIFICADA**; backtests D/E/F completos aún **NO EJECUTADOS NI APROBADOS**.

- **Archivo de mercado verificado (Drive privado):** [NEXA_SPOT_OHLCV_5_ACTIVOS_VERIFICADOS_2026-07-01_a_11-18.zip](https://drive.google.com/file/d/1mabq79pmGblzj5PACEXy-5Yn4AQUTZT_/view) (35.557.353 bytes).
- **Informe HTML de validación (Drive privado):** [Abrir informe de cobertura](https://drive.google.com/file/d/1wCkHFFP1TLeDrLho40dIq6YmMErLZl7d/view).
- **Descargador y cuaderno Colab (Drive privado):** [ZIP de reproducción](https://drive.google.com/file/d/1ipZFtbtY07N0Im6rtW945XiZW8amTXcZ/view).
- **Código de extracción de GitHub:** [Rama aislada de investigación](https://github.com/luisdepargabitcon/Kraken-Autotrade/blob/research/nexa-ohlcv-20261119/research/nexa_spot_ohlcv_2026.py). Sin merge a main.
- **GitHub Actions (rama de investigación):** artefacto #14578013484, workflow run #44624133332, conclusión `success`.
- **SHA-256 del ZIP final:** `e5c70c68c0052783abc9ddc37be7a21e9ac3bddd00e6f8f996018121be68fb7f`.

## Origen, cotización y fechas

Datos **Binance Spot (USDT)**, no Kraken USD ni Revolut X. Fuente oficial: https://data.binance.vision/ ; estructura de las velas y `.CHECKSUM`: https://github.com/binance/binance-public-data. Todo el intervalo se conserva en **UTC**.

- **Inicio de descarga y calentamiento:** 01/07/2026 00:00 UTC (GRAM empieza el 02/07 a las 08:00).
- **Evaluación propuesta:** 01/08/2026 00:00 UTC a 18/11/2026 23:59 UTC. Fecha final exclusiva 19/11/2026 00:00 UTC.
- **Origen mensual:** julio, agosto, septiembre y octubre de 2026; **diario:** 1–18 de noviembre.
- 5 activos, 4 temporalidades: 5m, 15m, 1h y 4h. Fuente base 5m y las otras velas se recomponen con bloques completos, sin rellenar huecos ficticios.
- 110 archivos ZIP remotos descargados y verificadas sus 110 sumas SHA-256 de proveedor, **110/110 correctos**. Ningún hueco 5m dentro del intervalo de negociación de cada activo. Se comprobó también el CRC de los 28 miembros del ZIP final.

## Cobertura verificada

| Par de fuente | 5m | 15m | 1h | 4h | Huecos de fuente 5m |
|---|---:|---:|---:|---:|---:|
| BTCUSDT | 40.608 | 13.536 | 3.384 | 846 | 0 |
| ETHUSDT | 40.608 | 13.536 | 3.384 | 846 | 0 |
| SOLUSDT | 40.608 | 13.536 | 3.384 | 846 | 0 |
| XRPUSDT | 40.608 | 13.536 | 3.384 | 846 | 0 |
| GRAMUSDT (antes TON, en Binance) | 40.224 | 13.408 | 3.352 | 838 | 0* |
| **Total** | **202.656** | **67.552** | **16.888** | **4.222** | **0** |

*GRAMUSDT no existía hasta 02/07/2026 a las 08:00 UTC; las 384 velas de 5 minutos anteriores a su apertura **no son un hueco de datos**. Fuentes oficiales Binance: [retirada de TON](https://www.binance.com/en/support/announcement/detail/fe307fba935b44698fde4db01e84a7eb), [inicio de GRAM y conversión 1 TON = 1 GRAM](https://www.binance.com/en/support/announcement/detail/8177254072cf4da3b9d8fcaacceb0a2c). No confundir precios GRAM Binance con cotizaciones TON Kraken o Revolut X.

**291.318 filas** sumando los cuatro marcos temporales. El archivo incluye además la matriz de fuerza relativa entre los cinco activos.

## Datos e indicadores incluidos

Cada par contiene cuatro archivos `_indicators.csv.gz` con OHLCV, volumen cotizado, conteo de operaciones y marca `available_at_utc`. Se han calculado EMA20/50, RSI14, ATR14, ADX14, MACD/señal/histograma, bandas Bollinger 20, anchura BB, canal Donchian 20 previo, ratio de volumen 20 y momentum 3/6 barras. El marco 1h incluye impulsos de 24h/72h, volatilidad de 24h y puntuación de fuerza relativa. El fichero `FUERZA_RELATIVA_5_ACTIVOS.csv.gz` da ranking horario y bandera de disponibilidad del universo completo.

**Trazabilidad:** `VALIDACION.json` contiene cobertura, marcas de tiempo, linaje TON/GRAM y lista de fuentes fallidas (vacía); `fuentes_sha256.csv` contiene URL, sha256, filas y estado por fuente; los cinco `_huecos.csv` contienen los huecos detectados (ninguno).

## Limitaciones y precauciones

1. **Datos reales públicos ≠ fills**. Los cierres y volúmenes de Binance USDT no son cotizaciones bid/ask ejecutables USD de Kraken/Revolut X. Las tasas, deslizamientos, mínimos, tiempos y liquidez del venue se deberán modelar aparte.
2. **NO look-ahead**. Toda estrategia futura debe usar la columna `available_at_utc` y solo datos con disponibilidad anterior o igual al momento de evaluación; los indicadores de barra abierta no deben utilizarse.
3. **NO backtest validado**. Descarga de datos y cálculo de indicadores sí completados; todavía no se ha corrido el motor nuevo de simulación de D (breakout Bollinger/volumen), E (falsa ruptura/rango) y F (rotación/riesgo de cartera).
4. Agosto–noviembre **ya fue explorado** para seleccionar reglas A/B y varias alternativas; no es un holdout verdaderamente virgen. Harán falta reglas congeladas, replay completo de señales, ejecución con costes y nuevos meses SHADOW para evaluar robustez.
5. El primer intento histórico omitía TON porque ya había sido retirado de Binance en junio. Se marcó explícitamente como **INCOMPLETO_NO_USAR** en Drive y se sustituyó por esta versión con GRAM y linaje documentado.

**Seguridad:** solo lecturas de datos públicos; flujo de descarga ejecutado en rama de investigación y archivado en Drive privado. No se modificó el VPS, el motor de trading, la configuración del bot ni las órdenes reales.
