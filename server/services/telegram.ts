import TelegramBot from "node-telegram-bot-api";
import { storage } from "../storage";
import type { TelegramChat } from "@shared/schema";

interface TelegramConfig {
  token: string;
  chatId: string;
}

type AlertType = "trades" | "errors" | "system" | "balance";

type EngineController = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isActive: () => boolean;
  getBalance?: () => Promise<Record<string, string>>;
  getOpenPositions?: () => Map<string, { amount: number; entryPrice: number }>;
};

export class TelegramService {
  private bot: TelegramBot | null = null;
  private chatId: string = "";
  private engineController: EngineController | null = null;
  private startTime: Date = new Date();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  setEngineController(controller: EngineController) {
    this.engineController = controller;
  }

  initialize(config: TelegramConfig) {
    if (this.bot) {
      try {
        this.bot.stopPolling();
        this.bot.removeAllListeners();
      } catch (e) {}
    }
    
    // Activar polling solo en Docker (NAS) - detectamos por variable de entorno
    const isDocker = process.env.DOCKER_ENV === 'true' || process.env.NODE_ENV === 'production';
    const enablePolling = isDocker;
    
    console.log(`[telegram] Inicializando bot - Polling: ${enablePolling ? 'ACTIVADO (Docker/NAS)' : 'DESACTIVADO (Replit)'}`);
    
    this.bot = new TelegramBot(config.token, { polling: enablePolling });
    this.chatId = config.chatId;
    this.setupCommands();
  }

  private setupCommands() {
    if (!this.bot) return;

    this.bot.onText(/\/estado/, async (msg) => {
      await this.handleEstado(msg.chat.id);
    });

    this.bot.onText(/\/pausar/, async (msg) => {
      await this.handlePausar(msg.chat.id);
    });

    this.bot.onText(/\/reanudar/, async (msg) => {
      await this.handleReanudar(msg.chat.id);
    });

    this.bot.onText(/\/ultimas/, async (msg) => {
      await this.handleUltimas(msg.chat.id);
    });

    this.bot.onText(/\/ayuda/, async (msg) => {
      await this.handleAyuda(msg.chat.id);
    });

    this.bot.onText(/\/balance/, async (msg) => {
      await this.handleBalance(msg.chat.id);
    });

    this.bot.onText(/\/config/, async (msg) => {
      await this.handleConfig(msg.chat.id);
    });

    this.bot.onText(/\/exposicion/, async (msg) => {
      await this.handleExposicion(msg.chat.id);
    });

    this.bot.onText(/\/uptime/, async (msg) => {
      await this.handleUptime(msg.chat.id);
    });

    this.bot.on("polling_error", (error) => {
      console.error("Telegram polling error:", error.message);
    });
  }

