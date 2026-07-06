/**
 * IdcaHybridAlertService — Telegram alert dispatcher for IDCA Hybrid.
 *
 * Delegates to IdcaTelegramNotifier (same telegram infrastructure).
 * Applies deduplication via existing telegram_alert_dedupe table (fingerprint lógico).
 * Only sends alerts on state CHANGES, not on every tick evaluation.
 *
 * State tracked in memory (per pair) — reset on restart (acceptable: alerts resume at next change).
 */

import { telegramService } from "../telegram";
import * as repo from "./IdcaRepository";
import type { HybridDecision } from "./IdcaHybridDecisionService";

export interface HybridAlertConfig {
  enabled: boolean;
  regimeChange: boolean;
  meanReversionAllowed: boolean;
  meanReversionBlocked: boolean;
  gridArmed: boolean;
  gridPaused: boolean;
  gridExecuted: boolean;
  dataQuality: boolean;
  dedupeMinutes: number;
  verbosity: "normal" | "verbose" | "minimal";
}

// ── In-memory last-sent state per pair ─────────────────────────────────────
const lastSentState = new Map<string, {
  regime: string;
  meanReversionState: string;
  gridState: string;
  sentAt: number;
}>();

async function dispatch(
  decision: HybridDecision,
  alertConfig: HybridAlertConfig
): Promise<void> {
  if (!alertConfig.enabled || decision.mode === "off") return;

  const pair = decision.pair;
  const regime = decision.regime?.regime ?? "unknown";
  const mrState = decision.meanReversion?.state ?? "neutral";
  const gridState = decision.grid?.gridState ?? "inactive";
  const dedupeMs = (alertConfig.dedupeMinutes ?? 15) * 60_000;
  const now = Date.now();

  const prev = lastSentState.get(pair);

  // ── Regime change alert ──────────────────────────────────────────────────
  if (alertConfig.regimeChange && prev && prev.regime !== regime &&
    now - prev.sentAt > dedupeMs) {
    await sendRegimeChangeAlert(pair, prev.regime, regime, decision, alertConfig.verbosity)
      .catch((e: Error) => console.warn(`[IDCA_HYBRID_ALERT] regimeChange failed: ${e.message}`));
  }

  // ── Mean Reversion alerts ────────────────────────────────────────────────
  if (prev && prev.meanReversionState !== mrState && now - prev.sentAt > dedupeMs) {
    if (alertConfig.meanReversionBlocked && mrState.startsWith("blocked_")) {
      await sendMeanReversionBlockedAlert(pair, mrState, decision, alertConfig.verbosity)
        .catch((e: Error) => console.warn(`[IDCA_HYBRID_ALERT] mrBlocked failed: ${e.message}`));
    } else if (alertConfig.meanReversionAllowed && mrState === "confirmed") {
      await sendMeanReversionConfirmedAlert(pair, decision, alertConfig.verbosity)
        .catch((e: Error) => console.warn(`[IDCA_HYBRID_ALERT] mrAllowed failed: ${e.message}`));
    }
  }

  // ── Grid state alerts ────────────────────────────────────────────────────
  if (prev && prev.gridState !== gridState && now - prev.sentAt > dedupeMs) {
    if (alertConfig.gridArmed && gridState === "armed") {
      await sendGridArmedAlert(pair, decision, alertConfig.verbosity)
        .catch((e: Error) => console.warn(`[IDCA_HYBRID_ALERT] gridArmed failed: ${e.message}`));
    } else if (alertConfig.gridPaused && gridState.startsWith("paused_")) {
      await sendGridPausedAlert(pair, gridState, decision, alertConfig.verbosity)
        .catch((e: Error) => console.warn(`[IDCA_HYBRID_ALERT] gridPaused failed: ${e.message}`));
    }
  }

  // Update last-sent state
  lastSentState.set(pair, {
    regime,
    meanReversionState: mrState,
    gridState,
    sentAt: prev?.sentAt ?? now,
  });

  // Only update sentAt when we actually sent something
  // (The prev.sentAt check above uses the old timestamp, so new sends update it)
  if (!prev) {
    lastSentState.set(pair, { regime, meanReversionState: mrState, gridState, sentAt: now });
  }
}

