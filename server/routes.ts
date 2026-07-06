import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { krakenService } from "./services/kraken";
import { revolutXService } from "./services/exchanges/RevolutXService";
import { telegramService } from "./services/telegram";
import { botLogger } from "./services/botLogger";
import { TradingEngine } from "./services/tradingEngine";
import { eventsWs } from "./services/eventsWebSocket";
import { terminalWsServer } from "./services/terminalWebSocket";
import { environment } from "./services/environment";
import { registerConfigRoutes } from "./routes/config";
import { ExchangeFactory } from "./services/exchanges/ExchangeFactory";
import { MarketDataService } from "./services/MarketDataService";
import { krakenRateLimiter } from "./utils/krakenRateLimiter";
import { z } from "zod";
import { errorAlertService } from "./services/ErrorAlertService";
import cron from "node-cron";
import http from "http";
import type { RouterDeps } from "./routes/types";
import { runIdcaHistoricalDuplicateCleanupOnce } from "./services/institutionalDca/IdcaHistoricalDuplicateCleanupService";
import { AutoMigrationRunner } from "./services/AutoMigrationRunner";
import { ensureFiscoV2Schema } from "./services/fisco/FiscoV2SchemaEnsureService";
import { db } from "./db";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

let tradingEngine: TradingEngine | null = null;


