# KrakenBot - Autonomous Trading Bot

## Overview
KrakenBot is an autonomous cryptocurrency trading bot for the Kraken and Revolut X exchanges, designed for 24/7 operation. Its core purpose is to automate trading decisions based on predefined strategies and robust risk management, aiming to capitalize on market movements while protecting capital. It features a web-based dashboard for monitoring, portfolio management (BTC, ETH, SOL, USD), and real-time Telegram notifications.

---

## Trading System - Complete Documentation

### 1. Market Regime Detection

The bot automatically detects market conditions using technical indicators and adjusts its behavior accordingly.

#### Regime Types

| Regime | Description | Strategy Used | Entry Behavior |
|--------|-------------|---------------|----------------|
| **TREND** | Strong directional movement | Momentum (Candles 15m) | Selective entries with 5+ signals |
| **RANGE** | Sideways/consolidating market | Mean Reversion | Bounce entries with 2 signals |
| **TRANSITION** | Changing between regimes | Momentum with caution | Reduced size (50%) or paused |

#### Detection Indicators

| Indicator | TREND | RANGE | TRANSITION |
|-----------|-------|-------|------------|
| **ADX** | >= 27 (enter), <= 23 (exit) | < 19 | 19-27 (intermediate zone) |
| **EMA Alignment** | Strong alignment (price > EMA20 > EMA50) | No alignment | Partial/mixed alignment |
| **Bollinger Width** | > 4% | < 4% | Variable |

#### Regime Confirmation Logic
- **minHold**: 20 minutes minimum in a regime before switching
- **confirmScans**: 3 consecutive scans required to confirm regime change
- **Cooldown**: 60 minutes between regime change notifications

---

### 2. Trading Strategies

#### 2.1 Momentum Strategy (momentum_candles_15m)
**Used in**: TREND and TRANSITION regimes

Analyzes 15-minute candlestick patterns combined with technical indicators.

**BUY Signals** (weighted score >= 5 required):
| # | Signal | Condition | Weight |
|---|--------|-----------|--------|
| 1 | EMA Crossover | EMA10 > EMA20 | +1 |
| 2 | RSI Momentum | RSI < 45 | +1 |
| 2b | RSI Oversold Bonus | RSI < 30 (replaces +1 with +2) | +2 |
| 3 | MACD Bullish | Histogram > 0 AND MACD > Signal | +1 |
| 4 | Bollinger Position | Price %B < 20 (near lower band) | +1 |
| 5 | Bullish Candle | Close > Open with body > 60% | +1 |
| 6 | High Volume | Volume > 1.5x average + bullish candle | +1 |
| 7 | Engulfing Pattern | Current candle engulfs previous | +1 |

> **Note**: RSI < 30 gives +2 instead of +1 (bonus). Max score = 8 (if RSI oversold bonus active).

**SELL Signals** (weighted score >= 5 required):
| # | Signal | Condition | Weight |
|---|--------|-----------|--------|
| 1 | EMA Crossover | EMA10 < EMA20 | +1 |
| 2 | RSI Overbought | RSI > 55 | +1 |
| 2b | RSI Extreme Bonus | RSI > 70 (replaces +1 with +2) | +2 |
| 3 | MACD Bearish | Histogram < 0 AND MACD < Signal | +1 |
| 4 | Bollinger Position | Price %B > 80 (near upper band) | +1 |
| 5 | Bearish Candle | Close < Open with body > 60% | +1 |
| 6 | High Volume | Volume > 1.5x average + bearish candle | +1 |
| 7 | Engulfing Pattern | Current candle engulfs previous | +1 |

> **Note**: RSI > 70 gives +2 instead of +1 (bonus). Max score = 8 (if RSI overbought bonus active).

#### 2.2 Mean Reversion Strategy (mean_reversion_simple)
**Used in**: RANGE regime

Looks for oversold/overbought conditions in sideways markets.

**BUY Signals** (requires 2 confirmations):
| # | Signal | Condition |
|---|--------|-----------|
| 1 | Bollinger Touch | Price <= Lower Bollinger Band |
| 2 | RSI Oversold | RSI <= 35 |

**Note**: Mean Reversion only generates BUY signals. SELL exits are handled by SMART_GUARD exit conditions.

---

### 3. Signal Requirements by Regime

| Regime | Strategy | Min Signals Required | Entry Size Factor |
|--------|----------|---------------------|-------------------|
| TREND | Momentum 15m | 5 signals | 100% |
| RANGE | Mean Reversion | 2 signals | 100% |
| TRANSITION | Momentum 15m | 5 signals | 50% (sizeFactor=0.50) |

---

### 4. Position Modes

#### 4.1 SMART_GUARD (Recommended)
Intelligent capital protection with dynamic exit management.

**Features**:
- Automatic break-even activation
- Progressive trailing stop
- Fixed take-profit option
- Time-based exit (time-stop)
- Fee-aware profit floors
- Per-pair parameter overrides

