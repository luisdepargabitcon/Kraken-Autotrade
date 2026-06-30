/**
 * auditMetrics.ts
 * Shared audit efficiency metrics: MFE, MAE, Giveback, Profit Capture, Exit Efficiency.
 * Pure functions — no DB access, no side effects, no real trading.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProfitCaptureQuality = "reliable" | "estimated" | "insufficient_data";

export interface TradeEfficiencyMetrics {
  mfePnlUsd: number | null;
  maePnlUsd: number | null;
  mfePct: number | null;
  maePct: number | null;
  givebackUsd: number | null;
  givebackPct: number | null;
  profitCapturePct: number | null;
  profitCaptureQuality: ProfitCaptureQuality;
  rawProfitCapturePct: number | null;
  displayProfitCapturePct: number | null;
  profitCaptureWarning: string | null;
  exitEfficiency: "Excelente" | "Buena" | "Regular" | "Baja" | "Sin datos";
  opportunityLostUsd: number | null;
}

export interface ProfitCaptureResult {
  rawProfitCapturePct: number | null;
  displayProfitCapturePct: number | null;
  profitCaptureQuality: ProfitCaptureQuality;
  profitCaptureWarning: string | null;
}

export interface OhlcPoint {
  high: number;
  low: number;
  open?: number;
  close?: number;
}

// ─── Core metric functions ────────────────────────────────────────────────────

/**
 * Compute MFE in USD: (maxHigh - entryPrice) * quantity
 * Returns null if no candle data available.
 */
export function computeMfePnlUsd(
  entryPrice: number,
  quantity: number,
  candles: OhlcPoint[]
): number | null {
  if (!candles.length || quantity <= 0 || entryPrice <= 0) return null;
  const maxHigh = Math.max(...candles.map(c => c.high));
  return (maxHigh - entryPrice) * quantity;
}

/**
 * Compute MAE in USD: (minLow - entryPrice) * quantity  (typically negative)
 * Returns null if no candle data available.
 */
export function computeMaePnlUsd(
  entryPrice: number,
  quantity: number,
  candles: OhlcPoint[]
): number | null {
  if (!candles.length || quantity <= 0 || entryPrice <= 0) return null;
  const minLow = Math.min(...candles.map(c => c.low));
  return (minLow - entryPrice) * quantity;
}

/**
 * Compute MFE % relative to invested capital.
 */
export function computeMfePct(mfePnlUsd: number | null, capitalUsd: number): number | null {
  if (mfePnlUsd === null || capitalUsd <= 0) return null;
  return (mfePnlUsd / capitalUsd) * 100;
}

/**
 * Compute MAE % relative to invested capital.
 */
export function computeMaePct(maePnlUsd: number | null, capitalUsd: number): number | null {
  if (maePnlUsd === null || capitalUsd <= 0) return null;
  return (maePnlUsd / capitalUsd) * 100;
}

/**
 * Giveback = MFE - final PnL (always >= 0).
 * Only meaningful when MFE > 0.
 */
export function computeGivebackUsd(
  mfePnlUsd: number | null,
  finalPnlUsd: number
): number | null {
  if (mfePnlUsd === null) return null;
  const giveback = mfePnlUsd - finalPnlUsd;
  return giveback > 0 ? giveback : 0;
}

/**
 * Profit Capture % = finalPnl / MFE * 100.
 * Only computed when MFE > 0.
 * Returns raw value (may be >100 or negative) for diagnostics.
 */
export function computeProfitCapturePct(
  mfePnlUsd: number | null,
  finalPnlUsd: number
): number | null {
  if (mfePnlUsd === null || mfePnlUsd <= 0) return null;
  const pct = (finalPnlUsd / mfePnlUsd) * 100;
  return Math.min(Math.max(pct, -999), 999);
}

