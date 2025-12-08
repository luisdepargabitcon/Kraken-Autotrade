import TelegramBot from "node-telegram-bot-api";

interface TelegramConfig {
  token: string;
  chatId: string;
}

export class TelegramService {
  private bot: TelegramBot | null = null;
  private chatId: string = "";

  initialize(config: TelegramConfig) {
    this.bot = new TelegramBot(config.token, { polling: false });
    this.chatId = config.chatId;
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

    return await this.sendMessage(message);
  }

  async sendAlert(title: string, description: string) {
    const message = `
⚠️ *${title}*

${description}

_KrakenBot.AI - Sistema de Alertas_
    `.trim();

    return await this.sendMessage(message);
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

    return await this.sendMessage(message);
  }
}

export const telegramService = new TelegramService();