#### 4.2 SINGLE
One position per pair at a time. Simple stop-loss and take-profit.

#### 4.3 DCA (Dollar Cost Averaging)
Allows multiple entries at different price levels to average down.

---

### 5. Exit System - Priority Hierarchy

Exits are processed in this priority order:

```
1. EMERGENCIES (highest priority)
   - Stop-Loss hit
   - Daily Loss Limit reached
   - Emergency SL (critical)

2. ADAPTIVE EXIT ENGINE (if enabled)
   - ATR-based dynamic SL/TP
   - Regime-adjusted parameters

3. SMART_GUARD
   - Take-Profit Fixed
   - Trailing Stop
   - Break-Even
   - Scale-Out (partial sells)

4. TIME-STOP (lowest priority)
   - Soft mode (waits for profit)
   - Hard mode (forces close)
```

---

### 6. SMART_GUARD Exit Conditions

#### 6.1 Break-Even (BE) Activation
Moves stop-loss to entry price + fees when profit threshold is reached.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sgBeAtPct` | Profit % to activate BE | 1.5% |
| `sgFeeCushionPct` | Extra buffer above BE | 0.45% |

**Example**: Position at $100, BE activates at $101.50. Stop moves to $100.40 (entry + fees).

#### 6.2 Trailing Stop
Follows price upward, locking in profits as price rises.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sgTrailStartPct` | Profit % to activate trailing | 2.0% |
| `sgTrailDistancePct` | Distance behind price | 1.5% |
| `sgTrailStepPct` | Minimum step to update stop | 0.25% |

**Example**: Price at $105 (+5%), trailing stop at $103.50 (5% - 1.5% = 3.5% profit locked).

