/**
 * ShadowExecutor — Phase 9
 *
 * Mirrors trading logic decisions WITHOUT placing real orders or modifying live data.
 * Writes SHADOW records to:
 *   - training_trades (source_mode='SHADOW', evidence_weight=0.30)
 *   - trade_snapshots (source_mode='SHADOW')
 *
 * Guarantees:
 *   - NEVER calls any exchange API
 *   - NEVER writes to: trades, open_positions, dry_run_trades, or any FISCO table
 *   - NEVER modifies existing records outside shadow tables
 *   - NEVER throws to callers (all errors are caught + logged)
 */

import { randomUUID } from "crypto";
import { db } from "../../db";
import { trainingTrades as trainingTradesTable } from "@shared/schema";
import { tradeSnapshotService } from "../TradeSnapshotService";
import type { ITradeExecutor, TradeIntent, TradeResult } from "./ITradeExecutor";

const SHADOW_FEE_RATE     = 0.004;    // 0.4% Kraken simulated fee
const SHADOW_SLIPPAGE_PCT = 0.001;    // 0.1% simulated slippage
const EVIDENCE_WEIGHT     = "0.300";

// In-memory store for open shadow positions (not persisted, cleared on restart)
interface ShadowOpenLot {
  lotId:       string;
  pair:        string;
  entryPrice:  number;
  entryAmount: number;
  entryTs:     Date;
  entryFeeUsd: number;
  signalScore?: number;
  regime?:      string;
}

class ShadowExecutor implements ITradeExecutor {
  readonly mode = "SHADOW" as const;
  private openLots: Map<string, ShadowOpenLot> = new Map();

  async executeBuy(intent: TradeIntent): Promise<TradeResult> {
    const simulatedId = `SHADOW-BUY-${Date.now()}-${randomUUID().slice(0, 8)}`;
    try {
      const slippage    = intent.price * (1 + SHADOW_SLIPPAGE_PCT);
      const execPrice   = slippage;
      const execAmount  = intent.amountUsd / execPrice;
      const feeUsd      = intent.amountUsd * SHADOW_FEE_RATE;

      const lot: ShadowOpenLot = {
        lotId:       simulatedId,
        pair:        intent.pair,
        entryPrice:  execPrice,
        entryAmount: execAmount,
        entryTs:     new Date(),
        entryFeeUsd: feeUsd,
        signalScore: intent.signalScore,
        regime:      intent.regime,
      };
      this.openLots.set(simulatedId, lot);

      // Snapshot entry
      tradeSnapshotService.onBotSpotEntry({
        sourceMode:    "SHADOW",
        sourceTradeId: simulatedId,
        sourceTable:   "shadow",
        pair:          intent.pair,
        entryTs:       new Date(),
        entryPrice:    execPrice,
        executedAmount: execAmount,
        entryFeeUsd:   feeUsd,
        signalScore:   intent.signalScore,
        regime:        intent.regime,
        configSnapshot: intent.configSnapshot,
        ...this._extractIndicators(intent.indicators),
      });

      return { success: true, mode: "SHADOW", simulatedId, pair: intent.pair, side: "buy", executedPrice: execPrice, executedAmount: execAmount, feeUsd };
    } catch (e: any) {
      console.error(`[shadow-executor] executeBuy error: ${e?.message}`);
      return { success: false, mode: "SHADOW", simulatedId, pair: intent.pair, side: "buy", executedPrice: 0, executedAmount: 0, feeUsd: 0, errorMessage: e?.message };
    }
  }

