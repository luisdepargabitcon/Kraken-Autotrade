import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { pool } from "./db";
import { krakenService } from "./services/kraken";
import { revolutXService } from "./services/exchanges/RevolutXService";
import { telegramService } from "./services/telegram";
import { TradingEngine } from "./services/tradingEngine";
import { botLogger } from "./services/botLogger";
import { aiService } from "./services/aiService";
import { eventsWs } from "./services/eventsWebSocket";
import { terminalWsServer } from "./services/terminalWebSocket";
import { environment } from "./services/environment";
import express, { type Request, Response, NextFunction } from "express";
import { registerConfigRoutes } from "./routes/config";
import { ExchangeFactory } from "./services/exchanges/ExchangeFactory";
import { z } from "zod";
import { errorAlertService, ErrorAlertService } from "./services/ErrorAlertService";
import cron from "node-cron";
import http from "http";
import { buildTradeId } from "./utils/tradeId";

let tradingEngine: TradingEngine | null = null;

const externalTradeAlertThrottle = new Map<string, number>();

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
            await postJson(url, { allowAssumedSide: true });
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
    
    // Auto-start if bot was active
    const botConfig = await storage.getBotConfig();
    if (botConfig?.isActive && krakenService.isInitialized()) {
      console.log("[startup] Starting trading engine...");
      tradingEngine.start();
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
      const { name, chatId, alertTrades, alertErrors, alertSystem, alertBalance, alertHeartbeat, alertPreferences } = req.body;
      
      if (!name || !chatId) {
        return res.status(400).json({ error: "Nombre y Chat ID son requeridos" });
      }

      if (!telegramService.isInitialized()) {
        return res.status(400).json({ error: "Telegram no está configurado. Configura primero el token principal." });
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
        alertTrades: derivedTrades,
        alertErrors: derivedErrors,
        alertSystem: derivedSystem,
        alertBalance: derivedBalance,
        alertHeartbeat: derivedHeartbeat,
        alertPreferences: prefs,
        isActive: true,
      });
      
      res.json(chat);
    } catch (error) {
      res.status(500).json({ error: "Error creando chat" });
    }
  });

  app.put("/api/telegram/chats/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, chatId, alertTrades, alertErrors, alertSystem, alertBalance, alertHeartbeat, alertPreferences, isActive } = req.body;
      
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

  app.get("/api/dashboard", async (req, res) => {
    try {
      const apiConfig = await storage.getApiConfig();
      const botConfig = await storage.getBotConfig();
      const trades = await storage.getTrades(10);
      
      let balances: Record<string, number> = {};
      let prices: Record<string, { price: string; change: string }> = {};
      
      // Get trading exchange info
      const tradingExchangeType = ExchangeFactory.getTradingExchangeType();
      const tradingExchange = ExchangeFactory.getTradingExchange();
      const dataExchange = ExchangeFactory.getDataExchange();
      
      // Get active pairs from bot config - only show assets the bot uses
      const activePairs = botConfig?.activePairs || ["BTC/USD", "ETH/USD", "SOL/USD"];
      const activeAssets = new Set<string>(["USD"]); // Always include USD
      for (const pair of activePairs) {
        const [base] = pair.split("/");
        activeAssets.add(base);
      }
      
      // Normalize exchange symbols to generic symbols using centralized krakenService method
      // For Revolut X, symbols are already generic (BTC, ETH, etc.)
      const normalizeSymbol = (symbol: string, exchangeType: string): string => {
        if (exchangeType === 'kraken') {
          return krakenService.normalizeAsset(symbol);
        }
        // Revolut X and others use generic symbols, just return as-is
        return symbol;
      };
      
      // Get balances from TRADING exchange (Revolut X or Kraken)
      if (tradingExchange.isInitialized()) {
        try {
          const rawBalances = await tradingExchange.getBalance();
          // Normalize and filter to only include assets the bot uses
          for (const [asset, amount] of Object.entries(rawBalances)) {
            const normalizedSymbol = normalizeSymbol(asset, tradingExchangeType);
            if (activeAssets.has(normalizedSymbol)) {
              // Aggregate balances for same asset (e.g., XBT + XBT.S)
              balances[normalizedSymbol] = (balances[normalizedSymbol] || 0) + amount;
            }
          }
        } catch (e) {
          console.error('[dashboard] Error fetching trading exchange balances:', e);
        }
      }
      
      // Get prices from DATA exchange (Kraken for OHLC data)
      // Uses exchange's getTicker which handles pair format internally
      if (dataExchange.isInitialized()) {
        try {
          for (const pair of activePairs) {
            try {
              const ticker = await dataExchange.getTicker(pair);
              prices[pair] = { price: ticker.last.toString(), change: "0" };
            } catch (e) {
              // Silently skip pairs that fail (e.g., TON may not exist on some exchanges)
            }
          }
        } catch (e) {
          console.error('[dashboard] Error fetching data exchange prices:', e);
        }
      }
      
      // Determine connection status based on trading exchange
      const exchangeConnected = tradingExchange.isInitialized();
      
      res.json({
        exchangeConnected,
        tradingExchange: tradingExchangeType,
        dataExchange: ExchangeFactory.getDataExchangeType(),
        // Legacy fields for backward compatibility
        krakenConnected: krakenService.isInitialized(),
        telegramConnected: apiConfig?.telegramConnected || false,
        botActive: botConfig?.isActive || false,
        strategy: botConfig?.strategy || "momentum",
        activePairs,
        activeAssets: Array.from(activeAssets),
        balances,
        prices,
        recentTrades: trades,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get dashboard data" });
    }
  });

  app.get("/api/trades", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const trades = await storage.getTrades(limit);
      res.json(trades);
    } catch (error) {
      res.status(500).json({ error: "Failed to get trades" });
    }
  });

  app.get("/api/open-positions", async (req, res) => {
    try {
      const positions = await storage.getOpenPositions();
      
      const botConfig = await storage.getBotConfig();
      const takerFeePct = parseFloat(botConfig?.takerFeePct || "0.40") / 100;
      
      const positionsWithPnl = await Promise.all(positions.map(async (pos) => {
        let currentPrice = 0;
        let unrealizedPnlUsd = 0;
        let unrealizedPnlPct = 0;

        const ex = ((pos as any).exchange as string | undefined) || 'kraken';
        try {
          // RevolutX no tiene endpoint de ticker - usar Kraken para precio actual
          if (krakenService.isInitialized()) {
            const krakenPair = krakenService.formatPair(pos.pair);
            const ticker = await krakenService.getTickerRaw(krakenPair);
            const tickerData: any = Object.values(ticker)[0];
            if (tickerData?.c?.[0]) {
              currentPrice = parseFloat(tickerData.c[0]);
              console.log(`[open-positions] ${pos.pair} (${ex}): precio actual de Kraken = $${currentPrice}`);
            } else {
              console.warn(`[open-positions] ${pos.pair} (${ex}): ticker sin precio válido`, tickerData);
            }
          } else {
            console.warn(`[open-positions] ${pos.pair}: Kraken no inicializado, no se puede obtener precio`);
          }

          if (currentPrice > 0) {
            const entryPrice = parseFloat(pos.entryPrice);
            const amount = parseFloat(pos.amount);
            unrealizedPnlUsd = (currentPrice - entryPrice) * amount;
            unrealizedPnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
          } else {
            console.warn(`[open-positions] ${pos.pair}: precio actual = 0, no se puede calcular PnL`);
          }
        } catch (e: any) {
          console.error(`[open-positions] Error obteniendo precio para ${pos.pair} (${ex}):`, e.message || e);
        }
        
        const amount = parseFloat(pos.amount);
        const entryPrice = parseFloat(pos.entryPrice);
        const entryValueUsd = entryPrice * amount;
        const currentValueUsd = currentPrice * amount;
        
        const storedEntryFee = pos.entryFee != null ? parseFloat(pos.entryFee.toString()) : null;
        const entryFeeUsd = storedEntryFee != null && !isNaN(storedEntryFee) ? storedEntryFee : (entryValueUsd * takerFeePct);
        const exitFeeUsd = currentValueUsd * takerFeePct;
        const netPnlUsd = currentPrice > 0 ? (unrealizedPnlUsd - entryFeeUsd - exitFeeUsd) : 0;
        const netPnlPct = entryValueUsd > 0 && currentPrice > 0 ? (netPnlUsd / entryValueUsd) * 100 : 0;
        
        return {
          ...pos,
          currentPrice: currentPrice.toString(),
          unrealizedPnlUsd: unrealizedPnlUsd.toFixed(2),
          unrealizedPnlPct: unrealizedPnlPct.toFixed(2),
          netPnlUsd: netPnlUsd.toFixed(2),
          netPnlPct: netPnlPct.toFixed(2),
          entryValueUsd: entryValueUsd.toFixed(2),
          currentValueUsd: currentValueUsd.toFixed(2),
        };
      }));
      
      res.json(positionsWithPnl);
    } catch (error) {
      console.error("[api/open-positions] Error:", error);
      res.status(500).json({ error: "Failed to get open positions" });
    }
  });

  app.post("/api/admin/rebuild-positions", async (req, res) => {
    try {
      const expectedToken = process.env.TERMINAL_TOKEN;
      if (!expectedToken) {
        return res.status(500).json({ error: "TERMINAL_TOKEN_NOT_CONFIGURED" });
      }

      const authHeader = req.headers.authorization;
      const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      const queryToken = (req.query?.token as string | undefined) || undefined;
      const token = headerToken || queryToken;
      if (!token || token !== expectedToken) {
        return res.status(403).json({ error: "FORBIDDEN" });
      }

      const schema = z.object({
        exchange: z.enum(["all", "kraken", "revolutx"]).optional().default("all"),
        origin: z.enum(["bot"]).optional().default("bot"),
        since: z.string().optional(),
      });

      const parsed = schema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.issues });
      }

      const { exchange, since: sinceRaw } = parsed.data;
      const since = sinceRaw ? new Date(sinceRaw) : new Date('2026-01-17T00:00:00Z');
      if (isNaN(since.getTime())) {
        return res.status(400).json({ error: "INVALID_SINCE" });
      }

      const exchangesToProcess = exchange === 'all' ? ['kraken', 'revolutx'] : [exchange];

      let deleted = 0;
      for (const ex of exchangesToProcess) {
        deleted += await storage.deleteOpenPositionsByExchange(ex);
      }

      const trades = await storage.listTradesForRebuild({
        exchanges: exchangesToProcess,
        origin: 'bot',
        since,
      });

      type Lot = { lotId: string; exchange: string; pair: string; entryPrice: number; qty: number };
      const lotsByKey = new Map<string, Lot[]>();

      const krakenFeePct = parseFloat((await storage.getBotConfig())?.takerFeePct || "0.40") / 100;

      const feePctForExchange = (ex: string) => {
        if (ex === 'revolutx') return 0.09 / 100;
        return krakenFeePct;
      };

      for (const t of trades) {
        const key = `${t.exchange}::${t.pair}`;
        if (!lotsByKey.has(key)) lotsByKey.set(key, []);
        const lots = lotsByKey.get(key)!;

        const qty = Number(t.amount);
        const price = Number(t.price);
        if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price <= 0) continue;

        if (t.type === 'buy') {
          const lotId = `RB-${t.exchange}-${t.pair.replace('/', '')}-${t.tradeId}`;
          lots.push({ lotId, exchange: t.exchange, pair: t.pair, entryPrice: price, qty });
        } else if (t.type === 'sell') {
          let remaining = qty;
          while (remaining > 0 && lots.length > 0) {
            const head = lots[0];
            const take = Math.min(head.qty, remaining);
            head.qty -= take;
            remaining -= take;
            if (head.qty <= 0.00000001) {
              lots.shift();
            }
          }
        }
      }

      let created = 0;
      const byPair: Record<string, number> = {};

      for (const lots of lotsByKey.values()) {
        for (const lot of lots) {
          if (!Number.isFinite(lot.qty) || lot.qty <= 0) continue;
          const feePct = feePctForExchange(lot.exchange);
          const entryFee = lot.qty * lot.entryPrice * feePct;

          await storage.saveOpenPositionByLotId({
            lotId: lot.lotId,
            exchange: lot.exchange as any,
            pair: lot.pair,
            entryPrice: lot.entryPrice.toFixed(8),
            amount: lot.qty.toFixed(8),
            highestPrice: lot.entryPrice.toFixed(8),
            entryFee: entryFee.toFixed(8),
            entryStrategyId: 'rebuild',
            entrySignalTf: 'rebuild',
            entryMode: 'REBUILD',
          } as any);

          created++;
          const key = `${lot.exchange}:${lot.pair}`;
          byPair[key] = (byPair[key] || 0) + 1;
        }
      }

      res.json({
        success: true,
        exchange,
        since: since.toISOString(),
        deleted,
        tradesConsidered: trades.length,
        created,
        byPair,
      });
    } catch (e: any) {
      console.error('[admin/rebuild-positions] Error:', e?.message || e);
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.post("/api/positions/:pair/buy", async (req, res) => {
    try {
      const pair = req.params.pair.replace("-", "/");
      const { usdAmount, reason, confirm } = req.body;

      if (String(process.env.TRADING_ENABLED ?? 'true').toLowerCase() !== 'true') {
        return res.status(403).json({
          error: 'TRADING_DISABLED',
          message: 'Trading deshabilitado por kill-switch (TRADING_ENABLED!=true).',
        });
      }

      if (!tradingEngine) {
        return res.status(503).json({ error: "Motor de trading no inicializado" });
      }

      if (!confirm) {
        return res.status(400).json({
          error: "CONFIRM_REQUIRED",
          message: "Operación REAL: envía confirm=true para ejecutar la compra",
        });
      }

      const usdAmountNum = typeof usdAmount === "number" ? usdAmount : parseFloat(String(usdAmount || "0"));
      if (!Number.isFinite(usdAmountNum) || usdAmountNum <= 0) {
        return res.status(400).json({ error: "VALIDATION_ERROR", message: "usdAmount inválido" });
      }

      const correlationId = `MANUAL-BUY-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const reasonWithCorrelation = `${reason || "Compra manual (API)"} [${correlationId}]`;
      const result = await tradingEngine.manualBuyForTest(pair, usdAmountNum, reasonWithCorrelation);
      if (!result.success) {
        return res.status(400).json({ error: result.error || "BUY failed" });
      }

      res.json({ ...result, correlationId });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to execute manual buy" });
    }
  });

  // === CIERRE MANUAL DE POSICIÓN ===
  app.post("/api/positions/:pair/close", async (req, res) => {
    try {
      const pair = req.params.pair.replace("-", "/"); // Convert BTC-USD back to BTC/USD
      const { reason, lotId } = req.body; // Optional lotId for multi-lot support
      
      const correlationId = `MANUAL-CLOSE-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      
      // Verificar que la posición existe
      const positions = await storage.getOpenPositions();
      let position;
      if (lotId) {
        // Specific lot requested
        position = positions.find(p => p.lotId === lotId);
      } else {
        // Close first position for the pair
        position = positions.find(p => p.pair === pair);
      }
      
      if (!position) {
        await botLogger.warn("MANUAL_CLOSE_FAILED", `Intento de cierre manual fallido - posición no encontrada`, {
          pair,
          lotId: lotId || "not_specified",
          correlationId,
          reason: reason || "Usuario solicitó cierre manual",
        });
        
        return res.status(404).json({
          success: false,
          error: "POSITION_NOT_FOUND",
          message: `No se encontró posición abierta para ${pair}`,
        });
      }
      
      // Obtener precio actual (con fallback para DRY_RUN)
      let currentPrice: number;
      const botConfig = await storage.getBotConfig();
      const isDryRun = botConfig?.dryRunMode || environment.isReplit;
      
      if (krakenService.isInitialized()) {
        try {
          const krakenPair = krakenService.formatPair(pair);
          const ticker = await krakenService.getTickerRaw(krakenPair);
          const tickerData: any = Object.values(ticker)[0];
          
          if (tickerData?.c?.[0]) {
            currentPrice = parseFloat(tickerData.c[0]);
          } else {
            throw new Error("No ticker data");
          }
        } catch (e) {
          if (!isDryRun) {
            return res.status(500).json({
              success: false,
              error: "PRICE_UNAVAILABLE",
              message: "No se pudo obtener el precio actual",
            });
          }
          // En DRY_RUN, usar precio de entrada como fallback
          currentPrice = parseFloat(position.entryPrice);
        }
      } else {
        if (!isDryRun) {
          return res.status(503).json({
            success: false,
            error: "KRAKEN_NOT_INITIALIZED",
            message: "Kraken API no está conectada",
          });
        }
        // En DRY_RUN, usar precio de entrada como fallback (simulación)
        currentPrice = parseFloat(position.entryPrice);
      }
      const amount = parseFloat(position.amount);
      const entryPrice = parseFloat(position.entryPrice);
      const pnlUsd = (currentPrice - entryPrice) * amount;
      const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
      
      const positionLotId = position.lotId;
      
      // Log el intento de cierre manual
      await botLogger.info("MANUAL_CLOSE_INITIATED", `Cierre manual iniciado por usuario`, {
        correlationId,
        pair,
        lotId: positionLotId,
        amount,
        entryPrice,
        currentPrice,
        estimatedPnlUsd: pnlUsd.toFixed(2),
        estimatedPnlPct: pnlPct.toFixed(2),
        reason: reason || "Usuario solicitó cierre manual",
      });
      
      // Ejecutar la venta a través del trading engine
      if (!tradingEngine) {
        return res.status(503).json({
          success: false,
          error: "ENGINE_NOT_RUNNING",
          message: "Motor de trading no está activo",
        });
      }
      
      const closeResult = await tradingEngine.forceClosePosition(pair, currentPrice, correlationId, reason || "Cierre manual por usuario", positionLotId);
      
      if (closeResult.success) {
        await botLogger.info("MANUAL_CLOSE_SUCCESS", `Posición cerrada manualmente`, {
          correlationId,
          pair,
          lotId: closeResult.lotId || positionLotId,
          amount,
          exitPrice: currentPrice,
          realizedPnlUsd: closeResult.pnlUsd?.toFixed(2),
          realizedPnlPct: closeResult.pnlPct?.toFixed(2),
          krakenOrderId: closeResult.orderId,
          dryRun: closeResult.dryRun,
        });
        
        res.json({
          success: true,
          correlationId,
          pair,
          lotId: closeResult.lotId || positionLotId,
          amount,
          exitPrice: currentPrice,
          realizedPnlUsd: closeResult.pnlUsd?.toFixed(2),
          realizedPnlPct: closeResult.pnlPct?.toFixed(2),
          orderId: closeResult.orderId,
          message: closeResult.dryRun 
            ? `[DRY_RUN] Cierre simulado de ${pair}`
            : `Posición ${pair} cerrada exitosamente`,
        });
      } else {
        // Caso DUST: devolver 200 con flag isDust para que UI ofrezca "Eliminar huérfana"
        if (closeResult.isDust) {
          await botLogger.warn("MANUAL_CLOSE_DUST", `Posición DUST detectada - no se puede cerrar`, {
            correlationId,
            pair,
            lotId: positionLotId,
            error: closeResult.error,
          });
          
          return res.json({
            success: false,
            correlationId,
            error: "DUST_POSITION",
            isDust: true,
            lotId: positionLotId,
            message: closeResult.error || "Balance real menor al mínimo de Kraken",
          });
        }
        
        await botLogger.error("MANUAL_CLOSE_FAILED", `Error al cerrar posición manualmente`, {
          correlationId,
          pair,
          lotId: positionLotId,
          error: closeResult.error,
        });
        
        res.status(500).json({
          success: false,
          correlationId,
          error: "CLOSE_FAILED",
          message: closeResult.error || "Error al cerrar la posición",
        });
      }
      
    } catch (error: any) {
      const pair = req.params.pair?.replace("-", "/") || "UNKNOWN";
      const { lotId } = req.body || {};
      const botConfigErr = await storage.getBotConfig();
      const isDryRunErr = botConfigErr?.dryRunMode || environment.isReplit;
      
      console.error("[api/positions/close] FULL ERROR:", {
        message: error.message,
        stack: error.stack,
        pair,
        lotId: lotId || "not_specified",
        isDryRun: isDryRunErr,
        timestamp: new Date().toISOString(),
      });
      
      // Enviar alerta crítica de error en API de trading
      const alert = ErrorAlertService.createFromError(
        error,
        'TRADING_ERROR',
        'CRITICAL',
        'closePosition',
        'server/routes.ts',
        pair,
        { 
          endpoint: '/api/positions/close',
          lotId: lotId || "not_specified",
          isDryRun: isDryRunErr,
          userAgent: req.headers['user-agent']
        }
      );
      await errorAlertService.sendCriticalError(alert);
      
      await botLogger.error("MANUAL_CLOSE_EXCEPTION", `Excepción no controlada en cierre manual`, {
        pair,
        lotId: lotId || "not_specified",
        isDryRun: isDryRunErr,
        errorMessage: error.message,
        errorStack: error.stack,
      });
      
      res.status(500).json({
        success: false,
        error: "INTERNAL_ERROR",
        message: `Error al procesar cierre: ${error.message}`,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  });

  // === ELIMINAR POSICIÓN HUÉRFANA (DUST) ===
  // Solo elimina el registro interno de DB/memoria, NO envía orden a Kraken
  app.delete("/api/positions/:lotId/orphan", async (req, res) => {
    try {
      const lotId = req.params.lotId;
      const { reason } = req.body || {};
      
      // Verificar que la posición existe en DB
      const dbPosition = await storage.getOpenPositionByLotId(lotId);
      if (!dbPosition) {
        return res.status(404).json({
          success: false,
          error: "POSITION_NOT_FOUND",
          message: `No se encontró posición con lotId: ${lotId}`,
        });
      }
      
      const pair = dbPosition.pair;
      
      // Eliminar de DB
      await storage.deleteOpenPositionByLotId(lotId);
      
      // Eliminar de memoria del trading engine
      if (tradingEngine) {
        const positions = tradingEngine.getOpenPositions();
        positions.delete(lotId);
      }
      
      await botLogger.info("ORPHAN_POSITION_DELETED", `Posición huérfana eliminada manualmente`, {
        pair,
        lotId,
        amount: dbPosition.amount,
        entryPrice: dbPosition.entryPrice,
        reason: reason || "orphan_dust_cleanup",
        env: environment.isReplit ? "REPLIT" : "NAS",
      });
      
      // Notificar por Telegram
      if (telegramService?.isInitialized()) {
        await telegramService.sendMessage(`
🗑️ *Posición Huérfana Eliminada*

*Par:* ${pair}
*Lot:* \`${lotId.substring(0, 8)}...\`
*Cantidad:* ${dbPosition.amount}

_Eliminada manualmente desde dashboard (sin orden a Kraken)_
        `.trim());
      }
      
      res.json({
        success: true,
        lotId,
        pair,
        deleted: true,
        message: `Posición huérfana eliminada de BD`,
      });
      
    } catch (error: any) {
      console.error("[api/positions/orphan] Error:", error.message);
      res.status(500).json({
        success: false,
        error: "INTERNAL_ERROR",
        message: error.message,
      });
    }
  });

  // === TOGGLE TIME-STOP POR POSICIÓN ===
  // Nota: Este endpoint asume acceso seguro via red local o VPN, igual que otras rutas críticas
  app.patch("/api/positions/:lotId/time-stop", async (req, res) => {
    try {
      const lotId = req.params.lotId;
      const { disabled } = req.body;
      
      // Validación del body
      if (typeof disabled !== "boolean") {
        return res.status(400).json({
          success: false,
          error: "INVALID_REQUEST",
          message: "El campo 'disabled' debe ser un booleano (true/false)",
        });
      }
      
      const position = await storage.getOpenPositionByLotId(lotId);
      if (!position) {
        return res.status(404).json({
          success: false,
          error: "POSITION_NOT_FOUND",
          message: `No se encontró posición con lotId: ${lotId}`,
        });
      }
      
      // DB primero para garantizar persistencia - si falla, no actualizamos memoria
      const updatedPosition = await storage.updateOpenPositionByLotId(lotId, { 
        timeStopDisabled: disabled 
      });
      
      if (!updatedPosition) {
        return res.status(500).json({
          success: false,
          error: "UPDATE_FAILED",
          message: "No se pudo actualizar la posición en la base de datos",
        });
      }
      
      // Solo actualizamos memoria después de confirmar persistencia en DB
      if (tradingEngine) {
        const positions = tradingEngine.getOpenPositions();
        const memPos = positions.get(lotId) as any;
        if (memPos) {
          memPos.timeStopDisabled = disabled;
        }
      }
      
      console.log(`[TIME_STOP_TOGGLE] lotId=${lotId} pair=${position.pair} disabled=${disabled}`);
      
      res.json({
        success: true,
        lotId,
        pair: position.pair,
        timeStopDisabled: disabled,
        message: disabled ? "Time-stop desactivado para esta posición" : "Time-stop reactivado",
      });
      
    } catch (error: any) {
      console.error("[api/positions/time-stop] Error:", error.message);
      res.status(500).json({
        success: false,
        error: "INTERNAL_ERROR",
        message: error.message,
      });
    }
  });

  // NOTE: /api/positions/reconcile endpoint moved to after sync-revolutx
  // Now supports multi-exchange (kraken, revolutx) with real balance reconciliation

  app.get("/api/trades/closed", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = parseInt(req.query.offset as string) || 0;
      const pair = req.query.pair as string | undefined;
      const exchange = (req.query.exchange as 'kraken' | 'revolutx' | undefined);
      const result = (req.query.result as 'winner' | 'loser' | 'all') || 'all';
      const type = (req.query.type as 'all' | 'buy' | 'sell') || 'all';
      
      const { trades, total } = await storage.getClosedTrades({ limit, offset, pair, exchange, result, type });

      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const normalizeExchange = (t: any): 'kraken' | 'revolutx' => {
        const raw = (t?.exchange ?? '').toString().toLowerCase();
        if (raw === 'kraken' || raw === 'revolutx') return raw;
        const id = (t?.tradeId ?? '').toString();
        if (id.startsWith('RX-') || uuidV4Regex.test(id)) return 'revolutx';
        if (id.startsWith('KRAKEN-')) return 'kraken';
        return 'kraken';
      };
      
      res.json({
        trades: trades.map(t => {
          const price = parseFloat(t.price);
          const amount = parseFloat(t.amount);
          const totalUsd = price * amount;
          const entryValueUsd = t.entryPrice ? parseFloat(t.entryPrice) * amount : null;
          
          return {
            ...t,
            exchange: normalizeExchange(t),
            totalUsd: totalUsd.toFixed(2),
            entryValueUsd: entryValueUsd?.toFixed(2) || null,
            realizedPnlUsd: t.realizedPnlUsd ? parseFloat(t.realizedPnlUsd).toFixed(2) : null,
            realizedPnlPct: t.realizedPnlPct ? parseFloat(t.realizedPnlPct).toFixed(2) : null,
          };
        }),
        total,
        limit,
        offset,
      });
    } catch (error) {
      console.error("[api/trades/closed] Error:", error);
      res.status(500).json({ error: "Failed to get closed trades" });
    }
  });

  app.get("/api/performance", async (req, res) => {
    try {
      const trades = await storage.getTrades(500);
      
      const STARTING_EQUITY = 1000;
      
      const sortedTrades = [...trades].sort((a, b) => {
        const dateA = a.executedAt ? new Date(a.executedAt).getTime() : new Date(a.createdAt).getTime();
        const dateB = b.executedAt ? new Date(b.executedAt).getTime() : new Date(b.createdAt).getTime();
        return dateA - dateB;
      });

      const pairPrices: Record<string, { lastBuyPrice: number; lastBuyAmount: number }> = {};
      let currentEquity = STARTING_EQUITY;
      let totalPnl = 0;
      let wins = 0;
      let losses = 0;
      let maxEquity = STARTING_EQUITY;
      let maxDrawdown = 0;

      const firstTradeTime = sortedTrades.length > 0 
        ? new Date(sortedTrades[0].executedAt || sortedTrades[0].createdAt).toISOString()
        : new Date().toISOString();
      
      const curve: { time: string; equity: number; pnl?: number }[] = [
        { time: firstTradeTime, equity: STARTING_EQUITY }
      ];

      for (const trade of sortedTrades) {
        const pair = trade.pair;
        const price = parseFloat(trade.price);
        const amount = parseFloat(trade.amount);
        const time = trade.executedAt ? new Date(trade.executedAt).toISOString() : new Date(trade.createdAt).toISOString();

        if (trade.type === "buy") {
          pairPrices[pair] = { lastBuyPrice: price, lastBuyAmount: amount };
        } else if (trade.type === "sell") {
          const lastBuy = pairPrices[pair];
          if (lastBuy && lastBuy.lastBuyPrice > 0) {
            const pnl = (price - lastBuy.lastBuyPrice) * Math.min(amount, lastBuy.lastBuyAmount);
            totalPnl += pnl;
            currentEquity += pnl;

            if (pnl > 0) wins++;
            else if (pnl < 0) losses++;

            curve.push({ time, equity: currentEquity, pnl });

            if (currentEquity > maxEquity) maxEquity = currentEquity;
            const drawdown = ((maxEquity - currentEquity) / maxEquity) * 100;
            if (drawdown > maxDrawdown) maxDrawdown = drawdown;

            delete pairPrices[pair];
          }
        }
      }

      const totalTrades = wins + losses;
      const winRatePct = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
      const totalPnlPct = (totalPnl / STARTING_EQUITY) * 100;

      res.json({
        curve,
        summary: {
          startingEquity: STARTING_EQUITY,
          endingEquity: currentEquity,
          totalPnlUsd: totalPnl,
          totalPnlPct,
          maxDrawdownPct: maxDrawdown,
          winRatePct,
          totalTrades,
          wins,
          losses
        }
      });
    } catch (error) {
      console.error("Error calculating performance:", error);
      res.status(500).json({ error: "Failed to calculate performance" });
    }
  });

  app.get("/api/market/:pair", async (req, res) => {
    try {
      const { pair } = req.params;
      const ticker = await krakenService.getTickerRaw(pair);
      
      const tickerData: any = Object.values(ticker)[0] || {};
      const data = await storage.saveMarketData({
        pair,
        price: tickerData.c?.[0] || "0",
        volume24h: tickerData.v?.[1] || "0",
        change24h: "0",
      });
      
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: "Failed to get market data" });
    }
  });

  app.get("/api/balance", async (req, res) => {
    try {
      if (!krakenService.isInitialized()) {
        return res.status(400).json({ error: "Kraken not configured" });
      }
      
      const balance = await krakenService.getBalance();
      res.json(balance);
    } catch (error) {
      res.status(500).json({ error: "Failed to get balance" });
    }
  });

  // Multi-exchange balances endpoint
  app.get("/api/balances/all", async (req, res) => {
    try {
      const apiConfig = await storage.getApiConfig();
      const result: {
        kraken: { connected: boolean; balances: Record<string, number>; error?: string };
        revolutx: { connected: boolean; balances: Record<string, number>; error?: string };
        activeExchange: string;
        tradingExchange: string;
      } = {
        kraken: { connected: false, balances: {} },
        revolutx: { connected: false, balances: {} },
        activeExchange: apiConfig?.activeExchange || 'kraken',
        tradingExchange: apiConfig?.tradingExchange || apiConfig?.activeExchange || 'kraken',
      };

      // Fetch Kraken balances
      if (krakenService.isInitialized()) {
        result.kraken.connected = true;
        try {
          const rawBalances = await krakenService.getBalanceRaw();
          for (const [key, value] of Object.entries(rawBalances)) {
            const numValue = parseFloat(value);
            if (numValue > 0) {
              result.kraken.balances[key] = numValue;
            }
          }
        } catch (e: any) {
          result.kraken.error = e.message;
        }
      }

      // Fetch Revolut X balances
      if (revolutXService.isInitialized()) {
        result.revolutx.connected = true;
        try {
          const balances = await revolutXService.getBalance();
          for (const [key, val] of Object.entries(balances)) {
            const numVal = typeof val === 'number' ? val : parseFloat(String(val));
            if (numVal > 0) {
              result.revolutx.balances[key] = numVal;
            }
          }
        } catch (e: any) {
          result.revolutx.error = e.message;
        }
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to get multi-exchange balances" });
    }
  });

  // Get prices for all portfolio assets dynamically
  app.get("/api/prices/portfolio", async (req, res) => {
    try {
      const prices: Record<string, { price: number; source: string }> = {};
      const stablecoins = ["USD", "ZUSD", "USDC", "USDT", "EUR"];
      
      // Normalize Kraken symbols to standard tickers
      const krakenToStandard: Record<string, string> = {
        "XXBT": "BTC", "XBT": "BTC", "XETH": "ETH", "XXRP": "XRP",
        "XXLM": "XLM", "XLTC": "LTC", "XXDG": "DOGE", "ZUSD": "USD",
        "ZEUR": "EUR", "ZGBP": "GBP", "ZCAD": "CAD",
      };
      
      // Collect all unique assets from both exchanges (normalized)
      const assetBalances: Map<string, { balance: number; originalSymbol: string; exchange: string }> = new Map();
      
      if (krakenService.isInitialized()) {
        try {
          const rawBalances = await krakenService.getBalanceRaw();
          for (const [key, value] of Object.entries(rawBalances)) {
            const balance = parseFloat(value);
            if (balance > 0) {
              const normalized = krakenToStandard[key] || key;
              assetBalances.set(key, { balance, originalSymbol: key, exchange: 'kraken' });
              // Also add normalized version
              if (krakenToStandard[key]) {
                assetBalances.set(normalized, { balance, originalSymbol: key, exchange: 'kraken' });
              }
            }
          }
        } catch (e) { /* ignore */ }
      }
      
      if (revolutXService.isInitialized()) {
        try {
          const balances = await revolutXService.getBalance();
          for (const [key, val] of Object.entries(balances)) {
            const numVal = typeof val === 'number' ? val : parseFloat(String(val));
            if (numVal > 0) {
              assetBalances.set(key, { balance: numVal, originalSymbol: key, exchange: 'revolutx' });
            }
          }
        } catch (e) { /* ignore */ }
      }
      
      // Stablecoins have fixed USD value
      for (const stable of stablecoins) {
        if (assetBalances.has(stable)) {
          prices[stable] = { price: stable === "EUR" ? 1.08 : 1, source: "fixed" };
        }
      }
      
      // Map standard symbols to Kraken trading pairs
      const krakenPairMap: Record<string, string> = {
        "XXBT": "XXBTZUSD", "BTC": "XXBTZUSD",
        "XETH": "XETHZUSD", "ETH": "XETHZUSD",
        "SOL": "SOLUSD", "XXRP": "XXRPZUSD", "XRP": "XXRPZUSD",
        "TON": "TONUSD", "DOT": "DOTUSD", "ADA": "ADAUSD",
        "LINK": "LINKUSD", "AVAX": "AVAXUSD", "MATIC": "MATICUSD",
        "XLM": "XLMUSD", "LTC": "XLTCZUSD", "DOGE": "XDGUSD",
      };
      
      // CoinGecko ID mapping for common assets
      const coinGeckoIds: Record<string, string> = {
        "BTC": "bitcoin", "ETH": "ethereum", "SOL": "solana",
        "XRP": "ripple", "TON": "the-open-network", "DOT": "polkadot",
        "ADA": "cardano", "LINK": "chainlink", "AVAX": "avalanche-2",
        "MATIC": "matic-network", "XLM": "stellar", "LTC": "litecoin",
        "DOGE": "dogecoin", "VET": "vechain", "FLR": "flare-networks",
        "MEW": "cat-in-a-dogs-world", "LMWR": "limewire", "ZKJ": "polyhedra-network",
        "USDC": "usd-coin", "USDT": "tether",
      };
      
      // Collect assets that need prices
      const assetsNeedingPrices: string[] = [];
      for (const [asset] of Array.from(assetBalances.entries())) {
        if (stablecoins.includes(asset)) continue;
        if (prices[asset]) continue;
        // Normalize Kraken prefixes
        const normalized = krakenToStandard[asset] || asset;
        if (!assetsNeedingPrices.includes(normalized)) {
          assetsNeedingPrices.push(normalized);
        }
      }
      
      // Try to fetch all prices from CoinGecko in one request (most efficient)
      const coinGeckoIdsToFetch = assetsNeedingPrices
        .map(a => coinGeckoIds[a])
        .filter(Boolean);
      
      if (coinGeckoIdsToFetch.length > 0) {
        try {
          const ids = coinGeckoIdsToFetch.join(',');
          const cgResponse = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
            { headers: { 'Accept': 'application/json' } }
          );
          if (cgResponse.ok) {
            const cgPrices = await cgResponse.json() as Record<string, { usd?: number }>;
            // Map CoinGecko prices back to symbols
            for (const [symbol, cgId] of Object.entries(coinGeckoIds)) {
              if (cgPrices[cgId]?.usd) {
                prices[symbol] = { price: cgPrices[cgId].usd, source: "coingecko" };
                // Also add Kraken prefix version
                const krakenSymbol = Object.entries(krakenToStandard).find(([_, v]) => v === symbol)?.[0];
                if (krakenSymbol) {
                  prices[krakenSymbol] = prices[symbol];
                }
              }
            }
          }
        } catch (e: any) {
          console.log('[prices/portfolio] CoinGecko fallback failed:', e.message);
        }
      }
      
      // Fetch remaining prices from exchanges
      for (const [asset, info] of Array.from(assetBalances.entries())) {
        if (stablecoins.includes(asset)) continue;
        if (prices[asset]) continue; // Already have price from CoinGecko
        
        // Skip Kraken prefix duplicates (we'll use the normalized version)
        const normalized = krakenToStandard[asset];
        if (normalized && prices[normalized]) {
          prices[asset] = prices[normalized];
          continue;
        }
        
        // Try Revolut X for altcoins
        if (revolutXService.isInitialized()) {
          try {
            const pair = `${asset}-USD`;
            const ticker = await revolutXService.getTicker(pair);
            if (ticker && ticker.last > 0) {
              prices[asset] = { price: ticker.last, source: "revolutx" };
              continue;
            }
          } catch (e: any) {
            // Log only if not a 404/not found error
            if (!e.message?.includes('404') && !e.message?.includes('not found')) {
              console.log(`[prices/portfolio] RevolutX ${asset}: ${e.message}`);
            }
          }
        }
        
        // Try Kraken
        if (krakenService.isInitialized()) {
          try {
            const krakenPair = krakenPairMap[asset] || krakenPairMap[info.originalSymbol];
            if (krakenPair) {
              const ticker = await krakenService.getTicker(krakenPair) as any;
              if (ticker && ticker.c && ticker.c[0]) {
                prices[asset] = { price: parseFloat(ticker.c[0]), source: "kraken" };
                continue;
              }
            }
          } catch (e) { /* ignore */ }
        }
        
        // No price found - mark as unavailable
        prices[asset] = { price: 0, source: "unavailable" };
      }
      
      res.json({ prices, fetchedAt: new Date().toISOString() });
    } catch (error: any) {
      console.error("[api/prices/portfolio] Error:", error.message);
      res.status(500).json({ error: "Failed to get portfolio prices" });
    }
  });

  app.post("/api/trade", async (req, res) => {
    try {
      if (String(process.env.TRADING_ENABLED ?? 'true').toLowerCase() !== 'true') {
        return res.status(403).json({
          error: 'TRADING_DISABLED',
          message: 'Trading deshabilitado por kill-switch (TRADING_ENABLED!=true).',
        });
      }

      if (!krakenService.isInitialized()) {
        return res.status(400).json({ error: "Kraken not configured" });
      }

      const { pair, type, ordertype, volume, price } = req.body;
      
      const tradeId = `T-${Date.now()}`;
      
      const trade = await storage.createTrade({
        tradeId,
        exchange: 'kraken',
        origin: 'manual',  // Manual API call
        pair,
        type,
        price: price || "0",
        amount: volume,
        status: "pending",
      });

      const order = await krakenService.placeOrder({
        pair,
        type,
        ordertype,
        volume,
        price,
      });

      await storage.updateTradeStatus(tradeId, "filled", (order as any).txid?.[0]);
      
      await telegramService.sendTradeNotification({
        type,
        pair,
        price: price || "market",
        amount: volume,
        status: "filled",
      });

      res.json({ success: true, trade, order });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to place trade" });
    }
  });

  // Endpoint para trading con RevolutX
  app.post("/api/trade/revolutx", async (req, res) => {
    try {
      if (String(process.env.TRADING_ENABLED ?? 'true').toLowerCase() !== 'true') {
        return res.status(403).json({
          error: 'TRADING_DISABLED',
          message: 'Trading deshabilitado por kill-switch (TRADING_ENABLED!=true).',
        });
      }

      const { pair, type, ordertype, volume } = req.body;
      
      if (!pair || !type || !volume) {
        return res.status(400).json({ 
          error: "Missing required parameters: pair, type, volume" 
        });
      }
      
      if (!["buy", "sell"].includes(type)) {
        return res.status(400).json({ 
          error: "Invalid order type. Must be 'buy' or 'sell'" 
        });
      }
      
      // Usar RevolutXService ya inicializado globalmente
      if (!revolutXService.isInitialized()) {
        return res.status(400).json({ 
          error: "RevolutX not initialized" 
        });
      }
      
      console.log(`[API] RevolutX trade request: ${type} ${volume} ${pair}`);
      
      // Ejecutar la orden
      const order = await revolutXService.placeOrder({
        pair,
        type: type as "buy" | "sell",
        ordertype: ordertype || "market",
        volume: volume.toString()
      });
      
      if (!order.success) {
        console.error(`[API] RevolutX trade failed:`, order.error);
        return res.status(400).json({ 
          error: order.error || "Trade failed" 
        });
      }
      
      // Guardar en base de datos usando el ID de RevolutX
      const tradeId = order.orderId || `RX-${Date.now()}`;

      let resolvedPrice = typeof order.price === 'number' ? order.price : parseFloat(String(order.price || '0'));
      const resolvedVol = typeof order.volume === 'number' ? order.volume : parseFloat(String(order.volume || volume || '0'));
      const resolvedCost = typeof order.cost === 'number' ? order.cost : parseFloat(String(order.cost || '0'));

      if ((!Number.isFinite(resolvedPrice) || resolvedPrice <= 0) && Number.isFinite(resolvedCost) && resolvedCost > 0 && Number.isFinite(resolvedVol) && resolvedVol > 0) {
        resolvedPrice = resolvedCost / resolvedVol;
      }

      if (!Number.isFinite(resolvedPrice) || resolvedPrice <= 0) {
        try {
          const ticker = await revolutXService.getTicker(pair);
          resolvedPrice = type === 'buy' ? ticker.ask : ticker.bid;
        } catch {
          // Ignore
        }
      }

      if (!Number.isFinite(resolvedPrice) || resolvedPrice <= 0) {
        return res.status(400).json({ error: 'RevolutX order executed but price could not be determined (avoiding price=0 trade)' });
      }

      const trade = await storage.createTrade({
        tradeId,
        exchange: 'revolutx',
        origin: 'manual',  // Manual API call
        pair,
        type,
        price: resolvedPrice.toString(),
        amount: (Number.isFinite(resolvedVol) && resolvedVol > 0 ? resolvedVol : parseFloat(volume.toString())).toString(),
        status: "filled",
      });
      
      // Enviar notificación a Telegram
      await telegramService.sendTradeNotification({
        type,
        pair,
        price: resolvedPrice.toString(),
        amount: (Number.isFinite(resolvedVol) && resolvedVol > 0 ? resolvedVol : parseFloat(volume.toString())).toString(),
        status: "filled",
      });
      
      console.log(`[API] RevolutX trade executed: ${tradeId}`);
      
      res.json({ 
        success: true, 
        trade: {
          tradeId,
          pair,
          type,
          amount: order.volume?.toString() || volume.toString(),
          price: order.price,
          cost: order.cost,
          status: "filled"
        },
        order 
      });
      
    } catch (error: any) {
      console.error(`[API] RevolutX trade error:`, error);
      res.status(500).json({ 
        error: error.message || "Failed to place RevolutX trade" 
      });
    }
  });

  app.get("/api/notifications", async (req, res) => {
    try {
      const notifications = await storage.getUnsentNotifications();
      res.json(notifications);
    } catch (error) {
      res.status(500).json({ error: "Failed to get notifications" });
    }
  });

  app.post("/api/trades/sync-revolutx", async (req, res) => {
    try {
      if (String(process.env.REVOLUTX_SYNC_ENABLED || '').toLowerCase() !== 'true') {
        return res.status(403).json({
          error: 'REVOLUTX_SYNC_DISABLED',
          message: 'RevolutX sync deshabilitado en este entorno (REVOLUTX_SYNC_ENABLED!=true). RevolutX real solo funciona en VPS con IP whitelisted.',
        });
      }

      if (!revolutXService.isInitialized()) {
        return res.status(400).json({ error: "RevolutX not configured" });
      }

      const pairRaw = (req.body?.pair ?? req.query?.pair ?? '').toString().trim();
      const scope = pairRaw ? pairRaw : 'ALL';

      const now = new Date();
      const nowMs = now.getTime();

      const limit = Math.min(100, Math.max(1, Number(req.body?.limit ?? req.query?.limit ?? 100)));
      const debug = String(req.body?.debug ?? req.query?.debug ?? '').toLowerCase() === 'true' || String(req.query?.debug) === '1';
      const allowAssumedSide = String(req.body?.allowAssumedSide ?? req.query?.allowAssumedSide ?? '').toLowerCase() === 'true' || String(req.query?.allowAssumedSide) === '1';

      const sinceDefaultIso = (process.env.REVOLUTX_SYNC_SINCE_DEFAULT || '2026-01-17T00:00:00Z');
      const sinceDefault = new Date(sinceDefaultIso);
      if (isNaN(sinceDefault.getTime())) {
        return res.status(500).json({ error: 'INVALID_REVOLUTX_SYNC_SINCE_DEFAULT', message: `REVOLUTX_SYNC_SINCE_DEFAULT inválido: ${sinceDefaultIso}` });
      }

      const sinceOverrideRaw = (req.body?.since ?? req.query?.since ?? '').toString().trim();
      const sinceOverride = sinceOverrideRaw ? new Date(sinceOverrideRaw) : null;
      if (sinceOverrideRaw && (!sinceOverride || isNaN(sinceOverride.getTime()))) {
        return res.status(400).json({ error: 'INVALID_SINCE', message: `since inválido: ${sinceOverrideRaw}` });
      }

      let synced = 0;
      let skipped = 0;
      let assumedSideCount = 0;
      const errors: string[] = [];
      let totalFetched = 0;
      const debugSamples: any[] = [];

      const botConfig = await storage.getBotConfig();
      const activePairs = (botConfig as any)?.activePairs as string[] | undefined;
      const pairsToSync = pairRaw ? [pairRaw] : (Array.isArray(activePairs) && activePairs.length > 0 ? activePairs : []);
      if (!pairRaw && pairsToSync.length === 0) {
        return res.status(400).json({
          error: 'ACTIVE_PAIRS_REQUIRED',
          message: 'No hay pares activos en config (botConfig.activePairs). Define activePairs o envía pair específico para debug.',
        });
      }

      const stateBefore = await storage.getExchangeSyncState('revolutx', scope);
      const sinceFromState = stateBefore?.cursorValue ? new Date(stateBefore.cursorValue) : null;
      const since = sinceOverride || sinceFromState || sinceDefault;

      await storage.upsertExchangeSyncState({
        exchange: 'revolutx',
        scope,
        cursorType: 'timestamp',
        cursorValue: stateBefore?.cursorValue ?? null,
        lastRunAt: now,
        lastOkAt: stateBefore?.lastOkAt ?? null,
        lastError: null,
      });

      const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
      const sinceMs = since.getTime();
      if (!Number.isFinite(sinceMs) || sinceMs <= 0 || sinceMs > nowMs) {
        return res.status(400).json({ error: 'INVALID_SINCE_RANGE', message: `since fuera de rango: ${since.toISOString()}` });
      }

      const byPair: Record<string, { fetched: number; inserted: number; skipped: number; assumedSideCount: number; errors: number }> = {};
      let maxExecutedAtSeenMs = sinceMs;

      const inferSide = (t: any, qtyRaw: any): { side: "buy" | "sell" | null; assumed: boolean } => {
        const sideRaw = (t?.side ?? t?.type ?? t?.direction ?? t?.taker_side ?? t?.maker_side ?? t?.aggressor_side ?? '').toString().toLowerCase();
        if (sideRaw === 'buy' || sideRaw === 'sell') return { side: sideRaw, assumed: false };
        if (sideRaw === 'b' || sideRaw === 'bid') return { side: 'buy', assumed: false };
        if (sideRaw === 's' || sideRaw === 'ask') return { side: 'sell', assumed: false };

        const isBuyer = t?.is_buyer ?? t?.isBuyer ?? t?.buyer;
        if (typeof isBuyer === 'boolean') return { side: isBuyer ? 'buy' : 'sell', assumed: false };

        const qtyNum = typeof qtyRaw === 'string' ? Number(qtyRaw) : qtyRaw;
        if (Number.isFinite(qtyNum)) {
          if (qtyNum < 0) return { side: 'sell', assumed: false };
          if (qtyNum > 0) {
            return allowAssumedSide ? { side: 'buy', assumed: true } : { side: null, assumed: false };
          }
        }
        if (typeof qtyRaw === 'string' && qtyRaw.trim().startsWith('-')) return { side: 'sell', assumed: false };

        return { side: null, assumed: false };
      };

      const normalizeTrade = (t: any) => {
        const tradeId = t?.tid || t?.id || t?.trade_id || t?.transaction_id || t?.txid;

        const tsRaw = t?.tdt ?? t?.timestamp ?? t?.time ?? t?.date ?? t?.created_at ?? t?.published_at;
        const tsNum = typeof tsRaw === 'string' ? Number(tsRaw) : tsRaw;
        const executedAt = Number.isFinite(tsNum) ? new Date(tsNum) : new Date(tsRaw);

        const priceRaw = t?.p ?? t?.price;
        const qtyRaw = t?.q ?? t?.quantity ?? t?.qty;
        const { side: type, assumed } = inferSide(t, qtyRaw);

        const qtyNum = typeof qtyRaw === 'string' ? Number(qtyRaw) : qtyRaw;
        const amountAbs = Number.isFinite(qtyNum) ? Math.abs(qtyNum) : qtyRaw;

        return {
          tradeId,
          executedAt,
          price: priceRaw,
          amount: amountAbs,
          type,
          assumed,
        };
      };

      const syncPair = async (pairToSync: string) => {
        const symbol = pairToSync.replace('/', '-');
        const pair = symbol.replace('-', '/');
        if (!byPair[pair]) {
          byPair[pair] = { fetched: 0, inserted: 0, skipped: 0, assumedSideCount: 0, errors: 0 };
        }

        const fetchWindow = async (windowStart: number, windowEnd: number) => {
          let cursor: string | undefined = undefined;
          let page = 0;
          while (true) {
            page++;
            const { trades, nextCursor } = await revolutXService.listPrivateTrades({
              symbol,
              startMs: windowStart,
              endMs: windowEnd,
              cursor,
              limit,
              debug,
            });

            totalFetched += trades.length;
            byPair[pair].fetched += trades.length;

            for (const t of trades) {
              const n = normalizeTrade(t);
              if (!n.tradeId) {
                skipped++;
                byPair[pair].skipped++;
                continue;
              }
              if (!n.type) {
                if (debug && debugSamples.length < 5) {
                  debugSamples.push({
                    tradeId: String(n.tradeId),
                    keys: Object.keys(t || {}),
                    sample: t,
                  });
                }
                errors.push(`${pair}:${n.tradeId}: missing side/type`);
                byPair[pair].errors++;
                skipped++;
                byPair[pair].skipped++;
                continue;
              }
              if (n.assumed) {
                assumedSideCount++;
                byPair[pair].assumedSideCount++;
              }
              if (!(n.executedAt instanceof Date) || isNaN(n.executedAt.getTime())) {
                errors.push(`${pair}:${n.tradeId}: invalid executedAt`);
                byPair[pair].errors++;
                skipped++;
                byPair[pair].skipped++;
                continue;
              }

              const executedAtMs = n.executedAt.getTime();
              if (Number.isFinite(executedAtMs) && executedAtMs > maxExecutedAtSeenMs) {
                maxExecutedAtSeenMs = executedAtMs;
              }

              const priceStr = n.price != null ? String(n.price) : "0";
              const amountStr = n.amount != null ? String(n.amount) : "0";

              const canonicalTrade = {
                exchange: "revolutx",
                pair,
                executedAt: n.executedAt,
                type: n.type,
                price: priceStr,
                amount: amountStr,
                externalId: n.tradeId ? String(n.tradeId) : undefined,
              } as const;

              const tradeIdFinal = buildTradeId(canonicalTrade);

              try {
                const { inserted } = await storage.insertTradeIgnoreDuplicate({
                  tradeId: tradeIdFinal,
                  krakenOrderId: undefined,
                  pair,
                  type: n.type,
                  price: priceStr,
                  amount: amountStr,
                  status: 'filled',
                  executedAt: n.executedAt,
                  exchange: 'revolutx',
                  origin: 'sync',
                });

                if (inserted) {
                  synced++;
                  byPair[pair].inserted++;

                  // NOTE: Position creation/deletion is now handled by reconcile-with-balance
                  // Sync only imports trades to DB, reconcile handles position state based on real balances
                  // This prevents "resurrection" of sold positions
                  console.log(`[sync-revolutx] Trade synced: ${n.type} ${pair} ${amountStr} @ ${priceStr}`);

                  if (String(process.env.ALERT_EXTERNAL_TRADES ?? 'false').toLowerCase() === 'true') {
                    const executedAt = n.executedAt instanceof Date ? n.executedAt : null;
                    const windowMin = Math.max(1, Number(process.env.EXTERNAL_ALERT_WINDOW_MIN ?? 10));
                    const rateLimitSec = Math.max(10, Number(process.env.EXTERNAL_ALERT_RATE_LIMIT_SEC ?? 60));
                    const key = `revolutx:${pair}`;
                    const lastSent = externalTradeAlertThrottle.get(key) || 0;
                    const nowTs = Date.now();

                    if (executedAt && (nowTs - executedAt.getTime()) <= windowMin * 60 * 1000 && (nowTs - lastSent) >= rateLimitSec * 1000) {
                      externalTradeAlertThrottle.set(key, nowTs);
                      if (telegramService?.isInitialized()) {
                        const msg = [
                          `<b>⚠️ Trade importado detectado (SYNC)</b>`,
                          `Exchange: <code>REVOLUTX</code>`,
                          `Par: <code>${pair}</code>`,
                          `Tipo: <code>${n.type}</code>`,
                          `Cantidad: <code>${amountStr}</code>`,
                          `Precio: <code>${priceStr}</code>`,
                          `ExecutedAt: <code>${executedAt.toISOString()}</code>`,
                        ].join("\n");
                        await telegramService.sendAlertToMultipleChats(msg, "trades");
                      }
                    }
                  }
                } else {
                  skipped++;
                  byPair[pair].skipped++;
                }
              } catch (e: any) {
                console.error('[sync-revolutx] Error syncing trade:', n.tradeId, e.message);
                errors.push(`${pair}:${n.tradeId}: ${e.message}`);
                byPair[pair].errors++;
              }
            }

            if (!nextCursor || nextCursor === cursor) break;
            cursor = nextCursor;

            if (page > 2000) {
              errors.push(`Pagination safety break after ${page} pages for ${symbol}`);
              break;
            }
          }
        };

        if (nowMs - sinceMs <= WEEK_MS) {
          await fetchWindow(sinceMs, nowMs);
        } else {
          let ws = sinceMs;
          while (ws < nowMs) {
            const we = Math.min(nowMs, ws + WEEK_MS);
            await fetchWindow(ws, we);
            ws = we;
          }
        }
      };

      try {
        for (const p of pairsToSync) {
          await syncPair(p);
        }

        const cursorValueToSave = maxExecutedAtSeenMs > sinceMs ? new Date(maxExecutedAtSeenMs) : since;
        await storage.upsertExchangeSyncState({
          exchange: 'revolutx',
          scope,
          cursorType: 'timestamp',
          cursorValue: cursorValueToSave,
          lastRunAt: now,
          lastOkAt: now,
          lastError: null,
        });

        res.json({
          scope,
          pairsToSync,
          since: since.toISOString(),
          cursorBefore: stateBefore?.cursorValue ? new Date(stateBefore.cursorValue).toISOString() : undefined,
          cursorAfter: cursorValueToSave.toISOString(),
          synced,
          skipped,
          assumedSideCount: assumedSideCount > 0 ? assumedSideCount : undefined,
          fetched: totalFetched,
          byPair,
          limit,
          allowAssumedSide: allowAssumedSide ? true : undefined,
          errors: errors.length > 0 ? errors.slice(0, 50) : undefined,
          debugSamples: debug ? debugSamples : undefined,
        });
      } catch (e: any) {
        await storage.upsertExchangeSyncState({
          exchange: 'revolutx',
          scope,
          cursorType: 'timestamp',
          cursorValue: stateBefore?.cursorValue ?? null,
          lastRunAt: now,
          lastOkAt: stateBefore?.lastOkAt ?? null,
          lastError: e?.message || String(e),
        });
        throw e;
      }
    } catch (error: any) {
      console.error('[sync-revolutx] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // RECONCILE: Limpia posiciones del bot que no tienen balance real
  // REGLA ÚNICA: open_positions = solo posiciones del bot (engine), nunca balances externos
  // 
  // FUNCIONAMIENTO:
  // - Elimina posiciones del bot si balance real del asset es 0 (autoClean)
  // - Actualiza qty SOLO si la posición es del bot (engine-managed)
  // - PROHIBIDO: crear posiciones desde balances externos
  app.post("/api/positions/reconcile", async (req, res) => {
    try {
      const { exchange = 'kraken', dryRun = false, autoClean = true } = req.body;
      
      // Dust threshold per asset (minimum tradeable amount)
      const dustThresholds: Record<string, number> = {
        BTC: 0.0001,
        ETH: 0.001,
        SOL: 0.01,
        XRP: 1,
        TON: 1,
        USD: 1,
        EUR: 1,
      };
      
      // Asset to pair mapping
      const assetToPair: Record<string, string> = {
        BTC: 'BTC/USD',
        ETH: 'ETH/USD',
        SOL: 'SOL/USD',
        XRP: 'XRP/USD',
        TON: 'TON/USD',
      };
      
      let realBalances: Record<string, number> = {};
      
      // Get real balances from exchange
      if (exchange === 'revolutx') {
        if (!revolutXService.isInitialized()) {
          return res.status(400).json({ error: 'RevolutX not configured' });
        }
        realBalances = await revolutXService.getBalance();
      } else if (exchange === 'kraken') {
        if (!krakenService.isInitialized()) {
          return res.status(400).json({ error: 'Kraken not configured' });
        }
        const krakenBalances = await krakenService.getBalanceRaw();
        // Map Kraken asset names to standard names
        const krakenAssetMap: Record<string, string> = {
          XXBT: 'BTC', XBT: 'BTC',
          XETH: 'ETH', ETH: 'ETH',
          SOL: 'SOL',
          XXRP: 'XRP', XRP: 'XRP',
          TON: 'TON',
          ZUSD: 'USD', USD: 'USD',
          ZEUR: 'EUR', EUR: 'EUR',
        };
        for (const [key, val] of Object.entries(krakenBalances)) {
          const standardAsset = krakenAssetMap[key] || key;
          realBalances[standardAsset] = parseFloat(String(val) || '0');
        }
      } else {
        return res.status(400).json({ error: `Exchange '${exchange}' not supported for reconcile` });
      }
      
      console.log(`[reconcile] Real balances from ${exchange}:`, realBalances);
      
      // Get current config for SMART_GUARD snapshot
      const currentConfig = await storage.getBotConfig();
      const positionMode = currentConfig?.positionMode || "SMART_GUARD";
      
      const buildConfigSnapshot = (pair: string) => {
        const snapshot: any = {
          stopLossPercent: parseFloat(currentConfig?.stopLossPercent?.toString() || "5"),
          takeProfitPercent: parseFloat(currentConfig?.takeProfitPercent?.toString() || "7"),
          trailingStopEnabled: currentConfig?.trailingStopEnabled ?? false,
          trailingStopPercent: parseFloat(currentConfig?.trailingStopPercent?.toString() || "2"),
          positionMode,
        };
        if (positionMode === "SMART_GUARD") {
          const overrides = (currentConfig?.sgPairOverrides as Record<string, any>)?.[pair];
          snapshot.sgMinEntryUsd = parseFloat(overrides?.sgMinEntryUsd?.toString() || currentConfig?.sgMinEntryUsd?.toString() || "100");
          snapshot.sgAllowUnderMin = overrides?.sgAllowUnderMin ?? currentConfig?.sgAllowUnderMin ?? true;
          snapshot.sgBeAtPct = parseFloat(overrides?.sgBeAtPct?.toString() || currentConfig?.sgBeAtPct?.toString() || "1.5");
          snapshot.sgFeeCushionPct = parseFloat(overrides?.sgFeeCushionPct?.toString() || currentConfig?.sgFeeCushionPct?.toString() || "0.45");
          snapshot.sgFeeCushionAuto = overrides?.sgFeeCushionAuto ?? currentConfig?.sgFeeCushionAuto ?? true;
          snapshot.sgTrailStartPct = parseFloat(overrides?.sgTrailStartPct?.toString() || currentConfig?.sgTrailStartPct?.toString() || "2");
          snapshot.sgTrailDistancePct = parseFloat(overrides?.sgTrailDistancePct?.toString() || currentConfig?.sgTrailDistancePct?.toString() || "1.5");
          snapshot.sgTrailStepPct = parseFloat(overrides?.sgTrailStepPct?.toString() || currentConfig?.sgTrailStepPct?.toString() || "0.25");
          snapshot.sgTpFixedEnabled = overrides?.sgTpFixedEnabled ?? currentConfig?.sgTpFixedEnabled ?? false;
          snapshot.sgTpFixedPct = parseFloat(overrides?.sgTpFixedPct?.toString() || currentConfig?.sgTpFixedPct?.toString() || "10");
          snapshot.sgScaleOutEnabled = overrides?.sgScaleOutEnabled ?? currentConfig?.sgScaleOutEnabled ?? false;
          snapshot.sgScaleOutPct = parseFloat(overrides?.sgScaleOutPct?.toString() || currentConfig?.sgScaleOutPct?.toString() || "35");
          snapshot.sgMinPartUsd = parseFloat(overrides?.sgMinPartUsd?.toString() || currentConfig?.sgMinPartUsd?.toString() || "50");
          snapshot.sgScaleOutThreshold = parseFloat(overrides?.sgScaleOutThreshold?.toString() || currentConfig?.sgScaleOutThreshold?.toString() || "80");
        }
        return snapshot;
      };
      
      // Get existing positions for this exchange
      const existingPositions = await storage.getOpenPositions();
      const exchangePositions = existingPositions.filter(p => 
        (p.exchange || 'kraken').toLowerCase() === exchange.toLowerCase()
      );
      
      const results: any[] = [];
      let created = 0;
      let deleted = 0;
      let updated = 0;
      let unchanged = 0;
      
      // Build set of pairs with positions
      const positionsByPair = new Map<string, typeof exchangePositions[0]>();
      for (const pos of exchangePositions) {
        positionsByPair.set(pos.pair, pos);
      }
      
      // 1) Check each asset with balance > dust → create position if missing
      for (const [asset, balance] of Object.entries(realBalances)) {
        const pair = assetToPair[asset];
        if (!pair) continue; // Skip non-tradeable assets (USD, EUR, etc.)
        
        const dust = dustThresholds[asset] || 0.0001;
        const existingPos = positionsByPair.get(pair);
        
        if (balance <= dust) {
          // Balance is dust or zero
          if (existingPos) {
            // Position exists but balance is 0 → DELETE (prevent resurrection)
            if (dryRun) {
              results.push({ pair, asset, action: 'would_delete', reason: 'balance_zero', balance, dust, lotId: existingPos.lotId });
            } else if (autoClean) {
              await storage.deleteOpenPositionByLotId(existingPos.lotId);
              await botLogger.info("POSITION_DELETED_RECONCILE", `Position deleted: balance is zero/dust`, {
                pair, asset, balance, dust, lotId: existingPos.lotId, exchange,
              });
              results.push({ pair, asset, action: 'deleted', reason: 'balance_zero', balance, dust, lotId: existingPos.lotId });
              deleted++;
            } else {
              results.push({ pair, asset, action: 'orphan', reason: 'balance_zero_no_autoclean', balance, dust, lotId: existingPos.lotId });
            }
          }
          // No position and no balance → nothing to do
        } else {
          // Balance > dust
          if (!existingPos) {
            // REGLA ÚNICA: NO crear posiciones desde balances externos
            // Los balances del exchange NO se reflejan como open_positions
            results.push({ 
              pair, asset, action: 'skipped_external_balance', balance, 
              reason: 'External balance exists - NOT creating position (open_positions = bot positions only)' 
            });
          } else {
            // Position exists and has balance → check if qty matches
            const posAmount = parseFloat(existingPos.amount || '0');
            const diff = Math.abs(balance - posAmount);
            const diffPct = posAmount > 0 ? (diff / posAmount) * 100 : 100;
            
            // REGLA ÚNICA: Solo actualizar qty si la posición es del bot (engine-managed)
            // Las posiciones del bot tienen configSnapshot y lotId sin prefijos especiales
            const isBotPosition = existingPos.configSnapshotJson != null && 
                                 existingPos.entryMode === 'SMART_GUARD' &&
                                 !existingPos.lotId?.startsWith('reconcile-') &&
                                 !existingPos.lotId?.startsWith('sync-') &&
                                 !existingPos.lotId?.startsWith('adopt-');
            
            if (diffPct > 5) { // More than 5% difference
              if (!isBotPosition) {
                // NO actualizar posiciones que no son del bot
                results.push({ 
                  pair, asset, action: 'skipped_not_bot_position', 
                  balance, posAmount, diffPct: diffPct.toFixed(2),
                  reason: 'Position is not a bot position (no configSnapshot or has special lotId prefix)',
                  lotId: existingPos.lotId,
                });
              } else if (dryRun) {
                results.push({ pair, asset, action: 'would_update', balance, posAmount, diffPct: diffPct.toFixed(2) });
              } else {
                // Update position amount to match real balance (only for bot positions)
                await storage.saveOpenPositionByLotId({
                  pair: existingPos.pair,
                  exchange: existingPos.exchange,
                  lotId: existingPos.lotId,
                  amount: balance.toFixed(8),
                  entryPrice: existingPos.entryPrice,
                  highestPrice: existingPos.highestPrice,
                  entryMode: existingPos.entryMode || undefined,
                  configSnapshotJson: existingPos.configSnapshotJson as any,
                  sgBreakEvenActivated: existingPos.sgBreakEvenActivated ?? false,
                  sgTrailingActivated: existingPos.sgTrailingActivated ?? false,
                  sgScaleOutDone: existingPos.sgScaleOutDone ?? false,
                });
                await botLogger.info("POSITION_UPDATED_RECONCILE", `Bot position qty updated to match real balance`, {
                  pair, asset, oldAmount: posAmount, newAmount: balance, diffPct: diffPct.toFixed(2), exchange,
                });
                results.push({ pair, asset, action: 'updated', balance, oldAmount: posAmount, diffPct: diffPct.toFixed(2) });
                updated++;
              }
            } else {
              results.push({ pair, asset, action: 'unchanged', balance, posAmount });
              unchanged++;
            }
          }
        }
      }
      
      // 2) Check positions without corresponding balance (orphans)
      for (const pos of exchangePositions) {
        const asset = pos.pair.split('/')[0]; // e.g., "BTC" from "BTC/USD"
        const balance = realBalances[asset] || 0;
        const dust = dustThresholds[asset] || 0.0001;
        
        // Skip if already processed above
        if (results.some(r => r.pair === pos.pair)) continue;
        
        if (balance <= dust) {
          if (dryRun) {
            results.push({ pair: pos.pair, asset, action: 'would_delete', reason: 'no_balance', balance, lotId: pos.lotId });
          } else if (autoClean) {
            await storage.deleteOpenPositionByLotId(pos.lotId);
            await botLogger.info("POSITION_DELETED_RECONCILE", `Orphan position deleted: no balance`, {
              pair: pos.pair, asset, lotId: pos.lotId, exchange,
            });
            results.push({ pair: pos.pair, asset, action: 'deleted', reason: 'no_balance', lotId: pos.lotId });
            deleted++;
          } else {
            results.push({ pair: pos.pair, asset, action: 'orphan', reason: 'no_balance_no_autoclean', lotId: pos.lotId });
          }
        }
      }
      
      res.json({
        success: true,
        exchange,
        dryRun,
        autoClean,
        positionMode,
        summary: { created, deleted, updated, unchanged, total: results.length },
        realBalances,
        results,
      });
    } catch (error: any) {
      console.error('[reconcile] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/trades/sync", async (req, res) => {
    try {
      if (!krakenService.isInitialized()) {
        return res.status(400).json({ error: "Kraken not configured" });
      }

      // Obtener todo el historial de trades con paginación
      const tradesHistory = await krakenService.getTradesHistory({ fetchAll: true });
      const krakenTrades = tradesHistory.trades || {};
      
      let synced = 0;
      let skipped = 0;
      const errors: string[] = [];
      
      // Agrupar trades por par para cálculo de P&L
      const tradesByPair: Record<string, { buys: any[]; sells: any[] }> = {};
      
      for (const [txid, trade] of Object.entries(krakenTrades)) {
        const t = trade as any;
        const pair = krakenService.formatPairReverse(t.pair);
        
        if (!tradesByPair[pair]) {
          tradesByPair[pair] = { buys: [], sells: [] };
        }
        
        const tradeData = {
          txid,
          pair,
          type: t.type,
          price: parseFloat(t.price),
          amount: parseFloat(t.vol),
          cost: parseFloat(t.cost),
          fee: parseFloat(t.fee),
          time: new Date(t.time * 1000),
        };
        
        if (t.type === 'buy') {
          tradesByPair[pair].buys.push(tradeData);
        } else {
          tradesByPair[pair].sells.push(tradeData);
        }
        
        try {
          // === FIX DUPLICADOS v2: Triple verificación ===
          const ordertxid = t.ordertxid;
          const executedAt = new Date(t.time * 1000);
          
          // === B2: UPSERT por kraken_order_id ===
          // 1. Verificar por ORDER ID (lo que guardó el bot)
          const orderIdToCheck = ordertxid || txid;
          const existingTrade = await storage.getTradeByKrakenOrderId(orderIdToCheck);
          
          if (existingTrade) {
            // B2: UPDATE - construir patch sin sobreescribir P&L existente
            const patch: any = {
              pair,
              price: t.price,
              amount: t.vol,
              status: "filled",
              executedAt,
            };
            
            // B3: Log discrepancias P&L si ambos valores existen y difieren > 1%
            // (no machacar el existente)
            if (existingTrade.realizedPnlUsd != null && existingTrade.entryPrice != null) {
              // Ya tiene P&L calculado, no actualizar campos P&L
            }
            
            await storage.updateTradeByKrakenOrderId(orderIdToCheck, patch);
            skipped++;
            continue;
          }
          
          // 2. Verificar por FILL ID (sync previo usó txid como krakenOrderId)
          if (!existingTrade) {
            const existingByFillId = await storage.getTradeByKrakenOrderId(txid);
            if (existingByFillId) {
              // B2: UPDATE por txid - misma lógica de patch
              const patchByFill: any = {
                pair,
                price: t.price,
                amount: t.vol,
                status: "filled",
                executedAt,
              };
              
              // No machacar P&L existente
              if (existingByFillId.realizedPnlUsd == null && existingByFillId.entryPrice == null) {
                // OK para actualizar P&L si viene de sync
              }
              
              await storage.updateTradeByKrakenOrderId(txid, patchByFill);
              skipped++;
              continue;
            }
          }
          
          // 3. Verificar por características (pair + amount + type + timestamp < 60s)
          const existingByTraits = await storage.findDuplicateTrade(pair, t.vol, t.type, executedAt);
          if (existingByTraits) {
            skipped++;
            continue;
          }
          
          // No existe duplicado, INSERT
          const result = await storage.upsertTradeByKrakenId({
            tradeId: `KRAKEN-${txid}`,
            exchange: 'kraken',
            pair,
            type: t.type,
            price: t.price,
            amount: t.vol,
            status: "filled",
            krakenOrderId: txid,
            executedAt,
            origin: 'sync',
          });
          
          if (result.inserted) {
            synced++;
          } else {
            skipped++;
          }
        } catch (e: any) {
          errors.push(`${txid}: ${e.message}`);
        }
      }
      
      // Calcular P&L para SELLs emparejándolos con BUYs (FIFO)
      let pnlCalculated = 0;
      for (const [pair, trades] of Object.entries(tradesByPair)) {
        // Ordenar por tiempo
        trades.buys.sort((a, b) => a.time.getTime() - b.time.getTime());
        trades.sells.sort((a, b) => a.time.getTime() - b.time.getTime());
        
        let buyIndex = 0;
        let buyRemaining = trades.buys[0]?.amount || 0;
        
        for (const sell of trades.sells) {
          let sellRemaining = sell.amount;
          let totalCost = 0;
          let totalAmount = 0;
          let totalBuyFees = 0; // Accumulated buy-side fees for matched portion
          
          // Emparejar con BUYs (FIFO)
          while (sellRemaining > 0 && buyIndex < trades.buys.length) {
            const buy = trades.buys[buyIndex];
            const matchAmount = Math.min(buyRemaining, sellRemaining);
            
            // Pro-rate buy fee based on matched portion
            const buyFeeForMatch = (matchAmount / buy.amount) * buy.fee;
            
            totalCost += matchAmount * buy.price;
            totalAmount += matchAmount;
            totalBuyFees += buyFeeForMatch;
            
            sellRemaining -= matchAmount;
            buyRemaining -= matchAmount;
            
            if (buyRemaining <= 0.00000001) {
              buyIndex++;
              buyRemaining = trades.buys[buyIndex]?.amount || 0;
            }
          }
          
          // Only calculate P&L for matched portion
          if (totalAmount > 0) {
            const avgEntryPrice = totalCost / totalAmount;
            // Use totalAmount (matched) not sell.amount for revenue calculation
            const revenue = totalAmount * sell.price;
            const cost = totalCost;
            // Include both buy and sell fees in net P&L
            const totalFees = totalBuyFees + sell.fee;
            const pnlGross = revenue - cost;
            const pnlNet = pnlGross - totalFees;
            const pnlPct = cost > 0 ? (pnlNet / cost) * 100 : 0;
            
            // Actualizar el trade SELL con P&L
            const existingSell = await storage.getTradeByKrakenOrderId(sell.txid);
            if (existingSell && (!existingSell.realizedPnlUsd || existingSell.realizedPnlUsd === null)) {
              await storage.updateTradePnl(
                existingSell.id,
                avgEntryPrice.toFixed(8),
                pnlNet.toFixed(8),  // Use net P&L (after all fees)
                pnlPct.toFixed(4)
              );
              pnlCalculated++;
            }
          }
        }
      }

      // Nota: El cierre automático de posiciones abiertas requiere tracking de volumen
      // acumulado (parciales) y se manejará via endpoints separados o manualmente.
      // El sync solo registra trades y calcula P&L.

      res.json({ 
        success: true, 
        synced, 
        skipped,
        pnlCalculated,
        total: Object.keys(krakenTrades).length,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to sync trades" });
    }
  });

  // Endpoint para recalcular P&L de todos los trades existentes en BD
  app.post("/api/trades/recalculate-pnl", async (req, res) => {
    try {
      const allTrades = await storage.getTrades(1000);

      const feePctByExchange = (ex?: string | null) => {
        if (ex === 'revolutx') return 0.09;
        return 0.40;
      };
      
      // Agrupar trades por par + exchange (para no mezclar Kraken/RevolutX)
      const tradesByKey: Record<string, { pair: string; exchange: string; buys: any[]; sells: any[] }> = {};
      
      for (const trade of allTrades) {
        const pair = trade.pair;
        const ex = ((trade as any).exchange as string | undefined) || 'kraken';
        const key = `${pair}::${ex}`;
        if (!tradesByKey[key]) {
          tradesByKey[key] = { pair, exchange: ex, buys: [], sells: [] };
        }
        
        const tradeData = {
          id: trade.id,
          pair,
          type: trade.type,
          price: parseFloat(trade.price),
          amount: parseFloat(trade.amount),
          exchange: ex,
          time: trade.executedAt ? new Date(trade.executedAt) : new Date(trade.createdAt),
        };
        
        if (trade.type === 'buy') {
          tradesByKey[key].buys.push(tradeData);
        } else {
          tradesByKey[key].sells.push(tradeData);
        }
      }
      
      // Calcular P&L para cada SELL usando FIFO
      let pnlCalculated = 0;
      let totalPnlUsd = 0;
      const results: { pair: string; exchange: string; sellId: number; pnlUsd: number }[] = [];
      
      for (const { pair, exchange, buys, sells } of Object.values(tradesByKey)) {
        // Ordenar por tiempo
        buys.sort((a, b) => a.time.getTime() - b.time.getTime());
        sells.sort((a, b) => a.time.getTime() - b.time.getTime());
        
        let buyIndex = 0;
        let buyRemaining = buys[0]?.amount || 0;
        
        for (const sell of sells) {
          let sellRemaining = sell.amount;
          let totalCost = 0;
          let totalAmount = 0;
          
          // Emparejar con BUYs (FIFO)
          while (sellRemaining > 0.00000001 && buyIndex < buys.length) {
            const buy = buys[buyIndex];
            const matchAmount = Math.min(buyRemaining, sellRemaining);
            
            totalCost += matchAmount * buy.price;
            totalAmount += matchAmount;
            
            sellRemaining -= matchAmount;
            buyRemaining -= matchAmount;
            
            if (buyRemaining <= 0.00000001) {
              buyIndex++;
              buyRemaining = buys[buyIndex]?.amount || 0;
            }
          }
          
          // Calcular P&L para matched portion
          if (totalAmount > 0.00000001) {
            const avgEntryPrice = totalCost / totalAmount;
            const revenue = totalAmount * sell.price;
            const cost = totalCost;
            const pnlGross = revenue - cost;
            const feePct = feePctByExchange(exchange);
            const entryFee = cost * (feePct / 100);
            const exitFee = revenue * (feePct / 100);
            const pnlNet = pnlGross - entryFee - exitFee;
            const pnlPct = cost > 0 ? (pnlNet / cost) * 100 : 0;
            
            // Actualizar el trade SELL con P&L
            await storage.updateTradePnl(
              sell.id,
              avgEntryPrice.toFixed(8),
              pnlNet.toFixed(8),
              pnlPct.toFixed(4)
            );
            pnlCalculated++;
            totalPnlUsd += pnlNet;
            results.push({ pair, exchange, sellId: sell.id, pnlUsd: pnlNet });
          }
        }
      }
      
      console.log(`[RECALCULATE_PNL] Recalculated ${pnlCalculated} trades, total P&L: $${totalPnlUsd.toFixed(2)}`);
      
      res.json({ 
        success: true, 
        pnlCalculated,
        totalPnlUsd: totalPnlUsd.toFixed(2),
        pairs: Object.keys(tradesByKey).length,
        details: results.slice(-20),
      });
    } catch (error: any) {
      console.error("[api/trades/recalculate-pnl] Error:", error);
      res.status(500).json({ error: error.message || "Failed to recalculate P&L" });
    }
  });

  // Endpoint para limpiar duplicados existentes
  app.post("/api/trades/cleanup-duplicates", async (req, res) => {
    try {
      const duplicates = await storage.getDuplicateTradesByKrakenId();
      
      if (duplicates.length === 0) {
        return res.json({ success: true, message: "No hay duplicados", deleted: 0 });
      }
      
      const deleted = await storage.deleteDuplicateTrades();
      
      res.json({ 
        success: true, 
        duplicatesFound: duplicates.length,
        deleted,
        details: duplicates.slice(0, 20),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to cleanup duplicates" });
    }
  });

  // Endpoint para limpiar trades inválidos históricos (p.ej. RevolutX price=0)
  app.post("/api/trades/cleanup-invalid", async (req, res) => {
    try {
      const deleted = await storage.deleteInvalidFilledTrades();
      res.json({ success: true, deleted });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to cleanup invalid trades" });
    }
  });

  // Endpoint para ver duplicados sin eliminar
  app.get("/api/trades/duplicates", async (req, res) => {
    try {
      const duplicates = await storage.getDuplicateTradesByKrakenId();
      res.json({ 
        count: duplicates.length,
        duplicates: duplicates.slice(0, 50),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get duplicates" });
    }
  });

  // FIFO Matcher endpoints
  app.post("/api/fifo/init-lots", async (req, res) => {
    try {
      const { fifoMatcher } = await import("./services/fifoMatcher");
      const initialized = await fifoMatcher.initializeLots();
      res.json({ success: true, lotsInitialized: initialized });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to initialize lots" });
    }
  });

  app.post("/api/fifo/process-sells", async (req, res) => {
    try {
      const { fifoMatcher } = await import("./services/fifoMatcher");
      const result = await fifoMatcher.processAllUnmatchedSells();
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to process sells" });
    }
  });

  app.post("/api/fifo/ingest-fill", async (req, res) => {
    try {
      const { txid, orderId, pair, type, price, amount, cost, fee, executedAt } = req.body;
      
      if (!txid || !pair || !type || !price || !amount) {
        return res.status(400).json({ error: "Missing required fields: txid, pair, type, price, amount" });
      }

      const fillResult = await storage.upsertTradeFill({
        txid,
        orderId: orderId || txid,
        pair,
        type: type.toLowerCase(),
        price: price.toString(),
        amount: amount.toString(),
        cost: (cost || parseFloat(price) * parseFloat(amount)).toString(),
        fee: (fee || 0).toString(),
        matched: false,
        executedAt: new Date(executedAt || Date.now()),
      });

      if (!fillResult.inserted) {
        return res.json({ success: true, message: "Fill already exists", fill: fillResult.fill });
      }

      if (type.toUpperCase() === "SELL") {
        const { fifoMatcher } = await import("./services/fifoMatcher");
        const matchResult = await fifoMatcher.processSellFill(fillResult.fill!);
        return res.json({ success: true, fill: fillResult.fill, matchResult });
      }

      res.json({ success: true, fill: fillResult.fill });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to ingest fill" });
    }
  });

  app.get("/api/fifo/open-lots", async (req, res) => {
    try {
      const lots = await storage.getOpenPositionsWithQtyRemaining();
      res.json({
        count: lots.length,
        lots: lots.map(l => ({
          lotId: l.lotId,
          pair: l.pair,
          entryPrice: l.entryPrice,
          amount: l.amount,
          qtyRemaining: l.qtyRemaining || l.amount,
          qtyFilled: l.qtyFilled || "0",
          openedAt: l.openedAt,
        })),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get open lots" });
    }
  });

  app.get("/api/kraken/trades", async (req, res) => {
    try {
      if (!krakenService.isInitialized()) {
        const localTrades = await storage.getTrades(50);
        return res.json(localTrades.map(t => ({
          id: t.tradeId,
          krakenOrderId: t.krakenOrderId,
          pair: t.pair,
          type: t.type,
          price: t.price,
          amount: t.amount,
          time: t.executedAt?.toISOString() || t.createdAt.toISOString(),
          status: t.status,
        })));
      }

      const tradesHistory = await krakenService.getTradesHistory();
      const trades = tradesHistory.trades || {};
      
      const formattedTrades = Object.entries(trades).map(([txid, trade]) => {
        const t = trade as any;
        return {
          id: txid.substring(0, 10),
          krakenOrderId: txid,
          pair: krakenService.formatPairReverse(t.pair),
          type: t.type,
          price: t.price,
          amount: t.vol,
          cost: t.cost,
          fee: t.fee,
          time: new Date(t.time * 1000).toISOString(),
          status: "filled",
        };
      }).sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

      res.json(formattedTrades);
    } catch (error: any) {
      console.error("[api/kraken/trades] Error:", error.message);
      const localTrades = await storage.getTrades(50);
      res.json(localTrades.map(t => ({
        id: t.tradeId,
        krakenOrderId: t.krakenOrderId,
        pair: t.pair,
        type: t.type,
        price: t.price,
        amount: t.amount,
        time: t.executedAt?.toISOString() || t.createdAt.toISOString(),
        status: t.status,
      })));
    }
  });

  app.get("/api/events", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 500, 1000);
      const level = req.query.level as string;
      
      const events = await botLogger.getDbEvents(limit);
      
      const filtered = level 
        ? events.filter(e => e.level === level.toUpperCase())
        : events;
      
      res.json(filtered.map(e => {
        const meta = e.meta ? JSON.parse(e.meta) : null;
        return {
          id: e.id,
          timestamp: e.timestamp,
          level: e.level,
          type: e.type,
          message: e.message,
          meta,
          env: meta?.env || null,
          instanceId: meta?.instanceId || null,
        };
      }));
    } catch (error: any) {
      console.error("[api/events] Error:", error.message);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  app.get("/api/ai/status", async (req, res) => {
    try {
      const status = await aiService.getStatus();
      res.json(status);
    } catch (error: any) {
      console.error("[api/ai/status] Error:", error.message);
      res.status(500).json({ errorCode: "STATUS_ERROR", message: "Error al obtener el estado de la IA" });
    }
  });

  app.get("/api/ai/diagnostic", async (req, res) => {
    try {
      const diagnostic = await aiService.getDiagnostic();
      const config = await storage.getBotConfig();
      const dryRun = environment.isReplit || (config?.dryRunMode ?? false);
      res.json({
        ...diagnostic,
        env: environment.envTag,
        instanceId: environment.instanceId,
        dryRun,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/environment", async (req, res) => {
    try {
      const config = await storage.getBotConfig();
      // Solo Replit fuerza DRY_RUN. VPS y NAS respetan la configuración del usuario.
      const dryRun = environment.isReplit || (config?.dryRunMode ?? false);
      
      res.json({
        env: environment.envTag,
        instanceId: environment.instanceId,
        version: environment.version,
        isReplit: environment.isReplit,
        isVPS: environment.isVPS,
        isNAS: environment.isNAS,
        dryRun,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/db/diagnostic", async (req, res) => {
    try {
      const client = await pool.connect();
      try {
        const versionResult = await client.query("SELECT version()");
        const version = versionResult.rows[0]?.version || "Unknown";

        const uptimeResult = await client.query("SELECT pg_postmaster_start_time() as start_time");
        const startTime = uptimeResult.rows[0]?.start_time;
        const uptimeMs = startTime ? Date.now() - new Date(startTime).getTime() : 0;
        const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));

        const maxConnResult = await client.query("SHOW max_connections");
        const maxConnections = parseInt(maxConnResult.rows[0]?.max_connections || "100");

        const connStatsResult = await client.query(`
          SELECT state, COUNT(*) as count 
          FROM pg_stat_activity 
          WHERE datname = current_database()
          GROUP BY state
        `);
        const connectionStats: Record<string, number> = {};
        let totalConnections = 0;
        for (const row of connStatsResult.rows) {
          const state = row.state || "null";
          const count = parseInt(row.count);
          connectionStats[state] = count;
          totalConnections += count;
        }

        const dbSizeResult = await client.query(`
          SELECT pg_database_size(current_database()) as size
        `);
        const dbSizeBytes = parseInt(dbSizeResult.rows[0]?.size || "0");
        const dbSizeMB = (dbSizeBytes / (1024 * 1024)).toFixed(2);

        const tableSizesResult = await client.query(`
          SELECT 
            schemaname || '.' || tablename as table_name,
            pg_total_relation_size(schemaname || '.' || tablename) as total_size
          FROM pg_tables 
          WHERE schemaname = 'public'
          ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC
          LIMIT 15
        `);
        const tableSizes = tableSizesResult.rows.map(row => ({
          table: row.table_name.replace("public.", ""),
          sizeBytes: parseInt(row.total_size),
          sizeMB: (parseInt(row.total_size) / (1024 * 1024)).toFixed(3),
        }));

        const rowCountsResult = await client.query(`
          SELECT relname as table_name, n_live_tup as row_count
          FROM pg_stat_user_tables
          ORDER BY n_live_tup DESC
          LIMIT 15
        `);
        const rowCounts = rowCountsResult.rows.map(row => ({
          table: row.table_name,
          rows: parseInt(row.row_count),
        }));

        const activeQueriesResult = await client.query(`
          SELECT 
            pid,
            usename,
            state,
            query,
            query_start,
            EXTRACT(EPOCH FROM (now() - query_start))::int as duration_secs
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND state = 'active'
            AND pid != pg_backend_pid()
          ORDER BY query_start ASC
          LIMIT 10
        `);
        const activeQueries = activeQueriesResult.rows.map(row => ({
          pid: row.pid,
          user: row.usename,
          state: row.state,
          query: row.query?.substring(0, 200),
          durationSecs: row.duration_secs,
        }));

        const locksResult = await client.query(`
          SELECT COUNT(*) as count FROM pg_locks WHERE NOT granted
        `);
        const waitingLocks = parseInt(locksResult.rows[0]?.count || "0");

        const vacuumResult = await client.query(`
          SELECT 
            relname as table_name,
            last_vacuum,
            last_autovacuum,
            last_analyze,
            last_autoanalyze
          FROM pg_stat_user_tables
          WHERE last_vacuum IS NOT NULL OR last_autovacuum IS NOT NULL
          ORDER BY COALESCE(last_autovacuum, last_vacuum) DESC
          LIMIT 5
        `);
        const vacuumStats = vacuumResult.rows.map(row => ({
          table: row.table_name,
          lastVacuum: row.last_vacuum || row.last_autovacuum,
          lastAnalyze: row.last_analyze || row.last_autoanalyze,
        }));

        res.json({
          timestamp: new Date().toISOString(),
          server: {
            version: version.split(",")[0],
            uptimeHours,
            startTime,
          },
          connections: {
            current: totalConnections,
            max: maxConnections,
            usage: ((totalConnections / maxConnections) * 100).toFixed(1) + "%",
            byState: connectionStats,
          },
          storage: {
            databaseSizeMB: dbSizeMB,
            tableSizes,
          },
          tables: {
            rowCounts,
          },
          performance: {
            activeQueries,
            waitingLocks,
          },
          maintenance: {
            recentVacuums: vacuumStats,
          },
        });
      } finally {
        client.release();
      }
    } catch (error: any) {
      console.error("[api/db/diagnostic] Error:", error.message);
      res.status(500).json({ error: error.message || "Failed to get database diagnostic" });
    }
  });

  app.post("/api/ai/backfill", async (req, res) => {
    try {
      const result = await aiService.runBackfill();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Endpoint para limpiar duplicados en training_trades
  app.post("/api/ai/cleanup-duplicates", async (req, res) => {
    try {
      const duplicates = await storage.getDuplicateTrainingTradesByBuyTxid();
      
      if (duplicates.length === 0) {
        return res.json({ success: true, message: "No hay duplicados en training_trades", deleted: 0 });
      }
      
      const deleted = await storage.deleteDuplicateTrainingTrades();
      
      res.json({ 
        success: true, 
        duplicatesFound: duplicates.length,
        deleted,
        details: duplicates.slice(0, 20),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to cleanup training trades duplicates" });
    }
  });

  // Endpoint para ver duplicados en training_trades sin eliminar
  app.get("/api/ai/duplicates", async (req, res) => {
    try {
      const duplicates = await storage.getDuplicateTrainingTradesByBuyTxid();
      res.json({ 
        count: duplicates.length,
        duplicates: duplicates.slice(0, 50),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get training trades duplicates" });
    }
  });

  app.get("/api/ai/samples", async (req, res) => {
    try {
      const complete = req.query.complete === "true" ? true : req.query.complete === "false" ? false : undefined;
      const limit = parseInt(req.query.limit as string) || 100;
      const samples = await storage.getAiSamples({ complete, limit });
      const count = await storage.getAiSamplesCount(complete);
      res.json({ samples, total: count });
    } catch (error: any) {
      console.error("[api/ai/samples] Error:", error.message);
      res.status(500).json({ errorCode: "SAMPLES_ERROR", message: "Error al obtener las muestras de IA" });
    }
  });

  app.post("/api/ai/retrain", async (req, res) => {
    try {
      const result = await aiService.runTraining();
      if (!result.success && result.errorCode === "INSUFFICIENT_DATA") {
        res.status(409).json({
          errorCode: result.errorCode,
          message: result.message,
          required: result.required,
          current: result.current
        });
      } else if (!result.success) {
        res.status(500).json({
          errorCode: result.errorCode || "TRAINING_ERROR",
          message: result.message
        });
      } else {
        res.json({ success: true, message: result.message, metrics: result.metrics });
      }
    } catch (error: any) {
      console.error("[api/ai/retrain] Error:", error.message);
      res.status(500).json({ errorCode: "TRAINING_ERROR", message: "Error interno al reentrenar el modelo" });
    }
  });

  app.post("/api/ai/train", async (req, res) => {
    try {
      const result = await aiService.runTraining();
      if (!result.success && result.errorCode === "INSUFFICIENT_DATA") {
        res.status(409).json({
          errorCode: result.errorCode,
          message: result.message,
          required: result.required,
          current: result.current
        });
      } else if (!result.success) {
        res.status(500).json({
          errorCode: result.errorCode || "TRAINING_ERROR",
          message: result.message
        });
      } else {
        res.json({ success: true, message: result.message, metrics: result.metrics });
      }
    } catch (error: any) {
      console.error("[api/ai/train] Error:", error.message);
      res.status(500).json({ errorCode: "TRAINING_ERROR", message: `Error interno al entrenar el modelo: ${error.message}` });
    }
  });

  app.get("/api/ai/shadow/report", async (req, res) => {
    try {
      const report = await storage.getAiShadowReport();
      res.json(report);
    } catch (error: any) {
      console.error("[api/ai/shadow/report] Error:", error.message);
      res.status(500).json({ errorCode: "SHADOW_REPORT_ERROR", message: "Error al obtener el informe de shadow" });
    }
  });

  app.post("/api/ai/toggle", async (req, res) => {
    try {
      const { filterEnabled, shadowEnabled, threshold } = req.body;
      
      if (filterEnabled !== undefined) {
        await aiService.toggleFilter(filterEnabled);
      }
      if (shadowEnabled !== undefined) {
        await aiService.toggleShadow(shadowEnabled);
      }
      if (threshold !== undefined) {
        await aiService.setThreshold(parseFloat(threshold));
      }
      
      const status = await aiService.getStatus();
      res.json({ success: true, status });
    } catch (error: any) {
      console.error("[api/ai/toggle] Error:", error.message);
      res.status(500).json({ errorCode: "TOGGLE_ERROR", message: "Error al cambiar la configuración de IA" });
    }
  });

  // ============================================================
  // TEST ENDPOINT: Simular señal BUY para validar SMART_GUARD
  // Solo disponible en REPLIT/DEV o cuando dryRun=true
  // ============================================================
  app.post("/api/test/signal", async (req, res) => {
    try {
      const envInfo = environment.getInfo();
      const botConfig = await storage.getBotConfig();
      const dryRun = botConfig?.dryRunMode ?? true;
      
      // SEGURIDAD: Solo permitir en REPLIT/DEV o dryRun=true
      if (envInfo.isNAS && !dryRun) {
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "Este endpoint solo está disponible en entorno de desarrollo (REPLIT/DEV) o con dryRun activado",
          env: envInfo.env,
          dryRun,
        });
      }
      
      // Validar body
      const testSignalSchema = z.object({
        pair: z.string().min(1),
        signal: z.enum(["BUY"]),
        price: z.number().positive().optional(),
        forceOrderUsd: z.number().positive().optional(),
        forceHasPosition: z.boolean().optional(),
        forceOpenLots: z.number().int().min(0).optional(),
      });
      
      const parsed = testSignalSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "VALIDATION_ERROR",
          message: "Parámetros inválidos",
          details: parsed.error.issues,
        });
      }
      
      const { pair, signal, price, forceOrderUsd, forceHasPosition, forceOpenLots } = parsed.data;
      const correlationId = `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      
      // Obtener datos del mercado si no se proporciona precio
      let currentPrice = price;
      if (!currentPrice) {
        try {
          const ticker = await krakenService.getTicker(pair);
          currentPrice = ticker.last || 0;
        } catch {
          currentPrice = 100; // Fallback para test
        }
      }
      
      // Obtener configuración SMART_GUARD
      const positionMode = botConfig?.positionMode || "SINGLE";
      const sgMinEntryUsd = parseFloat(botConfig?.sgMinEntryUsd?.toString() || "100");
      const sgAllowUnderMin = botConfig?.sgAllowUnderMin ?? true;
      const sgMaxOpenLotsPerPair = 1; // Por defecto 1, se implementará en paso 3
      const SG_ABSOLUTE_MIN_USD = 20;
      
      // Obtener balance USD
      let usdBalance = 0;
      try {
        const balances = await krakenService.getBalance();
        usdBalance = balances?.ZUSD || balances?.USD || 0;
      } catch {
        usdBalance = 100; // Fallback para test
      }
      
      // Simular orderUsdFinal
      const orderUsdFinal = forceOrderUsd ?? Math.min(usdBalance * 0.95, sgMinEntryUsd);
      
      // Simular si hay posición abierta
      const hasPosition = forceHasPosition ?? (tradingEngine?.getOpenPositions().has(pair) ?? false);
      const openLots = forceOpenLots ?? (hasPosition ? 1 : 0);
      
      // Construir meta base
      const baseMeta = {
        correlationId,
        pair,
        signal,
        env: envInfo.env,
        instanceId: envInfo.instanceId,
        testMode: true,
        positionMode,
        usdDisponible: usdBalance,
        orderUsdProposed: sgMinEntryUsd,
        orderUsdFinal,
        sgMinEntryUsd,
        sgAllowUnderMin,
        sgMaxOpenLotsPerPair,
        absoluteMinOrderUsd: SG_ABSOLUTE_MIN_USD,
        hasPosition,
        openLots,
        currentPrice,
      };
      
      let result: { decision: string; reason: string; message: string };
      
      // === VALIDACIÓN 1: Posición abierta en SMART_GUARD/SINGLE ===
      if ((positionMode === "SINGLE" || positionMode === "SMART_GUARD") && hasPosition && openLots >= sgMaxOpenLotsPerPair) {
        const reason = positionMode === "SMART_GUARD" 
          ? (openLots >= sgMaxOpenLotsPerPair ? "SMART_GUARD_MAX_LOTS_REACHED" : "SMART_GUARD_POSITION_EXISTS")
          : "SINGLE_MODE_POSITION_EXISTS";
        
        await botLogger.info("TRADE_SKIPPED", `[TEST] Señal BUY bloqueada - ${reason}`, {
          ...baseMeta,
          reason,
          existingLots: openLots,
        });
        
        result = {
          decision: "TRADE_SKIPPED",
          reason,
          message: reason === "SMART_GUARD_MAX_LOTS_REACHED"
            ? `Máximo de lotes abiertos alcanzado (${openLots}/${sgMaxOpenLotsPerPair})`
            : "Ya hay posición abierta en este par",
        };
      }
      // === VALIDACIÓN 2: Mínimo absoluto exchange (MIN_ORDER_ABSOLUTE) - Prioridad más alta ===
      else if (orderUsdFinal < SG_ABSOLUTE_MIN_USD) {
        const reason = "MIN_ORDER_ABSOLUTE";
        
        await botLogger.info("TRADE_SKIPPED", `[TEST] Señal BUY bloqueada - mínimo absoluto exchange`, {
          ...baseMeta,
          reason,
        });
        
        result = {
          decision: "TRADE_SKIPPED",
          reason,
          message: `Mínimo absoluto exchange no alcanzado: $${orderUsdFinal.toFixed(2)} < $${SG_ABSOLUTE_MIN_USD}`,
        };
      }
      // === VALIDACIÓN 3: Mínimo por orden (MIN_ORDER_USD) ===
      else if (positionMode === "SMART_GUARD" && !sgAllowUnderMin && orderUsdFinal < sgMinEntryUsd) {
        const reason = "MIN_ORDER_USD";
        
        await botLogger.info("TRADE_SKIPPED", `[TEST] Señal BUY bloqueada - mínimo por orden no alcanzado`, {
          ...baseMeta,
          reason,
        });
        
        result = {
          decision: "TRADE_SKIPPED",
          reason,
          message: `Mínimo por orden no alcanzado: $${orderUsdFinal.toFixed(2)} < $${sgMinEntryUsd.toFixed(2)} (allowUnderMin=OFF)`,
        };
      }
      // === CASO POSITIVO: Trade permitido (simulado) ===
      else {
        const reason = "TEST_TRADE_ALLOWED";
        
        await botLogger.info("TEST_TRADE_SIMULATED", `[TEST] Señal BUY pasaría todas las validaciones`, {
          ...baseMeta,
          reason,
        });
        
        result = {
          decision: "TEST_TRADE_SIMULATED",
          reason,
          message: `Trade de $${orderUsdFinal.toFixed(2)} pasaría todas las validaciones en ${positionMode}`,
        };
      }
      
      res.json({
        success: true,
        correlationId,
        ...result,
        meta: baseMeta,
      });
      
    } catch (error: any) {
      console.error("[api/test/signal] Error:", error.message);
      res.status(500).json({
        error: "TEST_SIGNAL_ERROR",
        message: `Error al procesar señal de prueba: ${error.message}`,
      });
    }
  });

  // ============================================================
  // TEST ENDPOINT: Simular eventos SMART_GUARD para testing
  // Solo disponible en REPLIT/DEV o cuando dryRun=true
  // ============================================================
  app.post("/api/test/sg-event", async (req, res) => {
    try {
      const envInfo = environment.getInfo();
      const botConfig = await storage.getBotConfig();
      const dryRun = botConfig?.dryRunMode ?? true;
      
      // SEGURIDAD: Solo permitir en REPLIT/DEV o dryRun=true
      if (envInfo.isNAS && !dryRun) {
        return res.status(403).json({
          error: "FORBIDDEN",
          message: "Este endpoint solo está disponible en entorno de desarrollo (REPLIT/DEV) o con dryRun activado",
        });
      }
      
      const testEventSchema = z.object({
        event: z.enum(["SG_BREAK_EVEN_ACTIVATED", "SG_TRAILING_ACTIVATED", "SG_TRAILING_STOP_UPDATED", "SG_SCALE_OUT_EXECUTED"]),
        pair: z.string().default("BTC/USD"),
        lotId: z.string().optional(),
        entryPrice: z.number().positive().default(100000),
        currentPrice: z.number().positive().optional(),
        profitPct: z.number().default(2.5),
        stopPrice: z.number().positive().optional(),
        scaleOutQty: z.number().positive().optional(),
        scaleOutUsd: z.number().positive().optional(),
      });
      
      const parsed = testEventSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.issues });
      }
      
      const { event, pair, entryPrice, profitPct } = parsed.data;
      const lotId = parsed.data.lotId || `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const currentPrice = parsed.data.currentPrice || entryPrice * (1 + profitPct / 100);
      const stopPrice = parsed.data.stopPrice || currentPrice * 0.98;
      
      const baseMeta = {
        pair,
        lotId,
        entryPrice,
        currentPrice,
        profitPct: profitPct.toFixed(2) + "%",
        env: envInfo.env,
        instanceId: envInfo.instanceId,
        testMode: true,
      };
      
      let message = "";
      let telegramMsg = "";
      const prefix = environment.getMessagePrefix(true); // Test events are always DRY_RUN
      
      switch (event) {
        case "SG_BREAK_EVEN_ACTIVATED":
          message = `SMART_GUARD Break-Even activado en ${pair}`;
          telegramMsg = `${prefix}⚖️ *Break-Even Activado*\n` +
            `Par: ${pair}\n` +
            `Lote: \`${lotId}\`\n` +
            `Entrada: $${entryPrice.toFixed(2)}\n` +
            `Precio actual: $${currentPrice.toFixed(2)}\n` +
            `Profit: +${profitPct.toFixed(2)}%\n` +
            `Stop movido a: $${stopPrice.toFixed(2)}`;
          await botLogger.info(event, message, { ...baseMeta, stopPrice });
          await telegramService.sendAlertToMultipleChats(telegramMsg, "status");
          break;
          
        case "SG_TRAILING_ACTIVATED":
          message = `SMART_GUARD Trailing Stop activado en ${pair}`;
          telegramMsg = `${prefix}🎯 *Trailing Stop Activado*\n` +
            `Par: ${pair}\n` +
            `Lote: \`${lotId}\`\n` +
            `Entrada: $${entryPrice.toFixed(2)}\n` +
            `Precio actual: $${currentPrice.toFixed(2)}\n` +
            `Profit: +${profitPct.toFixed(2)}%\n` +
            `Stop dinámico: $${stopPrice.toFixed(2)}`;
          await botLogger.info(event, message, { ...baseMeta, stopPrice });
          await telegramService.sendAlertToMultipleChats(telegramMsg, "status");
          break;
          
        case "SG_TRAILING_STOP_UPDATED":
          const oldStop = stopPrice * 0.99;
          message = `SMART_GUARD Trailing Stop actualizado en ${pair}`;
          telegramMsg = `${prefix}📈 *Trailing Stop Actualizado*\n` +
            `Par: ${pair}\n` +
            `Lote: \`${lotId}\`\n` +
            `Stop: $${oldStop.toFixed(2)} → $${stopPrice.toFixed(2)}\n` +
            `Profit actual: +${profitPct.toFixed(2)}%`;
          await botLogger.info(event, message, { ...baseMeta, stopPrice, oldStop });
          await telegramService.sendAlertToMultipleChats(telegramMsg, "status");
          break;
          
        case "SG_SCALE_OUT_EXECUTED":
          const scaleOutQty = parsed.data.scaleOutQty || 0.001;
          const scaleOutUsd = parsed.data.scaleOutUsd || scaleOutQty * currentPrice;
          message = `SMART_GUARD Scale-Out ejecutado en ${pair}`;
          telegramMsg = `${prefix}📊 *Scale-Out Ejecutado*\n` +
            `Par: ${pair}\n` +
            `Lote: \`${lotId}\`\n` +
            `Vendido: ${scaleOutQty} ($${scaleOutUsd.toFixed(2)})\n` +
            `Profit: +${profitPct.toFixed(2)}%`;
          await botLogger.info(event, message, { ...baseMeta, scaleOutQty, scaleOutUsd });
          await telegramService.sendAlertToMultipleChats(telegramMsg, "status");
          break;
      }
      
      res.json({
        success: true,
        event,
        message,
        meta: baseMeta,
        telegramSent: true,
      });
      
    } catch (error: any) {
      console.error("[api/test/sg-event] Error:", error.message);
      res.status(500).json({ error: "TEST_SG_EVENT_ERROR", message: error.message });
    }
  });

  // ============================================================
  // TEST ENDPOINT: Probar multi-lot (crear posiciones de prueba)
  // ============================================================
  app.post("/api/test/create-position", async (req, res) => {
    try {
      const envInfo = environment.getInfo();
      const botConfig = await storage.getBotConfig();
      const dryRun = botConfig?.dryRunMode ?? true;
      
      if (envInfo.isNAS && !dryRun) {
        return res.status(403).json({ error: "FORBIDDEN" });
      }
      
      const schema = z.object({
        pair: z.string().default("BTC/USD"),
        amount: z.number().positive().default(0.001),
        entryPrice: z.number().positive().default(100000),
      });
      
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.issues });
      }
      
      const { pair, amount, entryPrice } = parsed.data;
      const lotId = `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      
      // Add to trading engine's open positions
      if (tradingEngine) {
        const position = {
          pair,
          amount,
          entryPrice,
          timestamp: new Date().toISOString(),
          lotId,
          strategy: "test",
          entryMode: "TEST",
          signalConfidence: 0.8,
          // SMART_GUARD flags
          sgBreakEvenActivated: false,
          sgTrailingActivated: false,
          sgCurrentStopPrice: null,
          sgScaleOutDone: false,
          configSnapshotJson: botConfig ? JSON.stringify({
            sgMinEntryUsd: botConfig.sgMinEntryUsd,
            sgBeAtPct: botConfig.sgBeAtPct,
            sgTrailStartPct: botConfig.sgTrailStartPct,
            sgTrailDistancePct: botConfig.sgTrailDistancePct,
          }) : null,
        };
        
        tradingEngine.getOpenPositions().set(lotId, position);

        let parsedSnapshot: any = null;
        try {
          parsedSnapshot = position.configSnapshotJson ? JSON.parse(position.configSnapshotJson) : null;
        } catch {
          parsedSnapshot = null;
        }

        const exchangeType = ExchangeFactory.getTradingExchangeType();
        const saved = await storage.saveOpenPositionByLotId({
          lotId,
          exchange: exchangeType,
          pair,
          entryPrice: entryPrice.toString(),
          amount: amount.toString(),
          highestPrice: entryPrice.toString(),
          entryFee: "0",
          entryStrategyId: "test",
          entrySignalTf: "test",
          signalConfidence: "0.8",
          entryMode: "TEST",
          configSnapshotJson: parsedSnapshot,
        } as any);

        const dbPosition = await storage.getOpenPositionByLotId(lotId);
        
        // Count lots for this pair
        const allPositions = tradingEngine.getOpenPositions();
        let pairLots = 0;
        Array.from(allPositions.values()).forEach((pos: any) => {
          if (pos.pair === pair) pairLots++;
        });
        
        await botLogger.info("TEST_POSITION_CREATED", `Posición de prueba creada: ${pair} x${amount}`, {
          pair, lotId, amount, entryPrice, pairLots, env: envInfo.env,
        });
        
        res.json({
          success: true,
          lotId,
          position,
          dbSaved: !!dbPosition,
          dbPosition: dbPosition || null,
          saved,
          pairLotsCount: pairLots,
        });
      } else {
        res.status(500).json({ error: "ENGINE_NOT_READY" });
      }
      
    } catch (error: any) {
      res.status(500).json({ error: "CREATE_POSITION_ERROR", message: error.message });
    }
  });

  // ============================================================
  // TEST ENDPOINT: Eliminar posición de prueba
  // ============================================================
  app.delete("/api/test/position/:lotId", async (req, res) => {
    try {
      const envInfo = environment.getInfo();
      const botConfig = await storage.getBotConfig();
      const dryRun = botConfig?.dryRunMode ?? true;
      
      if (envInfo.isNAS && !dryRun) {
        return res.status(403).json({ error: "FORBIDDEN" });
      }
      
      const { lotId } = req.params;
      
      if (tradingEngine) {
        const deleted = tradingEngine.getOpenPositions().delete(lotId);
        let dbDeleted = false;
        try {
          await storage.deleteOpenPositionByLotId(lotId);
          dbDeleted = true;
        } catch {
          dbDeleted = false;
        }
        res.json({ success: true, deleted, dbDeleted, lotId });
      } else {
        res.status(500).json({ error: "ENGINE_NOT_READY" });
      }
      
    } catch (error: any) {
      res.status(500).json({ error: "DELETE_POSITION_ERROR", message: error.message });
    }
  });

  // ============================================================
  // TEST ENDPOINT: Simular sizing SMART_GUARD v2
  // Para validar la lógica: 469→200, 250→200, 150→150, 25→25, 19→block
  // ============================================================
  app.post("/api/test/sg-sizing", async (req, res) => {
    try {
      const envInfo = environment.getInfo();
      const botConfig = await storage.getBotConfig();
      const dryRun = botConfig?.dryRunMode ?? true;
      
      if (envInfo.isNAS && !dryRun) {
        return res.status(403).json({ error: "FORBIDDEN" });
      }
      
      const schema = z.object({
        availableUsd: z.number().min(0),
        sgMinEntryUsd: z.number().positive().default(200),
        minOrderExchangeUsd: z.number().positive().default(10), // mínimo del exchange en USD
        feeCushionPct: z.number().min(0).default(0),
      });
      
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "VALIDATION_ERROR", details: parsed.error.issues });
      }
      
      const { availableUsd, sgMinEntryUsd, minOrderExchangeUsd, feeCushionPct } = parsed.data;
      
      // Constantes
      const SG_ABSOLUTE_MIN_USD = 20;
      
      // SMART_GUARD v2: sin buffer de slippage para sizing exacto
      const usdDisponible = availableUsd;
      
      // floorUsd = max(minOrderExchangeUsd, MIN_ORDER_ABSOLUTE_USD)
      const floorUsd = Math.max(SG_ABSOLUTE_MIN_USD, minOrderExchangeUsd);
      
      // Fee cushion
      const cushionAmount = availableUsd * (feeCushionPct / 100);
      const availableAfterCushion = usdDisponible - cushionAmount;
      
      // === SMART_GUARD v2 SIZING LOGIC ===
      let orderUsd: number;
      let reasonCode: string;
      let blocked = false;
      
      if (availableAfterCushion >= sgMinEntryUsd) {
        // Caso A: Saldo suficiente → usar sgMinEntryUsd EXACTO
        orderUsd = sgMinEntryUsd;
        reasonCode = "SMART_GUARD_ENTRY_USING_CONFIG_MIN";
        
      } else if (availableAfterCushion >= floorUsd) {
        // Caso B: Fallback automático → usar saldo disponible
        orderUsd = availableAfterCushion;
        reasonCode = "SMART_GUARD_ENTRY_FALLBACK_TO_AVAILABLE";
        
      } else if (usdDisponible >= floorUsd && availableAfterCushion < floorUsd) {
        // Caso C: Fee cushion lo baja de floorUsd → BLOCKED
        orderUsd = availableAfterCushion;
        reasonCode = "SMART_GUARD_BLOCKED_AFTER_FEE_CUSHION";
        blocked = true;
        
      } else {
        // Caso D: Saldo < floorUsd → BLOCKED
        orderUsd = usdDisponible;
        reasonCode = "SMART_GUARD_BLOCKED_BELOW_EXCHANGE_MIN";
        blocked = true;
      }
      
      res.json({
        success: true,
        blocked,
        reasonCode,
        orderUsd: parseFloat(orderUsd.toFixed(2)),
        details: {
          input: {
            availableUsd,
            sgMinEntryUsd,
            minOrderExchangeUsd,
            feeCushionPct,
          },
          calculated: {
            usdDisponible: parseFloat(usdDisponible.toFixed(2)),
            floorUsd,
            cushionAmount: parseFloat(cushionAmount.toFixed(2)),
            availableAfterCushion: parseFloat(availableAfterCushion.toFixed(2)),
          },
          thresholds: {
            SG_ABSOLUTE_MIN_USD,
            minOrderExchangeUsd,
            floorUsd,
          },
        },
      });
      
    } catch (error: any) {
      res.status(500).json({ error: "SG_SIZING_TEST_ERROR", message: error.message });
    }
  });

  // ============================================================
  // TEST ENDPOINT: Probar filtro B3 (min señales SMART_GUARD)
  // Solo disponible en REPLIT/DEV o cuando dryRun=true
  // ============================================================
  app.post("/api/test/b3", async (req, res) => {
    try {
      const envInfo = environment.getInfo();
      const botConfig = await storage.getBotConfig();
      const dryRun = botConfig?.dryRunMode ?? true;
      
      if (!envInfo.isReplit && !dryRun) {
        return res.status(403).json({ 
          error: "TEST_NOT_ALLOWED", 
          message: "Test endpoint solo disponible en Replit o con dryRunMode=true" 
        });
      }
      
      const { buySignals, sellSignals, regime, reasonFormat } = req.body;
      
      // Validar inputs
      const bSignals = parseInt(buySignals?.toString() || "4", 10);
      const sSignals = parseInt(sellSignals?.toString() || "1", 10);
      const testRegime = regime || "BASE"; // BASE, TREND, RANGE, TRANSITION
      
      // Determinar requiredSignals según régimen
      let requiredSignals = 5; // Base SMART_GUARD
      if (testRegime === "RANGE") requiredSignals = 6;
      else if (testRegime === "TREND") requiredSignals = 5;
      else if (testRegime === "TRANSITION") requiredSignals = 5; // pero pauseEntries = true
      
      // Simular formato de reason
      let testReason: string;
      if (reasonFormat === "old") {
        // Formato antiguo (no matchea regex)
        testReason = `Momentum alcista: RSI bajo | Señales: ${bSignals} compra vs ${sSignals} venta`;
      } else if (reasonFormat === "broken") {
        // Formato roto (deliberadamente no parseable)
        testReason = `Señal sin formato estándar`;
      } else {
        // Formato unificado (matchea regex)
        testReason = `Momentum Velas COMPRA: RSI bajo | Señales: ${bSignals}/${sSignals}`;
      }
      
      // Probar regex
      const regex = /Señales:\s*(\d+)\/(\d+)/;
      const match = testReason.match(regex);
      
      let decision: string;
      let reasonCode: string;
      let parsedBuySignals: number | null = null;
      
      if (match) {
        parsedBuySignals = parseInt(match[1], 10);
        if (testRegime === "TRANSITION") {
          decision = "BLOCKED";
          reasonCode = "REGIME_TRANSITION_PAUSE";
        } else if (parsedBuySignals < requiredSignals) {
          decision = "BLOCKED";
          reasonCode = "SMART_GUARD_INSUFFICIENT_SIGNALS";
        } else {
          decision = "ALLOWED";
          reasonCode = "B3_PASSED";
        }
      } else {
        // Fallback fail-closed en SMART_GUARD
        decision = "BLOCKED";
        reasonCode = "B3_REGEX_NO_MATCH";
        parsedBuySignals = null;
      }
      
      res.json({
        success: true,
        test: "B3_MIN_SIGNALS",
        input: {
          buySignals: bSignals,
          sellSignals: sSignals,
          regime: testRegime,
          reasonFormat: reasonFormat || "unified",
        },
        simulation: {
          testReason,
          regexUsed: regex.toString(),
          regexMatched: !!match,
          parsedBuySignals,
          requiredSignals,
          decision,
          reasonCode,
        },
        explanation: decision === "BLOCKED" 
          ? `BUY bloqueado: ${reasonCode} (got=${parsedBuySignals ?? 'N/A'}, required=${requiredSignals}, regime=${testRegime})`
          : `BUY permitido: señales suficientes (${parsedBuySignals} >= ${requiredSignals})`,
      });
      
    } catch (error: any) {
      res.status(500).json({ error: "B3_TEST_ERROR", message: error.message });
    }
  });

  // Telegram Chats CRUD endpoints
  app.get("/api/integrations/telegram/chats", async (req, res) => {
    try {
      const chats = await storage.getTelegramChats();
      res.json(chats);
    } catch (error) {
      res.status(500).json({ error: "Failed to get telegram chats" });
    }
  });

  app.post("/api/integrations/telegram/chats", async (req, res) => {
    try {
      const { name, chatId, isDefault } = req.body;
      
      if (!name || !chatId) {
        return res.status(400).json({ error: "Name and chatId are required" });
      }

      // Validate chatId format
      if (!/^-?\d+$/.test(chatId)) {
        return res.status(400).json({ error: "Invalid chatId format" });
      }

      const newChat = await storage.createTelegramChat({
        name,
        chatId,
        isDefault: isDefault || false,
        alertTrades: true,
        alertErrors: true,
        alertSystem: true,
        alertBalance: false,
        alertHeartbeat: false,
        isActive: true
      });

      res.json(newChat);
    } catch (error: any) {
      if (error.message?.includes('duplicate key')) {
        res.status(409).json({ error: "Chat with this ID already exists" });
      } else {
        res.status(500).json({ error: "Failed to create telegram chat" });
      }
    }
  });

  app.delete("/api/integrations/telegram/chats/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid chat ID" });
      }

      await storage.deleteTelegramChat(id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete telegram chat" });
    }
  });

  app.post("/api/integrations/telegram/send", async (req, res) => {
    try {
      const { message, chatId, chatRefId } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      // Determine target chat
      let targetChatId: string | undefined;
      
      if (chatId) {
        // Manual chat ID
        if (!/^-?\d+$/.test(chatId)) {
          return res.status(400).json({ error: "Invalid manual chatId format" });
        }
        targetChatId = chatId;
      } else if (chatRefId) {
        // Chat reference ID
        const chat = await storage.getTelegramChatByChatId(chatRefId);
        if (!chat) {
          return res.status(404).json({ error: "Chat not found" });
        }
        targetChatId = chat.chatId;
      } else {
        // Fallback to default chat
        const defaultChat = await storage.getDefaultChat();
        if (defaultChat) {
          targetChatId = defaultChat.chatId;
        } else {
          // Fallback to legacy
          const apiConfig = await storage.getApiConfig();
          targetChatId = apiConfig?.telegramChatId || undefined;
        }
      }

      if (!targetChatId) {
        return res.status(400).json({ error: "No target chat available" });
      }

      // Send message via telegram service
      const telegramModule = await import("./services/telegram");
      const telegramService = new telegramModule.TelegramService();
      
      const success = await telegramService.sendToChat(targetChatId, message);
      
      if (success) {
        res.json({ success: true, targetChatId });
      } else {
        res.status(500).json({ error: "Failed to send message" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Register configuration routes
  registerConfigRoutes(app);

  // ============================================
  // BACKUP MANAGEMENT ENDPOINTS
  // ============================================
  
  const { backupService } = await import('./services/BackupService');

  // List all backups
  app.get("/api/backups", async (req, res) => {
    try {
      const [backups, diskSpace, masters] = await Promise.all([
        backupService.listBackups(),
        backupService.getDiskSpace(),
        backupService.getMasterBackups(),
      ]);

      res.json({
        backups,
        diskSpace,
        masters,
        stats: {
          total: backups.length,
          masterCount: masters.length,
        },
      });
    } catch (error: any) {
      console.error('[API] Error listing backups:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Create a new backup
  app.post("/api/backups/create", async (req, res) => {
    try {
      const { type, name } = req.body;
      
      if (!type || !['full', 'database', 'code'].includes(type)) {
        return res.status(400).json({ error: 'Invalid backup type' });
      }

      const result = await backupService.createBackup(type, name);
      
      if (result.success) {
        res.json({ success: true, name: result.name });
      } else {
        res.status(500).json({ error: result.error });
      }
    } catch (error: any) {
      console.error('[API] Error creating backup:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Mark backup as master
  app.post("/api/backups/:name/set-master", async (req, res) => {
    try {
      const { name } = req.params;
      const { notes, captureMetrics } = req.body;

      const result = await backupService.markAsMaster(name, notes, captureMetrics !== false);
      
      if (result.success) {
        res.json({ success: true, master: result.master });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error: any) {
      console.error('[API] Error marking as master:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Unmark backup as master
  app.post("/api/backups/:name/unmark-master", async (req, res) => {
    try {
      const { name } = req.params;
      const result = await backupService.unmarkAsMaster(name);
      
      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error: any) {
      console.error('[API] Error unmarking master:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get master backups
  app.get("/api/backups/masters", async (req, res) => {
    try {
      const masters = await backupService.getMasterBackups();
      res.json({ masters });
    } catch (error: any) {
      console.error('[API] Error getting masters:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Restore a backup (requires confirmation)
  app.post("/api/backups/:name/restore", async (req, res) => {
    try {
      const { name } = req.params;
      const { confirmation, type } = req.body;

      if (confirmation !== 'RESTAURAR MAESTRO' && confirmation !== 'CONFIRMAR') {
        return res.status(400).json({ error: 'Invalid confirmation' });
      }

      if (!type || !['database', 'code', 'full'].includes(type)) {
        return res.status(400).json({ error: 'Invalid restore type' });
      }

      const result = await backupService.restoreBackup(name, type);
      
      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(500).json({ error: result.error });
      }
    } catch (error: any) {
      console.error('[API] Error restoring backup:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a backup
  app.delete("/api/backups/:name", async (req, res) => {
    try {
      const { name } = req.params;
      const result = await backupService.deleteBackup(name);
      
      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error: any) {
      console.error('[API] Error deleting backup:', error);
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
