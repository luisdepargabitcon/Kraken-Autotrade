/**
 * TrailingBuyManager — Inverse trailing stop for IDCA entries.
 *
 * Flujo correcto:
 *   1. referencePrice = precio de referencia del nivel (ancla o nivel ladder)
 *   2. activationPrice = referencePrice * (1 - minDipPct/100)
 *      → el TB solo se arma cuando currentPrice <= activationPrice
 *   3. Mientras price > activationPrice: estado WATCHING (no armado)
 *   4. Al armar: trackear localLow y reboundTriggerPrice = localLow*(1+trailingPct/100)
 *   5. Compra solo cuando currentPrice >= reboundTriggerPrice (+ revalidación condiciones)
 *
 * Estado efímero (en memoria). Si el bot reinicia, el siguiente tick recalcula.
 */

export interface TrailingBuyState {
  pair: string;
  armed: boolean;
  armedAt: number;              // epoch ms when trailing buy was armed
  referencePrice: number;       // effectiveEntryReference (frozenAnchorPrice o hybrid_v2)
  activationPrice: number;      // alias de buyThreshold (retrocompatibilidad)
  buyThreshold: number;         // referencePrice * (1 - minDipPct/100) — precio de activación real
  maxExecutionPrice: number;    // buyThreshold * (1 + maxOvershootPct/100) — límite post-rebote
  triggerPrice: number;         // alias de referencePrice (retrocompatibilidad)
  localLow: number;             // tracked local low since arming
  localLowAt: number;           // epoch ms when localLow was last updated
  trailingPct: number;          // the bounce % required to trigger (e.g. 0.3%)
  maxDurationMs: number;        // max time to wait before expiring
  lastPrice: number;            // last price update
  lastUpdateAt: number;         // epoch ms of last price update
  // Level 1 extensions
  triggerLevel: number;         // Which ladder level triggers this trailing (0 = base, 1+ = safety)
  triggerMode: "dip_pct" | "atrp_multiplier";
  atrpMultiplier?: number;
  cancelOnRecovery: boolean;
  recoveryThreshold: number;    // Price threshold for cancellation
}

/**
 * Helper: calcula el activationPrice a partir del referencePrice y minDipPct.
 * activationPrice = referencePrice * (1 - minDipPct / 100)
 * Ejemplo: referencePrice=2404.66, minDipPct=3.5 → activationPrice=2320.50
 */
export function computeActivationPrice(referencePrice: number, minDipPct: number): number {
  return referencePrice * (1 - minDipPct / 100);
}

/**
 * Devuelve el reboundTriggerPrice dado un localLow y trailingPct.
 * reboundTriggerPrice = localLow * (1 + trailingPct / 100)
 */
export function computeReboundTriggerPrice(localLow: number, trailingPct: number): number {
  return localLow * (1 + trailingPct / 100);
}

export interface TrailingBuyTrigger {
  triggered: boolean;
  buyPrice: number;
  localLow: number;
  bouncePct: number;
  reason: string;
  buyThreshold?: number;        // precio al que se armó el TB
  maxExecutionPrice?: number;   // límite máximo de ejecución post-rebote
}

const DEFAULT_TRAILING_PCT = 0.5;       // 0.5% bounce from low triggers buy
const DEFAULT_MAX_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours max

class TrailingBuyManagerClass {
  private states = new Map<string, TrailingBuyState>();

  /**
   * Arm trailing buy for a pair. Called when entry conditions are met
   * but we want to wait for the best price.
   */
  arm(pair: string, triggerPrice: number, currentPrice: number, opts?: {
    trailingPct?: number;
    maxDurationMs?: number;
  }): void {
    const now = Date.now();
    const trailingPct = opts?.trailingPct ?? DEFAULT_TRAILING_PCT;
    const reboundTriggerPrice = currentPrice * (1 + trailingPct / 100);
    this.states.set(pair, {
      pair,
      armed: true,
      armedAt: now,
      referencePrice: triggerPrice,
      activationPrice: triggerPrice, // En VWAP-path, lowerBand1 ya ES el activation price
      buyThreshold: triggerPrice,    // mismo valor en VWAP-path
      maxExecutionPrice: triggerPrice * (1 + (opts?.trailingPct ?? DEFAULT_TRAILING_PCT) / 100),
      triggerPrice,
      localLow: currentPrice,
      localLowAt: now,
      trailingPct,
      maxDurationMs: opts?.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
      lastPrice: currentPrice,
      lastUpdateAt: now,
      triggerLevel: 0,
      triggerMode: "dip_pct",
      cancelOnRecovery: false,
      recoveryThreshold: triggerPrice * 1.02,
    });
    console.log(
      `[TRAILING_BUY_ARMED] pair=${pair} referencePrice=$${triggerPrice.toFixed(2)}` +
      ` buyThreshold=$${triggerPrice.toFixed(2)} localLow=$${currentPrice.toFixed(2)}` +
      ` reboundPct=${trailingPct.toFixed(2)} reboundTriggerPrice=$${reboundTriggerPrice.toFixed(2)}`
    );
  }

