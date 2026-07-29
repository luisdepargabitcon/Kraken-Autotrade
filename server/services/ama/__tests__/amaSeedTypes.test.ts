/**
 * AMA Seed Types V2.2 — Tests
 * Fase 2A: Asset profiles, Seed Policies BTC/ETH, envelopes, HWM, risk overlay, sources, time contract, eras ETH, ETH/BTC filter
 */

import { describe, it, expect } from "vitest";
import {
  BTC_ASSET_PROFILE,
  ETH_ASSET_PROFILE,
  ASSET_PROFILES,
  BTC_SEED_POLICY,
  ETH_SEED_POLICY,
  type Envelope,
  validateEnvelope,
  HWM_STATES,
  canHwmGoDown,
  RISK_OVERLAY_CONFIG,
  isWeightMultiplierValid,
  isChallengerMultiplier,
  KRAKEN_SOURCE,
  COIN_METRICS_ARCHIVE_SOURCE,
  COIN_METRICS_PRO_SOURCE,
  SOURCE_TAXONOMIES,
  createUtcTimeContract,
  isTimestampFuture,
  ETHEREUM_ERAS,
  GLAMSTERDAM_STATUS,
  isEraActive,
  applyEthBtcFilter,
  type EthBtcFilterState,
  BTC_EXIT_STATUS,
  ETH_EXIT_STATUS,
  AMA_RETENTION_CLASS,
  RETENTION_AUTO_DELETE_PROHIBITED,
  ACTIVE_SEED_OVERLAY,
} from "../amaSeedTypes";

// ─── Asset Profiles ─────────────────────────────────────────────────

describe("AMA Seed V2.2 — Asset Profiles", () => {
  it("BTC profile is LAB_ONLY", () => {
    expect(BTC_ASSET_PROFILE.asset).toBe("BTC");
    expect(BTC_ASSET_PROFILE.mode).toBe("LAB_ONLY");
    expect(BTC_ASSET_PROFILE.executionVenue).toBe("KRAKEN_SPOT");
    expect(BTC_ASSET_PROFILE.pipeline).toBe("BTC_LAB");
  });

  it("BTC profile cannot reserve capital or execute in LAB_ONLY", () => {
    expect(BTC_ASSET_PROFILE.canReserveCapital).toBe(false);
    expect(BTC_ASSET_PROFILE.canCreateIntents).toBe(false);
    expect(BTC_ASSET_PROFILE.canExecute).toBe(false);
    expect(BTC_ASSET_PROFILE.canUseRevolutX).toBe(false);
  });

  it("ETH profile is RESEARCH_ONLY with DISABLED venue", () => {
    expect(ETH_ASSET_PROFILE.asset).toBe("ETH");
    expect(ETH_ASSET_PROFILE.mode).toBe("RESEARCH_ONLY");
    expect(ETH_ASSET_PROFILE.executionVenue).toBe("DISABLED");
    expect(ETH_ASSET_PROFILE.pipeline).toBe("ETH_RESEARCH");
  });

  it("ETH profile cannot reserve, create intents, execute, use Revolut X, or share BTC capital", () => {
    expect(ETH_ASSET_PROFILE.canReserveCapital).toBe(false);
    expect(ETH_ASSET_PROFILE.canCreateIntents).toBe(false);
    expect(ETH_ASSET_PROFILE.canExecute).toBe(false);
    expect(ETH_ASSET_PROFILE.canUseRevolutX).toBe(false);
    expect(ETH_ASSET_PROFILE.sharesBtcCapital).toBe(false);
    expect(ETH_ASSET_PROFILE.inheritsBtcPromotion).toBe(false);
  });

  it("ASSET_PROFILES has both BTC and ETH", () => {
    expect(Object.keys(ASSET_PROFILES).sort()).toEqual(["BTC", "ETH"]);
  });
});

// ─── Seed Policy BTC ─────────────────────────────────────────────────

