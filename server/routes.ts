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
      const updated = await storage.updateBotConfig(req.body);
      
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
      const { reason } = req.body;
      
      const correlationId = `MANUAL-CLOSE-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      
      // Verificar que la posición existe
      const positions = await storage.getOpenPositions();
      const position = positions.find(p => p.pair === pair);
      
      if (!position) {
        await botLogger.warn("MANUAL_CLOSE_FAILED", `Intento de cierre manual fallido - posición no encontrada`, {
          pair,
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
      const isDryRun = botConfig?.dryRunMode || environment.isReplitEnvironment();
      
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
      
      // Log el intento de cierre manual
      await botLogger.info("MANUAL_CLOSE_INITIATED", `Cierre manual iniciado por usuario`, {
        correlationId,
        pair,
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
      
      const closeResult = await tradingEngine.forceClosePosition(pair, currentPrice, correlationId, reason || "Cierre manual por usuario");
      
      if (closeResult.success) {
        await botLogger.info("MANUAL_CLOSE_SUCCESS", `Posición cerrada manualmente`, {
          correlationId,
          pair,
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
        await botLogger.error("MANUAL_CLOSE_FAILED", `Error al cerrar posición manualmente`, {
          correlationId,
          pair,
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
      console.error("[api/positions/close] Error:", error.message);
      res.status(500).json({
        success: false,
        error: "INTERNAL_ERROR",
        message: `Error al procesar cierre: ${error.message}`,
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
      const trades = tradesHistory.trades || {};
      
      let synced = 0;
      for (const [txid, trade] of Object.entries(trades)) {
        const t = trade as any;
        try {
          // Buscar directamente por krakenOrderId en DB (eficiente)
          const existingTrade = await storage.getTradeByKrakenOrderId(txid);
          
          if (!existingTrade) {
            await storage.createTrade({
              tradeId: `KRAKEN-${txid}`, // Usar txid completo para evitar colisiones
              pair: krakenService.formatPairReverse(t.pair),
              type: t.type,
              price: t.price,
              amount: t.vol,
              status: "filled",
              krakenOrderId: txid,
              executedAt: new Date(t.time * 1000),
            });
            synced++;
          }
        } catch (e) {
          console.error("Error syncing trade:", txid, e);
        }
      }

      res.json({ success: true, synced, total: Object.keys(trades).length });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to sync trades" });
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
      res.json({
        env: environment.envTag,
        instanceId: environment.instanceId,
        isReplit: environment.isReplit,
        isNAS: environment.isNAS,
        dryRun,
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

  return httpServer;
}
