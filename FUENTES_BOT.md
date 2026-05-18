# Fuentes de Datos de Mercado — Mapa Completo

> Documento generado automáticamente el 11 de mayo de 2026
> Sistema de trading KrakenBot

---

## 1. Exchanges (Datos de precio y velas)

### 🔷 Kraken API (Fuente principal de datos)

| Dato | Método | Librería | Endpoint |
|---|---|---|---|
| **Velas OHLCV** | `krakenService.getOHLC(pair, interval)` | `node-kraken-api` | `publicClient.ohlc({pair, interval})` |
| **Ticker (bid/ask/last/vol24h)** | `krakenService.getTicker(pair)` | `node-kraken-api` | `publicClient.ticker({pair})` |
| **Balance** | `krakenService.getBalance()` | `node-kraken-api` | `client.balance()` (privado, con nonce) |
| **Par metadata** | `krakenService.loadPairMetadata(pairs)` | `node-kraken-api` | `publicClient.assetPairs()` |

- **URL base:** implícita en `node-kraken-api` → `https://api.kraken.com`
- **Archivo:** `server/services/kraken.ts`
- **Rol actual:** `dataExchange` — **SIEMPRE Kraken para datos** (hardcoded en `ExchangeFactory.ts:209`)
- **Rate limiting:** via `krakenRateLimiter` (local)
- **Timeframes disponibles:** 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w

---

### 🟡 Revolut X API (Ejecución de órdenes)

| Dato | Método | Protocolo | Endpoint |
|---|---|---|---|
| **Ticker (quote)** | `revolutXService.getTicker(pair)` | REST (Ed25519 firmado) | `GET /api/1.0/quote?base_currency=X&quote_currency=Y` |
| **Velas OHLCV** | `revolutXService.getOHLC(pair, interval)` | REST público | `GET /api/1.0/public/candles/{symbol}?resolution=X` |
| **Balance** | `revolutXService.getBalance()` | REST (firmado) | `GET /api/1.0/accounts` |
| **Trades privados** | `revolutXService.listPrivateTrades(...)` | REST (firmado) | `GET /api/1.0/trades/private/{symbol}` |
| **Órdenes históricas** | `revolutXService.listHistoricalOrders(...)` | REST (firmado) | `GET /api/1.0/orders/historical` |

- **URL base:** `https://revx.revolut.com`
- **Archivo:** `server/services/exchanges/RevolutXService.ts`
- **Rol actual:** `tradingExchange` — solo para ejecutar órdenes (buy/sell)
- **Auth:** Ed25519 firma (`X-Revx-API-Key`, `X-Revx-Timestamp`, `X-Revx-Signature`)
- **Circuit breaker:** 3 fallos → abierto 5 min
- **Nota:** `getTickerFromOrderbook()` está **DESHABILITADO** (el endpoint no existe en RevolutX)

---

## 2. Capa unificada — MarketDataService (Singleton con cache)

| Método | Fuente real | TTL |
|---|---|---|
| `getCandles(pair, tf)` | `ExchangeFactory.getDataExchange().getOHLC()` → **siempre Kraken** | 1m→2min, 5m→6min, 15m→20min, 1h→90min, 4h→4h, 1d→6h |
| `getPrice(pair)` | `ExchangeFactory.getDataExchange().getTicker()` → **siempre Kraken** | 30s |
| `getTicker(pair)` | Ídem | 30s |
| `getATR(pair, tf, period)` | Derivado de `getCandles` (sin fetch extra) | — |

- **Archivo:** `server/services/MarketDataService.ts`
- **Single-flight:** peticiones concurrentes para mismo par+tf comparten una sola llamada
- **Consumidores:** Motor Momentum (`tradingEngine.ts`), IDCA Engine, IdcaMarketContextService

---

## 3. Proveedores de Métricas (MarketMetricsService)

Estos proveedores NO son de precio/velas, sino de **métricas de contexto macro** usadas por el motor de señales.

