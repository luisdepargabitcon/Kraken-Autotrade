/**
 * TradeSnapshotService — Phase 3 & 4
 *
 * Non-blocking snapshot hooks for BOT SPOT entries/exits and IDCA cycle events.
 * ALL public methods fire-and-forget. They NEVER throw to callers.
 * Source isolation: REAL, DRY_RUN, SHADOW, IDCA_SIMULATION are independent data streams.
 */

import { storage } from "../storage";
import type { InsertTradeSnapshot } from "@shared/schema";

const EVIDENCE_WEIGHTS: Record<string, string> = {
  REAL:            "1.000",
  DRY_RUN:         "0.500",
  SHADOW:          "0.300",
  IDCA_SIMULATION: "0.400",
};

function evidenceWeight(mode: string): string {
  return EVIDENCE_WEIGHTS[mode] ?? "1.000";
}

function sessionLabel(ts?: Date): string {
  const h = (ts ?? new Date()).getUTCHours();
  if (h >= 0  && h < 8)  return "ASIA";
  if (h >= 8  && h < 14) return "EU";
  return "USA";
}

export interface BotSpotEntryContext {
  sourceMode:      "REAL" | "DRY_RUN" | "SHADOW";
  sourceTradeId:   string;   // lotId / simTxid
  sourceTable:     string;   // "open_positions" | "dry_run_trades"
  pair:            string;
  entryTs:         Date;
  entryPrice:      number;
  executedAmount:  number;
  entryFeeUsd:     number;
  signalScore?:    number;
  spreadPct?:      number;
  regime?:         string;
  ema10?:          number;
  ema20?:          number;
  atrPct?:         number;
  rsi14?:          number;
  macdHist?:       number;
  volumeRatio?:    number;
  capitalAvailableUsd?: number;
  totalExposureUsd?:    number;
  pairExposureUsd?:     number;
  configSnapshot?:      Record<string, unknown>;
  entryRulesMet?:       string[];
  entryRulesBlocked?:   string[];
}

export interface BotSpotExitContext {
  sourceMode:    "REAL" | "DRY_RUN" | "SHADOW";
  sourceTradeId: string;
  exitTs:        Date;
  exitPrice:     number;
  exitFeeUsd?:   number;
  exitReason?:   string;
  pnlGrossUsd?:  number;
  pnlNetUsd?:    number;
  pnlPct?:       number;
  holdTimeMinutes?: number;
}

export interface IdcaCycleContext {
  sourceMode:    "IDCA_SIMULATION" | "REAL";
  cycleId:       string;
  snapshotType:  "CYCLE_START" | "BASE_BUY" | "SAFETY_BUY" | "TP" | "TRAILING_ACTIVATED" | "BREAKEVEN_ARMED" | "TRAILING_EXIT" | "BREAKEVEN_EXIT" | "FAIL_SAFE_EXIT" | "CYCLE_CLOSED";
  pair:          string;
  eventTs:       Date;
  entryPrice?:   number;
  exitPrice?:    number;
  executedAmount?: number;
  pnlNetUsd?:    number;
  pnlPct?:       number;
  regime?:       string;
  signalScore?:  number;
  holdTimeMinutes?: number;
  exitReason?:   string;
}

class TradeSnapshotService {
  private static instance: TradeSnapshotService;

  static getInstance(): TradeSnapshotService {
    if (!TradeSnapshotService.instance) {
      TradeSnapshotService.instance = new TradeSnapshotService();
    }
    return TradeSnapshotService.instance;
  }

  onBotSpotEntry(ctx: BotSpotEntryContext): void {
    this._saveEntry(ctx).catch(e =>
      console.warn(`[snapshot] entry hook failed (non-critical): ${e?.message}`)
    );
  }

  onBotSpotExit(ctx: BotSpotExitContext): void {
    this._saveExit(ctx).catch(e =>
      console.warn(`[snapshot] exit hook failed (non-critical): ${e?.message}`)
    );
  }

  onIdcaEvent(ctx: IdcaCycleContext): void {
    this._saveIdcaEvent(ctx).catch(e =>
      console.warn(`[snapshot] idca hook failed (non-critical): ${e?.message}`)
    );
  }

  private async _saveEntry(ctx: BotSpotEntryContext): Promise<void> {
    const snap: InsertTradeSnapshot = {
      sourceMode:          ctx.sourceMode,
      strategyType:        "BOT_SPOT",
      sourceTradeId:       ctx.sourceTradeId,
      sourceTable:         ctx.sourceTable,
      snapshotType:        "ENTRY",
      evidenceWeight:      evidenceWeight(ctx.sourceMode),
      pair:                ctx.pair,
      entryTsUtc:          ctx.entryTs,
      sessionLabel:        sessionLabel(ctx.entryTs),
      entryPrice:          ctx.entryPrice.toFixed(8),
      executedAmount:      ctx.executedAmount.toFixed(8),
      entryFeeUsd:         ctx.entryFeeUsd.toFixed(8),
      signalScore:         ctx.signalScore != null ? ctx.signalScore.toFixed(3) : undefined,
      spreadPct:           ctx.spreadPct   != null ? ctx.spreadPct.toFixed(4)   : undefined,
      regime:              ctx.regime,
      ema10:               ctx.ema10     != null ? ctx.ema10.toFixed(8)     : undefined,
      ema20:               ctx.ema20     != null ? ctx.ema20.toFixed(8)     : undefined,
      atrPct:              ctx.atrPct    != null ? ctx.atrPct.toFixed(4)    : undefined,
      rsi14:               ctx.rsi14     != null ? ctx.rsi14.toFixed(2)     : undefined,
      macdHist:            ctx.macdHist  != null ? ctx.macdHist.toFixed(8)  : undefined,
      volumeRatio:         ctx.volumeRatio != null ? ctx.volumeRatio.toFixed(4) : undefined,
      capitalAvailableUsd: ctx.capitalAvailableUsd != null ? ctx.capitalAvailableUsd.toFixed(2) : undefined,
      totalExposureUsd:    ctx.totalExposureUsd    != null ? ctx.totalExposureUsd.toFixed(2)    : undefined,
      pairExposureUsd:     ctx.pairExposureUsd     != null ? ctx.pairExposureUsd.toFixed(2)     : undefined,
      configSnapshotJson:  ctx.configSnapshot  ?? null,
      entryRulesMetJson:   ctx.entryRulesMet   ? { rules: ctx.entryRulesMet }   : null,
      entryRulesBlockedJson: ctx.entryRulesBlocked ? { rules: ctx.entryRulesBlocked } : null,
    };
    await storage.saveTradeSnapshot(snap);
  }

