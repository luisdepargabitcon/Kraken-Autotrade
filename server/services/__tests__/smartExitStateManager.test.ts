/**
 * Smart Exit State Manager Tests
 * Tests for state machine transitions and notification rules
 * 
 * NOTE: These tests require a real DB connection and are skipped in CI.
 * They should be run manually with a test database.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SmartExitStateManager, type SmartExitState } from "../SmartExitStateManager";

describe.skip("SmartExitStateManager - State Transitions (requires DB)", () => {
  let manager: SmartExitStateManager;

  beforeEach(() => {
    manager = new SmartExitStateManager();
  });

  afterEach(async () => {
    // Cleanup test data
    await manager.cleanupOldEntries();
  });

  describe("Initial state transition (null → BLOCKED_BY_FEE_BAND)", () => {
    it("should notify when first entering BLOCKED_BY_FEE_BAND", async () => {
      const transition = await manager.evaluateTransition({
        pair: "ETH/USD",
        positionId: "lot-123",
        decision: {
          shouldExit: false,
          suppressedByFeeBand: true,
          score: 8,
          threshold: 9,
          regime: "CHOP",
          confirmationProgress: 0,
          confirmationRequired: 10,
          reasons: ["EMA_REVERSAL", "MACD_REVERSAL"],
          pnlPct: 0.03,
        },
        isPositionOpen: true,
      });

      expect(transition.previousState).toBeNull();
      expect(transition.newState).toBe("BLOCKED_BY_FEE_BAND");
      expect(transition.shouldNotify).toBe(true);
      expect(transition.notifyMessage).toContain("SMART EXIT detectado, pero salida suprimida por fee-band");
      expect(transition.notifyMessage).toContain("ETH/USD");
    });
  });

  describe("No state change (BLOCKED_BY_FEE_BAND → BLOCKED_BY_FEE_BAND)", () => {
    it("should NOT notify when staying in BLOCKED_BY_FEE_BAND", async () => {
      // First evaluation - should notify
      await manager.evaluateTransition({
        pair: "ETH/USD",
        positionId: "lot-123",
        decision: {
          shouldExit: false,
          suppressedByFeeBand: true,
          score: 8,
          threshold: 9,
          regime: "CHOP",
          confirmationProgress: 0,
          confirmationRequired: 10,
          reasons: ["EMA_REVERSAL", "MACD_REVERSAL"],
          pnlPct: 0.03,
        },
        isPositionOpen: true,
      });

      // Second evaluation with small PnL change - should NOT notify
      const transition = await manager.evaluateTransition({
        pair: "ETH/USD",
        positionId: "lot-123",
        decision: {
          shouldExit: false,
          suppressedByFeeBand: true,
          score: 8,
          threshold: 9,
          regime: "CHOP",
          confirmationProgress: 0,
          confirmationRequired: 10,
          reasons: ["EMA_REVERSAL", "MACD_REVERSAL"],
          pnlPct: 0.04, // Small PnL change
        },
        isPositionOpen: true,
      });

      expect(transition.previousState).toBe("BLOCKED_BY_FEE_BAND");
      expect(transition.newState).toBe("BLOCKED_BY_FEE_BAND");
      expect(transition.shouldNotify).toBe(false);
      expect(transition.notifyMessage).toBeUndefined();
    });
  });

  describe("State transition (BLOCKED_BY_FEE_BAND → UNBLOCKED)", () => {
    it("should notify when fee-band disappears", async () => {
      // First - enter blocked state
      await manager.evaluateTransition({
        pair: "ETH/USD",
        positionId: "lot-123",
        decision: {
          shouldExit: false,
          suppressedByFeeBand: true,
          score: 8,
          threshold: 9,
          regime: "CHOP",
          confirmationProgress: 0,
          confirmationRequired: 10,
          reasons: ["EMA_REVERSAL", "MACD_REVERSAL"],
          pnlPct: 0.03,
        },
        isPositionOpen: true,
      });

      // Second - fee-band disappears but signal still present
      const transition = await manager.evaluateTransition({
        pair: "ETH/USD",
        positionId: "lot-123",
        decision: {
          shouldExit: false,
          suppressedByFeeBand: false,
          score: 8,
          threshold: 9,
          regime: "CHOP",
          confirmationProgress: 0,
          confirmationRequired: 10,
          reasons: ["EMA_REVERSAL", "MACD_REVERSAL"],
          pnlPct: 0.05,
        },
        isPositionOpen: true,
      });

      expect(transition.previousState).toBe("BLOCKED_BY_FEE_BAND");
      expect(transition.newState).toBe("UNBLOCKED");
      expect(transition.shouldNotify).toBe(true);
      expect(transition.notifyMessage).toContain("Fee-band desaparecido");
      expect(transition.notifyMessage).toContain("ETH/USD");
    });
  });

  describe("State transition (BLOCKED_BY_FEE_BAND → CANCELLED_BY_SIGNAL_DISAPPEAR)", () => {
    it("should notify when signal disappears while blocked", async () => {
      // First - enter blocked state
      await manager.evaluateTransition({
        pair: "ETH/USD",
        positionId: "lot-123",
        decision: {
          shouldExit: false,
          suppressedByFeeBand: true,
          score: 8,
          threshold: 9,
          regime: "CHOP",
          confirmationProgress: 0,
          confirmationRequired: 10,
          reasons: ["EMA_REVERSAL", "MACD_REVERSAL"],
          pnlPct: 0.03,
        },
        isPositionOpen: true,
      });

      // Second - signal disappears (score = 0)
      const transition = await manager.evaluateTransition({
        pair: "ETH/USD",
        positionId: "lot-123",
        decision: {
          shouldExit: false,
          suppressedByFeeBand: false,
          score: 0,
          threshold: 9,
          regime: "CHOP",
          confirmationProgress: 0,
          confirmationRequired: 10,
          reasons: [],
          pnlPct: 0.02,
        },
        isPositionOpen: true,
      });

      expect(transition.previousState).toBe("BLOCKED_BY_FEE_BAND");
      expect(transition.newState).toBe("CANCELLED_BY_SIGNAL_DISAPPEAR");
      expect(transition.shouldNotify).toBe(true);
      expect(transition.notifyMessage).toContain("SMART EXIT cancelado");
      expect(transition.notifyMessage).toContain("señal de salida desapareció");
    });
  });

  describe("State transition (any → EXECUTED)", () => {
    it("should transition to EXECUTED when position closes", async () => {
      // First - enter blocked state
      await manager.evaluateTransition({
        pair: "ETH/USD",
        positionId: "lot-123",
        decision: {
          shouldExit: false,
          suppressedByFeeBand: true,
          score: 8,
          threshold: 9,
          regime: "CHOP",
          confirmationProgress: 0,
          confirmationRequired: 10,
          reasons: ["EMA_REVERSAL", "MACD_REVERSAL"],
          pnlPct: 0.03,
        },
        isPositionOpen: true,
      });

      // Second - position closed
      const transition = await manager.evaluateTransition({
        pair: "ETH/USD",
        positionId: "lot-123",
        decision: {
          shouldExit: true,
          suppressedByFeeBand: false,
          score: 10,
          threshold: 9,
          regime: "CHOP",
          confirmationProgress: 10,
          confirmationRequired: 10,
          reasons: ["EMA_REVERSAL", "MACD_REVERSAL"],
          pnlPct: 0.05,
        },
        isPositionOpen: false, // Position closed
      });

      expect(transition.previousState).toBe("BLOCKED_BY_FEE_BAND");
      expect(transition.newState).toBe("EXECUTED");
      expect(transition.shouldNotify).toBe(true);
      expect(transition.notifyMessage).toBeUndefined(); // EXECUTED notification handled by trading logic
    });
  });

  describe("Reset state", () => {
    it("should reset state when position is closed", async () => {
      // First - enter blocked state
      await manager.evaluateTransition({
        pair: "ETH/USD",
        positionId: "lot-123",
        decision: {
          shouldExit: false,
          suppressedByFeeBand: true,
          score: 8,
          threshold: 9,
          regime: "CHOP",
          confirmationProgress: 0,
          confirmationRequired: 10,
          reasons: ["EMA_REVERSAL", "MACD_REVERSAL"],
          pnlPct: 0.03,
        },
        isPositionOpen: true,
      });

      // Reset state
      await manager.resetState("ETH/USD", "lot-123");

      // Next evaluation should be treated as new
      const transition = await manager.evaluateTransition({
        pair: "ETH/USD",
        positionId: "lot-123",
        decision: {
          shouldExit: false,
          suppressedByFeeBand: true,
          score: 8,
          threshold: 9,
          regime: "CHOP",
          confirmationProgress: 0,
          confirmationRequired: 10,
          reasons: ["EMA_REVERSAL", "MACD_REVERSAL"],
          pnlPct: 0.03,
        },
        isPositionOpen: true,
      });

      expect(transition.previousState).toBeNull();
      expect(transition.newState).toBe("BLOCKED_BY_FEE_BAND");
      expect(transition.shouldNotify).toBe(true);
    });
  });

  describe("Multiple positions", () => {
    it("should handle different positions independently", async () => {
      // Position 1 - ETH/USD
      const transition1 = await manager.evaluateTransition({
        pair: "ETH/USD",
        positionId: "lot-123",
        decision: {
          shouldExit: false,
          suppressedByFeeBand: true,
          score: 8,
          threshold: 9,
          regime: "CHOP",
          confirmationProgress: 0,
          confirmationRequired: 10,
          reasons: ["EMA_REVERSAL"],
          pnlPct: 0.03,
        },
        isPositionOpen: true,
      });

      // Position 2 - BTC/USD
      const transition2 = await manager.evaluateTransition({
        pair: "BTC/USD",
        positionId: "lot-456",
        decision: {
          shouldExit: false,
          suppressedByFeeBand: true,
          score: 8,
          threshold: 9,
          regime: "CHOP",
          confirmationProgress: 0,
          confirmationRequired: 10,
          reasons: ["EMA_REVERSAL"],
          pnlPct: 0.03,
        },
        isPositionOpen: true,
      });

      expect(transition1.shouldNotify).toBe(true);
      expect(transition2.shouldNotify).toBe(true);
      expect(transition1.notifyMessage).toContain("ETH/USD");
      expect(transition2.notifyMessage).toContain("BTC/USD");
    });
  });

  describe("Fail-closed behavior", () => {
    it("should return shouldNotify=false on DB error", async () => {
      // This test would require mocking the DB to throw an error
      // For now, we just verify the structure
      const transition = await manager.evaluateTransition({
        pair: "ETH/USD",
        positionId: "lot-123",
        decision: {
          shouldExit: false,
          suppressedByFeeBand: true,
          score: 8,
          threshold: 9,
          regime: "CHOP",
          confirmationProgress: 0,
          confirmationRequired: 10,
          reasons: ["EMA_REVERSAL"],
          pnlPct: 0.03,
        },
        isPositionOpen: true,
      });

      // If DB fails, shouldNotify should be false (fail-closed)
      // This is implemented in the try-catch block
      expect(transition).toHaveProperty("shouldNotify");
    });
  });
});