### 🟢 DeFi Llama (gratis, sin key)
| Dato | URL | Métricas |
|---|---|---|
| Stablecoins market cap | `https://stablecoins.llama.fi/stablecoins` | `stablecoin_circ_usd`, `stablecoin_net_flow_24h`, `stablecoin_net_flow_7d` por cada stable (USDT, USDC, DAI, FRAX, BUSD, TUSD, USDP, GUSD) |
- **Archivo:** `providers/DeFiLlamaProvider.ts`

### 🟢 Binance Futures (gratis, sin key) — Default
| Dato | URL | Métricas |
|---|---|---|
| Open Interest | `https://fapi.binance.com/fapi/v1/openInterest` | `open_interest` USD por BTC, ETH, SOL, XRP |
| Funding Rate | `https://fapi.binance.com/fapi/v1/premiumIndex` | `funding_rate` % por cada symbol |
- **Archivo:** `providers/BinanceFuturesProvider.ts`
- **Activo si:** no hay `COINGLASS_API_KEY` en env

### 🟡 CoinMetrics (gratis con límites, tier community)
| Dato | URL | Métricas |
|---|---|---|
| Exchange flows | `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics` | `FlowInExUSD`, `FlowOutExUSD`, `FlowNetInExUSD` para BTC, ETH, SOL, XRP |
- **Archivo:** `providers/CoinMetricsProvider.ts`
- **Limitación:** 1 día de lag, algunos assets no disponibles en tier gratuito

### 🟡 CoinGlass (requiere `COINGLASS_API_KEY`)
| Dato | URL | Métricas |
|---|---|---|
| Open Interest | `https://open-api.coinglass.com/public/v2` | `open_interest` |
| Funding Rate | Ídem | `funding_rate` |
| Liquidaciones | Ídem | `liquidations` |
- **Archivo:** `providers/CoinGlassProvider.ts`
- **Activo si:** `COINGLASS_API_KEY` está en env (reemplaza a Binance Futures)

### 🟡 Whale Alert (requiere `WHALE_ALERT_API_KEY`)
| Dato | URL | Métricas |
|---|---|---|
| Transferencias ≥$1M | `https://api.whale-alert.io/v1/transactions` | Ballenas entrando/saliendo exchanges (BTC, ETH, SOL, XRP, TON, USDT, USDC) |
- **Archivo:** `providers/WhaleAlertProvider.ts`
- **Lookback:** 2 horas

---

## 4. Consumidores internos

| Motor | Fuente de datos | Qué obtiene |
|---|---|---|
| **IDCA Engine** | `MarketDataService` → Kraken | Velas 1h, precio spot, OHLCV para VWAP/ATR/basePrice |
| **IdcaMarketContextService** | `MarketDataService` → Kraken | Velas para VWAP, ATR, contexto de mercado |
| **Trading Engine (Momentum)** | `MarketDataService` → Kraken (con fallback directo a exchange) | Velas multi-tf, precios para scoring |
| **MarketMetricsService** | DeFi Llama + Binance/CoinGlass + CoinMetrics + WhaleAlert | Macro signals para scoring |

---

## 5. Resumen visual

```
┌─────────────────────────────────────────────────────────────┐
│                   FUENTES EXTERNAS                           │
├─────────────────────────────────────────────────────────────┤
│  Kraken REST API (node-kraken-api)                          │
│    → Velas OHLCV (1m-1w)                                    │
│    → Ticker (bid/ask/last/vol24h)                           │
│    → Balance, Par metadata                                  │
│                                                             │
│  Revolut X REST API (Ed25519)                               │
│    → Ejecución de órdenes (buy/sell)                        │
│    → Balance, Trades, Órdenes históricas                    │
│    → Ticker/OHLC (backup, raramente usado)                  │
│                                                             │
│  DeFi Llama (gratis)       → Stablecoins market cap/flow   │
│  Binance Futures (gratis)  → OI, Funding Rate              │
│  CoinMetrics (gratis+lag)  → Exchange net flows            │
│  CoinGlass (de pago)       → OI, Funding, Liquidaciones    │
│  Whale Alert (de pago)     → Transferencias ballenas       │
└─────────────────────────────────────────────────────────────┘
             │                           │
             ▼                           ▼
┌──────────────────────┐     ┌──────────────────────┐
│  MarketDataService   │     │ MarketMetricsService  │
│  (cache TTL + dedup) │     │   (DB + cron)         │
│  Kraken SIEMPRE      │     │                       │
└──────────────────────┘     └──────────────────────┘
        │                            │
        ▼                            ▼
┌─────────────────────────────────────────┐
│  IDCA Engine / Momentum Engine / UI     │
└─────────────────────────────────────────┘
```