/**
 * Classify profit capture quality and produce display-safe values.
 *
 * reliable: MFE came from real snapshots/candles, MFE >= finalPnl when finalPnl > 0, 0 <= pct <= 100.
 * estimated: MFE came from fallback (e.g. highest_price_after_tp), value may be imprecise but 0 <= pct <= 100.
 * insufficient_data: MFE is null, <=0, or pct > 100 / negative / incoherent due to missing data.
 */
export function classifyProfitCaptureQuality(
  mfePnlUsd: number | null,
  finalPnlUsd: number,
  hasReliableMfe: boolean
): ProfitCaptureResult {
  const rawPct = computeProfitCapturePct(mfePnlUsd, finalPnlUsd);

  // Case: no MFE at all
  if (mfePnlUsd === null || mfePnlUsd <= 0) {
    const warning = finalPnlUsd > 0
      ? "No hay MFE registrado. No se puede calcular captura de beneficio."
      : null;
    return {
      rawProfitCapturePct: rawPct,
      displayProfitCapturePct: null,
      profitCaptureQuality: "insufficient_data",
      profitCaptureWarning: warning,
    };
  }

  // Case: pct > 100 means finalPnl > MFE — data inconsistency
  if (rawPct !== null && rawPct > 100) {
    return {
      rawProfitCapturePct: rawPct,
      displayProfitCapturePct: null,
      profitCaptureQuality: "insufficient_data",
      profitCaptureWarning: `Profit Capture crudo (${rawPct.toFixed(1)}%) supera 100%. MFE infracalculado o faltan snapshots. No se muestra como KPI.`,
    };
  }

  // Case: negative pct (finalPnl < 0 while MFE > 0) — valid but poor
  if (rawPct !== null && rawPct < 0) {
    return {
      rawProfitCapturePct: rawPct,
      displayProfitCapturePct: rawPct,
      profitCaptureQuality: hasReliableMfe ? "reliable" : "estimated",
      profitCaptureWarning: null,
    };
  }

  // Normal case: 0 <= pct <= 100
  if (rawPct !== null) {
    return {
      rawProfitCapturePct: rawPct,
      displayProfitCapturePct: rawPct,
      profitCaptureQuality: hasReliableMfe ? "reliable" : "estimated",
      profitCaptureWarning: hasReliableMfe ? null : "MFE estimado sin snapshots completos. Valor orientativo.",
    };
  }

  return {
    rawProfitCapturePct: null,
    displayProfitCapturePct: null,
    profitCaptureQuality: "insufficient_data",
    profitCaptureWarning: null,
  };
}

/**
 * Exit Efficiency label from profit capture %.
 */
export function classifyExitEfficiency(
  profitCapturePct: number | null
): TradeEfficiencyMetrics["exitEfficiency"] {
  if (profitCapturePct === null) return "Sin datos";
  if (profitCapturePct >= 80) return "Excelente";
  if (profitCapturePct >= 50) return "Buena";
  if (profitCapturePct >= 25) return "Regular";
  return "Baja";
}

/**
 * Opportunity Lost = MFE - final PnL when MFE > 0.
 * Alias for giveback but named for clarity in reports.
 */
export function computeOpportunityLostUsd(
  mfePnlUsd: number | null,
  finalPnlUsd: number
): number | null {
  return computeGivebackUsd(mfePnlUsd, finalPnlUsd);
}

// ─── Composite builder ────────────────────────────────────────────────────────

export interface EfficiencyInput {
  entryPrice: number;
  quantity: number;
  capitalUsd: number;
  finalPnlUsd: number;
  candles?: OhlcPoint[];
  /** Optional pre-computed MFE price (e.g. highest_price_after_tp from IDCA) */
  mfePriceOverride?: number | null;
  /** Optional pre-computed MAE proxy (e.g. from max_drawdown_pct) */
  maePctOverride?: number | null;
  /** Whether MFE comes from reliable snapshots (true) or fallback estimation (false) */
  hasReliableMfe?: boolean;
}

/**
 * Build full efficiency metrics from raw inputs.
 * Uses candles when available; falls back to overrides or null.
 */
