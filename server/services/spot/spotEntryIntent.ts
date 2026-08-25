/**
 * SpotEntryIntentManager — Anti-late-entry enforcement for SPOT.
 *
 * PROBLEM (FASE 1 audit):
 *   - EntryDecisionContext.ts has NO anti-late-entry logic.
 *   - Current engine uses `intermediateExec` bypass to "chase" entries.
 *   - No TTL on signals. A signal from 30 min ago can still trigger an entry.
 *   - No origin snapshot. Price can move 5% and entry still happens at "market".
 *
 * SOLUTION:
 *   SpotEntryIntent is a state machine:
 *     CREATED → WAITING → APPROVED → EXECUTED
 *     CREATED → WAITING → EXPIRED (TTL)
 *     CREATED → WAITING → INVALIDATED (setup no longer valid)
 *     CREATED → WAITING → CHASED → APPROVED/EXPIRED
 *
 *   The intent freezes the origin snapshot at signal time. On each evaluation:
 *     1. Check TTL (max 2 candles after signal = 30 min for 15m)
 *     2. Check price hasn't moved too far from origin (max 1.5 ATR)
 *     3. Check regime/direction haven't flipped
 *     4. Check macro hasn't turned bearish
 *     5. If all pass → APPROVED (ready for execution)
 *     6. If price moved moderately → CHASED (update origin, retry)
 *     7. If price moved too far or regime flipped → INVALIDATED
 *
 * INVARIANT: No entry without a valid, non-expired SpotEntryIntent.
 */

import {
  EntryIntentState,
  Regime,
  RegimeDirection,
  MacroBias,
  SetupTag,
  type SpotEntryIntent,
  type SpotMarketContext,
} from "./spotTypes";
import type { SpotSignalResult } from "./spotCanonicalStrategy";

// ─── Config ─────────────────────────────────────────────────────────────────

export interface AntiLateEntryConfig {
  /** Max candles after signal before expiry (default 2 = 30 min for 15m). */
  maxCandlesAfterSignal: number;
  /** Max price movement from origin in ATR units before invalidation. */
  maxPriceMoveAtr: number;
  /** Max price movement for chase (moderate move, update origin). */
  chaseThresholdAtr: number;
  /** Candle interval in ms (15m default). */
  candleIntervalMs: number;
}

export const DEFAULT_ANTI_LATE_ENTRY_CONFIG: AntiLateEntryConfig = {
  maxCandlesAfterSignal: 2,
  maxPriceMoveAtr: 1.5,
  chaseThresholdAtr: 0.75,
  candleIntervalMs: 15 * 60 * 1000,
};

// ─── Intent creation ────────────────────────────────────────────────────────

/**
 * Create a new SpotEntryIntent from a SPOT_CANONICAL signal.
 * Freezes the origin snapshot at signal time.
 */
export function createEntryIntent(
  signal: SpotSignalResult,
  ctx: SpotMarketContext,
  config: AntiLateEntryConfig = DEFAULT_ANTI_LATE_ENTRY_CONFIG,
  nowMs?: number,
): SpotEntryIntent {
  const now = nowMs ?? Date.now();
  const ttlMs = config.maxCandlesAfterSignal * config.candleIntervalMs;

  return {
    signalId: `intent-${ctx.pair}-${now.toString(36)}-${Math.abs(hash(signal.contextId + now)).toString(36)}`,
    pair: ctx.pair,
    setupTag: signal.setupTag ?? SetupTag.PULLBACK_CONTINUATION,
    createdAt: now,
    expiresAt: now + ttlMs,
    state: EntryIntentState.WAITING,
    origin15mOpenAt: signal.origin15mCloseAt - config.candleIntervalMs,
    origin15mCloseAt: signal.origin15mCloseAt,
    originPrice: signal.originPrice,
    originClose: signal.originPrice,
    originAtrPct: signal.originAtrPct,
    originRegime: ctx.regimeContext.regime,
    originDirection: ctx.regimeContext.direction,
    originMacro: ctx.regimeContext.macroBias,
    originVolume: signal.originVolume,
    originContextId: signal.contextId,
    retryCount: 0,
    initialBlockReason: signal.blockReason,
    lastBlockReason: null,
    lastEvaluatedAt: null,
  };
}

// ─── Intent evaluation ──────────────────────────────────────────────────────

export interface IntentEvaluationResult {
  newState: EntryIntentState;
  reason: string;
  shouldExecute: boolean;
  updatedIntent: SpotEntryIntent;
}

/**
 * Evaluate an entry intent against the current market context.
 * Determines if the intent is still valid, should be executed, chased, or invalidated.
 */
