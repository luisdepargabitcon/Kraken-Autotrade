/**
 * AMA — Stub service for Phase 1 (contracts and domain).
 *
 * DEVELOPMENT_SCAFFOLD_ONLY
 * NOT_SOURCE_OF_TRUTH
 * NOT_RESTART_SAFE
 * NOT_SHADOW_READY
 * NOT_REAL_READY
 *
 * Provides minimal in-memory state for the AMA mode.
 * Real implementation will replace stubs in subsequent phases.
 * This service does NOT persist state, does NOT call exchanges,
 * does NOT place orders, and does NOT manage real capital.
 */

import {
  AMA_DISPLAY_NAME,
  AMA_SHORT_NAME,
  AMA_STRATEGY_CODE,
  AMA_STRATEGY_VERSION,
  AMA_PAIR,
  isModeReal,
  type AmaMode,
  type AmaStatus,
  type AmaMarketView,
  type AmaMandateInput,
  type AmaResolvedPolicy,
  type AmaTranchePlan,
  type AmaCycle,
  type AmaTranche,
  type AmaPortfolioSummary,
} from "./amaTypes";

class AmaService {
  private mode: AmaMode = "OFF";
  private killSwitchActive = false;
  private cycleId: string | null = null;
  private activePolicyId: string | null = null;
  private mandateId: string | null = null;

  getDisplayName(): string {
    return AMA_DISPLAY_NAME;
  }

  getShortName(): string {
    return AMA_SHORT_NAME;
  }

  getStrategyCode(): string {
    return AMA_STRATEGY_CODE;
  }

  getStrategyVersion(): string {
    return AMA_STRATEGY_VERSION;
  }

  getMode(): AmaMode {
    return this.mode;
  }

  setMode(mode: AmaMode): void {
    if (isModeReal(mode)) {
      throw new Error(`[AMA] ${mode} is LOCKED. Requires explicit authorization. Gate locked at service layer.`);
    }
    this.mode = mode;
  }

  /**
   * Returns true if the given mode can be safely set.
   * REAL_LIMITED and REAL_FULL are always blocked in Phase 1.
   */
  canSetMode(mode: AmaMode): boolean {
    return !isModeReal(mode);
  }

  isKillSwitchActive(): boolean {
    return this.killSwitchActive;
  }

  setKillSwitch(active: boolean): void {
    this.killSwitchActive = active;
  }

  getStatus(): AmaStatus {
    return {
      mode: this.mode,
      state: "OBSERVING",
      protectionState: null,
      pair: AMA_PAIR,
      strategyVersion: AMA_STRATEGY_VERSION,
      cycleId: this.cycleId,
      activePolicyId: this.activePolicyId,
      mandateId: this.mandateId,
      killSwitchActive: this.killSwitchActive,
      lastUpdated: new Date().toISOString(),
    };
  }

  getMarketView(): AmaMarketView {
    return {
      pair: AMA_PAIR,
      analysisPrice: null,
      analysisTimestamp: null,
      executionBid: null,
      executionAsk: null,
      executionMid: null,
      spreadPct: null,
      crossVenueBasisPct: null,
      executionTimestamp: null,
      highWaterMark: null,
      cycleLow: null,
      currentDropPct: null,
      maxDropPct: null,
      reboundFromLowPct: null,
      macroZone: null,
      daysSinceCeiling: null,
      daysSinceLow: null,
      dataQuality: "UNAVAILABLE",
    };
  }

  getMandate(): AmaMandateInput | null {
    return null;
  }

  saveMandateDraft(input: AmaMandateInput): { mandateId: string } {
    const mandateId = `mandate-${Date.now()}`;
    this.mandateId = mandateId;
    return { mandateId };
  }

  getActivePolicy(): AmaResolvedPolicy | null {
    return null;
  }

  getTranchePlan(): AmaTranchePlan | null {
    return null;
  }

  getCycles(): AmaCycle[] {
    return [];
  }

  getTranches(cycleId: string): AmaTranche[] {
    return [];
  }

  getPortfolioSummary(): AmaPortfolioSummary {
    return {
      mode: this.mode,
      budgetUsd: 0,
      deployedUsd: 0,
      reservedUsd: 0,
      freeUsd: 0,
      accumulatedQuantity: 0,
      averageCostBasis: null,
      currentValueUsd: null,
      unrealizedPnlUsd: null,
      realizedPnlUsd: null,
      sleeves: [],
    };
  }
}

export const amaService = new AmaService();
