/**
 * GridRiskManager — Professional risk management for Grid Isolated.
 *
 * Components:
 *   1. Trailing Protection: Activates after trailingActivationPct profit,
 *      trails with trailingStopPct to lock in gains.
 *   2. Stop Loss Layers: 3-tier (soft, hard, emergency) with escalating actions.
 *   3. HODL Recovery: When stop loss hit, optionally hold position and wait
 *      for price recovery to break-even instead of realizing the loss.
 *
 * All thresholds are configurable per grid config.
 */

import { botLogger } from "../botLogger";
import type {
  TrailingProtectionState,
  StopLossLayer,
  StopLossLayerType,
  HodlRecoveryState,
  GridCycle,
  GridIsolatedConfig,
  TrailingMode,
  TrailingPolicySnapshot,
} from "./gridIsolatedTypes";
import { FEE_BUFFER_BUY_PCT, FEE_BUFFER_SELL_PCT } from "./gridIsolatedTypes";
import { computeBreakEvenSellPrice } from "./gridNetCalculator";
import {
  resolveAdaptiveTrailingStop,
  computeActivationPrice,
  type AdaptiveTrailingConfig,
} from "./gridAdaptiveTrailing";

export interface RiskEvaluation {
  action: "HOLD" | "TRAILING_UPDATE" | "TRAILING_CLOSE" | "STOP_LOSS_SOFT" | "STOP_LOSS_HARD" | "STOP_LOSS_EMERGENCY" | "HODL_RECOVERY_ACTIVATE" | "HODL_RECOVERY_SELL";
  reason: string;
  trailingState: TrailingProtectionState;
  stopLossLayers: StopLossLayer[];
  hodlState: HodlRecoveryState;
  suggestedSellPrice: number | null;
}

