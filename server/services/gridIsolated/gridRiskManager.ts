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
} from "./gridIsolatedTypes";
import { FEE_BUFFER_BUY_PCT, FEE_BUFFER_SELL_PCT } from "./gridIsolatedTypes";
import { computeBreakEvenSellPrice } from "./gridNetCalculator";

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
    hodlState: HodlRecoveryState
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
    const updatedLayers = stopLossLayers.map(layer => {
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
    });

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
    // Once trailing is active it remains active even if the current profit
    // retraces below the activation threshold, until the stop is hit.
    if (profitPct >= config.trailingActivationPct || trailingState.activated) {
      // Trailing should be active
      let updatedTrailing: TrailingProtectionState = { ...trailingState };

      if (!trailingState.activated) {
        // Activate trailing
        updatedTrailing = {
          activated: true,
          activatedAt: new Date(),
          highestPriceSinceBuy: currentPrice,
          trailingStopPct: config.trailingStopPct,
          currentStopPrice: currentPrice * (1 - config.trailingStopPct / 100),
          reason: `Trailing activated at ${profitPct.toFixed(2)}% profit`,
        };
        botLogger.info("GRID_TRAILING_ACTIVATED", updatedTrailing.reason, {
          cycleId: cycle.id, profitPct, currentPrice, stopPrice: updatedTrailing.currentStopPrice,
        });
      } else {
        // Update highest price
        if (currentPrice > (updatedTrailing.highestPriceSinceBuy || 0)) {
          updatedTrailing.highestPriceSinceBuy = currentPrice;
          updatedTrailing.currentStopPrice = currentPrice * (1 - config.trailingStopPct / 100);
        }
      }

      // Check if trailing stop hit
      if (updatedTrailing.currentStopPrice && currentPrice <= updatedTrailing.currentStopPrice) {
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
