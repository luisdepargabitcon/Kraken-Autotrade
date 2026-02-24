/**
 * SpreadFilter — Spread gating logic for BUY decisions.
 * Extracted from TradingEngine for modularity.
 */

import { log } from "../utils/logger";
import { botLogger } from "./botLogger";
import { markupTracker } from "./MarkupTracker";

// === Pure functions ===

export function calculateSpreadPct(bid: number, ask: number): number {
  if (bid <= 0 || ask <= 0) return -1; // -1 signals invalid data
  const midPrice = (bid + ask) / 2;
  return ((ask - bid) / midPrice) * 100;
}

export function getSpreadThresholdForRegime(regime: string | null, config: any): number {
  if (!(config?.spreadDynamicEnabled ?? true)) {
    return parseFloat(config?.spreadMaxPct?.toString() || "2.00");
  }
  const thresholds: Record<string, string> = {
    TREND: config?.spreadThresholdTrend?.toString() || "1.50",
    RANGE: config?.spreadThresholdRange?.toString() || "2.00",
    TRANSITION: config?.spreadThresholdTransition?.toString() || "2.50",
  };
  const capPct = parseFloat(config?.spreadCapPct?.toString() || "3.50");
  const raw = parseFloat(thresholds[regime || ""] || config?.spreadMaxPct?.toString() || "2.00");
  return Math.min(raw, capPct);
}

// === Result type ===

export interface SpreadCheckDetails {
  bid: number; ask: number; mid: number;
  spreadKrakenPct: number; spreadEffectivePct: number;
  thresholdPct: number; floorPct: number; capPct: number;
  revolutxMarkupPct: number;
  markupSource: "dynamic" | "fixed" | "none";
  markupSamples: number;
  markupEma: number;
  tradingExchange: string; dataExchange: string;
  decision: "ALLOW" | "REJECT" | "SKIP_MISSING_DATA";
  reason: string;
}

export interface SpreadCheckResult {
  ok: boolean;
  details: SpreadCheckDetails;
}

// === Host interface ===

export interface ISpreadFilterHost {
  getTradingExchangeType(): string;
  getDataExchangeType(): string;
  sendAlertWithSubtype(message: string, alertType: any, subtype: any): Promise<void>;
  isTelegramInitialized(): boolean;
}

// === SpreadFilter class ===

export class SpreadFilter {
  private host: ISpreadFilterHost;
  private spreadAlertCooldowns: Map<string, number> = new Map();

  constructor(host: ISpreadFilterHost) {
    this.host = host;
  }

