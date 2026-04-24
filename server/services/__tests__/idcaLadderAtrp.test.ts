/**
 * IdcaLadderAtrpService — Unit tests (vitest)
 *
 * Covers:
 * - createLadderConfig: profiles, sliderIntensity clamp behavior, effectiveMultipliers
 * - calculateLadder: clamps (min/maxDipPct), VWAP zone factor, target prices, adaptive
 * - Trailing Buy Level 1: arm, track localLow, update targetPrice, cancel on recovery, expiration
 */
import { describe, it, expect, beforeEach } from "vitest";
import { idcaLadderAtrpService } from "../institutionalDca/IdcaLadderAtrpService";
import type {
  LadderAtrpConfig,
  TrailingBuyLevel1Config,
  LadderResult,
  LadderLevel,
} from "../institutionalDca/IdcaTypes";
import type { MarketContext } from "../institutionalDca/IdcaMarketContextService";

// ---- Helpers ---------------------------------------------------------

function mockMarketContext(overrides: Partial<MarketContext> = {}): MarketContext {
  return {
    pair: "BTC/USD",
    anchorPrice: 100000,
    anchorTimestamp: new Date(),
    anchorAgeHours: 1,
    currentPrice: 98000,
    priceUpdatedAt: new Date(),
    atr: 500,
    atrPct: 2.0,
    drawdownPct: 2.0,
    vwapZone: "between_bands",
    dataQuality: "good",
    lastUpdated: new Date(),
    ...overrides,
  };
}

function baseTrailingConfig(overrides: Partial<TrailingBuyLevel1Config> = {}): TrailingBuyLevel1Config {
  return {
    enabled: true,
    triggerLevel: 0,
    triggerMode: "dip_pct",
    trailingMode: "rebound_pct",
    trailingValue: 0.5,
    maxWaitMinutes: 60,
    cancelOnRecovery: true,
    minVolumeCheck: false,
    confirmWithVwap: false,
    ...overrides,
  };
}

// ---- createLadderConfig ----------------------------------------------

describe("IdcaLadderAtrpService.createLadderConfig — profiles & intensity", () => {
  it("balanced profile at intensity=50 produces maxLevels=5 effectiveMultipliers", () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    expect(cfg.profile).toBe("balanced");
    expect(cfg.enabled).toBe(true);
    expect(cfg.sliderIntensity).toBe(50);
    expect(cfg.effectiveMultipliers).toHaveLength(5);
    // Each subsequent multiplier should be >= previous (monotonic non-decreasing)
    for (let i = 1; i < cfg.effectiveMultipliers.length; i++) {
      expect(cfg.effectiveMultipliers[i]).toBeGreaterThanOrEqual(cfg.effectiveMultipliers[i - 1]);
    }
  });

  it("aggressive profile has smaller base dip than conservative", () => {
    const aggr = idcaLadderAtrpService.createLadderConfig("aggressive", 50);
    const cons = idcaLadderAtrpService.createLadderConfig("conservative", 50);
    expect(aggr.minDipPct).toBeLessThan(cons.minDipPct);
    expect(aggr.sizeDistribution[0]).toBeGreaterThan(cons.sizeDistribution[0]);
  });

  it("intensity=100 produces smaller effective multipliers than intensity=0", () => {
    // intensityFactor = 0.5 + (intensity/100)*1.5 → higher intensity → smaller adjusted multipliers
    const hi = idcaLadderAtrpService.createLadderConfig("balanced", 100);
    const lo = idcaLadderAtrpService.createLadderConfig("balanced", 0);
    expect(hi.baseMultiplier).toBeLessThan(lo.baseMultiplier);
    expect(hi.maxMultiplier).toBeLessThan(lo.maxMultiplier);
  });

  it("maxMultiplier clamps effectiveMultipliers upper bound", () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    for (const m of cfg.effectiveMultipliers) {
      expect(m).toBeLessThanOrEqual(cfg.maxMultiplier + 1e-9);
    }
  });

  it("custom profile returns enabled config with 5 multipliers", () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("custom", 25);
    expect(cfg.profile).toBe("custom");
    expect(cfg.effectiveMultipliers).toHaveLength(5);
  });
});

