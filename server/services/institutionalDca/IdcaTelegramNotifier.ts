/**
 * IdcaTelegramNotifier — Telegram alerts specific to the Institutional DCA module.
 * Completely independent from the main bot's Telegram service.
 * Uses the base telegramService for sending but has its own config, toggles, and templates.
 */
import { telegramService } from "../telegram";
import * as repo from "./IdcaRepository";
import type { TelegramAlertToggles } from "./IdcaTypes";
import type { InstitutionalDcaCycle, InstitutionalDcaOrder } from "@shared/schema";

const lastAlertTimes = new Map<string, number>();

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtUsd(val: number | string): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(val: number | string): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtPrice(val: number | string): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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

function simPrefix(mode: string): string {
  return mode === "simulation" ? "[SIMULACIÓN] " : "";
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

  const msg = `${simPrefix(cycle.mode)}🟢 <b>CICLO INICIADO — Institutional DCA</b>

<b>Par:</b> ${escapeHtml(cycle.pair)}
<b>Modo:</b> ${cycle.mode.toUpperCase()}
<b>Precio:</b> ${fmtPrice(cycle.currentPrice || "0")}
<b>Caída detectada:</b> -${dipPct.toFixed(1)}%
<b>Score:</b> ${score}
<b>Capital reservado ciclo:</b> ${fmtUsd(cycle.capitalReservedUsd)}`;

  await send(chatId, msg, config.telegramThreadId || undefined);
}

export async function alertBuyExecuted(cycle: InstitutionalDcaCycle, order: InstitutionalDcaOrder, orderType: string): Promise<void> {
  const alertKey = orderType === "base_buy" ? "base_buy_executed" : "safety_buy_executed";
  const { chatId, enabled } = await canSend(alertKey);
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const emoji = orderType === "base_buy" ? "🟢" : "📦";
  const label = orderType === "base_buy" ? "COMPRA INICIAL" : "SAFETY BUY EJECUTADA";

  const msg = `${simPrefix(cycle.mode)}${emoji} <b>${label}</b>

<b>Par:</b> ${escapeHtml(cycle.pair)}
<b>Compra:</b> #${cycle.buyCount}
<b>Precio:</b> ${fmtPrice(order.price)}
<b>Cantidad:</b> ${parseFloat(String(order.quantity)).toFixed(6)}
<b>Capital usado ciclo:</b> ${fmtUsd(cycle.capitalUsedUsd)}
<b>Precio medio:</b> ${fmtPrice(cycle.avgEntryPrice || "0")}
<b>Siguiente nivel:</b> ${cycle.nextBuyLevelPct ? `-${cycle.nextBuyLevelPct}%` : "N/A"}`;

  await send(chatId, msg, config.telegramThreadId || undefined);
}

export async function alertBuyBlocked(pair: string, mode: string, reason: string, pnlPct: number, buyCount: number): Promise<void> {
  const { chatId, enabled } = await canSend("buy_blocked");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const msg = `${simPrefix(mode)}⛔ <b>COMPRA BLOQUEADA</b>

<b>Par:</b> ${escapeHtml(pair)}
<b>Motivo:</b> ${escapeHtml(reason)}
<b>PnL actual ciclo:</b> ${fmtPct(pnlPct)}
<b>Compras ejecutadas:</b> ${buyCount}`;

  await send(chatId, msg, config.telegramThreadId || undefined);
}

export async function alertTpArmed(cycle: InstitutionalDcaCycle, partialPct: number): Promise<void> {
  const { chatId, enabled } = await canSend("tp_armed");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const msg = `${simPrefix(cycle.mode)}🎯 <b>TAKE PROFIT ARMADO</b>

<b>Par:</b> ${escapeHtml(cycle.pair)}
<b>Precio medio:</b> ${fmtPrice(cycle.avgEntryPrice || "0")}
<b>Precio actual:</b> ${fmtPrice(cycle.currentPrice || "0")}
<b>PnL global:</b> ${fmtPct(cycle.unrealizedPnlPct || "0")}
<b>Venta parcial:</b> ${partialPct.toFixed(0)}%
<b>Trailing restante:</b> ${cycle.trailingPct}%`;

  await send(chatId, msg, config.telegramThreadId || undefined);
}