async function sendRegimeChangeAlert(
  pair: string,
  prevRegime: string,
  newRegime: string,
  decision: HybridDecision,
  verbosity: string
): Promise<void> {
  const emoji = newRegime === "lateral" ? "↔️" : newRegime === "bullish" ? "🟢" : newRegime === "bearish" ? "🔴" : "⚡";
  const lines = [
    `${emoji} <b>IDCA Híbrido — Cambio de Régimen</b>`,
    ``,
    `Par: <b>${pair}</b>`,
    `Régimen anterior: ${prevRegime}`,
    `Régimen nuevo: <b>${newRegime}</b>`,
  ];
  if (verbosity !== "minimal") {
    lines.push(``, `${decision.naturalReason}`);
    if (decision.regime?.atrPct) lines.push(`ATRP: ${decision.regime.atrPct.toFixed(2)}%`);
    if (decision.regime?.zScore != null) lines.push(`Z-Score: ${decision.regime.zScore.toFixed(2)}`);
  }
  lines.push(``, `Modo: ${decision.mode.toUpperCase()}`);
  await sendTelegram(lines.join("\n"));
}

async function sendMeanReversionBlockedAlert(
  pair: string,
  state: string,
  decision: HybridDecision,
  verbosity: string
): Promise<void> {
  const lines = [
    `🚫 <b>IDCA Híbrido — Compra bloqueada por Reversión a la Media</b>`,
    ``,
    `Par: <b>${pair}</b>`,
    `Razón: ${decision.meanReversion?.reason ?? state}`,
  ];
  if (verbosity !== "minimal") {
    lines.push(``, decision.meanReversion?.naturalReason ?? "");
  }
  lines.push(``, `Modo: ${decision.mode.toUpperCase()}`);
  if (decision.mode === "observer") lines.push(`⚠️ Modo observador: la compra NO se bloquea en producción.`);
  await sendTelegram(lines.join("\n"));
}

async function sendMeanReversionConfirmedAlert(
  pair: string,
  decision: HybridDecision,
  verbosity: string
): Promise<void> {
  const lines = [
    `✅ <b>IDCA Híbrido — Reversión a la Media confirmada</b>`,
    ``,
    `Par: <b>${pair}</b>`,
  ];
  if (verbosity !== "minimal" && decision.meanReversion) {
    lines.push(``, decision.meanReversion.naturalReason);
    if (decision.regime?.zScore !== null) lines.push(`Z-Score: ${decision.regime?.zScore?.toFixed(2)}`);
    lines.push(`Score: ${decision.meanReversion.score}/100`);
  }
  lines.push(``, `Modo: ${decision.mode.toUpperCase()}`);
  await sendTelegram(lines.join("\n"));
}

async function sendGridArmedAlert(
  pair: string,
  decision: HybridDecision,
  verbosity: string
): Promise<void> {
  const grid = decision.grid;
  const lines = [
    `📐 <b>IDCA Híbrido — Grid armado</b>`,
    ``,
    `Par: <b>${pair}</b>`,
    `Estado: ${grid?.gridState}`,
    `Niveles: ${grid?.levelsCount} × ${grid?.atrSpacingPct?.toFixed(2)}% spacing`,
    `Capital: $${grid?.capitalBudget?.toFixed(2)}`,
  ];
  if (verbosity !== "minimal") lines.push(``, grid?.naturalReason ?? "");
  if (grid?.levels[0]?.observerOnly) lines.push(``, `🔬 Solo observador — sin órdenes reales.`);
  await sendTelegram(lines.join("\n"));
}

async function sendGridPausedAlert(
  pair: string,
  gridState: string,
  decision: HybridDecision,
  verbosity: string
): Promise<void> {
  const lines = [
    `⏸️ <b>IDCA Híbrido — Grid pausado</b>`,
    ``,
    `Par: <b>${pair}</b>`,
    `Razón: ${gridState}`,
  ];
  if (verbosity !== "minimal") lines.push(``, decision.grid?.naturalReason ?? "");
  await sendTelegram(lines.join("\n"));
}

// FASE J: routed through TelegramNotificationCenter for kill switch + audit trail.
async function sendTelegram(message: string): Promise<void> {
  try {
    const config = await repo.getIdcaConfig();
    const chatId = config?.telegramChatId;
    if (!chatId) return;

    const { telegramNotificationCenter } = await import("../TelegramNotificationCenter");
    const status = await telegramNotificationCenter.sendToSpecificChat(chatId, {
      sourceModule: "IDCA_HYBRID",
      mode: "idca_hybrid",
      alertType: "idca_hybrid_alert",
      message,
      severity: "LOW",
      skipDedupe: true,
      skipRateLimit: true,
    });
    if (status !== "sent") {
      console.log(`[IDCA_HYBRID_ALERT] Not sent: status=${status}`);
    }
  } catch (e: any) {
    console.warn(`[IDCA_HYBRID_ALERT] sendTelegram failed: ${e?.message}`);
  }
}

export const idcaHybridAlertService = { dispatch };