// ---- calculateLadder --------------------------------------------------

describe("IdcaLadderAtrpService.calculateLadder — clamps & target prices", () => {
  it("throws when config is disabled", async () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    cfg.enabled = false;
    await expect(
      idcaLadderAtrpService.calculateLadder("BTC/USD", cfg, mockMarketContext())
    ).rejects.toThrow(/not enabled/);
  });

  it("throws when atrPct is undefined in market context", async () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    await expect(
      idcaLadderAtrpService.calculateLadder(
        "BTC/USD",
        cfg,
        mockMarketContext({ atrPct: undefined })
      )
    ).rejects.toThrow(/ATRP not available/);
  });

  it("produces at least 1 level and triggerPrice < anchorPrice for all levels", async () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    const ctx = mockMarketContext({ anchorPrice: 100000, currentPrice: 99000, atrPct: 2.0 });
    const res = await idcaLadderAtrpService.calculateLadder("BTC/USD", cfg, ctx);
    expect(res.levels.length).toBeGreaterThanOrEqual(1);
    for (const lvl of res.levels) {
      expect(lvl.triggerPrice).toBeLessThan(ctx.anchorPrice);
      // dipPct must respect clamps
      expect(lvl.dipPct).toBeGreaterThanOrEqual(cfg.minDipPct - 1e-9);
      expect(lvl.dipPct).toBeLessThanOrEqual(cfg.maxDipPct + 1e-9);
    }
  });

  it("VWAP zone below_lower3 yields smaller dipPct than between_bands (more aggressive)", async () => {
    const cfgA = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    const cfgB = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    const ctxDeep = mockMarketContext({ vwapZone: "below_lower3", currentPrice: 94000 });
    const ctxMid = mockMarketContext({ vwapZone: "between_bands", currentPrice: 98000 });
    const resDeep = await idcaLadderAtrpService.calculateLadder("BTC/USD", cfgA, ctxDeep);
    const resMid = await idcaLadderAtrpService.calculateLadder("BTC/USD", cfgB, ctxMid);
    // Deep value zone uses factor 0.8 → smaller dipPct for level 0
    expect(resDeep.levels[0].dipPct).toBeLessThan(resMid.levels[0].dipPct + 1e-9);
  });

  it("maxDrawdownCovered equals dipPct of last level", async () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    const ctx = mockMarketContext({ anchorPrice: 100000, currentPrice: 50000, atrPct: 2.0 });
    const res = await idcaLadderAtrpService.calculateLadder("BTC/USD", cfg, ctx);
    const last = res.levels[res.levels.length - 1];
    expect(res.maxDrawdownCovered).toBeCloseTo(last.dipPct, 5);
  });

  it("stops building levels when currentPrice is above next trigger", async () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    // currentPrice very close to anchor → only first level might be inactive beyond it
    const ctx = mockMarketContext({ anchorPrice: 100000, currentPrice: 99950, atrPct: 2.0 });
    const res = await idcaLadderAtrpService.calculateLadder("BTC/USD", cfg, ctx);
    // Since currentPrice > level0.triggerPrice, the loop should break after level0
    expect(res.levels.length).toBe(1);
    expect(res.levels[0].isActive).toBe(false);
  });
});

// ---- Trailing Buy Level 1 --------------------------------------------

