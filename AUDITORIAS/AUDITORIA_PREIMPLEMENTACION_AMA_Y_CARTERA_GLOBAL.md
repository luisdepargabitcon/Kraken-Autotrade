# AUDITORÍA PRE-IMPLEMENTACIÓN AMA Y CARTERA GLOBAL

**Fecha:** 2026-07-29
**Auditor:** Cascade
**Plan canónico:** `PLAN_IMPLEMENTACION_MODO_AMA.md`
**Estado del plan:** `PENDIENTE_DE_AUDITORIA` → `AUDITORIA_COMPLETADA`
**Tipo:** Read-only

---

## 1. Repositorio y Git

| Campo | Valor |
|-------|-------|
| Rama | `main` |
| HEAD | `44cd46f` |
| Origin | `origin/main` (sync) |
| Working tree tracked | Limpio (`git diff --check` sin errores) |
| Untracked | 24 archivos (auditorías previas, scripts Python, `PLAN_IMPLEMENTACION_MODO_AMA.md`, logs temporales) |
| Cambios preexistentes | Ninguno tracked modificado |

**Untracked relevantes:**
- `PLAN_IMPLEMENTACION_MODO_AMA.md` — plan maestro AMA
- `AUDITORIAS/` — outputs de auditorías grid rev-c11 (no interfieren con AMA)
- `scripts/extract_grid_audit.py`, `scripts/extract_grid_status.py` — scripts Python auxiliares
- `.cascade-check-runner.cjs` — archivo temporal de Cascade

**Conclusión:** Working tree limpio para cambios tracked. No hay conflictos con trabajo ajeno.

---

## 2. Arquitectura Frontend

### Router (`client/src/App.tsx`)

Framework: **wouter** (Switch/Route/Redirect)

Rutas actuales:
| Ruta | Componente | Estado |
|------|------------|--------|
| `/` | `NexaHome` | Activo |
| `/dca` | `InstitutionalDca` | Activo |
| `/trading` | `Strategies` | Activo |
| `/grid-isolated` | `GridIsolated` | Activo |
| `/fiscal` | `FiscoDashboard` | Activo |
| `/telegram` | `Telegram` | Activo |
| `/settings` | `Settings` | Activo |
| `/terminal` | `Terminal` | Activo |
| `/wallet` | `Wallet` | Activo |
| `/integrations` | `Integrations` | Activo |
| `/guide` | `Guide` | Activo |
| `/monitor` | `Monitor` | Activo |
| `/backups` | `Backups` | Activo |
| `/ai` | `AiMl` | Activo |
| `/autotuning` | `Autotuning` | Activo |

**AMA necesitará:**
- Nueva ruta: `/ama` → `Ama` component
- Redirect desde `/institutional-ama` → `/ama` (opcional)

### Navegación (`client/src/components/dashboard/Nav.tsx`)

Estructura: array `navItems` con `NavLink` y `NavSeparator`.

Secciones actuales:
- **TRADING:** HOME, DCA, TRADING, GRID, TERMINAL
- **ANÁLISIS:** MONITOR, CARTERA, IA/ML, FISCAL
- **SISTEMA:** TELEGRAM, APIS, SISTEMA, BACKUPS, GUÍA

**AMA necesitará:**
- Añadir `{ href: "/ama", label: "AMA", icon: ... }` en sección TRADING (después de GRID)

### Providers
- `QueryClientProvider` (React Query)
- `TooltipProvider`
- `EventsWebSocketProvider`
- `MobileTabBar` (barra inferior móvil)

### Página Wallet (`client/src/pages/Wallet.tsx`)
- Fetches: `/api/balances/all`, `/api/dashboard`, `/api/prices/portfolio`
- Multi-exchange: Kraken + RevolutX
- Tabs: All exchanges, Kraken, RevolutX
- Calcula portfolio con precios dinámicos
- **No es fuente financiera oficial** — el plan AMA especifica que el frontend no es fuente financiera

---

## 3. Arquitectura Backend

### Entry Point (`server/index.ts`)
- Express + HTTP server
- `logStreamService.initialize()` al arranque
- Body parsers: JSON (10mb), URL-encoded
- Middleware HTTP: log de requests API con duración y response JSON
- `registerRoutes(httpServer, app)` — registro modular de rutas
- `MarketDataService.cleanupOldCandles()` al arranque + scheduler 24h
- Static en producción, Vite en desarrollo
- Puerto: `process.env.PORT || 5000`
- Host: `0.0.0.0`
- Build stamp: lee `VERSION` file con commit hash

