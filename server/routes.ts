import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { krakenService } from "./services/kraken";
import { telegramService } from "./services/telegram";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
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
      
      if (req.body.isActive !== undefined) {
        await telegramService.sendSystemStatus(
          req.body.isActive,
          req.body.strategy || updated.strategy
        );
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

  return httpServer;
}