  /**
   * Arm trailing buy for a specific ladder level (Level 1 functionality)
   */
  armLevel(
    pair: string,
    referencePrice: number,
    activationPrice: number,
    currentPrice: number,
    triggerLevel: number,
    opts: {
      trailingMode: "rebound_pct" | "atrp_fraction";
      trailingValue: number;
      maxWaitMinutes?: number;
      cancelOnRecovery?: boolean;
      atrpMultiplier?: number;
      maxExecutionPrice?: number;
    }
  ): void {
    const now = Date.now();
    const trailingPct = opts.trailingMode === "rebound_pct"
      ? opts.trailingValue
      : (opts.atrpMultiplier ? opts.trailingValue * opts.atrpMultiplier : opts.trailingValue);

    const maxDurationMs = (opts.maxWaitMinutes ?? 60) * 60 * 1000;
    const reboundTriggerPrice = currentPrice * (1 + trailingPct / 100);

    const maxExecutionPrice = opts.maxExecutionPrice ?? activationPrice * (1 + trailingPct / 100);

    this.states.set(pair, {
      pair,
      armed: true,
      armedAt: now,
      referencePrice,
      activationPrice,
      buyThreshold: activationPrice,    // comparten el mismo valor en Level 1
      maxExecutionPrice,
      triggerPrice: referencePrice, // retrocompatibilidad
      localLow: currentPrice,
      localLowAt: now,
      trailingPct,
      maxDurationMs,
      lastPrice: currentPrice,
      lastUpdateAt: now,
      triggerLevel,
      triggerMode: opts.trailingMode === "rebound_pct" ? "dip_pct" : "atrp_multiplier",
      atrpMultiplier: opts.atrpMultiplier,
      cancelOnRecovery: opts.cancelOnRecovery ?? true,
      recoveryThreshold: referencePrice * 1.02,
    });

    console.log(
      `[TRAILING_BUY_ARMED] pair=${pair} level=${triggerLevel}` +
      ` referencePrice=$${referencePrice.toFixed(2)} buyThreshold=$${activationPrice.toFixed(2)}` +
      ` maxExecutionPrice=$${maxExecutionPrice.toFixed(2)} localLow=$${currentPrice.toFixed(2)}` +
      ` reboundPct=${trailingPct.toFixed(2)}% reboundTriggerPrice=$${reboundTriggerPrice.toFixed(2)} mode=${opts.trailingMode}`
    );
  }

