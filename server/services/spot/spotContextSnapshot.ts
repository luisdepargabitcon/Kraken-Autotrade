/**
 * spotContextSnapshot — Builds a serializable snapshot from REAL scan data.
 *
 * CHANGED: This module NO LONGER calls buildSpotMarketContext, evaluateSpotCanonical,
 * evaluateEntryIntent, or evaluateSizing. Those are now called ONLY by the SpotEngine
 * during its real scan. The snapshot is built from the results of that scan and
 * published to spotContextSnapshotStore.
 *
 * The GET /api/spot/context endpoint reads from the store — it never calls this module.
 *
 * INVARIANTS:
 *   - Read-only: never mutates engine state, creates no intents, places no orders.
 *   - No market data fetching, no strategy evaluation, no sizing calculation.
 *   - All data comes from the real scan pipeline results.
 */

import type { SpotMarketContext, SpotEntryIntent, ExecutionMode } from "./spotTypes";
import type { SpotSignalResult } from "./spotCanonicalStrategy";
import type { SizingResult } from "./spotRiskManager";
import type { IntentEvaluationResult } from "./spotEntryIntent";
import { DataHealth } from "./candleTimestamp";
import type { SpotContextSnapshot, SpotDecisionGate, DecisionState } from "./spotContextSnapshotStore";

// ─── Re-exports for convenience ─────────────────────────────────────────────

export type { SpotContextSnapshot, SpotDecisionGate, DecisionState } from "./spotContextSnapshotStore";

// ─── Reason code → Spanish natural language ─────────────────────────────────

const REASON_CODE_ES: Record<string, string> = {
  // Data health
  DATA_STALE: "Los datos de mercado están obsoletos.",
  DATA_INSUFFICIENT: "No hay suficientes datos de mercado para evaluar este par.",
  DATA_GOOD: "Datos de mercado en buen estado.",
  DATA_DEGRADED: "Los datos de mercado están degradados.",

  // Macro
  MACRO_BEARISH: "El sesgo macro en 4 horas es bajista. No se compran activos en contra de la tendencia macro.",
  MACRO_NEUTRAL: "El sesgo macro en 4 horas es neutral.",
  MACRO_BULLISH: "El sesgo macro en 4 horas es alcista.",

  // Regime
  REGIME_NOT_BULLISH_TREND: "El régimen en 1 hora no es una tendencia alcista. Solo se compran en tendencia alcista.",
  REGIME_BEARISH: "El régimen en 1 hora es bajista.",
  REGIME_RANGE: "El régimen en 1 hora es de rango. No hay dirección clara para comprar.",
  REGIME_TRANSITION: "El régimen en 1 hora está en transición. No hay dirección clara para comprar.",

  // Setup
  NO_SETUP_15M: "No se genera una compra: todavía no existe una configuración válida de entrada en 15 minutos.",
  SETUP_DETECTED: "Se ha detectado una configuración de entrada válida en 15 minutos.",

  // Trigger
  NO_TRIGGER_5M: "La configuración en 15 minutos es válida pero el disparador en 5 minutos no confirma la entrada.",
  TRIGGER_CONFIRMED: "El disparador en 5 minutos confirma la entrada.",

  // Intent / anti-late-entry
  TTL_EXPIRED: "La señal expiró por tiempo. Se requiere un nuevo setup válido.",
  MACRO_FLIPPED: "La macro 4H cambió a bajista después de detectar la señal. La intención ha sido invalidada.",
  REGIME_FLIPPED: "El régimen cambió después de detectar la señal. La intención ha sido invalidada.",
  PRICE_MOVE_TOO_FAR: "El precio se alejó demasiado del origen. La intención ha sido invalidada.",
  CHASE_GATE: "No compra porque el precio está demasiado extendido y entrar ahora supondría perseguir el movimiento.",
  ENTRY_GATED: "La intención de entrada está pendiente de verificación.",

  // Sizing
  SIZING_REJECTED: "La gestión de riesgo no aprobó la entrada. El tamaño calculado no cumple los criterios mínimos.",
  SIZING_APPROVED: "La gestión de riesgo aprobó la entrada.",
  SPREAD_TOO_WIDE: "El spread actual es demasiado amplio para ejecutar la entrada de forma segura.",
  CAPITAL_EFFICIENCY_LOW: "La eficiencia de capital es insuficiente para justificar la entrada.",
  FEE_GATE: "Las comisiones actuales hacen que la operación no sea viable.",

  // Execution
  ENTRY_GENERATION_STALE_BLOCKED: "El modo global cambió durante el análisis. No se crea posición bajo un modo obsoleto.",
  SUPERVISOR_UNHEALTHY_BLOCKS_REAL_BUY: "El supervisor de posiciones no está saludable. No se abren nuevas posiciones reales.",
  REAL_OPEN_LOTS_QUERY_FAILED_FAIL_CLOSED: "No se pudo verificar el número de posiciones abiertas. Entrada bloqueada por seguridad.",

  // Signal
  SIGNAL_DETECTED: "Señal de compra detectada.",
  NO_SIGNAL: "No hay señal de compra en este momento.",

  // Intent states
  INTENT_WAITING: "La intención de entrada está en espera — verificando condiciones anti-late-entry.",
  INTENT_APPROVED: "La intención de entrada está aprobada. La ejecución es inminente.",
  INTENT_CHASED: "El precio se movió moderadamente. Actualizando origen y reevaluando.",
  INTENT_CREATED: "La intención de entrada ha sido creada y está siendo evaluada.",

  // Misc
  PAIR_DISABLED: "Desactivado para nuevas entradas.",
  NO_SCAN_YET: "Aún no se ha realizado ningún análisis de mercado para este par.",
  MARKET_CONTEXT_INITIAL: "Contexto de mercado inicial.",
  MARKET_CONTEXT_CHANGED: "El contexto de mercado ha cambiado.",
  SKIPPED: "Omitido — gates superiores no pasaron.",
};

