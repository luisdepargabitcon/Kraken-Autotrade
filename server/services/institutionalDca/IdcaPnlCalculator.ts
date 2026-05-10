/**
 * IdcaPnlCalculator — Canonical PnL computation for IDCA cycles.
 *
 * Centralises all net/gross PnL calculations so every consumer
 * (UI, Telegram, reports, logs) displays the same numbers.
 *
 * DB storage semantics (Lote 4+):
 *   - capitalUsedUsd          = remaining live cost (decreases with partial sells)
 *   - totalCostBasisUsd       = historical total cost (never decreases); fallback = capitalUsedUsd
 *   - realizedCostBasisUsd    = cost of the already-sold portion (Lote 4 only)
 *   - realizedPnlUsd:
 *       closed cycles         → NET PROFIT (proceeds – totalCostBasis)
 *       L4 partial sell       → Accumulated realized profit/loss (can be negative)
 *       trailing_active (legacy armTakeProfit) → SELL PROCEEDS (not profit)
 *       active cycles         → 0 or null
 *
 * NOTE: pre-Lote4 cycles have totalCostBasisUsd = 0 (migrated to = capitalUsedUsd by migration 033).
 *       The helper falls back to capitalUsedUsd as cost denominator for legacy rows.
 */

// ─── Fee config ───────────────────────────────────────────────────────────────

export const DEFAULT_EXECUTION_FEES = {
  exchange: "revolut_x",
  makerFeePct: 0,
  takerFeePct: 0.09,
  defaultFeeMode: "taker",
  includeEntryFeeInCostBasis: true,
  includeExitFeeInNetPnlEstimate: true,
  useRealFeesWhenAvailable: true,
} as const;

export type ExecutionFeesConfig = {
  exchange?: string;
  makerFeePct?: number;
  takerFeePct?: number;
  defaultFeeMode?: string;
  includeEntryFeeInCostBasis?: boolean;
  includeExitFeeInNetPnlEstimate?: boolean;
  useRealFeesWhenAvailable?: boolean;
};

export type FeeSource = "executionFeesJson" | "legacy" | "default";

/**
 * Resolve active taker fee percentage.
 * Priority: executionFeesJson.takerFeePct → simulationFeePct → 0.09 (Revolut X default).
 */
export function resolveFeePct(
  execFeesJson: unknown,
  simulationFeePct?: unknown,
): { pct: number; source: FeeSource } {
  const fees = execFeesJson as ExecutionFeesConfig | null;
  if (fees && typeof fees.takerFeePct === "number") {
    return { pct: fees.takerFeePct, source: "executionFeesJson" };
  }
  const legacy = parseFloat(String(simulationFeePct));
  if (Number.isFinite(legacy) && legacy >= 0) {
    return { pct: legacy, source: "legacy" };
  }
  return { pct: 0.09, source: "default" };
}

// ─── PnL result ───────────────────────────────────────────────────────────────

export interface IdcaPnlResult {
  grossEntryValueUsd: number;   // = totalCostBasisUsd (historical)
  entryFeeUsd: number;
  costBasisUsd: number;          // = capitalUsedUsd (remaining/live)
  totalCostBasisUsd: number;     // historical total; denominator for pnlPct in closed cycles
  currentValueUsd: number;
  estimatedExitFeeUsd: number;
  unrealizedGrossPnlUsd: number;
  unrealizedNetPnlUsd: number;
  realizedProceedsUsd: number;
  realizedGrossPnlUsd: number;
  realizedNetPnlUsd: number;     // accumulated net profit (can be negative)
  partialTakeProfitProceedsUsd: number;
  feeSource: FeeSource;
  isEstimated: boolean;
  isPartialTp: boolean;          // legacy armTakeProfit path
  isL4PartialSell: boolean;      // Lote 4 partial sell path
}

// ─── Core calculator ──────────────────────────────────────────────────────────

type CycleInput = {
  status?: string | null;
  strategy?: string | null;
  capitalUsedUsd?: unknown;
  totalCostBasisUsd?: unknown;   // Lote 4: historical total cost; fallback = capitalUsedUsd
  realizedCostBasisUsd?: unknown; // Lote 4: cost of already-sold portion
  totalQuantity?: unknown;
  currentPrice?: unknown;
  realizedPnlUsd?: unknown;
  avgEntryPrice?: unknown;
};

/**
 * Compute canonical PnL for an IDCA cycle.
 *
 * Lote 4 semantics:
 *   capitalUsedUsd        = remaining live cost (open cycles only; 0 after full close)
 *   totalCostBasisUsd     = historical total cost (never decreases); fallback = capitalUsedUsd
 *   realizedCostBasisUsd  > 0 → L4 partial sell occurred
 *
 * Rules:
 *   Open (no partial sell): unrealizedNetPnl = currentValue – exitFee – capitalUsed
 *   L4 partial sell active: unrealizedNetPnl vs remaining cost; realizedNetPnl = accumulated profit
 *   Legacy partial TP:      partialTakeProfitProceedsUsd = realizedPnlUsd (proceeds, not profit)
 *   Closed:                 realizedNetPnl = realizedPnlUsd; pnlPct = / totalCostBasisUsd
 */