class GridRiskManager {
  /**
   * Evaluate risk for an open cycle (buy filled, waiting for sell).
   */
  evaluateCycle(
    cycle: GridCycle,
    currentPrice: number,
    config: GridIsolatedConfig,
    trailingState: TrailingProtectionState,
    stopLossLayers: StopLossLayer[],
    hodlState: HodlRecoveryState,
    /** Current ATR pct from canonical GRID band snapshot (V3.1 adaptive trailing). */
    atrPct?: number | null,
    /** V3.1: Trailing policy snapshot persisted at cycle creation. When present,
     *  this is the runtime source of truth — global config changes do NOT
     *  affect open cycles. */
    trailingPolicy?: TrailingPolicySnapshot | null,
  ): RiskEvaluation {
    if (!cycle.buyPrice) {
      return this.noAction(trailingState, stopLossLayers, hodlState);
    }

    const buyPrice = cycle.buyPrice;
    const profitPct = ((currentPrice - buyPrice) / buyPrice) * 100;

    // ─── 1. Check HODL Recovery first (if active) ──────────────────
    if (hodlState.active && hodlState.recoveryTargetPrice) {
      if (currentPrice >= hodlState.recoveryTargetPrice) {
        return {
          action: "HODL_RECOVERY_SELL",
          reason: `HODL recovery target reached: ${currentPrice} >= ${hodlState.recoveryTargetPrice}`,
          trailingState,
          stopLossLayers,
          hodlState,
          suggestedSellPrice: currentPrice,
        };
      }
      // Still in HODL recovery — hold
      return {
        action: "HOLD",
        reason: `HODL recovery active — waiting for price to reach ${hodlState.recoveryTargetPrice}`,
        trailingState,
        stopLossLayers,
        hodlState,
        suggestedSellPrice: null,
      };
    }

    // ─── 2. Check Stop Loss layers ─────────────────────────────────
    // V3.1: stop loss only evaluates when stopLossEnabled is true.
    const stopLossEnabled = config.stopLossEnabled ?? false;
    const updatedLayers = stopLossEnabled ? stopLossLayers.map(layer => {
      if (layer.triggered) return layer;

      let triggerPrice: number;
      switch (layer.layer) {
        case "soft":
          triggerPrice = buyPrice * (1 - config.stopLossSoftPct / 100);
          break;
        case "hard":
          triggerPrice = buyPrice * (1 - config.stopLossHardPct / 100);
          break;
        case "emergency":
          triggerPrice = buyPrice * (1 - config.stopLossEmergencyPct / 100);
          break;
      }

      if (currentPrice <= triggerPrice) {
        const updated = {
          ...layer,
          triggered: true,
          triggeredAt: new Date(),
          reason: `${layer.layer} stop loss triggered at ${currentPrice} (threshold: ${triggerPrice})`,
        };
        botLogger.warn("GRID_CYCLE_STOP_LOSS_HIT", updated.reason, {
          cycleId: cycle.id, layer: layer.layer, currentPrice, triggerPrice,
        });
        return updated;
      }
      return layer;
    }) : stopLossLayers;

    const softTriggered = updatedLayers.find(l => l.layer === "soft" && l.triggered);
    const hardTriggered = updatedLayers.find(l => l.layer === "hard" && l.triggered);
    const emergencyTriggered = updatedLayers.find(l => l.layer === "emergency" && l.triggered);

    if (emergencyTriggered) {
      // Emergency stop loss — immediate sell regardless of HODL
      return {
        action: "STOP_LOSS_EMERGENCY",
        reason: emergencyTriggered.reason,
        trailingState,
        stopLossLayers: updatedLayers,
        hodlState,
        suggestedSellPrice: currentPrice,
      };
    }

    if (hardTriggered) {
      // Hard stop loss — sell immediately
      return {
        action: "STOP_LOSS_HARD",
        reason: hardTriggered.reason,
        trailingState,
        stopLossLayers: updatedLayers,
        hodlState,
        suggestedSellPrice: currentPrice,
      };
    }

    if (softTriggered) {
      // Soft stop loss — activate HODL recovery if enabled
      if (config.hodlRecoveryEnabled) {
        const breakEvenPrice = computeBreakEvenSellPrice(buyPrice, cycle.quantity, config.buyFeePct, config.sellFeePct);
        const newHodlState: HodlRecoveryState = {
          active: true,
          activatedAt: new Date(),
          originalBuyPrice: buyPrice,
          recoveryTargetPrice: breakEvenPrice,
          reason: `HODL recovery activated after soft stop loss — target: ${breakEvenPrice}`,
        };
        botLogger.info("GRID_CYCLE_HODL_RECOVERY", newHodlState.reason, {
          cycleId: cycle.id, buyPrice, breakEvenPrice,
        });
        return {
          action: "HODL_RECOVERY_ACTIVATE",
          reason: newHodlState.reason,
          trailingState,
          stopLossLayers: updatedLayers,
          hodlState: newHodlState,
          suggestedSellPrice: null,
        };
      }

      // HODL not enabled — sell on soft stop
      return {
        action: "STOP_LOSS_SOFT",
        reason: softTriggered.reason,
        trailingState,
        stopLossLayers: updatedLayers,
        hodlState,
        suggestedSellPrice: currentPrice,
      };
    }

    // ─── 3. Check Trailing Protection ──────────────────────────────
    // Only active when the user explicitly enables trailing. Once trailing is
    // active it remains active even if the current profit retraces below the
    // activation threshold, until the stop is hit.
    //
    // V3.1: The trailing policy snapshot (persisted at cycle creation) is the
    // runtime source of truth. Global config changes do NOT affect open cycles.
    // Legacy cycles without a snapshot fall back to global config explicitly.
    //
    // V3.1: For CYCLE_OWNED_NET_TARGET_V3 cycles, activation is floored at
    // targetSellPrice so trailing only arms after the economic target is reached.
    // V2 and legacy cycles are NOT affected — they use the plain activationPct.
    const isV3Cycle = cycle.exitPolicyVersion === "CYCLE_OWNED_NET_TARGET_V3" ||
                      cycle.targetKind === "CYCLE_OWNED_SYNTHETIC";

    // V3.1: Policy snapshot is the source of truth when present.
    // Legacy cycles without snapshot use global config (explicit fallback).
    const hasPolicy = trailingPolicy != null && typeof trailingPolicy === "object";
    const trailingEnabled = hasPolicy
      ? trailingPolicy!.enabled
      : (config.trailingEnabled ?? false);
    const trailingMode: TrailingMode = hasPolicy
      ? trailingPolicy!.mode
      : (config.trailingMode ?? "adaptive_atr");
    const policyTickSize = hasPolicy
      ? (trailingPolicy!.priceTickSize ?? 0.01)
      : 0.01; // legacy fallback — no tick persisted

    // Use persisted activationPrice from policy when available;
    // otherwise recompute (legacy compatibility).
    const activationPrice = hasPolicy && trailingPolicy!.activationPrice != null
      ? trailingPolicy!.activationPrice
      : computeActivationPrice(
          buyPrice,
          isV3Cycle ? cycle.targetSellPrice : null,
          hasPolicy ? trailingPolicy!.activationPctEffective : config.trailingActivationPct,
          trailingMode,
          policyTickSize,
        );

    // Activation condition: price >= activationPrice, OR trailing already activated
    const activationReached = activationPrice != null
      ? currentPrice >= activationPrice
      : profitPct >= (hasPolicy ? trailingPolicy!.activationPctEffective : config.trailingActivationPct);

    if (trailingEnabled && (activationReached || trailingState.activated)) {
      // Trailing should be active — compute adaptive stop using policy snapshot
      const adaptiveConfig: AdaptiveTrailingConfig = {
        mode: trailingMode,
        activationPct: hasPolicy ? trailingPolicy!.activationPctEffective : config.trailingActivationPct,
        stopPct: config.trailingStopPct, // manual fallback — always from config (not policy-scoped)
        atrMultiplier: hasPolicy ? trailingPolicy!.atrMultiplier : (config.trailingAtrMultiplier ?? 0.75),
        minPct: hasPolicy ? trailingPolicy!.minPct : (config.trailingMinPct ?? 0.25),
        maxPct: hasPolicy ? trailingPolicy!.maxPct : (config.trailingMaxPct ?? 1.20),
        smoothingAlpha: hasPolicy ? trailingPolicy!.smoothingAlpha : (config.trailingAtrSmoothingAlpha ?? 0.25),
        priceTickSize: policyTickSize,
      };

      // Profit floor: use policy snapshot when available, otherwise from cycle target
      const profitFloor = hasPolicy && trailingPolicy!.profitFloorPrice != null
        ? trailingPolicy!.profitFloorPrice
        : (isV3Cycle ? cycle.targetSellPrice : null);

      const adaptiveResult = resolveAdaptiveTrailingStop({
        buyPrice,
        currentPrice,
        highestPriceSinceBuy: trailingState.highestPriceSinceBuy,
        targetSellPrice: isV3Cycle ? cycle.targetSellPrice : null,
        atrPct: atrPct ?? trailingState.atrPct ?? null,
        previousSmoothedAtrPct: trailingState.smoothedAtrPct ?? null,
        previousStopPrice: trailingState.currentStopPrice,
        profitFloorPrice: profitFloor,
        config: adaptiveConfig,
      });

      let updatedTrailing: TrailingProtectionState = { ...trailingState };

      if (!trailingState.activated) {
        // Activate trailing
        updatedTrailing = {
          ...trailingState,
          activated: true,
          activatedAt: new Date(),
          highestPriceSinceBuy: adaptiveResult.highestPrice,
          trailingStopPct: adaptiveResult.effectiveStopPct ?? config.trailingStopPct,
          currentStopPrice: adaptiveResult.effectiveStopPrice,
          reason: `Trailing activated at ${profitPct.toFixed(2)}% profit — stop: ${adaptiveResult.effectiveStopPrice}`,
          atrPct: adaptiveResult.atrPct,
          smoothedAtrPct: adaptiveResult.smoothedAtrPct,
          atrSource: adaptiveResult.atrSource,
          effectiveStopPct: adaptiveResult.effectiveStopPct,
          baseStopPct: adaptiveResult.baseStopPct,
          profitFloorPrice: adaptiveResult.profitFloorPrice,
          activationPrice: adaptiveResult.activationPrice,
        };
        botLogger.info("GRID_TRAILING_ACTIVATED", updatedTrailing.reason, {
          cycleId: cycle.id, profitPct, currentPrice, stopPrice: updatedTrailing.currentStopPrice,
          mode: trailingMode, atrSource: adaptiveResult.atrSource,
        });
      } else {
        // Already activated — update highest and stop (never descend)
        updatedTrailing = {
          ...trailingState,
          highestPriceSinceBuy: adaptiveResult.highestPrice,
          trailingStopPct: adaptiveResult.effectiveStopPct ?? trailingState.trailingStopPct,
          currentStopPrice: adaptiveResult.effectiveStopPrice ?? trailingState.currentStopPrice,
          reason: adaptiveResult.reason,
          atrPct: adaptiveResult.atrPct,
          smoothedAtrPct: adaptiveResult.smoothedAtrPct,
          atrSource: adaptiveResult.atrSource,
          effectiveStopPct: adaptiveResult.effectiveStopPct,
          baseStopPct: adaptiveResult.baseStopPct,
          profitFloorPrice: adaptiveResult.profitFloorPrice,
          activationPrice: adaptiveResult.activationPrice,
        };
      }

      // Check if trailing stop hit (strictly less than — price must drop below stop,
      // not just touch it; this prevents immediate close when trailing activates at
      // the profit floor price = V3 target).
      if (updatedTrailing.currentStopPrice && currentPrice < updatedTrailing.currentStopPrice) {
        return {
          action: "TRAILING_CLOSE",
          reason: `Trailing stop hit at ${currentPrice} (stop: ${updatedTrailing.currentStopPrice})`,
          trailingState: updatedTrailing,
          stopLossLayers: updatedLayers,
          hodlState,
          suggestedSellPrice: currentPrice,
        };
      }

      // Trailing active, price still above stop
      return {
        action: "TRAILING_UPDATE",
        reason: `Trailing active — highest: ${updatedTrailing.highestPriceSinceBuy}, stop: ${updatedTrailing.currentStopPrice}`,
        trailingState: updatedTrailing,
        stopLossLayers: updatedLayers,
        hodlState,
        suggestedSellPrice: null,
      };
    }

    // ─── 4. No action needed ───────────────────────────────────────
    return {
      action: "HOLD",
      reason: `Price at ${profitPct.toFixed(2)}% from buy — no risk triggers`,
      trailingState,
      stopLossLayers: updatedLayers,
      hodlState,
      suggestedSellPrice: null,
    };
  }

