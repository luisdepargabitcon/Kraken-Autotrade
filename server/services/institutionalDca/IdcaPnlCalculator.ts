/**
 * IdcaPnlCalculator — Canonical PnL computation for IDCA cycles.
 *
 * Centralises all net/gross PnL calculations so every consumer
 * (UI, Telegram, reports, logs) displays the same numbers.
 *
 * DB storage semantics (after bee8391+):
 *   - closed cycles (all types)   → realizedPnlUsd = NET PROFIT (sellProceeds – costBasis)
 *   - trailing_active (partial TP) → realizedPnlUsd = SELL PROCEEDS (not yet profit)
 *   - active cycles               → realizedPnlUsd = 0 or null
 *
 * NOTE: pre-bee8391 legacy rows may have stored proceeds for v1/recovery closes.
 *       The helper handles this transparently — see `isLegacyProceeds` flag.
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
  grossEntryValueUsd: number;
  entryFeeUsd: number;
  costBasisUsd: number;
  currentValueUsd: number;
  estimatedExitFeeUsd: number;
  unrealizedGrossPnlUsd: number;
  unrealizedNetPnlUsd: number;
  realizedProceedsUsd: number;
  realizedGrossPnlUsd: number;
  realizedNetPnlUsd: number;
  partialTakeProfitProceedsUsd: number;
  feeSource: FeeSource;
  isEstimated: boolean;
  isPartialTp: boolean;
}

// ─── Core calculator ──────────────────────────────────────────────────────────

type CycleInput = {
  status?: string | null;
  strategy?: string | null;
  capitalUsedUsd?: unknown;
  totalQuantity?: unknown;
  currentPrice?: unknown;
  realizedPnlUsd?: unknown;
  avgEntryPrice?: unknown;
};

/**
 * Compute canonical PnL for an IDCA cycle.
 *
 * Rules:
 *   Open cycle:     unrealizedNetPnl = currentValue – estimatedExitFee – costBasis
 *   Closed cycle:   realizedNetPnl = realizedPnlUsd (stored as profit after bee8391+)
 *   Partial TP:     partialTakeProfitProceedsUsd = realizedPnlUsd (proceeds — NOT profit)
 */
export function computeCyclePnl(
  cycle: CycleInput,
  execFeesJson?: unknown,
  simulationFeePct?: unknown,
): IdcaPnlResult {
  const capitalUsed  = parseFloat(String(cycle.capitalUsedUsd  || "0"));
  const totalQty     = parseFloat(String(cycle.totalQuantity    || "0"));
  const curPrice     = parseFloat(String(cycle.currentPrice     || "0"));
  const rawRealized  = parseFloat(String(cycle.realizedPnlUsd  || "0"));
  const status       = cycle.status || "active";

  const isPartialTp  = status === "trailing_active" && rawRealized > 0;
  const isClosed     = status === "closed";

  const { pct: feePct, source: feeSource } = resolveFeePct(execFeesJson, simulationFeePct);

  // Entry cost (capitalUsedUsd includes simulation entry fees already)
  const costBasisUsd    = capitalUsed;
  const entryFeeUsd     = capitalUsed * feePct / 100;

  // Unrealized (open position)
  const currentValueUsd     = totalQty * curPrice;
  const includeExitFee      = (execFeesJson as any)?.includeExitFeeInNetPnlEstimate !== false;
  const estimatedExitFeeUsd = (!isClosed && includeExitFee && currentValueUsd > 0)
    ? currentValueUsd * feePct / 100
    : 0;
  const unrealizedGrossPnlUsd = currentValueUsd - costBasisUsd;
  const unrealizedNetPnlUsd   = unrealizedGrossPnlUsd - estimatedExitFeeUsd;

  // Realized
  let realizedProceedsUsd         = 0;
  let realizedNetPnlUsd           = 0;
  let partialTakeProfitProceedsUsd = 0;

  if (isPartialTp) {
    // Partial TP: rawRealized = sell proceeds — profit not yet determinable without full close
    partialTakeProfitProceedsUsd = rawRealized;
    realizedProceedsUsd          = rawRealized;
    realizedNetPnlUsd            = 0;
  } else if (isClosed) {
    // After bee8391+: realizedPnlUsd = net profit for ALL cycle types
    realizedNetPnlUsd   = rawRealized;
    realizedProceedsUsd = rawRealized + costBasisUsd; // back-computed
  }

  return {
    grossEntryValueUsd: capitalUsed,
    entryFeeUsd,
    costBasisUsd,
    currentValueUsd,
    estimatedExitFeeUsd,
    unrealizedGrossPnlUsd,
    unrealizedNetPnlUsd,
    realizedProceedsUsd,
    realizedGrossPnlUsd: realizedNetPnlUsd, // fees already deducted in simulation
    realizedNetPnlUsd,
    partialTakeProfitProceedsUsd,
    feeSource,
    isEstimated: !isClosed,
    isPartialTp,
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