---

## 6. Datos clave

- **No hay WebSocket** en ningún lado. Todo es REST polling con cache TTL.
- **Kraken es SIEMPRE la fuente de datos de mercado**, incluso si Revolut X es el exchange de trading. Esto está hardcoded en `ExchangeFactory.ts:209`:
  > `// Data exchange is ALWAYS Kraken - it has the best OHLC/market data API`
- **Revolut X** se usa exclusivamente para ejecutar órdenes y consultar balance/historial de trades. Su `getOHLC` y `getTicker` existen pero casi nunca se invocan (solo como fallback).
- Las **métricas macro** (DeFi Llama, Binance Futures, etc.) alimentan el scoring del motor Momentum, no el IDCA directamente.

---

## 7. Archivos relevantes

| Archivo | Propósito |
|---|---|
| `server/services/MarketDataService.ts` | Cache unificado de velas/precios |
| `server/services/exchanges/ExchangeFactory.ts` | Orquesta Kraken/RevolutX |
| `server/services/kraken.ts` | Cliente Kraken API |
| `server/services/exchanges/RevolutXService.ts` | Cliente RevolutX API |
| `server/services/marketMetrics/MarketMetricsService.ts` | Orquesta proveedores de métricas macro |
| `server/services/marketMetrics/providers/DeFiLlamaProvider.ts` | Stablecoins market cap |
| `server/services/marketMetrics/providers/BinanceFuturesProvider.ts` | OI y funding rate (gratis) |
| `server/services/marketMetrics/providers/CoinGlassProvider.ts` | OI, funding, liquidaciones (de pago) |
| `server/services/marketMetrics/providers/CoinMetricsProvider.ts` | Exchange flows |
| `server/services/marketMetrics/providers/WhaleAlertProvider.ts` | Transferencias ballenas |
| `server/services/tradingEngine.ts` | Motor Momentum (usa MarketDataService) |
| `server/services/institutionalDca/IdcaEngine.ts` | Motor IDCA (usa MarketDataService) |
| `server/services/institutionalDca/IdcaMarketContextService.ts` | Contexto de mercado para IDCA UI |

---

## 8. Variables de entorno relevantes

| Variable | Uso | Requerido |
|---|---|---|
| `COINGLASS_API_KEY` | Habilita CoinGlass en lugar de Binance Futures | Opcional |
| `WHALE_ALERT_API_KEY` | Habilita Whale Alert | Opcional |
| `KRAKEN_API_KEY` | Credenciales Kraken | Requerido |
| `KRAKEN_API_SECRET` | Credenciales Kraken | Requerido |
| `REVOLUTX_API_KEY` | Credenciales Revolut X | Requerido si se usa RevolutX |
| `REVOLUTX_PRIVATE_KEY` | Ed25519 PEM para Revolut X | Requerido si se usa RevolutX |

---

## 9. TTLs por defecto (MarketDataService)

| Timeframe | TTL |
|---|---|
| 1m | 2 min |
| 5m | 6 min |
| 15m | 20 min |
| 30m | 40 min |
| 1h | 90 min |
| 4h | 4 horas |
| 1d | 6 horas |
| 1w | 12 horas |
| Spot price | 30 segundos |
