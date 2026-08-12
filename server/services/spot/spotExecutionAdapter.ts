/**
 * SpotExecutionAdapter — SHADOW/REAL execution adapters with capability guard.
 *
 * PROBLEM (FASE 1 audit):
 *   - Two separate execution paths: Normal (real orders) and DRY (phantom fills).
 *   - DRY assumes perfect fills (no slippage, no spread impact).
 *   - No capability guard preventing SHADOW from sending real orders.
 *   - ShadowExecutor.ts writes to training_trades, not the unified SPOT pipeline.
 *
 * SOLUTION:
 *   One SpotExecutionAdapter interface with two implementations:
 *     - SpotShadowAdapter: generates phantom fills (never calls exchange)
 *     - SpotRealAdapter: calls exchange (BLOCKED during refactor)
 *
 *   Capability guard:
 *     - SHADOW adapter has canPlaceRealOrder = false (hardcoded)
 *     - REAL adapter checks REAL_ACTIVATION_ALLOWED (false during refactor)
 *     - Any attempt to place a real order in SHADOW mode throws
 *     - Any attempt to use REAL adapter during refactor throws
 *
 * INVARIANT: SHADOW nunca envía órdenes reales. REAL no autorizado.
 */

import {
  ExecutionMode,
  REAL_ACTIVATION_ALLOWED,
  type SpotExecutionIntent,
  type SpotExecutionResult,
  type SpotMarketContext,
} from "./spotTypes";
import { getSpotTakerFeePct, type FeeQuality } from "./feeModel";

// ─── Interface ──────────────────────────────────────────────────────────────

export interface SpotExecutionAdapter {
  readonly mode: ExecutionMode;
  readonly canPlaceRealOrder: boolean;

  /**
   * Execute an entry order (BUY).
   * SHADOW: generates phantom fill at current price + controlled slippage.
   * REAL: calls exchange (BLOCKED during refactor).
   */
  executeEntry(intent: SpotExecutionIntent, ctx: SpotMarketContext): Promise<SpotExecutionResult>;

  /**
   * Execute an exit order (SELL).
   * SHADOW: generates phantom fill at current price + controlled slippage.
   * REAL: calls exchange (BLOCKED during refactor).
   */
  executeExit(intent: SpotExecutionIntent, ctx: SpotMarketContext): Promise<SpotExecutionResult>;
}

// ─── Capability guard ───────────────────────────────────────────────────────

export class RealOrderBlockedException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RealOrderBlockedException";
  }
}

/**
 * Verify that the adapter is allowed to perform the requested operation.
 * Throws if SHADOW tries to place a real order or if REAL is not authorized.
 */
export function assertExecutionCapability(
  adapter: SpotExecutionAdapter,
  intent: SpotExecutionIntent,
): void {
  // SHADOW must never place real orders
  if (adapter.mode === ExecutionMode.SHADOW && !adapter.canPlaceRealOrder) {
    // This is expected — SHADOW generates phantom fills
    return;
  }

  // If somehow SHADOW has canPlaceRealOrder = true, block it
  if (adapter.mode === ExecutionMode.SHADOW && adapter.canPlaceRealOrder) {
    throw new RealOrderBlockedException(
      `SHADOW adapter cannot have canPlaceRealOrder=true. Intent: ${intent.intentId}`,
    );
  }

  // REAL requires explicit activation
  if (adapter.mode === ExecutionMode.REAL && !REAL_ACTIVATION_ALLOWED) {
    throw new RealOrderBlockedException(
      `REAL execution not authorized. REAL_ACTIVATION_ALLOWED=false. Intent: ${intent.intentId}`,
    );
  }

  // REAL adapter must have canPlaceRealOrder = true
  if (adapter.mode === ExecutionMode.REAL && !adapter.canPlaceRealOrder) {
    throw new RealOrderBlockedException(
      `REAL adapter must have canPlaceRealOrder=true. Intent: ${intent.intentId}`,
    );
  }
}

// ─── SHADOW Adapter ─────────────────────────────────────────────────────────

/**
 * Shadow execution adapter.
 * Generates phantom fills with controlled slippage.
 * NEVER calls the exchange API.
 */
export class SpotShadowAdapter implements SpotExecutionAdapter {
  readonly mode = ExecutionMode.SHADOW;
  readonly canPlaceRealOrder = false;

  /**
   * Phantom slippage model:
   *   - Market BUY: pay slightly above ask (slippage = 0.01-0.05%)
   *   - Market SELL: receive slightly below bid (slippage = 0.01-0.05%)
   *   - Slippage is deterministic from intent + ticker (not random)
   */
  private computePhantomSlippagePct(intent: SpotExecutionIntent, ctx: SpotMarketContext): number {
    // Base slippage: 0.02% for market orders
    let slippagePct = 0.02;

    // Higher slippage for larger orders (market impact)
    if (intent.notionalUsd > 1000) slippagePct += 0.01;
    if (intent.notionalUsd > 5000) slippagePct += 0.02;

    // Higher slippage in high volatility
    if (ctx.regimeContext.volatility === "HIGH") slippagePct += 0.02;

    return slippagePct;
  }

