/**
 * ITradeExecutor — shared interface for Real, DryRun, and Shadow executors.
 *
 * Implementations:
 *   RealExecutor    → tradingEngine.buyAsset / sellAsset (existing, not modified here)
 *   ShadowExecutor  → NEVER calls exchange; writes only to trade_snapshots + training_trades (shadow)
 *
 * Contract:
 *   - executeBuy / executeSell MUST be side-effect-free in terms of real funds for Shadow.
 *   - Shadow result carries mode='SHADOW' in metadata.
 */

export interface TradeIntent {
  pair:        string;
  side:        "buy" | "sell";
  amountUsd:   number;
  price:       number;        // current market price (for simulation)
  reason:      string;
  lotId?:      string;        // optional reference to open lot being closed
  signalScore?: number;
  regime?:     string;
  confidence?: number;
  indicators?: Record<string, number | undefined>;
  configSnapshot?: Record<string, unknown>;
}

export interface TradeResult {
  success:     boolean;
  mode:        "REAL" | "DRY_RUN" | "SHADOW";
  simulatedId: string;        // synthetic ID for this simulated trade
  pair:        string;
  side:        "buy" | "sell";
  executedPrice:  number;
  executedAmount: number;
  feeUsd:         number;
  pnlNetUsd?:     number;
  errorMessage?:  string;
}

export interface ITradeExecutor {
  readonly mode: "REAL" | "DRY_RUN" | "SHADOW";
  executeBuy(intent: TradeIntent): Promise<TradeResult>;
  executeSell(intent: TradeIntent, entryContext?: { entryPrice: number; entryTs: Date; lotId: string }): Promise<TradeResult>;
}
