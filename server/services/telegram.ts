import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import si from "systeminformation";
import { storage } from "../storage";
import type { TelegramChat } from "@shared/schema";
import { environment } from "./environment";

// ============================================================
// HTML ESCAPE HELPER - Previene markup roto en mensajes
// ============================================================
function escapeHtml(s: unknown): string {
  const str = String(s ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================
// TELEGRAM MESSAGE TEMPLATES (HTML format)
// ============================================================

interface BotStartedContext {
  env: string;
  strategy: string;
  risk: string;
  pairs: string[];
  balanceUsd: string;
  mode: string;
  positionCount: number;
}

function buildBotStartedHTML(ctx: BotStartedContext): string {
  return [
    `<b>${escapeHtml(ctx.env)} 🟢 KrakenBot Iniciado</b>`,
    ``,
    `El bot de trading autónomo está activo.`,
    `<b>Estrategia:</b> ${escapeHtml(ctx.strategy)}`,
    `<b>Nivel de riesgo:</b> ${escapeHtml(ctx.risk)}`,
    `<b>Pares activos:</b> ${escapeHtml(ctx.pairs.join(", "))}`,
    `<b>Balance USD:</b> $${escapeHtml(ctx.balanceUsd)}`,
    `<b>Posiciones abiertas:</b> ${ctx.positionCount}`,
    ``,
    `⚠️ <b>Modo:</b> ${escapeHtml(ctx.mode)}`
  ].join("\n");
}

interface HeartbeatContext {
  env: string;
  cpu: string;
  mem: string;
  disk: string;
  uptime: string;
  krakenOk: boolean;
  telegramOk: boolean;
  dbOk: boolean;
  ts: string;
}

function buildHeartbeatHTML(ctx: HeartbeatContext): string {
  return [
    `<b>💗 VERIFICACIÓN DE OPERATIVIDAD</b>`,
    ``,
    `Este mensaje confirma que el bot está activo y monitorizando.`,
    ``,
    `<b>📊 Estado del sistema:</b>`,
    `• CPU: ${escapeHtml(ctx.cpu)}`,
    `• Memoria: ${escapeHtml(ctx.mem)}`,
    `• Disco: ${escapeHtml(ctx.disk)}`,
    `• Uptime: ${escapeHtml(ctx.uptime)}`,
    ``,
    `<b>✅ Conexiones:</b>`,
    `${ctx.krakenOk ? "✅" : "❌"} Kraken`,
    `${ctx.telegramOk ? "✅" : "❌"} Telegram`,
    `${ctx.dbOk ? "✅" : "❌"} DB`,
    ``,
    `<b>🕒 Hora:</b> ${escapeHtml(ctx.ts)}`,
    ``,
    `✅ Sistema operativo 24x7`
  ].join("\n");
}

interface DailyReportContext {
  env: string;
  cpu: string;
  mem: string;
  disk: string;
  uptime: string;
  krakenOk: boolean;
  telegramOk: boolean;
  dbOk: boolean;
  dryRun: boolean;
  mode: string;
  strategy: string;
  pairs: string;
  positionCount: number;
  exposureUsd: string;
  ts: string;
}

function buildDailyReportHTML(ctx: DailyReportContext): string {
  return [
    `<b>💗 REPORTE DIARIO (14:00)</b>`,
    ``,
    `<b>✅ Estado de conexiones:</b>`,
    `• Kraken: ${ctx.krakenOk ? "✅ OK" : "❌ ERROR"}`,
    `• DB: ${ctx.dbOk ? "✅ OK" : "❌ ERROR"}`,
    `• Telegram: ${ctx.telegramOk ? "✅ OK" : "❌ ERROR"}`,
    ``,
    `<b>📊 Recursos del sistema:</b>`,
    `• CPU: ${escapeHtml(ctx.cpu)}`,
    `• Memoria: ${escapeHtml(ctx.mem)}`,
    `• Disco: ${escapeHtml(ctx.disk)}`,
    `• Uptime: ${escapeHtml(ctx.uptime)}`,
    ``,
    `<b>🤖 Estado del bot:</b>`,
    `• Entorno: ${escapeHtml(ctx.env)}`,
    `• DRY_RUN: ${ctx.dryRun ? "SÍ" : "NO"}`,
    `• Modo: ${escapeHtml(ctx.mode)}`,
    `• Estrategia: ${escapeHtml(ctx.strategy)}`,
    `• Pares: ${escapeHtml(ctx.pairs)}`,
    `• Posiciones: ${ctx.positionCount}`,
    `• Exposición: $${escapeHtml(ctx.exposureUsd)}`,
    ``,
    `<i>${escapeHtml(ctx.ts)}</i>`
  ].join("\n");
}

interface TradeBuyContext {
  env: string;
  pair: string;
  amount: string;
  price: string;
  total: string;
  orderId: string;
  strategyLabel: string;
  confPct: string;
  reason: string;
  signalsSummary?: string;
  mode: string;
}

function buildTradeBuyHTML(ctx: TradeBuyContext): string {
  const lines = [
    `<b>${escapeHtml(ctx.env)} 🟢 Operación Automática Ejecutada</b>`,
    ``,
    `<b>📌 Tipo:</b> BUY`,
    `<b>📌 Par:</b> ${escapeHtml(ctx.pair)}`,
    `<b>📌 Cantidad:</b> ${escapeHtml(ctx.amount)}`,
    `<b>📌 Precio:</b> $${escapeHtml(ctx.price)}`,
    `<b>📌 Total:</b> $${escapeHtml(ctx.total)}`,
    `<b>🔗 ID:</b> <code>${escapeHtml(ctx.orderId)}</code>`,
    ``,
    `<b>🧠 Estrategia:</b> ${escapeHtml(ctx.strategyLabel)} | <b>Confianza:</b> ${escapeHtml(ctx.confPct)}%`,
    `<b>📝 Razón:</b> ${escapeHtml(ctx.reason)}`
  ];
  if (ctx.signalsSummary) {
    lines.push(`<b>📊 Señales:</b> ${escapeHtml(ctx.signalsSummary)}`);
  }
  lines.push(``, `<b>🛡️ Modo:</b> ${escapeHtml(ctx.mode)}`);
  return lines.join("\n");
}

interface TradeSellContext {
  env: string;
  pair: string;
  amount: string;
  price: string;
  total: string;
  orderId: string;
  exitType: string;
  trigger?: string;
  pnlUsd: number | null;
  pnlPct: number | null;
  feeUsd?: number | null;
  strategyLabel: string;
  confPct: string;
  reason: string;
  mode: string;
}

function buildTradeSellHTML(ctx: TradeSellContext): string {
  const pnlSign = (ctx.pnlUsd !== null && ctx.pnlUsd >= 0) ? "+" : "";
  const pnlUsdTxt = (ctx.pnlUsd === null || ctx.pnlUsd === undefined)
    ? "N/A (sin entryPrice)"
    : `${pnlSign}$${ctx.pnlUsd.toFixed(2)}${(ctx.pnlPct !== null && ctx.pnlPct !== undefined) ? ` (${ctx.pnlPct.toFixed(2)}%)` : ""}`;
  const feeTxt = (ctx.feeUsd === null || ctx.feeUsd === undefined) ? "N/A" : `$${ctx.feeUsd.toFixed(2)}`;

  const lines = [
    `<b>${escapeHtml(ctx.env)} 🔴 Operación Automática Ejecutada</b>`,
    ``,
    `<b>📌 Tipo:</b> SELL`,
    `<b>📌 Par:</b> ${escapeHtml(ctx.pair)}`,
    `<b>📌 Cantidad:</b> ${escapeHtml(ctx.amount)}`,
    `<b>📌 Precio:</b> $${escapeHtml(ctx.price)}`,
    `<b>📌 Total:</b> $${escapeHtml(ctx.total)}`,
    `<b>🔗 ID:</b> <code>${escapeHtml(ctx.orderId)}</code>`,
    ``,
    `<b>💰 Resultado del cierre:</b>`,
    `• <b>PnL cierre:</b> <b>${escapeHtml(pnlUsdTxt)}</b>`,
    `• <b>Fee:</b> ${escapeHtml(feeTxt)}`,
    ``,
    `<b>🛡️ Salida:</b>`,
    `• <b>Tipo:</b> ${escapeHtml(ctx.exitType)}`
  ];
  if (ctx.trigger) {
    lines.push(`• <b>Trigger:</b> ${escapeHtml(ctx.trigger)}`);
  }
  lines.push(
    ``,
    `<b>🧠 Estrategia origen:</b> ${escapeHtml(ctx.strategyLabel)} | <b>Confianza:</b> ${escapeHtml(ctx.confPct)}%`,
    `<b>📝 Razón:</b> ${escapeHtml(ctx.reason)}`,
    ``,
    `<b>🛡️ Modo:</b> ${escapeHtml(ctx.mode)}`
  );
  return lines.join("\n");
}

interface OrphanSellContext {
  env: string;
  assetOrPair: string;
  amount: string;
  price: string;
  total: string;
  orderId: string;
  reasonCode: string;
}

function buildOrphanSellHTML(ctx: OrphanSellContext): string {
  return [
    `<b>${escapeHtml(ctx.env)} 🟠 LIQUIDACIÓN HUÉRFANA</b>`,
    ``,
    `<b>📌 Operación:</b>`,
    `• Par/Activo: ${escapeHtml(ctx.assetOrPair)}`,
    `• Cantidad: ${escapeHtml(ctx.amount)}`,
    `• Precio: ${escapeHtml(ctx.price)}`,
    `• Total: ${escapeHtml(ctx.total)}`,
    `• ID: <code>${escapeHtml(ctx.orderId)}</code>`,
    ``,
    `<b>⚠️ Resultado:</b>`,
    `• <b>PnL cierre:</b> N/A (sin entryPrice)`,
    `• Reason: ${escapeHtml(ctx.reasonCode)}`
  ].join("\n");
}

interface SignalContext {
  side: "BUY" | "SELL";
  symbol: string;
  price: string;
  investPct?: string;
  rsi?: string;
  macd?: string;
  adx?: string;
  regime?: string;
  ts: string;
}

function buildSignalHTML(ctx: SignalContext): string {
  const sideEmoji = ctx.side === "BUY" ? "🟢" : "🔴";
  const sideText = ctx.side === "BUY" ? "COMPRAR" : "VENDER";
  const lines = [
    `<b>${sideEmoji} SEÑAL: ${sideText} ${escapeHtml(ctx.symbol)} ${sideEmoji}</b>`,
    ``,
    `📌 Precio: ${escapeHtml(ctx.price)}`
  ];
  if (ctx.investPct) lines.push(`💰 Inversión recomendada: ${escapeHtml(ctx.investPct)}%`);
  if (ctx.rsi || ctx.macd || ctx.adx) {
    lines.push(``, `<b>📊 Indicadores técnicos:</b>`);
    if (ctx.rsi) lines.push(`• RSI: ${escapeHtml(ctx.rsi)}`);
    if (ctx.macd) lines.push(`• MACD: ${escapeHtml(ctx.macd)}`);
    if (ctx.adx) lines.push(`• ADX: ${escapeHtml(ctx.adx)}`);
  }
  if (ctx.regime) lines.push(``, `🧭 Régimen: ${escapeHtml(ctx.regime)}`);
  lines.push(`🕒 ${escapeHtml(ctx.ts)}`);
  return lines.join("\n");
}

// Export templates for use in tradingEngine
export const telegramTemplates = {
  escapeHtml,
  buildBotStartedHTML,
  buildHeartbeatHTML,
  buildDailyReportHTML,
  buildTradeBuyHTML,
  buildTradeSellHTML,
  buildOrphanSellHTML,
  buildSignalHTML,
};

interface TelegramConfig {
  token: string;
  chatId: string;
}

type AlertType = "trades" | "errors" | "system" | "balance" | "status";

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
  private dailyReportJob: cron.ScheduledTask | null = null;
  private lastDailyReportDate: string = "";

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

    this.bot.onText(/\/menu/, async (msg) => {
      await this.handleMenu(msg.chat.id);
    });

    this.bot.onText(/\/channels/, async (msg) => {
      await this.handleChannels(msg.chat.id);
    });

    // Callback query handler for inline buttons
    this.bot.on("callback_query", async (query) => {
      if (!query.data || !query.message) return;
      await this.handleCallbackQuery(query);
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
<b>📊 Estado del Bot</b>

<b>Estado:</b> ${escapeHtml(status)}
<b>Estrategia:</b> ${escapeHtml(strategy)}
<b>Nivel de riesgo:</b> ${escapeHtml(riskLevel)}
<b>Pares activos:</b> ${escapeHtml(pairs)}
<b>Chats Telegram:</b> ${escapeHtml(chatsInfo)}

<i>Usa /ayuda para ver los comandos disponibles</i>
      `.trim();

      await this.bot?.sendMessage(chatId, message, { parse_mode: "HTML" });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error obteniendo estado: ${escapeHtml(error.message)}`);
    }
  }

  private async handlePausar(chatId: number) {
    try {
      await storage.updateBotConfig({ isActive: false });
      
      if (this.engineController) {
        await this.engineController.stop();
      }
      
      await this.bot?.sendMessage(chatId, "<b>⏸️ Bot pausado correctamente</b>\n\nEl motor de trading se ha detenido.\nUsa /reanudar para volver a activarlo.", { parse_mode: "HTML" });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error pausando bot: ${escapeHtml(error.message)}`);
    }
  }

  private async handleReanudar(chatId: number) {
    try {
      await storage.updateBotConfig({ isActive: true });
      
      if (this.engineController) {
        await this.engineController.start();
      }
      
      await this.bot?.sendMessage(chatId, "<b>✅ Bot activado correctamente</b>\n\nEl motor de trading ha comenzado a analizar el mercado.", { parse_mode: "HTML" });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error activando bot: ${escapeHtml(error.message)}`);
    }
  }

  private async handleUltimas(chatId: number) {
    try {
      const trades = await storage.getTrades(5);
      
      if (trades.length === 0) {
        await this.bot?.sendMessage(chatId, "📭 No hay operaciones recientes.");
        return;
      }

      let message = "<b>📈 Últimas operaciones:</b>\n\n";
      
      for (const trade of trades) {
        const emoji = trade.type === "buy" ? "🟢" : "🔴";
        const tipo = trade.type === "buy" ? "Compra" : "Venta";
        const fecha = trade.executedAt ? new Date(trade.executedAt).toLocaleDateString("es-ES") : "Pendiente";
        
        message += `${emoji} <b>${tipo}</b> ${escapeHtml(trade.pair)}\n`;
        message += `   Precio: $${parseFloat(trade.price).toFixed(2)}\n`;
        message += `   Cantidad: ${escapeHtml(trade.amount)}\n`;
        message += `   Fecha: ${fecha}\n\n`;
      }

      await this.bot?.sendMessage(chatId, message.trim(), { parse_mode: "HTML" });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error obteniendo operaciones: ${escapeHtml(error.message)}`);
    }
  }

  private async handleAyuda(chatId: number) {
    const message = `
<b>🤖 Comandos disponibles:</b>

/estado - Ver estado del bot
/balance - Ver balance actual
/config - Ver configuración de riesgo
/exposicion - Ver exposición por par
/uptime - Ver tiempo encendido
/menu - Menú interactivo con botones
/channels - Configurar alertas por chat
/pausar - Pausar el bot
/reanudar - Activar el bot
/ultimas - Ver últimas operaciones
/ayuda - Ver esta ayuda

<i>KrakenBot.AI - Trading Autónomo</i>
    `.trim();

    await this.bot?.sendMessage(chatId, message, { parse_mode: "HTML" });
  }

  private async handleBalance(chatId: number) {
    try {
      if (!this.engineController?.getBalance) {
        await this.bot?.sendMessage(chatId, "⚠️ Kraken no está conectado. Configura las credenciales primero.");
        return;
      }
      const balances = await this.engineController.getBalance();
      const usd = parseFloat(balances?.ZUSD || balances?.USD || "0");
      const btc = parseFloat(balances?.XXBT || balances?.XBT || "0");
      const eth = parseFloat(balances?.XETH || balances?.ETH || "0");
      const sol = parseFloat(balances?.SOL || "0");

      const message = `
<b>💰 Balance Actual</b>

<b>USD:</b> $${usd.toFixed(2)}
<b>BTC:</b> ${btc.toFixed(6)}
<b>ETH:</b> ${eth.toFixed(6)}
<b>SOL:</b> ${sol.toFixed(4)}

<i>Actualizado: ${new Date().toLocaleString("es-ES")}</i>
      `.trim();

      await this.bot?.sendMessage(chatId, message, { parse_mode: "HTML" });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error obteniendo balance: ${escapeHtml(error.message)}`);
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
<b>⚙️ Configuración de Riesgo</b>

🛑 <b>Stop-Loss:</b> ${sl}%
🎯 <b>Take-Profit:</b> ${tp}%
📉 <b>Trailing Stop:</b> ${escapeHtml(trailing)}
💵 <b>Riesgo por trade:</b> ${riskTrade}%
🔸 <b>Exp. por par:</b> ${pairExp}%
🔹 <b>Exp. total:</b> ${totalExp}%

<i>Estrategia: ${escapeHtml(config?.strategy || "momentum")}</i>
      `.trim();

      await this.bot?.sendMessage(chatId, message, { parse_mode: "HTML" });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error obteniendo configuración: ${escapeHtml(error.message)}`);
    }
  }

  private async handleExposicion(chatId: number) {
    try {
      const positions = this.engineController?.getOpenPositions?.() || new Map();
      
      if (positions.size === 0) {
        await this.bot?.sendMessage(chatId, "<b>📊 Sin posiciones abiertas</b>\n\nNo hay exposición actual.", { parse_mode: "HTML" });
        return;
      }

      let message = "<b>📊 Exposición Actual</b>\n\n";
      let totalExp = 0;

      positions.forEach((pos, pair) => {
        const exposure = pos.amount * pos.entryPrice;
        totalExp += exposure;
        message += `<b>${escapeHtml(pair)}:</b> $${exposure.toFixed(2)}\n`;
        message += `   Entrada: $${pos.entryPrice.toFixed(2)}\n`;
        message += `   Cantidad: ${pos.amount.toFixed(6)}\n\n`;
      });

      message += `<b>Total expuesto:</b> $${totalExp.toFixed(2)}`;

      await this.bot?.sendMessage(chatId, message.trim(), { parse_mode: "HTML" });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error obteniendo exposición: ${escapeHtml(error.message)}`);
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
<b>⏱️ Uptime del Bot</b>

<b>Tiempo encendido:</b> ${days}d ${hours}h ${minutes}m
<b>Estado:</b> ${status}
<b>Iniciado:</b> ${this.startTime.toLocaleString("es-ES")}

<i>KrakenBot.AI</i>
    `.trim();

    await this.bot?.sendMessage(chatId, message, { parse_mode: "HTML" });
  }

  private async handleMenu(chatId: number) {
    const keyboard = {
      inline_keyboard: [
        [
          { text: "📊 Estado", callback_data: "MENU_STATUS" },
          { text: "💰 Balance", callback_data: "MENU_BALANCE" },
        ],
        [
          { text: "📈 Exposición", callback_data: "MENU_EXPOSURE" },
          { text: "🔄 Sync Kraken", callback_data: "MENU_SYNC" },
        ],
        [
          { text: "⏸️ Pausar", callback_data: "MENU_PAUSE" },
          { text: "▶️ Reanudar", callback_data: "MENU_RESUME" },
        ],
        [
          { text: "📣 Canales", callback_data: "MENU_CHANNELS" },
          { text: "⏰ Reporte diario", callback_data: "MENU_DAILY" },
        ],
        [
          { text: "❓ Ayuda", callback_data: "MENU_HELP" },
        ],
      ],
    };

    const message = `
<b>🤖 MENÚ PRINCIPAL</b>

Selecciona una opción:
    `.trim();

    await this.bot?.sendMessage(chatId, message, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }

  private async handleChannels(chatId: number) {
    try {
      const chatIdStr = chatId.toString();
      let chat = await storage.getTelegramChatByChatId(chatIdStr);
      
      if (!chat) {
        // Create chat if doesn't exist
        await storage.createTelegramChat({
          name: `Chat ${chatId}`,
          chatId: chatIdStr,
          alertTrades: true,
          alertErrors: true,
          alertSystem: true,
          alertBalance: false,
          alertHeartbeat: true,
          isActive: true,
        });
        chat = await storage.getTelegramChatByChatId(chatIdStr);
      }

      const t = chat?.alertTrades ? "✅" : "⬜";
      const s = chat?.alertSystem ? "✅" : "⬜";
      const e = chat?.alertErrors ? "✅" : "⬜";
      const b = chat?.alertBalance ? "✅" : "⬜";
      const h = chat?.alertHeartbeat ? "✅" : "⬜";

      const keyboard = {
        inline_keyboard: [
          [
            { text: `${t} Trades`, callback_data: "TOGGLE_TRADES" },
            { text: `${s} System`, callback_data: "TOGGLE_SYSTEM" },
          ],
          [
            { text: `${e} Errors`, callback_data: "TOGGLE_ERRORS" },
            { text: `${b} Balance`, callback_data: "TOGGLE_BALANCE" },
          ],
          [
            { text: `${h} Heartbeat`, callback_data: "TOGGLE_HEARTBEAT" },
            { text: "📃 Listar", callback_data: "LIST_CHATS" },
          ],
          [
            { text: "⬅️ Menú", callback_data: "MENU_HOME" },
          ],
        ],
      };

      const message = `
<b>📣 GESTIÓN DE CANALES</b>
Chat actual: <code>${chatId}</code>

<b>Configuración:</b>
${t} Trades | ${s} Sistema | ${e} Errores
${b} Balance | ${h} Heartbeat

<i>Pulsa para activar/desactivar</i>
      `.trim();

      await this.bot?.sendMessage(chatId, message, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error: ${escapeHtml(error.message)}`);
    }
  }

  private async handleCallbackQuery(query: TelegramBot.CallbackQuery) {
    const chatId = query.message!.chat.id;
    const data = query.data!;

    try {
      // Answer callback to remove loading state
      await this.bot?.answerCallbackQuery(query.id);

      switch (data) {
        case "MENU_HOME":
          await this.handleMenu(chatId);
          break;
        case "MENU_STATUS":
          await this.handleEstado(chatId);
          break;
        case "MENU_BALANCE":
          await this.handleBalance(chatId);
          break;
        case "MENU_EXPOSURE":
          await this.handleExposicion(chatId);
          break;
        case "MENU_SYNC":
          await this.handleSyncCallback(chatId);
          break;
        case "MENU_PAUSE":
          await this.handlePausar(chatId);
          break;
        case "MENU_RESUME":
          await this.handleReanudar(chatId);
          break;
        case "MENU_CHANNELS":
          await this.handleChannels(chatId);
          break;
        case "MENU_DAILY":
          await this.handleDailyConfig(chatId);
          break;
        case "MENU_HELP":
          await this.handleAyuda(chatId);
          break;
        case "TOGGLE_TRADES":
        case "TOGGLE_SYSTEM":
        case "TOGGLE_ERRORS":
        case "TOGGLE_BALANCE":
        case "TOGGLE_HEARTBEAT":
          await this.handleToggleChannel(chatId, data);
          break;
        case "LIST_CHATS":
          await this.handleListChats(chatId);
          break;
        default:
          await this.bot?.sendMessage(chatId, "⚠️ Opción no reconocida");
      }
    } catch (error: any) {
      console.error("Callback error:", error);
      await this.bot?.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
  }

  private async handleSyncCallback(chatId: number) {
    await this.bot?.sendMessage(chatId, "<b>🔄 Sincronizando con Kraken...</b>", { parse_mode: "HTML" });
    await this.bot?.sendMessage(chatId, "✅ Usa la API /api/trades/sync para sincronizar trades.", { parse_mode: "HTML" });
  }

  private async handleDailyConfig(chatId: number) {
    const message = `
<b>⏰ REPORTE DIARIO</b>

El reporte técnico se envía automáticamente a las <b>14:00</b> (Europe/Madrid) a los canales con <b>System</b> activado.

Incluye:
• Estado conexiones (Kraken/DB/Telegram)
• Recursos NAS (CPU/Mem/Disco)
• Estado del bot y posiciones
• PnL diario

<i>Activa "System" en /channels para recibirlo</i>
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [{ text: "⬅️ Menú", callback_data: "MENU_HOME" }],
      ],
    };

    await this.bot?.sendMessage(chatId, message, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }

  private async handleToggleChannel(chatId: number, action: string) {
    const chatIdStr = chatId.toString();
    const field = action.replace("TOGGLE_", "").toLowerCase();
    
    const fieldMap: Record<string, keyof Pick<import("@shared/schema").TelegramChat, "alertTrades" | "alertErrors" | "alertSystem" | "alertBalance" | "alertHeartbeat">> = {
      trades: "alertTrades",
      system: "alertSystem",
      errors: "alertErrors",
      balance: "alertBalance",
      heartbeat: "alertHeartbeat",
    };

    const dbField = fieldMap[field];
    if (!dbField) return;

    const chat = await storage.getTelegramChatByChatId(chatIdStr);
    if (!chat) {
      await this.bot?.sendMessage(chatId, "⚠️ Chat no registrado. Usa /channels primero.");
      return;
    }

    const newValue = !chat[dbField];
    await storage.updateTelegramChat(chat.id, { [dbField]: newValue });

    const emoji = newValue ? "✅" : "⬜";
    await this.bot?.sendMessage(chatId, `${emoji} <b>${field.charAt(0).toUpperCase() + field.slice(1)}</b> ${newValue ? "activado" : "desactivado"}`, { parse_mode: "HTML" });
    
    // Refresh channels view
    await this.handleChannels(chatId);
  }

  private async handleListChats(chatId: number) {
    const chats = await storage.getActiveTelegramChats();
    
    if (chats.length === 0) {
      await this.bot?.sendMessage(chatId, "📭 No hay chats registrados.");
      return;
    }

    let message = "<b>📃 Chats Registrados</b>\n\n";
    for (const chat of chats) {
      const flags = [
        chat.alertTrades ? "T" : "",
        chat.alertSystem ? "S" : "",
        chat.alertErrors ? "E" : "",
        chat.alertBalance ? "B" : "",
        chat.alertHeartbeat ? "H" : "",
      ].filter(Boolean).join("");
      
      message += `• <code>${escapeHtml(chat.chatId)}</code> (${escapeHtml(chat.name)})\n  Flags: [${flags}]\n`;
    }

    const keyboard = {
      inline_keyboard: [
        [{ text: "⬅️ Menú", callback_data: "MENU_HOME" }],
      ],
    };

    await this.bot?.sendMessage(chatId, message.trim(), {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
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
<b>💓 Heartbeat - KrakenBot</b>

<b>Estado:</b> ${status}
<b>Uptime:</b> ${days}d ${hours}h
<b>Estrategia:</b> ${escapeHtml(config?.strategy || "momentum")}
<b>Pares:</b> ${escapeHtml(config?.activePairs?.join(", ") || "N/A")}
<b>Ops recientes:</b> ${escapeHtml(recentOps)}

<i>${now.toLocaleString("es-ES")}</i>
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

  startDailyReport() {
    if (this.dailyReportJob) {
      this.dailyReportJob.stop();
    }

    // Schedule daily at 14:00 Europe/Madrid
    this.dailyReportJob = cron.schedule("0 14 * * *", async () => {
      await this.sendDailyReport();
    }, {
      timezone: "Europe/Madrid",
    });

    console.log("[telegram] Reporte diario programado para las 14:00 (Europe/Madrid)");
  }

  private async sendDailyReport() {
    try {
      // Avoid duplicate reports
      const today = new Date().toISOString().split("T")[0];
      if (this.lastDailyReportDate === today) {
        console.log("[telegram] Reporte diario ya enviado hoy, saltando");
        return;
      }
      this.lastDailyReportDate = today;

      // Get system info
      const cpu = await si.currentLoad();
      const mem = await si.mem();
      const disk = await si.fsSize();
      const osInfo = await si.osInfo();
      const uptime = await si.time();

      // Format metrics
      const cpuLoad = cpu.currentLoad.toFixed(1);
      const memUsedGb = (mem.used / 1024 / 1024 / 1024).toFixed(1);
      const memTotalGb = (mem.total / 1024 / 1024 / 1024).toFixed(1);
      const memPct = ((mem.used / mem.total) * 100).toFixed(1);
      
      const mainDisk = disk.find(d => d.mount === "/") || disk[0];
      const diskUsedGb = mainDisk ? (mainDisk.used / 1024 / 1024 / 1024).toFixed(1) : "N/A";
      const diskTotalGb = mainDisk ? (mainDisk.size / 1024 / 1024 / 1024).toFixed(1) : "N/A";
      const diskPct = mainDisk ? mainDisk.use.toFixed(1) : "N/A";

      const uptimeDays = Math.floor(uptime.uptime / 86400);
      const uptimeHours = Math.floor((uptime.uptime % 86400) / 3600);
      const uptimeMins = Math.floor((uptime.uptime % 3600) / 60);

      // Get bot info
      const config = await storage.getBotConfig();
      const engineActive = this.engineController?.isActive() ?? false;
      const positions = this.engineController?.getOpenPositions?.() || new Map();
      
      let totalExposure = 0;
      positions.forEach((pos) => {
        totalExposure += pos.amount * pos.entryPrice;
      });

      const envName = environment.isReplit ? "REPLIT/DEV" : "NAS/PROD";
      const dryRunStatus = config?.dryRunMode ? "SÍ" : "NO";
      const positionMode = config?.positionMode || "SINGLE";
      const strategy = config?.strategy || "momentum";
      const pairs = config?.activePairs?.join(", ") || "N/A";

      // Check connections
      const krakenOk = this.engineController?.getBalance ? "✅ OK" : "⚠️ N/A";
      const dbOk = "✅ OK"; // If we're here, DB works
      const telegramOk = this.bot ? "✅ OK" : "❌ ERROR";

      const message = buildDailyReportHTML({
        env: envName,
        cpu: `${cpuLoad}%`,
        mem: `${memUsedGb}/${memTotalGb} GB (${memPct}%)`,
        disk: `${diskUsedGb}/${diskTotalGb} GB (${diskPct}%)`,
        uptime: `${uptimeDays}d ${uptimeHours}h ${uptimeMins}m`,
        krakenOk: !!this.engineController?.getBalance,
        telegramOk: !!this.bot,
        dbOk: true,
        dryRun: config?.dryRunMode ?? false,
        mode: positionMode,
        strategy,
        pairs,
        positionCount: positions.size,
        exposureUsd: totalExposure.toFixed(2),
        ts: new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" }),
      });

      // Send to chats with alertSystem enabled
      const chats = await storage.getActiveTelegramChats();
      for (const chat of chats) {
        if (chat.alertSystem) {
          await this.sendToChat(chat.chatId, message);
        }
      }

      // Also send to main chat
      if (this.chatId) {
        await this.sendMessage(message);
      }

      console.log("[telegram] Reporte diario enviado");
    } catch (error) {
      console.error("[telegram] Error enviando reporte diario:", error);
    }
  }

  isInitialized(): boolean {
    return this.bot !== null && this.chatId !== "";
  }

  async sendMessage(message: string, options?: { skipPrefix?: boolean; parseMode?: "HTML" | "Markdown" }): Promise<boolean> {
    if (!this.bot || !this.chatId) {
      console.warn("Telegram not initialized, skipping notification");
      return false;
    }

    try {
      const prefix = options?.skipPrefix ? "" : await this.getMessagePrefixHTML();
      const fullMessage = prefix + message;
      await this.bot.sendMessage(this.chatId, fullMessage, { 
        parse_mode: options?.parseMode ?? "HTML",
        disable_web_page_preview: true 
      });
      return true;
    } catch (error) {
      console.error("Failed to send Telegram message:", error);
      return false;
    }
  }

  private async getMessagePrefixHTML(): Promise<string> {
    try {
      const config = await storage.getBotConfig();
      const dryRun = config?.dryRunMode ?? false;
      const envLabel = environment.isReplit ? "REPLIT/DEV" : "NAS/PROD";
      const dryLabel = dryRun ? "[DRY_RUN]" : "";
      return `<b>[${envLabel}]${dryLabel}</b> `;
    } catch {
      return "<b>[UNKNOWN]</b> ";
    }
  }

  private async getMessagePrefix(): Promise<string> {
    try {
      const config = await storage.getBotConfig();
      const dryRun = config?.dryRunMode ?? false;
      return environment.getMessagePrefix(dryRun);
    } catch {
      return environment.getMessagePrefix(false);
    }
  }

  async sendToChat(chatId: string, message: string, options?: { skipPrefix?: boolean; parseMode?: "HTML" | "Markdown" }): Promise<boolean> {
    if (!this.bot) {
      console.warn("Telegram bot not initialized");
      return false;
    }

    try {
      const prefix = options?.skipPrefix ? "" : await this.getMessagePrefixHTML();
      const fullMessage = prefix + message;
      await this.bot.sendMessage(chatId, fullMessage, { 
        parse_mode: options?.parseMode ?? "HTML",
        disable_web_page_preview: true 
      });
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
