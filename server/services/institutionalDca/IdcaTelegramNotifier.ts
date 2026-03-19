/**
 * IdcaTelegramNotifier — Telegram alerts specific to the Institutional DCA module.
 * Completely independent from the main bot's Telegram service.
 * Uses the base telegramService for sending but has its own config, toggles, and templates.
 */
import { telegramService } from "../telegram";
import * as repo from "./IdcaRepository";
import { formatTelegramMessage, type FormatContext } from "./IdcaMessageFormatter";
import type { TelegramAlertToggles } from "./IdcaTypes";
import type { InstitutionalDcaCycle, InstitutionalDcaOrder } from "@shared/schema";

const lastAlertTimes = new Map<string, number>();

async function canSend(alertType: string): Promise<{ chatId: string; enabled: boolean }> {
  const config = await repo.getIdcaConfig();
  if (!config.telegramEnabled || !config.telegramChatId) {
    return { chatId: "", enabled: false };
  }

  const toggles = (config.telegramAlertTogglesJson || {}) as TelegramAlertToggles;

  // Check if this alert type is enabled
  if (alertType in toggles && !(toggles as any)[alertType]) {
    return { chatId: config.telegramChatId, enabled: false };
  }

  // Simulation check
  if (config.mode === "simulation" && !toggles.simulation_alerts_enabled) {
    return { chatId: config.telegramChatId, enabled: false };
  }

  // Cooldown check
  const cooldown = config.telegramCooldownSeconds * 1000;
  const now = Date.now();
  const lastTime = lastAlertTimes.get(alertType) || 0;
  if (now - lastTime < cooldown && alertType !== "critical_error") {
    return { chatId: config.telegramChatId, enabled: false };
  }

  lastAlertTimes.set(alertType, now);
  return { chatId: config.telegramChatId, enabled: true };
}

async function send(chatId: string, message: string, threadId?: string): Promise<boolean> {
  if (!telegramService.isInitialized()) return false;
  try {
    if (threadId) {
      return await telegramService.sendToChat(chatId, message, { parseMode: "HTML" });
    }
    return await telegramService.sendToChat(chatId, message, { parseMode: "HTML" });
  } catch (e: any) {
    console.error("[IDCA][TELEGRAM] Error sending:", e.message);
    return false;
  }
}

// ─── Public Alert Functions ────────────────────────────────────────

export async function alertCycleStarted(cycle: InstitutionalDcaCycle, dipPct: number, score: number): Promise<void> {
  const { chatId, enabled } = await canSend("cycle_started");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const ctx: FormatContext = {
    eventType: "cycle_started",
    pair: cycle.pair,
    mode: cycle.mode,
    price: parseFloat(String(cycle.currentPrice || "0")),
    quantity: parseFloat(String(cycle.totalQuantity || "0")),
    capitalUsed: parseFloat(String(cycle.capitalReservedUsd || "0")),
    dipPct,
    marketScore: score,
    buyCount: 1,
    sizeProfile: cycle.adaptiveSizeProfile || "balanced",
  };

  await send(chatId, formatTelegramMessage(ctx), config.telegramThreadId || undefined);
}

export async function alertBuyExecuted(cycle: InstitutionalDcaCycle, order: InstitutionalDcaOrder, orderType: string): Promise<void> {
  const alertKey = orderType === "base_buy" ? "base_buy_executed" : "safety_buy_executed";
  const { chatId, enabled } = await canSend(alertKey);
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const evType = orderType === "base_buy" ? "base_buy_executed" : "safety_buy_executed";
  const ctx: FormatContext = {
    eventType: evType,
    pair: cycle.pair,
    mode: cycle.mode,
    price: parseFloat(String(order.price)),
    quantity: parseFloat(String(order.quantity)),
    avgEntry: parseFloat(String(cycle.avgEntryPrice || "0")),
    capitalUsed: parseFloat(String(cycle.capitalUsedUsd || "0")),
    buyCount: cycle.buyCount,
  };

  await send(chatId, formatTelegramMessage(ctx), config.telegramThreadId || undefined);
}

export async function alertBuyBlocked(pair: string, mode: string, reason: string, pnlPct: number, buyCount: number): Promise<void> {
  const { chatId, enabled } = await canSend("buy_blocked");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const ctx: FormatContext = {
    eventType: "buy_blocked",
    reasonCode: reason,
    pair, mode, pnlPct, buyCount,
    blockReasons: [{ code: reason, message: reason }],
  };

  await send(chatId, formatTelegramMessage(ctx), config.telegramThreadId || undefined);
}

export async function alertTpArmed(cycle: InstitutionalDcaCycle, partialPct: number): Promise<void> {
  const { chatId, enabled } = await canSend("tp_armed");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const ctx: FormatContext = {
    eventType: "tp_armed",
    pair: cycle.pair,
    mode: cycle.mode,
    avgEntry: parseFloat(String(cycle.avgEntryPrice || "0")),
    price: parseFloat(String(cycle.currentPrice || "0")),
    pnlPct: parseFloat(String(cycle.unrealizedPnlPct || "0")),
    tpPct: parseFloat(String(cycle.tpTargetPct || "0")),
    partialPct,
    trailingPct: parseFloat(String(cycle.trailingPct || "0")),
  };

  await send(chatId, formatTelegramMessage(ctx), config.telegramThreadId || undefined);
}