  /**
   * Initialize default stop loss layers from config.
   */
  initStopLossLayers(config: GridIsolatedConfig): StopLossLayer[] {
    return [
      { layer: "soft", triggerPricePct: config.stopLossSoftPct, triggered: false, triggeredAt: null, reason: "" },
      { layer: "hard", triggerPricePct: config.stopLossHardPct, triggered: false, triggeredAt: null, reason: "" },
      { layer: "emergency", triggerPricePct: config.stopLossEmergencyPct, triggered: false, triggeredAt: null, reason: "" },
    ];
  }

  /**
   * Initialize default trailing state.
   */
  initTrailingState(): TrailingProtectionState {
    return {
      activated: false,
      activatedAt: null,
      highestPriceSinceBuy: null,
      trailingStopPct: 0,
      currentStopPrice: null,
      reason: "",
      // V3.1 adaptive fields (additive — old JSONB without these is still valid)
      policy: null,
      atrPct: null,
      smoothedAtrPct: null,
      atrSource: null,
      effectiveStopPct: null,
      baseStopPct: null,
      profitFloorPrice: null,
      activationPrice: null,
    };
  }

  /**
   * Initialize default HODL state.
   */
  initHodlState(): HodlRecoveryState {
    return {
      active: false,
      activatedAt: null,
      originalBuyPrice: null,
      recoveryTargetPrice: null,
      reason: "",
    };
  }

  private noAction(
    trailing: TrailingProtectionState,
    stopLoss: StopLossLayer[],
    hodl: HodlRecoveryState
  ): RiskEvaluation {
    return {
      action: "HOLD",
      reason: "No buy price set",
      trailingState: trailing,
      stopLossLayers: stopLoss,
      hodlState: hodl,
      suggestedSellPrice: null,
    };
  }
}

export const gridRiskManager = new GridRiskManager();
