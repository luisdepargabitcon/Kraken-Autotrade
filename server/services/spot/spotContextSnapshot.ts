/**
 * spotContextSnapshot — Canonical market context snapshot for SPOT UI.
 *
 * Produces a serializable snapshot per pair that includes:
 *   - Market context (regime, direction, macro, dataHealth, ticker, ATR, volume)
 *   - Current decision (BUY/NONE with primary + secondary reasons)
 *   - Active intent state if any
 *
 * INVARIANTS:
 *   - Read-only: never mutates engine state, creates no intents, places no orders.
 *   - Reuses canonical functions: buildSpotMarketContext, evaluateSpotCanonical,
 *     evaluateEntryIntent, evaluateSizing.
 *   - No reimplementation of calculations.
 */

import { buildSpotMarketContext } from "./spotMarketContext";
import {
  evaluateSpotCanonical,
  evaluate4hMacro,
  evaluate1hRegime,
  type SpotSignalResult,
} from "./spotCanonicalStrategy";
import { evaluateEntryIntent } from "./spotEntryIntent";
import { evaluateSizing, DEFAULT_SPOT_RISK_CONFIG } from "./spotRiskManager";
import { isEntryAllowedByRegime } from "./spotRegimeEngine";
import type { SpotMarketContext, SpotEntryIntent } from "./spotTypes";
import { DataHealth } from "./candleTimestamp";
import { getIntentStore } from "./spotEngine";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SpotDecisionReason {
  level: string;
  pass: boolean;
  reason: string;
}

export interface SpotContextSnapshot {
  pair: string;
  generatedAt: number;
  // Market context
  dataHealth: string;
  macroBias: string;
  regime: string;
  direction: string;
  volatility: string;
  adx: number;
  ema20: number;
  ema50: number;
  ema200: number;
  emaAlignment: string;
  bollingerWidth: number;
  atrPct: number;
  confidence: number;
  // Ticker
  price: number;
  bid: number;
  ask: number;
  spreadPct: number;
  // Volume
  volumeRatio: number;
  volume24h: number;
  participation: string;
  // Decision
  signal: "BUY" | "NONE";
  setupTag: string | null;
  signalReason: string;
  signalConfidence: number;
  blockReason: string | null;
  // Decision explanation (natural language Spanish)
  decisionTitle: string;
  decisionExplanation: string;
  decisionColor: "green" | "red" | "amber" | "violet" | "cyan" | "gray";
  // Gate breakdown
  gates: SpotDecisionReason[];
  // Active intent
  hasActiveIntent: boolean;
  intentState: string | null;
  intentLastBlockReason: string | null;
  intentCreatedAt: number | null;
  intentExpiresAt: number | null;
  // Context IDs for traceability
  marketContextId: string;
  regimeId: string;
}

// ─── Decision explanation (Spanish natural language) ────────────────────────