describe("IdcaLadderAtrpService.checkTrailingBuyTrigger — arm/track/cancel", () => {
  beforeEach(() => {
    idcaLadderAtrpService.clearTrailingBuyState("BTC/USD");
  });

  function fakeLadder(triggerPriceL0: number): LadderResult {
    const lvl0: LadderLevel = {
      level: 0,
      dipPct: 1.0,
      triggerPrice: triggerPriceL0,
      sizePct: 25,
      atrpMultiplier: 0.5,
      isActive: true,
    };
    return {
      levels: [lvl0],
      totalLevels: 1,
      maxDrawdownCovered: 1.0,
      totalSizePct: 25,
      calculatedAt: new Date(),
      config: idcaLadderAtrpService.createLadderConfig("balanced", 50),
      marketContext: {
        anchorPrice: 100000,
        currentPrice: triggerPriceL0,
        atrPct: 2.0,
        vwapZone: "between_bands",
      },
    };
  }

  it("does not arm when config.enabled=false", () => {
    const cfg = baseTrailingConfig({ enabled: false });
    const ladder = fakeLadder(99000);
    const state = idcaLadderAtrpService.checkTrailingBuyTrigger("BTC/USD", cfg, ladder, 98900);
    expect(state).toBeNull();
  });

  it("arms when price reaches trigger, sets isArmed=true and targetPrice above current", () => {
    const cfg = baseTrailingConfig({ trailingMode: "rebound_pct", trailingValue: 0.5 });
    const ladder = fakeLadder(99000);
    const state = idcaLadderAtrpService.checkTrailingBuyTrigger("BTC/USD", cfg, ladder, 98500);
    expect(state).not.toBeNull();
    expect(state!.isArmed).toBe(true);
    expect(state!.localLow).toBe(98500);
    // target = current * (1 + 0.5/100) = 98500 * 1.005 = 98992.5
    expect(state!.targetPrice).toBeCloseTo(98992.5, 3);
  });

  it("updates localLow and targetPrice when price goes lower", () => {
    const cfg = baseTrailingConfig({ trailingMode: "rebound_pct", trailingValue: 0.5 });
    const ladder = fakeLadder(99000);
    idcaLadderAtrpService.checkTrailingBuyTrigger("BTC/USD", cfg, ladder, 98500);
    const updated = idcaLadderAtrpService.checkTrailingBuyTrigger("BTC/USD", cfg, ladder, 98000);
    expect(updated).not.toBeNull();
    expect(updated!.localLow).toBe(98000);
    expect(updated!.targetPrice).toBeCloseTo(98000 * 1.005, 3);
  });

  it("shouldExecuteTrailingBuy returns true when currentPrice >= targetPrice", () => {
    const cfg = baseTrailingConfig({ trailingMode: "rebound_pct", trailingValue: 0.5 });
    const ladder = fakeLadder(99000);
    idcaLadderAtrpService.checkTrailingBuyTrigger("BTC/USD", cfg, ladder, 98500);
    expect(idcaLadderAtrpService.shouldExecuteTrailingBuy("BTC/USD", 98500)).toBe(false);
    expect(idcaLadderAtrpService.shouldExecuteTrailingBuy("BTC/USD", 99000)).toBe(true);
  });

  it("cancels on recovery when price moves >2% above trigger", () => {
    const cfg = baseTrailingConfig({ cancelOnRecovery: true });
    const ladder = fakeLadder(99000);
    idcaLadderAtrpService.checkTrailingBuyTrigger("BTC/USD", cfg, ladder, 98500);
    // Recovery: 99000 * 1.02 = 100980 → price above threshold must cancel
    const after = idcaLadderAtrpService.checkTrailingBuyTrigger("BTC/USD", cfg, ladder, 101000);
    expect(after).toBeNull();
    expect(idcaLadderAtrpService.getTrailingBuyState("BTC/USD")).toBeUndefined();
  });

  it("clearTrailingBuyState removes state", () => {
    const cfg = baseTrailingConfig();
    const ladder = fakeLadder(99000);
    idcaLadderAtrpService.checkTrailingBuyTrigger("BTC/USD", cfg, ladder, 98500);
    expect(idcaLadderAtrpService.getTrailingBuyState("BTC/USD")).toBeDefined();
    idcaLadderAtrpService.clearTrailingBuyState("BTC/USD");
    expect(idcaLadderAtrpService.getTrailingBuyState("BTC/USD")).toBeUndefined();
  });

  it("atrp_fraction mode uses atrPct from ladder marketContext", () => {
    const cfg = baseTrailingConfig({ trailingMode: "atrp_fraction", trailingValue: 0.5 });
    const ladder = fakeLadder(99000);
    const state = idcaLadderAtrpService.checkTrailingBuyTrigger("BTC/USD", cfg, ladder, 98500);
    // target = 98500 * (1 + 0.5 * 2.0 / 100) = 98500 * 1.01 = 99485
    expect(state!.targetPrice).toBeCloseTo(99485, 2);
  });

  it("expires state when expiresAt has passed", () => {
    const cfg = baseTrailingConfig({ maxWaitMinutes: 0.01 }); // ~0.6s
    const ladder = fakeLadder(99000);
    idcaLadderAtrpService.checkTrailingBuyTrigger("BTC/USD", cfg, ladder, 98500);
    // Force-expire manually
    const s = idcaLadderAtrpService.getTrailingBuyState("BTC/USD");
    s!.expiresAt = new Date(Date.now() - 10);
    const after = idcaLadderAtrpService.checkTrailingBuyTrigger("BTC/USD", cfg, ladder, 98400);
    expect(after).toBeNull();
    expect(idcaLadderAtrpService.getTrailingBuyState("BTC/USD")).toBeUndefined();
  });
});