export function buildTradeEfficiencyMetrics(input: EfficiencyInput): TradeEfficiencyMetrics {
  const { entryPrice, quantity, capitalUsd, finalPnlUsd, candles, mfePriceOverride, maePctOverride } = input;

  let mfePnlUsd: number | null = null;
  let maePnlUsd: number | null = null;

  if (candles && candles.length > 0) {
    mfePnlUsd = computeMfePnlUsd(entryPrice, quantity, candles);
    maePnlUsd = computeMaePnlUsd(entryPrice, quantity, candles);
  } else if (mfePriceOverride != null && entryPrice > 0 && quantity > 0) {
    mfePnlUsd = (mfePriceOverride - entryPrice) * quantity;
  }

  if (maePnlUsd === null && maePctOverride != null && capitalUsd > 0) {
    maePnlUsd = (maePctOverride / 100) * capitalUsd;
  }

  const mfePct = computeMfePct(mfePnlUsd, capitalUsd);
  const maePct = computeMaePct(maePnlUsd, capitalUsd);
  const givebackUsd = computeGivebackUsd(mfePnlUsd, finalPnlUsd);
  const givebackPct = givebackUsd !== null && capitalUsd > 0
    ? (givebackUsd / capitalUsd) * 100
    : null;
  const profitCapturePct = computeProfitCapturePct(mfePnlUsd, finalPnlUsd);
  const hasReliable = input.hasReliableMfe ?? (candles != null && candles.length > 0);
  const pcQuality = classifyProfitCaptureQuality(mfePnlUsd, finalPnlUsd, hasReliable);
  const exitEfficiency = classifyExitEfficiency(pcQuality.displayProfitCapturePct);
  const opportunityLostUsd = computeOpportunityLostUsd(mfePnlUsd, finalPnlUsd);

  return {
    mfePnlUsd,
    maePnlUsd,
    mfePct,
    maePct,
    givebackUsd,
    givebackPct,
    profitCapturePct: pcQuality.displayProfitCapturePct,
    profitCaptureQuality: pcQuality.profitCaptureQuality,
    rawProfitCapturePct: pcQuality.rawProfitCapturePct,
    displayProfitCapturePct: pcQuality.displayProfitCapturePct,
    profitCaptureWarning: pcQuality.profitCaptureWarning,
    exitEfficiency,
    opportunityLostUsd,
  };
}

// ─── Aggregate helpers ────────────────────────────────────────────────────────

/** Profit Factor = sum(positive PnL) / abs(sum(negative PnL)) */
export function computeProfitFactor(pnls: number[]): number | null {
  const gross = pnls.filter(p => p > 0).reduce((a, b) => a + b, 0);
  const loss = Math.abs(pnls.filter(p => p < 0).reduce((a, b) => a + b, 0));
  if (loss === 0) return null; // Infinity is not JSON-serializable; return null when no losses
  return parseFloat((gross / loss).toFixed(3));
}

/** Expectancy = (winRate * avgWin) - (lossRate * avgLoss) */
export function computeExpectancy(pnls: number[]): number {
  if (pnls.length === 0) return 0;
  const wins = pnls.filter(p => p > 0);
  const losses = pnls.filter(p => p < 0);
  const winRate = wins.length / pnls.length;
  const lossRate = losses.length / pnls.length;
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
  return parseFloat(((winRate * avgWin) - (lossRate * avgLoss)).toFixed(4));
}

/** Duration in minutes between two timestamps */
export function durationMinutes(start: Date | string | null, end: Date | string | null): number | null {
  if (!start || !end) return null;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (isNaN(s) || isNaN(e)) return null;
  return Math.round((e - s) / 60_000);
}

/** Human-readable duration */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}

// ─── Auto-diagnosis rules ─────────────────────────────────────────────────────

export interface DiagnosticResult {
  code: string;
  severity: "warning" | "info" | "ok";
  message: string;
}