### Registro de Rutas (`server/routes.ts`)
- 1889 líneas
- `initializeWebSockets()`: `/ws/events`, `/ws/logs`
- `registerRoutes()`: registra todas las rutas modulares
- `RouterDeps` inyecta `tradingEngine`, `krakenService`, `revolutXService`
- AutoMigrationRunner: ejecuta migraciones SQL desde `db/migrations/`
- Grid SHADOW startup condicional

**Rutas modulares registradas:**
| Módulo | Función | Notas |
|--------|---------|------|
| Institutional DCA | `registerInstitutionalDcaRoutes` | Eager (antes que DB-auth check) |
| IDCA Hybrid | `registerIdcaHybridRoutes` | Eager |
| Config | `registerConfigRoutes` | |
| Trades | `registerTradesRoutes` | `/api/portfolio-summary` |
| Positions | `registerPositionsRoutes` | |
| Admin | `registerAdminRoutes` | |
| Market | `registerMarketRoutes` | `/api/balances/all`, `/api/prices/portfolio` |
| Events | `registerEventsRoutes` | |
| AI | `registerAiRoutes` | |
| FISCO | `registerFiscoRoutes` + `registerFiscoRebuildRoutes` | |
| FISCO Alerts | `registerFiscoAlertsRoutes` | |
| TimeStop | `registerTimeStopRoutes` | |
| Test | `registerTestRoutes` | |
| DryRun | `registerDryRunRoutes` | |
| Audit | `registerAuditRoutes` | Read-only |
| Grid Isolated | `registerGridIsolatedRoutes` | Try/catch |
| Backup | `registerBackupRoutes` | |
| Autotuning | `registerAutotuningRoutes` | |
| Market Metrics | `registerMarketMetricsRoutes` | |

**AMA necesitará:**
- Nuevo módulo: `registerAmaRoutes` en `server/routes/ama.routes.ts`
- Registro en `server/routes.ts` (try/catch como Grid Isolated)
- API prefix: `/api/ama/*`
- Rutas Cartera Global: `/api/portfolio/*`

### Migraciones Automáticas (`MIGRATIONS` array en `routes.ts`)
- Lista explícita de migraciones 049-072
- `AutoMigrationRunner` ejecuta cada migración SQL
- Grid SHADOW depende de migraciones exitosas

**AMA necesitará:**
- Añadir migraciones AMA al array `MIGRATIONS`
- Tablas `ama_*` y `portfolio_*` (ver sección 5)

### Storage (`server/storage.ts`)
- 3712 líneas
- Implementa `IStorage` interface
- Drizzle ORM con PostgreSQL
- Métodos principales:
  - Trades: CRUD, FIFO matching, P&L rebuild, dedupe
  - Open Positions: CRUD por pair y lotId, multi-lot
  - Portfolio: `getPortfolioRealizedPnlAggregate()` (SQL agregado)
  - Trade Fills: upsert, matching
  - Lot Matches: FIFO audit trail
  - Telegram: chats, tokens, alert rules, global config
  - AI: samples, shadow decisions, config
  - Schema health: `checkSchemaHealth()`, `runSchemaMigration()`

**AMA necesitará:**
- Extender `IStorage` con métodos AMA o crear repositorio AMA separado
- El plan sugiere `PortfolioAttributionLedger`, `GlobalCapitalReservationService` — pueden ser servicios independientes que usan `db` directamente

---

## 4. Servicios de Exchange

### Interface (`server/services/exchanges/IExchangeService.ts`)
```typescript
interface IExchangeService {
  readonly exchangeName: string;
  readonly takerFeePct: number;
  readonly makerFeePct: number;
  initialize(config: ExchangeConfig): void;
  isInitialized(): boolean;
  getBalance(): Promise<Record<string, number>>;
  getTicker(pair: string): Promise<Ticker>;
  getOHLC(pair: string, interval: number): Promise<OHLC[]>;
  placeOrder(params: { pair, type, ordertype, price?, volume, clientOrderId?, executionInstruction? }): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<boolean>;
  loadPairMetadata(pairs: string[]): Promise<void>;
  getPairMetadata(pair: string): PairMetadata | null;
  getStepSize(pair: string): number | null;
  getOrderMin(pair: string): number | null;
  hasMetadata(pair: string): boolean;
  formatPair(pair: string): string;
  normalizePairFromExchange(exchangePair: string): string;
}
```

