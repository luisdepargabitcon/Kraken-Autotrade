# KrakenBot - Autonomous Trading Bot

## Overview
KrakenBot is an autonomous cryptocurrency trading bot designed for 24/7 operation on Kraken and Revolut X exchanges. Its primary purpose is to automate trading decisions, execute predefined strategies, and manage risk to capitalize on market movements. Key features include a web-based monitoring dashboard, portfolio management (BTC, ETH, SOL, USD), and real-time Telegram notifications. The project aims to provide a robust, automated trading solution for cryptocurrency markets.

## User Preferences
- Preferred communication style: Simple, everyday language.
- **GitHub**: Configurado en Replit para sincronizacion de codigo.
- **Entornos**: NAS es la fuente de verdad (produccion y dataset IA). Replit solo para desarrollo y pruebas.
- **Sincronizacion**: No implementar export/import ni DB remota entre NAS y Replit.
- **NAS Docker**: Contenedor PostgreSQL se llama `kraken-bot-db`. Para ejecutar SQL: `docker exec -it kraken-bot-db psql -U krakenbot -d krakenbot -c "SQL_AQUI"`
- **VPS Staging (IONOS)**: IP `5.250.184.18:3020`, ubicacion `/opt/krakenbot-staging/`. Contenedor DB: `krakenbot-staging-db`. Usuario DB: `krakenstaging`, base de datos: `krakenbot_staging`. Para SQL: `docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "SQL_AQUI"`

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
- **Strategies**: Supports Momentum (15-minute candles) and Mean Reversion, with Multi-Timeframe Analysis (MTF) to filter trades against the main trend.
- **Market Regime Detection**: Automatically adjusts parameters based on ADX, EMA alignment, and Bollinger Band width to identify TREND, RANGE, or TRANSITION regimes.
- **Signal Requirements**: Minimum signals vary by strategy and regime (e.g., 5 for Momentum in TREND, 2 for Mean Reversion in RANGE).
- **Position Modes**: SINGLE, DCA (Dollar Cost Averaging), and SMART_GUARD for intelligent capital protection.
- **Exit System**: Priority-based exits including EMERGENCIES (stop-loss, daily loss limit), ADAPTIVE EXIT ENGINE (ATR-based dynamic SL/TP/Trail), SMART_GUARD (fixed take-profit, trailing stop, break-even, time-stop, scale-out), and a general TIME-STOP.
- **Fee Gating**: All non-emergency exits are blocked unless profit covers trading fees.
- **Risk Management**: Comprehensive features including exposure control (`riskPerTradePct`, `maxPairExposurePct`, `maxTotalExposurePct`), Daily Loss Limit, and Cooldown System.
- **Order Execution**: Uses MARKET orders, with a flow including signal generation, regime check, exposure check, minimum order validation, and fee calculation.
- **Environment Safety**: DRY_RUN mode automatically enabled on Replit.
- **FIFO Position Matching**: Tracks partial fills for accurate P&L.

### Telegram Integration
- **Functionality**: Real-time notifications for bot status, trade executions, risk triggers, and errors.
- **Commands**: `/estado`, `/pausar`, `/balance`, `/config` for bot management.
- **Features**: Rate limiting, multi-chat support, daily reports, cooldowns per chat.
- **Communication**: Natural language messages in Spanish.

### Multi-Exchange Support
- **Architecture**: `IExchangeService` interface with Kraken and Revolut X implementations.
- **Configuration**: Dynamic selection of trading and data exchanges.
- **Dynamic Fees**: P&L calculations use fees from active exchange.

## External Dependencies

- **Kraken Exchange API**: For market data.
- **Revolut X API**: Custom `RevolutXService` for trading.
- **CoinGecko API**: Fallback for portfolio prices of less common cryptocurrencies.
- **Telegram Bot API**: For notifications and bot control.
- **PostgreSQL Database**: Via Drizzle ORM and `pg` driver.