export function generateTradeDiagnostics(
  metrics: TradeEfficiencyMetrics,
  reason: string | null,
  capitalUsd: number
): DiagnosticResult[] {
  const results: DiagnosticResult[] = [];

  // If profit capture data is insufficient, skip capture-based diagnostics
  if (metrics.profitCaptureQuality === "insufficient_data") {
    results.push({
      code: "PROFIT_CAPTURE_INSUFFICIENT_DATA",
      severity: "info",
      message: "No hay snapshots suficientes para evaluar la eficiencia de salida. La métrica se calculará mejor en operaciones nuevas.",
    });
    // Still check MAE (independent of profit capture)
    if ((metrics.maePnlUsd ?? 0) < -capitalUsd * 0.5 && capitalUsd > 0) {
      results.push({
        code: "HIGH_MAE",
        severity: "warning",
        message: `Drawdown elevado: pérdida flotante máxima superó el 50% del capital invertido.`,
      });
    }
    return results;
  }

  // Use displayProfitCapturePct for diagnostics (null when insufficient)
  const pcPct = metrics.displayProfitCapturePct;

  if (pcPct !== null && pcPct < 25 && (metrics.mfePnlUsd ?? 0) > 1) {
    const prefix = metrics.profitCaptureQuality === "estimated" ? "Estimación: " : "";
    results.push({
      code: "LOW_PROFIT_CAPTURE",
      severity: "warning",
      message: `${prefix}Salida poco eficiente: se capturó solo el ${pcPct.toFixed(0)}% del beneficio potencial (MFE $${metrics.mfePnlUsd?.toFixed(2)}).`,
    });
  }

  if ((metrics.givebackUsd ?? 0) > (metrics.mfePnlUsd ?? 0) * 0.7 && (metrics.mfePnlUsd ?? 0) > 1) {
    results.push({
      code: "HIGH_GIVEBACK",
      severity: "warning",
      message: `Giveback elevado: se devolvió $${metrics.givebackUsd?.toFixed(2)} del beneficio. Revisa trailing o Break Even.`,
    });
  }

  if ((metrics.maePnlUsd ?? 0) < -capitalUsd * 0.5 && capitalUsd > 0) {
    results.push({
      code: "HIGH_MAE",
      severity: "warning",
      message: `Drawdown elevado: pérdida flotante máxima superó el 50% del capital invertido.`,
    });
  }

  if (reason === "TIME_STOP" && (metrics.mfePnlUsd ?? 0) > 2) {
    results.push({
      code: "TIMESTOP_WITH_MFE",
      severity: "info",
      message: `TimeStop cerró con MFE de $${metrics.mfePnlUsd?.toFixed(2)}. Considera ajustar softMode o extender ventana.`,
    });
  }

  if (results.length === 0 && pcPct !== null && pcPct >= 70) {
    const prefix = metrics.profitCaptureQuality === "estimated" ? "Estimación: " : "";
    results.push({
      code: "GOOD_EXIT",
      severity: "ok",
      message: `${prefix}Salida eficiente: se capturó el ${pcPct.toFixed(0)}% del beneficio potencial.`,
    });
  }

  return results;
}