// ---- Manual Level Enabled -----------------------------------------------

describe("IdcaLadderAtrpService.calculateLadder — manualLevelEnabled", () => {
  it("respeta manualSizeDistribution.length cuando manualLevelEnabled=true", async () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    cfg.manualLevelEnabled = true;
    cfg.manualMultipliers = [0.8, 1.6, 2.4, 3.2, 4.0];
    cfg.manualSizeDistribution = [20, 20, 20, 20, 20];
    cfg.allowDeepExtension = true;
    cfg.depthMode = "deep";
    
    const ctx = mockMarketContext({ anchorPrice: 100000, currentPrice: 95000, atrPct: 2.0 });
    const res = await idcaLadderAtrpService.calculateLadder("BTC/USD", cfg, ctx);
    
    expect(res.levels.length).toBe(5);
    expect(res.totalSizePct).toBe(100);
    expect(res.isLimitedByMaxLevels).toBe(false);
  });

  it("respeta manualMultipliers cuando manualLevelEnabled=true", async () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    cfg.manualLevelEnabled = true;
    cfg.manualMultipliers = [0.8, 1.6, 2.4, 3.2, 4.0];
    cfg.manualSizeDistribution = [20, 20, 20, 20, 20];
    
    const ctx = mockMarketContext({ anchorPrice: 100000, currentPrice: 95000, atrPct: 2.0 });
    const res = await idcaLadderAtrpService.calculateLadder("BTC/USD", cfg, ctx);
    
    expect(res.levels[0].atrpMultiplier).toBeCloseTo(0.8, 5);
    expect(res.levels[1].atrpMultiplier).toBeCloseTo(1.6, 5);
    expect(res.levels[2].atrpMultiplier).toBeCloseTo(2.4, 5);
    expect(res.levels[3].atrpMultiplier).toBeCloseTo(3.2, 5);
    expect(res.levels[4].atrpMultiplier).toBeCloseTo(4.0, 5);
  });

  it("no extiende niveles cuando manualLevelEnabled=true", async () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    cfg.manualLevelEnabled = true;
    cfg.manualMultipliers = [0.8, 1.6];
    cfg.manualSizeDistribution = [50, 50];
    cfg.allowDeepExtension = true;
    cfg.depthMode = "deep";
    cfg.targetCoveragePct = 20; // Muy alto para intentar forzar extensión
    
    const ctx = mockMarketContext({ anchorPrice: 100000, currentPrice: 95000, atrPct: 2.0 });
    const res = await idcaLadderAtrpService.calculateLadder("BTC/USD", cfg, ctx);
    
    expect(res.levels.length).toBe(2);
    expect(res.totalSizePct).toBe(100);
  });
});

// ---- Normalización de tamaños en modo automático -------------------------

describe("IdcaLadderAtrpService.calculateLadder — normalización totalSize", () => {
  it("normaliza tamaños cuando manualLevelEnabled=false y totalSize > 100", async () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    cfg.manualLevelEnabled = false;
    cfg.allowDeepExtension = true;
    cfg.depthMode = "deep";
    cfg.targetCoveragePct = 12;
    
    const ctx = mockMarketContext({ anchorPrice: 100000, currentPrice: 50000, atrPct: 2.0 });
    const res = await idcaLadderAtrpService.calculateLadder("BTC/USD", cfg, ctx);
    
    // totalSize debe ser <= 100
    expect(res.totalSizePct).toBeLessThanOrEqual(100.01);
    // Si hay niveles, totalSize debe ser cercano a 100
    if (res.levels.length > 0) {
      expect(res.totalSizePct).toBeGreaterThan(99.99);
    }
  });

  it("puede generar niveles extendidos en modo automático", async () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    cfg.manualLevelEnabled = false;
    cfg.allowDeepExtension = true;
    cfg.depthMode = "deep";
    cfg.targetCoveragePct = 12;
    
    const ctx = mockMarketContext({ anchorPrice: 100000, currentPrice: 50000, atrPct: 2.0 });
    const res = await idcaLadderAtrpService.calculateLadder("BTC/USD", cfg, ctx);
    
    // Debe generar más niveles que config.maxLevels cuando se extiende
    expect(res.levels.length).toBeGreaterThan(cfg.maxLevels);
  });
});

