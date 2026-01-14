import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import si from "systeminformation";
import { storage } from "../storage";
import type { TelegramChat } from "@shared/schema";
import { environment } from "./environment";
import { botLogger } from "./botLogger";

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
// SPANISH DATE FORMATTER - Formato profesional de fecha/hora
// ============================================================
function formatSpanishDate(dateInput?: string | Date): string {
  try {
    const date = dateInput ? new Date(dateInput) : new Date();
    return date.toLocaleString("es-ES", { 
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
  }
}

// ============================================================
// DURATION FORMATTER - Tiempo transcurrido desde apertura
// ============================================================
function formatDuration(openedAt: string | Date | null | undefined): string {
  if (!openedAt) return "N/A";
  try {
    const opened = new Date(openedAt);
    const now = new Date();
    const diffMs = now.getTime() - opened.getTime();
    if (diffMs < 0) return "0m";
    
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours}h`;
    }
    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes}m`;
    }
    return `${minutes}m`;
  } catch {
    return "N/A";
  }
}

// ============================================================
// PANEL URL FOOTER - Añade enlace al panel en cada mensaje
// ============================================================
function buildPanelUrlFooter(): string {
  const url = environment.panelUrl;
  return `\n🔗 <a href="${url}">Ver Panel</a>`;
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
  routerEnabled?: boolean;
}