export function generateIdcaDiagnostics(
  cycle: {
    buyCount: number;
    closeReason: string | null;
    profitCapturePct: number | null;
    mfePnlUsd: number | null;
    givebackUsd: number | null;
    maePnlUsd: number | null;
    capitalUsd: number;
    gridState?: string | null;
    gridPlanCreated?: boolean;
    profitCaptureQuality?: string;
  }
): DiagnosticResult[] {
  const results: DiagnosticResult[] = [];
  const quality = cycle.profitCaptureQuality ?? "reliable";

  // If insufficient data, skip capture-based diagnostics and add info diagnostic
  if (quality === "insufficient_data") {
    results.push({
      code: "PROFIT_CAPTURE_INSUFFICIENT_DATA",
      severity: "info",
      message: "No hay snapshots suficientes para evaluar la eficiencia de salida de este ciclo. La métrica se calculará mejor en ciclos nuevos.",
    });
    // Still check grid state (independent of profit capture)
    if (cycle.gridPlanCreated && cycle.gridState !== "GRID_PLAN_SIMULATED") {
      results.push({
        code: "GRID_NOT_ACTIVE",
        severity: "info",
        message: `Grid observer planificado pero no activo. Estado: ${cycle.gridState ?? "desconocido"}.`,
      });
    }
    return results;
  }

  const pcPct = cycle.profitCapturePct;
  const prefix = quality === "estimated" ? "Estimación orientativa: " : "";

  if (pcPct !== null && pcPct < 25 && (cycle.mfePnlUsd ?? 0) > 1) {
    results.push({
      code: "LOW_PROFIT_CAPTURE",
      severity: "warning",
      message: `${prefix}Ciclo capturó solo el ${pcPct.toFixed(0)}% del MFE. Trailing o salida tardía.`,
    });
  }

  if (cycle.buyCount > 3 && (pcPct ?? 0) < 40) {
    results.push({
      code: "MANY_BUYS_LOW_CAPTURE",
      severity: "warning",
      message: `${cycle.buyCount} compras acumuladas pero bajo profit capture. Avg puede estar demasiado lejos del TP.`,
    });
  }

  if (cycle.gridPlanCreated && cycle.gridState !== "GRID_PLAN_SIMULATED") {
    results.push({
      code: "GRID_NOT_ACTIVE",
      severity: "info",
      message: `Grid observer planificado pero no activo. Estado: ${cycle.gridState ?? "desconocido"}.`,
    });
  }

  if (cycle.closeReason === "BREAK_EVEN" && (cycle.mfePnlUsd ?? 0) > 5) {
    results.push({
      code: "BE_WITH_HIGH_MFE",
      severity: "info",
      message: `Break Even activado con MFE de $${cycle.mfePnlUsd?.toFixed(2)}. Considera trailing más cercano.`,
    });
  }

  if (results.length === 0 && (pcPct ?? 0) >= 70) {
    results.push({
      code: "GOOD_CYCLE",
      severity: "ok",
      message: `${prefix}Ciclo eficiente: capturó el ${(pcPct ?? 0).toFixed(0)}% del beneficio potencial.`,
    });
  }

  return results;
}

// ─── ChatGPT summary generators ───────────────────────────────────────────────

export function generateTradingChatGptSummary(op: {
  id: number | string;
  pair: string;
  mode: string;
  entryDate: string;
  exitDate: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  capitalUsd: number;
  finalPnlUsd: number;
  finalPnlPct: number;
  metrics: TradeEfficiencyMetrics;
  entryReason: string | null;
  exitReason: string | null;
  smartExitActive: boolean;
  timeStopActive: boolean;
  beActive: boolean;
  trailingActive: boolean;
  durationMinutes: number | null;
  diagnostics: DiagnosticResult[];
}): string {
  const lines: string[] = [
    `AUDITORÍA TRADING — ${op.pair} operación #${op.id}`,
    `Modo: ${op.mode}`,
    `Entrada: ${op.entryDate} @ $${op.entryPrice.toFixed(2)} × ${op.quantity} = $${op.capitalUsd.toFixed(2)}`,
    op.exitDate ? `Salida: ${op.exitDate} @ $${op.exitPrice?.toFixed(2) ?? "N/A"}` : `Salida: (abierta)`,
    `PnL final: $${op.finalPnlUsd.toFixed(2)} (${op.finalPnlPct.toFixed(3)}%)`,
    `MFE: ${op.metrics.mfePnlUsd != null ? `$${op.metrics.mfePnlUsd.toFixed(2)}` : "N/A"} (máximo beneficio alcanzado)`,
    `MAE: ${op.metrics.maePnlUsd != null ? `$${op.metrics.maePnlUsd.toFixed(2)}` : "N/A"} (máxima pérdida flotante)`,
    `Giveback: ${op.metrics.givebackUsd != null ? `$${op.metrics.givebackUsd.toFixed(2)}` : "N/A"} (beneficio devuelto)`,
    `Profit Capture: ${op.metrics.profitCapturePct != null ? `${op.metrics.profitCapturePct.toFixed(0)}%` : "N/A"}`,
    `Eficiencia salida: ${op.metrics.exitEfficiency}`,
    `Motivo entrada: ${op.entryReason ?? "—"}`,
    `Motivo salida: ${op.exitReason ?? "—"}`,
    `Smart Exit: ${op.smartExitActive ? "activo" : "no"}`,
    `TimeStop: ${op.timeStopActive ? "activo" : "no"}`,
    `Break Even: ${op.beActive ? "activo" : "no"}`,
    `Trailing: ${op.trailingActive ? "activo" : "no"}`,
    `Duración: ${formatDuration(op.durationMinutes)}`,
    `Diagnóstico automático:`,
    ...op.diagnostics.map(d => `  [${d.severity.toUpperCase()}] ${d.message}`),
  ];
  return lines.join("\n");
}