// ---- Validación de campos de niveles ------------------------------------

describe("IdcaLadderAtrpService.calculateLadder — validación campos", () => {
  it("todos los niveles tienen atrpMultiplier definido", async () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    const ctx = mockMarketContext({ anchorPrice: 100000, currentPrice: 50000, atrPct: 2.0 });
    const res = await idcaLadderAtrpService.calculateLadder("BTC/USD", cfg, ctx);
    
    for (const lvl of res.levels) {
      expect(lvl.atrpMultiplier).toBeDefined();
      expect(typeof lvl.atrpMultiplier).toBe("number");
      expect(lvl.atrpMultiplier).not.toBeNaN();
    }
  });

  it("todos los niveles tienen isActive definido", async () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    const ctx = mockMarketContext({ anchorPrice: 100000, currentPrice: 50000, atrPct: 2.0 });
    const res = await idcaLadderAtrpService.calculateLadder("BTC/USD", cfg, ctx);
    
    for (const lvl of res.levels) {
      expect(lvl.isActive).toBeDefined();
      expect(typeof lvl.isActive).toBe("boolean");
    }
  });

  it("todos los niveles tienen triggerPrice definido", async () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    const ctx = mockMarketContext({ anchorPrice: 100000, currentPrice: 50000, atrPct: 2.0 });
    const res = await idcaLadderAtrpService.calculateLadder("BTC/USD", cfg, ctx);
    
    for (const lvl of res.levels) {
      expect(lvl.triggerPrice).toBeDefined();
      expect(typeof lvl.triggerPrice).toBe("number");
      expect(lvl.triggerPrice).not.toBeNaN();
      expect(lvl.triggerPrice).toBeGreaterThan(0);
    }
  });

  it("todos los niveles tienen sizePct definido", async () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    const ctx = mockMarketContext({ anchorPrice: 100000, currentPrice: 50000, atrPct: 2.0 });
    const res = await idcaLadderAtrpService.calculateLadder("BTC/USD", cfg, ctx);
    
    for (const lvl of res.levels) {
      expect(lvl.sizePct).toBeDefined();
      expect(typeof lvl.sizePct).toBe("number");
      expect(lvl.sizePct).not.toBeNaN();
      expect(lvl.sizePct).toBeGreaterThanOrEqual(0);
    }
  });

  it("no hay null/undefined/NaN en campos críticos", async () => {
    const cfg = idcaLadderAtrpService.createLadderConfig("balanced", 50);
    const ctx = mockMarketContext({ anchorPrice: 100000, currentPrice: 50000, atrPct: 2.0 });
    const res = await idcaLadderAtrpService.calculateLadder("BTC/USD", cfg, ctx);
    
    for (const lvl of res.levels) {
      expect(lvl.dipPct).not.toBeNull();
      expect(lvl.dipPct).not.toBeUndefined();
      expect(lvl.dipPct).not.toBeNaN();
      
      expect(lvl.triggerPrice).not.toBeNull();
      expect(lvl.triggerPrice).not.toBeUndefined();
      expect(lvl.triggerPrice).not.toBeNaN();
      
      expect(lvl.sizePct).not.toBeNull();
      expect(lvl.sizePct).not.toBeUndefined();
      expect(lvl.sizePct).not.toBeNaN();
      
      expect(lvl.atrpMultiplier).not.toBeNull();
      expect(lvl.atrpMultiplier).not.toBeUndefined();
      expect(lvl.atrpMultiplier).not.toBeNaN();
    }
  });
});