export async function alertTrailingExit(cycle: InstitutionalDcaCycle): Promise<void> {
  const { chatId, enabled } = await canSend("trailing_exit");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const durationStr = cycle.closedAt && cycle.startedAt
    ? formatDuration(new Date(cycle.startedAt), new Date(cycle.closedAt))
    : "N/A";

  const capitalUsed = parseFloat(String(cycle.capitalUsedUsd || "0"));
  const realized = parseFloat(String(cycle.realizedPnlUsd || "0"));
  const pnlUsd = realized - capitalUsed;
  const pnlPct = capitalUsed > 0 ? (pnlUsd / capitalUsed) * 100 : 0;

  const ctx: FormatContext = {
    eventType: "trailing_exit",
    pair: cycle.pair,
    mode: cycle.mode,
    price: parseFloat(String(cycle.currentPrice || "0")),
    pnlPct,
    pnlUsd,
    buyCount: cycle.buyCount,
    durationStr,
  };

  await send(chatId, formatTelegramMessage(ctx), config.telegramThreadId || undefined);
}

export async function alertBreakevenExit(cycle: InstitutionalDcaCycle): Promise<void> {
  const { chatId, enabled } = await canSend("breakeven_exit");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const ctx: FormatContext = {
    eventType: "breakeven_exit",
    pair: cycle.pair,
    mode: cycle.mode,
    price: parseFloat(String(cycle.currentPrice || "0")),
    quantity: parseFloat(String(cycle.totalQuantity || "0")),
    buyCount: cycle.buyCount,
  };

  await send(chatId, formatTelegramMessage(ctx), config.telegramThreadId || undefined);
}

export async function alertEmergencyClose(mode: string, closedCount: number): Promise<void> {
  const { chatId, enabled } = await canSend("critical_error");
  if (!enabled && !chatId) return;
  const config = await repo.getIdcaConfig();

  const ctx: FormatContext = {
    eventType: "emergency_close_all",
    mode,
    closedCount,
    triggerSource: "manual",
  };

  await send(chatId || config.telegramChatId || "", formatTelegramMessage(ctx), config.telegramThreadId || undefined);
}

export async function alertSmartAdjustment(pair: string, mode: string, field: string, oldVal: number, newVal: number, reason: string): Promise<void> {
  const { chatId, enabled } = await canSend("smart_adjustment_applied");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const ctx: FormatContext = {
    eventType: "smart_adjustment_applied",
    pair, mode, field, oldVal, newVal, reason,
  };

  await send(chatId, formatTelegramMessage(ctx), config.telegramThreadId || undefined);
}

export async function alertModuleDrawdownBreached(mode: string, drawdownPct: number, maxPct: number): Promise<void> {
  const { chatId, enabled } = await canSend("module_max_drawdown_reached");
  if (!enabled && !chatId) return;
  const config = await repo.getIdcaConfig();

  const ctx: FormatContext = {
    eventType: "module_max_drawdown_reached",
    mode,
    drawdownPct,
    maxDrawdownPct: maxPct,
  };

  await send(chatId || config.telegramChatId || "", formatTelegramMessage(ctx), config.telegramThreadId || undefined);
}

export async function alertImportedPosition(
  cycle: InstitutionalDcaCycle,
  soloSalida: boolean,
  sourceType: string,
  isManualCycle: boolean = false,
  exchangeSource: string = "revolut_x",
  estimatedFeePct: number = 0,
  estimatedFeeUsd: number = 0,
  hadActiveCycle: boolean = false,
): Promise<void> {
  const { chatId, enabled } = await canSend("cycle_started");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const ctx: FormatContext = {
    eventType: "imported_position_created",
    pair: cycle.pair,
    mode: cycle.mode,
    price: parseFloat(String(cycle.avgEntryPrice || "0")),
    quantity: parseFloat(String(cycle.totalQuantity || "0")),
    capitalUsed: parseFloat(String(cycle.capitalUsedUsd || "0")),
    soloSalida,
    sourceType,
    isManualCycle,
    exchangeSource,
    estimatedFeePct,
    estimatedFeeUsd,
  };

  let msg = formatTelegramMessage(ctx);
  if (hadActiveCycle) {
    msg += `\n\n⚠️ <b>Aviso:</b> ya existía otro ciclo activo en este par al momento de la importación.`;
  }

  await send(chatId, msg, config.telegramThreadId || undefined);
}

export async function alertImportedClosed(cycle: InstitutionalDcaCycle, realizedPnl: number, pnlPct: number, durationStr: string): Promise<void> {
  const { chatId, enabled } = await canSend("cycle_closed");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const ctx: FormatContext = {
    eventType: "imported_position_closed",
    pair: cycle.pair,
    mode: cycle.mode,
    price: parseFloat(String(cycle.currentPrice || "0")),
    realizedPnl,
    pnlPct,
    durationStr,
    closeReason: cycle.closeReason || "trailing_exit",
  };

  await send(chatId, formatTelegramMessage(ctx), config.telegramThreadId || undefined);
}

export async function sendTestMessage(): Promise<boolean> {
  const config = await repo.getIdcaConfig();
  if (!config.telegramChatId) return false;

  const msg = `✅ <b>Test — Institutional DCA Telegram</b>

Modo: ${config.mode}
Telegram habilitado: ${config.telegramEnabled}
Timestamp: ${new Date().toISOString()}`;

  return send(config.telegramChatId, msg, config.telegramThreadId || undefined);
}

export async function sendRawMessage(message: string): Promise<boolean> {
  const config = await repo.getIdcaConfig();
  if (!config.telegramChatId || !config.telegramEnabled) return false;
  return send(config.telegramChatId, message, config.telegramThreadId || undefined);
}

// ─── Helpers ───────────────────────────────────────────────────────

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  if (days > 0) return `${days}d ${remainHours}h`;
  return `${hours}h`;
}