export function generateIdcaChatGptSummary(cycle: {
  id: number;
  pair: string;
  startDate: string;
  closeDate: string | null;
  buyCount: number;
  capitalUsd: number;
  avgEntryInitial: number | null;
  avgEntryFinal: number | null;
  tpPrice: number | null;
  finalPnlUsd: number;
  metrics: TradeEfficiencyMetrics;
  beActive: boolean;
  trailingActive: boolean;
  gridPlanId: string | null;
  mrDecision: string | null;
  mrRegime: string | null;
  closeReason: string | null;
  durationMinutes: number | null;
  diagnostics: DiagnosticResult[];
}): string {
  const lines: string[] = [
    `AUDITORÍA IDCA — ${cycle.pair} ciclo #${cycle.id}`,
    `Periodo: ${cycle.startDate}${cycle.closeDate ? ` → ${cycle.closeDate}` : " (abierto)"}`,
    `Estado: ${cycle.closeDate ? "cerrado" : "abierto"}`,
    `Compras: ${cycle.buyCount}`,
    `Capital usado: $${cycle.capitalUsd.toFixed(2)}`,
    cycle.avgEntryInitial ? `Avg entrada inicial: $${cycle.avgEntryInitial.toFixed(4)}` : "",
    cycle.avgEntryFinal ? `Avg entrada final: $${cycle.avgEntryFinal.toFixed(4)}` : "",
    cycle.tpPrice ? `TP objetivo: $${cycle.tpPrice.toFixed(4)}` : "",
    `PnL final: $${cycle.finalPnlUsd.toFixed(2)}`,
    `MFE: ${cycle.metrics.mfePnlUsd != null ? `$${cycle.metrics.mfePnlUsd.toFixed(2)}` : "N/A"}`,
    `MAE: ${cycle.metrics.maePnlUsd != null ? `$${cycle.metrics.maePnlUsd.toFixed(2)}` : "N/A"}`,
    `Giveback: ${cycle.metrics.givebackUsd != null ? `$${cycle.metrics.givebackUsd.toFixed(2)}` : "N/A"}`,
    `Profit Capture: ${cycle.metrics.profitCapturePct != null ? `${cycle.metrics.profitCapturePct.toFixed(0)}%` : "N/A"}`,
    `Break Even: ${cycle.beActive ? "armado" : "no"}`,
    `Trailing: ${cycle.trailingActive ? "activo" : "no"}`,
    `Grid Observer: ${cycle.gridPlanId ?? "no activo"}`,
    `Mean Reversion: régimen ${cycle.mrRegime ?? "—"} / decisión: ${cycle.mrDecision ?? "—"}`,
    `Motivo cierre: ${cycle.closeReason ?? "—"}`,
    `Duración: ${formatDuration(cycle.durationMinutes)}`,
    `Diagnóstico automático:`,
    ...cycle.diagnostics.map(d => `  [${d.severity.toUpperCase()}] ${d.message}`),
  ].filter(Boolean);
  return lines.join("\n");
}
