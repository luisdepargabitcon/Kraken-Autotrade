import { describe, it, expect } from "vitest";
import {
  AUTO_OPTIMIZATION_BLOCKED,
  POLICY_FROZEN_SINCE,
  POLICY_VERSION,
  blockAutoOptimization,
  isParameterChangeAuthorized,
} from "../spot/spotNoAutoOptimization";

describe("SpotNoAutoOptimization", () => {
  it("AUTO_OPTIMIZATION_BLOCKED is true", () => {
    expect(AUTO_OPTIMIZATION_BLOCKED).toBe(true);
  });

  it("POLICY_VERSION is SPOT-1.0.0-20260812", () => {
    expect(POLICY_VERSION).toBe("SPOT-1.0.0-20260812");
  });

  it("POLICY_FROZEN_SINCE is a date string", () => {
    expect(POLICY_FROZEN_SINCE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("blockAutoOptimization returns blocked=true", () => {
    const attempt = blockAutoOptimization("test-engine");
    expect(attempt.blocked).toBe(true);
    expect(attempt.reason).toContain("blocked");
    expect(attempt.currentVersion).toBe(POLICY_VERSION);
    expect(attempt.attemptedBy).toBe("test-engine");
    expect(attempt.timestamp).toBeGreaterThan(0);
  });

  it("isParameterChangeAuthorized returns false for any change during refactor", () => {
    expect(isParameterChangeAuthorized("riskPerTradeUsd", 50, 100)).toBe(false);
    expect(isParameterChangeAuthorized("profitTargetR", 3.0, 2.5)).toBe(false);
    expect(isParameterChangeAuthorized("slAtrMultiplier", 2.0, 1.5)).toBe(false);
  });

  it("blockAutoOptimization reason mentions manual authorization", () => {
    const attempt = blockAutoOptimization("auto-tuner");
    expect(attempt.reason).toContain("Manual authorization");
  });
});