function buildBotStartedHTML(ctx: BotStartedContext): string {
  const routerStatus = ctx.routerEnabled ? "ACTIVO" : "INACTIVO";
  return [
    `🤖 <b>KRAKEN BOT</b> 🇪🇸`,
    `━━━━━━━━━━━━━━━━━━━`,
    `✅ <b>Bot Iniciado</b>`,
    ``,
    `📊 <b>Configuración:</b>`,
    `   • Estrategia: <code>${escapeHtml(ctx.strategy)}</code>`,
    `   • Riesgo: <code>${escapeHtml(ctx.risk)}</code>`,
    `   • Pares: <code>${escapeHtml(ctx.pairs.join(", "))}</code>`,
    `   • Router: <code>${routerStatus}</code>`,
    ``,
    `💰 <b>Estado:</b>`,
    `   • Balance: <code>$${escapeHtml(ctx.balanceUsd)}</code>`,
    `   • Posiciones: <code>${ctx.positionCount}</code>`,
    ``,
    `⚙️ <b>Modo:</b> <code>${escapeHtml(ctx.mode)}</code>`,
    `🏷️ <b>Entorno:</b> <code>${escapeHtml(ctx.env)}</code>`,
    `━━━━━━━━━━━━━━━━━━━`,
    buildPanelUrlFooter()
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
    `🤖 <b>KRAKEN BOT</b> 🇪🇸`,
    `━━━━━━━━━━━━━━━━━━━`,
    `✅ <b>Sistema operativo 24x7</b>`,
    `Verificación automática de funcionamiento`,
    ``,
    `📊 <b>Recursos del sistema:</b>`,
    `   • CPU: <code>${escapeHtml(ctx.cpu)}</code>`,
    `   • Memoria: <code>${escapeHtml(ctx.mem)}</code>`,
    `   • Disco: <code>${escapeHtml(ctx.disk)}</code>`,
    `   • Uptime: <code>${escapeHtml(ctx.uptime)}</code>`,
    ``,
    `🔌 <b>Conexiones:</b>`,
    `   ${ctx.krakenOk ? "✅" : "❌"} Kraken`,
    `   ${ctx.telegramOk ? "✅" : "❌"} Telegram`,
    `   ${ctx.dbOk ? "✅" : "❌"} Base de datos`,
    ``,
    `📅 ${formatSpanishDate(ctx.ts)}`,
    `━━━━━━━━━━━━━━━━━━━`,
    buildPanelUrlFooter()
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
    `🤖 <b>KRAKEN BOT</b> 🇪🇸`,
    `━━━━━━━━━━━━━━━━━━━`,
    `📋 <b>REPORTE DIARIO (14:00)</b>`,
    ``,
    `🔌 <b>Estado de conexiones:</b>`,
    `   ${ctx.krakenOk ? "✅" : "❌"} Kraken`,
    `   ${ctx.dbOk ? "✅" : "❌"} Base de datos`,
    `   ${ctx.telegramOk ? "✅" : "❌"} Telegram`,
    ``,
    `📊 <b>Recursos del sistema:</b>`,
    `   • CPU: <code>${escapeHtml(ctx.cpu)}</code>`,
    `   • Memoria: <code>${escapeHtml(ctx.mem)}</code>`,
    `   • Disco: <code>${escapeHtml(ctx.disk)}</code>`,
    `   • Uptime: <code>${escapeHtml(ctx.uptime)}</code>`,
    ``,
    `🤖 <b>Estado del bot:</b>`,
    `   • Entorno: <code>${escapeHtml(ctx.env)}</code>`,
    `   • DRY_RUN: <code>${ctx.dryRun ? "SÍ" : "NO"}</code>`,
    `   • Modo: <code>${escapeHtml(ctx.mode)}</code>`,
    `   • Estrategia: <code>${escapeHtml(ctx.strategy)}</code>`,
    `   • Pares: <code>${escapeHtml(ctx.pairs)}</code>`,
    ``,
    `💰 <b>Portfolio:</b>`,
    `   • Posiciones: <code>${ctx.positionCount}</code>`,
    `   • Exposición: <code>$${escapeHtml(ctx.exposureUsd)}</code>`,
    ``,
    `📅 ${formatSpanishDate(ctx.ts)}`,
    `━━━━━━━━━━━━━━━━━━━`,
    buildPanelUrlFooter()
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
  regime?: string;
  regimeReason?: string;
  routerStrategy?: string;
}

function buildTradeBuyHTML(ctx: TradeBuyContext): string {
  const lines = [
    `🤖 <b>KRAKEN BOT</b> 🇪🇸`,
    `━━━━━━━━━━━━━━━━━━━`,
    `🟢 <b>SEÑAL: COMPRAR ${escapeHtml(ctx.pair)}</b> 🟢`,
    ``,
    `💵 <b>Precio:</b> <code>$${escapeHtml(ctx.price)}</code>`,
    `📦 <b>Cantidad:</b> <code>${escapeHtml(ctx.amount)}</code>`,
    `💰 <b>Total:</b> <code>$${escapeHtml(ctx.total)}</code>`,
    ``
  ];
  
  if (ctx.signalsSummary) {
    lines.push(
      `📊 <b>Indicadores Técnicos:</b>`,
      `${escapeHtml(ctx.signalsSummary)}`,
      ``
    );
  }
  
  if (ctx.regime) {
    lines.push(`🧭 <b>Régimen:</b> <code>${escapeHtml(ctx.regime)}</code>`);
    if (ctx.regimeReason) {
      lines.push(`   ↳ <i>${escapeHtml(ctx.regimeReason.substring(0, 80))}</i>`);
    }
    if (ctx.routerStrategy) {
      lines.push(`🔄 <b>Router:</b> <code>${escapeHtml(ctx.routerStrategy)}</code>`);
    }
    lines.push(``);
  }
  
  lines.push(
    `🧠 <b>Estrategia:</b> ${escapeHtml(ctx.strategyLabel)}`,
    `📈 <b>Confianza:</b> <code>${escapeHtml(ctx.confPct)}%</code>`,
    ``,
    `🛡️ <b>Modo:</b> <code>${escapeHtml(ctx.mode)}</code>`,
    `🔗 <b>ID:</b> <code>${escapeHtml(ctx.orderId)}</code>`,
    ``,
    `📅 ${formatSpanishDate()}`,
    `━━━━━━━━━━━━━━━━━━━`,
    buildPanelUrlFooter()
  );
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
  openedAt?: string | Date | null;
}

function buildTradeSellHTML(ctx: TradeSellContext): string {
  const pnlSign = (ctx.pnlUsd !== null && ctx.pnlUsd >= 0) ? "+" : "";
  const pnlEmoji = (ctx.pnlUsd !== null && ctx.pnlUsd >= 0) ? "📈" : "📉";
  const pnlUsdTxt = (ctx.pnlUsd === null || ctx.pnlUsd === undefined)
    ? "N/A"
    : `${pnlSign}$${ctx.pnlUsd.toFixed(2)}`;
  const pnlPctTxt = (ctx.pnlPct !== null && ctx.pnlPct !== undefined)
    ? `${pnlSign}${ctx.pnlPct.toFixed(2)}%`
    : "";
  const feeTxt = (ctx.feeUsd === null || ctx.feeUsd === undefined) ? "N/A" : `$${ctx.feeUsd.toFixed(2)}`;
  const durationTxt = formatDuration(ctx.openedAt);

  const lines = [
    `🤖 <b>KRAKEN BOT</b> 🇪🇸`,
    `━━━━━━━━━━━━━━━━━━━`,
    `🔴 <b>SEÑAL: VENDER ${escapeHtml(ctx.pair)}</b> 🔴`,
    ``,
    `💵 <b>Precio:</b> <code>$${escapeHtml(ctx.price)}</code>`,
    `📦 <b>Cantidad:</b> <code>${escapeHtml(ctx.amount)}</code>`,
    `💰 <b>Total:</b> <code>$${escapeHtml(ctx.total)}</code>`,
    `⏱️ <b>Duración:</b> <code>${escapeHtml(durationTxt)}</code>`,
    ``,
    `${pnlEmoji} <b>Resultado:</b>`,
    `   • PnL: <code>${escapeHtml(pnlUsdTxt)}</code> ${pnlPctTxt ? `(<code>${escapeHtml(pnlPctTxt)}</code>)` : ""}`,
    `   • Fee: <code>${escapeHtml(feeTxt)}</code>`,
    ``,
    `🛡️ <b>Tipo de salida:</b> <code>${escapeHtml(ctx.exitType)}</code>`
  ];
  
  if (ctx.trigger) {
    lines.push(`⚡ <b>Trigger:</b> <code>${escapeHtml(ctx.trigger)}</code>`);
  }
  
  lines.push(
    ``,
    `🧠 <b>Estrategia:</b> ${escapeHtml(ctx.strategyLabel)}`,
    `📈 <b>Confianza:</b> <code>${escapeHtml(ctx.confPct)}%</code>`,
    ``,
    `⚙️ <b>Modo:</b> <code>${escapeHtml(ctx.mode)}</code>`,
    `🔗 <b>ID:</b> <code>${escapeHtml(ctx.orderId)}</code>`,
    ``,
    `📅 ${formatSpanishDate()}`,
    `━━━━━━━━━━━━━━━━━━━`,
    buildPanelUrlFooter()
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
    `🤖 <b>KRAKEN BOT</b> 🇪🇸`,
    `━━━━━━━━━━━━━━━━━━━`,
    `🟠 <b>LIQUIDACIÓN HUÉRFANA</b> 🟠`,
    ``,
    `📦 <b>Operación:</b>`,
    `   • Par/Activo: <code>${escapeHtml(ctx.assetOrPair)}</code>`,
    `   • Cantidad: <code>${escapeHtml(ctx.amount)}</code>`,
    `   • Precio: <code>${escapeHtml(ctx.price)}</code>`,
    `   • Total: <code>${escapeHtml(ctx.total)}</code>`,
    ``,
    `⚠️ <b>Resultado:</b>`,
    `   • PnL cierre: <code>N/A (sin entryPrice)</code>`,
    `   • Razón: <code>${escapeHtml(ctx.reasonCode)}</code>`,
    ``,
    `🔗 <b>ID:</b> <code>${escapeHtml(ctx.orderId)}</code>`,
    ``,
    `📅 ${formatSpanishDate()}`,
    `━━━━━━━━━━━━━━━━━━━`,
    buildPanelUrlFooter()
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
    `🤖 <b>KRAKEN BOT</b> 🇪🇸`,
    `━━━━━━━━━━━━━━━━━━━`,
    `${sideEmoji} <b>SEÑAL: ${sideText} ${escapeHtml(ctx.symbol)}</b> ${sideEmoji}`,
    ``,
    `💵 <b>Precio:</b> <code>${escapeHtml(ctx.price)} USDT</code>`
  ];
  
  if (ctx.investPct) {
    lines.push(`💰 <b>Inversión recomendada:</b> <code>${escapeHtml(ctx.investPct)}%</code>`);
  }
  
  if (ctx.rsi || ctx.macd || ctx.adx) {
    lines.push(``, `📊 <b>Indicadores Técnicos:</b>`);
    if (ctx.rsi) lines.push(`   • RSI: <code>${escapeHtml(ctx.rsi)}</code>`);
    if (ctx.macd) lines.push(`   • MACD: <code>${escapeHtml(ctx.macd)}</code>`);
    if (ctx.adx) lines.push(`   • ADX: <code>${escapeHtml(ctx.adx)}</code>`);
  }
  
  if (ctx.regime) {
    lines.push(``, `🧭 <b>Régimen de mercado:</b> <code>${escapeHtml(ctx.regime)}</code>`);
  }
  
  lines.push(
    ``,
    `📅 ${formatSpanishDate(ctx.ts)}`,
    `━━━━━━━━━━━━━━━━━━━`,
    buildPanelUrlFooter()
  );
  return lines.join("\n");
}

// ============================================================
// ENTRY INTENT TEMPLATE - Mensaje "Entraría con $X porque..."
// ============================================================
interface EntryIntentContext {
  pair: string;
  amountUsd: string;
  price: string;
  strategyLabel: string;
  signalReason: string;
  confidence: number;
  regime?: string;
  regimeReason?: string;
  requiredSignals?: number;
  currentSignals?: number;
}

function buildEntryIntentHTML(ctx: EntryIntentContext): string {
  const lines = [
    `🤖 <b>KRAKEN BOT</b> 🇪🇸`,
    `━━━━━━━━━━━━━━━━━━━`,
    `💡 <b>INTENCIÓN DE ENTRADA</b> 💡`,
    ``,
    `📊 <b>Par:</b> <code>${escapeHtml(ctx.pair)}</code>`,
    `💵 <b>Entraría con:</b> <code>$${escapeHtml(ctx.amountUsd)}</code>`,
    `📈 <b>Precio:</b> <code>$${escapeHtml(ctx.price)}</code>`,
    ``,
    `🧠 <b>Estrategia:</b> <code>${escapeHtml(ctx.strategyLabel)}</code>`,
    `📈 <b>Confianza:</b> <code>${ctx.confidence.toFixed(0)}%</code>`,
  ];

  if (ctx.currentSignals !== undefined && ctx.requiredSignals !== undefined) {
    lines.push(`📊 <b>Señales:</b> <code>${ctx.currentSignals}/${ctx.requiredSignals}</code>`);
  }

  if (ctx.regime) {
    lines.push(`🧭 <b>Régimen:</b> <code>${escapeHtml(ctx.regime)}</code>`);
    if (ctx.regimeReason) {
      lines.push(`   ↳ ${escapeHtml(ctx.regimeReason)}`);
    }
  }

  lines.push(
    ``,
    `💬 <b>Motivo:</b>`,
    `<i>${escapeHtml(ctx.signalReason.substring(0, 300))}</i>`,
    ``,
    `📅 ${formatSpanishDate()}`,
    `━━━━━━━━━━━━━━━━━━━`,
    buildPanelUrlFooter()
  );
  return lines.join("\n");
}

// Export templates and utilities for use in tradingEngine
export const telegramTemplates = {
  escapeHtml,
  formatDuration,
  buildBotStartedHTML,
  buildHeartbeatHTML,
  buildDailyReportHTML,
  buildTradeBuyHTML,
  buildTradeSellHTML,
  buildOrphanSellHTML,
  buildSignalHTML,
  buildEntryIntentHTML,
};

interface TelegramConfig {
  token: string;
  chatId: string;
}

type AlertType = "trades" | "errors" | "system" | "balance" | "status" | "heartbeat" | "strategy";

type AlertSubtype = 
  | "trade_buy" | "trade_sell" | "trade_breakeven" | "trade_trailing" 
  | "trade_stoploss" | "trade_takeprofit" | "trade_daily_pnl"
  | "strategy_regime_change" | "strategy_router_transition"
  | "system_bot_started" | "system_bot_paused"
  | "error_api" | "error_nonce"
  | "balance_exposure"
  | "heartbeat_periodic";

type EngineController = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isActive: () => boolean;
  getBalance?: () => Promise<Record<string, string>>;
  getOpenPositions?: () => Map<string, { 
    pair?: string;
    amount: number; 
    entryPrice: number;
    openedAt?: Date | string | null;
    sgBreakEvenActivated?: boolean;
    sgTrailingActivated?: boolean;
  }>;
};

