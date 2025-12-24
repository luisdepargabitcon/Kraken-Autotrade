# KrakenBot - Autonomous Trading Bot

## Overview
KrakenBot is an autonomous cryptocurrency trading bot for the Kraken exchange, designed for 24/7 operation. Its core purpose is to automate trading decisions based on predefined strategies and robust risk management, aiming to capitalize on market movements while protecting capital. It features a web-based dashboard for monitoring, portfolio management (BTC, ETH, SOL, USD), and real-time Telegram notifications. It can be deployed on Replit for development or self-hosted via Docker for production.

## User Preferences
- Preferred communication style: Simple, everyday language.
- **Entornos**: NAS es la fuente de verdad (producción y dataset IA). Replit solo para desarrollo y pruebas.
- **Sincronización**: No implementar export/import ni DB remota entre NAS y Replit.

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
- **Services**: KrakenService, TelegramService, AiService.

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Defined in `shared/schema.ts`.
- **Key Tables**: `bot_config`, `api_config`, `trades`, `notifications`, `open_positions`, `training_trades`, `ai_config`.

### Trading Engine
- **Core Loop**: Executes every 10-30 seconds for balance checks, resets, stop-loss/take-profit, and strategy analysis.
- **Strategies**: Momentum, Mean Reversion, Scalping, Grid Trading.
- **Multi-Timeframe Analysis (MTF)**: Analyzes 5-min, 1-hour, and 4-hour trends.
- **Position Modes**: SINGLE, DCA, and SMART_GUARD.
- **Risk Management**: Commission profitability filter, exposure control, bid-ask spread, trading hours, dynamic position sizing, Stop-Loss/Take-Profit, Trailing Stop, Daily Loss Limit, Cooldown System, Kraken compliance.
- **SMART_GUARD Mode**: Intelligent capital protection with strict entry validation, including MTF entry filter, Anti-FOMO filter, minimum signals threshold, and dynamic sizing (Sizing v2) with fee cushion. Includes Break-Even Protection, Trailing Stop, Fixed Take-Profit, and Scale-Out features. Per-pair overrides are supported.
- **Market Regime Detection**: Automatically adjusts SMART_GUARD exit parameters based on ADX, EMA alignment, and Bollinger Band width to detect TREND, RANGE, or TRANSITION regimes. Includes hysteresis, confirmation, and cooldown mechanisms to prevent oscillation and spam.
- **Environment Safety**: DRY_RUN mode prevents real orders, automatically enabled on Replit.
- **FIFO Position Matching**: Automatic position closing with partial fills tracking using `trade_fills` and `lot_matches` tables, ensuring accurate P&L and eliminating phantom positions.
- **Confidence Normalization**: Internally uses 0..1 scale, displays and ML use 0..100.
- **Strategy Meta Inheritance**: SELL trades inherit strategy metadata from the original position for consistent labeling.
- **P&L Tracking**: Immediate P&L calculation and storage for every automatic SELL trade at execution time.
- **AI Filter Module**: Machine learning filter to approve/reject trade signals based on historical performance, operating in Red (data collection), Yellow (ready to train), and Green (filter active) phases.

### Telegram Integration
- **Functionality**: Sends notifications for bot status, trade executions, risk management triggers, and errors.
- **Commands**: Supported on Docker/NAS for `/estado`, `/pausar`, `/reanudar`, `/balance`, `/config`, `/exposicion`, `/uptime`, `/ultimas`, `/ayuda`, `/menu`, `/channels`.
- **Features**: Rate limiting, multi-chat support, inline keyboard buttons, daily reports, and channel management.
- **Security**: HTML formatting with `escapeHtml()` helper to prevent markup injection.

### Quote Currency Validation
- **Purpose**: Blocks trades on non-USD pairs, allowing only "USD" quoted pairs.

## External Dependencies

-   **Kraken Exchange API**:
    -   **Package**: `node-kraken-api`.
    -   **Purpose**: Trading operations (execute, fetch balances, market data).
-   **Telegram Bot API**:
    -   **Package**: `node-telegram-bot-api`.
    -   **Purpose**: Send notifications and receive commands.
-   **PostgreSQL Database**:
    -   **ORM**: Drizzle ORM.
    -   **Driver**: `pg`.