export function computeCyclePnl(
  cycle: CycleInput,
  execFeesJson?: unknown,
  simulationFeePct?: unknown,
): IdcaPnlResult {
  const capitalUsed       = parseFloat(String(cycle.capitalUsedUsd    || "0")); // remaining
  const realizedCostBasis = parseFloat(String(cycle.realizedCostBasisUsd || "0"));
  const rawRealized       = parseFloat(String(cycle.realizedPnlUsd    || "0"));
  const totalQty          = parseFloat(String(cycle.totalQuantity      || "0"));
  const curPrice          = parseFloat(String(cycle.currentPrice       || "0"));
  const status            = cycle.status || "active";

  // totalCostBasisUsd: use new field if populated (Lote 4), else fall back to capitalUsedUsd (legacy)
  const rawTotalCostBasis = parseFloat(String(cycle.totalCostBasisUsd || "0"));
  const totalCostBasisUsd = rawTotalCostBasis > 0 ? rawTotalCostBasis : capitalUsed;

  const isClosed         = status === "closed";
  // L4 partial sell: active/trailing with realizedCostBasis > 0 (Lote 4 only)
  const isL4PartialSell  = !isClosed && realizedCostBasis > 0;
  // Legacy trailing partial TP (armTakeProfit): trailing_active, rawRealized > 0, no realizedCostBasis
  const isPartialTp      = status === "trailing_active" && rawRealized > 0 && realizedCostBasis === 0;

  const { pct: feePct, source: feeSource } = resolveFeePct(execFeesJson, simulationFeePct);

  // Cost for unrealized calculation = remaining live cost
  const costBasisUsd    = capitalUsed;
  const entryFeeUsd     = totalCostBasisUsd * feePct / 100; // entry fee on full original cost

  // Unrealized (remaining open position)
  const currentValueUsd     = totalQty * curPrice;
  const includeExitFee      = (execFeesJson as any)?.includeExitFeeInNetPnlEstimate !== false;
  const estimatedExitFeeUsd = (!isClosed && includeExitFee && currentValueUsd > 0)
    ? currentValueUsd * feePct / 100
    : 0;
  const unrealizedGrossPnlUsd = currentValueUsd - costBasisUsd; // vs remaining cost
  const unrealizedNetPnlUsd   = unrealizedGrossPnlUsd - estimatedExitFeeUsd;

  // Realized
  let realizedProceedsUsd          = 0;
  let realizedNetPnlUsd            = 0;
  let partialTakeProfitProceedsUsd = 0;

  if (isPartialTp) {
    // Legacy armTakeProfit: rawRealized = sell proceeds (NOT profit)
    partialTakeProfitProceedsUsd = rawRealized;
    realizedProceedsUsd          = rawRealized;
    realizedNetPnlUsd            = 0;
  } else if (isL4PartialSell) {
    // Lote 4 partial sell: rawRealized = accumulated net profit (can be negative)
    realizedNetPnlUsd   = rawRealized;
    realizedProceedsUsd = rawRealized + realizedCostBasis; // back-computed
  } else if (isClosed) {
    // Closed cycle: rawRealized = total net profit
    realizedNetPnlUsd   = rawRealized;
    // Back-compute proceeds using totalCostBasisUsd (not capitalUsedUsd which is 0 at close)
    realizedProceedsUsd = rawRealized + totalCostBasisUsd;
  }

  return {
    grossEntryValueUsd: totalCostBasisUsd, // historical
    entryFeeUsd,
    costBasisUsd,                          // remaining live cost
    totalCostBasisUsd,                     // historical (for pnlPct in closed cycles)
    currentValueUsd,
    estimatedExitFeeUsd,
    unrealizedGrossPnlUsd,
    unrealizedNetPnlUsd,
    realizedProceedsUsd,
    realizedGrossPnlUsd: realizedNetPnlUsd,
    realizedNetPnlUsd,
    partialTakeProfitProceedsUsd,
    feeSource,
    isEstimated: !isClosed,
    isPartialTp,
    isL4PartialSell,
  };
}

/**
 * Quick display helper: returns the number and label to show in any UI for realized PnL.
 * Handles partial TP vs closed profit correctly.
 */
export function getDisplayRealizedPnl(
  cycle: CycleInput,
  execFeesJson?: unknown,
  simulationFeePct?: unknown,
): { value: number; label: string; isPartial: boolean } {
  const pnl = computeCyclePnl(cycle, execFeesJson, simulationFeePct);

  if (pnl.isPartialTp) {
    return {
      value: pnl.partialTakeProfitProceedsUsd,
      label: "TP parcial cobrado",
      isPartial: true,
    };
  }

  if (cycle.status === "closed") {
    return {
      value: pnl.realizedNetPnlUsd,
      label: "Beneficio realizado",
      isPartial: false,
    };
  }

  return { value: 0, label: "", isPartial: false };
}