### ExchangeFactory (`server/services/exchanges/ExchangeFactory.ts`)
- Singleton
- Gestiona `activeExchange`, `tradingExchange`, `dataExchange`
- Tipos: `'kraken' | 'revolutx'`
- Fallback: si RevolutX no inicializado → Kraken
- `getDiagnostics()` para endpoint `/api/exchange-diagnostics`

### Kraken (`server/services/kraken.ts`)
- Exchange principal para análisis
- API REST + WebSocket
- Rate limiter integrado (`krakenRateLimiter`)
- OHLC, ticker, balance, placeOrder, cancelOrder

### RevolutX (`server/services/exchanges/RevolutXService.ts`)
- Exchange para ejecución
- Autenticación Ed25519
- Circuit breaker por endpoint (3 fallos → open 5min)
- Rate limiter FIFO queue
- `placeOrder` con `post_only` y `allow_taker`
- `clientOrderId` UUID para traceability
- `getTicker` usa order book + last trades
- `getOHLC` con múltiples paths candidatos
- `getBalance` con caché
- 1434 líneas

**AMA:**
- `analysisVenue = KRAKEN` → usar `krakenService` o `ExchangeFactory.getDataExchange()`
- `executionVenue = REVOLUT_X` → usar `revolutXService` o `ExchangeFactory.getTradingExchange()`
- No fallback de ejecución a Kraken
- Maker/post-only obligatorio

---

## 5. Schema y Base de Datos

### Tablas Existentes Relevantes

| Tabla | Propósito | Campos clave |
|-------|-----------|--------------|
| `trades` | Trades ejecutados | id, tradeId, exchange, pair, type, price, amount, status, realizedPnlUsd, origin, executedByBot |
| `applied_trades` | Idempotencia de aplicación | exchange, pair, tradeId |
| `trade_fills` | Fills granulares | txid, orderId, exchange, pair, type, price, amount, cost, fee, matched |
| `open_positions` | Posiciones abiertas | lotId, exchange, pair, entryPrice, amount, qtyRemaining, qtyFilled, status, averageEntryPrice |
| `dry_run_trades` | Trades simulados | simTxid, pair, type, price, amount, reason, normalizedReason, status, realizedPnlUsd, strategyId |
| `bot_events` | Eventos del bot | type, message, data (JSONB) |
| `server_logs` | Logs del servidor | timestamp, source, level, line, isError |
| `exchange_balance_snapshots` | Snapshots de balance | exchange, pair, strategyType, balanceUsd, balanceBtc, openOrdersCount |
| `lot_matches` | FIFO matching audit | sellFillTxid, lotId, matchedQty, buyPrice, pnlNet |

### Tablas FISCO
- `fisco_*` (múltiples tablas, ver `server/services/fisco/`)
- FIFO engine, import/export, reconciliation, multi-year reports
- V2 con activation, readiness, control status

### Tablas Grid Isolated
- `grid_*` (migraciones 063-079)
- `grid_open_cycles`, `grid_range_versions`, `grid_levels`, `grid_orders`, etc.
- Circuit breaker persistence

### Tablas IDCA
- `institutional_dca_*` (migraciones 019-057)
- `institutional_dca_asset_configs`, `institutional_dca_events`, `idca_vwap_anchors`, etc.

### Tablas AMA Necesarias (Plan Sección 76)

**Cartera Global:**
- `portfolio_exchange_snapshots`
- `portfolio_ledger_entries`
- `portfolio_mode_budgets`
- `portfolio_capital_reservations`
- `portfolio_reservation_events`
- `portfolio_open_orders`
- `portfolio_reconciliation_runs`
- `portfolio_reconciliation_items`
- `portfolio_valuation_snapshots`
- `portfolio_audit_events`

