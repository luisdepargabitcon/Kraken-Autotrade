# ESTUDIO DE FUENTES SECUNDARIAS DE MARKET DATA (orden #22 §6)

**Alcance:** comparar fuentes públicas candidatas como respaldo/contraste de Kraken (fuente primaria de datos de referencia). Sin claves, sin contratar nada, sin tocar el VPS. **Estado: estudio + contraste empírico acotado; el adaptador (si se implementa) queda desactivado por defecto.** Reproducible: `npx tsx scripts/compare_secondary_sources.ts` (offline con los snapshots de `data_public/secondary/`, hashes en su `MANIFEST.json`; resultados en `ESTUDIO_FUENTES_RESULTADOS.json`).

## 1. Documentación oficial consultada (hechos verificados en esta sesión)

| Fuente | Endpoint de velas | Cotización | Timestamps / formato | Límites documentados | Histórico |
|---|---|---|---|---|---|
| **Bitstamp** | `GET /api/v2/ohlc/{market_symbol}/` (`step` obligatorio ∈ 60…259200 s; `limit` 1–1000; `start`/`end`; `exclude_current_candle`) | USD (`btcusd`, `ethusd`) | `timestamp` en segundos (string); `open/high/low/close/volume` como strings; volumen en moneda base | `limit` máx. 1000 por petición. **Límite de peticiones por tiempo: no verificado en esta sesión** (consultar documentación vigente antes de producción) | Paginable con `start`/`end` |
| **Bitfinex** | `GET https://api-pub.bitfinex.com/v2/candles/trade:{tf}:t{PAR}/hist` | USD (`tBTCUSD`) | Milisegundos; **orden de campos `[MTS, OPEN, CLOSE, HIGH, LOW, VOLUME]`** (distinto del resto); 100 velas por defecto, `limit` configurable; orden por defecto más reciente primero (`sort=1` devuelve el histórico MÁS ANTIGUO si no hay `start`) | Endpoint de velas: 30 peticiones/min; IP bloqueada 60 s si se excede (`ERR_RATE_LIMIT`) | Paginable por `start`/`end` |
| **Binance Spot** | `GET /api/v3/klines` (`symbol`, `interval`, `limit` ≤ 1000, `startTime`/`endTime`) | **USDT** (`BTCUSDT`), no USD | `[openTime(ms), open, high, low, close, volume, closeTime, …]` | Peso 2 por petición (documentación Spot); 429 con `Retry-After` en segundos; reincidencia ⇒ baneo IP 418 de 2 min a 3 días; límites por IP | Paginable |
| **Kraken (primaria)** | `GET /0/public/OHLC` | USD | segundos; fila `[time, o, h, l, c, vwap, volume, count]` | (ya integrada con su limitador) | Últimas 720 velas por petición |

Notas: el orden de campos de Bitfinex y la cotización en USDT de Binance son trampas de integración reales; el adaptador debe normalizar cada fuente en su propio módulo, nunca mezclar.

## 2. Contraste empírico con Kraken (1h, ~30 días, 718–719 velas alineadas por hora de apertura)

Divergencia del **cierre** respecto a Kraken, en %, y ratio de **volumen** respecto a Kraken (cada venue en su propia unidad base; los volúmenes NO son sumables):

| Activo | Fuente | Cotiz. | |Δ| media | |Δ| p95 | |Δ| máx. | Sesgo medio | Volumen mediano vs Kraken (p5–p95) | Huecos | OHLC inválidas |
|---|---|---|---:|---:|---:|---:|---|---:|---:|
| BTC | Bitstamp | USD | 0,0107 | 0,0266 | 0,3564 | −0,0036 | 0,46 (0,14–1,44) | 0 | 0 |
| BTC | Bitfinex | USD | 0,1664 | 0,3133 | 0,8543 | +0,1664 | 0,24 (0,06–0,91) | 0 | 0 |
| BTC | Binance Spot | USDT | 0,1332 | 0,2062 | 0,6355 | +0,1332 | 6,23 (2,23–16,50) | 0 | 0 |
| ETH | Bitstamp | USD | 0,0160 | 0,0430 | 0,1412 | −0,0032 | 0,31 (0,08–0,96) | 0 | 0 |
| ETH | Bitfinex | USD | 0,1609 | 0,3093 | 0,9112 | +0,1609 | 0,23 (0,06–1,16) | 0 | 0 |
| ETH | Binance Spot | USDT | 0,1269 | 0,1882 | 0,2409 | +0,1269 | 9,89 (3,17–24,65) | 0 | 0 |

Hallazgos:

1. **Bitstamp** es, con diferencia, la serie más coincidente con Kraken en USD (diferencia media absoluta ≈ 0,01–0,02 %), sin huecos ni filas inválidas, timestamps alineados a la hora. Volumen ~0,3–0,5× el de Kraken.
2. **Bitfinex** muestra un **sesgo sistemático positivo de ≈ +0,16–0,17 %** frente a Kraken y Bitstamp en la misma moneda nominal (USD). La **causa no se ha determinado** (no se afirma que sea USDT/USD ni otra); basta para no tratar su USD como equivalente al de Kraken sin calibración.
3. **Binance Spot** cotiza en USDT: sesgo medio ≈ +0,13 %, que **incluye la base USDT/USD** y no puede tratarse como USD; volumen 6–10× el de Kraken (no comparable ni sumable).
4. Una primera ejecución de Bitfinex con `sort=1` devolvió el histórico más antiguo (error mío del script, ya corregido y documentado en la cabecera del script): total 8 peticiones públicas, no 6.

**Límites:** una sola ventana de ~30 días y un régimen de mercado; la divergencia observada no garantiza el futuro; no se midió latencia ni disponibilidad; no hay WebSocket evaluado.

## 3. Recomendación (propuesta, sin imponer proveedor)

1. **Candidato preferente como respaldo/contraste: Bitstamp (USD)** — coincidencia con Kraken, formato simple, paginación y `exclude_current_candle`. Verificar sus límites de petición vigentes antes de cualquier uso.
2. **Bitfinex:** utilizable solo con calibración del sesgo y respetando 30 req/min; no como equivalente directo de USD-Kraken.
3. **Binance Spot:** no usar como fallback de decisiones en USD (base USDT, volúmenes no comparables). Puede servir como contraste de divergencia o contexto USDT, siempre etiquetado.
4. **Arquitectura:** reutilizar el contrato `CandleSeries` (`source`/`venue`/`quote` explícitos) y el validador existente; series por proveedor/par/timeframe, **nunca mezclar OHLC ni volúmenes de venues**; `origin` debe reflejar el proveedor real; ningún reetiquetado de fallback como Kraken.
5. **Política de fallback propuesta por consumidor** (umbrales a validar por el propietario antes de activar): seguimiento/UI: permitido con etiqueta de procedencia; salidas protectoras: permitido solo con la última divergencia medida bajo umbral (propuesta 0,5 %) y alerta; entradas nuevas: **no** con fuente secundaria (fail-closed) hasta tener replay que lo justifique; indicadores/score: solo con serie completa de una única fuente.
6. **Carga:** REST acotado (1 petición cada ≥5 min por par y timeframe) sin aumentar la carga de Kraken; WebSocket solo si se demuestra beneficio con reconexión y recuperación de huecos (no evaluado).
7. **Estado:** adaptador desactivado por defecto; no se instala nada en el VPS.