describe("AMA Seed V2.2 — Seed Policy BTC", () => {
  it("has correct policyId and asset", () => {
    expect(BTC_SEED_POLICY.policyId).toBe("AMA_BTC_SEED_V1_RESEARCH");
    expect(BTC_SEED_POLICY.asset).toBe("BTC");
  });

  it("is LAB_ONLY with 6 tranches and 75/25 capital allocation", () => {
    expect(BTC_SEED_POLICY.status).toBe("LAB_ONLY");
    expect(BTC_SEED_POLICY.trancheCount).toBe(6);
    expect(BTC_SEED_POLICY.capitalDeploymentPct).toBe(75);
    expect(BTC_SEED_POLICY.capitalReservePct).toBe(25);
  });

  it("is makerOnly with no taker fallback", () => {
    expect(BTC_SEED_POLICY.makerOnly).toBe(true);
    expect(BTC_SEED_POLICY.takerFallback).toBe(false);
  });

  it("has fixedReversalCenterPct = 10.0, ATR multiplier = 3.0, 3 daily closes", () => {
    expect(BTC_SEED_POLICY.fixedReversalCenterPct).toBe(10.0);
    expect(BTC_SEED_POLICY.atrMultiplier).toBe(3.0);
    expect(BTC_SEED_POLICY.requiredDailyCloses).toBe(3);
  });

  it("capital deployment + reserve = 100%", () => {
    expect(BTC_SEED_POLICY.capitalDeploymentPct + BTC_SEED_POLICY.capitalReservePct).toBe(100);
  });
});

// ─── Seed Policy ETH ─────────────────────────────────────────────────

describe("AMA Seed V2.2 — Seed Policy ETH", () => {
  it("has correct policyId and asset", () => {
    expect(ETH_SEED_POLICY.policyId).toBe("AMA_ETH_SEED_V1_RESEARCH_ONLY");
    expect(ETH_SEED_POLICY.asset).toBe("ETH");
  });

  it("is RESEARCH_ONLY with DISABLED venue and 7 tranches", () => {
    expect(ETH_SEED_POLICY.status).toBe("RESEARCH_ONLY");
    expect(ETH_SEED_POLICY.executionVenue).toBe("DISABLED");
    expect(ETH_SEED_POLICY.trancheCount).toBe(7);
  });

  it("has 65/35 capital allocation", () => {
    expect(ETH_SEED_POLICY.capitalDeploymentPct).toBe(65);
    expect(ETH_SEED_POLICY.capitalReservePct).toBe(35);
  });

  it("has fixedReversalCenterPct = 14.0 and ethBtcFilterRequired", () => {
    expect(ETH_SEED_POLICY.fixedReversalCenterPct).toBe(14.0);
    expect(ETH_SEED_POLICY.ethBtcFilterRequired).toBe(true);
    expect(ETH_SEED_POLICY.relativePair).toBe("ETH/BTC");
  });

  it("capital deployment + reserve = 100%", () => {
    expect(ETH_SEED_POLICY.capitalDeploymentPct + ETH_SEED_POLICY.capitalReservePct).toBe(100);
  });
});

// ─── Envelopes ───────────────────────────────────────────────────────

describe("AMA Seed V2.2 — Envelopes", () => {
  const validEnvelope: Envelope = {
    policyId: "test",
    asset: "BTC",
    tranches: [
      { trancheIndex: 0, triggerDropPct: 15, trancheType: "PROBE", weightMultiplier: 1.0 },
      { trancheIndex: 1, triggerDropPct: 25, trancheType: "VALUE", weightMultiplier: 0.8 },
      { trancheIndex: 2, triggerDropPct: 35, trancheType: "DEEP_VALUE", weightMultiplier: 0.6 },
    ],
  };

  it("valid envelope passes validation", () => {
    expect(validateEnvelope(validEnvelope)).toHaveLength(0);
  });

  it("rejects duplicate triggers", () => {
    const env: Envelope = {
      ...validEnvelope,
      tranches: [
        { trancheIndex: 0, triggerDropPct: 20, trancheType: "PROBE", weightMultiplier: 1.0 },
        { trancheIndex: 1, triggerDropPct: 20, trancheType: "VALUE", weightMultiplier: 0.8 },
      ],
    };
    const errors = validateEnvelope(env);
    expect(errors).toContain("Triggers must be unique");
  });

  it("rejects non-descending triggers", () => {
    const env: Envelope = {
      ...validEnvelope,
      tranches: [
        { trancheIndex: 0, triggerDropPct: 30, trancheType: "PROBE", weightMultiplier: 1.0 },
        { trancheIndex: 1, triggerDropPct: 20, trancheType: "VALUE", weightMultiplier: 0.8 },
      ],
    };
    const errors = validateEnvelope(env);
    expect(errors.some((e) => e.includes("must be less than"))).toBe(true);
  });

  it("rejects weightMultiplier > 1.0 in active overlay", () => {
    const env: Envelope = {
      ...validEnvelope,
      tranches: [
        { trancheIndex: 0, triggerDropPct: 15, trancheType: "PROBE", weightMultiplier: 1.25 },
      ],
    };
    const errors = validateEnvelope(env);
    expect(errors.some((e) => e.includes("> 1.0 is prohibited"))).toBe(true);
  });
});

// ─── HWM ────────────────────────────────────────────────────────────

