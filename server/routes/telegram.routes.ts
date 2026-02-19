import type { Express } from "express";
import type { RegisterRoutes } from "./types";
import { storage } from "../storage";

export const registerTelegramRoutes: RegisterRoutes = (app, _deps) => {

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
      const telegramModule = await import("../services/telegram");
      const telegramSvc = new telegramModule.TelegramService();
      
      const success = await telegramSvc.sendToChat(targetChatId, message);
      
      if (success) {
        res.json({ success: true, targetChatId });
      } else {
        res.status(500).json({ error: "Failed to send message" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
};
