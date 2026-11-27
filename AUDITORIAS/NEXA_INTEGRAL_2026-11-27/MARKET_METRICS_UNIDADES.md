# Market Metrics — unidades, cadencia y frescura

Fecha: 2026-11-27

## Funding rate

Binance Futures `/fapi/v1/fundingRate` devuelve `fundingRate` como fracción por intervalo de funding. Ejemplos:

- `0.0001` = 0.01% por intervalo;
- `0.0005` = 0.05% por intervalo;
- `0.001` = 0.1% por intervalo.

El proveedor convierte explícitamente con `rate × 100` antes de persistir, porque los umbrales del motor (`fundingRateMed`, `fundingRateHigh`) están expresados en porcentaje. El motor compara `Math.abs(valor)` pero conserva el signo en la razón del breakdown: positivo = longs pagan; negativo = shorts pagan.

La cadencia normal de funding de Binance es cada 8 horas y el refresh nominal del módulo es cada 4 horas. Por eso la frescura específica de funding usa una ventana de 9 horas: cubre un intervalo completo de publicación más margen de ingesta. Open interest y liquidaciones conservan la ventana de derivados de 1 hora porque su cadencia de actualización es mucho mayor.

## Open interest

El valor absoluto `open_interest` se almacena en USD/USDT según el proveedor, pero no se compara directamente contra umbrales porcentuales. El motor consume únicamente `open_interest_delta_24h_pct:<ASSET>`, derivado de snapshots del mismo proveedor, activo y unidad, o el porcentaje explícito suministrado por el proveedor.

## Liquidaciones

Las liquidaciones disponibles son agregadas de BTC. En el breakdown se marcan con `scope: BTC_MARKET_CONTEXT`; no se presentan como dato específico del par evaluado.

## Stablecoins

En DeFiLlama, los cambios porcentuales calculados desde supply agregado. Se deduplican por símbolo/activo antes de agregar. Una variación absoluta mayor que 10% en 24h se considera observación extrema/inconsistente y el motor la marca `invalid`, sin puntuar. Los textos evitan afirmar causalidad: describen contracción o expansión observada, no un efecto causado sobre precio.