/**
 * Map a reason code to a Spanish natural language explanation.
 * Falls back to the provided English reason if no mapping exists.
 */
export function reasonCodeToSpanish(reasonCode: string | null, fallback: string): string {
  if (!reasonCode) return fallback;
  return REASON_CODE_ES[reasonCode] ?? fallback;
}

// ─── Stage mapping ──────────────────────────────────────────────────────────

function mapGateLevelToStage(level: string): string {
  const map: Record<string, string> = {
    "Data Health": "DATA_HEALTH",
    "Macro 4H": "MACRO_4H",
    "Régimen 1H": "REGIME_1H",
    "Setup 15M": "SETUP_15M",
    "Trigger 5M": "TIMING_5M",
    "Anti-Late-Entry": "ANTI_LATE_ENTRY",
    "Sizing/Risk": "SIZING_RISK",
  };
  return map[level] ?? level;
}

// ─── Snapshot builder ───────────────────────────────────────────────────────

export interface SnapshotBuildContext {
  pair: string;
  scanId: string;
  mode: ExecutionMode;
  enabled: boolean;
  ctx: SpotMarketContext;
  signal: SpotSignalResult;
  intent: SpotEntryIntent | null;
  intentEvaluation: IntentEvaluationResult | null;
  sizing: SizingResult | null;
  blockReasonCode: string | null;
}

/**
 * Build a snapshot from the REAL scan results.
 * This is called by the SpotEngine during scanPair, NOT by the GET endpoint.
 * Pure function: no side effects, no DB, no market data fetching.
 */