  private generatePhantomFill(intent: SpotExecutionIntent, ctx: SpotMarketContext): SpotExecutionResult {
    const ticker = ctx.ticker;
    const slippagePct = this.computePhantomSlippagePct(intent, ctx);
    const slippageMult = slippagePct / 100;

    let fillPrice: number;
    if (intent.side === "BUY") {
      // Buy at ask + slippage
      fillPrice = ticker.ask * (1 + slippageMult);
    } else {
      // Sell at bid - slippage
      fillPrice = ticker.bid * (1 - slippageMult);
    }

    const fillVolume = intent.volume;
    const notional = fillPrice * fillVolume;
    const takerPct = getSpotTakerFeePct() / 100;
    const feeUsd = notional * takerPct;
    const slippageUsd = Math.abs(fillPrice - (intent.side === "BUY" ? ticker.ask : ticker.bid)) * fillVolume;

    const orderId = `shadow-${intent.intentId}-${Date.now().toString(36)}`;

    return {
      success: true,
      orderId,
      fillPrice,
      fillVolume,
      fillQuality: "ESTIMATED" as FeeQuality,
      feeUsd,
      slippageUsd,
      error: null,
      pendingFill: false,
      executedAt: Date.now(),
    };
  }

  async executeEntry(intent: SpotExecutionIntent, ctx: SpotMarketContext): Promise<SpotExecutionResult> {
    // Capability guard — verifies SHADOW cannot place real orders
    assertExecutionCapability(this, intent);

    // Verify intent is a BUY
    if (intent.side !== "BUY") {
      return {
        success: false, orderId: null, fillPrice: null, fillVolume: null,
        fillQuality: "UNKNOWN" as FeeQuality, feeUsd: null, slippageUsd: null,
        error: "Entry intent must be BUY", pendingFill: false, executedAt: Date.now(),
      };
    }

    // Generate phantom fill (NEVER call exchange)
    return this.generatePhantomFill(intent, ctx);
  }

  async executeExit(intent: SpotExecutionIntent, ctx: SpotMarketContext): Promise<SpotExecutionResult> {
    // Capability guard
    assertExecutionCapability(this, intent);

    // Verify intent is a SELL
    if (intent.side !== "SELL") {
      return {
        success: false, orderId: null, fillPrice: null, fillVolume: null,
        fillQuality: "UNKNOWN" as FeeQuality, feeUsd: null, slippageUsd: null,
        error: "Exit intent must be SELL", pendingFill: false, executedAt: Date.now(),
      };
    }

    // Generate phantom fill (NEVER call exchange)
    return this.generatePhantomFill(intent, ctx);
  }
}

// ─── REAL Adapter (BLOCKED during refactor) ─────────────────────────────────

/**
 * Real execution adapter.
 * Would call the exchange API, but BLOCKED during refactor.
 * REAL_ACTIVATION_ALLOWED = false → all operations throw.
 */
export class SpotRealAdapter implements SpotExecutionAdapter {
  readonly mode = ExecutionMode.REAL;
  readonly canPlaceRealOrder = true;

  async executeEntry(intent: SpotExecutionIntent, ctx: SpotMarketContext): Promise<SpotExecutionResult> {
    // Capability guard — will throw because REAL_ACTIVATION_ALLOWED = false
    assertExecutionCapability(this, intent);

    // If we ever get here (REAL activated), would call exchange
    // For now, this is unreachable
    throw new RealOrderBlockedException(
      `REAL execution not implemented. Intent: ${intent.intentId}`,
    );
  }

  async executeExit(intent: SpotExecutionIntent, ctx: SpotMarketContext): Promise<SpotExecutionResult> {
    assertExecutionCapability(this, intent);
    throw new RealOrderBlockedException(
      `REAL execution not implemented. Intent: ${intent.intentId}`,
    );
  }
}

// ─── Adapter factory ────────────────────────────────────────────────────────

/**
 * Factory to create the correct adapter for an execution mode.
 * Fail-safe: unknown mode → SHADOW (never REAL).
 */
export function createExecutionAdapter(mode: ExecutionMode): SpotExecutionAdapter {
  if (mode === ExecutionMode.REAL) {
    return new SpotRealAdapter();
  }
  if (mode === ExecutionMode.SHADOW) {
    return new SpotShadowAdapter();
  }
  // OFF or unknown → SHADOW (fail-safe, never REAL)
  // OFF mode should not call execute at all, but if it does, SHADOW is safe
  return new SpotShadowAdapter();
}