  private async handleEstado(chatId: number) {
    try {
      const config = await storage.getBotConfig();
      
      const engineActive = this.engineController?.isActive() ?? false;
      const configActive = config?.isActive ?? false;
      const status = engineActive ? "✅ ACTIVO (motor funcionando)" : 
                     configActive ? "⚠️ ACTIVADO (motor detenido)" : "⏸️ PAUSADO";
      const strategy = config?.strategy || "momentum";
      const riskLevel = config?.riskLevel || "medium";
      const pairs = config?.activePairs?.join(", ") || "BTC/USD, ETH/USD, SOL/USD";

      const chats = await storage.getActiveTelegramChats();
      const chatsInfo = chats.length > 0 
        ? `${chats.length} chat(s) configurados` 
        : "Sin chats adicionales";

      const message = `
📊 *Estado del Bot*

*Estado:* ${status}
*Estrategia:* ${strategy}
*Nivel de riesgo:* ${riskLevel}
*Pares activos:* ${pairs}
*Chats Telegram:* ${chatsInfo}

_Usa /ayuda para ver los comandos disponibles_
      `.trim();

      await this.bot?.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error obteniendo estado: ${error.message}`);
    }
  }

  private async handlePausar(chatId: number) {
    try {
      await storage.updateBotConfig({ isActive: false });
      
      if (this.engineController) {
        await this.engineController.stop();
      }
      
      await this.bot?.sendMessage(chatId, "⏸️ *Bot pausado correctamente*\n\nEl motor de trading se ha detenido.\nUsa /reanudar para volver a activarlo.", { parse_mode: "Markdown" });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error pausando bot: ${error.message}`);
    }
  }

  private async handleReanudar(chatId: number) {
    try {
      await storage.updateBotConfig({ isActive: true });
      
      if (this.engineController) {
        await this.engineController.start();
      }
      
      await this.bot?.sendMessage(chatId, "✅ *Bot activado correctamente*\n\nEl motor de trading ha comenzado a analizar el mercado.", { parse_mode: "Markdown" });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error activando bot: ${error.message}`);
    }
  }

  private async handleUltimas(chatId: number) {
    try {
      const trades = await storage.getTrades(5);
      
      if (trades.length === 0) {
        await this.bot?.sendMessage(chatId, "📭 No hay operaciones recientes.");
        return;
      }

      let message = "📈 *Últimas operaciones:*\n\n";
      
      for (const trade of trades) {
        const emoji = trade.type === "buy" ? "🟢" : "🔴";
        const tipo = trade.type === "buy" ? "Compra" : "Venta";
        const fecha = trade.executedAt ? new Date(trade.executedAt).toLocaleDateString("es-ES") : "Pendiente";
        
        message += `${emoji} *${tipo}* ${trade.pair}\n`;
        message += `   Precio: $${parseFloat(trade.price).toFixed(2)}\n`;
        message += `   Cantidad: ${trade.amount}\n`;
        message += `   Fecha: ${fecha}\n\n`;
      }

      await this.bot?.sendMessage(chatId, message.trim(), { parse_mode: "Markdown" });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error obteniendo operaciones: ${error.message}`);
    }
  }

  private async handleAyuda(chatId: number) {
    const message = `
🤖 *Comandos disponibles:*

/estado - Ver estado del bot
/balance - Ver balance actual
/config - Ver configuración de riesgo
/exposicion - Ver exposición por par
/uptime - Ver tiempo encendido
/pausar - Pausar el bot
/reanudar - Activar el bot
/ultimas - Ver últimas operaciones
/ayuda - Ver esta ayuda

_KrakenBot.AI - Trading Autónomo_
    `.trim();

    await this.bot?.sendMessage(chatId, message, { parse_mode: "Markdown" });
  }

  private async handleBalance(chatId: number) {
    try {
      const balances = this.engineController?.getBalance ? await this.engineController.getBalance() : {};
      const usd = parseFloat(balances?.ZUSD || balances?.USD || "0");
      const btc = parseFloat(balances?.XXBT || balances?.XBT || "0");
      const eth = parseFloat(balances?.XETH || balances?.ETH || "0");
      const sol = parseFloat(balances?.SOL || "0");

      const message = `
💰 *Balance Actual*

*USD:* $${usd.toFixed(2)}
*BTC:* ${btc.toFixed(6)}
*ETH:* ${eth.toFixed(6)}
*SOL:* ${sol.toFixed(4)}

_Actualizado: ${new Date().toLocaleString("es-ES")}_
      `.trim();

      await this.bot?.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error obteniendo balance: ${error.message}`);
    }
  }

  private async handleConfig(chatId: number) {
    try {
      const config = await storage.getBotConfig();
      const sl = parseFloat(config?.stopLossPercent?.toString() || "5");
      const tp = parseFloat(config?.takeProfitPercent?.toString() || "7");
      const trailing = config?.trailingStopEnabled ? `${config.trailingStopPercent}%` : "Desactivado";
      const pairExp = parseFloat(config?.maxPairExposurePct?.toString() || "25");
      const totalExp = parseFloat(config?.maxTotalExposurePct?.toString() || "60");
      const riskTrade = parseFloat(config?.riskPerTradePct?.toString() || "15");

      const message = `
⚙️ *Configuración de Riesgo*

🛑 *Stop-Loss:* ${sl}%
🎯 *Take-Profit:* ${tp}%
📉 *Trailing Stop:* ${trailing}
💵 *Riesgo por trade:* ${riskTrade}%
🔸 *Exp. por par:* ${pairExp}%
🔹 *Exp. total:* ${totalExp}%

_Estrategia: ${config?.strategy || "momentum"}_
      `.trim();

      await this.bot?.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error obteniendo configuración: ${error.message}`);
    }
  }

  private async handleExposicion(chatId: number) {
    try {
      const positions = this.engineController?.getOpenPositions?.() || new Map();
      
      if (positions.size === 0) {
        await this.bot?.sendMessage(chatId, "📊 *Sin posiciones abiertas*\n\nNo hay exposición actual.", { parse_mode: "Markdown" });
        return;
      }

      let message = "📊 *Exposición Actual*\n\n";
      let totalExp = 0;

      positions.forEach((pos, pair) => {
        const exposure = pos.amount * pos.entryPrice;
        totalExp += exposure;
        const pnl = "N/A";
        message += `*${pair}:* $${exposure.toFixed(2)}\n`;
        message += `   Entrada: $${pos.entryPrice.toFixed(2)}\n`;
        message += `   Cantidad: ${pos.amount.toFixed(6)}\n\n`;
      });

      message += `*Total expuesto:* $${totalExp.toFixed(2)}`;

      await this.bot?.sendMessage(chatId, message.trim(), { parse_mode: "Markdown" });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error obteniendo exposición: ${error.message}`);
    }
  }

  private async handleUptime(chatId: number) {
    const now = new Date();
    const diff = now.getTime() - this.startTime.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    const engineActive = this.engineController?.isActive() ?? false;
    const status = engineActive ? "✅ Motor activo" : "⏸️ Motor pausado";

    const message = `
⏱️ *Uptime del Bot*

*Tiempo encendido:* ${days}d ${hours}h ${minutes}m
*Estado:* ${status}
*Iniciado:* ${this.startTime.toLocaleString("es-ES")}

_KrakenBot.AI_
    `.trim();

    await this.bot?.sendMessage(chatId, message, { parse_mode: "Markdown" });
  }

  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    const TWELVE_HOURS = 12 * 60 * 60 * 1000;
    
    this.heartbeatInterval = setInterval(async () => {
      await this.sendHeartbeat();
    }, TWELVE_HOURS);

    console.log("[telegram] Heartbeat iniciado (cada 12h)");
  }

  private async sendHeartbeat() {
    try {
      const config = await storage.getBotConfig();
      const engineActive = this.engineController?.isActive() ?? false;
      const status = engineActive ? "✅ Activo" : "⏸️ Pausado";
      
      const now = new Date();
      const diff = now.getTime() - this.startTime.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

      const trades = await storage.getTrades(5);
      const recentOps = trades.length > 0 ? `${trades.length} recientes` : "Sin operaciones";

      const message = `
💓 *Heartbeat - KrakenBot*

*Estado:* ${status}
*Uptime:* ${days}d ${hours}h
*Estrategia:* ${config?.strategy || "momentum"}
*Pares:* ${config?.activePairs?.join(", ") || "N/A"}
*Ops recientes:* ${recentOps}

_${now.toLocaleString("es-ES")}_
      `.trim();

      const chats = await storage.getActiveTelegramChats();
      for (const chat of chats) {
        if (chat.alertHeartbeat) {
          await this.sendToChat(chat.chatId, message);
        }
      }

      if (this.chatId) {
        await this.sendMessage(message);
      }
    } catch (error) {
      console.error("[telegram] Error enviando heartbeat:", error);
    }
  }

  isInitialized(): boolean {
    return this.bot !== null && this.chatId !== "";
  }

  async sendMessage(message: string): Promise<boolean> {
    if (!this.bot || !this.chatId) {
      console.warn("Telegram not initialized, skipping notification");
      return false;
    }

    try {
      await this.bot.sendMessage(this.chatId, message, { parse_mode: "Markdown" });
      return true;
    } catch (error) {
      console.error("Failed to send Telegram message:", error);
      return false;
    }
  }

  async sendToChat(chatId: string, message: string): Promise<boolean> {
    if (!this.bot) {
      console.warn("Telegram bot not initialized");
      return false;
    }

    try {
      await this.bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
      return true;
    } catch (error) {
      console.error(`Failed to send message to chat ${chatId}:`, error);
      return false;
    }
  }

  async sendAlertToMultipleChats(message: string, alertType: AlertType): Promise<void> {
    if (!this.bot) return;

    const sentChatIds = new Set<string>();

    try {
      if (this.chatId) {
        await this.sendMessage(message);
        sentChatIds.add(this.chatId);
      }

      const chats = await storage.getActiveTelegramChats();
      
      for (const chat of chats) {
        if (sentChatIds.has(chat.chatId)) continue;
        
        const shouldSend = this.shouldSendToChat(chat, alertType);
        if (shouldSend) {
          await this.sendToChat(chat.chatId, message);
          sentChatIds.add(chat.chatId);
        }
      }
    } catch (error) {
      console.error("Error sending to multiple chats:", error);
    }
  }

  private shouldSendToChat(chat: TelegramChat, alertType: AlertType): boolean {
    switch (alertType) {
      case "trades":
        return chat.alertTrades;
      case "errors":
        return chat.alertErrors;
      case "system":
        return chat.alertSystem;
      case "balance":
        return chat.alertBalance;
      default:
        return false;
    }
  }

  async sendTradeNotification(trade: {
    type: string;
    pair: string;
    price: string;
    amount: string;
    status: string;
  }) {
    const emoji = trade.type === "buy" || trade.type === "COMPRA" ? "🟢" : "🔴";
    const message = `
${emoji} *Nueva Operación*

*Tipo:* ${trade.type.toUpperCase()}
*Par:* ${trade.pair}
*Precio:* $${trade.price}
*Cantidad:* ${trade.amount}
*Estado:* ${trade.status}

_KrakenBot.AI - Trading Autónomo_
    `.trim();

    await this.sendAlertToMultipleChats(message, "trades");
  }

  async sendAlert(title: string, description: string) {
    const message = `
⚠️ *${title}*

${description}

_KrakenBot.AI - Sistema de Alertas_
    `.trim();

    await this.sendAlertToMultipleChats(message, "errors");
  }

  async sendSystemStatus(isActive: boolean, strategy: string) {
    const emoji = isActive ? "✅" : "⏸️";
    const status = isActive ? "EN LÍNEA" : "PAUSADO";
    const message = `
${emoji} *Estado del Sistema*

*Status:* ${status}
*Estrategia:* ${strategy}

_KrakenBot.AI - Monitoreo_
    `.trim();

    await this.sendAlertToMultipleChats(message, "system");
  }

  async sendBalanceAlert(title: string, description: string) {
    const message = `
💰 *${title}*

${description}

_KrakenBot.AI - Balance_
    `.trim();

    await this.sendAlertToMultipleChats(message, "balance");
  }
}

export const telegramService = new TelegramService();