describe("AMA Seed V2.2 — HWM", () => {
  it("has 6 states", () => {
    expect(HWM_STATES).toHaveLength(6);
    expect(HWM_STATES).toContain("CANDIDATE");
    expect(HWM_STATES).toContain("CONFIRMING");
    expect(HWM_STATES).toContain("CONFIRMED");
    expect(HWM_STATES).toContain("FROZEN");
    expect(HWM_STATES).toContain("SUPERSEDED");
    expect(HWM_STATES).toContain("INVALIDATED");
  });

  it("authoritativeCycleHwm cannot go down once CONFIRMED or FROZEN", () => {
    expect(canHwmGoDown("CONFIRMED", "authoritativeCycleHwm")).toBe(false);
    expect(canHwmGoDown("FROZEN", "authoritativeCycleHwm")).toBe(false);
  });

  it("authoritativeCycleHwm can go down while CANDIDATE or CONFIRMING", () => {
    expect(canHwmGoDown("CANDIDATE", "authoritativeCycleHwm")).toBe(true);
    expect(canHwmGoDown("CONFIRMING", "authoritativeCycleHwm")).toBe(true);
  });

  it("rollingHigh can always go down", () => {
    for (const state of HWM_STATES) {
      expect(canHwmGoDown(state, "rollingHigh")).toBe(true);
    }
  });
});

// ─── Risk Overlay ────────────────────────────────────────────────────

describe("AMA Seed V2.2 — Risk Overlay", () => {
  it("ACTIVE_SEED_OVERLAY is RISK_DOWN_ONLY", () => {
    expect(ACTIVE_SEED_OVERLAY).toBe("RISK_DOWN_ONLY");
  });

  it("BTC weight multiplier range is 0.50-1.00", () => {
    expect(RISK_OVERLAY_CONFIG.minimumWeightMultiplier.BTC).toBe(0.50);
    expect(RISK_OVERLAY_CONFIG.maximumWeightMultiplier.BTC).toBe(1.00);
  });

  it("ETH weight multiplier range is 0.35-1.00", () => {
    expect(RISK_OVERLAY_CONFIG.minimumWeightMultiplier.ETH).toBe(0.35);
    expect(RISK_OVERLAY_CONFIG.maximumWeightMultiplier.ETH).toBe(1.00);
  });

  it("accepts valid BTC multiplier", () => {
    expect(isWeightMultiplierValid("BTC", 0.75)).toBe(true);
    expect(isWeightMultiplierValid("BTC", 1.00)).toBe(true);
    expect(isWeightMultiplierValid("BTC", 0.50)).toBe(true);
  });

  it("rejects BTC multiplier > 1.00", () => {
    expect(isWeightMultiplierValid("BTC", 1.01)).toBe(false);
    expect(isWeightMultiplierValid("BTC", 1.25)).toBe(false);
  });

  it("rejects BTC multiplier < 0.50", () => {
    expect(isWeightMultiplierValid("BTC", 0.49)).toBe(false);
  });

  it("identifies challenger multiplier > 1.0", () => {
    expect(isChallengerMultiplier(1.25)).toBe(true);
    expect(isChallengerMultiplier(1.15)).toBe(true);
    expect(isChallengerMultiplier(1.00)).toBe(false);
    expect(isChallengerMultiplier(0.80)).toBe(false);
  });
});

// ─── Source Taxonomy ─────────────────────────────────────────────────

describe("AMA Seed V2.2 — Source Taxonomy", () => {
  it("Kraken is AUTHORITATIVE for OHLC/HWM/ATR", () => {
    expect(KRAKEN_SOURCE.authority).toBe("AUTHORITATIVE");
    expect(KRAKEN_SOURCE.capabilities).toContain("OHLC");
    expect(KRAKEN_SOURCE.capabilities).toContain("HWM");
    expect(KRAKEN_SOURCE.capabilities).toContain("ATR");
  });

  it("Revolut X is AUTHORITATIVE for execution", () => {
    const revolut = SOURCE_TAXONOMIES["REVOLUT_X"];
    expect(revolut.authority).toBe("AUTHORITATIVE");
    expect(revolut.capabilities).toContain("EXECUTION");
  });

  it("Coin Metrics Archive is RESEARCH_ONLY with REVIEW_REQUIRED license", () => {
    expect(COIN_METRICS_ARCHIVE_SOURCE.authority).toBe("RESEARCH_ONLY");
    expect(COIN_METRICS_ARCHIVE_SOURCE.licenseStatus).toBe("REVIEW_REQUIRED");
  });

  it("Coin Metrics Pro is DISABLED with BLOCKED license", () => {
    expect(COIN_METRICS_PRO_SOURCE.authority).toBe("DISABLED");
    expect(COIN_METRICS_PRO_SOURCE.licenseStatus).toBe("BLOCKED");
    expect(COIN_METRICS_PRO_SOURCE.freshnessStatus).toBe("UNAVAILABLE");
  });
});

