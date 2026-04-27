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
import * as tbState from "./IdcaTrailingBuyTelegramState";
import {
  resolveTrailingBuyPolicy,
  shouldSendTrackingTelegram,
  buildDigestMessage,
  type TrailingBuyDigestEntry,
} from "./IdcaTelegramAlertPolicy";

const lastAlertTimes = new Map<string, number>();

// ─── Helpers ───────────────────────────────────────────────

/** Convierte minutos en texto legible: "20 min" o "7h 22min" */
export function formatElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

/** Determina si el rebote calculado puede ejecutarse dentro de maxExecutionPrice.
 *  requiredLocalLow = precio mínimo necesario para que el rebote entre dentro del límite.
 *  Fórmula: rtp = localLow * factor  ⇒  requiredLocalLow = maxExec / factor = maxExec * localLow / rtp
 */
export function computeReboundStatus(
  reboundTriggerPrice: number,
  localLow: number,
  maxExecutionPrice: number,
): { executable: boolean; requiredLocalLow: number; faltaPct: number } {
  const executable = reboundTriggerPrice <= maxExecutionPrice;
  const factor = localLow > 0 ? reboundTriggerPrice / localLow : 1;
  const requiredLocalLow = factor > 0 ? maxExecutionPrice / factor : maxExecutionPrice;
  const faltaPct = localLow > 0 ? ((localLow - requiredLocalLow) / localLow) * 100 : 0;
  return { executable, requiredLocalLow, faltaPct };
}

// ─── VWAP Alert State (anti-spam) ─────────────────────────────────
// Approaching buy: separate 2h cooldown per pair (independent of global cooldown)
const lastApproachingBuyAlert = new Map<string, number>();
const APPROACHING_BUY_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const APPROACHING_BUY_THRESHOLD_PCT = 3.0;

// Drawdown milestones: track highest milestone fired per pair; resets on anchor change
const lastDrawdownMilestone = new Map<string, number>();
const DRAWDOWN_MILESTONES = [5, 10, 15, 20];

export function resetVwapAlertState(pair: string): void {
  lastDrawdownMilestone.delete(pair);
  lastApproachingBuyAlert.delete(pair);
}

async function canSend(alertType: string): Promise<{ chatId: string; enabled: boolean }> {
  const config = await repo.getIdcaConfig();
  if (!config.telegramEnabled) {
    console.log(`[IDCA][TELEGRAM][BLOCKED] alertType=${alertType} reason=telegram_disabled (set telegram_enabled=true in IDCA config)`);
    return { chatId: "", enabled: false };
  }
  if (!config.telegramChatId) {
    console.log(`[IDCA][TELEGRAM][BLOCKED] alertType=${alertType} reason=no_chat_id (configure telegram_chat_id in IDCA config)`);
    return { chatId: "", enabled: false };
  }

  const toggles = (config.telegramAlertTogglesJson || {}) as TelegramAlertToggles;

  // Check if this alert type is enabled
  if (alertType in toggles && !(toggles as any)[alertType]) {
    console.log(`[IDCA][TELEGRAM][BLOCKED] alertType=${alertType} reason=toggle_disabled`);
    return { chatId: config.telegramChatId, enabled: false };
  }

  // Simulation check
  if (config.mode === "simulation" && !toggles.simulation_alerts_enabled) {
    console.log(`[IDCA][TELEGRAM][BLOCKED] alertType=${alertType} reason=simulation_alerts_disabled`);
    return { chatId: config.telegramChatId, enabled: false };
  }

  // Cooldown check
  const cooldown = (config.telegramCooldownSeconds || 30) * 1000;
  const now = Date.now();
  const lastTime = lastAlertTimes.get(alertType) || 0;
  if (now - lastTime < cooldown && alertType !== "critical_error") {
    const remainingSec = Math.ceil((cooldown - (now - lastTime)) / 1000);
    console.log(`[IDCA][TELEGRAM][BLOCKED] alertType=${alertType} reason=cooldown remainingSec=${remainingSec}`);
    return { chatId: config.telegramChatId, enabled: false };
  }

  lastAlertTimes.set(alertType, now);
  return { chatId: config.telegramChatId, enabled: true };
}

