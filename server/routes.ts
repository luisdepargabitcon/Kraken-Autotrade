import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { krakenService } from "./services/kraken";
import { telegramService } from "./services/telegram";
import { TradingEngine } from "./services/tradingEngine";
import { botLogger } from "./services/botLogger";
import { z } from "zod";

let tradingEngine: TradingEngine | null = null;

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
    });
    
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
          balances = await krakenService.getBalance();
          
          const pairs = ["XXBTZUSD", "XETHZUSD", "SOLUSD"];
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

      const curve: { time: string; equity: number; pnl?: number }[] = [
        { time: new Date(sortedTrades[0]?.executedAt || sortedTrades[0]?.createdAt || new Date()).toISOString(), equity: STARTING_EQUITY }
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

      await storage.updateTradeStatus(tradeId, "filled", order.txid?.[0]);
      
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

      const tradesHistory = await krakenService.getTradesHistory();
      const trades = tradesHistory.trades || {};
      
      let synced = 0;
      for (const [txid, trade] of Object.entries(trades)) {
        const t = trade as any;
        try {
          const existingTrades = await storage.getTrades(1000);
          const exists = existingTrades.some(et => et.krakenOrderId === txid);
          
          if (!exists) {
            await storage.createTrade({
              tradeId: `K-${txid.substring(0, 8)}`,
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
      
      res.json(filtered.map(e => ({
        id: e.id,
        timestamp: e.timestamp,
        level: e.level,
        type: e.type,
        message: e.message,
        meta: e.meta ? JSON.parse(e.meta) : null,
      })));
    } catch (error: any) {
      console.error("[api/events] Error:", error.message);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  return httpServer;
}
