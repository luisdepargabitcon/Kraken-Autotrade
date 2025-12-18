# KrakenBot - Autonomous Trading Bot

## Overview
KrakenBot is an autonomous cryptocurrency trading bot for the Kraken exchange. It features a web-based dashboard for monitoring, portfolio management (BTC, ETH, SOL, USD), and real-time Telegram notifications. Designed for 24/7 operation, it can be deployed on Replit or self-hosted via Docker. Its core purpose is to automate trading decisions based on predefined strategies and robust risk management, aiming to capitalize on market movements while protecting capital.

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
- **Real-time Events**: WebSocket-based event streaming and terminal logs to the Monitor page.

### Backend
- **Framework**: Express.js with TypeScript.
- **Runtime**: Node.js.
- **API**: RESTful endpoints (`/api/*`).
- **Services**: KrakenService for exchange interaction, TelegramService for notifications, AiService for ML filter.

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Defined in `shared/schema.ts`.
- **Key Tables**: `bot_config`, `api_config`, `trades`, `notifications`, `open_positions`, `training_trades`, `ai_config`.

### Trading Engine
- **Core Loop**: Executes every 10-30 seconds for balance checks, resets, stop-loss/take-profit, and strategy analysis.
- **Strategies**: Momentum, Mean Reversion, Scalping, Grid Trading.
- **Multi-Timeframe Analysis (MTF)**: Analyzes 5-min, 1-hour, and 4-hour trends.
- **Trade Execution**: Market orders, database logging, position updates, Telegram notifications.
- **Position Modes**: SINGLE (one position per pair), DCA (multiple entries), and SMART_GUARD (intelligent capital protection).

### Risk Management
- **Filters**: Commission profitability, exposure control (per pair, total, per trade), bid-ask spread, trading hours.
- **Dynamic Adjustments**: Dynamic position sizing based on signal confidence.
- **Loss Control**: Stop-Loss/Take-Profit, Trailing Stop, Daily Loss Limit, Cooldown System.
- **Kraken Compliance**: Adherence to Kraken minimum trade volumes and real balance verification.
- **Position Persistence**: Open positions are stored in the database.
- **Configuration Snapshot**: New positions store a snapshot of trading parameters at entry.

### SMART_GUARD Mode
- **Purpose**: Intelligent capital protection with strict entry validation.
- **Entry Validation**: Minimum entry USD per trade (sgMinEntryUsd), $20 absolute minimum threshold.
- **Final Order Validation**: Before executeTrade(), validates orderUsdFinal against sgMinEntryUsd. Blocks trade if below minimum and sgAllowUnderMin=false.
- **Reduced Entry**: If sgAllowUnderMin=true and available >= $20, allows entry with available balance.
- **Break-Even Protection**: Moves stop-loss to entry price + fees when profit reaches sgBeAtPct.
- **Trailing Stop**: Activates at sgTrailStartPct profit, follows at sgTrailDistancePct, updates at sgTrailStepPct steps.
- **Fixed Take-Profit**: Optional sgTpFixedPct for guaranteed profit capture.
- **Scale-Out**: Optional partial profit taking at sgScaleOutPct before fixed TP.
- **Per-Pair Overrides**: sgPairOverrides allows customizing parameters per trading pair.
- **Sizing**: Uses available balance directly (ignores exposure limits) with sgMinEntryUsd as target.
- **Diagnostic Endpoint**: GET /api/scan/diagnostic provides scan results with Spanish reasons.

### Environment Safety
- **DRY_RUN Mode**: Prevents real orders from being sent to exchange.
- **Auto-Detection**: Replit environment (REPLIT_DEPLOYMENT, REPL_ID) forces DRY_RUN automatically.
- **NAS Control**: On NAS, dryRunMode can be toggled via bot_config.
- **Simulation**: In DRY_RUN, executeTrade() logs events and sends "[DRY_RUN] Trade Simulado" Telegram messages without touching Kraken.
- **Production Safety**: NAS is the source of truth for production trading; Replit is development/testing only.

### AI Filter Module
- **Purpose**: Machine learning filter to approve/reject trade signals based on historical performance.
- **Phases**: Red (data collection), Yellow (ready to train), Green (filter active).
- **Training Data**: `training_trades` table stores BUY/SELL pairs with PnL labels. Backfill reconstructs data.
- **Discard Reasons**: Excludes invalid or anomalous trades from training data.
- **Diagnostic Metrics**: Provides aggregated counts of discard reasons and open trades/lots.

### Telegram Integration
- **Functionality**: Sends notifications for bot status, trade executions, risk management triggers, and errors.
- **Commands (Docker/NAS)**: Supports commands like `/estado`, `/pausar`, `/reanudar`.
- **Modes**: Polling for Docker/NAS deployments (commands), disabled for Replit (notifications only).
- **Features**: Rate limiting to prevent spam and multi-chat support.

## External Dependencies

- **Kraken Exchange API**:
    - **Package**: `node-kraken-api`.
    - **Purpose**: Trading operations (execute, fetch balances, market data).
    - **Configuration**: API key/secret stored in `api_config` table.

- **Telegram Bot API**:
    - **Package**: `node-telegram-bot-api`.
    - **Purpose**: Send notifications and receive commands.
    - **Configuration**: Bot token and chat ID stored in `api_config` table.

- **PostgreSQL Database**:
    - **ORM**: Drizzle ORM.
    - **Connection**: Via `DATABASE_URL` environment variable.
    - **Driver**: `pg`.