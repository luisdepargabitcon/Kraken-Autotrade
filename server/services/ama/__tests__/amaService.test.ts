/**
 * AMA Phase 1 — Service layer tests.
 *
 * Verifies that the stub service:
 * - Blocks REAL modes at the service layer (double gate)
 * - Returns safe defaults
 * - Does not call exchanges or place orders
 * - Kill switch works correctly
 */

import { describe, it, expect, beforeEach } from "vitest";
import { amaService } from "../amaService";
import { isModeReal, type AmaMode } from "../amaTypes";

describe("AMA Service — Scaffold Safety", () => {
  beforeEach(() => {
    amaService.setMode("OFF");
    amaService.setKillSwitch(false);
  });

  describe("Mode Management", () => {
    it("starts in OFF mode", () => {
      expect(amaService.getMode()).toBe("OFF");
    });

    it("allows OFF", () => {
      amaService.setMode("OFF");
      expect(amaService.getMode()).toBe("OFF");
    });

    it("allows REPLAY", () => {
      amaService.setMode("REPLAY");
      expect(amaService.getMode()).toBe("REPLAY");
    });

    it("allows SHADOW_SCENARIO", () => {
      amaService.setMode("SHADOW_SCENARIO");
      expect(amaService.getMode()).toBe("SHADOW_SCENARIO");
    });

    it("BLOCKS REAL_LIMITED at service layer", () => {
      expect(() => amaService.setMode("REAL_LIMITED")).toThrow();
      expect(amaService.getMode()).toBe("OFF");
    });

    it("BLOCKS REAL_FULL at service layer", () => {
      expect(() => amaService.setMode("REAL_FULL")).toThrow();
      expect(amaService.getMode()).toBe("OFF");
    });

    it("canSetMode returns false for REAL modes", () => {
      expect(amaService.canSetMode("REAL_LIMITED")).toBe(false);
      expect(amaService.canSetMode("REAL_FULL")).toBe(false);
    });

    it("canSetMode returns true for non-REAL modes", () => {
      expect(amaService.canSetMode("OFF")).toBe(true);
      expect(amaService.canSetMode("REPLAY")).toBe(true);
      expect(amaService.canSetMode("SHADOW_SCENARIO")).toBe(true);
      expect(amaService.canSetMode("LAB")).toBe(true);
    });
  });

  describe("Kill Switch", () => {
    it("starts inactive", () => {
      expect(amaService.isKillSwitchActive()).toBe(false);
    });

    it("can be activated", () => {
      amaService.setKillSwitch(true);
      expect(amaService.isKillSwitchActive()).toBe(true);
    });

    it("can be deactivated", () => {
      amaService.setKillSwitch(true);
      amaService.setKillSwitch(false);
      expect(amaService.isKillSwitchActive()).toBe(false);
    });

    it("deactivation does NOT activate REAL", () => {
      amaService.setKillSwitch(true);
      amaService.setKillSwitch(false);
      expect(amaService.getMode()).toBe("OFF");
    });
  });

  describe("Status", () => {
    it("returns valid status object", () => {
      const status = amaService.getStatus();
      expect(status).toHaveProperty("mode");
      expect(status).toHaveProperty("state");
      expect(status).toHaveProperty("pair");
      expect(status).toHaveProperty("strategyVersion");
      expect(status).toHaveProperty("killSwitchActive");
      expect(status).toHaveProperty("lastUpdated");
    });

    it("status pair is BTC/USD", () => {
      const status = amaService.getStatus();
      expect(status.pair).toBe("BTC/USD");
    });

    it("status state starts as OBSERVING", () => {
      const status = amaService.getStatus();
      expect(status.state).toBe("OBSERVING");
    });
  });

  describe("Market View (stub)", () => {
    it("returns all null market data", () => {
      const mv = amaService.getMarketView();
      expect(mv.analysisPrice).toBeNull();
      expect(mv.executionBid).toBeNull();
      expect(mv.executionAsk).toBeNull();
      expect(mv.highWaterMark).toBeNull();
    });

    it("data quality is UNAVAILABLE", () => {
      const mv = amaService.getMarketView();
      expect(mv.dataQuality).toBe("UNAVAILABLE");
    });
  });

  describe("Portfolio (stub)", () => {
    it("returns zero budget", () => {
      const p = amaService.getPortfolioSummary();
      expect(p.budgetUsd).toBe(0);
      expect(p.deployedUsd).toBe(0);
      expect(p.reservedUsd).toBe(0);
      expect(p.freeUsd).toBe(0);
    });

    it("returns zero BTC accumulated", () => {
      const p = amaService.getPortfolioSummary();
      expect(p.accumulatedQuantity).toBe(0);
    });

    it("returns empty sleeves", () => {
      const p = amaService.getPortfolioSummary();
      expect(p.sleeves).toHaveLength(0);
    });
  });

  describe("Cycles (stub)", () => {
    it("returns empty array", () => {
      expect(amaService.getCycles()).toHaveLength(0);
    });
  });

  describe("Policy (stub)", () => {
    it("returns null for active policy", () => {
      expect(amaService.getActivePolicy()).toBeNull();
    });
  });

  describe("Tranche Plan (stub)", () => {
    it("returns null for current plan", () => {
      expect(amaService.getTranchePlan()).toBeNull();
    });
  });

  describe("Mandate (stub)", () => {
    it("returns null for current mandate", () => {
      expect(amaService.getMandate()).toBeNull();
    });

    it("saveMandateDraft returns a mandateId", () => {
      const result = amaService.saveMandateDraft({
        asset: "BTC",
        maxCapitalUsd: 1000,
        riskMandate: "PRUDENTE",
        accumulationStyle: "ADAPTATIVO",
        exitObjective: "RECUPERAR_CAPITAL",
        autonomyLevel: "SOLO_ANALISIS",
      });
      expect(result.mandateId).toMatch(/^mandate-/);
    });
  });
});

describe("AMA Service — No Exchange Access", () => {
  it("does not import ExchangeFactory", () => {
    const serviceSource = amaService.constructor.toString();
    expect(serviceSource).not.toContain("ExchangeFactory");
  });

  it("does not have placeOrder method", () => {
    expect((amaService as any).placeOrder).toBeUndefined();
  });

  it("does not have cancelOrder method", () => {
    expect((amaService as any).cancelOrder).toBeUndefined();
  });

  it("does not have getBalance method", () => {
    expect((amaService as any).getBalance).toBeUndefined();
  });
});