function buildDecisionExplanation(
  ctx: SpotMarketContext,
  signal: SpotSignalResult,
  gates: SpotDecisionReason[],
  hasActiveIntent: boolean,
  intentState: string | null,
  intentLastBlockReason: string | null,
): { title: string; explanation: string; color: "green" | "red" | "amber" | "violet" | "cyan" | "gray" } {
  // BUY signal
  if (signal.signal === "BUY") {
    if (hasActiveIntent && intentState === "APPROVED") {
      return {
        title: "Comprando",
        explanation: `Señal de compra aprobada para ${ctx.pair}. Setup ${signal.setupTag} con confianza ${(signal.confidence * 100).toFixed(0)}%. Ejecución inminente.`,
        color: "green",
      };
    }
    if (hasActiveIntent && intentState === "WAITING") {
      return {
        title: "Esperando confirmación de entrada",
        explanation: `Señal de compra detectada (${signal.setupTag}) para ${ctx.pair}. Intent en espera — verificando condiciones anti-late-entry.`,
        color: "amber",
      };
    }
    if (hasActiveIntent && intentState === "CHASED") {
      return {
        title: "Persiguiendo entrada",
        explanation: `Señal de compra detectada para ${ctx.pair} pero el precio se movió moderadamente. Actualizando origen y reevaluando.`,
        color: "amber",
      };
    }
    return {
      title: "Señal de compra detectada",
      explanation: `Setup ${signal.setupTag} detectado para ${ctx.pair} con confianza ${(signal.confidence * 100).toFixed(0)}%. ${signal.reason}`,
      color: "green",
    };
  }

  // NONE signal — explain why
  const failedGates = gates.filter(g => !g.pass);

  if (failedGates.length === 0) {
    return {
      title: "Sin señal",
      explanation: `No hay setup válido para ${ctx.pair} en este momento.`,
      color: "gray",
    };
  }

  const primary = failedGates[0];
  const secondary = failedGates.slice(1, 3);

  // Data health
  if (primary.level === "Data Health") {
    return {
      title: "Datos de mercado insuficientes",
      explanation: `No se puede evaluar ${ctx.pair}: ${primary.reason}. No hay compras hasta que los datos se recuperen.`,
      color: "red",
    };
  }

  // Macro
  if (primary.level === "Macro 4H") {
    return {
      title: "Macro 4H desfavorable",
      explanation: `Sesgo macro bearish en 4H para ${ctx.pair}. No se compran activos en contra de la tendencia macro.`,
      color: "red",
    };
  }

  // Regime
  if (primary.level === "Régimen 1H") {
    return {
      title: "Régimen 1H no propicio",
      explanation: `Régimen ${ctx.regimeContext.regime} ${ctx.regimeContext.direction} en 1H para ${ctx.pair}. ${primary.reason}. Solo se compra en trend bullish.`,
      color: "violet",
    };
  }

  // Setup
  if (primary.level === "Setup 15M") {
    return {
      title: "Sin setup en 15M",
      explanation: `No se detectó setup de pullback o breakout en 15M para ${ctx.pair}. ${primary.reason}.`,
      color: "amber",
    };
  }

  // Trigger
  if (primary.level === "Trigger 5M") {
    return {
      title: "Trigger 5M no confirmado",
      explanation: `Setup detectado en 15M pero el trigger 5M no confirma para ${ctx.pair}. ${primary.reason}.`,
      color: "amber",
    };
  }

  // Intent gates
  if (primary.level === "Anti-Late-Entry") {
    if (intentLastBlockReason === "TTL_EXPIRED") {
      return {
        title: "Señal expirada",
        explanation: `La señal para ${ctx.pair} expiró por tiempo. Se requiere un nuevo setup válido.`,
        color: "gray",
      };
    }
    if (intentLastBlockReason?.startsWith("MACRO_FLIPPED")) {
      return {
        title: "Macro giró bearish",
        explanation: `La macro 4H cambió a bearish después de la señal para ${ctx.pair}. Intent invalidado.`,
        color: "red",
      };
    }
    if (intentLastBlockReason?.startsWith("REGIME_FLIPPED")) {
      return {
        title: "Régimen cambió",
        explanation: `El régimen/dirección cambió después de la señal para ${ctx.pair}. Intent invalidado.`,
        color: "red",
      };
    }
    if (intentLastBlockReason?.startsWith("PRICE_MOVE_TOO_FAR")) {
      return {
        title: "Precio se alejó demasiado",
        explanation: `El precio se movió más de 1.5 ATR desde el origen para ${ctx.pair}. Intent invalidado.`,
        color: "red",
      };
    }
    return {
      title: "Entrada pendiente",
      explanation: `Intent en estado ${intentState} para ${ctx.pair}. ${intentLastBlockReason ?? "Esperando condiciones."}`,
      color: "amber",
    };
  }

  // Sizing gates
  if (primary.level === "Sizing/Risk") {
    return {
      title: "Entrada rechazada por riesgo",
      explanation: `Sizing no aprobado para ${ctx.pair}. ${primary.reason}.`,
      color: "red",
    };
  }

  // Generic fallback
  const secondaryText = secondary.length > 0
    ? ` Motivos secundarios: ${secondary.map(g => g.reason).join("; ")}.`
    : "";
  return {
    title: "Sin compra",
    explanation: `No se compra ${ctx.pair}: ${primary.reason}.${secondaryText}`,
    color: "gray",
  };
}

// ─── Snapshot builder ───────────────────────────────────────────────────────

/**
 * Build a complete context snapshot for a single pair.
 * Read-only: does not mutate engine state.
 */
