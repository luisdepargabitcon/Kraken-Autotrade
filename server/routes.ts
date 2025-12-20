import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { krakenService } from "./services/kraken";
import { telegramService } from "./services/telegram";
import { TradingEngine } from "./services/tradingEngine";
import { botLogger } from "./services/botLogger";
import { aiService } from "./services/aiService";
import { eventsWs } from "./services/eventsWebSocket";
import { terminalWsServer } from "./services/terminalWebSocket";
import { environment } from "./services/environment";
import { z } from "zod";

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
      getBalance: async () => krakenService.isInitialized() ? await krakenService.getBalance() as Record<string, string> : {},
      getOpenPositions: () => tradingEngine?.getOpenPositions() ?? new Map(),
    });
    
    // Start heartbeat for Telegram notifications
    telegramService.startHeartbeat();
    
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
      res.json({
        krakenConnected: config?.krakenConnected || false,
        telegramConnected: config?.telegramConnected || false,
        hasKrakenKeys: !!(config?.krakenApiKey && config?.krakenApiSecret),
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
      const { name, chatId, alertTrades, alertErrors, alertSystem, alertBalance } = req.body;
      
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

      const chat = await storage.createTelegramChat({
        name,
        chatId,
        alertTrades: alertTrades ?? true,
        alertErrors: alertErrors ?? true,
        alertSystem: alertSystem ?? true,
        alertBalance: alertBalance ?? false,
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
      const { name, chatId, alertTrades, alertErrors, alertSystem, alertBalance, isActive } = req.body;
      
      const chat = await storage.updateTelegramChat(id, {
        name,
        chatId,
        alertTrades,
        alertErrors,
        alertSystem,
        alertBalance,
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
      
      let balances: Record<string, string> = {};
      let prices: Record<string, { price: string; change: string }> = {};
      
      if (krakenService.isInitialized()) {
        try {
          balances = await krakenService.getBalance() as Record<string, string>;
          
          const pairs = ["XXBTZUSD", "XETHZUSD", "SOLUSD", "XXRPZUSD", "TONUSD"];
          for (const pair of pairs) {
            try {
              const ticker = await krakenService.getTicker(pair);
              const tickerData: any = Object.values(ticker)[0];
              if (tickerData) {
                const currentPrice = parseFloat(tickerData.c?.[0] || "0");
                const openPrice = parseFloat(tickerData.o || "0");
                const change = openPrice > 0 ? ((currentPrice - openPrice) / openPrice * 100).toFixed(2) : "0";
                prices[pair] = { price: tickerData.c?.[0] || "0", change };
              }
            } catch (e) {}
          }
        } catch (e) {}
      }
      
      res.json({
        krakenConnected: apiConfig?.krakenConnected || false,
        telegramConnected: apiConfig?.telegramConnected || false,
        botActive: botConfig?.isActive || false,
        strategy: botConfig?.strategy || "momentum",
        activePairs: botConfig?.activePairs || ["BTC/USD", "ETH/USD", "SOL/USD"],
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
      
      const positionsWithPnl = await Promise.all(positions.map(async (pos) => {
        let currentPrice = 0;
        let unrealizedPnlUsd = 0;
        let unrealizedPnlPct = 0;
        
        if (krakenService.isInitialized()) {
          try {
            const krakenPair = krakenService.formatPair(pos.pair);
            const ticker = await krakenService.getTicker(krakenPair);
            const tickerData: any = Object.values(ticker)[0];
            if (tickerData?.c?.[0]) {
              currentPrice = parseFloat(tickerData.c[0]);
              const entryPrice = parseFloat(pos.entryPrice);
              const amount = parseFloat(pos.amount);
              unrealizedPnlUsd = (currentPrice - entryPrice) * amount;
              unrealizedPnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
            }
          } catch (e) {}
        }
        
        const amount = parseFloat(pos.amount);
        const entryPrice = parseFloat(pos.entryPrice);
        const entryValueUsd = entryPrice * amount;
        const currentValueUsd = currentPrice * amount;
        
        return {
          ...pos,
          currentPrice: currentPrice.toString(),
          unrealizedPnlUsd: unrealizedPnlUsd.toFixed(2),
          unrealizedPnlPct: unrealizedPnlPct.toFixed(2),
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
          const ticker = await krakenService.getTicker(krakenPair);
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

  // === RECONCILIAR POSICIONES CON KRAKEN ===
  // Compara balances reales con posiciones en BD y elimina huérfanas
  app.post("/api/positions/reconcile", async (req, res) => {
    try {
      if (!krakenService) {
        return res.status(503).json({ 
          success: false, 
          error: "Kraken service not initialized" 
        });
      }

      // Obtener todas las posiciones abiertas de BD
      const openPositions = await storage.getOpenPositions();
      if (openPositions.length === 0) {
        return res.json({
          success: true,
          message: "No hay posiciones abiertas en BD",
          reconciled: 0,
          orphans: [],
        });
      }

      // Obtener balances reales de Kraken
      const balances = await krakenService.getBalance() as Record<string, string>;
      
      // Mínimos de orden por par (hardcoded ya que getAssetPairs es para todos los pares)
      const orderMinMap: Record<string, number> = {
        "BTC/USD": 0.0001,
        "ETH/USD": 0.004,
        "SOL/USD": 0.2,
        "XRP/USD": 10,
        "TON/USD": 10,
      };
      
      // Obtener mínimos de orden por par
      const orphanPositions: Array<{ lotId: string; pair: string; amount: string; reason: string }> = [];
      const validPositions: Array<{ lotId: string; pair: string; amount: string }> = [];
      
      for (const pos of openPositions) {
        const assetMap: Record<string, string> = {
          "BTC/USD": "XXBT",
          "ETH/USD": "XETH",
          "SOL/USD": "SOL",
          "XRP/USD": "XXRP",
          "TON/USD": "TON",
        };
        const assetKey = assetMap[pos.pair];
        if (!assetKey) {
          // Par desconocido, marcar como huérfana
          orphanPositions.push({
            lotId: pos.lotId,
            pair: pos.pair,
            amount: pos.amount,
            reason: "Par no reconocido",
          });
          continue;
        }

        const realBalance = parseFloat(balances[assetKey] || "0");
        const positionAmount = parseFloat(pos.amount);
        
        // Obtener mínimo de orden para este par
        const orderMin = orderMinMap[pos.pair] || 0.0001;
        
        // Si el balance real es menor al mínimo de orden, es huérfana
        if (realBalance < orderMin) {
          orphanPositions.push({
            lotId: pos.lotId,
            pair: pos.pair,
            amount: pos.amount,
            reason: `Balance real (${realBalance.toFixed(8)}) < mínimo (${orderMin})`,
          });
        } else {
          validPositions.push({
            lotId: pos.lotId,
            pair: pos.pair,
            amount: pos.amount,
          });
        }
      }

      // Auto-limpiar huérfanas si se solicita
      const autoClean = req.body?.autoClean === true;
      let cleaned = 0;
      
      if (autoClean && orphanPositions.length > 0) {
        for (const orphan of orphanPositions) {
          try {
            await storage.deleteOpenPositionByLotId(orphan.lotId);
            if (tradingEngine) {
              tradingEngine.getOpenPositions().delete(orphan.lotId);
            }
            cleaned++;
          } catch (err) {
            console.error(`Error limpiando huérfana ${orphan.lotId}:`, err);
          }
        }
        
        await botLogger.info("ORPHAN_POSITION_DELETED", `Reconciliación completada`, {
          total: openPositions.length,
          orphans: orphanPositions.length,
          cleaned,
          valid: validPositions.length,
        });
        
        if (telegramService?.isInitialized()) {
          await telegramService.sendMessage(`
🔄 *Reconciliación Completada*

*Total posiciones:* ${openPositions.length}
*Huérfanas eliminadas:* ${cleaned}
*Válidas:* ${validPositions.length}
          `.trim());
        }
      }

      res.json({
        success: true,
        total: openPositions.length,
        orphans: orphanPositions,
        valid: validPositions,
        cleaned,
        message: autoClean 
          ? `Reconciliación completada: ${cleaned} huérfanas eliminadas`
          : `Encontradas ${orphanPositions.length} posiciones huérfanas`,
      });
      
    } catch (error: any) {
      console.error("[api/positions/reconcile] Error:", error.message);
      res.status(500).json({
        success: false,
        error: "INTERNAL_ERROR",
        message: error.message,
      });
    }
  });

  app.get("/api/trades/closed", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = parseInt(req.query.offset as string) || 0;
      const pair = req.query.pair as string | undefined;
      const result = (req.query.result as 'winner' | 'loser' | 'all') || 'all';
      const type = (req.query.type as 'all' | 'buy' | 'sell') || 'all';
      
      const { trades, total } = await storage.getClosedTrades({ limit, offset, pair, result, type });
      
      res.json({
        trades: trades.map(t => {
          const price = parseFloat(t.price);
          const amount = parseFloat(t.amount);
          const totalUsd = price * amount;
          const entryValueUsd = t.entryPrice ? parseFloat(t.entryPrice) * amount : null;
          
          return {
            ...t,
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
      const ticker = await krakenService.getTicker(pair);
      
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

  app.post("/api/trade", async (req, res) => {
    try {
      if (!krakenService.isInitialized()) {
        return res.status(400).json({ error: "Kraken not configured" });
      }

      const { pair, type, ordertype, volume, price } = req.body;
      
      const tradeId = `T-${Date.now()}`;
      
      const trade = await storage.createTrade({
        tradeId,
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

  app.get("/api/notifications", async (req, res) => {
    try {
      const notifications = await storage.getUnsentNotifications();
      res.json(notifications);
    } catch (error) {
      res.status(500).json({ error: "Failed to get notifications" });
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
          
          // 1. Verificar por ORDER ID (lo que guardó el bot)
          if (ordertxid) {
            const existingByOrderId = await storage.getTradeByKrakenOrderId(ordertxid);
            if (existingByOrderId) {
              skipped++;
              continue;
            }
          }
          
          // 2. Verificar por FILL ID (sync previo)
          const existingByFillId = await storage.getTradeByKrakenOrderId(txid);
          if (existingByFillId) {
            skipped++;
            continue;
          }
          
          // 3. Verificar por características (pair + amount + type + timestamp < 60s)
          const existingByTraits = await storage.findDuplicateTrade(pair, t.vol, t.type, executedAt);
          if (existingByTraits) {
            skipped++;
            continue;
          }
          
          // No existe duplicado, insertar
          const result = await storage.upsertTradeByKrakenId({
            tradeId: `KRAKEN-${txid}`,
            pair,
            type: t.type,
            price: t.price,
            amount: t.vol,
            status: "filled",
            krakenOrderId: txid,
            executedAt,
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
            const pnlPct = cost > 0 ? (pnlGross / cost) * 100 : 0;
            
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
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
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
      const dryRun = environment.isReplit || (config?.dryRunMode ?? false);
      
      // Obtener git commit hash
      let gitCommit = "unknown";
      try {
        const { execSync } = await import("child_process");
        gitCommit = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
      } catch {
        // Git no disponible, usar archivo de versión si existe
        try {
          const fs = await import("fs");
          if (fs.existsSync("VERSION")) {
            gitCommit = fs.readFileSync("VERSION", "utf-8").trim();
          }
        } catch {}
      }
      
      res.json({
        env: environment.envTag,
        instanceId: environment.instanceId,
        isReplit: environment.isReplit,
        isNAS: environment.isNAS,
        dryRun,
        gitCommit,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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
          currentPrice = parseFloat(ticker?.c?.[0] || "0");
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
        const balances = await krakenService.getBalance() as Record<string, string>;
        usdBalance = parseFloat(balances?.ZUSD || balances?.USD || "0");
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
          signalConfidence: 80,
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
        res.json({ success: true, deleted, lotId });
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

  return httpServer;
}