**AMA:**
- `ama_user_mandates`
- `ama_resolved_policies`
- `ama_policy_versions`
- `ama_policy_approvals`
- `ama_mandate_simulations`
- `ama_scenario_results`
- `ama_cycles`
- `ama_market_snapshots`
- `ama_provider_snapshots`
- `ama_assessments`
- `ama_state_transitions`
- `ama_tranche_plans`
- `ama_tranche_plan_versions`
- `ama_tranche_candidates`
- `ama_tranche_eligibility_evaluations`
- `ama_tranches`
- `ama_sleeves`
- `ama_analysis_runs`
- `ama_action_proposals`
- `ama_order_intents`
- `ama_order_attempts`
- `ama_fills`
- `ama_trailing_state`
- `ama_audit_events`
- `ama_feature_snapshots`
- `ama_model_versions`
- `ama_parameter_sets`
- `ama_validation_reports`
- `ama_research_trials`
- `ama_ai_predictions`
- `ama_ai_drift_metrics`
- `ama_decision_manifests`

**Observabilidad:**
- `observability_events`
- `observability_event_summaries`
- `observability_retention_policies`
- `observability_retention_jobs`
- `observability_retention_job_items`
- `observability_log_fingerprints`
- `observability_disk_snapshots`
- `observability_database_snapshots`
- `observability_archives`
- `observability_legal_holds`
- `observability_event_schema_versions`

**Estrategia:** Reutilizar tablas existentes cuando proceda (trades, trade_fills, open_positions). Crear nuevas solo para dominio AMA específico.

---

## 6. Migraciones

