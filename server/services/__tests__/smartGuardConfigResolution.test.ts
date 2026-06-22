/**
 * Tests for Smart Guard configuration resolution.
 *
 * Validates that:
 *   - effectiveMaxLots comes from a single canonical source (bot_config.sg_max_open_lots_per_pair)
 *   - dryRunMode does NOT change maxLots
 *   - pair overrides work correctly
 *   - fallback = 1 when config missing
 *   - hardcoded values (2) never appear in resolution
 */

import { describe, it, expect } from "vitest";

// ── Pure resolution function (mirrors canonical logic in tradingEngine) ──

interface SmartGuardConfig {
  positionMode: string | null | undefined;
  sgMaxOpenLotsPerPair: number | null | undefined;
  sgPairOverrides: Record<string, { maxOpenLotsPerPair?: number }> | null | undefined;
  dryRunMode: boolean | null | undefined;
}

interface ResolvedSmartGuardConfig {
  positionMode: string;
  dryRunMode: boolean;
  globalMaxLots: number;
  pairOverrideMaxLots: number | null;
  effectiveMaxLots: number;
  source: string;
  warnings: string[];
}

function resolveSmartGuardConfig(pair: string, config: SmartGuardConfig | null | undefined): ResolvedSmartGuardConfig {
  const warnings: string[] = [];

  if (!config) {
    return {
      positionMode: "SINGLE",
      dryRunMode: false,
      globalMaxLots: 1,
      pairOverrideMaxLots: null,
      effectiveMaxLots: 1,
      source: "fallback_no_config",
      warnings: ["No bot_config available, using fallback=1"],
    };
  }

  const positionMode = config.positionMode || "SINGLE";
  const dryRunMode = config.dryRunMode ?? false;
  const globalMaxLots = config.sgMaxOpenLotsPerPair ?? 1;

  // In SINGLE mode, always 1 regardless of config
  if (positionMode !== "SMART_GUARD") {
    return {
      positionMode,
      dryRunMode,
      globalMaxLots,
      pairOverrideMaxLots: null,
      effectiveMaxLots: 1,
      source: "single_mode",
      warnings,
    };
  }

  // Check pair overrides
  let pairOverrideMaxLots: number | null = null;
  if (config.sgPairOverrides && pair in config.sgPairOverrides) {
    const override = config.sgPairOverrides[pair];
    if (override?.maxOpenLotsPerPair !== undefined && override.maxOpenLotsPerPair !== null) {
      pairOverrideMaxLots = override.maxOpenLotsPerPair;
    }
  }

  const effectiveMaxLots = pairOverrideMaxLots ?? globalMaxLots;
  const source = pairOverrideMaxLots !== null ? `pair_override:${pair}` : "bot_config.global";

  return {
    positionMode,
    dryRunMode,
    globalMaxLots,
    pairOverrideMaxLots,
    effectiveMaxLots,
    source,
    warnings,
  };
}