  /**
   * Update the trailing buy tracker with a new price tick.
   * Returns a trigger result indicating whether to execute the buy.
   */
  update(pair: string, currentPrice: number): TrailingBuyTrigger {
    const state = this.states.get(pair);
    if (!state || !state.armed) {
      return { triggered: false, buyPrice: 0, localLow: 0, bouncePct: 0, reason: "not_armed" };
    }

    const now = Date.now();
    state.lastPrice = currentPrice;
    state.lastUpdateAt = now;

    // Check expiration
    if (now - state.armedAt > state.maxDurationMs) {
      this.disarm(pair);
      return { triggered: false, buyPrice: 0, localLow: state.localLow, bouncePct: 0, reason: "expired" };
    }

    // Check cancellation due to recovery (Level 1 feature)
    if (state.cancelOnRecovery && currentPrice > state.recoveryThreshold) {
      const recoveryPct = ((currentPrice - state.triggerPrice) / state.triggerPrice) * 100;
      this.disarm(pair);
      console.log(
        `[TrailingBuy] CANCELLED ${pair} price recovered to $${currentPrice.toFixed(2)}` +
        ` (${recoveryPct.toFixed(2)}% above trigger $${state.triggerPrice.toFixed(2)})`
      );
      return { 
        triggered: false, 
        buyPrice: 0, 
        localLow: state.localLow, 
        bouncePct: 0, 
        reason: `recovered_${recoveryPct.toFixed(2)}%` 
      };
    }

    // Track new local low
    if (currentPrice < state.localLow) {
      state.localLow = currentPrice;
      state.localLowAt = now;
      const reboundTriggerPrice = computeReboundTriggerPrice(state.localLow, state.trailingPct);
      console.log(
        `[TRAILING_BUY_TRACKING] pair=${pair}` +
        ` localLow=$${state.localLow.toFixed(2)} reboundTriggerPrice=$${reboundTriggerPrice.toFixed(2)}`
      );
      return { triggered: false, buyPrice: 0, localLow: state.localLow, bouncePct: 0, reason: "tracking_lower" };
    }

    // Check if bounce from local low exceeds trailing %
    const bouncePct = state.localLow > 0
      ? ((currentPrice - state.localLow) / state.localLow) * 100
      : 0;
    const reboundTriggerPrice = computeReboundTriggerPrice(state.localLow, state.trailingPct);

    if (bouncePct >= state.trailingPct) {
      // TRIGGER! Price bounced enough from local low — revalidar condiciones en el engine
      console.log(
        `[TRAILING_BUY_REBOUND_DETECTED] pair=${pair} localLow=$${state.localLow.toFixed(2)}` +
        ` currentPrice=$${currentPrice.toFixed(2)} reboundPct=${bouncePct.toFixed(3)}%` +
        ` buyThreshold=$${state.buyThreshold.toFixed(2)} maxExecutionPrice=$${state.maxExecutionPrice.toFixed(2)}` +
        ` status=processing_entry`
      );
      const result: TrailingBuyTrigger = {
        triggered: true,
        buyPrice: currentPrice,
        localLow: state.localLow,
        bouncePct,
        reason: `Bounce ${bouncePct.toFixed(3)}% >= ${state.trailingPct}% from low=$${state.localLow.toFixed(2)}`,
        buyThreshold: state.buyThreshold,
        maxExecutionPrice: state.maxExecutionPrice,
      };
      this.disarm(pair);
      return result;
    }

    return {
      triggered: false,
      buyPrice: 0,
      localLow: state.localLow,
      bouncePct,
      reason: `waiting (bounce=${bouncePct.toFixed(3)}% < ${state.trailingPct}% reboundTrigger=$${reboundTriggerPrice.toFixed(2)})`,
    };
  }

  /**
   * Disarm trailing buy for a pair.
   */
  disarm(pair: string): void {
    const had = this.states.has(pair);
    this.states.delete(pair);
    if (had) {
      console.log(`[TrailingBuy] DISARMED ${pair}`);
    }
  }

  /**
   * Check if trailing buy is currently armed for a pair.
   */
  isArmed(pair: string): boolean {
    const state = this.states.get(pair);
    return state?.armed ?? false;
  }

  /**
   * Get current state for a pair (for diagnostics/UI).
   */
  getState(pair: string): TrailingBuyState | undefined {
    return this.states.get(pair);
  }

  /**
   * Get all active trailing buy states.
   */
  getAllStates(): TrailingBuyState[] {
    return Array.from(this.states.values()).filter(s => s.armed);
  }

  /**
   * Clear all states (for tests or emergency reset).
   */
  clearAll(): void {
    this.states.clear();
  }

  /**
   * Check if a specific ladder level should trigger trailing buy (Level 1)
   */
  shouldTriggerLevel(
    pair: string, 
    currentPrice: number, 
    triggerLevel: number, 
    triggerPrice: number
  ): boolean {
    const state = this.states.get(pair);
    if (state && state.armed && state.triggerLevel === triggerLevel) {
      return currentPrice <= triggerPrice;
    }
    return false;
  }

  /**
   * Get trailing buy info for UI/diagnostics
   */
  getTrailingBuyInfo(pair: string): {
    armed: boolean;
    triggerLevel?: number;
    localLow?: number;
    targetPrice?: number;
    expiresAt?: Date;
    elapsedMinutes?: number;
  } {
    const state = this.states.get(pair);
    if (!state || !state.armed) {
      return { armed: false };
    }

    const now = Date.now();
    const targetPrice = state.localLow * (1 + state.trailingPct / 100);
    
    return {
      armed: true,
      triggerLevel: state.triggerLevel,
      localLow: state.localLow,
      targetPrice,
      expiresAt: new Date(state.armedAt + state.maxDurationMs),
      elapsedMinutes: (now - state.armedAt) / (60 * 1000),
    };
  }
}

export const TrailingBuyManager = new TrailingBuyManagerClass();