export class TelegramService {
  private bot: TelegramBot | null = null;
  private chatId: string = "";
  private engineController: EngineController | null = null;
  private startTime: Date = new Date();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private dailyReportJob: ReturnType<typeof cron.schedule> | null = null;
  private lastDailyReportDate: string = "";
  
  // Entry Intent dedupe cache: key = "pair:signal:candleBucket" -> timestamp
  private entryIntentCache: Map<string, number> = new Map();
  private readonly ENTRY_INTENT_DEDUPE_MS = 15 * 60 * 1000; // 15 minutos (una vela)
  
  // Cooldown cache: key = "eventType:pair?" -> lastSentTimestamp
  private cooldownCache: Map<string, number> = new Map();

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

    this.bot.onText(/\/posiciones/, async (msg) => {
      await this.handlePosiciones(msg.chat.id);
    });

    this.bot.onText(/\/ganancias/, async (msg) => {
      await this.handleGanancias(msg.chat.id);
    });

    this.bot.onText(/\/logs/, async (msg) => {
      await this.handleLogs(msg.chat.id);
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

<b>📊 Información:</b>
/estado - Ver estado del bot
/balance - Ver balance actual
/posiciones - Ver posiciones abiertas con P&L
/ganancias - Ver ganancias (24h, semana, total)
/exposicion - Ver exposición por par
/ultimas - Ver últimas 5 operaciones
/logs - Ver logs recientes (6 horas)

<b>⚙️ Configuración:</b>
/config - Ver configuración de riesgo
/uptime - Ver tiempo encendido
/menu - Menú interactivo con botones
/channels - Configurar alertas por chat

<b>🔧 Control:</b>
/pausar - Pausar el bot
/reanudar - Activar el bot

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

  private async handlePosiciones(chatId: number) {
    try {
      const positions = this.engineController?.getOpenPositions?.() || new Map();
      
      if (positions.size === 0) {
        await this.bot?.sendMessage(chatId, "<b>📭 Sin posiciones abiertas</b>\n\nNo hay posiciones activas en este momento.", { parse_mode: "HTML" });
        return;
      }

      let message = `<b>📈 Posiciones Abiertas (${positions.size})</b>\n\n`;
      let totalExposure = 0;

      const posArray = Array.from(positions.entries());
      
      for (const [key, pos] of posArray) {
        // Key can be lotId or pair depending on engine implementation
        // pos.pair may or may not exist - use key as fallback for pair name
        const pairName = pos.pair || key;
        const displayId = key.length > 16 ? key.slice(0, 8) : key; // Short ID for lotIds
        
        const exposure = pos.amount * pos.entryPrice;
        totalExposure += exposure;
        
        // Handle optional fields gracefully
        const duration = pos.openedAt ? formatDuration(pos.openedAt) : "N/A";
        const sgBE = pos.sgBreakEvenActivated ?? false;
        const sgTrail = pos.sgTrailingActivated ?? false;
        const sgStatus = sgBE ? "🔒 B.E." : sgTrail ? "📉 Trail" : "⏳ Activa";
        
        message += `<b>${escapeHtml(pairName)}</b>`;
        if (key.length > 16) {
          message += ` <code>${displayId}</code>`;
        }
        message += `\n`;
        message += `   💵 Entrada: $${pos.entryPrice.toFixed(2)}\n`;
        message += `   📦 Cantidad: ${pos.amount.toFixed(6)}\n`;
        message += `   💰 Exposición: $${exposure.toFixed(2)}\n`;
        message += `   ⏱️ Duración: ${duration}\n`;
        message += `   🛡️ Estado: ${sgStatus}\n\n`;
      }

      message += `━━━━━━━━━━━━━━━━━━━\n`;
      message += `<b>Total expuesto:</b> $${totalExposure.toFixed(2)}`;

      await this.bot?.sendMessage(chatId, message.trim(), { parse_mode: "HTML" });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error obteniendo posiciones: ${escapeHtml(error.message)}`);
    }
  }

  private async handleGanancias(chatId: number) {
    try {
      const trades = await storage.getTrades(500); // Get recent trades
      
      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      let pnl24h = 0;
      let pnlWeek = 0;
      let pnlTotal = 0;
      let trades24h = 0;
      let tradesWeek = 0;
      let wins = 0;
      let losses = 0;
      
      for (const trade of trades) {
        if (trade.type !== "sell") continue;
        
        const pnl = parseFloat(trade.realizedPnlUsd?.toString() || "0");
        const tradeDate = trade.executedAt ? new Date(trade.executedAt) : null;
        
        pnlTotal += pnl;
        if (pnl > 0) wins++;
        else if (pnl < 0) losses++;
        
        if (tradeDate) {
          if (tradeDate >= last24h) {
            pnl24h += pnl;
            trades24h++;
          }
          if (tradeDate >= lastWeek) {
            pnlWeek += pnl;
            tradesWeek++;
          }
        }
      }
      
      const winRate = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
      const emoji24h = pnl24h >= 0 ? "🟢" : "🔴";
      const emojiWeek = pnlWeek >= 0 ? "🟢" : "🔴";
      const emojiTotal = pnlTotal >= 0 ? "📈" : "📉";
      
      const message = `
<b>💰 Resumen de Ganancias</b>
━━━━━━━━━━━━━━━━━━━

<b>📊 Últimas 24 horas:</b>
${emoji24h} P&L: ${pnl24h >= 0 ? '+' : ''}$${pnl24h.toFixed(2)}
   Trades: ${trades24h}

<b>📅 Última semana:</b>
${emojiWeek} P&L: ${pnlWeek >= 0 ? '+' : ''}$${pnlWeek.toFixed(2)}
   Trades: ${tradesWeek}

<b>📈 Total histórico:</b>
${emojiTotal} P&L: ${pnlTotal >= 0 ? '+' : ''}$${pnlTotal.toFixed(2)}
   Trades cerrados: ${wins + losses}
   ✅ Ganadores: ${wins}
   ❌ Perdedores: ${losses}
   🎯 Win Rate: ${winRate.toFixed(1)}%

<i>Actualizado: ${formatSpanishDate()}</i>
      `.trim();

      await this.bot?.sendMessage(chatId, message, { parse_mode: "HTML" });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error obteniendo ganancias: ${escapeHtml(error.message)}`);
    }
  }

  private async handleLogs(chatId: number) {
    try {
      const events = await botLogger.getDbEvents(100);
      
      if (events.length === 0) {
        await this.bot?.sendMessage(chatId, "<b>📭 Sin logs recientes</b>\n\nNo hay eventos registrados.", { parse_mode: "HTML" });
        return;
      }
      
      // Filter last 6 hours
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const recentEvents = events.filter(e => {
        const eventDate = e.timestamp ? new Date(e.timestamp) : null;
        return eventDate && eventDate >= sixHoursAgo;
      });
      
      if (recentEvents.length === 0) {
        await this.bot?.sendMessage(chatId, "<b>📭 Sin logs en las últimas 6 horas</b>\n\nNo hay eventos recientes.", { parse_mode: "HTML" });
        return;
      }
      
      // Group by type for summary
      const typeCount = new Map<string, number>();
      const errorTypes: string[] = [];
      
      for (const event of recentEvents) {
        const count = typeCount.get(event.type) || 0;
        typeCount.set(event.type, count + 1);
        
        if (event.level === "ERROR") {
          errorTypes.push(`${event.type}: ${event.message.slice(0, 50)}`);
        }
      }
      
      let message = `<b>📋 Logs (últimas 6 horas)</b>\n`;
      message += `<i>Total: ${recentEvents.length} eventos</i>\n`;
      message += `━━━━━━━━━━━━━━━━━━━\n\n`;
      
      // Show event type summary
      message += `<b>📊 Resumen por tipo:</b>\n`;
      const sortedTypes = Array.from(typeCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
      for (const [type, count] of sortedTypes) {
        const emoji = type.includes("ERROR") ? "❌" : type.includes("TRADE") ? "💹" : type.includes("SG_") ? "🛡️" : "📝";
        message += `${emoji} ${type}: ${count}\n`;
      }
      
      // Show recent errors if any
      if (errorTypes.length > 0) {
        message += `\n<b>⚠️ Errores recientes:</b>\n`;
        for (const error of errorTypes.slice(0, 5)) {
          message += `❌ ${escapeHtml(error)}\n`;
        }
      }
      
      // Show last 8 events with message content
      message += `\n<b>🕒 Últimos eventos:</b>\n`;
      for (const event of recentEvents.slice(0, 8)) {
        const time = event.timestamp ? new Date(event.timestamp).toLocaleTimeString("es-ES") : "N/A";
        const levelEmoji = event.level === "ERROR" ? "❌" : event.level === "WARN" ? "⚠️" : "ℹ️";
        // Truncate message to 60 chars to keep Telegram message manageable
        const msgPreview = event.message ? event.message.slice(0, 60).replace(/\n/g, " ") : "";
        const msgSuffix = event.message && event.message.length > 60 ? "..." : "";
        message += `<code>${time}</code> ${levelEmoji} <b>${escapeHtml(event.type)}</b>\n`;
        if (msgPreview) {
          message += `   ↳ <i>${escapeHtml(msgPreview)}${msgSuffix}</i>\n`;
        }
      }
      
      message += `\n<i>Env: ${environment.envTag}</i>`;

      await this.bot?.sendMessage(chatId, message.trim(), { parse_mode: "HTML" });
    } catch (error: any) {
      await this.bot?.sendMessage(chatId, `❌ Error obteniendo logs: ${escapeHtml(error.message)}`);
    }
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
      // Check cooldown first
      const cooldownCheck = await this.checkCooldown("heartbeat");
      if (!cooldownCheck.allowed) {
        console.log(`[telegram] Heartbeat cooldown active (${cooldownCheck.remaining}s remaining)`);
        return;
      }
      
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
      
      // Mark heartbeat as sent for cooldown tracking
      this.markEventSent("heartbeat");
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

      const envName = environment.envTag;
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
      const envLabel = environment.envTag;
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
      const chats = await storage.getActiveTelegramChats();
      
      if (chats.length > 0) {
        for (const chat of chats) {
          if (sentChatIds.has(chat.chatId)) continue;
          
          const shouldSend = this.shouldSendToChat(chat, alertType);
          if (shouldSend) {
            await this.sendToChat(chat.chatId, message);
            sentChatIds.add(chat.chatId);
          }
        }
      } else if (this.chatId) {
        await this.sendMessage(message);
        sentChatIds.add(this.chatId);
      }
    } catch (error) {
      console.error("Error sending to multiple chats:", error);
    }
  }

  // ============================================================
  // ENTRY INTENT NOTIFICATION - Con dedupe por vela 15m
  // ============================================================
  async sendEntryIntent(ctx: {
    pair: string;
    amountUsd: number;
    price: number;
    strategyLabel: string;
    signalReason: string;
    confidence: number;
    regime?: string;
    regimeReason?: string;
    requiredSignals?: number;
    currentSignals?: number;
  }): Promise<boolean> {
    // Generate dedupe key: pair + 15-min bucket
    const now = Date.now();
    const candleBucket = Math.floor(now / this.ENTRY_INTENT_DEDUPE_MS);
    const dedupeKey = `${ctx.pair}:BUY:${candleBucket}`;

    // Check if already sent in this candle period
    const lastSent = this.entryIntentCache.get(dedupeKey);
    if (lastSent && (now - lastSent) < this.ENTRY_INTENT_DEDUPE_MS) {
      console.log(`[telegram] Entry intent deduped for ${ctx.pair} (key: ${dedupeKey})`);
      return false;
    }

    // Clean old cache entries (older than 1 hour)
    const oneHourAgo = now - (60 * 60 * 1000);
    const keysToDelete: string[] = [];
    this.entryIntentCache.forEach((ts, key) => {
      if (ts < oneHourAgo) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => this.entryIntentCache.delete(key));

    // Build and send the message
    const message = buildEntryIntentHTML({
      pair: ctx.pair,
      amountUsd: ctx.amountUsd.toFixed(2),
      price: ctx.price.toFixed(4),
      strategyLabel: ctx.strategyLabel,
      signalReason: ctx.signalReason,
      confidence: ctx.confidence,
      regime: ctx.regime,
      regimeReason: ctx.regimeReason,
      requiredSignals: ctx.requiredSignals,
      currentSignals: ctx.currentSignals,
    });

    const sent = await this.sendMessage(message, { skipPrefix: true });
    
    if (sent) {
      this.entryIntentCache.set(dedupeKey, now);
      console.log(`[telegram] Entry intent sent for ${ctx.pair} (key: ${dedupeKey})`);
    }

    return sent;
  }

  private shouldSendToChat(chat: TelegramChat, alertType: AlertType, subtype?: AlertSubtype): boolean {
    const prefs = (chat.alertPreferences || {}) as Record<string, boolean>;
    
    if (subtype && prefs[subtype] !== undefined) {
      return prefs[subtype];
    }
    
    switch (alertType) {
      case "trades":
        return chat.alertTrades;
      case "errors":
        return chat.alertErrors;
      case "system":
        return chat.alertSystem;
      case "balance":
        return chat.alertBalance;
      case "heartbeat":
        return chat.alertHeartbeat;
      case "strategy":
        return true;
      default:
        return false;
    }
  }

  async sendAlertWithSubtype(message: string, alertType: AlertType, subtype: AlertSubtype): Promise<void> {
    if (!this.bot) return;

    const sentChatIds = new Set<string>();

    try {
      const chats = await storage.getActiveTelegramChats();
      
      if (chats.length > 0) {
        for (const chat of chats) {
          if (sentChatIds.has(chat.chatId)) continue;
          
          const shouldSend = this.shouldSendToChat(chat, alertType, subtype);
          if (shouldSend) {
            await this.sendToChat(chat.chatId, message);
            sentChatIds.add(chat.chatId);
          }
        }
      } else if (this.chatId) {
        await this.sendMessage(message);
        sentChatIds.add(this.chatId);
      }
    } catch (error) {
      console.error("Error sending to multiple chats:", error);
    }
  }

  // Cooldown check for specific event types
  async checkCooldown(eventType: string, pair?: string): Promise<{ allowed: boolean; cooldownSeconds: number; remaining: number }> {
    try {
      const config = await storage.getBotConfig();
      let cooldownSeconds = 0;
      
      switch (eventType) {
        case "stop_updated":
          cooldownSeconds = config?.notifCooldownStopUpdated ?? 60;
          break;
        case "regime_change":
          cooldownSeconds = config?.notifCooldownRegimeChange ?? 300;
          break;
        case "heartbeat":
          cooldownSeconds = config?.notifCooldownHeartbeat ?? 3600;
          break;
        case "trades":
          cooldownSeconds = config?.notifCooldownTrades ?? 0;
          break;
        case "errors":
          cooldownSeconds = config?.notifCooldownErrors ?? 60;
          break;
        default:
          cooldownSeconds = 0;
      }
      
      if (cooldownSeconds === 0) {
        return { allowed: true, cooldownSeconds: 0, remaining: 0 };
      }
      
      const cacheKey = pair ? `${eventType}:${pair}` : eventType;
      const lastSent = this.cooldownCache.get(cacheKey) || 0;
      const now = Date.now();
      const elapsed = (now - lastSent) / 1000;
      const remaining = Math.max(0, cooldownSeconds - elapsed);
      
      if (elapsed >= cooldownSeconds) {
        return { allowed: true, cooldownSeconds, remaining: 0 };
      }
      
      return { allowed: false, cooldownSeconds, remaining: Math.ceil(remaining) };
    } catch (error) {
      console.error("[telegram] Error checking cooldown:", error);
      return { allowed: true, cooldownSeconds: 0, remaining: 0 };
    }
  }
  
  // Mark event as sent for cooldown tracking
  markEventSent(eventType: string, pair?: string): void {
    const cacheKey = pair ? `${eventType}:${pair}` : eventType;
    this.cooldownCache.set(cacheKey, Date.now());
  }
  
  // Send with cooldown check
  async sendWithCooldown(message: string, eventType: string, alertType: AlertType, pair?: string): Promise<boolean> {
    const cooldownCheck = await this.checkCooldown(eventType, pair);
    
    if (!cooldownCheck.allowed) {
      console.log(`[telegram] Cooldown active for ${eventType}${pair ? `:${pair}` : ""} (${cooldownCheck.remaining}s remaining)`);
      return false;
    }
    
    await this.sendAlertToMultipleChats(message, alertType);
    this.markEventSent(eventType, pair);
    return true;
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
    // Check cooldown for errors
    const cooldownCheck = await this.checkCooldown("errors");
    if (!cooldownCheck.allowed) {
      console.log(`[telegram] Error alert cooldown active (${cooldownCheck.remaining}s remaining): ${title}`);
      return;
    }
    
    const message = `
⚠️ *${title}*

${description}

_KrakenBot.AI - Sistema de Alertas_
    `.trim();

    await this.sendAlertToMultipleChats(message, "errors");
    this.markEventSent("errors");
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