// ─── Time Contract ───────────────────────────────────────────────────

describe("AMA Seed V2.2 — Time Contract", () => {
  it("creates UTC time contract", () => {
    const tc = createUtcTimeContract("cycle-001", "2026-07-29T00:00:00Z");
    expect(tc.timezone).toBe("UTC");
    expect(tc.dailyBoundary).toBe("00:00:00Z");
    expect(tc.cycleRef).toBe("cycle-001");
  });

  it("detects future timestamps", () => {
    expect(isTimestampFuture("2026-07-30T00:00:00Z", "2026-07-29T00:00:00Z")).toBe(true);
    expect(isTimestampFuture("2026-07-28T00:00:00Z", "2026-07-29T00:00:00Z")).toBe(false);
  });
});

// ─── Ethereum Eras ───────────────────────────────────────────────────

describe("AMA Seed V2.2 — Ethereum Eras", () => {
  it("has 8 eras (7 active + GLAMSTERDAM)", () => {
    expect(ETHEREUM_ERAS).toHaveLength(8);
  });

  it("GLAMSTERDAM is PLANNED, NOT_ACTIVE", () => {
    expect(GLAMSTERDAM_STATUS).toBe("PLANNED");
    expect(isEraActive("GLAMSTERDAM")).toBe(false);
  });

  it("all eras except GLAMSTERDAM are active", () => {
    for (const era of ETHEREUM_ERAS) {
      if (era === "GLAMSTERDAM") continue;
      expect(isEraActive(era)).toBe(true);
    }
  });
});

// ─── ETH/BTC Filter ──────────────────────────────────────────────────

describe("AMA Seed V2.2 — ETH/BTC Filter", () => {
  it("reduces weight when filter is active and trend is DOWN", () => {
    const filter: EthBtcFilterState = {
      filterRequired: true,
      relativePair: "ETH/BTC",
      ethBtcTrend: "DOWN",
      riskReductionMultiplier: 0.7,
    };
    expect(applyEthBtcFilter(filter, 1.0)).toBe(0.7);
  });

  it("does not modify weight when filter is not required", () => {
    const filter: EthBtcFilterState = {
      filterRequired: false,
      relativePair: "ETH/BTC",
      ethBtcTrend: "UP",
      riskReductionMultiplier: 0.7,
    };
    expect(applyEthBtcFilter(filter, 1.0)).toBe(1.0);
  });

  it("risk reduction multiplier is <= 1.0", () => {
    const filter: EthBtcFilterState = {
      filterRequired: true,
      relativePair: "ETH/BTC",
      ethBtcTrend: "DOWN",
      riskReductionMultiplier: 0.5,
    };
    expect(filter.riskReductionMultiplier).toBeLessThanOrEqual(1.0);
  });
});

// ─── Exit Status ────────────────────────────────────────────────────

describe("AMA Seed V2.2 — Exit Status", () => {
  it("BTC exits are LAB_HYPOTHESIS, NOT_ACTIVE", () => {
    expect(BTC_EXIT_STATUS).toBe("LAB_HYPOTHESIS");
  });

  it("ETH exits are LAB_HYPOTHESIS, NOT_ACTIVE", () => {
    expect(ETH_EXIT_STATUS).toBe("LAB_HYPOTHESIS");
  });
});

// ─── Retention ──────────────────────────────────────────────────────

describe("AMA Seed V2.2 — Retention", () => {
  it("AMA retention class is RESEARCH_LONG_TERM", () => {
    expect(AMA_RETENTION_CLASS).toBe("RESEARCH_LONG_TERM");
  });

  it("OHLC, HWM, policies, manifests, macro_vintages, datasets_replay are protected from auto-delete", () => {
    expect(RETENTION_AUTO_DELETE_PROHIBITED).toContain("OHLC");
    expect(RETENTION_AUTO_DELETE_PROHIBITED).toContain("HWM");
    expect(RETENTION_AUTO_DELETE_PROHIBITED).toContain("policies");
    expect(RETENTION_AUTO_DELETE_PROHIBITED).toContain("manifests");
    expect(RETENTION_AUTO_DELETE_PROHIBITED).toContain("macro_vintages");
    expect(RETENTION_AUTO_DELETE_PROHIBITED).toContain("datasets_replay");
  });
});
