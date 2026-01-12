# KrakenBot - Autonomous Trading Bot

## Overview
KrakenBot is an autonomous cryptocurrency trading bot for the Kraken and Revolut X exchanges, designed for 24/7 operation. Its core purpose is to automate trading decisions based on predefined strategies and robust risk management, aiming to capitalize on market movements while protecting capital. It features a web-based dashboard for monitoring, portfolio management (BTC, ETH, SOL, USD), and real-time Telegram notifications. The project prioritizes robust risk management, multi-exchange support, and an adaptive exit engine for dynamic market conditions.

## User Preferences
- Preferred communication style: Simple, everyday language.
- **GitHub**: Configurado en Replit para sincronización de código.
- **Entornos**: NAS es la fuente de verdad (producción y dataset IA). Replit solo para desarrollo y pruebas.
- **Sincronización**: No implementar export/import ni DB remota entre NAS y Replit.
- **NAS Docker**: Contenedor PostgreSQL se llama `kraken-bot-db`. Para ejecutar SQL: `docker exec -it kraken-bot-db psql -U krakenbot -d krakenbot -c "SQL_AQUI"`
- **VPS Staging (IONOS)**: IP `5.250.184.18:3020`, ubicación `/opt/krakenbot-staging/`. Contenedor DB: `krakenbot-staging-db`. Usuario DB: `krakenstaging`, base de datos: `krakenbot_staging`. Para SQL: `docker exec -it krakenbot-staging-db psql -U krakenstaging -d krakenbot_staging -c "SQL_AQUI"`

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
- **Risk Management**: Comprehensive features including exposure control, dynamic position sizing, Stop-Loss/Take-Profit, Trailing Stop, Daily Loss Limit, Cooldown System, and Kraken compliance checks.
- **Market Regime Detection**: Automatically adjusts parameters based on ADX, EMA alignment, and Bollinger Band width to detect TREND, RANGE, or TRANSITION regimes.
- **Adaptive Exit Engine**: Dynamic SL/TP/Trail calculation using ATR (Average True Range) and regime detection, overriding static SMART_GUARD values when active. Includes fee-aware profit floors and safety limits.
- **Environment Safety**: DRY_RUN mode automatically enabled on Replit to prevent real orders.
- **FIFO Position Matching**: Tracks partial fills for accurate P&L and eliminates phantom positions.
- **AI Filter Module**: Machine learning filter to approve/reject trade signals based on historical performance.
- **Exit System Priority**: Hierarchical system prioritizes EMERGENCIES (Stop-Loss, Daily Loss Limit) > ADAPTIVE EXIT ENGINE > SMART_GUARD > TIME-STOP.

### Telegram Integration
- **Functionality**: Sends real-time notifications for bot status, trade executions, risk management triggers, and errors.
- **Commands**: Supports commands like `/estado`, `/pausar`, `/balance`, `/config` for bot management.
- **Features**: Rate limiting, multi-chat support, inline keyboard buttons, daily reports, and granular alert policies with configurable cooldowns per chat to prevent spam.
- **Communication**: Uses natural language messages in Spanish for trade notifications.

### Multi-Exchange Support
- **Architecture**: Employs an `IExchangeService` interface for abstracting exchange interactions, with concrete implementations for Kraken and Revolut X.
- **Configuration**: Allows dynamic selection of active trading and data exchanges.
- **Dynamic Fees**: P&L calculations dynamically use fees from the active exchange.

## Environment Variables

### Environment Detection
The system auto-detects environment based on these variables:
- **REPLIT/DEV**: Detected when `REPLIT_DEPLOYMENT` or `REPL_ID` exists
- **VPS/STG**: Detected when `VPS_DEPLOY=true`
- **NAS/PROD**: Default when neither Replit nor VPS detected

### Required Variables per Environment

#### VPS Staging (`docker-compose.staging.yml`)
| Variable | Description | Example |
|----------|-------------|---------|
| `VPS_DEPLOY` | Enables VPS detection | `true` |
| `VPS_PANEL_URL` | Public URL for "Ver Panel" links | `http://5.250.184.18:3020` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `TERMINAL_TOKEN` | WebSocket auth token | (secret) |

#### NAS Production (`docker-compose.yml`)
| Variable | Description | Example |
|----------|-------------|---------|
| `NAS_PANEL_URL` | Public URL for panel links | `http://nas-ip:5000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |

### Important Notes
- If `VPS_DEPLOY` is not set, system defaults to NAS/PROD
- Panel URL defaults to `localhost` if not configured (links won't work externally)
- Telegram messages include `[ENV_TAG]` prefix based on detected environment

## External Dependencies

-   **Kraken Exchange API**: Via `node-kraken-api` for trading and market data.
-   **Revolut X API**: Custom implementation via `RevolutXService` for trading on Revolut X (retail crypto exchange, not Revolut Business).
-   **Telegram Bot API**: Via `node-telegram-bot-api` for notifications and command handling.
-   **PostgreSQL Database**: Used for persistent storage, accessed via Drizzle ORM and the `pg` driver.