export function buildSnapshotFromScanResults(input: SnapshotBuildContext): SpotContextSnapshot {
  const { ctx, signal, intent, intentEvaluation, sizing, blockReasonCode, enabled, scanId, mode } = input;

  const gates: SpotDecisionGate[] = [];

  // Data health gate
  const dataHealthPass = ctx.dataHealth !== DataHealth.STALE && ctx.dataHealth !== DataHealth.INSUFFICIENT;
  gates.push({
    level: "Data Health",
    pass: dataHealthPass,
    reason: `DataHealth=${ctx.dataHealth}`,
    reasonCode: dataHealthPass ? "DATA_GOOD" : `DATA_${ctx.dataHealth}`,
  });

  // Macro 4H gate
  const macroPass = ctx.regimeContext.macroBias !== "BEARISH";
  gates.push({
    level: "Macro 4H",
    pass: macroPass,
    reason: macroPass ? `Macro ${ctx.regimeContext.macroBias}` : "Macro bearish",
    reasonCode: macroPass ? `MACRO_${ctx.regimeContext.macroBias}` : "MACRO_BEARISH",
  });

  // Regime 1H gate
  const regimePass = ctx.regimeContext.regime === "TREND" && ctx.regimeContext.direction === "BULLISH";
  gates.push({
    level: "Régimen 1H",
    pass: regimePass,
    reason: regimePass ? "Tendencia alcista" : `Régimen ${ctx.regimeContext.regime} ${ctx.regimeContext.direction}`,
    reasonCode: regimePass ? "REGIME_BULLISH_TREND" : `REGIME_${ctx.regimeContext.regime}_${ctx.regimeContext.direction}`,
  });

  // Setup 15M gate
  let setup15m: string | null = null;
  if (macroPass && regimePass && dataHealthPass) {
    if (signal.blockReason === "NO_SETUP_15M") {
      gates.push({ level: "Setup 15M", pass: false, reason: signal.reason, reasonCode: "NO_SETUP_15M" });
    } else if (signal.signal === "BUY" || signal.blockReason === "NO_TRIGGER_5M") {
      setup15m = signal.setupTag ? String(signal.setupTag) : "UNKNOWN";
      gates.push({ level: "Setup 15M", pass: true, reason: `Setup ${signal.setupTag} detectado`, reasonCode: "SETUP_DETECTED" });
    } else {
      gates.push({ level: "Setup 15M", pass: false, reason: signal.reason || "No setup", reasonCode: "NO_SETUP_15M" });
    }
  } else {
    gates.push({ level: "Setup 15M", pass: false, reason: "Omitido — gates superiores no pasaron", reasonCode: "SKIPPED" });
  }

  // Trigger 5M gate
  let timing5m: string | null = null;
  if (setup15m !== null) {
    if (signal.blockReason === "NO_TRIGGER_5M") {
      gates.push({ level: "Trigger 5M", pass: false, reason: signal.reason, reasonCode: "NO_TRIGGER_5M" });
    } else if (signal.signal === "BUY") {
      timing5m = "CONFIRMED";
      gates.push({ level: "Trigger 5M", pass: true, reason: "Trigger 5M confirmado", reasonCode: "TRIGGER_CONFIRMED" });
    } else {
      gates.push({ level: "Trigger 5M", pass: false, reason: signal.reason || "No trigger", reasonCode: "NO_TRIGGER_5M" });
    }
  } else {
    gates.push({ level: "Trigger 5M", pass: false, reason: "Omitido — setup no detectado", reasonCode: "SKIPPED" });
  }

  // Anti-Late-Entry gate
  if (intent && intentEvaluation) {
    gates.push({
      level: "Anti-Late-Entry",
      pass: intentEvaluation.shouldExecute,
      reason: intentEvaluation.reason,
      reasonCode: intentEvaluation.shouldExecute ? "INTENT_APPROVED" : (intent.lastBlockReason ?? "ENTRY_GATED"),
    });
  }

  // Sizing/Risk gate
  if (sizing) {
    gates.push({
      level: "Sizing/Risk",
      pass: sizing.approved,
      reason: sizing.approved ? "Sizing aprobado" : (sizing.blockReason ?? sizing.reason),
      reasonCode: sizing.approved ? "SIZING_APPROVED" : (sizing.blockReason ?? "SIZING_REJECTED"),
    });
  }

  // Determine decision state
  const decisionState = determineDecisionState(signal, intent, intentEvaluation, sizing, enabled);
  const lastReachedStage = determineLastReachedStage(gates);
  const primaryGate = gates.find(g => !g.pass) ?? null;

  const primaryReasonCode = blockReasonCode ?? primaryGate?.reasonCode ?? (signal.signal === "BUY" ? "SIGNAL_DETECTED" : "NO_SIGNAL");
  const primaryReasonEs = reasonCodeToSpanish(primaryReasonCode, primaryGate?.reason ?? signal.reason ?? "Sin señal");
  const secondaryReasonsEs = gates
    .filter(g => !g.pass && g !== primaryGate)
    .slice(0, 3)
    .map(g => reasonCodeToSpanish(g.reasonCode ?? "", g.reason));

  const decision = buildDecisionExplanation(
    ctx.pair, decisionState, primaryReasonCode, primaryReasonEs, signal, intent, intentEvaluation,
  );

  return {
    pair: ctx.pair,
    scanId,
    generatedAt: ctx.generatedAt,
    enabled,
    decisionState,
    primaryReasonCode,
    primaryReasonEs,
    secondaryReasonsEs,
    lastReachedStage,
    dataHealth: String(ctx.dataHealth),
    macro4h: String(ctx.regimeContext.macroBias),
    regime1h: `${ctx.regimeContext.regime} ${ctx.regimeContext.direction}`,
    setup15m,
    timing5m,
    spread: ctx.spreadPct,
    gates,
    macroBias: String(ctx.regimeContext.macroBias),
    regime: String(ctx.regimeContext.regime),
    direction: String(ctx.regimeContext.direction),
    volatility: String(ctx.regimeContext.volatility),
    adx: ctx.regimeContext.adx,
    ema20: ctx.regimeContext.ema20,
    ema50: ctx.regimeContext.ema50,
    ema200: ctx.regimeContext.ema200,
    emaAlignment: ctx.regimeContext.emaAlignment,
    bollingerWidth: ctx.regimeContext.bollingerWidth,
    atrPct: ctx.regimeContext.atrPct,
    confidence: ctx.regimeContext.confidence,
    price: ctx.ticker.last,
    bid: ctx.ticker.bid,
    ask: ctx.ticker.ask,
    spreadPct: ctx.spreadPct,
    volumeRatio: ctx.volumeMetrics.volumeRatio,
    volume24h: ctx.volumeMetrics.volume24h,
    participation: ctx.volumeMetrics.participation,
    signal: signal.signal,
    setupTag: signal.setupTag ? String(signal.setupTag) : null,
    signalReason: signal.reason,
    signalConfidence: signal.confidence,
    blockReason: signal.blockReason,
    decisionTitle: decision.title,
    decisionExplanation: decision.explanation,
    decisionColor: decision.color,
    hasActiveIntent: intent !== null && intent.state !== "EXECUTED" && intent.state !== "EXPIRED" && intent.state !== "INVALIDATED" && intent.state !== "CANCELLED",
    intentState: intent?.state ?? null,
    intentLastBlockReason: intent?.lastBlockReason ?? null,
    intentCreatedAt: intent?.createdAt ?? null,
    intentExpiresAt: intent?.expiresAt ?? null,
    marketContextId: ctx.marketContextId,
    regimeId: ctx.regimeContext.regimeId,
    mode: String(mode),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function determineDecisionState(
  signal: SpotSignalResult,
  intent: SpotEntryIntent | null,
  intentEvaluation: IntentEvaluationResult | null,
  sizing: SizingResult | null,
  enabled: boolean,
): DecisionState {
  if (!enabled) return "DISABLED";
  if (signal.signal === "BUY" && sizing?.approved) return "APPROVED";
  if (signal.signal === "BUY") return "CANDIDATE";
  if (intent && intentEvaluation) {
    if (intentEvaluation.shouldExecute) return "APPROVED";
    return "WAITING";
  }
  return "BLOCKED";
}

function determineLastReachedStage(gates: SpotDecisionGate[]): string {
  let lastReached = "NONE";
  for (const gate of gates) {
    if (gate.pass) {
      lastReached = mapGateLevelToStage(gate.level);
    } else {
      break;
    }
  }
  return lastReached;
}

function buildDecisionExplanation(
  pair: string,
  state: DecisionState,
  primaryReasonCode: string,
  primaryReasonEs: string,
  signal: SpotSignalResult,
  intent: SpotEntryIntent | null,
  intentEvaluation: IntentEvaluationResult | null,
): { title: string; explanation: string; color: "green" | "red" | "amber" | "violet" | "cyan" | "gray" } {
  if (state === "DISABLED") {
    return {
      title: "Desactivado",
      explanation: "Este par está desactivado para nuevas entradas. Las posiciones existentes continúan bajo supervisión.",
      color: "gray",
    };
  }

  if (state === "APPROVED") {
    return {
      title: "Compra aprobada",
      explanation: `Señal de compra aprobada para ${pair}. Setup ${signal.setupTag} con confianza ${(signal.confidence * 100).toFixed(0)}%. Ejecución inminente.`,
      color: "green",
    };
  }

  if (state === "CANDIDATE") {
    if (intent && intentEvaluation?.shouldExecute) {
      return {
        title: "Compra aprobada",
        explanation: `Señal de compra aprobada para ${pair}. Ejecución inminente.`,
        color: "green",
      };
    }
    if (intent && intent.state === "WAITING") {
      return {
        title: "Esperando confirmación de entrada",
        explanation: `Señal de compra detectada (${signal.setupTag}) para ${pair}. La intención está en espera — verificando condiciones anti-late-entry.`,
        color: "amber",
      };
    }
    if (intent && intent.state === "CHASED") {
      return {
        title: "Persiguiendo entrada",
        explanation: `Señal de compra detectada para ${pair} pero el precio se movió moderadamente. Actualizando origen y reevaluando.`,
        color: "amber",
      };
    }
    return {
      title: "Señal de compra detectada",
      explanation: `Setup ${signal.setupTag} detectado para ${pair} con confianza ${(signal.confidence * 100).toFixed(0)}%. ${signal.reason}`,
      color: "green",
    };
  }

  if (state === "WAITING") {
    return {
      title: "Entrada pendiente",
      explanation: primaryReasonEs,
      color: "amber",
    };
  }

  // BLOCKED
  if (primaryReasonCode.startsWith("DATA_")) {
    return { title: "Datos insuficientes", explanation: primaryReasonEs, color: "red" };
  }
  if (primaryReasonCode.startsWith("MACRO_")) {
    return { title: "Macro 4H desfavorable", explanation: primaryReasonEs, color: "red" };
  }
  if (primaryReasonCode.startsWith("REGIME_")) {
    return { title: "Régimen 1H no propicio", explanation: primaryReasonEs, color: "violet" };
  }
  if (primaryReasonCode === "NO_SETUP_15M") {
    return { title: "Sin configuración en 15M", explanation: primaryReasonEs, color: "amber" };
  }
  if (primaryReasonCode === "NO_TRIGGER_5M") {
    return { title: "Confirmación 5M no alcanzada", explanation: primaryReasonEs, color: "amber" };
  }
  if (primaryReasonCode === "CHASE_GATE") {
    return { title: "Precio extendido", explanation: primaryReasonEs, color: "amber" };
  }
  if (primaryReasonCode.startsWith("SIZING_") || primaryReasonCode.startsWith("SPREAD_") || primaryReasonCode.startsWith("FEE_")) {
    return { title: "Rechazado por gestión de riesgo", explanation: primaryReasonEs, color: "red" };
  }
  if (primaryReasonCode === "TTL_EXPIRED") {
    return { title: "Señal expirada", explanation: primaryReasonEs, color: "gray" };
  }
  if (primaryReasonCode === "MACRO_FLIPPED" || primaryReasonCode === "REGIME_FLIPPED" || primaryReasonCode === "PRICE_MOVE_TOO_FAR") {
    return { title: "Intención invalidada", explanation: primaryReasonEs, color: "red" };
  }

  return { title: "Sin compra", explanation: primaryReasonEs, color: "gray" };
}