  async checkSpreadForBuy(
    pair: string,
    ticker: { bid: number; ask: number; last: number },
    regime: string | null,
    config: any,
  ): Promise<SpreadCheckResult> {
    const tradingExchange = this.host.getTradingExchangeType();
    const dataExchange = this.host.getDataExchangeType();
    const filterEnabled = config?.spreadFilterEnabled ?? true;

    if (!filterEnabled) {
      return { ok: true, details: {
        bid: ticker.bid, ask: ticker.ask, mid: (ticker.bid + ticker.ask) / 2,
        spreadKrakenPct: 0, spreadEffectivePct: 0,
        thresholdPct: 0, floorPct: 0, capPct: 0, revolutxMarkupPct: 0,
        markupSource: "none", markupSamples: 0, markupEma: 0,
        tradingExchange, dataExchange,
        decision: "ALLOW", reason: "Spread filter disabled in config",
      }};
    }

    const bid = ticker.bid;
    const ask = ticker.ask;
    const spreadKrakenPct = calculateSpreadPct(bid, ask);

    // Fail-safe: if bid/ask data is invalid, do NOT trade
    if (spreadKrakenPct < 0 || bid <= 0 || ask <= 0) {
      log(`[SPREAD_DATA_MISSING] ${pair}: bid=${bid} ask=${ask} - fail-safe: skip BUY`, "trading");
      await botLogger.warn("SPREAD_DATA_MISSING", `Datos de spread no disponibles para ${pair}`, {
        pair, bid, ask, tradingExchange, dataExchange,
      });
      return { ok: false, details: {
        bid, ask, mid: 0,
        spreadKrakenPct: 0, spreadEffectivePct: 0,
        thresholdPct: 0, floorPct: 0, capPct: 0, revolutxMarkupPct: 0,
        markupSource: "none", markupSamples: 0, markupEma: 0,
        tradingExchange, dataExchange,
        decision: "SKIP_MISSING_DATA", reason: "bid/ask data invalid or missing",
      }};
    }

    const mid = (bid + ask) / 2;
    const fixedMarkupPct = tradingExchange === "revolutx"
      ? parseFloat(config?.spreadRevolutxMarkupPct?.toString() || "0.80")
      : 0;

    // D2: Use dynamic markup from MarkupTracker when enabled
    const dynamicMarkupEnabled = config?.dynamicMarkupEnabled ?? true;
    let revolutxMarkupPct: number;
    let markupSource: "dynamic" | "fixed" | "none";
    let markupSamples = 0;
    let markupEma = 0;

    if (tradingExchange === "revolutx" && dynamicMarkupEnabled) {
      const dynamic = markupTracker.getDynamicMarkupPct(pair, fixedMarkupPct);
      revolutxMarkupPct = dynamic.markupPct;
      markupSource = dynamic.source;
      markupSamples = dynamic.samples;
      markupEma = dynamic.ema;
    } else if (tradingExchange === "revolutx") {
      revolutxMarkupPct = fixedMarkupPct;
      markupSource = "fixed";
    } else {
      revolutxMarkupPct = 0;
      markupSource = "none";
    }

    const spreadEffectivePct = spreadKrakenPct + revolutxMarkupPct;
    const floorPct = parseFloat(config?.spreadFloorPct?.toString() || "0.30");
    const capPct = parseFloat(config?.spreadCapPct?.toString() || "3.50");
    const thresholdPct = getSpreadThresholdForRegime(regime, config);

    // FLOOR: if effective spread < floor, always allow (micro-noise)
    if (spreadEffectivePct < floorPct) {
      return { ok: true, details: {
        bid, ask, mid, spreadKrakenPct, spreadEffectivePct,
        thresholdPct, floorPct, capPct, revolutxMarkupPct,
        markupSource, markupSamples, markupEma,
        tradingExchange, dataExchange,
        decision: "ALLOW", reason: `Spread ${spreadEffectivePct.toFixed(3)}% < floor ${floorPct}%`,
      }};
    }

    // Decision: block if effective spread > threshold
    const blocked = spreadEffectivePct > thresholdPct;
    const decision = blocked ? "REJECT" as const : "ALLOW" as const;
    const reason = blocked
      ? `Spread ${spreadEffectivePct.toFixed(3)}% > threshold ${thresholdPct.toFixed(2)}% (regime=${regime || "NONE"})`
      : `Spread ${spreadEffectivePct.toFixed(3)}% <= threshold ${thresholdPct.toFixed(2)}%`;

    // If blocked, emit structured log + optional Telegram alert
    if (blocked) {
      const logPayload = {
        event: "SPREAD_REJECTED",
        pair, regime: regime || "NONE",
        tradingExchange, dataExchange,
        bid, ask, mid,
        spreadKrakenPct: parseFloat(spreadKrakenPct.toFixed(4)),
        revolutxMarkupPct,
        spreadEffectivePct: parseFloat(spreadEffectivePct.toFixed(4)),
        thresholdPct, capPct, floorPct,
        decision: "REJECT",
        reason: "SPREAD_TOO_HIGH",
      };
      await botLogger.info("SPREAD_REJECTED", `BUY bloqueada por spread: ${pair}`, logPayload);

      // Telegram alert (best-effort + anti-spam)
      await this.sendSpreadTelegramAlert(pair, regime, tradingExchange, config, {
        spreadEffectivePct, thresholdPct, spreadKrakenPct, revolutxMarkupPct, bid, ask, mid,
      });
    }

    return { ok: !blocked, details: {
      bid, ask, mid, spreadKrakenPct, spreadEffectivePct,
      thresholdPct, floorPct, capPct, revolutxMarkupPct,
      markupSource, markupSamples, markupEma,
      tradingExchange, dataExchange, decision, reason,
    }};
  }

  private async sendSpreadTelegramAlert(
    pair: string,
    regime: string | null,
    tradingExchange: string,
    config: any,
    data: { spreadEffectivePct: number; thresholdPct: number; spreadKrakenPct: number; revolutxMarkupPct: number; bid: number; ask: number; mid: number },
  ): Promise<void> {
    try {
      const alertEnabled = config?.spreadTelegramAlertEnabled ?? true;
      if (!alertEnabled || !this.host.isTelegramInitialized()) return;

      // Anti-spam cooldown per (pair + tradingExchange)
      const cooldownMs = config?.spreadTelegramCooldownMs ?? 600000;
      const cooldownKey = `spread_${pair}_${tradingExchange}`;
      const lastAlert = this.spreadAlertCooldowns.get(cooldownKey) || 0;
      if (Date.now() - lastAlert < cooldownMs) return;

      this.spreadAlertCooldowns.set(cooldownKey, Date.now());

      const isRevolutx = tradingExchange === "revolutx";
      const markupLine = isRevolutx
        ? `   Markup RevolutX: <code>+${data.revolutxMarkupPct.toFixed(2)}%</code>\n`
        : "";

      const message = `\u{1F916} <b>KRAKEN BOT</b> \u{1F1EA}\u{1F1F8}
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F6AB} <b>BUY bloqueada por spread</b>

\u{1F4CA} <b>Detalle:</b>
   Par: <code>${pair}</code>
   Exchange: <code>${tradingExchange}</code>
   R\u00e9gimen: <code>${regime || "N/A"}</code>

   Spread Kraken: <code>${data.spreadKrakenPct.toFixed(3)}%</code>
${markupLine}   Spread Efectivo: <code>${data.spreadEffectivePct.toFixed(3)}%</code>
   Umbral m\u00e1ximo: <code>${data.thresholdPct.toFixed(2)}%</code>

   Bid: <code>$${data.bid.toFixed(2)}</code> | Ask: <code>$${data.ask.toFixed(2)}</code>

\u{23F0} ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`;

      await this.host.sendAlertWithSubtype(message, "trades", "trade_spread_rejected");
    } catch (err: any) {
      log(`[SPREAD_ALERT_ERR] Telegram send failed (best-effort): ${err.message}`, "trading");
    }
  }
}