export async function buildSpotContextSnapshot(
  pair: string,
  availableCapitalUsd?: number,
): Promise<SpotContextSnapshot> {
  // 1. Build market context (canonical)
  const ctx = await buildSpotMarketContext({ pair });

  // 2. Evaluate strategy (canonical)
  const signal = evaluateSpotCanonical(ctx);

  // 3. Build gate breakdown
  const gates: SpotDecisionReason[] = [];

  // Data health gate
  const dataHealthPass = ctx.dataHealth !== DataHealth.STALE && ctx.dataHealth !== DataHealth.INSUFFICIENT;
  gates.push({
    level: "Data Health",
    pass: dataHealthPass,
    reason: `DataHealth=${ctx.dataHealth}`,
  });

  // 4H Macro
  const macro = evaluate4hMacro(ctx);
  gates.push({ level: "Macro 4H", pass: macro.pass, reason: macro.reason });

  // 1H Regime
  const regime = evaluate1hRegime(ctx);
  gates.push({ level: "Régimen 1H", pass: regime.pass, reason: regime.reason });

  // 15M Setup (only evaluate if macro+regime pass)
  if (macro.pass && regime.pass && dataHealthPass) {
    // Reuse the signal's internal evaluation — if signal is NONE with blockReason NO_SETUP_15M,
    // the setup failed. If blockReason is NO_TRIGGER_5M, setup passed but trigger failed.
    if (signal.blockReason === "NO_SETUP_15M") {
      gates.push({ level: "Setup 15M", pass: false, reason: signal.reason });
    } else if (signal.blockReason === "NO_TRIGGER_5M") {
      gates.push({ level: "Setup 15M", pass: true, reason: `Setup ${signal.setupTag} detectado` });
      gates.push({ level: "Trigger 5M", pass: false, reason: signal.reason });
    } else if (signal.signal === "BUY") {
      gates.push({ level: "Setup 15M", pass: true, reason: `Setup ${signal.setupTag} detectado` });
      gates.push({ level: "Trigger 5M", pass: true, reason: "Trigger 5M confirmado" });
    } else {
      gates.push({ level: "Setup 15M", pass: false, reason: signal.reason || "No setup" });
    }
  } else {
    gates.push({ level: "Setup 15M", pass: false, reason: "Omitido — gates superiores no pasaron" });
    gates.push({ level: "Trigger 5M", pass: false, reason: "Omitido — gates superiores no pasaron" });
  }

  // 4. Check active intent
  const intentStore = getIntentStore();
  const activeIntent = intentStore.get(pair);
  const hasActiveIntent = activeIntent !== null &&
    activeIntent.state !== "EXECUTED" &&
    activeIntent.state !== "EXPIRED" &&
    activeIntent.state !== "INVALIDATED" &&
    activeIntent.state !== "CANCELLED";

  let intentState: string | null = null;
  let intentLastBlockReason: string | null = null;
  let intentCreatedAt: number | null = null;
  let intentExpiresAt: number | null = null;

  if (activeIntent) {
    intentState = activeIntent.state;
    intentLastBlockReason = activeIntent.lastBlockReason;
    intentCreatedAt = activeIntent.createdAt;
    intentExpiresAt = activeIntent.expiresAt;

    // If there's an active intent, evaluate it
    if (hasActiveIntent) {
      const evaluation = evaluateEntryIntent(activeIntent, ctx);
      gates.push({
        level: "Anti-Late-Entry",
        pass: evaluation.shouldExecute,
        reason: evaluation.reason,
      });

      // If intent is approved, check sizing
      if (evaluation.shouldExecute && availableCapitalUsd !== undefined) {
        const sizing = evaluateSizing(ctx, activeIntent, availableCapitalUsd, 0, DEFAULT_SPOT_RISK_CONFIG);
        gates.push({
          level: "Sizing/Risk",
          pass: sizing.approved,
          reason: sizing.approved ? "Sizing aprobado" : (sizing.blockReason ?? sizing.reason),
        });
      }
    }
  }

  // 5. Build decision explanation
  const decision = buildDecisionExplanation(
    ctx,
    signal,
    gates,
    hasActiveIntent,
    intentState,
    intentLastBlockReason,
  );

  return {
    pair: ctx.pair,
    generatedAt: ctx.generatedAt,
    dataHealth: String(ctx.dataHealth),
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
    gates,
    hasActiveIntent,
    intentState,
    intentLastBlockReason,
    intentCreatedAt,
    intentExpiresAt,
    marketContextId: ctx.marketContextId,
    regimeId: ctx.regimeContext.regimeId,
  };
}

/**
 * Build snapshots for multiple pairs in parallel.
 */
export async function buildSpotContextSnapshots(
  pairs: string[],
  availableCapitalUsd?: number,
): Promise<SpotContextSnapshot[]> {
  const results = await Promise.allSettled(
    pairs.map(p => buildSpotContextSnapshot(p, availableCapitalUsd)),
  );
  const snapshots: SpotContextSnapshot[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      snapshots.push(r.value);
    } else {
      // Error — emit a minimal error snapshot
      snapshots.push({
        pair: pairs[i],
        generatedAt: Date.now(),
        dataHealth: "ERROR",
        macroBias: "UNKNOWN",
        regime: "UNKNOWN",
        direction: "UNKNOWN",
        volatility: "UNKNOWN",
        adx: 0, ema20: 0, ema50: 0, ema200: 0,
        emaAlignment: "unknown",
        bollingerWidth: 0, atrPct: 0, confidence: 0,
        price: 0, bid: 0, ask: 0, spreadPct: 0,
        volumeRatio: 0, volume24h: 0, participation: "UNKNOWN",
        signal: "NONE", setupTag: null,
        signalReason: "Error building context",
        signalConfidence: 0,
        blockReason: "CONTEXT_ERROR",
        decisionTitle: "Error de contexto",
        decisionExplanation: `No se pudo construir el contexto de mercado para ${pairs[i]}: ${(r.reason as Error)?.message ?? "error desconocido"}`,
        decisionColor: "red",
        gates: [],
        hasActiveIntent: false,
        intentState: null,
        intentLastBlockReason: null,
        intentCreatedAt: null,
        intentExpiresAt: null,
        marketContextId: "",
        regimeId: "",
      });
    }
  }
  return snapshots;
}