  async executeSell(intent: TradeIntent, entryContext?: { entryPrice: number; entryTs: Date; lotId: string }): Promise<TradeResult> {
    const simulatedId = `SHADOW-SELL-${Date.now()}-${randomUUID().slice(0, 8)}`;
    try {
      const slippage   = intent.price * (1 - SHADOW_SLIPPAGE_PCT);
      const execPrice  = slippage;
      const lot        = entryContext?.lotId ? this.openLots.get(entryContext.lotId) : undefined;
      const entryPrice = entryContext?.entryPrice ?? lot?.entryPrice ?? execPrice;
      const entryTs    = entryContext?.entryTs ?? lot?.entryTs ?? new Date(Date.now() - 3600_000);
      const execAmount = lot?.entryAmount ?? (intent.amountUsd / execPrice);
      const exitFeeUsd = execPrice * execAmount * SHADOW_FEE_RATE;
      const entryFeeUsd = lot?.entryFeeUsd ?? (entryPrice * execAmount * SHADOW_FEE_RATE);

      const revenueUsd  = execPrice * execAmount;
      const costUsd     = entryPrice * execAmount;
      const pnlGross    = revenueUsd - costUsd;
      const pnlNet      = pnlGross - entryFeeUsd - exitFeeUsd;
      const pnlPct      = (pnlNet / costUsd) * 100;
      const holdMin     = Math.max(0, Math.round((Date.now() - entryTs.getTime()) / 60000));

      if (lot) this.openLots.delete(lot.lotId);

      // Persist shadow training trade
      const buyTxid = lot?.lotId ?? `SHADOW-BUY-ref-${intent.lotId ?? simulatedId}`;
      await db.insert(trainingTradesTable).values({
        pair:           intent.pair,
        buyTxid,
        entryPrice:     entryPrice.toFixed(8),
        entryAmount:    execAmount.toFixed(8),
        qtyRemaining:   "0",
        exitPrice:      execPrice.toFixed(8),
        exitAmount:     execAmount.toFixed(8),
        costUsd:        costUsd.toFixed(8),
        entryFee:       entryFeeUsd.toFixed(8),
        exitFee:        exitFeeUsd.toFixed(8),
        revenueUsd:     revenueUsd.toFixed(8),
        pnlGross:       pnlGross.toFixed(8),
        pnlNet:         pnlNet.toFixed(8),
        pnlPct:         pnlPct.toFixed(4),
        holdTimeMinutes: holdMin,
        labelWin:       pnlNet > 0 ? 1 : 0,
        entryTs,
        exitTs:         new Date(),
        sellTxidsJson:  [simulatedId],
        isClosed:       true,
        isLabeled:      true,
        // Phase 1 extension columns
        sourceMode:     "SHADOW",
        sourceTable:    "shadow",
        evidenceWeight: EVIDENCE_WEIGHT,
        regime:         intent.regime ?? lot?.regime ?? null,
        exitReason:     intent.reason ?? null,
      } as any).onConflictDoNothing();

      // Snapshot exit
      tradeSnapshotService.onBotSpotExit({
        sourceMode:    "SHADOW",
        sourceTradeId: buyTxid,
        exitTs:        new Date(),
        exitPrice:     execPrice,
        exitFeeUsd:    exitFeeUsd,
        exitReason:    intent.reason,
        pnlGrossUsd:   pnlGross,
        pnlNetUsd:     pnlNet,
        pnlPct,
        holdTimeMinutes: holdMin,
      });

      return { success: true, mode: "SHADOW", simulatedId, pair: intent.pair, side: "sell", executedPrice: execPrice, executedAmount: execAmount, feeUsd: exitFeeUsd, pnlNetUsd: pnlNet };
    } catch (e: any) {
      console.error(`[shadow-executor] executeSell error: ${e?.message}`);
      return { success: false, mode: "SHADOW", simulatedId, pair: intent.pair, side: "sell", executedPrice: 0, executedAmount: 0, feeUsd: 0, errorMessage: e?.message };
    }
  }

  private _extractIndicators(indicators?: Record<string, number | undefined>) {
    if (!indicators) return {};
    return {
      ema10:       indicators.ema10,
      ema20:       indicators.ema20,
      atrPct:      indicators.atrPct,
      rsi14:       indicators.rsi14,
      macdHist:    indicators.macdHist,
      volumeRatio: indicators.volumeRatio,
    };
  }
}

export const shadowExecutor = new ShadowExecutor();