export function evaluateEntryIntent(
  intent: SpotEntryIntent,
  ctx: SpotMarketContext,
  config: AntiLateEntryConfig = DEFAULT_ANTI_LATE_ENTRY_CONFIG,
  nowMs?: number,
): IntentEvaluationResult {
  const now = nowMs ?? Date.now();
  const updatedIntent: SpotEntryIntent = {
    ...intent,
    lastEvaluatedAt: now,
  };

  // Already terminal states
  if (intent.state === EntryIntentState.EXECUTED ||
      intent.state === EntryIntentState.EXPIRED ||
      intent.state === EntryIntentState.INVALIDATED ||
      intent.state === EntryIntentState.CANCELLED) {
    return {
      newState: intent.state,
      reason: `Intent already in terminal state: ${intent.state}`,
      shouldExecute: false,
      updatedIntent,
    };
  }

  // 1. TTL check
  if (now > intent.expiresAt) {
    updatedIntent.state = EntryIntentState.EXPIRED;
    updatedIntent.lastBlockReason = "TTL_EXPIRED";
    return {
      newState: EntryIntentState.EXPIRED,
      reason: `Intent expired (TTL ${config.maxCandlesAfterSignal} candles)`,
      shouldExecute: false,
      updatedIntent,
    };
  }

  // 2. Price movement check
  const currentPrice = ctx.ticker.last;
  const priceMoveUsd = Math.abs(currentPrice - intent.originPrice);
  const atrUsd = intent.originPrice > 0 && intent.originAtrPct > 0
    ? (intent.originAtrPct / 100) * intent.originPrice
    : 0;
  const priceMoveAtr = atrUsd > 0 ? priceMoveUsd / atrUsd : 0;

  // 3. Regime flip check
  const regimeFlipped = ctx.regimeContext.regime !== intent.originRegime;
  const directionFlipped = ctx.regimeContext.direction !== intent.originDirection;
  const macroFlippedBearish = ctx.regimeContext.macroBias === MacroBias.BEARISH &&
    intent.originMacro !== MacroBias.BEARISH;

  // 4. Macro turned bearish → invalidate immediately
  if (macroFlippedBearish) {
    updatedIntent.state = EntryIntentState.INVALIDATED;
    updatedIntent.lastBlockReason = "MACRO_FLIPPED_BEARISH";
    return {
      newState: EntryIntentState.INVALIDATED,
      reason: "Macro 4h turned bearish after signal",
      shouldExecute: false,
      updatedIntent,
    };
  }

  // 5. Regime/direction flip → invalidate
  if (regimeFlipped || directionFlipped) {
    updatedIntent.state = EntryIntentState.INVALIDATED;
    updatedIntent.lastBlockReason = `REGIME_FLIPPED: ${intent.originRegime}/${intent.originDirection} → ${ctx.regimeContext.regime}/${ctx.regimeContext.direction}`;
    return {
      newState: EntryIntentState.INVALIDATED,
      reason: `Régimen/dirección flip: ${intent.originRegime}/${intent.originDirection} → ${ctx.regimeContext.regime}/${ctx.regimeContext.direction}`,
      shouldExecute: false,
      updatedIntent,
    };
  }

  // 6. Price moved too far → invalidate
  if (priceMoveAtr > config.maxPriceMoveAtr) {
    updatedIntent.state = EntryIntentState.INVALIDATED;
    updatedIntent.lastBlockReason = `PRICE_MOVE_TOO_FAR: ${priceMoveAtr.toFixed(2)} ATR`;
    return {
      newState: EntryIntentState.INVALIDATED,
      reason: `Precio movió ${priceMoveAtr.toFixed(2)} ATR desde origen (max ${config.maxPriceMoveAtr})`,
      shouldExecute: false,
      updatedIntent,
    };
  }

  // 7. Moderate price move → chase (update origin, retry)
  if (priceMoveAtr > config.chaseThresholdAtr) {
    updatedIntent.state = EntryIntentState.CHASED;
    updatedIntent.retryCount = intent.retryCount + 1;
    updatedIntent.originPrice = currentPrice; // update origin to current price
    updatedIntent.lastBlockReason = `CHASED: ${priceMoveAtr.toFixed(2)} ATR`;
    return {
      newState: EntryIntentState.CHASED,
      reason: `Chase: precio movió ${priceMoveAtr.toFixed(2)} ATR, actualizando origen`,
      shouldExecute: false, // chase doesn't execute immediately, re-evaluate next cycle
      updatedIntent,
    };
  }

  // 8. All checks pass → APPROVED (ready for execution)
  updatedIntent.state = EntryIntentState.APPROVED;
  updatedIntent.lastBlockReason = null;
  return {
    newState: EntryIntentState.APPROVED,
    reason: `Intent approved: price ${priceMoveAtr.toFixed(2)} ATR from origin, regime stable`,
    shouldExecute: true,
    updatedIntent,
  };
}

// ─── Intent store (in-memory) ───────────────────────────────────────────────

/**
 * In-memory intent store. One active intent per pair.
 * In production, this would be backed by DB for crash recovery.
 */
export class SpotEntryIntentStore {
  private intents = new Map<string, SpotEntryIntent>();

  /** Get active intent for a pair. */
  get(pair: string): SpotEntryIntent | null {
    return this.intents.get(pair) ?? null;
  }

  /** Create or replace intent for a pair. */
  put(intent: SpotEntryIntent): void {
    this.intents.set(intent.pair, intent);
  }

  /** Remove intent for a pair (after execution or invalidation). */
  remove(pair: string): void {
    this.intents.delete(pair);
  }

  /** Update intent state. */
  update(intent: SpotEntryIntent): void {
    this.intents.set(intent.pair, intent);
  }

  /** Get all active intents. */
  getAll(): SpotEntryIntent[] {
    return Array.from(this.intents.values());
  }

  /** Clear expired/invalidated intents. */
  cleanup(): number {
    let removed = 0;
    for (const [pair, intent] of this.intents) {
      if (intent.state === EntryIntentState.EXPIRED ||
          intent.state === EntryIntentState.INVALIDATED ||
          intent.state === EntryIntentState.EXECUTED ||
          intent.state === EntryIntentState.CANCELLED) {
        this.intents.delete(pair);
        removed++;
      }
    }
    return removed;
  }

  /** Check if a pair has an active (non-terminal) intent. */
  hasActive(pair: string): boolean {
    const intent = this.intents.get(pair);
    if (!intent) return false;
    return intent.state === EntryIntentState.WAITING ||
           intent.state === EntryIntentState.CHASED ||
           intent.state === EntryIntentState.APPROVED;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}
