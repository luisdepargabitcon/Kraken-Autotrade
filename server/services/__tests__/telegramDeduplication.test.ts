/**
 * Telegram Alert Deduplication Tests
 * Tests for persistent DB-backed logical fingerprint deduplication
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { computeLogicalFingerprint, pnlToBand } from "../telegram/deduplication";

describe("Telegram Deduplication - Logical Fingerprint", () => {
  describe("computeLogicalFingerprint", () => {
    it("should generate consistent fingerprint for same input", () => {
      const input = {
        module: "SMART_EXIT_SUPPRESSED_FEE_BAND",
        pair: "ETH/USD",
        positionId: "lot-123",
        decision: "SUPPRESSED",
        suppressionReason: "fee-band",
        signals: ["EMA_REVERSAL", "MACD_REVERSAL"],
        score: 8,
        regime: "CHOP",
        confirmation: "0/10",
        pnlBand: "0.00-0.10",
      };

      const fp1 = computeLogicalFingerprint(input);
      const fp2 = computeLogicalFingerprint(input);

      expect(fp1).toBe(fp2);
      expect(fp1).toContain("SMART_EXIT_SUPPRESSED_FEE_BAND");
      expect(fp1).toContain("ETH/USD");
      expect(fp1).toContain("lot-123");
    });

    it("should sort signals for consistent fingerprint", () => {
      const input1 = {
        module: "SMART_EXIT_SUPPRESSED_FEE_BAND",
        pair: "ETH/USD",
        signals: ["EMA_REVERSAL", "MACD_REVERSAL", "MTF_ALIGNMENT_LOSS"],
      };

      const input2 = {
        module: "SMART_EXIT_SUPPRESSED_FEE_BAND",
        pair: "ETH/USD",
        signals: ["MTF_ALIGNMENT_LOSS", "EMA_REVERSAL", "MACD_REVERSAL"],
      };

      const fp1 = computeLogicalFingerprint(input1);
      const fp2 = computeLogicalFingerprint(input2);

      expect(fp1).toBe(fp2);
    });

    it("should generate different fingerprints for different pairs", () => {
      const input1 = {
        module: "SMART_EXIT_SUPPRESSED_FEE_BAND",
        pair: "ETH/USD",
        positionId: "lot-123",
      };

      const input2 = {
        module: "SMART_EXIT_SUPPRESSED_FEE_BAND",
        pair: "BTC/USD",
        positionId: "lot-123",
      };

      const fp1 = computeLogicalFingerprint(input1);
      const fp2 = computeLogicalFingerprint(input2);

      expect(fp1).not.toBe(fp2);
    });

    it("should generate different fingerprints for different suppression reasons", () => {
      const input1 = {
        module: "SMART_EXIT_SUPPRESSED_FEE_BAND",
        pair: "ETH/USD",
        suppressionReason: "fee-band",
      };

      const input2 = {
        module: "SMART_EXIT_SUPPRESSED_OTHER",
        pair: "ETH/USD",
        suppressionReason: "min-profit",
      };

      const fp1 = computeLogicalFingerprint(input1);
      const fp2 = computeLogicalFingerprint(input2);

      expect(fp1).not.toBe(fp2);
    });

    it("should use score floor for grouping similar scores", () => {
      const input1 = {
        module: "SMART_EXIT_SUPPRESSED_FEE_BAND",
        pair: "ETH/USD",
        score: 8.3,
      };

      const input2 = {
        module: "SMART_EXIT_SUPPRESSED_FEE_BAND",
        pair: "ETH/USD",
        score: 8.7,
      };

      const fp1 = computeLogicalFingerprint(input1);
      const fp2 = computeLogicalFingerprint(input2);

      expect(fp1).toBe(fp2); // Both floor to 8
    });

    it("should handle missing optional fields with wildcard", () => {
      const input = {
        module: "SMART_EXIT_SUPPRESSED_FEE_BAND",
        pair: "ETH/USD",
      };

      const fp = computeLogicalFingerprint(input);

      expect(fp).toContain("*"); // Wildcard for missing fields
      expect(fp).toContain("ETH/USD");
    });
  });

  describe("pnlToBand", () => {
    it("should round PnL to 0.10% bands", () => {
      expect(pnlToBand(0.00)).toBe("0.00-0.10");
      expect(pnlToBand(0.03)).toBe("0.00-0.10");
      expect(pnlToBand(0.09)).toBe("0.00-0.10");
      expect(pnlToBand(0.10)).toBe("0.10-0.20");
      expect(pnlToBand(0.15)).toBe("0.10-0.20");
      expect(pnlToBand(0.19)).toBe("0.10-0.20");
      expect(pnlToBand(0.20)).toBe("0.20-0.30");
    });

    it("should handle negative PnL", () => {
      expect(pnlToBand(-0.03)).toBe("-0.10-0.00");
      expect(pnlToBand(-0.15)).toBe("-0.20--0.10");
    });

    it("should group similar PnL values into same band", () => {
      const band1 = pnlToBand(0.00);
      const band2 = pnlToBand(0.03);
      const band3 = pnlToBand(0.04);

      expect(band1).toBe(band2);
      expect(band2).toBe(band3);
    });

    it("should separate different PnL bands", () => {
      const band1 = pnlToBand(0.00);
      const band2 = pnlToBand(0.15);

      expect(band1).not.toBe(band2);
    });
  });

  describe("Fingerprint stability for SMART EXIT spam scenario", () => {
    it("should group identical SMART EXIT suppressed events with small PnL variations", () => {
      const baseInput = {
        module: "SMART_EXIT_SUPPRESSED_FEE_BAND",
        pair: "ETH/USD",
        positionId: "lot-123",
        decision: "SUPPRESSED",
        suppressionReason: "fee-band",
        signals: ["EMA_REVERSAL", "MACD_REVERSAL", "MTF_ALIGNMENT_LOSS", "ENTRY_SIGNAL_DETERIORATION"],
        score: 8,
        regime: "CHOP",
        confirmation: "0/10",
      };

      // Simulate 10 evaluations with small PnL variations
      const fingerprints = [];
      for (let i = 0; i < 10; i++) {
        const pnl = 0.00 + (i * 0.01); // 0.00%, 0.01%, 0.02%, ..., 0.09%
        const input = {
          ...baseInput,
          pnlBand: pnlToBand(pnl),
        };
        fingerprints.push(computeLogicalFingerprint(input));
      }

      // All should be in the same band (0.00-0.10)
      const uniqueFingerprints = new Set(fingerprints);
      expect(uniqueFingerprints.size).toBe(1);
    });

    it("should detect fingerprint change when regime changes", () => {
      const baseInput = {
        module: "SMART_EXIT_SUPPRESSED_FEE_BAND",
        pair: "ETH/USD",
        positionId: "lot-123",
        decision: "SUPPRESSED",
        suppressionReason: "fee-band",
        signals: ["EMA_REVERSAL", "MACD_REVERSAL"],
        score: 8,
        confirmation: "0/10",
        pnlBand: "0.00-0.10",
      };

      const fpChop = computeLogicalFingerprint({ ...baseInput, regime: "CHOP" });
      const fpTrend = computeLogicalFingerprint({ ...baseInput, regime: "TREND" });

      expect(fpChop).not.toBe(fpTrend);
    });

    it("should detect fingerprint change when signals change", () => {
      const baseInput = {
        module: "SMART_EXIT_SUPPRESSED_FEE_BAND",
        pair: "ETH/USD",
        positionId: "lot-123",
        decision: "SUPPRESSED",
        suppressionReason: "fee-band",
        score: 8,
        regime: "CHOP",
        confirmation: "0/10",
        pnlBand: "0.00-0.10",
      };

      const fp1 = computeLogicalFingerprint({ ...baseInput, signals: ["EMA_REVERSAL", "MACD_REVERSAL"] });
      const fp2 = computeLogicalFingerprint({ ...baseInput, signals: ["EMA_REVERSAL", "MACD_REVERSAL", "MTF_ALIGNMENT_LOSS"] });

      expect(fp1).not.toBe(fp2);
    });
  });
});