#### 6.3 Fixed Take-Profit
Automatic exit when target profit is reached.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sgTpFixedEnabled` | Enable fixed TP | true |
| `sgTpFixedPct` | Target profit % | 10% |

#### 6.4 Time-Stop
Closes positions that remain open too long.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `timeStopHours` | Max hours to hold | 36 |
| `timeStopMode` | `soft` or `hard` | soft |

**Modes**:
- **Soft**: Only closes if position is profitable enough to cover fees
- **Hard**: Forces close regardless of profit (emergency)

#### 6.5 Scale-Out (Partial Sells)
Sells a portion of the position at profit targets.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `sgScaleOutEnabled` | Enable scale-out | false |
| `sgScaleOutPct` | Profit % to trigger | 35% |
| `sgMinPartUsd` | Minimum USD per partial | $50 |

---

### 7. Adaptive Exit Engine (ATR-based)

When enabled, dynamically calculates SL/TP based on market volatility.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `adaptiveExitEnabled` | Enable ATR-based exits | true |
| `takerFeePct` | Taker fee % | 0.40% |
| `profitBufferPct` | Min profit after fees | 1.0% |
| `minBeFloorPct` | Minimum BE threshold | 2.0% |

**ATR Multipliers by Regime**:
| Regime | SL Multiplier | TP Multiplier | Trail Multiplier |
|--------|---------------|---------------|------------------|
| TREND | 1.5x ATR | 3.0x ATR | 1.0x ATR |
| RANGE | 1.0x ATR | 2.0x ATR | 0.75x ATR |
| TRANSITION | 1.25x ATR | 2.5x ATR | 1.0x ATR |

---

### 8. Fee Gating

All non-emergency exits are blocked unless profit covers fees.

**Formula**:
```
minCloseNetPct = (takerFeePct x 2) + profitBufferPct
Example: (0.40% x 2) + 1.0% = 1.80% minimum profit required
```

This prevents closing positions at a loss due to fees.

---

### 9. Risk Management

#### Position Sizing
| Parameter | Description | Default |
|-----------|-------------|---------|
| `sgMinEntryUsd` | Minimum entry size | $100 |
| `riskPerTradePct` | % of balance per trade | 100% |
| `maxPairExposurePct` | Max exposure per pair | 100% |
| `maxTotalExposurePct` | Max total exposure | 100% |

#### Daily Loss Limit
| Parameter | Description | Default |
|-----------|-------------|---------|
| `dailyLossLimitEnabled` | Enable daily limit | true |
| `dailyLossLimitPercent` | Max daily loss % | 10% |

#### Cooldown System
| Parameter | Description | Default |
|-----------|-------------|---------|
| `rangeCooldownMinutes` | Cooldown in RANGE | 60 min |
| `transitionCooldownMinutes` | Cooldown in TRANSITION | 120 min |

---

### 10. Order Execution

**Order Type**: MARKET orders only (100% taker fees)

**Execution Flow**:
1. Signal generated by strategy
2. Regime check (adjust parameters)
3. Exposure check (max position limits)
4. Minimum order validation
5. Fee calculation
6. Order placed on exchange
7. Position tracked in database
8. Telegram notification sent

---

### 11. Quick Reference: Why No Trades Are Happening

If the bot is not executing trades, check these conditions:

| Condition | Log Message | Solution |
|-----------|-------------|----------|
| Insufficient signals | "senales insuficientes (X/Y)" | Wait for more confirmations |
| RANGE regime, no oversold | "RSI=XX > 30" | Price not at Bollinger lower band |
| TRANSITION cooldown | "cooldown activo" | Wait for cooldown to expire |
| Max exposure reached | "MAX_LOTS_PER_PAIR" | Close existing positions |
| Daily limit reached | "isDailyLimitReached: true" | Wait for next day |
| Minimum order too small | "volumen < orderMin" | Increase trade size |

---

## User Preferences
- Preferred communication style: Simple, everyday language.
- **GitHub**: Configurado en Replit para sincronizacion de codigo.
- **Entornos**: NAS es la fuente de verdad (produccion y dataset IA). Replit solo para desarrollo y pruebas.
- **Sincronizacion**: No implementar export/import ni DB remota entre NAS y Replit.
- **NAS Docker**: Contenedor PostgreSQL se llama `kraken-bot-db`. Para ejecutar SQL: `docker exec -it kraken-bot-db psql -U krakenbot -d krakenbot -c "SQL_AQUI"`
- **VPS Staging (IONOS)**: IP `5.250.184.18:3020`, ubicacion `/opt/krakenbot-staging/`. Contenedor DB: `krakenbot-staging-db`. Usuario DB: `krakenstaging`, base de datos: `krakenbot_staging`. Para SQL: `docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "SQL_AQUI"`

---

## System Architecture

### Frontend
- **Framework**: React with TypeScript.
- **Styling**: Tailwind CSS, utilizing shadcn/ui components (New York style).
- **State Management**: TanStack React Query for server-side state.
- **Build**: Vite.
- **Real-time Events**: WebSocket-based event streaming and terminal logs.

### Backend
- **Framework**: Express.js with TypeScript.
- **Runtime**: Node.js.
- **API**: RESTful endpoints.
- **Services**: KrakenService, TelegramService, AiService, and a generic `IExchangeService` for multi-exchange support.

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Defined in `shared/schema.ts`, including tables for bot configuration, API keys, trades, notifications, open positions, and AI training data.

### Trading Engine
- **Core Loop**: Executes every 10-30 seconds for continuous market analysis and trade execution.
- **Strategies**: Supports Momentum, Mean Reversion, Scalping, Grid Trading, with Multi-Timeframe Analysis (MTF).
- **Position Modes**: SINGLE, DCA, and SMART_GUARD for intelligent capital protection.
- **Risk Management**: Comprehensive features including exposure control, dynamic position sizing, Stop-Loss/Take-Profit, Trailing Stop, Daily Loss Limit, Cooldown System.
- **Market Regime Detection**: Automatically adjusts parameters based on ADX, EMA alignment, and Bollinger Band width.
- **Adaptive Exit Engine**: Dynamic SL/TP/Trail calculation using ATR and regime detection.
- **Environment Safety**: DRY_RUN mode automatically enabled on Replit.
- **FIFO Position Matching**: Tracks partial fills for accurate P&L.
- **Fee Gating**: All non-emergency exits blocked unless profit covers fees.

### Telegram Integration
- **Functionality**: Real-time notifications for bot status, trade executions, risk triggers, and errors.
- **Commands**: `/estado`, `/pausar`, `/balance`, `/config` for bot management.
- **Features**: Rate limiting, multi-chat support, daily reports, cooldowns per chat.
- **Communication**: Natural language messages in Spanish.

### Multi-Exchange Support
- **Architecture**: `IExchangeService` interface with Kraken and Revolut X implementations.
- **Configuration**: Dynamic selection of trading and data exchanges.
- **Dynamic Fees**: P&L calculations use fees from active exchange.

---

## Environment Variables

### Environment Detection
- **REPLIT/DEV**: When `REPLIT_DEPLOYMENT` or `REPL_ID` exists
- **VPS/STG**: When `VPS_DEPLOY=true`
- **NAS/PROD**: Default when neither Replit nor VPS detected

### VPS Staging Variables
| Variable | Description |
|----------|-------------|
| `VPS_DEPLOY` | Enables VPS detection |
| `VPS_PANEL_URL` | Public URL for panel links |
| `DATABASE_URL` | PostgreSQL connection string |
| `TERMINAL_TOKEN` | WebSocket auth token |

---

## External Dependencies

- **Kraken Exchange API**: Via `node-kraken-api` for market data.
- **Revolut X API**: Custom `RevolutXService` for trading.
- **CoinGecko API**: Fallback for portfolio prices (VET, FLR, MEW, LMWR, ZKJ).
- **Telegram Bot API**: Via `node-telegram-bot-api` for notifications.
- **PostgreSQL Database**: Via Drizzle ORM and `pg` driver.