export function initializeWebSockets(httpServer: Server): void {
  eventsWs.initialize(httpServer);
  terminalWsServer.initialize(httpServer);
  
  httpServer.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url || "", `http://${req.headers.host}`).pathname;
    
    if (pathname === "/ws/events") {
      eventsWs.handleUpgrade(req, socket, head);
    } else if (pathname === "/ws/logs") {
      terminalWsServer.handleUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Shared dependencies for modular route files
  const routerDeps: RouterDeps = {
    tradingEngine,
    getTradingEngine: () => tradingEngine,
    setTradingEngine: (engine: TradingEngine) => { tradingEngine = engine; },
    krakenService,
    revolutxService: revolutXService,
  };

  // Health check endpoint - MUST be registered before any other routes
  // Returns JSON for monitoring/load balancers (not index.html)
  // Returns 503 on errors so monitors can detect failures
  app.get("/api/health", async (req, res) => {
    try {
      const schemaStatus = await storage.checkSchemaHealth();
      if (!schemaStatus.healthy) {
        // Schema issues - return 503 so monitors detect the problem
        return res.status(503).json({
          status: "unhealthy",
          timestamp: new Date().toISOString(),
          schema: schemaStatus,
          uptime: process.uptime(),
          message: "Schema migration required. Missing columns: " + schemaStatus.missingColumns.join(", "),
        });
      }
      res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        schema: schemaStatus,
        uptime: process.uptime(),
      });
    } catch (error) {
      // Return 503 on errors so monitors can detect failures
      res.status(503).json({
        status: "error",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Diagnostic endpoint for exchange private API coordination
  app.get("/api/exchange-diagnostics", (req, res) => {
    try {
      res.json(ExchangeFactory.getDiagnostics());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Market data cache diagnostics
  app.get("/api/market-data/stats", (_req, res) => {
    try {
      res.json(MarketDataService.getStats());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Kraken rate limiter diagnostics
  app.get("/api/rate-limiter/stats", (_req, res) => {
    try {
      res.json(krakenRateLimiter.getState());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Full KrakenRL diagnostics — origin breakdown, event history, error summary
  app.get("/api/diagnostics/kraken-rate-limit", (_req, res) => {
    try {
      const state = krakenRateLimiter.getState();
      const origins = krakenRateLimiter.getOriginStats();
      const limitParam = Math.min(parseInt((_req.query.limit as string) || '50', 10), 200);
      const recentEvents = krakenRateLimiter.getHistory(limitParam);
      const recentErrors = recentEvents.filter(e => e.type === 'error' || e.type === 'ratelimit');

      res.json({
        timestamp: new Date().toISOString(),
        state,
        ...origins,
        recentErrors,
        recentEvents,
        note: "read-only diagnostic endpoint — no state mutation",
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Register IDCA routes eagerly — must happen before DB-auth check so routes
  // are available even when API credentials load fails (e.g. local dev DB mismatch)
  try {
    const { registerInstitutionalDcaRoutes } = await import('./routes/institutionalDca.routes');
    registerInstitutionalDcaRoutes(app);
    console.log('[startup] Institutional DCA routes registered');
  } catch (e: any) {
    console.error('[startup] Failed to register Institutional DCA routes:', e?.message || e);
  }

  // Register IDCA Hybrid Intelligent Layers routes
  try {
    const { registerIdcaHybridRoutes } = await import('./routes/idcaHybrid.routes');
    registerIdcaHybridRoutes(app);
    console.log('[startup] IDCA Hybrid routes registered');
  } catch (e: any) {
    console.error('[startup] Failed to register IDCA Hybrid routes:', e?.message || e);
  }

  // Proactive schema migration — ensure new columns exist before IDCA queries
  try {
    const migrationResult = await storage.runSchemaMigration();
    if (migrationResult.columnsAdded.length > 0) {
      console.log(`[startup] Auto-migration: added ${migrationResult.columnsAdded.join(', ')}`);
    }
  } catch (e: any) {
    console.error('[startup] Auto-migration error (non-fatal):', e?.message || e);
  }

  // AutoMigrationRunner — execute SQL migrations from db/migrations
  try {
    let migrationsDir: string;
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
    } catch {
      migrationsDir = path.resolve(process.cwd(), 'db', 'migrations');
    }

    if (!fs.existsSync(migrationsDir)) {
      console.log('[startup] AutoMigrationRunner skipped: migrations directory not found');
    } else {
      console.log(`[startup] AutoMigrationRunner using migrations dir: ${migrationsDir}`);
      const runner = new AutoMigrationRunner(db.$client);
      const migrations = [
        { id: '049_telegram_alert_dedupe', filePath: path.join(migrationsDir, '049_telegram_alert_dedupe.sql') },
        { id: '052_smart_exit_state', filePath: path.join(migrationsDir, '052_smart_exit_state.sql') },
        { id: '053_add_telegram_alert_config_to_bot_config', filePath: path.join(migrationsDir, '053_add_telegram_alert_config_to_bot_config.sql') },
        { id: '056_ai_shadow_decisions', filePath: path.join(migrationsDir, '056_ai_shadow_decisions.sql') },
        { id: '057_idca_hybrid_intelligent_layers', filePath: path.join(migrationsDir, '057_idca_hybrid_intelligent_layers.sql') },
        { id: '058_ai_effective_decision_context', filePath: path.join(migrationsDir, '058_ai_effective_decision_context.sql') },
        { id: '059_fisco_v2_import_config', filePath: path.join(migrationsDir, '059_fisco_v2_import_config.sql') },
        { id: '060_idca_hybrid_grid_traceability', filePath: path.join(migrationsDir, '060_idca_hybrid_grid_traceability.sql') },
        { id: '061_audit_tables', filePath: path.join(migrationsDir, '061_audit_tables.sql') },
        { id: '062_capital_efficiency_gate', filePath: path.join(migrationsDir, '062_capital_efficiency_gate.sql') },
        { id: '063_grid_isolated', filePath: path.join(migrationsDir, '063_grid_isolated.sql') },
        { id: '064_grid_wallet_execution', filePath: path.join(migrationsDir, '064_grid_wallet_execution.sql') },
        { id: '065_telegram_global_config', filePath: path.join(migrationsDir, '065_telegram_global_config.sql') },
      ];

      await runner.run(migrations);
      console.log('[startup] AutoMigrationRunner completed');
    }
  } catch (e: any) {
    console.error('[startup] AutoMigrationRunner error (non-fatal):', e?.message || e);
  }

  // FISCO V2 Schema Ensure — inline SQL, no file dependency
  // This runs AFTER AutoMigrationRunner as a belt-and-suspenders approach.
  // Even if the .sql file isn't in the container, this inline SQL will create the tables.
  try {
    await ensureFiscoV2Schema();
  } catch (e: any) {
    console.error('[startup] FISCO V2 schema ensure error (non-fatal):', e?.message || e);
  }

  // Load saved API credentials on startup
  try {
    const apiConfig = await storage.getApiConfig();
    if (apiConfig) {
      // Initialize ExchangeFactory with all exchange credentials
      await ExchangeFactory.initializeFromConfig({
        krakenApiKey: apiConfig.krakenApiKey ?? undefined,
        krakenApiSecret: apiConfig.krakenApiSecret ?? undefined,
        krakenEnabled: apiConfig.krakenEnabled ?? true,
        revolutxApiKey: apiConfig.revolutxApiKey ?? undefined,
        revolutxPrivateKey: apiConfig.revolutxPrivateKey ?? undefined,
        revolutxEnabled: apiConfig.revolutxEnabled ?? false,
        activeExchange: (apiConfig.activeExchange as "kraken" | "revolutx") ?? "kraken",
        tradingExchange: ((apiConfig as any).tradingExchange as "kraken" | "revolutx") ?? "kraken",
        dataExchange: ((apiConfig as any).dataExchange as "kraken" | "revolutx") ?? "kraken",
      });
      console.log(`[startup] ExchangeFactory initialized. Active: ${ExchangeFactory.getActiveExchangeType()}`);
      
      if (apiConfig.krakenApiKey && apiConfig.krakenApiSecret && apiConfig.krakenConnected) {
        krakenService.initialize({
          apiKey: apiConfig.krakenApiKey,
          apiSecret: apiConfig.krakenApiSecret,
        });
        console.log("[startup] Kraken API credentials loaded from database");
      }
      if (apiConfig.telegramToken && apiConfig.telegramChatId && apiConfig.telegramConnected) {
        telegramService.initialize({
          token: apiConfig.telegramToken,
          chatId: apiConfig.telegramChatId,
        });
        console.log("[startup] Telegram credentials loaded from database");
      }
    }
    
    // Initialize trading engine
    tradingEngine = new TradingEngine(krakenService, telegramService);
    
    // Set engine controller for Telegram commands
    telegramService.setEngineController({
      start: async () => { await tradingEngine?.start(); },
      stop: async () => { await tradingEngine?.stop(); },
      isActive: () => tradingEngine?.isActive() ?? false,
      getBalance: async () => krakenService.isInitialized() ? await krakenService.getBalanceRaw() : {},
      getOpenPositions: () => tradingEngine?.getOpenPositions() ?? new Map(),
    });
    
    // Start heartbeat for Telegram notifications
    telegramService.startHeartbeat();
    
    // Start daily report scheduler (14:00 Europe/Madrid)
    telegramService.startDailyReport();

    // Inyectar telegramService global en ErrorAlertService para evitar conflictos 409
    errorAlertService.setTelegramService(telegramService);
    console.log("[startup] TelegramService injected into ErrorAlertService");

    // RevolutX daily sync scheduler (default: 02:00 UTC)
    try {
      const revolutxCron = process.env.REVOLUTX_DAILY_SYNC_CRON || '0 2 * * *';
      const revolutxTz = process.env.REVOLUTX_DAILY_SYNC_TZ || 'UTC';

      const postJson = async (urlRaw: string, body: any) => {
        const f = (globalThis as any).fetch as undefined | ((...args: any[]) => Promise<any>);
        if (typeof f === 'function') {
          await f(urlRaw, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          return;
        }

        const u = new URL(urlRaw);
        const payload = Buffer.from(JSON.stringify(body));

        await new Promise<void>((resolve, reject) => {
          const req = http.request(
            {
              hostname: u.hostname,
              port: u.port ? Number(u.port) : 80,
              path: u.pathname + u.search,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': payload.length,
              },
            },
            (resp) => {
              resp.on('data', () => undefined);
              resp.on('end', () => resolve());
            }
          );
          req.on('error', reject);
          req.write(payload);
          req.end();
        });
      };

      cron.schedule(
        revolutxCron,
        async () => {
          try {
            if (!revolutXService.isInitialized()) return;
            const port = parseInt(process.env.PORT || '5000', 10);
            const url = `http://127.0.0.1:${port}/api/trades/sync-revolutx`;
            await postJson(url, {});
          } catch (e: any) {
            console.error('[revolutx-daily-sync] Error:', e?.message || e);
          }
        },
        { timezone: revolutxTz }
      );
      console.log(`[startup] RevolutX daily sync scheduled: ${revolutxCron} (${revolutxTz})`);
    } catch (e: any) {
      console.error('[startup] Failed to schedule RevolutX daily sync:', e?.message || e);
    }
    
    // Inicializar FiscoKrakenRetryWorker (tick cada minuto)
    try {
      const { fiscoKrakenRetryWorker } = await import('./services/FiscoKrakenRetryWorker');
      fiscoKrakenRetryWorker.initialize();
    } catch (e: any) {
      console.error('[startup] Failed to initialize FiscoKrakenRetryWorker:', e?.message || e);
    }

    // Inicializar LogRetentionScheduler (purga automática diaria de server_logs y bot_events)
    try {
      const { logRetentionScheduler } = await import('./services/LogRetentionScheduler');
      logRetentionScheduler.initialize();
    } catch (e: any) {
      console.error('[startup] Failed to initialize LogRetentionScheduler:', e?.message || e);
    }
    
    // Auto-start if bot was active
    const botConfig = await storage.getBotConfig();
    if (botConfig?.isActive && krakenService.isInitialized()) {
      console.log("[startup] Starting trading engine...");
      tradingEngine.start();
    }

    // IDCA Scheduler auto-start (routes already registered above)
    try {
      const { IdcaRepository, IdcaEngine } = await import('./services/institutionalDca');
      const idcaControls = await IdcaRepository.getTradingEngineControls();
      const idcaConfig = await IdcaRepository.getIdcaConfig();
      if (idcaControls.institutionalDcaEnabled && idcaConfig.mode !== 'disabled' && !idcaControls.globalTradingPause) {
        console.log('[startup] Starting Institutional DCA scheduler...');
        await IdcaEngine.startScheduler();
      } else {
        console.log('[startup] Institutional DCA module idle (toggle off or mode disabled)');
      }
    } catch (e: any) {
      console.error('[startup] Failed to start Institutional DCA scheduler:', e?.message || e);
    }
  } catch (error) {
    console.error("[startup] Error loading API credentials:", error);
  }

  app.get("/api/config", async (req, res) => {
    try {
      const config = await storage.getBotConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to get config" });
    }
  });

  app.post("/api/config", async (req, res) => {
    try {
      const body = { ...req.body };
      
      // Validar y clampar porcentajes a rango 0-100
      const pctFields = ["riskPerTradePct", "maxPairExposurePct", "maxTotalExposurePct"];
      for (const field of pctFields) {
        if (body[field] !== undefined) {
          const val = parseFloat(body[field]);
          if (isNaN(val)) {
            return res.status(400).json({ error: `${field} debe ser un número válido` });
          }
          if (val < 0 || val > 100) {
            return res.status(400).json({ error: `${field} debe estar entre 0 y 100 (valor recibido: ${val})` });
          }
          body[field] = val.toFixed(2);
        }
      }
      
      const updated = await storage.updateBotConfig(body);
      
      if (req.body.isActive !== undefined && tradingEngine) {
        if (req.body.isActive) {
          await tradingEngine.start();
        } else {
          await tradingEngine.stop();
        }
      }
      
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update config" });
    }
  });

  app.get("/api/config/api", async (req, res) => {
    try {
      const config = await storage.getApiConfig();
      const activeEx = config?.activeExchange || "kraken";
      res.json({
        krakenConnected: config?.krakenConnected || false,
        krakenEnabled: config?.krakenEnabled ?? true,
        revolutxConnected: config?.revolutxConnected || false,
        revolutxEnabled: config?.revolutxEnabled || false,
        activeExchange: activeEx,
        tradingExchange: config?.tradingExchange || activeEx,
        dataExchange: "kraken",
        telegramConnected: config?.telegramConnected || false,
        hasKrakenKeys: !!(config?.krakenApiKey && config?.krakenApiSecret),
        hasRevolutxKeys: !!(config?.revolutxApiKey && config?.revolutxPrivateKey),
        hasTelegramKeys: !!(config?.telegramToken && config?.telegramChatId),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get API config" });
    }
  });

  app.get("/api/trading/status", async (req, res) => {
    try {
      res.json({
        engineRunning: tradingEngine?.isActive() || false,
        krakenConnected: krakenService.isInitialized(),
        telegramConnected: telegramService.isInitialized(),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get trading status" });
    }
  });

  // === DIAGNÓSTICO DEL SCAN ===
  app.get("/api/scan/diagnostic", async (req, res) => {
    try {
      if (!tradingEngine) {
        return res.status(503).json({ error: "Motor de trading no inicializado" });
      }
      const diagnostic = await tradingEngine.getScanDiagnostic();
      res.json(diagnostic);
    } catch (error: any) {
      console.error("[scan/diagnostic] Error:", error.message);
      res.status(500).json({ error: "Error obteniendo diagnóstico del scan" });
    }
  });

  app.post("/api/config/kraken", async (req, res) => {
    try {
      const { apiKey, apiSecret } = req.body;
      
      if (!apiKey || !apiSecret) {
        return res.status(400).json({ error: "API key and secret required" });
      }

      krakenService.initialize({ apiKey, apiSecret });
      
      const balance = await krakenService.getBalance();
      
      await storage.updateApiConfig({
        krakenApiKey: apiKey,
        krakenApiSecret: apiSecret,
        krakenConnected: true,
      });
      
      res.json({ success: true, message: "Kraken connected successfully", balance });
    } catch (error) {
      await storage.updateApiConfig({ krakenConnected: false });
      res.status(500).json({ error: "Failed to connect to Kraken" });
    }
  });

  app.post("/api/config/revolutx", async (req, res) => {
    try {
      const { apiKey, privateKey } = req.body;
      
      if (!apiKey || !privateKey) {
        return res.status(400).json({ error: "API key and private key required" });
      }

      await storage.updateApiConfig({
        revolutxApiKey: apiKey,
        revolutxPrivateKey: privateKey,
        revolutxConnected: true,
        revolutxEnabled: true,
      });
      
      res.json({ success: true, message: "Revolut X credentials saved successfully" });
    } catch (error) {
      await storage.updateApiConfig({ revolutxConnected: false });
      res.status(500).json({ error: "Failed to save Revolut X credentials" });
    }
  });

  app.post("/api/config/active-exchange", async (req, res) => {
    try {
      const { activeExchange } = req.body;
      
      if (!activeExchange || !["kraken", "revolutx"].includes(activeExchange)) {
        return res.status(400).json({ error: "Invalid exchange. Must be 'kraken' or 'revolutx'" });
      }

      const config = await storage.getApiConfig();
      
      if (activeExchange === "kraken" && !config?.krakenConnected) {
        return res.status(400).json({ error: "Kraken no está conectado. Configura las credenciales primero." });
      }
      
      if (activeExchange === "revolutx" && !config?.revolutxConnected) {
        return res.status(400).json({ error: "Revolut X no está conectado. Configura las credenciales primero." });
      }

      // Update ExchangeFactory runtime state
      try {
        ExchangeFactory.setActiveExchange(activeExchange);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }

      // IMPORTANT: Data exchange is ALWAYS Kraken (better API for OHLC data)
      // Only trading exchange changes when activating a different exchange
      await storage.updateApiConfig({ 
        activeExchange,
        tradingExchange: activeExchange,
        dataExchange: 'kraken'  // Always Kraken for market data
      });
      
      console.log(`[exchange] Active exchange changed to: ${activeExchange}`);
      res.json({ success: true, activeExchange });
    } catch (error) {
      res.status(500).json({ error: "Failed to change active exchange" });
    }
  });

  app.post("/api/config/telegram", async (req, res) => {
    try {
      const { token, chatId } = req.body;
      
      if (!token || !chatId) {
        return res.status(400).json({ error: "Token and chat ID required" });
      }

      telegramService.initialize({ token, chatId });
      
      const sent = await telegramService.sendMessage("✅ Telegram conectado correctamente!");
      
      if (!sent) {
        return res.status(500).json({ error: "Failed to send test message" });
      }
      
      await storage.updateApiConfig({
        telegramToken: token,
        telegramChatId: chatId,
        telegramConnected: true,
      });
      
      res.json({ success: true, message: "Telegram connected successfully" });
    } catch (error) {
      await storage.updateApiConfig({ telegramConnected: false });
      res.status(500).json({ error: "Failed to connect to Telegram" });
    }
  });

  // === SMART_GUARD Per-Pair Overrides ===
  const SG_OVERRIDE_SCHEMA = z.object({
    sgMinEntryUsd: z.number().min(0).max(100000).optional(),
    sgAllowUnderMin: z.boolean().optional(),
    sgBeAtPct: z.number().min(0).max(100).optional(),
    sgFeeCushionPct: z.number().min(0).max(10).optional(),
    sgFeeCushionAuto: z.boolean().optional(),
    sgTrailStartPct: z.number().min(0).max(100).optional(),
    sgTrailDistancePct: z.number().min(0).max(50).optional(),
    sgTrailStepPct: z.number().min(0).max(10).optional(),
    sgTpFixedEnabled: z.boolean().optional(),
    sgTpFixedPct: z.number().min(0).max(500).optional(),
    sgScaleOutEnabled: z.boolean().optional(),
    sgScaleOutPct: z.number().min(0).max(100).optional(),
    sgMinPartUsd: z.number().min(0).max(10000).optional(),
    sgScaleOutThreshold: z.number().min(0).max(100).optional(),
  });

  const TRADEABLE_PAIRS = ["BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD", "TON/USD"];

  app.get("/api/config/sg-overrides", async (req, res) => {
    try {
      const config = await storage.getBotConfig();
      const overrides = (config?.sgPairOverrides as Record<string, unknown>) || {};
      res.json({
        pairs: TRADEABLE_PAIRS,
        overrides,
        global: {
          sgMinEntryUsd: config?.sgMinEntryUsd,
          sgAllowUnderMin: config?.sgAllowUnderMin,
          sgBeAtPct: config?.sgBeAtPct,
          sgFeeCushionPct: config?.sgFeeCushionPct,
          sgFeeCushionAuto: config?.sgFeeCushionAuto,
          sgTrailStartPct: config?.sgTrailStartPct,
          sgTrailDistancePct: config?.sgTrailDistancePct,
          sgTrailStepPct: config?.sgTrailStepPct,
          sgTpFixedEnabled: config?.sgTpFixedEnabled,
          sgTpFixedPct: config?.sgTpFixedPct,
          sgScaleOutEnabled: config?.sgScaleOutEnabled,
          sgScaleOutPct: config?.sgScaleOutPct,
          sgMinPartUsd: config?.sgMinPartUsd,
          sgScaleOutThreshold: config?.sgScaleOutThreshold,
        },
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get SG overrides" });
    }
  });

  app.put("/api/config/sg-overrides/:pair", async (req, res) => {
    try {
      // Normalize pair: accept both BTC-USD and BTC/USD in URL
      const pairRaw = decodeURIComponent(req.params.pair).replace(/-/g, "/");
      if (!TRADEABLE_PAIRS.includes(pairRaw)) {
        return res.status(400).json({ error: `Par inválido: ${pairRaw}` });
      }

      // Coerce string values to numbers where expected
      const body = { ...req.body };
      for (const key of Object.keys(body)) {
        if (typeof body[key] === "string" && !["sgAllowUnderMin", "sgFeeCushionAuto", "sgTpFixedEnabled", "sgScaleOutEnabled"].includes(key)) {
          const num = parseFloat(body[key]);
          if (!isNaN(num)) body[key] = num;
        }
      }

      const parsed = SG_OVERRIDE_SCHEMA.safeParse(body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Datos inválidos", details: parsed.error.flatten() });
      }

      const config = await storage.getBotConfig();
      const currentOverrides = (config?.sgPairOverrides as Record<string, unknown>) || {};
      const existingPair = (currentOverrides[pairRaw] as Record<string, unknown>) || {};
      
      // Merge with existing override for this pair
      const newPairOverride = { ...existingPair, ...parsed.data };
      const newOverrides = { ...currentOverrides, [pairRaw]: newPairOverride };

      await storage.updateBotConfig({ sgPairOverrides: newOverrides });

      // Log the change
      const envInfo = environment.getInfo();
      await botLogger.info("CONFIG_OVERRIDE_UPDATED", `Override actualizado para ${pairRaw}`, {
        pair: pairRaw,
        changedKeys: Object.keys(parsed.data),
        env: envInfo.env,
        instanceId: envInfo.instanceId,
      });

      res.json({ success: true, pair: pairRaw, override: newPairOverride });
    } catch (error) {
      res.status(500).json({ error: "Failed to update SG override" });
    }
  });

  app.delete("/api/config/sg-overrides/:pair", async (req, res) => {
    try {
      // Normalize pair: accept both BTC-USD and BTC/USD in URL
      const pairRaw = decodeURIComponent(req.params.pair).replace(/-/g, "/");
      if (!TRADEABLE_PAIRS.includes(pairRaw)) {
        return res.status(400).json({ error: `Par inválido: ${pairRaw}` });
      }

      const config = await storage.getBotConfig();
      const currentOverrides = (config?.sgPairOverrides as Record<string, unknown>) || {};
      
      if (!(pairRaw in currentOverrides)) {
        return res.status(404).json({ error: `No hay override para ${pairRaw}` });
      }

      const { [pairRaw]: removed, ...newOverrides } = currentOverrides;
      await storage.updateBotConfig({ sgPairOverrides: newOverrides });

      // Log the change
      const envInfo = environment.getInfo();
      await botLogger.info("CONFIG_OVERRIDE_UPDATED", `Override eliminado para ${pairRaw}`, {
        pair: pairRaw,
        changedKeys: ["DELETED"],
        env: envInfo.env,
        instanceId: envInfo.instanceId,
      });

      res.json({ success: true, pair: pairRaw, message: "Override eliminado" });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete SG override" });
    }
  });

  app.post("/api/telegram/send", async (req, res) => {
    try {
      const { message } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: "Mensaje requerido" });
      }

      if (!telegramService.isInitialized()) {
        return res.status(400).json({ error: "Telegram no está configurado" });
      }

      const sent = await telegramService.sendMessage(message);
      
      if (!sent) {
        return res.status(500).json({ error: "Error enviando mensaje" });
      }
      
      res.json({ success: true, message: "Mensaje enviado" });
    } catch (error) {
      res.status(500).json({ error: "Error enviando mensaje a Telegram" });
    }
  });

  app.get("/api/telegram/chats", async (req, res) => {
    try {
      const chats = await storage.getTelegramChats();
      res.json(chats);
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo chats" });
    }
  });

  app.post("/api/telegram/chats", async (req, res) => {
    try {
      const { name, chatId, alertTrades, alertErrors, alertSystem, alertBalance, alertHeartbeat, alertPreferences, tokenId, enabledModes, enabledAlerts } = req.body;

      if (!name || !chatId) {
        return res.status(400).json({ error: "Nombre y Chat ID son requeridos" });
      }

      // Validar tokenId si se proporciona
      if (tokenId !== undefined && tokenId !== null) {
        const token = await storage.getTelegramBotTokenById(tokenId);
        if (!token || !token.isActive) {
          return res.status(400).json({ error: "Token no encontrado o inactivo" });
        }
      }

      const existingChats = await storage.getTelegramChats();
      const duplicate = existingChats.find(c => c.chatId === chatId);
      if (duplicate) {
        return res.status(400).json({ error: "Este Chat ID ya está configurado." });
      }

      const testSent = await telegramService.sendToChat(chatId, "✅ Chat configurado correctamente en KrakenBot!");
      if (!testSent) {
        return res.status(400).json({ error: "No se pudo enviar mensaje al chat. Verifica el Chat ID." });
      }

      const prefs = alertPreferences || {};
      const derivedTrades = alertTrades ?? (prefs.trade_buy !== false || prefs.trade_sell !== false);
      const derivedErrors = alertErrors ?? (prefs.error_api !== false || prefs.error_nonce !== false);
      const derivedSystem = alertSystem ?? (prefs.system_bot_started !== false || prefs.system_bot_paused !== false);
      const derivedBalance = alertBalance ?? (prefs.balance_exposure === true);
      const derivedHeartbeat = alertHeartbeat ?? (prefs.heartbeat_periodic === true);

      const chat = await storage.createTelegramChat({
        name,
        chatId,
        isDefault: existingChats.length === 0,
        alertTrades: derivedTrades,
        alertErrors: derivedErrors,
        alertSystem: derivedSystem,
        alertBalance: derivedBalance,
        alertHeartbeat: derivedHeartbeat,
        alertPreferences: prefs,
        isActive: true,
        tokenId: tokenId || null,
        enabledModes: enabledModes || ["trading", "idca", "fiscal", "smart_exit"],
        enabledAlerts: enabledAlerts || ["trades", "errors", "system", "balance", "heartbeat"],
      });

      res.json(chat);
    } catch (error) {
      res.status(500).json({ error: "Error creando chat" });
    }
  });

  app.put("/api/telegram/chats/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, chatId, alertTrades, alertErrors, alertSystem, alertBalance, alertHeartbeat, alertPreferences, isActive, tokenId, enabledModes, enabledAlerts } = req.body;

      // Validar tokenId si se proporciona
      if (tokenId !== undefined && tokenId !== null) {
        const token = await storage.getTelegramBotTokenById(tokenId);
        if (!token || !token.isActive) {
          return res.status(400).json({ error: "Token no encontrado o inactivo" });
        }
      }

      const chat = await storage.updateTelegramChat(id, {
        name,
        chatId,
        alertTrades,
        alertErrors,
        alertSystem,
        alertBalance,
        alertHeartbeat,
        alertPreferences,
        isActive,
        tokenId: tokenId !== undefined ? tokenId : undefined,
        enabledModes: enabledModes !== undefined ? enabledModes : undefined,
        enabledAlerts: enabledAlerts !== undefined ? enabledAlerts : undefined,
      });

      res.json(chat);
    } catch (error) {
      res.status(500).json({ error: "Error actualizando chat" });
    }
  });

  app.delete("/api/telegram/chats/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteTelegramChat(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Error eliminando chat" });
    }
  });

  // ── Telegram Bot Tokens (multi-bot support) ──
  app.get("/api/telegram/tokens", async (req, res) => {
    try {
      const tokens = await storage.getTelegramBotTokens();
      // No enviar token completo, solo last4
      const safeTokens = tokens.map(t => ({
        ...t,
        tokenEncrypted: undefined,
        tokenLast4: t.tokenLast4,
      }));
      res.json(safeTokens);
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo tokens" });
    }
  });

  app.post("/api/telegram/tokens", async (req, res) => {
    try {
      const { name, token, environment = "production" } = req.body;

      if (!name || !token) {
        return res.status(400).json({ error: "Nombre y token son requeridos" });
      }

      // Validar formato de token (debe empezar con números y : )
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
        return res.status(400).json({ error: "Formato de token inválido" });
      }

      // Extraer últimos 4 caracteres
      const tokenLast4 = token.slice(-4);

      // Validar token con Telegram API
      const TelegramBot = require('node-telegram-bot-api');
      const bot = new TelegramBot(token);
      try {
        await bot.getMe();
      } catch (error: any) {
        return res.status(400).json({ error: "Token inválido: " + error.message });
      }

      // Si es el primer token, marcar como default
      const existingTokens = await storage.getTelegramBotTokens();
      const isDefault = existingTokens.length === 0;

      const newToken = await storage.createTelegramBotToken({
        name,
        tokenEncrypted: token, // TODO: Encriptar antes de guardar
        tokenLast4,
        isActive: true,
        isDefault,
        environment,
      });

      res.json({
        ...newToken,
        tokenEncrypted: undefined,
        tokenLast4: newToken.tokenLast4,
      });
    } catch (error) {
      res.status(500).json({ error: "Error creando token" });
    }
  });

  app.patch("/api/telegram/tokens/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, isActive, isDefault, token } = req.body;

      const existing = await storage.getTelegramBotTokenById(id);
      if (!existing) {
        return res.status(404).json({ error: "Token no encontrado" });
      }

      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (isActive !== undefined) updates.isActive = isActive;
      if (isDefault !== undefined) {
        // Si se marca como default, desmarcar otros
        if (isDefault) {
          const allTokens = await storage.getTelegramBotTokens();
          for (const t of allTokens) {
            if (t.id !== id && t.isDefault) {
              await storage.updateTelegramBotToken(t.id, { isDefault: false });
            }
          }
        }
        updates.isDefault = isDefault;
      }
      if (token !== undefined) {
        // Validar nuevo token
        if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
          return res.status(400).json({ error: "Formato de token inválido" });
        }
        const TelegramBot = require('node-telegram-bot-api');
        const bot = new TelegramBot(token);
        try {
          await bot.getMe();
        } catch (error: any) {
          return res.status(400).json({ error: "Token inválido: " + error.message });
        }
        updates.tokenEncrypted = token;
        updates.tokenLast4 = token.slice(-4);
      }

      const updated = await storage.updateTelegramBotToken(id, updates);
      res.json({
        ...updated,
        tokenEncrypted: undefined,
        tokenLast4: updated.tokenLast4,
      });
    } catch (error) {
      res.status(500).json({ error: "Error actualizando token" });
    }
  });

  app.post("/api/telegram/tokens/:id/test", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const result = await storage.validateTelegramBotToken(id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Error validando token" });
    }
  });

  app.delete("/api/telegram/tokens/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteTelegramBotToken(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Error eliminando token" });
    }
  });

  // ── Telegram Alert Rules (granular alert configuration by mode) ──
  app.get("/api/telegram/alert-rules", async (req, res) => {
    try {
      const chatId = req.query.chatId ? parseInt(req.query.chatId as string) : undefined;
      const rules = await storage.getTelegramAlertRules(chatId);
      res.json(rules);
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo reglas de alerta" });
    }
  });

  app.get("/api/telegram/alert-rules/:chatId/:mode", async (req, res) => {
    try {
      const chatId = parseInt(req.params.chatId);
      const mode = req.params.mode;
      const rules = await storage.getTelegramAlertRulesByMode(chatId, mode);
      res.json(rules);
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo reglas de alerta por modo" });
    }
  });

  app.post("/api/telegram/alert-rules", async (req, res) => {
    try {
      const { chatId, mode, alertType, enabled, minSeverity, cooldownSeconds } = req.body;

      if (!chatId || !mode || !alertType) {
        return res.status(400).json({ error: "chatId, mode y alertType son requeridos" });
      }

      const rule = await storage.createTelegramAlertRule({
        chatId,
        mode,
        alertType,
        enabled: enabled ?? true,
        minSeverity: minSeverity ?? "LOW",
        cooldownSeconds: cooldownSeconds ?? 0,
      });

      res.json(rule);
    } catch (error) {
      res.status(500).json({ error: "Error creando regla de alerta" });
    }
  });

  app.put("/api/telegram/alert-rules/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { enabled, minSeverity, cooldownSeconds } = req.body;

      const updates: any = {};
      if (enabled !== undefined) updates.enabled = enabled;
      if (minSeverity !== undefined) updates.minSeverity = minSeverity;
      if (cooldownSeconds !== undefined) updates.cooldownSeconds = cooldownSeconds;

      const rule = await storage.updateTelegramAlertRule(id, updates);
      res.json(rule);
    } catch (error) {
      res.status(500).json({ error: "Error actualizando regla de alerta" });
    }
  });

  app.delete("/api/telegram/alert-rules/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteTelegramAlertRule(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Error eliminando regla de alerta" });
    }
  });

  // ── Telegram Global Config (kill switch, dedupe, rate-limit, quiet hours) ──
  app.get("/api/telegram/global-config", async (req, res) => {
    try {
      const { telegramNotificationCenter } = await import("./services/TelegramNotificationCenter");
      const config = await telegramNotificationCenter.getGlobalConfig();
      res.json(config || { telegramGlobalEnabled: true, telegramSilentMode: false, telegramMinSeverity: "LOW" });
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo configuración global de Telegram" });
    }
  });

  app.put("/api/telegram/global-config", async (req, res) => {
    try {
      const { telegramNotificationCenter } = await import("./services/TelegramNotificationCenter");
      const updated = await telegramNotificationCenter.updateGlobalConfig(req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Error actualizando configuración global de Telegram" });
    }
  });

  // ── Telegram Alert Events Audit ──────────────────────────────────
  app.get("/api/telegram/alert-events", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const { telegramNotificationCenter } = await import("./services/TelegramNotificationCenter");
      const events = await telegramNotificationCenter.getAlertEvents(limit);
      res.json(events);
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo eventos de alerta" });
    }
  });

  // ── Telegram Command Logs ────────────────────────────────────────
  app.get("/api/telegram/command-logs", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const { telegramNotificationCenter } = await import("./services/TelegramNotificationCenter");
      const logs = await telegramNotificationCenter.getCommandLogs(limit);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo logs de comandos" });
    }
  });

  // ── Telegram Command Definitions ─────────────────────────────────
  app.get("/api/telegram/commands", async (req, res) => {
    try {
      const { telegramNotificationCenter } = await import("./services/TelegramNotificationCenter");
      const commands = telegramNotificationCenter.getCommandDefinitions();
      res.json(commands);
    } catch (error) {
      res.status(500).json({ error: "Error obteniendo definiciones de comandos" });
    }
  });

  // ── Grid Alert Catalog (FASE H) ──────────────────────────────────
  app.get("/api/telegram/grid-alert-catalog", async (req, res) => {
    try {
      const { GRID_ALERT_DEFINITIONS } = await import("./services/institutionalDca/GridAlertTypes");
      res.json(GRID_ALERT_DEFINITIONS);
    } catch (error: any) {
      res.status(500).json({ error: "Error obteniendo catalogo de alertas Grid", detail: error?.message });
    }
  });

  // ── Telegram Audit (FASE C) ──────────────────────────────────────
  // Detects: legacy chat IDs, orphan channels, ENV fallback issues
  app.get("/api/telegram/audit", async (req, res) => {
    try {
      const { telegramNotificationCenter } = await import("./services/TelegramNotificationCenter");
      const { db } = await import("./db");
      const { telegramChats, apiConfig: apiConfigTable, institutionalDcaConfig, fiscoAlertConfig } = await import("../shared/schema");

      const issues: any[] = [];

      // 1. Get all telegram_chats
      const allChats = await db.select().from(telegramChats);

      // 2. Check for legacy chat IDs in api_config
      const apiConfigRows = await db.select().from(apiConfigTable).limit(1);
      const apiConfigRow = apiConfigRows[0];
      if (apiConfigRow?.telegramChatId) {
        const exists = allChats.find(c => c.chatId === apiConfigRow.telegramChatId);
        if (!exists) {
          issues.push({
            severity: "HIGH",
            code: "LEGACY_CHAT_ID_IN_API_CONFIG",
            detail: `api_config.telegram_chat_id = "${apiConfigRow.telegramChatId}" but this chatId is NOT registered in telegram_chats. Messages would go to a phantom channel.`,
            recommendation: "Import as inactive channel for review, or remove the legacy reference.",
            source: "api_config",
            chatId: apiConfigRow.telegramChatId,
            resolvable: true,
          });
        } else if ((exists.alertPreferences as any)?.needsUserReview) {
          issues.push({
            severity: "WARNING",
            code: "LEGACY_CHAT_ID_IMPORTED_NEEDS_REVIEW",
            detail: `api_config.telegram_chat_id = "${apiConfigRow.telegramChatId}" was imported as channel "${exists.name}" but is INACTIVE and pending review.`,
            recommendation: "Review and activate manually from Telegram > Canales if this channel should receive alerts.",
            source: "api_config",
            chatId: apiConfigRow.telegramChatId,
            resolvable: false,
          });
        } else if (!exists.isActive) {
          issues.push({
            severity: "MEDIUM",
            code: "LEGACY_CHAT_ID_INACTIVE",
            detail: `api_config.telegram_chat_id = "${apiConfigRow.telegramChatId}" is registered but INACTIVE in telegram_chats.`,
            recommendation: "Activate the channel in telegram_chats or remove from api_config.",
            source: "api_config",
            chatId: apiConfigRow.telegramChatId,
            resolvable: false,
          });
        }
      }

      // 3. Check ENV fallback (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)
      const envToken = process.env.TELEGRAM_BOT_TOKEN;
      const envChatId = process.env.TELEGRAM_CHAT_ID;
      if (envToken || envChatId) {
        const globalConfig = await telegramNotificationCenter.getGlobalConfig();
        if (!globalConfig?.telegramGlobalEnabled) {
          issues.push({
            severity: "INFO",
            code: "ENV_FALLBACK_IGNORED_GLOBAL_OFF",
            detail: `ENV TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID present but global kill switch is OFF. ENV fallback is correctly ignored.`,
            recommendation: "No action needed — ENV is ignored when global is OFF.",
          });
        }
        if (envChatId) {
          const exists = allChats.find(c => c.chatId === envChatId);
          if (!exists) {
            issues.push({
              severity: "HIGH",
              code: "ENV_CHAT_ID_NOT_IN_TELEGRAM_CHATS",
              detail: `ENV TELEGRAM_CHAT_ID = "${envChatId}" is NOT registered in telegram_chats.`,
              recommendation: "Register this chatId in telegram_chats or remove from ENV.",
            });
          }
        }
        if (allChats.filter(c => c.isActive).length === 0) {
          issues.push({
            severity: "INFO",
            code: "ENV_FALLBACK_IGNORED_NO_ACTIVE_CHANNELS",
            detail: `ENV TELEGRAM_CHAT_ID present but no active channels in telegram_chats. ENV fallback is correctly ignored.`,
            recommendation: "No action needed — ENV is ignored when no active channels exist.",
          });
        }
      }

      // 4. Check IDCA config telegramChatId
      const idcaConfigRows = await db.select().from(institutionalDcaConfig).limit(1);
      const idcaConfig = idcaConfigRows[0];
      if (idcaConfig?.telegramChatId) {
        const exists = allChats.find(c => c.chatId === idcaConfig.telegramChatId);
        if (!exists) {
          issues.push({
            severity: "HIGH",
            code: "IDCA_CHAT_ID_NOT_REGISTERED",
            detail: `institutional_dca_config.telegram_chat_id = "${idcaConfig.telegramChatId}" is NOT registered in telegram_chats.`,
            recommendation: "Import as inactive channel for review, or remove the legacy reference.",
            source: "idca_config",
            chatId: idcaConfig.telegramChatId,
            resolvable: true,
          });
        } else if ((exists.alertPreferences as any)?.needsUserReview) {
          issues.push({
            severity: "WARNING",
            code: "LEGACY_CHAT_ID_IMPORTED_NEEDS_REVIEW",
            detail: `institutional_dca_config.telegram_chat_id = "${idcaConfig.telegramChatId}" was imported as channel "${exists.name}" but is INACTIVE and pending review.`,
            recommendation: "Review and activate manually from Telegram > Canales if this channel should receive alerts.",
            source: "idca_config",
            chatId: idcaConfig.telegramChatId,
            resolvable: false,
          });
        } else if (!exists.isActive) {
          issues.push({
            severity: "MEDIUM",
            code: "IDCA_CHAT_ID_INACTIVE",
            detail: `institutional_dca_config.telegram_chat_id = "${idcaConfig.telegramChatId}" is INACTIVE in telegram_chats.`,
            recommendation: "Activate the channel or remove from IDCA config.",
            source: "idca_config",
            chatId: idcaConfig.telegramChatId,
            resolvable: false,
          });
        }
      }

      // 5. Check FISCO alert config chatId
      const fiscoConfigRows = await db.select().from(fiscoAlertConfig).limit(1);
      const fiscoConfig = fiscoConfigRows[0];
      if (fiscoConfig?.chatId) {
        const exists = allChats.find(c => c.chatId === fiscoConfig.chatId);
        if (!exists) {
          issues.push({
            severity: "HIGH",
            code: "FISCO_CHAT_ID_NOT_REGISTERED",
            detail: `fisco_alert_config.chat_id = "${fiscoConfig.chatId}" is NOT registered in telegram_chats.`,
            recommendation: "Register this chatId in telegram_chats or remove from FISCO alert config.",
            source: "fisco_config",
            chatId: fiscoConfig.chatId,
            resolvable: true,
          });
        } else if (!exists.isActive) {
          issues.push({
            severity: "MEDIUM",
            code: "FISCO_CHAT_ID_INACTIVE",
            detail: `fisco_alert_config.chat_id = "${fiscoConfig.chatId}" is INACTIVE in telegram_chats.`,
            recommendation: "Activate the channel or remove from FISCO alert config.",
            source: "fisco_config",
            chatId: fiscoConfig.chatId,
            resolvable: false,
          });
        } else {
          issues.push({
            severity: "INFO",
            code: "FISCO_CHAT_ID_RESOLVED",
            detail: `fisco_alert_config.chat_id = "${fiscoConfig.chatId}" is correctly registered and active as channel "${exists.name}".`,
            recommendation: "No action needed.",
            source: "fisco_config",
            chatId: fiscoConfig.chatId,
            resolvable: false,
          });
        }
      }

      // 6. Orphan inactive channels
      const configuredChatIds = new Set<string>();
      if (apiConfigRow?.telegramChatId) configuredChatIds.add(apiConfigRow.telegramChatId);
      if (idcaConfig?.telegramChatId) configuredChatIds.add(idcaConfig.telegramChatId);
      if (fiscoConfig?.chatId) configuredChatIds.add(fiscoConfig.chatId);
      if (envChatId) configuredChatIds.add(envChatId);

      const orphanChats = allChats.filter(c => !configuredChatIds.has(c.chatId));
      const orphanInactive = orphanChats.filter(c => !c.isActive);
      if (orphanInactive.length > 0) {
        issues.push({
          severity: "LOW",
          code: "ORPHAN_INACTIVE_CHANNELS",
          detail: `${orphanInactive.length} inactive channel(s) not referenced by any module config: ${orphanInactive.map(c => c.name + " (" + c.chatId + ")").join(", ")}`,
          recommendation: "Consider deleting these channels if no longer needed.",
        });
      }

      // 7. Global config status
      const globalConfig = await telegramNotificationCenter.getGlobalConfig();
      const activeChats = allChats.filter(c => c.isActive);

      res.json({
        timestamp: new Date().toISOString(),
        globalConfig: {
          telegramGlobalEnabled: globalConfig?.telegramGlobalEnabled ?? true,
          telegramSilentMode: globalConfig?.telegramSilentMode ?? false,
          telegramMinSeverity: globalConfig?.telegramMinSeverity ?? "LOW",
          telegramEnvironmentLabel: globalConfig?.telegramEnvironmentLabel ?? "unknown",
        },
        channels: {
          total: allChats.length,
          active: activeChats.length,
          inactive: allChats.length - activeChats.length,
        },
        envFallback: {
          hasEnvToken: !!envToken,
          hasEnvChatId: !!envChatId,
          envChatIdRegistered: envChatId ? allChats.some(c => c.chatId === envChatId) : null,
          policy: "ENV fallback ignored if global OFF or no active channels",
        },
        issues,
        summary: {
          totalIssues: issues.length,
          highSeverity: issues.filter(i => i.severity === "HIGH").length,
          mediumSeverity: issues.filter(i => i.severity === "MEDIUM").length,
          lowSeverity: issues.filter(i => i.severity === "LOW").length,
          warning: issues.filter(i => i.severity === "WARNING").length,
          info: issues.filter(i => i.severity === "INFO").length,
        },
      });
    } catch (error: any) {
      console.error("[telegram:audit] Error:", error);
      res.status(500).json({ error: "Error ejecutando auditoria Telegram", detail: error?.message });
    }
  });

  // ── Telegram Audit Resolve Actions (FASE G) ──────────────────────
  // Allows registering a legacy chatId as a proper telegram_chats channel,
  // or clearing the legacy reference from the source config table.
  app.post("/api/telegram/audit/resolve", async (req, res) => {
    try {
      const { action, source, chatId, name } = req.body as {
        action: "register_channel" | "clear_reference" | "ignore";
        source: "api_config" | "idca_config" | "fisco_config";
        chatId?: string;
        name?: string;
      };

      if (!action || !source) {
        return res.status(400).json({ error: "action y source son requeridos" });
      }

      const { db } = await import("./db");
      const { telegramChats, apiConfig: apiConfigTable, institutionalDcaConfig, fiscoAlertConfig } = await import("../shared/schema");
      const { eq } = await import("drizzle-orm");

      if (action === "register_channel") {
        if (!chatId) return res.status(400).json({ error: "chatId requerido" });
        const existing = await db.select().from(telegramChats).where(eq(telegramChats.chatId, chatId));
        if (existing.length > 0) {
          return res.status(400).json({ error: "Este chatId ya está registrado como canal" });
        }
        // SAFETY: legacy channels are imported INACTIVE by default. Registering as active
        // could reactivate phantom messages to a channel the user may have deliberately
        // removed from the UI. The user must explicitly activate it from Telegram > Canales.
        const defaultName = name || (source === "api_config" ? "Legacy API Config" : source === "idca_config" ? "Legacy IDCA" : "Legacy FISCO");
        const alertPreferences: Record<string, any> = {
          importedFromLegacy: true,
          needsUserReview: true,
        };
        const [created] = await db.insert(telegramChats).values({
          name: defaultName,
          chatId,
          isActive: false,
          alertTrades: false,
          alertErrors: false,
          alertSystem: false,
          alertBalance: false,
          alertHeartbeat: false,
          alertPreferences,
        }).returning();
        return res.json({ status: "imported_inactive", channel: created });
      }

      if (action === "clear_reference") {
        if (source === "api_config") {
          await db.update(apiConfigTable).set({ telegramChatId: null }).where(eq(apiConfigTable.id, 1));
        } else if (source === "idca_config") {
          await db.update(institutionalDcaConfig).set({ telegramChatId: null }).where(eq(institutionalDcaConfig.id, 1));
        } else if (source === "fisco_config") {
          // fisco_alert_config.chat_id is NOT NULL — clearing means deleting the row
          await db.delete(fiscoAlertConfig).where(eq(fiscoAlertConfig.id, 1));
        }
        return res.json({ status: "cleared" });
      }

      if (action === "ignore") {
        // No-op: acknowledged by the user, issue remains but is not acted upon.
        return res.json({ status: "ignored" });
      }

      return res.status(400).json({ error: "Acción no reconocida" });
    } catch (error: any) {
      console.error("[telegram:audit:resolve] Error:", error);
      res.status(500).json({ error: "Error resolviendo issue de auditoría", detail: error?.message });
    }
  });

  // ── Dashboard — Stale-While-Revalidate ──────────────────────────
  //
  // The KrakenRateLimiter is FIFO concurrency=1 with 500ms spacing.
  // When IDCA/trading engine calls are queued, dashboard tickers wait 5-30s.
  //
  // Strategy:
  //   - First load (cold): block up to 3s, return partial data on timeout
  //   - Subsequent loads: return cached data INSTANTLY, refresh in background
  //   - Ticker prices are cached separately (30s) to avoid rate limiter queue
  //
  let _dashboardCache: { data: any; ts: number } | null = null;
  const DASHBOARD_FRESH_MS  = 10_000;   // serve without background refresh
  const DASHBOARD_MAX_AGE   = 120_000;  // force foreground refresh
  const DASHBOARD_COLD_TIMEOUT = 3_000; // max wait on first load
  const _tickerPriceCache = new Map<string, { price: string; ts: number }>();
  const TICKER_CACHE_TTL  = 30_000;     // 30 seconds
  let _dashboardRefreshing = false;

  async function refreshDashboardData(): Promise<any> {
    const [apiConfig, botConfig, trades] = await Promise.all([
      storage.getApiConfig(),
      storage.getBotConfig(),
      storage.getTrades(10),
    ]);

    let balances: Record<string, number> = {};
    let prices: Record<string, { price: string; change: string }> = {};

    const tradingExchangeType = ExchangeFactory.getTradingExchangeType();
    const tradingExchange = ExchangeFactory.getTradingExchange();
    const dataExchange = ExchangeFactory.getDataExchange();

    const activePairs = botConfig?.activePairs || ["BTC/USD", "ETH/USD", "SOL/USD"];
    const activeAssets = new Set<string>(["USD"]);
    for (const pair of activePairs) {
      const [base] = pair.split("/");
      activeAssets.add(base);
    }

    const normalizeSymbol = (symbol: string, exchangeType: string): string => {
      if (exchangeType === 'kraken') return krakenService.normalizeAsset(symbol);
      return symbol;
    };

    // Pre-fill from ticker cache (instant)
    const now = Date.now();
    const stalePairs: string[] = [];
    for (const pair of activePairs) {
      const cached = _tickerPriceCache.get(pair);
      if (cached && now - cached.ts < TICKER_CACHE_TTL) {
        prices[pair] = { price: cached.price, change: "0" };
      } else {
        stalePairs.push(pair);
      }
    }

    // Fetch balance + stale tickers with hard 3s timeout
    await Promise.race([
      Promise.all([
        tradingExchange.isInitialized()
          ? tradingExchange.getBalance()
              .then(raw => {
                for (const [asset, amount] of Object.entries(raw)) {
                  const sym = normalizeSymbol(asset, tradingExchangeType);
                  if (activeAssets.has(sym)) balances[sym] = (balances[sym] || 0) + amount;
                }
              })
              .catch(e => console.error('[dashboard] Balance error:', e?.message))
          : Promise.resolve(),
        ...stalePairs.map(pair =>
          dataExchange.isInitialized()
            ? dataExchange.getTicker(pair)
                .then(ticker => {
                  const p = ticker.last.toString();
                  prices[pair] = { price: p, change: "0" };
                  _tickerPriceCache.set(pair, { price: p, ts: Date.now() });
                })
                .catch(() => { /* skip pair */ })
            : Promise.resolve()
        ),
      ]),
      new Promise<void>(r => setTimeout(r, DASHBOARD_COLD_TIMEOUT)),
    ]);

    const exchangeConnected = tradingExchange.isInitialized();
    const responseData = {
      exchangeConnected,
      tradingExchange: tradingExchangeType,
      dataExchange: ExchangeFactory.getDataExchangeType(),
      krakenConnected: krakenService.isInitialized(),
      telegramConnected: apiConfig?.telegramConnected || false,
      botActive: botConfig?.isActive || false,
      strategy: botConfig?.strategy || "momentum",
      activePairs,
      activeAssets: Array.from(activeAssets),
      balances,
      prices,
      recentTrades: trades,
    };
    _dashboardCache = { data: responseData, ts: Date.now() };
    return responseData;
  }

  app.get("/api/dashboard", async (req, res) => {
    const force = req.query.force === '1';
    const age = _dashboardCache ? Date.now() - _dashboardCache.ts : Infinity;

    // 1. Fresh cache → serve instantly
    if (!force && _dashboardCache && age < DASHBOARD_FRESH_MS) {
      return res.json(_dashboardCache.data);
    }

    // 2. Stale cache exists → serve stale, trigger background refresh
    if (!force && _dashboardCache && age < DASHBOARD_MAX_AGE) {
      res.json(_dashboardCache.data);
      if (!_dashboardRefreshing) {
        _dashboardRefreshing = true;
        refreshDashboardData()
          .catch(e => console.error('[dashboard] bg refresh error:', e?.message))
          .finally(() => { _dashboardRefreshing = false; });
      }
      return;
    }

    // 3. No cache or too old → foreground refresh (first load)
    try {
      const data = await refreshDashboardData();
      res.json(data);
    } catch (error) {
      console.error('[dashboard] Fatal error:', error);
      // If we have ANY stale data, return it instead of 500
      if (_dashboardCache) return res.json(_dashboardCache.data);
      res.status(500).json({ error: "Failed to get dashboard data" });
    }
  });

  // ============================================================
  // TRADES, SYNC, FIFO, PERFORMANCE ENDPOINTS (modularized)
  // ============================================================
  const { registerTradesRoutes } = await import('./routes/trades.routes');
  registerTradesRoutes(app, routerDeps);

  // ============================================================
  // POSITIONS ENDPOINTS (modularized) - open-positions, buy, close, orphan, time-stop
  // ============================================================
  const { registerPositionsRoutes } = await import('./routes/positions.routes');
  registerPositionsRoutes(app, routerDeps);

  // ============================================================
  // ADMIN ENDPOINTS (modularized) - includes purge-*, rebuild-*, legacy-*, backfill, indexes
  // ============================================================
  const { registerAdminRoutes } = await import('./routes/admin.routes');
  registerAdminRoutes(app, routerDeps);

  // ============================================================
  // MARKET, BALANCE, PRICES, TRADE, SYNC-REVOLUTX, RECONCILE (modularized)
  // ============================================================
  const { registerMarketRoutes } = await import('./routes/market.routes');
  registerMarketRoutes(app, routerDeps);

  // ============================================================================
  // EVENTS & LOGS ENDPOINTS (modularized)
  // ============================================================================
  const { registerEventsRoutes } = await import('./routes/events.routes');
  registerEventsRoutes(app, routerDeps);

  // ============================================================================
  // AI, ENVIRONMENT & DB DIAGNOSTIC ENDPOINTS (modularized)
  // ============================================================================
  const { registerAiRoutes } = await import('./routes/ai.routes');
  registerAiRoutes(app, routerDeps);

  // ============================================================
  // FISCO (Fiscal Control) ENDPOINTS (modularized)
  // ============================================================
  // Ensure FISCO control schema (tables/columns) exists before routes
  const { fiscoControlSchemaEnsureService } = await import('./services/fisco/FiscoControlSchemaEnsureService');
  await fiscoControlSchemaEnsureService.ensure().catch((e: any) => {
    console.warn("[startup] FiscoControlSchemaEnsure failed:", e.message);
  });
  const { registerFiscoRoutes, registerFiscoRebuildRoutes } = await import('./routes/fisco.routes');
  registerFiscoRoutes(app, routerDeps);
  registerFiscoRebuildRoutes(app);

  // ============================================================
  // FISCO ALERTS ENDPOINTS (new)
  // ============================================================
  const { registerFiscoAlertsRoutes } = await import('./routes/fiscoAlerts.routes');
  registerFiscoAlertsRoutes(app, routerDeps);

  // ============================================================
  // SMART TIMESTOP CONFIG ENDPOINTS (modularized)
  // ============================================================
  const { registerTimeStopRoutes } = await import('./routes/timestop.routes');
  registerTimeStopRoutes(app, routerDeps);

  // ============================================================
  // TEST & DEBUG ENDPOINTS (modularized)
  // ============================================================
  const { registerTestRoutes } = await import('./routes/test.routes');
  registerTestRoutes(app, routerDeps);

  // ============================================================
  // DRY RUN ENDPOINTS (paper trading positions & history)
  // ============================================================
  const { registerDryRunRoutes } = await import('./routes/dryrun.routes');
  registerDryRunRoutes(app, routerDeps);

  // ============================================================
  // AUDIT ENDPOINTS — Trading + IDCA (read-only)
  // ============================================================
  const { registerAuditRoutes } = await import('./routes/audit.routes');
  registerAuditRoutes(app);

  // ============================================================
  // GRID ISOLATED ENDPOINTS — Professional Grid Engine
  // ============================================================
  try {
    const { registerGridIsolatedRoutes } = await import('./routes/gridIsolated.routes');
    registerGridIsolatedRoutes(app);
    console.log('[startup] Grid Isolated routes registered');
  } catch (e: any) {
    console.error('[startup] Failed to register Grid Isolated routes:', e?.message || e);
  }

  // NOTE: Telegram chat CRUD routes are defined inline above (/api/telegram/chats, /api/telegram/send)
  // The old /api/integrations/telegram/* duplicate routes in telegram.routes.ts have been removed.

  // Register configuration routes
  registerConfigRoutes(app);

  // ============================================
  // BACKUP MANAGEMENT ENDPOINTS (modularized)
  // ============================================
  const { registerBackupRoutes } = await import('./routes/backups.routes');
  await registerBackupRoutes(app, routerDeps);

  // ============================================
  // FISCO SCHEDULER INITIALIZATION
  // ============================================
  try {
    const { fiscoScheduler } = await import('./services/FiscoScheduler');
    fiscoScheduler.initialize();
    console.log('[startup] FISCO Scheduler initialized successfully');
  } catch (error: any) {
    console.error('[startup] Failed to initialize FISCO Scheduler:', error);
  }

  // ============================================================
  // AUTOTUNING ENDPOINTS (Phases 6-12)
  // ============================================================
  const { registerAutotuningRoutes } = await import('./routes/autotuning.routes');
  registerAutotuningRoutes(app, routerDeps);

  // ============================================================
  // MARKET METRICS ENDPOINTS
  // ============================================================
  const { registerMarketMetricsRoutes } = await import('./routes/marketMetrics.routes');
  registerMarketMetricsRoutes(app);

  // ============================================
  // MARKET METRICS SCHEDULER
  // Refresca métricas cada 4 horas por defecto
  // ============================================
  try {
    const { marketMetricsService } = await import('./services/marketMetrics');
    const metricsCron = process.env.MARKET_METRICS_CRON || '0 */4 * * *';
    cron.schedule(metricsCron, async () => {
      try {
        await marketMetricsService.refresh();
      } catch (e: any) {
        console.error('[market-metrics-cron] Error:', e?.message ?? e);
      }
    });
    console.log(`[startup] Market Metrics scheduler initialized: ${metricsCron}`);

    // Primer refresh al arrancar (30s delay para dejar inicializar servicios)
    setTimeout(async () => {
      try {
        const cfg = await marketMetricsService.getConfig();
        if (cfg.enabled) {
          console.log('[startup] Market Metrics: ejecutando primer refresh...');
          await marketMetricsService.refresh();
        }
      } catch (e: any) {
        console.warn('[startup] Market Metrics primer refresh (non-critical):', e?.message ?? e);
      }
    }, 30_000);
  } catch (e: any) {
    console.error('[startup] Failed to initialize Market Metrics scheduler:', e?.message ?? e);
  }

  // ============================================================
  // TRADE METRICS TRACKER (Phase 5 — MFE/MAE scheduler, 5min)
  // ============================================================
  try {
    const { tradeMetricsTracker } = await import('./services/TradeMetricsTracker');
    const { storage: st } = await import('./storage');
    tradeMetricsTracker.startScheduler(async () => {
      try {
        const positions = await st.getOpenPositions();
        return positions.map((p: any) => ({
          sourceMode:    'REAL',
          strategyType:  'BOT_SPOT',
          sourceTradeId: p.lotId ?? p.id?.toString() ?? 'unknown',
          pair:          p.pair,
          entryPrice:    parseFloat(p.entryPrice ?? '0'),
          currentPrice:  parseFloat(p.highestPrice ?? p.entryPrice ?? '0'),
          trailingActivated: p.sgTrailingActivated ?? false,
        }));
      } catch {
        return [];
      }
    });
    console.log('[startup] TradeMetricsTracker scheduler initialized');
  } catch (e: any) {
    console.warn(`[startup] TradeMetricsTracker init failed (non-critical): ${e?.message}`);
  }

  // === AUTO-REBUILD P&L ON STARTUP (background, non-blocking) ===
  setTimeout(async () => {
    try {
      console.log("[startup] Auto-rebuilding P&L for sells without P&L...");
      const result = await storage.rebuildPnlForAllSells();
      console.log(`[startup] P&L rebuild done: updated=${result.updated}, skipped=${result.skipped}, errors=${result.errors}`);
    } catch (e: any) {
      console.warn(`[startup] P&L rebuild failed (non-critical): ${e.message}`);
    }
  }, 10000); // 10s delay to let other services initialize first

  // === IDCA HISTORICAL DUPLICATE CLEANUP ON STARTUP (background, non-blocking) ===
  setTimeout(async () => {
    try {
      await runIdcaHistoricalDuplicateCleanupOnce();
    } catch (e: any) {
      console.warn(`[startup] IDCA historical duplicate cleanup failed (non-critical): ${e.message}`);
    }
  }, 15000); // 15s delay to let DB and other services initialize first

  return httpServer;
}