  private async _saveExit(ctx: BotSpotExitContext): Promise<void> {
    const TIME_STOP_REASONS = new Set([
      'TIME_STOP', 'SMART_TIME_STOP', 'MAX_HOLD_TIME', 'time_stop',
      'TIME_STOP_SOFT', 'time_stop_soft',
    ]);
    const wasTimeStop = ctx.exitReason ? TIME_STOP_REASONS.has(ctx.exitReason) : false;
    const exitCategory = this._classifyExitReason(ctx.exitReason);

    const snap: InsertTradeSnapshot = {
      sourceMode:       ctx.sourceMode,
      strategyType:     "BOT_SPOT",
      sourceTradeId:    ctx.sourceTradeId,
      sourceTable:      "open_positions",
      snapshotType:     "EXIT",
      evidenceWeight:   evidenceWeight(ctx.sourceMode),
      pair:             "",    // Will be filled from ENTRY record if available
      exitTsUtc:        ctx.exitTs,
      exitPrice:        ctx.exitPrice.toFixed(8),
      exitFeeUsd:       ctx.exitFeeUsd     != null ? ctx.exitFeeUsd.toFixed(8)     : undefined,
      exitReason:       ctx.exitReason,
      exitCategory,
      wasTimeStop,
      pnlGrossUsd:      ctx.pnlGrossUsd    != null ? ctx.pnlGrossUsd.toFixed(8)    : undefined,
      pnlNetUsd:        ctx.pnlNetUsd      != null ? ctx.pnlNetUsd.toFixed(8)      : undefined,
      pnlPct:           ctx.pnlPct         != null ? ctx.pnlPct.toFixed(4)         : undefined,
      holdTimeMinutes:  ctx.holdTimeMinutes ?? null,
    };

    // Enrich pair from existing ENTRY snapshot if available
    try {
      const existing = await storage.getTradeSnapshotsBySource(ctx.sourceTradeId, ctx.sourceMode);
      const entry = existing.find(s => s.snapshotType === "ENTRY");
      if (entry) snap.pair = entry.pair;
    } catch (_) {}

    if (!snap.pair) snap.pair = "UNKNOWN";
    await storage.saveTradeSnapshot(snap);
  }

  private async _saveIdcaEvent(ctx: IdcaCycleContext): Promise<void> {
    const wasTimeStop   = ctx.exitReason ? ctx.exitReason.includes('TIME_STOP') : false;
    const exitCategory  = this._classifyExitReason(ctx.exitReason);

    const snap: InsertTradeSnapshot = {
      sourceMode:       ctx.sourceMode,
      strategyType:     "IDCA",
      sourceTradeId:    ctx.cycleId,
      sourceTable:      "institutional_dca_cycles",
      snapshotType:     ctx.snapshotType,
      evidenceWeight:   evidenceWeight(ctx.sourceMode),
      pair:             ctx.pair,
      entryTsUtc:       ctx.snapshotType === "CYCLE_START" ? ctx.eventTs : undefined,
      exitTsUtc:        ctx.snapshotType === "CYCLE_CLOSED" ? ctx.eventTs : undefined,
      sessionLabel:     sessionLabel(ctx.eventTs),
      entryPrice:       ctx.entryPrice  != null ? ctx.entryPrice.toFixed(8)  : undefined,
      exitPrice:        ctx.exitPrice   != null ? ctx.exitPrice.toFixed(8)   : undefined,
      executedAmount:   ctx.executedAmount != null ? ctx.executedAmount.toFixed(8) : undefined,
      regime:           ctx.regime,
      signalScore:      ctx.signalScore  != null ? ctx.signalScore.toFixed(3)  : undefined,
      pnlNetUsd:        ctx.pnlNetUsd    != null ? ctx.pnlNetUsd.toFixed(8)    : undefined,
      pnlPct:           ctx.pnlPct       != null ? ctx.pnlPct.toFixed(4)       : undefined,
      holdTimeMinutes:  ctx.holdTimeMinutes ?? null,
      exitReason:       ctx.exitReason,
      exitCategory,
      wasTimeStop,
    };
    await storage.saveTradeSnapshot(snap);
  }

  private _classifyExitReason(reason?: string): string {
    if (!reason) return "UNKNOWN";
    const r = reason.toUpperCase();
    if (r.includes("TIME") || r.includes("HOLD")) return "TIME_BASED_EXIT";
    if (r === "TRAILING_STOP" || r === "TRAILING") return "TRAILING_EXIT";
    if (r === "TAKE_PROFIT" || r === "SCALE_OUT" || r === "BREAK_EVEN") return "PROFIT_EXIT";
    if (r === "STOP_LOSS" || r === "EMERGENCY_SL") return "RISK_EXIT";
    if (r === "SMART_EXIT") return "SMART_EXIT";
    return "UNKNOWN";
  }
}

export const tradeSnapshotService = TradeSnapshotService.getInstance();