export async function alertTrailingExit(cycle: InstitutionalDcaCycle): Promise<void> {
  const { chatId, enabled } = await canSend("trailing_exit");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const duration = cycle.closedAt && cycle.startedAt
    ? formatDuration(new Date(cycle.startedAt), new Date(cycle.closedAt))
    : "N/A";

  const msg = `${simPrefix(cycle.mode)}✅ <b>CICLO CERRADO — TRAILING EXIT</b>

<b>Par:</b> ${escapeHtml(cycle.pair)}
<b>Resultado:</b> ${fmtUsd(cycle.realizedPnlUsd || "0")}
<b>Rentabilidad:</b> ${fmtPct(cycle.unrealizedPnlPct || "0")}
<b>Compras:</b> ${cycle.buyCount}
<b>Duración:</b> ${duration}
<b>Motivo:</b> trailing_exit`;

  await send(chatId, msg, config.telegramThreadId || undefined);
}

export async function alertBreakevenExit(cycle: InstitutionalDcaCycle): Promise<void> {
  const { chatId, enabled } = await canSend("breakeven_exit");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const msg = `${simPrefix(cycle.mode)}🛡️ <b>CICLO CERRADO — BREAKEVEN EXIT</b>

<b>Par:</b> ${escapeHtml(cycle.pair)}
<b>Resultado:</b> ${fmtUsd(cycle.realizedPnlUsd || "0")}
<b>Compras:</b> ${cycle.buyCount}
<b>Motivo:</b> breakeven_exit`;

  await send(chatId, msg, config.telegramThreadId || undefined);
}

export async function alertEmergencyClose(mode: string, closedCount: number): Promise<void> {
  const { chatId, enabled } = await canSend("critical_error");
  if (!enabled && !chatId) return;
  const config = await repo.getIdcaConfig();
  // Emergency always sends regardless of toggle

  const msg = `${simPrefix(mode)}🚨 <b>EMERGENCY CLOSE ALL — Institutional DCA</b>

<b>Ciclos cerrados:</b> ${closedCount}
<b>Motivo:</b> Emergency exit activado manualmente
<b>Timestamp:</b> ${new Date().toISOString()}`;

  await send(chatId || config.telegramChatId || "", msg, config.telegramThreadId || undefined);
}

export async function alertSmartAdjustment(pair: string, mode: string, field: string, oldVal: number, newVal: number, reason: string): Promise<void> {
  const { chatId, enabled } = await canSend("smart_adjustment_applied");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const msg = `${simPrefix(mode)}🧠 <b>AJUSTE SMART APLICADO</b>

<b>Par:</b> ${escapeHtml(pair)}
<b>Cambio:</b> ${escapeHtml(field)} ${oldVal} → ${newVal}
<b>Motivo:</b> ${escapeHtml(reason)}`;

  await send(chatId, msg, config.telegramThreadId || undefined);
}

export async function alertModuleDrawdownBreached(mode: string, drawdownPct: number, maxPct: number): Promise<void> {
  const { chatId, enabled } = await canSend("critical_error");
  if (!enabled && !chatId) return;
  const config = await repo.getIdcaConfig();

  const msg = `${simPrefix(mode)}🔴 <b>MAX DRAWDOWN ALCANZADO — Institutional DCA</b>

<b>Drawdown actual:</b> ${fmtPct(-drawdownPct)}
<b>Límite configurado:</b> ${fmtPct(-maxPct)}
<b>Acción:</b> Módulo pausado, nuevas compras bloqueadas`;

  await send(chatId || config.telegramChatId || "", msg, config.telegramThreadId || undefined);
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

// ─── Helpers ───────────────────────────────────────────────────────

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  if (days > 0) return `${days}d ${remainHours}h`;
  return `${hours}h`;
}
