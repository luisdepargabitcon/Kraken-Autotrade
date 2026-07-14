/**
 * gridCycleProgress.ts — Pure helpers for cycle progress visualization.
 * No DOM, no React, no side-effects. Safe for unit tests.
 */

export type CycleProgressState =
  | "waiting_buy"
  | "buy_filled"
  | "towards_tp"
  | "trailing_inactive"
  | "trailing_active"
  | "near_stop"
  | "closed"
  | "cancelled";

export type CycleProgressColor =
  | "red"
  | "yellow"
  | "blue"
  | "green"
  | "purple"
  | "muted";

export interface CycleProgressData {
  state: CycleProgressState;
  stateLabel: string;
  color: CycleProgressColor;
  buyPrice: number | null;
  currentPrice: number | null;
  targetPrice: number | null;
  stopPrice: number | null;
  trailingActivationPrice: number | null;
  trailingStopPrice: number | null;
  pnlFloatingPct: number | null;
  distanceToTargetPct: number | null;
  distanceToStopPct: number | null;
  distanceToTrailingActivationPct: number | null;
  progressPct: number;
  tooltipLines: string[];
  isActive: boolean;
}

function toN(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pct(a: number, b: number): number {
  if (b === 0) return 0;
  return ((a - b) / b) * 100;
}

const STATE_LABELS: Record<CycleProgressState, string> = {
  waiting_buy: "Esperando BUY",
  buy_filled: "BUY ejecutado",
  towards_tp: "Camino a TP",
  trailing_inactive: "Trailing armado",
  trailing_active: "Trailing activo",
  near_stop: "Cerca de stop",
  closed: "Cerrado",
  cancelled: "Cancelado",
};

const STATE_COLORS: Record<CycleProgressState, CycleProgressColor> = {
  waiting_buy: "muted",
  buy_filled: "blue",
  towards_tp: "blue",
  trailing_inactive: "purple",
  trailing_active: "purple",
  near_stop: "red",
  closed: "green",
  cancelled: "muted",
};

export function computeCycleProgress(
  cycle: any,
  currentPrice?: number | null
): CycleProgressData {
  const status: string = cycle?.status ?? "open";
  const buyPrice = toN(cycle?.buyPrice);
  const sellPrice = toN(cycle?.sellPrice);
  const curPrice = toN(currentPrice) ?? buyPrice;
  const targetPrice = toN(cycle?.targetSellPrice ?? cycle?.sellTargetPrice ?? cycle?.sellPrice);
  const stopPrice = toN(cycle?.stopLossPrice ?? cycle?.stopPrice);
  const trailingActivationPrice = toN(cycle?.trailingActivationPrice);
  const trailingStopPrice = toN(cycle?.trailingStopPrice ?? cycle?.currentTrailingStop);

  const isClosed = ["completed", "cancelled", "stop_loss_hit", "trailing_closed"].includes(status);
  const isBuyFilled = ["buy_filled", "open", "active"].includes(status);

  let state: CycleProgressState = "waiting_buy";
  if (isClosed) {
    state = status === "cancelled" ? "cancelled" : "closed";
  } else if (isBuyFilled && buyPrice !== null && curPrice !== null) {
    if (stopPrice !== null && curPrice <= stopPrice * 1.02) {
      state = "near_stop";
    } else if (trailingStopPrice !== null) {
      state = "trailing_active";
    } else if (trailingActivationPrice !== null && curPrice >= trailingActivationPrice) {
      state = "trailing_active";
    } else if (trailingActivationPrice !== null) {
      state = "trailing_inactive";
    } else {
      state = buyPrice !== null && curPrice > buyPrice ? "towards_tp" : "buy_filled";
    }
  }

  const pnlFloatingPct =
    buyPrice !== null && curPrice !== null && buyPrice > 0
      ? pct(curPrice, buyPrice)
      : null;

  const distanceToTargetPct =
    targetPrice !== null && curPrice !== null && curPrice > 0
      ? pct(targetPrice, curPrice)
      : null;

  const distanceToStopPct =
    stopPrice !== null && curPrice !== null && curPrice > 0
      ? pct(curPrice, stopPrice)
      : null;

  const distanceToTrailingActivationPct =
    trailingActivationPrice !== null && curPrice !== null && curPrice > 0
      ? pct(trailingActivationPrice, curPrice)
      : null;

  let progressPct = 0;
  if (isClosed) {
    progressPct = 100;
  } else if (buyPrice !== null && targetPrice !== null && curPrice !== null) {
    const range = targetPrice - buyPrice;
    if (range > 0) {
      progressPct = Math.max(0, Math.min(100, ((curPrice - buyPrice) / range) * 100));
    }
  }

  const tooltipLines: string[] = [];
  if (distanceToTargetPct !== null) tooltipLines.push(`Faltan ${distanceToTargetPct.toFixed(2)}% hasta objetivo`);
  if (distanceToStopPct !== null) tooltipLines.push(`Faltan ${distanceToStopPct.toFixed(2)}% hasta stop`);
  if (trailingActivationPrice !== null && state === "trailing_inactive" && distanceToTrailingActivationPct !== null) {
    tooltipLines.push(`Trailing se activa en $${trailingActivationPrice.toFixed(2)} (faltan ${distanceToTrailingActivationPct.toFixed(2)}%)`);
  }
  if (state === "trailing_active" && trailingStopPrice !== null) {
    tooltipLines.push(`Trailing activo: stop actual $${trailingStopPrice.toFixed(2)}`);
  }

  return {
    state,
    stateLabel: STATE_LABELS[state],
    color: STATE_COLORS[state],
    buyPrice,
    currentPrice: curPrice,
    targetPrice,
    stopPrice,
    trailingActivationPrice,
    trailingStopPrice,
    pnlFloatingPct,
    distanceToTargetPct,
    distanceToStopPct,
    distanceToTrailingActivationPct,
    progressPct,
    tooltipLines,
    isActive: !isClosed,
  };
}

export function cycleProgressBarZones(data: CycleProgressData): {
  stopZonePct: number;
  buySellZonePct: number;
  progressZonePct: number;
  tpZonePct: number;
} {
  const { buyPrice, targetPrice, stopPrice, progressPct } = data;
  if (buyPrice === null || targetPrice === null) {
    return { stopZonePct: 10, buySellZonePct: 0, progressZonePct: 75, tpZonePct: 15 };
  }
  const fullRange = targetPrice - (stopPrice ?? buyPrice * 0.95);
  if (fullRange <= 0) return { stopZonePct: 10, buySellZonePct: 0, progressZonePct: 75, tpZonePct: 15 };

  const stopZonePct = stopPrice !== null ? Math.max(5, ((buyPrice - stopPrice) / fullRange) * 100) : 10;
  const tpZonePct = Math.max(10, 100 - stopZonePct - 75);
  const buySellZonePct = 0;
  const progressZonePct = Math.max(0, 100 - stopZonePct - tpZonePct - buySellZonePct);

  return { stopZonePct, buySellZonePct, progressZonePct, tpZonePct };
}