### Estado actual
- 79 migraciones SQL en `db/migrations/`
- `AutoMigrationRunner` ejecuta lista explícita (049-072) en `routes.ts`
- `script/migrate.ts` ejecuta migraciones 001-048+ en arranque Docker
- Migraciones son idempotentes (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`)

### Migraciones AMA necesarias
- Nueva serie: `080_ama_*.sql`, `081_portfolio_*.sql`, etc.
- Deben añadirse al array `MIGRATIONS` en `routes.ts`
- No aplicar en staging sin autorización

---

## 7. Balance y Portfolio

### Endpoints actuales
| Endpoint | Función |
|----------|---------|
| `GET /api/balances/all` | Balances multi-exchange (Kraken + RevolutX) |
| `GET /api/prices/portfolio` | Precios dinámicos para assets del portfolio |
| `GET /api/portfolio-summary` | P&L realizado + no realizado, win rate, posiciones |
| `GET /api/dashboard` | Datos agregados del dashboard |

### Limitaciones actuales
- No hay distinción de capital por modo (AMA, IDCA, GRID, MOMENTUM)
- No hay presupuesto por modo (BUDGETED, DEPLOYED, RESERVED, FREE)
- No hay ledger de atribución append-only
- No hay reservas globales persistentes
- No hay registro global de órdenes abiertas
- No hay reconciliación cross-mode
- `exchange_balance_snapshots` existe pero no tiene atribución por modo
- El frontend calcula valoración — el plan exige que el backend sea fuente oficial

### AMA necesitará (Cartera Global)
- `ExchangeBalanceSnapshotService` — snapshots con total/available/held
- `PortfolioValuationService` — valoración con price types separados
- `PortfolioBudgetService` — presupuestos por modo
- `PortfolioAttributionLedger` — ledger append-only
- `GlobalCapitalReservationService` — reservas persistentes
- `GlobalOpenOrderRegistry` — registro de órdenes
- `CrossModeExecutionCoordinator` — coordinación entre modos
- `PortfolioReconciliationService` — reconciliación
- `PortfolioAuditService` — auditoría

---

## 8. Órdenes y Fills

### Flujo actual
1. `tradingEngine` decide orden → `placeOrder()` en exchange
2. `order_intents` table registra intención
3. Fill watcher consulta estado → `trade_fills` table
4. `applied_trades` para idempotencia
5. `lot_matches` para FIFO audit trail
6. `open_positions` actualiza qty

### Limitaciones para AMA
- No hay `clientOrderId` propagado consistentemente (RevolutX sí, Kraken parcial)
- No hay `logicalIntentId` ni `mode` en ordenes
- No hay `cycleId` ni `trancheId` en fills
- No hay sleeves (RECOVER_PRINCIPAL, DE_RISK, RUNNER)
- No hay pre-trade risk gate formal

### AMA necesitará
- `AmaOrderExecutor` con lifecycle: CREATED → VALIDATED → SUBMITTING → ACCEPTED → PARTIAL → COMPLETED/CANCELED/REJECTED/EXPIRED
- `AmaPreTradeRiskGate` con validaciones exhaustivas
- `AmaExecutionPlanner` que traduce proposals en executable actions
- Post-only maker-only sin taker automático

---

## 9. FISCO

### Estado actual
- FISCO V1: FIFO engine, import/export, multi-year reports
- FISCO V2: Activation service, readiness, control status, normalizer
- 21 servicios en `server/services/fisco/`
- 26 tests en `server/services/fisco/__tests__/`
- Migraciones: 015, 043-050, 059-061

### AMA y FISCO
- Todo fill AMA debe registrarse en FISCO con `mode = AMA`
- Campos: cycleId, trancheId, sleeve, logicalIntentId, venueOrderId, fillId
- No duplicar operaciones importadas
- Registros fiscales no se borran por retención operativa

---

## 10. Logging y Observabilidad

### Estado actual

| Servicio | Archivo | Función |
|----------|---------|---------|
| `logStreamService` | `server/services/logStreamService.ts` | Intercepta console.log/info/warn/error/debug, buffer en memoria, persiste via serverLogsService |
| `serverLogsService` | `server/services/serverLogsService.ts` | Buffer memoria (500 entries), batch insert DB cada 5s o 50 entries, detecta nivel por pattern |
| `botLogger` | `server/services/botLogger.ts` | Eventos de bot con tipos detallados (trading lifecycle, smart guard, grid, dry run, etc.) |
| HTTP middleware | `server/index.ts` | Log de requests API con duración y JSON response completo |

### Limitaciones
- Detección de severidad por pattern matching (no estructurado)
- Cuerpos JSON completos en logs de HTTP (redacción insuficiente)
- No hay correlation IDs ni trace context
- No hay separación logs/eventos/auditoría
- No hay retención diferenciada
- No hay sampling ni deduplicación
- `server_logs` crece sin control

### AMA necesitará (Fases 16-19)
- **Logger estructurado:** Pino con NDJSON, correlation IDs, redacción
- **Eventos de dominio:** `AMA_CYCLE_CREATED`, `AMA_FILL_CONFIRMED`, etc.
- **Auditoría protegida:** Mandatos, políticas, órdenes, fills, ledger
- **Retención:** Clases diferenciadas (EPHEMERAL, OPERATIONAL, FINANCIAL_PROTECTED, etc.)
- **Scheduler:** RetentionScheduler con lease, fencing, idempotencia
- **Capacidad:** DiskCapacityGuard, DatabaseCapacityMonitor
- **Compaction:** DataCompactionService, downsampling

---

## 11. Docker

### Producción (`docker-compose.yml`)
- PostgreSQL 16-alpine
- Node 20-alpine
- Puerto: 3000:5000
- Build inline: `npm install`, `tsx script/build.ts`, `tsx script/migrate.ts`, `npm start`
- Logging: json-file, max-size 10m, max-file 3

### Staging (`docker-compose.staging.yml`)
- PostgreSQL 16-alpine (puerto 5435)
- App construida con Dockerfile (build args: GIT_COMMIT)
- Puerto: 3020:5000
- Variables: DATABASE_URL, NODE_ENV=production, VPS_DEPLOY=true
- Volúmenes: backups, ai_models, docker.sock
- **Sin configuración de logging driver** — usa default

### Dockerfile
- Node 20-bookworm-slim
- Python 3 + scikit-learn/numpy/joblib (para AI)
- Build: `npm install`, `npm run build`
- CMD: `npx tsx script/migrate.ts && npm start`
- VERSION file con GIT_COMMIT

### AMA y Docker
- Plan sugiere logging driver: `local`, max-size 20m, max-file 5, compress true
- No editar archivos internos de Docker
- No `docker system prune`
- No borrar volúmenes

---

## 12. Componentes Compartibles y Duplicidades

### Compartibles
- `MarketDataService` — cache TTL de velas y precios (ya data-exchange agnóstico)
- `ExchangeFactory` — factory singleton para Kraken/RevolutX
- `IExchangeService` — interface común
- `botLogger` — puede extenderse con eventos AMA
- `serverLogsService` — puede migrarse a Pino progresivamente
- `logStreamService` — puede evolucionar a structured logger
- `storage` / `IStorage` — puede extenderse o usarse via repositorios

### Duplicidades a evitar
- No crear segundo `MarketDataService` — AMA usará el existente
- No crear segundo `logStreamService` — migrar a Pino
- No crear segunda bitácora — usar `BITACORA.md`
- No recrear `CORRECCIONES_Y_ACTUALIZACIONES.md`
- No duplicar tablas `trades`, `trade_fills` — reutilizar con atribución por modo

---

## 13. Datos Sin Atribuir

### Problemas identificados
- `open_positions` no tiene campo `mode` — no distingue AMA/IDCA/GRID/MOMENTUM
- `trades` no tiene campo `mode` — no atribución por estrategia
- `exchange_balance_snapshots` tiene `strategyType` pero uso limitado
- No hay ledger de atribución de inventario
- Capital disponible no se distingue por modo

### Riesgos
- AMA podría vender inventario de IDCA o GRID sin saberlo
- Doble reserva de capital
- Doble conteo en valoración
- Falta de reconciliación cross-mode

### Plan AMA aborda esto con:
- `PortfolioAttributionLedger` (append-only, inmutable)
- Atribución: `exchange + asset + mode`
- Cada modo solo vende inventario atribuido
- `GlobalCapitalReservationService` — reservas persistentes
- `CrossModeExecutionCoordinator` — coordinación

---

## 14. Histórico de Mercado

### Estado actual
- `MarketDataService` cachea velas en memoria con TTL
- `market_candles_cache` table (migración 037) — persistencia de velas
- Kraken OHLC como fuente principal
- No hay downsampling ni compactación
- No hay retención diferenciada por timeframe

### AMA necesita
- Histórico diario y semanal suficiente para bootstrap HWM
- Point-in-time data service para replay
- No borrar datos necesarios para bootstrap, HWM, replay, walk-forward, holdout
- Semanas reconstruidas desde días verificados

---

## 15. Riesgos Identificados

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Sin atribución de inventario por modo | ALTO | PortfolioAttributionLedger antes de cualquier ejecución |
| Sin presupuesto por modo | ALTO | PortfolioBudgetService en Fase 3 |
| Frontend como fuente financiera | MEDIO | Migrar a API global como fuente oficial |
| Logs sin estructura ni retención | MEDIO | Pino + retención diferenciada (Fases 16-19) |
| Sin reconciliación cross-mode | ALTO | PortfolioReconciliationService |
| Sin pre-trade risk gate | ALTO | AmaPreTradeRiskGate antes de executor |
| Migraciones en staging sin autorización | ALTO | No aplicar migraciones en VPS sin autorización |
| Sin point-in-time data | MEDIO | AmaPointInTimeDataService para replay |
| Docker staging sin log rotation | BAJO | Configurar logging driver en staging |
| Sin kill switch AMA | ALTO | Implementar en Fase 25 |

---

## 16. Componentes Compartidos a Crear

| Componente | Ubicación propuesta | Fase |
|------------|---------------------|------|
| AMA types | `server/services/ama/amaTypes.ts` | 1 |
| AMA routes | `server/routes/ama.routes.ts` | 1 |
| Portfolio types | `server/services/portfolio/portfolioTypes.ts` | 3 |
| Portfolio routes | `server/routes/portfolio.routes.ts` | 3 |
| Structured logger | `server/services/observability/structuredLogger.ts` | 16 |
| Event schema registry | `server/services/observability/eventSchemaRegistry.ts` | 17 |
| Retention scheduler | `server/services/observability/retentionScheduler.ts` | 18 |

---

## 17. Próximas Acciones

1. **Fase 1 — Contratos y dominio:** Identidad AMA, rutas, APIs, estados, flags
2. **Fase 2 — Calidad de datos:** Point-in-time, anomalías, timestamps
3. **Fase 3 — Cartera Global backend:** Snapshots, valoración, presupuestos, API
4. **Fase 4 — Ledger y atribución:** Movimientos, inventario, reconciliación
5. **Fase 5 — Reservas y coordinación:** Reservas, órdenes, locks, idempotencia

---

## REGISTRO DE ESTADO

```text
DONE: TRUE
HARD_BLOCKER: FALSE
TASK_STATUS: AUDITORIA_COMPLETADA
NEXT_ACTION: Iniciar Fase 1 — Contratos y dominio
LAST_COMPLETED_ACTION: Auditoría preimplementación AMA
LAST_VALIDATION: git diff --check (limpio), git status (sin cambios tracked)
UPDATED_AT: 2026-07-29
```
