# KrakenBot - Autonomous Trading Bot

## Overview

KrakenBot is an autonomous cryptocurrency trading bot that connects to the Kraken exchange. It provides a web-based dashboard for monitoring trades, managing portfolio balances (BTC, ETH, SOL, USD), and receiving notifications via Telegram. The application is designed to run 24/7, either on Replit or self-hosted on a QNAP NAS using Docker.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Routing**: Wouter (lightweight router)
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with shadcn/ui components (New York style)
- **Build Tool**: Vite with custom plugins for Replit integration
- **UI Components**: Radix UI primitives with custom dashboard components

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Runtime**: Node.js with tsx for TypeScript execution
- **Build**: esbuild for production bundling with selective dependency bundling
- **API Structure**: RESTful endpoints under `/api/*` prefix
- **Services**: 
  - KrakenService: Handles Kraken exchange API integration for trading and balance queries
  - TelegramService: Sends notifications for trades and system status

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema Location**: `shared/schema.ts`
- **Tables**: 
  - `bot_config`: Trading bot settings (strategy, risk level, active pairs)
  - `api_config`: API credentials for Kraken and Telegram
  - `trades`: Trade history and execution records
  - `notifications`: Telegram notification queue
  - `market_data`: Price and market information cache

### Project Structure
```
├── client/           # React frontend
│   ├── src/
│   │   ├── components/   # UI components (dashboard/, ui/)
│   │   ├── pages/        # Route pages (Dashboard, Settings, History)
│   │   ├── hooks/        # Custom React hooks
│   │   └── lib/          # Utilities and query client
├── server/           # Express backend
│   ├── services/     # External service integrations (kraken.ts, telegram.ts)
│   ├── routes.ts     # API route definitions
│   ├── storage.ts    # Database access layer
│   └── db.ts         # Database connection
├── shared/           # Shared types and schema
└── migrations/       # Drizzle database migrations
```

## External Dependencies

### Kraken Exchange API
- **Package**: `node-kraken-api`
- **Purpose**: Execute trades, fetch balances, get market data
- **Configuration**: API key and secret stored in `api_config` table
- **Features**: Public ticker data, authenticated trading operations
- **Nonce Handling**: Centralized retry wrapper with 3 attempts per operation
  - Uses microsecond timestamps with monotonic increment tracking
  - Logs include endpoint name and attempt count (e.g., `[kraken] Nonce error on 'addOrder', retrying (1/3)...`)
  - Failed operations (after 3 retries) trigger Telegram alert (max 1 per 30 min)
  - Alerts can be disabled via `nonceErrorAlertsEnabled` in bot config
  - Bot stays alive after failed operations (doesn't crash)

### Telegram Bot API
- **Package**: `node-telegram-bot-api`
- **Purpose**: Send trade notifications and system status alerts
- **Configuration**: Bot token and chat ID stored in `api_config` table
- **Mode**: 
  - **Replit**: Polling desactivado (solo envía notificaciones)
  - **Docker/NAS**: Polling activado automáticamente (recibe comandos)
- **Comandos disponibles**: `/estado`, `/pausar`, `/reanudar`, `/ultimas`, `/ayuda`
- **Detección automática**: Usa `DOCKER_ENV=true` o `NODE_ENV=production` para activar polling

## Risk Management Features

### Exposure Control (NEW)
Limits how much capital can be committed in open positions:
- **maxPairExposurePct**: Maximum % of balance in a single pair (default 25%)
- **maxTotalExposurePct**: Maximum % of balance across all positions (default 60%)
- Configurable from UI in Strategies page ("Control de Exposición")
- Blocks new trades if limits would be exceeded
- Logs TRADE_BLOCKED event and sends Telegram alert

### Existing Controls
- **Stop-Loss**: Auto-sells if price drops X% from entry
- **Take-Profit**: Auto-sells if price rises X% from entry
- **Trailing Stop**: Dynamic stop-loss that follows price upward
- **Daily Loss Limit**: Pauses trading if daily losses exceed X%

### PostgreSQL Database
- **ORM**: Drizzle ORM with `drizzle-kit` for migrations
- **Connection**: Via `DATABASE_URL` environment variable
- **Driver**: `pg` (node-postgres)

### Environment Variables Required
- `DATABASE_URL`: PostgreSQL connection string
- Kraken and Telegram credentials are stored in the database after initial setup through the Settings page

## Docker Deployment (QNAP NAS)

### Log Rotation Configuration
Los contenedores tienen configurada rotación automática de logs para evitar crecimiento ilimitado:

- **App container (kraken-bot-app)**:
  - max-size: 10MB por archivo
  - max-file: 3 archivos
  - Total máximo: 30MB

- **Database container (kraken-bot-db)**:
  - max-size: 5MB por archivo
  - max-file: 2 archivos
  - Total máximo: 10MB

### Comandos útiles
```bash
# Ver logs recientes
docker logs kraken-bot-app --tail 100

# Ver logs en tiempo real
docker logs -f kraken-bot-app

# Actualizar y reiniciar
cd /share/ZFS37_DATA/share/Container/krakenbot && git pull && /share/ZFS530_DATA/.qpkg/container-station/bin/docker compose up -d --build --force-recreate
```