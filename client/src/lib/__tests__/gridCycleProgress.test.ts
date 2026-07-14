import { describe, it, expect } from "vitest";
import { computeCycleProgress, cycleProgressBarZones } from "../gridCycleProgress";

function makeCycle(p: {
  status?: string;
  buyPrice?: number | null;
  sellPrice?: number | null;
  stopLossPrice?: number | null;
  trailingActivationPrice?: number | null;
  trailingStopPrice?: number | null;
  targetSellPrice?: number | null;
}): any {
  return {
    status: p.status ?? "buy_filled",
    buyPrice: p.buyPrice ?? null,
    sellPrice: p.sellPrice ?? null,
    stopLossPrice: p.stopLossPrice ?? null,
    trailingActivationPrice: p.trailingActivationPrice ?? null,
    trailingStopPrice: p.trailingStopPrice ?? null,
    targetSellPrice: p.targetSellPrice ?? null,
  };
}

describe("computeCycleProgress", () => {
  it("buy_filled cycle calculates distance to TP", () => {
    const cycle = makeCycle({ status: "buy_filled", buyPrice: 60000, targetSellPrice: 61200 });
    const result = computeCycleProgress(cycle, 60500);
    expect(result.state).toBe("towards_tp");
    expect(result.distanceToTargetPct).not.toBeNull();
    expect(result.distanceToTargetPct!).toBeGreaterThan(0);
    expect(result.isActive).toBe(true);
  });

  it("calculates distance to stop", () => {
    const cycle = makeCycle({ status: "buy_filled", buyPrice: 60000, stopLossPrice: 58000 });
    const result = computeCycleProgress(cycle, 60000);
    expect(result.distanceToStopPct).not.toBeNull();
    expect(result.distanceToStopPct!).toBeGreaterThan(0);
  });

  it("trailing inactive: calculates falta para activación", () => {
    const cycle = makeCycle({
      status: "buy_filled",
      buyPrice: 60000,
      targetSellPrice: 62000,
      trailingActivationPrice: 61500,
    });
    const result = computeCycleProgress(cycle, 60500);
    expect(result.state).toBe("trailing_inactive");
    expect(result.distanceToTrailingActivationPct).not.toBeNull();
    expect(result.distanceToTrailingActivationPct!).toBeGreaterThan(0);
  });

  it("trailing active when trailingStopPrice is set", () => {
    const cycle = makeCycle({
      status: "buy_filled",
      buyPrice: 60000,
      trailingActivationPrice: 61000,
      trailingStopPrice: 60800,
    });
    const result = computeCycleProgress(cycle, 61500);
    expect(result.state).toBe("trailing_active");
    expect(result.trailingStopPrice).toBe(60800);
  });

  it("near_stop state when price is close to stop", () => {
    const cycle = makeCycle({ status: "buy_filled", buyPrice: 60000, stopLossPrice: 59000 });
    const result = computeCycleProgress(cycle, 59100);
    expect(result.state).toBe("near_stop");
    expect(result.color).toBe("red");
  });

  it("closed cycle does not show active progress", () => {
    const cycle = makeCycle({ status: "completed", buyPrice: 60000, sellPrice: 61000 });
    const result = computeCycleProgress(cycle, 61000);
    expect(result.state).toBe("closed");
    expect(result.isActive).toBe(false);
    expect(result.progressPct).toBe(100);
  });

  it("cancelled cycle maps to cancelled state", () => {
    const cycle = makeCycle({ status: "cancelled", buyPrice: 60000 });
    const result = computeCycleProgress(cycle, 60500);
    expect(result.state).toBe("cancelled");
    expect(result.isActive).toBe(false);
  });

  it("progress 0 when no price above buy", () => {
    const cycle = makeCycle({ status: "buy_filled", buyPrice: 60000, targetSellPrice: 62000 });
    const result = computeCycleProgress(cycle, 60000);
    expect(result.progressPct).toBe(0);
  });

  it("progress 50 when current is midway to target", () => {
    const cycle = makeCycle({ status: "buy_filled", buyPrice: 60000, targetSellPrice: 62000 });
    const result = computeCycleProgress(cycle, 61000);
    expect(result.progressPct).toBeCloseTo(50, 1);
  });

  it("tooltip includes distance to target", () => {
    const cycle = makeCycle({ status: "buy_filled", buyPrice: 60000, targetSellPrice: 62000 });
    const result = computeCycleProgress(cycle, 61000);
    expect(result.tooltipLines.some(l => l.includes("objetivo"))).toBe(true);
  });

  it("trailing tooltip shows activation info when inactive", () => {
    const cycle = makeCycle({
      status: "buy_filled",
      buyPrice: 60000,
      targetSellPrice: 63000,
      trailingActivationPrice: 62000,
    });
    const result = computeCycleProgress(cycle, 61000);
    expect(result.state).toBe("trailing_inactive");
    expect(result.tooltipLines.some(l => l.includes("Trailing"))).toBe(true);
  });
});

describe("cycleProgressBarZones", () => {
  it("returns valid zone percentages summing to ~100", () => {
    const cycle = makeCycle({ status: "buy_filled", buyPrice: 60000, targetSellPrice: 62000, stopLossPrice: 59000 });
    const result = computeCycleProgress(cycle, 61000);
    const zones = cycleProgressBarZones(result);
    const total = zones.stopZonePct + zones.buySellZonePct + zones.progressZonePct + zones.tpZonePct;
    expect(total).toBeCloseTo(100, 1);
  });

  it("handles missing stop gracefully", () => {
    const cycle = makeCycle({ status: "buy_filled", buyPrice: 60000, targetSellPrice: 62000 });
    const result = computeCycleProgress(cycle, 61000);
    const zones = cycleProgressBarZones(result);
    expect(zones.stopZonePct).toBeGreaterThan(0);
  });
});