describe("Smart Guard Config Resolution", () => {

  describe("Case A: global=3, no override, dryRun=true → effectiveMaxLots=3", () => {
    it("resolves maxLots=3 from bot_config in DRY_RUN mode", () => {
      const result = resolveSmartGuardConfig("BTC/USD", {
        positionMode: "SMART_GUARD",
        sgMaxOpenLotsPerPair: 3,
        sgPairOverrides: null,
        dryRunMode: true,
      });
      expect(result.effectiveMaxLots).toBe(3);
      expect(result.source).toBe("bot_config.global");
      expect(result.dryRunMode).toBe(true);
    });
  });

  describe("Case B: global=3, no override, dryRun=false → effectiveMaxLots=3", () => {
    it("resolves maxLots=3 from bot_config in LIVE mode", () => {
      const result = resolveSmartGuardConfig("BTC/USD", {
        positionMode: "SMART_GUARD",
        sgMaxOpenLotsPerPair: 3,
        sgPairOverrides: null,
        dryRunMode: false,
      });
      expect(result.effectiveMaxLots).toBe(3);
      expect(result.source).toBe("bot_config.global");
      expect(result.dryRunMode).toBe(false);
    });
  });

  describe("Case C: global=3, override SOL/USD=2", () => {
    it("SOL uses override=2, BTC uses global=3", () => {
      const config: SmartGuardConfig = {
        positionMode: "SMART_GUARD",
        sgMaxOpenLotsPerPair: 3,
        sgPairOverrides: { "SOL/USD": { maxOpenLotsPerPair: 2 } },
        dryRunMode: true,
      };
      const sol = resolveSmartGuardConfig("SOL/USD", config);
      expect(sol.effectiveMaxLots).toBe(2);
      expect(sol.pairOverrideMaxLots).toBe(2);
      expect(sol.source).toBe("pair_override:SOL/USD");

      const btc = resolveSmartGuardConfig("BTC/USD", config);
      expect(btc.effectiveMaxLots).toBe(3);
      expect(btc.pairOverrideMaxLots).toBeNull();
      expect(btc.source).toBe("bot_config.global");
    });
  });

  describe("Case D: sgMaxOpenLotsPerPair undefined → fallback=1", () => {
    it("falls back to 1 when no config value", () => {
      const result = resolveSmartGuardConfig("BTC/USD", {
        positionMode: "SMART_GUARD",
        sgMaxOpenLotsPerPair: undefined,
        sgPairOverrides: null,
        dryRunMode: true,
      });
      expect(result.effectiveMaxLots).toBe(1);
      expect(result.globalMaxLots).toBe(1);
    });
  });

  describe("Case E: no config at all → fallback=1 with warning", () => {
    it("returns fallback when config is null", () => {
      const result = resolveSmartGuardConfig("BTC/USD", null);
      expect(result.effectiveMaxLots).toBe(1);
      expect(result.source).toBe("fallback_no_config");
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("Case F: DRY_RUN does NOT change maxLots", () => {
    it("same config produces same effectiveMaxLots for both modes", () => {
      const config: SmartGuardConfig = {
        positionMode: "SMART_GUARD",
        sgMaxOpenLotsPerPair: 3,
        sgPairOverrides: null,
        dryRunMode: false,
      };
      const configDry: SmartGuardConfig = { ...config, dryRunMode: true };

      const live = resolveSmartGuardConfig("BTC/USD", config);
      const dry = resolveSmartGuardConfig("BTC/USD", configDry);

      expect(live.effectiveMaxLots).toBe(dry.effectiveMaxLots);
      expect(live.effectiveMaxLots).toBe(3);
    });
  });

  describe("Case G: SINGLE mode always returns 1", () => {
    it("ignores sgMaxOpenLotsPerPair in SINGLE mode", () => {
      const result = resolveSmartGuardConfig("BTC/USD", {
        positionMode: "SINGLE",
        sgMaxOpenLotsPerPair: 5,
        sgPairOverrides: null,
        dryRunMode: false,
      });
      expect(result.effectiveMaxLots).toBe(1);
      expect(result.source).toBe("single_mode");
    });
  });

  describe("No hardcoded 2", () => {
    it("never returns 2 when config says 3", () => {
      const pairs = ["BTC/USD", "SOL/USD", "ETH/USD", "XRP/USD", "TON/USD"];
      for (const pair of pairs) {
        const result = resolveSmartGuardConfig(pair, {
          positionMode: "SMART_GUARD",
          sgMaxOpenLotsPerPair: 3,
          sgPairOverrides: null,
          dryRunMode: true,
        });
        expect(result.effectiveMaxLots).not.toBe(2);
        expect(result.effectiveMaxLots).toBe(3);
      }
    });
  });

  describe("openLotsThisPair does not affect effectiveMaxLots", () => {
    it("effectiveMaxLots is config-based, not state-based", () => {
      // Even if there are 3 lots open, the configured max stays at 3
      // The gate checks currentOpenLots >= maxLots, but resolution is independent
      const result = resolveSmartGuardConfig("BTC/USD", {
        positionMode: "SMART_GUARD",
        sgMaxOpenLotsPerPair: 3,
        sgPairOverrides: null,
        dryRunMode: true,
      });
      expect(result.effectiveMaxLots).toBe(3); // not reduced by open lots
    });
  });
});
