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
import { z } from "zod";
import { errorAlertService } from "./services/ErrorAlertService";
import cron from "node-cron";
import http from "http";
import type { RouterDeps } from "./routes/types";

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
    
    // FISCO daily sync scheduler (08:00 server time)
    try {
      const fiscoCron = process.env.FISCO_DAILY_SYNC_CRON || '0 8 * * *';
      const fiscoTz = process.env.FISCO_DAILY_SYNC_TZ || 'Europe/Madrid';

      cron.schedule(
        fiscoCron,
        async () => {
          try {
            console.log('[fisco-daily-sync] Starting daily fiscal data synchronization...');
            const startTime = Date.now();
            
            const port = parseInt(process.env.PORT || '5000', 10);
            const url = `http://127.0.0.1:${port}/api/fisco/run`;
            
            const f = (globalThis as any).fetch as undefined | ((...args: any[]) => Promise<any>);
            
            let response;
            if (f) {
              response = await f(url);
            } else {
              // Node.js fallback
              response = await new Promise<any>((resolve, reject) => {
                const http = require('http');
                const req = http.request(url, (res: any) => {
                  let data = '';
                  res.on('data', (chunk: any) => data += chunk);
                  res.on('end', () => {
                    try {
                      resolve({
                        ok: res.statusCode === 200,
                        status: res.statusCode,
                        json: async () => JSON.parse(data)
                      });
                    } catch (e) {
                      reject(e);
                    }
                  });
                });
                req.on('error', reject);
                req.end();
              });
            }
            
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            
            console.log(`[fisco-daily-sync] Completed in ${elapsed}s - ${result.normalized?.total || 0} operations processed`);
            
            // Send Telegram notification
            try {
              const ErrorAlertService = (await import('./services/ErrorAlertService')).ErrorAlertService;
              const alertService = ErrorAlertService.getInstance();
              
              const message = `✅ <b>SINCRONIZACIÓN FISCAL COMPLETADA</b>\n━━━━━━━━━━━━━━━━━━━\n🕒 ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}\n📊 Operaciones: ${result.normalized?.total || 0}\n⏱️ Duración: ${elapsed}s\n💾 Última sincronización: ${new Date().toISOString()}`;
              
              await alertService.sendCriticalError({
                type: 'SYSTEM_ERROR',
                message: message,
                function: 'fisco-daily-sync',
                fileName: 'routes.ts',
                severity: 'LOW', // Use LOW for info messages
                timestamp: new Date(),
              });
              
              console.log('[fisco-daily-sync] Telegram notification sent');
            } catch (telegramError: any) {
              console.error('[fisco-daily-sync] Failed to send Telegram notification:', telegramError.message);
            }
            
          } catch (e: any) {
            console.error('[fisco-daily-sync] Error:', e?.message || e);
            
            // Send error notification to Telegram
            try {
              const ErrorAlertService = (await import('./services/ErrorAlertService')).ErrorAlertService;
              const alertService = ErrorAlertService.getInstance();
              
              const message = `❌ <b>ERROR EN SINCRONIZACIÓN FISCAL</b>\n━━━━━━━━━━━━━━━━━━━\n🕒 ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}\n❌ Error: ${e?.message || 'Unknown error'}\n📍 Archivo: routes.ts\n📍 Función: fisco-daily-sync`;
              
              await alertService.sendCriticalError({
                type: 'SYSTEM_ERROR',
                message: message,
                function: 'fisco-daily-sync',
                fileName: 'routes.ts',
                severity: 'MEDIUM',
                timestamp: new Date(),
              });
              
              console.log('[fisco-daily-sync] Error notification sent to Telegram');
            } catch (telegramError: any) {
              console.error('[fisco-daily-sync] Failed to send error notification:', telegramError.message);
            }
          }
        },
        { timezone: fiscoTz }
      );
      console.log(`[startup] FISCO daily sync scheduled: ${fiscoCron} (${fiscoTz})`);
    } catch (e: any) {
      console.error('[startup] Failed to schedule FISCO daily sync:', e?.message || e);
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
  const { registerFiscoRoutes } = await import('./routes/fisco.routes');
  registerFiscoRoutes(app, routerDeps);

  // ============================================================
  // TEST & DEBUG ENDPOINTS (modularized)
  // ============================================================
  const { registerTestRoutes } = await import('./routes/test.routes');
  registerTestRoutes(app, routerDeps);

  // ============================================================
  // TELEGRAM ENDPOINTS (modularized)
  // ============================================================
  const { registerTelegramRoutes } = await import('./routes/telegram.routes');
  registerTelegramRoutes(app, routerDeps);

  // Register configuration routes
  registerConfigRoutes(app);

  // ============================================
  // BACKUP MANAGEMENT ENDPOINTS (modularized)
  // ============================================
  const { registerBackupRoutes } = await import('./routes/backups.routes');
  await registerBackupRoutes(app, routerDeps);

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

  return httpServer;
}

