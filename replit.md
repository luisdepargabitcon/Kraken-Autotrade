# KrakenBot - Autonomous Trading Bot

## Overview
KrakenBot is an autonomous cryptocurrency trading bot designed for the Kraken exchange. It features a web-based dashboard for monitoring trades, managing cryptocurrency portfolio balances (BTC, ETH, SOL, USD), and receiving real-time notifications via Telegram. The application is built for 24/7 operation, supporting deployment on Replit or self-hosting via Docker on a QNAP NAS. Its core purpose is to automate trading decisions based on predefined strategies and robust risk management, aiming to capitalize on market movements while protecting capital.

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

### Backend
- **Framework**: Express.js with TypeScript.
- **Runtime**: Node.js.
- **API**: RESTful endpoints (`/api/*`).
- **Services**: KrakenService for exchange interaction, TelegramService for notifications.

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Defined in `shared/schema.ts`.
- **Key Tables**: `bot_config` (trading settings), `api_config` (credentials), `trades` (history), `notifications` (queue), `open_positions` (persistent open trades).

### Trading Engine
- **Core Loop**: Executes every 10-30 seconds, including balance checks, daily resets, stop-loss/take-profit evaluations, and strategy analysis.
- **Strategies**: Momentum, Mean Reversion, Scalping, Grid Trading.
- **Multi-Timeframe Analysis (MTF)**: Analyzes 5-min, 1-hour, and 4-hour trends to filter trade signals.
- **Trade Execution**: Market orders, database logging, position updates, Telegram notifications.

### Risk Management
- **Commission Profitability Filter**: Ensures trades are profitable after Kraken fees (min 1.04% take-profit).
- **Exposure Control**: Limits capital exposure per pair (25%) and total (60%), and risk per trade (15%). Dynamically adjusts trade size based on available exposure.
- **Stop-Loss/Take-Profit**: Automatic position closing based on price deviation.
- **Trailing Stop**: Dynamic stop-loss that follows price appreciation.
- **Daily Loss Limit**: Pauses new purchases if daily losses exceed a configured percentage (default 10%).
- **Cooldown System**: Implements cooldown periods (e.g., 15 min for no exposure, 30 min post Stop-Loss) to prevent rapid re-entry into losing conditions.
- **Defensive Filters**:
    - **Bid-Ask Spread**: Avoids trades if spread > 0.5%.
    - **Trading Hours**: Operates between 8:00 and 22:00 UTC to avoid low-volume periods.
    - **Dynamic Position Sizing**: Adjusts trade amount based on signal confidence (e.g., 100% for >80% confidence, 50% for 60-69%).
    - **Real Balance Verification**: Prevents "Insufficient funds" errors by verifying actual Kraken balances before selling and rectifying discrepancies.
- **Kraken Minimums**: Adheres to Kraken's minimum trade volumes for each asset.
- **Position Persistence**: Open positions are stored in the database to survive bot restarts.

### Telegram Integration
- **Modes**: Polling activated for Docker/NAS deployments (receiving commands), disabled for Replit (sending notifications only).
- **Commands (Docker/NAS)**: `/estado`, `/pausar`, `/reanudar`, `/ultimas`, `/ayuda`.
- **Notifications**: Comprehensive alerts for bot status, trade executions, stop-loss/take-profit events, risk management triggers, and errors.
- **Rate Limiting**: Prevents alert spam (e.g., max 1 exposure alert per 30 mins).
- **Multi-Chat Support**: Sends notifications to multiple configured Telegram chats.

## External Dependencies

- **Kraken Exchange API**:
    - **Package**: `node-kraken-api`.
    - **Purpose**: Trading operations (execute, fetch balances, market data).
    - **Configuration**: API key/secret stored in `api_config` table.
    - **Nonce Handling**: Centralized retry mechanism (3 attempts) with Telegram alerts for persistent failures.

- **Telegram Bot API**:
    - **Package**: `node-telegram-bot-api`.
    - **Purpose**: Send notifications and receive commands.
    - **Configuration**: Bot token and chat ID stored in `api_config` table.

- **PostgreSQL Database**:
    - **ORM**: Drizzle ORM.
    - **Connection**: Via `DATABASE_URL` environment variable.
    - **Driver**: `pg`.