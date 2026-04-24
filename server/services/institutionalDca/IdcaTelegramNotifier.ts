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
  zone: string
): Promise<void> {
  // Long cooldown check first — avoid polluting canSend timer
  const lastTime = lastApproachingBuyAlert.get(pair) || 0;
  if (Date.now() - lastTime < APPROACHING_BUY_COOLDOWN_MS) return;

  const { chatId, enabled } = await canSend("vwap_approaching_buy");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  lastApproachingBuyAlert.set(pair, Date.now());

  const msg = [
    `⚡ <b>Precio cerca de zona de compra</b> — <b>${pair}</b>`,
    ``,
    `📊 Precio actual: <b>$${currentPrice.toFixed(2)}</b>`,
    `🎯 Precio de entrada: $${buyTriggerPrice.toFixed(2)} (falta ${distToBuyPct.toFixed(2)}% más)`,
    `📍 Zona VWAP: ${zone}`,
    ``,
    `Aviso previo — el bot ejecutará la compra cuando se confirme el rebote.`,
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

export async function alertTrailingBuyArmed(
  pair: string,
  mode: string,
  currentPrice: number,
  zone: string,
  lowerBand1: number
): Promise<void> {
  const { chatId, enabled } = await canSend("trailing_buy_armed");
  if (!enabled) return;
  const config = await repo.getIdcaConfig();

  const msg = [
    `🔵 <b>Trailing Buy armado</b> — <b>${pair}</b>`,
    ``,
    `📊 Precio actual: $${currentPrice.toFixed(2)}`,
    `📍 Zona VWAP: ${zone}`,
    `🎯 Precio de referencia de entrada: $${lowerBand1.toFixed(2)}`,
    ``,
    `El precio está en zona de interés. El bot espera rebote para ejecutar compra óptima.`,
    ``,
    `<i>Modo: ${mode} | Fuente: VWAP Anclado</i>`,
  ].join("\n");

  await send(chatId, msg, config.telegramThreadId || undefined);
}

export async function alertTrailingBuyTriggered(
  pair: string,
  mode: string,
  currentPrice: number,
  bouncePct: number,
  localLow: number,
): Promise<void> {
  const { chatId, enabled } = await canSend("trailing_buy_triggered");
  if (!enabled) return;

  const config = await repo.getIdcaConfig();
  const message = `🔄 *TRAILING BUY TRIGGERED* ${pair}

💰 *Price*: $${currentPrice.toFixed(2)}
📈 *Bounce*: ${bouncePct.toFixed(3)}%
📍 *Local Low*: $${localLow.toFixed(2)}

🎯 *Entry executed at optimal bounce price*`;

  await send(chatId, message, config.telegramThreadId || undefined);
}

// ─── Trailing Buy Level 1 Alerts ───────────────────────────────────────

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

  const message = `🎯 *TRAILING BUY LEVEL 1 ACTIVATED* ${pair}

📍 *Level*: ${triggerLevel === 0 ? 'Base Buy' : `Safety ${triggerLevel}`}
💰 *Trigger Price*: $${triggerPrice.toFixed(2)}
📊 *Current Price*: $${currentPrice.toFixed(2)}
⚙️ *Mode*: ${trailingMode}
📈 *Value*: ${trailingValue}${trailingMode === 'rebound_pct' ? '%' : ' ATRP'}

🔍 *Waiting for bounce to execute entry*`;

  const config = await repo.getIdcaConfig();
  await send(chatId, message, config.telegramThreadId || undefined);
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

  const message = `🚀 *TRAILING BUY LEVEL 1 TRIGGERED* ${pair}

📍 *Level*: ${triggerLevel === 0 ? 'Base Buy' : `Safety ${triggerLevel}`}
💰 *Price*: $${currentPrice.toFixed(2)}
📈 *Bounce*: ${bouncePct.toFixed(3)}%
📍 *Local Low*: $${localLow.toFixed(2)}

✅ *Entry executed at level ${triggerLevel} optimal price*`;

  const config = await repo.getIdcaConfig();
  await send(chatId, message, config.telegramThreadId || undefined);
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