export async function getTelegramStatus(): Promise<{
  enabled: boolean;
  chatIdConfigured: boolean;
  serviceInitialized: boolean;
  mode: string;
  cooldownSeconds: number;
  simulationAlertsEnabled: boolean;
  toggles: Record<string, boolean>;
}> {
  const config = await repo.getIdcaConfig();
  const toggles = (config.telegramAlertTogglesJson || {}) as any;
  return {
    enabled: !!config.telegramEnabled,
    chatIdConfigured: !!config.telegramChatId,
    serviceInitialized: telegramService.isInitialized(),
    mode: config.mode,
    cooldownSeconds: config.telegramCooldownSeconds || 30,
    simulationAlertsEnabled: !!(toggles.simulation_alerts_enabled),
    toggles: toggles as Record<string, boolean>,
  };
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

export async function alertCycleStarted(cycle: InstitutionalDcaCycle, entryDipPct: number, score: number): Promise<void> {
  const { chatId, enabled } = await canSend("cycle_started");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();
  const assetConfig = await repo.getAssetConfig(cycle.pair);

  const maxSafety = assetConfig?.maxSafetyOrders ?? 3;
  const ctx: FormatContext = {
    eventType: "cycle_started",
    pair: cycle.pair,
    mode: cycle.mode,
    price: parseFloat(String(cycle.currentPrice || "0")),
    quantity: parseFloat(String(cycle.totalQuantity || "0")),
    capitalUsed: parseFloat(String(cycle.capitalUsedUsd || "0")),
    totalCapitalReserved: parseFloat(String(cycle.capitalReservedUsd || "0")),
    entryDipPct,
    entryBasePrice: parseFloat(String(cycle.basePrice || "0")) || undefined,
    entryBasePriceType: cycle.basePriceType || undefined,
    marketScore: score,
    buyCount: 1,
    maxBuyCount: maxSafety + 1,
    sizeProfile: cycle.adaptiveSizeProfile || "balanced",
    nextBuyPrice: parseFloat(String(cycle.nextBuyPrice || "0")) || undefined,
    nextBuyLevelPct: parseFloat(String(cycle.nextBuyLevelPct || "0")) || undefined,
    protectionActivationPct: parseFloat(String(assetConfig?.protectionActivationPct ?? "1.00")),
    trailingActivationPct: parseFloat(String(assetConfig?.trailingActivationPct ?? "3.50")),
  };

  await send(chatId, formatTelegramMessage(ctx), config.telegramThreadId || undefined);
}

export async function alertBuyExecuted(cycle: InstitutionalDcaCycle, order: InstitutionalDcaOrder, orderType: string, prevAvgEntry?: number): Promise<void> {
  const alertKey = orderType === "base_buy" ? "base_buy_executed" : "safety_buy_executed";
  const { chatId, enabled } = await canSend(alertKey);
  if (!enabled) return;
  const config = await repo.getIdcaConfig();
  const assetConfig = await repo.getAssetConfig(cycle.pair);

  const maxSafety = assetConfig?.maxSafetyOrders ?? 3;
  const evType = orderType === "base_buy" ? "base_buy_executed" : "safety_buy_executed";
  const ctx: FormatContext = {
    eventType: evType,
    pair: cycle.pair,
    mode: cycle.mode,
    price: parseFloat(String(order.price)),
    quantity: parseFloat(String(order.quantity)),
    avgEntry: parseFloat(String(cycle.avgEntryPrice || "0")),
    capitalUsed: parseFloat(String(cycle.capitalUsedUsd || "0")),
    totalCapitalReserved: parseFloat(String(cycle.capitalReservedUsd || "0")),
    buyCount: cycle.buyCount,
    maxBuyCount: maxSafety + 1,
    nextBuyPrice: parseFloat(String(cycle.nextBuyPrice || "0")) || undefined,
    nextBuyLevelPct: parseFloat(String(cycle.nextBuyLevelPct || "0")) || undefined,
    protectionActivationPct: parseFloat(String(assetConfig?.protectionActivationPct ?? "1.00")),
    trailingActivationPct: parseFloat(String(assetConfig?.trailingActivationPct ?? "3.50")),
    protectionArmed: !!cycle.protectionArmedAt,
    prevAvgEntry,
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

export async function alertProtectionArmed(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  stopPrice: number,
  pnlPct: number
): Promise<void> {
  const { chatId, enabled } = await canSend("protection_armed");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();
  const assetConfig = await repo.getAssetConfig(cycle.pair);

  const ctx: FormatContext = {
    eventType: "protection_armed",
    pair: cycle.pair,
    mode: cycle.mode,
    price: currentPrice,
    avgEntry: parseFloat(String(cycle.avgEntryPrice || "0")),
    pnlPct,
    stopPrice,
    trailingActivationPct: parseFloat(String(assetConfig?.trailingActivationPct ?? "3.50")),
  };

  await send(chatId, formatTelegramMessage(ctx), config.telegramThreadId || undefined);
}

export async function alertTrailingActivated(
  cycle: InstitutionalDcaCycle,
  currentPrice: number,
  pnlPct: number,
  trailingMarginPct: number
): Promise<void> {
  const { chatId, enabled } = await canSend("trailing_activated");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const ctx: FormatContext = {
    eventType: "trailing_activated",
    pair: cycle.pair,
    mode: cycle.mode,
    price: currentPrice,
    avgEntry: parseFloat(String(cycle.avgEntryPrice || "0")),
    pnlPct,
    trailingPct: trailingMarginPct,
    trailingMarginPct,
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

  // Sum fees from all orders in cycle
  const orders = await repo.getOrdersByCycle(cycle.id);
  const totalFees = orders.reduce((sum: number, o: any) => sum + parseFloat(String(o.feesUsd || "0")), 0);

  const ctx: FormatContext = {
    eventType: "trailing_exit",
    pair: cycle.pair,
    mode: cycle.mode,
    price: parseFloat(String(cycle.currentPrice || "0")),
    avgEntry: parseFloat(String(cycle.avgEntryPrice || "0")),
    capitalUsed,
    pnlPct,
    pnlUsd,
    buyCount: cycle.buyCount,
    durationStr,
    totalFeesUsd: totalFees,
  };

  await send(chatId, formatTelegramMessage(ctx), config.telegramThreadId || undefined);
}

export async function alertBreakevenExit(cycle: InstitutionalDcaCycle): Promise<void> {
  const { chatId, enabled } = await canSend("breakeven_exit");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const durationStr = cycle.closedAt && cycle.startedAt
    ? formatDuration(new Date(cycle.startedAt), new Date(cycle.closedAt))
    : "N/A";

  const capitalUsed = parseFloat(String(cycle.capitalUsedUsd || "0"));
  const realized = parseFloat(String(cycle.realizedPnlUsd || "0"));
  const pnlUsd = realized - capitalUsed;

  // Sum fees from all orders in cycle
  const orders = await repo.getOrdersByCycle(cycle.id);
  const totalFees = orders.reduce((sum: number, o: any) => sum + parseFloat(String(o.feesUsd || "0")), 0);

  const ctx: FormatContext = {
    eventType: "breakeven_exit",
    pair: cycle.pair,
    mode: cycle.mode,
    price: parseFloat(String(cycle.currentPrice || "0")),
    avgEntry: parseFloat(String(cycle.avgEntryPrice || "0")),
    capitalUsed,
    pnlUsd,
    buyCount: cycle.buyCount,
    durationStr,
    totalFeesUsd: totalFees,
  };

  await send(chatId, formatTelegramMessage(ctx), config.telegramThreadId || undefined);
}

export async function alertEmergencyClose(mode: string, closedCount: number): Promise<void> {
  const { chatId, enabled } = await canSend("critical_error");
  if (!enabled) return;
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
  if (!enabled) return;
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

// ─── VWAP Anchor Alerts ────────────────────────────────────────────

export async function alertVwapAnchorChanged(
  pair: string,
  mode: string,
  oldPrice: number | null,
  newPrice: number,
  anchorAgeHours: number,
  drawdownPct: number
): Promise<void> {
  const { chatId, enabled } = await canSend("vwap_anchor_changed");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  // Reset drawdown milestones and approaching buy cooldown on anchor change
  resetVwapAlertState(pair);

  const priceDiff = oldPrice ? ((newPrice - oldPrice) / oldPrice) * 100 : null;
  const prevLine = oldPrice
    ? `📌 Ancla anterior: $${oldPrice.toFixed(2)}${priceDiff !== null ? ` (${priceDiff >= 0 ? "+" : ""}${priceDiff.toFixed(2)}%)` : ""}`
    : `📌 Primera ancla registrada`;

  const msg = [
    `🔔 <b>Ancla VWAP actualizada</b> — <b>${pair}</b>`,
    ``,
    `📍 Nueva ancla: <b>$${newPrice.toFixed(2)}</b>`,
    prevLine,
    `⏱ Fijada hace: ${anchorAgeHours.toFixed(1)}h`,
    `📉 Caída acumulada: ${drawdownPct.toFixed(2)}%`,
    ``,
    `El bot ha registrado un nuevo máximo relevante como referencia VWAP. Las bandas se recalcularán desde este precio.`,
    ``,
    `<i>Modo: ${mode}</i>`,
  ].join("\n");

  await send(chatId, msg, config.telegramThreadId || undefined);
}

export async function alertApproachingBuy(
  pair: string,
  mode: string,
  currentPrice: number,
  buyTriggerPrice: number,
  distToBuyPct: number,
  zone: string,
  trailingBuyActive = false,
): Promise<void> {
  // Si el TB está activo (WATCHING/ARMED/TRACKING), este aviso contradice la lógica Op.B
  if (trailingBuyActive) {
    console.debug(`[IDCA][TELEGRAM] Skipping alertApproachingBuy for ${pair} — Trailing Buy activo`);
    return;
  }
  // Long cooldown check first — avoid polluting canSend timer
  const lastTime = lastApproachingBuyAlert.get(pair) || 0;
  if (Date.now() - lastTime < APPROACHING_BUY_COOLDOWN_MS) return;

  const { chatId, enabled } = await canSend("vwap_approaching_buy");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  lastApproachingBuyAlert.set(pair, Date.now());

  const msg = [
    `⚡ <b>Precio cerca de zona VWAP</b> — <b>${pair}</b>`,
    ``,
    `📊 Precio actual: <b>$${currentPrice.toFixed(2)}</b>`,
    `📍 Zona VWAP: ${zone}`,
    `🎯 Zona técnica vigilada: $${buyTriggerPrice.toFixed(2)} (falta ${distToBuyPct.toFixed(2)}%)`,
    ``,
    `Aviso informativo. La entrada real depende de caída mínima, score, Trailing Buy y límite máximo de ejecución.`,
    ``,
    `<i>Modo: ${mode} | Cooldown: 2h</i>`,
  ].join("\n");

  await send(chatId, msg, config.telegramThreadId || undefined);
}

export async function alertVwapDrawdownMilestone(
  pair: string,
  mode: string,
  drawdownPct: number,
  anchorPrice: number,
  anchorAgeHours: number
): Promise<void> {
  // Find highest milestone crossed
  const milestone = DRAWDOWN_MILESTONES.filter(m => drawdownPct >= m).pop();
  if (!milestone) return;

  // Only fire if this is a new (higher) milestone
  const lastMilestone = lastDrawdownMilestone.get(pair) || 0;
  if (milestone <= lastMilestone) return;

  const { chatId, enabled } = await canSend("vwap_drawdown_milestone");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  lastDrawdownMilestone.set(pair, milestone);

  const severity = milestone >= 15 ? "🔴" : milestone >= 10 ? "🟠" : "🟡";
  const msg = [
    `${severity} <b>Caída ${milestone}% desde ancla</b> — <b>${pair}</b>`,
    ``,
    `📉 Caída acumulada: <b>${drawdownPct.toFixed(2)}%</b>`,
    `📌 Ancla VWAP: $${anchorPrice.toFixed(2)} (hace ${anchorAgeHours.toFixed(1)}h)`,
    ``,
    `El precio sigue por debajo de la referencia VWAP. El bot vigilando y esperando rebote.`,
    ``,
    `<i>Modo: ${mode} | Hito: -${milestone}%</i>`,
  ].join("\n");

  await send(chatId, msg, config.telegramThreadId || undefined);
}

export async function alertTrailingBuyWatching(
  pair: string,
  mode: string,
  currentPrice: number,
  referencePrice: number,
  buyThreshold: number,
): Promise<void> {
  // Siempre registrar log técnico
  console.log(
    `[TRAILING_BUY_WATCHING] pair=${pair} currentPrice=$${currentPrice.toFixed(2)}` +
    ` referencePrice=$${referencePrice.toFixed(2)} buyThreshold=$${buyThreshold.toFixed(2)}` +
    ` state=watching`,
  );

  // Verificar política
  const idcaConfig = await repo.getIdcaConfig();
  const tbPolicy = resolveTrailingBuyPolicy(idcaConfig.telegramAlertTogglesJson || {});
  if (!tbPolicy.watchingEnabled) {
    console.log(`[TELEGRAM_BLOCKED_BY_POLICY] pair=${pair} alertType=watching reason=watching_disabled_by_policy`);
    return;
  }

  if (!tbState.shouldNotifyWatching(pair, mode)) {
    console.debug(`[IDCA][TELEGRAM][TRAILING_BUY] Skipping WATCHING alert for ${pair} - throttle active`);
    return;
  }
  const { chatId, enabled } = await canSend("trailing_buy_armed");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();
  const missingPct = ((currentPrice - buyThreshold) / currentPrice * 100).toFixed(2);
  const msg = [
    `⚡ <b>Cerca de zona de entrada</b> — <b>${pair}</b>`,
    ``,
    `${pair} está cerca de la zona de activación del Trailing Buy, pero todavía no ha caído lo suficiente.`,
    ``,
    `💵 Precio actual: <code>$${currentPrice.toFixed(2)}</code>`,
    `📍 Referencia de entrada: <code>$${referencePrice.toFixed(2)}</code>`,
    `🎯 Zona de activación: <code>$${buyThreshold.toFixed(2)}</code>`,
    `📉 Falta bajar: <code>${missingPct}%</code>`,
    ``,
    `El bot no compra todavía. El Trailing Buy se armará solo si el precio toca la zona de activación.`,
    ``,
    `<i>Modo: ${mode}</i>`,
  ].join("\n");

  await send(chatId, msg, config.telegramThreadId || undefined);
  tbState.markNotifiedWatching(pair, mode);
  console.log(`[IDCA][TELEGRAM][TRAILING_BUY] WATCHING notification sent for ${pair} referencePrice=$${referencePrice.toFixed(2)} buyThreshold=$${buyThreshold.toFixed(2)}`);
}

export async function alertTrailingBuyArmed(
  pair: string,
  mode: string,
  currentPrice: number,
  referencePrice: number,
  activationPrice: number,
  reboundTriggerPrice: number,
  maxExecutionPrice?: number,
): Promise<void> {
  // Anti-spam: solo notificar si no estaba ya armado
  if (!tbState.shouldNotifyArmed(pair, mode)) {
    console.debug(`[IDCA][TELEGRAM][TRAILING_BUY] Skipping ARMED alert for ${pair} - already armed/tracking or in cooldown`);
    return;
  }

  const { chatId, enabled } = await canSend("trailing_buy_armed");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const maxExec = maxExecutionPrice ?? activationPrice * 1.003;
  const { executable, requiredLocalLow, faltaPct } = computeReboundStatus(reboundTriggerPrice, currentPrice, maxExec);

  const execLines = executable
    ? [
        `✅ Rebote válido: si confirma hasta <code>$${reboundTriggerPrice.toFixed(2)}</code>, el bot podrá comprar (si pasan demás filtros).`,
      ]
    : [
        `⚠️ Rebote fuera de rango: si sube hasta <code>$${reboundTriggerPrice.toFixed(2)}</code>, la compra se bloqueará por superar el límite máximo.`,
        `📉 Mínimo necesario para rebote válido: <code>$${requiredLocalLow.toFixed(2)}</code>`,
        faltaPct > 0 ? `⏳ Falta bajar: <code>${faltaPct.toFixed(2)}%</code>` : ``,
        `El bot seguirá buscando un mínimo más bajo antes de permitir ejecución.`,
      ].filter(Boolean);

  const msg = [
    `🔵 <b>Trailing Buy armado</b> — <b>${pair}</b>`,
    ``,
    `📍 Precio de referencia de entrada: <code>$${referencePrice.toFixed(2)}</code>`,
    `✅ Activación alcanzada: <code>$${activationPrice.toFixed(2)}</code>`,
    `💵 Precio actual / mínimo inicial: <code>$${currentPrice.toFixed(2)}</code>`,
    `📉 Mínimo observado: <code>$${currentPrice.toFixed(2)}</code>`,
    ``,
    `🎯 Rebote técnico calculado: <code>$${reboundTriggerPrice.toFixed(2)}</code>`,
    `🚫 Límite máximo de ejecución: <code>$${maxExec.toFixed(2)}</code>`,
    ``,
    ...execLines,
    ``,
    `El bot no compra todavía. Está esperando confirmación de rebote.`,
    ``,
    `<i>Modo: ${mode}</i>`,
  ].join("\n");

  await send(chatId, msg, config.telegramThreadId || undefined);
  
  tbState.markNotifiedArmed(pair, mode, referencePrice, currentPrice);
  console.log(`[IDCA][TELEGRAM][TRAILING_BUY] ARMED notification sent for ${pair} reboundExecutable=${executable}`);
}

export async function alertTrailingBuyTriggered(
  pair: string,
  mode: string,
  currentPrice: number,
  bouncePct: number,
  localLow: number,
  maxExecutionPrice?: number,
): Promise<void> {
  // Anti-spam: solo notificar una vez
  if (!tbState.shouldNotifyTriggered(pair, mode)) {
    console.debug(`[IDCA][TELEGRAM][TRAILING_BUY] Skipping TRIGGERED alert for ${pair} - already notified`);
    return;
  }

  const { chatId, enabled } = await canSend("trailing_buy_triggered");
  if (!enabled) return;

  const config = await repo.getIdcaConfig();

  const withinLimit = maxExecutionPrice !== undefined ? currentPrice <= maxExecutionPrice : undefined;
  const statusLine = withinLimit === false
    ? `⚠️ Precio supera límite máximo de ejecución (<code>$${maxExecutionPrice!.toFixed(2)}</code>). La entrada puede bloquearse.`
    : withinLimit === true
    ? `✅ Precio dentro del límite máximo. Validando entrada...`
    : `Rebote detectado, validando entrada.`;

  const msg = [
    `🟡 <b>Rebote detectado — Trailing Buy</b> — <b>${pair}</b>`,
    ``,
    `💵 Precio actual: <code>$${currentPrice.toFixed(2)}</code>`,
    `📉 Mejor precio previo (mínimo): <code>$${localLow.toFixed(2)}</code>`,
    `📈 Rebote detectado: <code>+${bouncePct.toFixed(3)}%</code>`,
    maxExecutionPrice !== undefined ? `🚫 Límite máximo de ejecución: <code>$${maxExecutionPrice.toFixed(2)}</code>` : null,
    ``,
    statusLine,
    ``,
    `<i>Modo: ${mode}</i>`,
  ].filter(Boolean).join("\n");

  await send(chatId, msg, config.telegramThreadId || undefined);

  tbState.markNotifiedTriggered(pair, mode);
  console.log(`[IDCA][TELEGRAM][TRAILING_BUY] TRIGGERED notification sent for ${pair} withinLimit=${withinLimit}`);
}

export async function alertTrailingBuyTracking(
  pair: string,
  mode: string,
  currentPrice: number,
  bestPriceObserved: number,
  reboundTriggerPrice: number,
  minutesSinceLastNotify: number,
  opts?: {
    referencePrice?: number;
    buyThreshold?: number;
    maxExecutionPrice?: number;
  },
): Promise<void> {
  // Siempre registrar log técnico — independientemente de si se envía por Telegram
  console.log(
    `[TRAILING_BUY_TRACKING] pair=${pair} currentPrice=$${currentPrice.toFixed(2)}` +
    ` localLow=$${bestPriceObserved.toFixed(2)} reboundTriggerPrice=$${reboundTriggerPrice.toFixed(2)}` +
    (opts?.maxExecutionPrice ? ` maxExecutionPrice=$${opts.maxExecutionPrice.toFixed(2)}` : "") +
    ` state=tracking`,
  );

  // Cargar config una sola vez
  const idcaConfig = await repo.getIdcaConfig();
  if (!idcaConfig.telegramEnabled || !idcaConfig.telegramChatId) return;

  // Verificar política: si trackingEnabled=false (default), solo log IDCA, no Telegram
  const tbPolicy = resolveTrailingBuyPolicy(idcaConfig.telegramAlertTogglesJson || {});
  if (!tbPolicy.trackingEnabled) {
    console.log(
      `[TELEGRAM_BLOCKED_BY_POLICY] pair=${pair} alertType=tracking reason=tracking_disabled_by_policy` +
      ` | El seguimiento técnico está disponible en Logs IDCA`,
    );
    return;
  }

  // Policy permite tracking: verificar intervalos configurables
  const tbTelegramState = tbState.getTrailingBuyTelegramState(pair, mode);
  const timeSinceLastMs = tbTelegramState ? Date.now() - tbTelegramState.lastNotifiedAt : Infinity;
  const priceImprovementPct =
    tbTelegramState?.lastNotifiedBestPrice != null
      ? Math.max(0, ((tbTelegramState.lastNotifiedBestPrice - bestPriceObserved) / tbTelegramState.lastNotifiedBestPrice) * 100)
      : 100;

  const policyCheck = shouldSendTrackingTelegram(tbPolicy, timeSinceLastMs, priceImprovementPct);
  if (!policyCheck.should) {
    console.debug(
      `[TELEGRAM_BLOCKED_BY_POLICY] pair=${pair} alertType=tracking reason=${policyCheck.reason}`,
    );
    return;
  }

  // Toggle explícito desactivado por usuario
  const togglesRaw = (idcaConfig.telegramAlertTogglesJson || {}) as any;
  if (idcaConfig.mode === "simulation" && !togglesRaw.simulation_alerts_enabled) return;
  if ("trailing_buy_tracking" in togglesRaw && !togglesRaw.trailing_buy_tracking) return;

  const chatId = idcaConfig.telegramChatId;
  const config = idcaConfig;
  const maxExec = opts?.maxExecutionPrice;
  const elapsedText = formatElapsed(minutesSinceLastNotify);

  // reboundExecutable: ¿puede ejecutarse dentro del límite?
  const { executable, requiredLocalLow, faltaPct } = maxExec !== undefined
    ? computeReboundStatus(reboundTriggerPrice, bestPriceObserved, maxExec)
    : { executable: undefined as boolean | undefined, requiredLocalLow: 0, faltaPct: 0 };

  const lines: (string | null)[] = [
    `🔵 <b>Trailing Buy en seguimiento</b> — <b>${pair}</b>`,
    ``,
    `El bot está midiendo el mínimo del precio. No ha comprado todavía.`,
    ``,
    opts?.referencePrice !== undefined ? `📍 Referencia de entrada: <code>$${opts.referencePrice.toFixed(2)}</code>` : null,
    opts?.buyThreshold !== undefined   ? `✅ Activación alcanzada: <code>$${opts.buyThreshold.toFixed(2)}</code>` : null,
    `� Precio actual: <code>$${currentPrice.toFixed(2)}</code>`,
    `📉 Mínimo observado: <code>$${bestPriceObserved.toFixed(2)}</code>`,
    ``,
    `🎯 Rebote técnico necesario: <code>$${reboundTriggerPrice.toFixed(2)}</code>`,
    maxExec !== undefined ? `🚫 Límite máximo de ejecución: <code>$${maxExec.toFixed(2)}</code>` : null,
    ``,
  ];

  if (executable === false) {
    lines.push(
      `⚠️ Rebote actual fuera de rango.`,
      `Si rebota hasta <code>$${reboundTriggerPrice.toFixed(2)}</code>, la compra se bloqueará por superar el límite máximo.`,
      `📉 Mínimo necesario para rebote válido: <code>$${requiredLocalLow.toFixed(2)}</code>`,
      faltaPct > 0.001 ? `⏳ Falta bajar: <code>${faltaPct.toFixed(2)}%</code>` : null,
      `El bot seguirá siguiendo el mínimo.`,
    );
  } else if (executable === true) {
    lines.push(
      `✅ Rebote válido dentro del límite.`,
      `Solo compra si el precio rebota hasta la zona técnica y pasan los filtros finales.`,
    );
  } else {
    lines.push(`Solo compra si el precio rebota y pasan los filtros finales.`);
  }

  lines.push(``, `Último aviso hace: ${elapsedText}`, ``, `<i>Modo: ${mode}</i>`);

  const msg = lines.filter(l => l !== null).join("\n");

  await send(chatId, msg, config.telegramThreadId || undefined);

  tbState.markNotifiedTracking(pair, mode, bestPriceObserved);
  console.log(
    `[IDCA][TELEGRAM][TRAILING_BUY] TRACKING notification sent for ${pair} reboundExecutable=${executable} reason=${policyCheck.reason}`,
  );
}

// ─── Digest de Trailing Buy (resumen agrupado) ─────────────────────────────

/**
 * Envía el resumen agrupado de Trailing Buy.
 * Llamar desde el tick del motor cuando shouldSendDigest() devuelve true.
 */
export async function sendTrailingBuyDigest(
  mode: string,
  entries: TrailingBuyDigestEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const { chatId, enabled } = await canSend("trailing_buy_digest");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();
  const msg = buildDigestMessage(entries, mode);
  await send(chatId, msg, config.telegramThreadId || undefined);
  console.log(`[IDCA][TELEGRAM][TRAILING_BUY] DIGEST sent for mode=${mode} pairs=${entries.map(e => e.pair).join(",")}`);
}

export async function alertTrailingBuyCancelled(
  pair: string,
  mode: string,
  currentPrice: number,
  reason: "price_recovered" | "reference_changed" | "timeout" | "module_paused" | "cycle_closed" | string,
): Promise<void> {
  // Anti-spam: solo notificar una vez
  if (!tbState.shouldNotifyCancelled(pair, mode)) {
    console.debug(`[IDCA][TELEGRAM][TRAILING_BUY] Skipping CANCELLED alert for ${pair} - already notified or not armed`);
    return;
  }

  const { chatId, enabled } = await canSend("trailing_buy_cancelled");
  if (!enabled) return;

  const reasonText: Record<string, string> = {
    price_recovered: "precio salió de zona",
    reference_changed: "referencia cambió",
    timeout: "timeout",
    module_paused: "módulo pausado",
    cycle_closed: "ciclo cerrado",
  };

  const config = await repo.getIdcaConfig();
  const msg = [
    `⚪ <b>Trailing Buy desactivado</b> — <b>${pair}</b>`,
    ``,
    `Motivo: ${reasonText[reason] || reason}`,
    `Último precio observado: <code>$${currentPrice.toFixed(2)}</code>`,
    ``,
    `No se ejecutó compra.`,
    ``,
    `<i>Modo: ${mode}</i>`,
  ].join("\n");

  await send(chatId, msg, config.telegramThreadId || undefined);
  
  // Marcar como notificado — NO resetear: el cooldown de rearmado (rearmAllowedAfter) debe preservarse
  tbState.markNotifiedCancelled(pair, mode);
  console.log(`[IDCA][TELEGRAM][TRAILING_BUY] CANCELLED notification sent for ${pair} (reason: ${reason}). Cooldown 30min activo.`);
}

// ─── Trailing Buy Executed ───────────────────────────────────────────

export async function alertTrailingBuyExecuted(
  pair: string,
  mode: string,
  currentPrice: number,
  localLow: number,
  bouncePct: number,
  cycleId: number,
  orderId?: number,
): Promise<void> {
  // GUARD OBLIGATORIO: solo notificar si la compra fue realmente persistida
  if (!cycleId || cycleId <= 0) {
    console.warn(`[IDCA][TRAILING_BUY] Compra no confirmada: no hay cycleId (${cycleId}), no se envía Telegram ejecutado`);
    return;
  }
  if (!orderId || orderId <= 0) {
    console.warn(`[IDCA][TRAILING_BUY] Compra no confirmada: no hay orderId (${orderId}), no se envía Telegram ejecutado`);
    return;
  }
  const { chatId, enabled } = await canSend("trailing_buy_executed");
  if (!enabled) return;

  const config = await repo.getIdcaConfig();
  const msg = [
    `🟢 <b>Compra ejecutada por Trailing Buy</b> — <b>${pair}</b>`,
    ``,
    `💵 Precio de compra: <code>$${currentPrice.toFixed(2)}</code>`,
    `📉 Mínimo previo observado: <code>$${localLow.toFixed(2)}</code>`,
    `📈 Rebote confirmado: <code>+${bouncePct.toFixed(3)}%</code>`,
    ``,
    `Ciclo: <code>${cycleId}</code>`,
    orderId ? `Orden: <code>${orderId}</code>` : null,
    ``,
    `<i>Modo: ${mode}</i>`,
  ].filter(Boolean).join("\n");

  await send(chatId, msg, config.telegramThreadId || undefined);
  console.log(`[IDCA][TELEGRAM][TRAILING_BUY] EXECUTED notification sent for ${pair}, cycle ${cycleId}`);
}

// ─── Trailing Buy Level 1 Alerts ─────────────────────────────────────

export async function alertTrailingBuyLevel1Activated(
  pair: string,
  mode: string,
  currentPrice: number,
  triggerLevel: number,
  triggerPrice: number,
  trailingMode: string,
  trailingValue: number,
): Promise<void> {
  const { chatId, enabled } = await canSend("trailing_buy_level1_activated");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();
  const nivelLabel = triggerLevel === 0 ? "Compra base" : `Compra de seguridad ${triggerLevel}`;
  const modoLabel = trailingMode === "rebound_pct" ? `rebote ${trailingValue}%` : `${trailingValue} ATRP`;
  const msg = [
    `🔵 <b>Trailing Buy armado</b> — <b>${pair}</b>`,
    ``,
    `Nivel: ${nivelLabel}`,
    `📍 Precio de activación: <code>$${triggerPrice.toFixed(2)}</code>`,
    `💵 Precio actual: <code>$${currentPrice.toFixed(2)}</code>`,
    `⚙️ Modo de seguimiento: ${modoLabel}`,
    ``,
    `El bot está esperando confirmación de rebote antes de comprar.`,
    ``,
    `<i>Modo: ${mode}</i>`,
  ].join("\n");
  await send(chatId, msg, config.telegramThreadId || undefined);
}

export async function alertTrailingBuyLevel1Triggered(
  pair: string,
  mode: string,
  currentPrice: number,
  triggerLevel: number,
  bouncePct: number,
  localLow: number,
): Promise<void> {
  const { chatId, enabled } = await canSend("trailing_buy_level1_triggered");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();
  const nivelLabel = triggerLevel === 0 ? "Compra base" : `Compra de seguridad ${triggerLevel}`;
  const msg = [
    `🟡 <b>Rebote detectado — Trailing Buy</b> — <b>${pair}</b>`,
    ``,
    `Nivel: ${nivelLabel}`,
    `💵 Precio actual: <code>$${currentPrice.toFixed(2)}</code>`,
    `📉 Mínimo previo: <code>$${localLow.toFixed(2)}</code>`,
    `📈 Rebote detectado: <code>+${bouncePct.toFixed(3)}%</code>`,
    ``,
    `Rebote detectado — evaluando entrada. El bot comprobará los filtros antes de ejecutar.`,
    ``,
    `<i>Modo: ${mode}</i>`,
  ].join("\n");
  await send(chatId, msg, config.telegramThreadId || undefined);
}

// ─── Exit Management Alerts ─────────────────────────────────────────

export async function alertFailSafeTriggered(
  pair: string,
  mode: string,
  currentPrice: number,
  unrealizedPnlPct: number,
): Promise<void> {
  const { chatId, enabled } = await canSend("fail_safe_triggered");
  if (!enabled) return;

  const message = `🚨 *FAIL-SAFE TRIGGERED* ${pair}

💰 *Price*: $${currentPrice.toFixed(2)}
📉 *PnL*: ${unrealizedPnlPct.toFixed(2)}%
🛡️ *Protection*: Maximum loss exceeded

⚠️ *Emergency exit executed to prevent further losses*`;

  const config = await repo.getIdcaConfig();
  await send(chatId, message, config.telegramThreadId || undefined);
}

export async function alertTakeProfitReached(
  pair: string,
  mode: string,
  currentPrice: number,
  unrealizedPnlPct: number,
): Promise<void> {
  const { chatId, enabled } = await canSend("take_profit_reached");
  if (!enabled) return;

  const message = `🎯 *TAKE PROFIT REACHED* ${pair}

💰 *Price*: $${currentPrice.toFixed(2)}
📈 *PnL*: ${unrealizedPnlPct.toFixed(2)}%
✅ *Target achieved*

🎉 *Profit target successfully reached*`;

  const config = await repo.getIdcaConfig();
  await send(chatId, message, config.telegramThreadId || undefined);
}

export async function alertTrailingStopTriggered(
  pair: string,
  mode: string,
  currentPrice: number,
  unrealizedPnlPct: number,
): Promise<void> {
  const { chatId, enabled } = await canSend("trailing_stop_triggered");
  if (!enabled) return;

  const message = `📊 *TRAILING STOP TRIGGERED* ${pair}

💰 *Price*: $${currentPrice.toFixed(2)}
📈 *Peak PnL*: ${unrealizedPnlPct.toFixed(2)}%
📉 *Trailing activated*

✅ *Trailing stop captured profits at peak*`;

  const config = await repo.getIdcaConfig();
  await send(chatId, message, config.telegramThreadId || undefined);
}

export async function alertBreakEvenTriggered(
  pair: string,
  mode: string,
  currentPrice: number,
): Promise<void> {
  const { chatId, enabled } = await canSend("break_even_triggered");
  if (!enabled) return;

  const message = `🛡️ *BREAK-EVEN TRIGGERED* ${pair}

💰 *Price*: $${currentPrice.toFixed(2)}
🔄 *Protection*: Capital protected

✅ *Position closed at break-even point*`;

  const config = await repo.getIdcaConfig();
  await send(chatId, message, config.telegramThreadId || undefined);
}

// ─── Enhanced Diagnostics ───────────────────────────────────────────

export async function sendSystemDiagnostics(
  mode: string,
  diagnostics: {
    activeCycles: number;
    totalPnl: number;
    activeSystems: string[];
    warnings: string[];
    errors: string[];
    lastUpdate: Date;
  }
): Promise<void> {
  const { chatId, enabled } = await canSend("system_diagnostics");
  if (!enabled) return;

  const message = `📊 *IDCA SYSTEM DIAGNOSTICS* ${mode}

🔄 *Active Cycles*: ${diagnostics.activeCycles}
💰 *Total PnL*: ${diagnostics.totalPnl.toFixed(2)}%
⚙️ *Active Systems*: ${diagnostics.activeSystems.join(", ")}

⚠️ *Warnings*: ${diagnostics.warnings.length}
${diagnostics.warnings.slice(0, 3).map(w => `• ${w}`).join("\n")}

❌ *Errors*: ${diagnostics.errors.length}
${diagnostics.errors.slice(0, 3).map(e => `• ${e}`).join("\n")}

🕐 *Last Update*: ${diagnostics.lastUpdate.toLocaleString()}`;

  const config = await repo.getIdcaConfig();
  await send(chatId, message, config.telegramThreadId || undefined);
}

export async function sendLadderAtrpDiagnostics(
  pair: string,
  mode: string,
  ladderDiagnostics: {
    profile: string;
    intensity: number;
    levels: number;
    maxDrawdown: number;
    totalSize: number;
    active: boolean;
    warnings: string[];
  }
): Promise<void> {
  const { chatId, enabled } = await canSend("ladder_diagnostics");
  if (!enabled) return;

  const status = ladderDiagnostics.active ? "✅ Active" : "❌ Inactive";
  
  const message = `🪜 *LADDER ATRP DIAGNOSTICS* ${pair}

📊 *Status*: ${status}
🎯 *Profile*: ${ladderDiagnostics.profile}
📈 *Intensity*: ${ladderDiagnostics.intensity}%
📊 *Levels*: ${ladderDiagnostics.levels}
📉 *Max Drawdown*: ${ladderDiagnostics.maxDrawdown.toFixed(2)}%
💰 *Total Size*: ${ladderDiagnostics.totalSize.toFixed(2)}%

⚠️ *Warnings*: ${ladderDiagnostics.warnings.length}
${ladderDiagnostics.warnings.map(w => `• ${w}`).join("\n")}`;

  const config = await repo.getIdcaConfig();
  await send(chatId, message, config.telegramThreadId || undefined);
}

export async function sendMigrationStatus(
  pair: string,
  mode: string,
  migrationStatus: {
    activeSystem: string;
    safetyOrdersCount: number;
    ladderEnabled: boolean;
    lastMigration?: Date;
    validationStatus: string;
    recommendations: string[];
  }
): Promise<void> {
  const { chatId, enabled } = await canSend("migration_status");
  if (!enabled) return;

  const systemIcon = migrationStatus.activeSystem === "ladderAtrp" ? "🪜" : "📋";
  
  const message = `${systemIcon} *MIGRATION STATUS* ${pair}

🔄 *Active System*: ${migrationStatus.activeSystem}
📊 *Safety Orders*: ${migrationStatus.safetyOrdersCount}
🪜 *Ladder Enabled*: ${migrationStatus.ladderEnabled ? "✅" : "❌"}
✅ *Validation*: ${migrationStatus.validationStatus}

💡 *Recommendations*:
${migrationStatus.recommendations.map(r => `• ${r}`).join("\n")}

${migrationStatus.lastMigration ? `🕐 *Last Migration*: ${migrationStatus.lastMigration.toLocaleString()}` : ""}`;

  const config = await repo.getIdcaConfig();
  await send(chatId, message, config.telegramThreadId || undefined);
}

export async function sendExecutionReport(
  pair: string,
  mode: string,
  executionReport: {
    strategy: string;
    orderCount: number;
    totalQuantity: number;
    avgPrice: number;
    totalFees: number;
    slippage: number;
    executionTime: number;
    warnings: string[];
  }
): Promise<void> {
  const { chatId, enabled } = await canSend("execution_report");
  if (!enabled) return;

  const message = `⚡ *EXECUTION REPORT* ${pair}

🎯 *Strategy*: ${executionReport.strategy}
📊 *Orders*: ${executionReport.orderCount}
💰 *Quantity*: ${executionReport.totalQuantity.toFixed(8)}
📈 *Avg Price*: $${executionReport.avgPrice.toFixed(2)}
💸 *Fees*: $${executionReport.totalFees.toFixed(2)}
📉 *Slippage*: ${executionReport.slippage.toFixed(3)}%
⏱️ *Time*: ${executionReport.executionTime}ms

⚠️ *Warnings*: ${executionReport.warnings.length}
${executionReport.warnings.map(w => `• ${w}`).join("\n")}`;

  const config = await repo.getIdcaConfig();
  await send(chatId, message, config.telegramThreadId || undefined);
}

export async function sendExitStrategyReport(
  pair: string,
  mode: string,
  exitReport: {
    failSafeArmed: boolean;
    breakEvenArmed: boolean;
    trailingArmed: boolean;
    tpArmed: boolean;
    currentPnl: number;
    nearestTrigger: string;
    distanceToTrigger: number;
  }
): Promise<void> {
  const { chatId, enabled } = await canSend("exit_strategy_report");
  if (!enabled) return;

  const armedStatus = (armed: boolean) => armed ? "✅" : "❌";
  
  const message = `🛡️ *EXIT STRATEGY REPORT* ${pair}

📊 *Current PnL*: ${exitReport.currentPnl.toFixed(2)}%

🔒 *Protections*:
${armedStatus(exitReport.failSafeArmed)} Fail-Safe
${armedStatus(exitReport.breakEvenArmed)} Break-Even
${armedStatus(exitReport.trailingArmed)} Trailing
${armedStatus(exitReport.tpArmed)} Take Profit

🎯 *Nearest Trigger*: ${exitReport.nearestTrigger}
📏 *Distance*: ${exitReport.distanceToTrigger.toFixed(2)}%`;

  const config = await repo.getIdcaConfig();
  await send(chatId, message, config.telegramThreadId || undefined);
}

// ─── STG Validation ───────────────────────────────────────────────

export async function sendStgValidationReport(
  mode: string,
  validation: {
    overall: "passed" | "failed" | "warning";
    checks: Array<{
      name: string;
      status: "passed" | "failed" | "warning";
      message: string;
      details?: any;
    }>;
    summary: string;
    recommendations: string[];
  }
): Promise<void> {
  const { chatId, enabled } = await canSend("stg_validation");
  if (!enabled) return;

  const statusIcon = {
    passed: "✅",
    failed: "❌", 
    warning: "⚠️"
  }[validation.overall];

  const checksList = validation.checks.map(check => {
    const icon = {
      passed: "✅",
      failed: "❌",
      warning: "⚠️"
    }[check.status];
    return `${icon} ${check.name}: ${check.message}`;
  }).join("\n");

  const message = `${statusIcon} *STG VALIDATION REPORT* ${mode}

📊 *Overall Status*: ${validation.overall.toUpperCase()}

🔍 *Checks*:
${checksList}

📝 *Summary*: ${validation.summary}

💡 *Recommendations*:
${validation.recommendations.map(r => `• ${r}`).join("\n")}`;

  const config = await repo.getIdcaConfig();
  await send(chatId, message, config.telegramThreadId || undefined);
}

// ─── Real-time Market Context Alerts ───────────────────────────────

export async function sendMarketContextAlert(
  pair: string,
  mode: string,
  context: {
    vwapZone: string;
    atrPct: number;
    volatilityStatus: "low" | "normal" | "high";
    trendDirection: "bullish" | "bearish" | "neutral";
    dataQuality: "good" | "fair" | "poor";
    recommendations: string[];
  }
): Promise<void> {
  const { chatId, enabled } = await canSend("market_context_alert");
  if (!enabled) return;

  const volatilityIcon = {
    low: "🟢",
    normal: "🟡", 
    high: "🔴"
  }[context.volatilityStatus];

  const trendIcon = {
    bullish: "📈",
    bearish: "📉",
    neutral: "➡️"
  }[context.trendDirection];

  const qualityIcon = {
    good: "✅",
    fair: "⚠️",
    poor: "❌"
  }[context.dataQuality];

  const message = `📊 *MARKET CONTEXT ALERT* ${pair}

📍 *VWAP Zone*: ${context.vwapZone}
📈 *ATRP*: ${context.atrPct.toFixed(2)}%
${volatilityIcon} *Volatility*: ${context.volatilityStatus.toUpperCase()}
${trendIcon} *Trend*: ${context.trendDirection.toUpperCase()}
${qualityIcon} *Data Quality*: ${context.dataQuality.toUpperCase()}
${qualityIcon}💡 *Recommendations*:
${context.recommendations.map((r: string) => `• ${r}`).join("\n")}`;

  const config = await repo.getIdcaConfig();
  await send(chatId, message, config.telegramThreadId || undefined);
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
