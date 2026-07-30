/**
 * AMA Fase 2D-2L — Tests consolidados
 */

import { describe, it, expect } from "vitest";

// 2D — Coin Metrics
import {
  COIN_METRICS_TIERS,
  isCoinMetricsProEnabled,
  canCoinMetricsImpactDecisions,
  computeSnapshotHash,
  createSnapshot,
  isFreshnessAcceptable,
  isFreshnessBlocked,
  canOverwriteSnapshot,
  isScrapingHtmlAllowed,
} from "../amaCoinMetrics";

// 2E — Bitcoin Core
import {
  getSubsidyEra,
  getBlockSubsidy,
  validateBitcoinCoreData,
  isBlockHeightValid,
  type BitcoinCoreData,
} from "../amaBitcoinCore";

// 2F — Ethereum Eras
import {
  shouldCalculateTotalStaked,
  computeTotalStakedEth,
  isEthResearchOnly,
  canEthPromoteToReal,
  doesEthInheritBtcPromotion,
} from "../amaEthereumEras";

// 2G — Macro
import {
  FRED_SERIES,
  isLookAhead,
  filterPointInTime,
  detectRevisions,
  type FredVintagePoint,
} from "../amaMacroSource";

// 2H — ETF
import {
  validateEtfHolding,
  isFilingDateValid,
  type EtfHolding,
} from "../amaEtfSource";

// 2I — Derivatives
import {
  getMarketStructure,
  computeBasisPct,
  validateDerivativesData,
  type DerivativesData,
} from "../amaDerivativesSource";

// 2J — L2/DeFi
import {
  validateL2Data,
  validateDefiData,
  type L2SettlementData,
  type DefiTvlData,
} from "../amaL2Source";

// 2K — Dataset Manifest
import {
  validateManifest,
  computeSchemaHash,
  isManifestCoherent,
  type DatasetManifest,
} from "../amaDatasetManifest";

// 2L — Replay Readiness
import {
  checkReplayReadiness,
  verifyNoFutureData,
} from "../amaReplayReadiness";

// ─── 2D Coin Metrics ─────────────────────────────────────────────────

describe("AMA 2D — Coin Metrics", () => {
  it("GitHub Archive is enabled, research-only, no decision impact", () => {
    expect(COIN_METRICS_TIERS.COINMETRICS_GITHUB_ARCHIVE.enabled).toBe(true);
    expect(COIN_METRICS_TIERS.COINMETRICS_GITHUB_ARCHIVE.decisionImpactAllowed).toBe(false);
  });

  it("Community API is disabled by default", () => {
    expect(COIN_METRICS_TIERS.COINMETRICS_COMMUNITY_API.enabled).toBe(false);
  });

  it("Pro API is DISABLED", () => {
    expect(isCoinMetricsProEnabled()).toBe(false);
    expect(COIN_METRICS_TIERS.COINMETRICS_PRO_API.licenseStatus).toBe("BLOCKED");
  });

  it("cannot impact decisions for any tier", () => {
    expect(canCoinMetricsImpactDecisions("COINMETRICS_GITHUB_ARCHIVE")).toBe(false);
    expect(canCoinMetricsImpactDecisions("COINMETRICS_COMMUNITY_API")).toBe(false);
    expect(canCoinMetricsImpactDecisions("COINMETRICS_PRO_API")).toBe(false);
  });

  it("creates snapshot with correct fields", () => {
    const snap = createSnapshot(
      "price_usd", "btc", "2026-07-29T00:00:00Z", 50000,
      "rev123", "v1", "2026-07-29T00:00:00Z", "2026-07-29T00:00:00Z", "FRESH",
    );
    expect(snap.decisionImpactAllowed).toBe(false);
    expect(snap.commercialUseStatus).toBe("REVIEW_REQUIRED");
    expect(snap.freshnessStatus).toBe("FRESH");
  });

  it("FRESH and DELAYED are acceptable; UNAVAILABLE and BLOCKED are not", () => {
    expect(isFreshnessAcceptable("FRESH")).toBe(true);
    expect(isFreshnessAcceptable("DELAYED")).toBe(true);
    expect(isFreshnessBlocked("UNAVAILABLE")).toBe(true);
    expect(isFreshnessBlocked("LICENSE_BLOCKED")).toBe(true);
    expect(isFreshnessBlocked("SCHEMA_DRIFT")).toBe(true);
  });

  it("cannot overwrite snapshot with same revision hash", () => {
    const existing = createSnapshot("p", "btc", "t1", 100, "hash1", "v1", "t1", "t1", "FRESH");
    const incoming = createSnapshot("p", "btc", "t1", 100, "hash1", "v1", "t1", "t1", "FRESH");
    expect(canOverwriteSnapshot(existing, incoming)).toBe(false);
  });

  it("can append snapshot with different revision hash", () => {
    const existing = createSnapshot("p", "btc", "t1", 100, "hash1", "v1", "t1", "t1", "FRESH");
    const incoming = createSnapshot("p", "btc", "t1", 100, "hash2", "v2", "t1", "t1", "FRESH");
    expect(canOverwriteSnapshot(existing, incoming)).toBe(true);
  });

  it("HTML scraping is never allowed", () => {
    expect(isScrapingHtmlAllowed()).toBe(false);
  });
});

// ─── 2E Bitcoin Core ────────────────────────────────────────────────

describe("AMA 2E — Bitcoin Core", () => {
  it("computes subsidy era correctly", () => {
    expect(getSubsidyEra(0)).toBe(0);
    expect(getSubsidyEra(209999)).toBe(0);
    expect(getSubsidyEra(210000)).toBe(1);
    expect(getSubsidyEra(420000)).toBe(2);
  });

  it("block subsidy is 50 BTC in era 0", () => {
    expect(getBlockSubsidy(0)).toBe(5000000000); // 50 BTC in satoshis
  });

  it("block subsidy halves each era", () => {
    expect(getBlockSubsidy(210000)).toBe(2500000000); // 25 BTC
    expect(getBlockSubsidy(420000)).toBe(1250000000); // 12.5 BTC
  });

  it("validates Bitcoin Core data", () => {
    const data: BitcoinCoreData = {
      blockHeight: 850000,
      difficulty: 1e12,
      hashrate: 600,
      subsidyEra: 4,
      timestamp: "2026-07-29T00:00:00Z",
    };
    expect(validateBitcoinCoreData(data)).toHaveLength(0);
  });

  it("rejects negative block height", () => {
    const data: BitcoinCoreData = {
      blockHeight: -1, difficulty: 1e12, hashrate: 600, subsidyEra: 0,
      timestamp: "2026-07-29T00:00:00Z",
    };
    expect(validateBitcoinCoreData(data)).toContain("NEGATIVE_BLOCK_HEIGHT");
  });

  it("isBlockHeightValid accepts reasonable heights", () => {
    expect(isBlockHeightValid(850000)).toBe(true);
    expect(isBlockHeightValid(0)).toBe(false);
    expect(isBlockHeightValid(99999999)).toBe(false);
  });
});

// ─── 2F Ethereum ────────────────────────────────────────────────────

describe("AMA 2F — Ethereum Eras", () => {
  it("should NOT calculate totalStakedEth post-Pectra", () => {
    expect(shouldCalculateTotalStaked("PECTRA")).toBe(false);
    expect(shouldCalculateTotalStaked("POST_FUSAKA")).toBe(false);
    expect(shouldCalculateTotalStaked("GLAMSTERDAM")).toBe(false);
  });

  it("should calculate totalStakedEth pre-Pectra", () => {
    expect(shouldCalculateTotalStaked("MERGE")).toBe(true);
    expect(shouldCalculateTotalStaked("SHANGHAI")).toBe(true);
    expect(shouldCalculateTotalStaked("CANCUN")).toBe(true);
  });

  it("computeTotalStakedEth returns null post-Pectra", () => {
    expect(computeTotalStakedEth(1000000, "PECTRA")).toBeNull();
    expect(computeTotalStakedEth(1000000, "POST_FUSAKA")).toBeNull();
  });

  it("computeTotalStakedEth returns validatorCount × 32 pre-Pectra", () => {
    expect(computeTotalStakedEth(1000000, "MERGE")).toBe(32000000);
  });

  it("ETH is always RESEARCH_ONLY", () => {
    expect(isEthResearchOnly()).toBe(true);
  });

  it("ETH cannot promote to REAL", () => {
    expect(canEthPromoteToReal()).toBe(false);
  });

  it("ETH does not inherit BTC promotion", () => {
    expect(doesEthInheritBtcPromotion()).toBe(false);
  });
});

// ─── 2G Macro ──────────────────────────────────────────────────────

describe("AMA 2G — Macro (FRED)", () => {
  it("has 5 FRED series", () => {
    expect(Object.keys(FRED_SERIES)).toHaveLength(5);
    expect(FRED_SERIES.DGS10.seriesId).toBe("DGS10");
    expect(FRED_SERIES.DFF.seriesId).toBe("DFF");
  });

  it("detects look-ahead in vintage dates", () => {
    expect(isLookAhead("2026-07-30T00:00:00Z", "2026-07-29T00:00:00Z")).toBe(true);
    expect(isLookAhead("2026-07-28T00:00:00Z", "2026-07-29T00:00:00Z")).toBe(false);
  });

  it("filters point-in-time vintages", () => {
    const vintages: FredVintagePoint[] = [
      { date: "2026-07-28", value: 4.5, vintageDate: "2026-07-28T00:00:00Z", revisionNumber: 0 },
      { date: "2026-07-28", value: 4.6, vintageDate: "2026-07-30T00:00:00Z", revisionNumber: 1 },
    ];
    const filtered = filterPointInTime(vintages, "2026-07-29T00:00:00Z");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].value).toBe(4.5);
  });

  it("detects revisions", () => {
    const vintages: FredVintagePoint[] = [
      { date: "2026-07-28", value: 4.5, vintageDate: "2026-07-28T00:00:00Z", revisionNumber: 0 },
      { date: "2026-07-28", value: 4.6, vintageDate: "2026-07-30T00:00:00Z", revisionNumber: 1 },
      { date: "2026-07-29", value: 4.7, vintageDate: "2026-07-29T00:00:00Z", revisionNumber: 0 },
    ];
    const revisions = detectRevisions(vintages);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].date).toBe("2026-07-28");
    expect(revisions[0].revisionCount).toBe(2);
  });
});

// ─── 2H ETF ────────────────────────────────────────────────────────

describe("AMA 2H — ETF (SEC)", () => {
  it("validates correct holding", () => {
    const holding: EtfHolding = {
      ticker: "IBIT", filingDate: "2026-07-28", reportDate: "2026-07-27",
      btcHoldings: 500000, aumUsd: 30e9, filingType: "N-PORT",
    };
    expect(validateEtfHolding(holding)).toHaveLength(0);
  });

  it("rejects negative holdings", () => {
    const holding: EtfHolding = {
      ticker: "IBIT", filingDate: "2026-07-28", reportDate: "2026-07-27",
      btcHoldings: -100, aumUsd: 30e9, filingType: "N-PORT",
    };
    expect(validateEtfHolding(holding)).toContain("NEGATIVE_BTC_HOLDINGS");
  });

  it("rejects filing date before report date", () => {
    const holding: EtfHolding = {
      ticker: "IBIT", filingDate: "2026-07-27", reportDate: "2026-07-28",
      btcHoldings: 500, aumUsd: 30e9, filingType: "N-PORT",
    };
    expect(validateEtfHolding(holding)).toContain("FILING_DATE_BEFORE_REPORT_DATE");
  });

  it("isFilingDateValid checks against asOf", () => {
    expect(isFilingDateValid("2026-07-28", "2026-07-29")).toBe(true);
    expect(isFilingDateValid("2026-07-30", "2026-07-29")).toBe(false);
  });
});

// ─── 2I Derivatives ────────────────────────────────────────────────

describe("AMA 2I — Derivatives (CME)", () => {
  const data: DerivativesData = {
    venue: "CME", openInterestUsd: 5e9, basisPct: 2.5, fundingRatePct: 0.01,
    futuresPrice: 51000, spotPrice: 50000, timestamp: "2026-07-29T00:00:00Z",
  };

  it("detects contango when futures > spot", () => {
    expect(getMarketStructure(data)).toBe("CONTANGO");
  });

  it("detects backwardation when futures < spot", () => {
    const backwardation: DerivativesData = { ...data, futuresPrice: 49000, spotPrice: 50000 };
    expect(getMarketStructure(backwardation)).toBe("BACKWARDATION");
  });

  it("detects flat when futures ≈ spot", () => {
    const flat: DerivativesData = { ...data, futuresPrice: 50000, spotPrice: 50000 };
    expect(getMarketStructure(flat)).toBe("FLAT");
  });

  it("computes basis percentage", () => {
    expect(computeBasisPct(51000, 50000)).toBe(2);
    expect(computeBasisPct(49000, 50000)).toBe(-2);
  });

  it("validates derivatives data", () => {
    expect(validateDerivativesData(data)).toHaveLength(0);
    expect(validateDerivativesData({ ...data, openInterestUsd: -1 })).toContain("NEGATIVE_OPEN_INTEREST");
  });
});

// ─── 2J L2/DeFi ───────────────────────────────────────────────────

describe("AMA 2J — L2 and DeFi", () => {
  it("validates L2 data", () => {
    const data: L2SettlementData = {
      network: "ARBITRUM", batchFrequencySeconds: 0.25, settlementVolumeUsd: 1e9,
      timestamp: "2026-07-29T00:00:00Z",
    };
    expect(validateL2Data(data)).toHaveLength(0);
  });

  it("rejects invalid batch frequency", () => {
    const data: L2SettlementData = {
      network: "ARBITRUM", batchFrequencySeconds: 0, settlementVolumeUsd: 1e9,
      timestamp: "2026-07-29T00:00:00Z",
    };
    expect(validateL2Data(data)).toContain("INVALID_BATCH_FREQUENCY");
  });

  it("validates DeFi data", () => {
    const data: DefiTvlData = {
      protocol: "UNISWAP", chain: "ETHEREUM", tvlUsd: 5e9, protocolRevenueUsd: 1e8,
      timestamp: "2026-07-29T00:00:00Z",
    };
    expect(validateDefiData(data)).toHaveLength(0);
  });

  it("rejects negative TVL", () => {
    const data: DefiTvlData = {
      protocol: "UNISWAP", chain: "ETHEREUM", tvlUsd: -1, protocolRevenueUsd: 1e8,
      timestamp: "2026-07-29T00:00:00Z",
    };
    expect(validateDefiData(data)).toContain("NEGATIVE_TVL");
  });
});

// ─── 2K Dataset Manifest ──────────────────────────────────────────

describe("AMA 2K — Dataset Manifest", () => {
  const validManifest: DatasetManifest = {
    datasetId: "btc_ohlc_daily",
    schemaHash: "schema_12345",
    rowCount: 1000,
    timeRangeStart: "2024-01-01T00:00:00Z",
    timeRangeEnd: "2026-07-29T00:00:00Z",
    createdAt: "2026-07-29T00:00:00Z",
  };

  it("validates correct manifest", () => {
    expect(validateManifest(validManifest)).toHaveLength(0);
  });

  it("rejects zero row count", () => {
    expect(validateManifest({ ...validManifest, rowCount: 0 })).toContain("ZERO_ROW_COUNT");
  });

  it("rejects time range start after end", () => {
    expect(validateManifest({
      ...validManifest,
      timeRangeStart: "2026-07-30T00:00:00Z",
      timeRangeEnd: "2026-07-29T00:00:00Z",
    })).toContain("TIME_RANGE_START_AFTER_END");
  });

  it("computes schema hash (SHA-256)", () => {
    const hash = computeSchemaHash("open,high,low,close,volume");
    expect(hash).toMatch(/^schema_[a-f0-9]{16}$/);
  });

  it("checks manifest coherence", () => {
    expect(isManifestCoherent(validManifest, 1000, "schema_12345")).toBe(true);
    expect(isManifestCoherent(validManifest, 999, "schema_12345")).toBe(false);
  });
});

// ─── 2L Replay Readiness ──────────────────────────────────────────

describe("AMA 2L — Replay Readiness", () => {
  it("returns ready when no look-ahead and valid manifests", () => {
    const result = checkReplayReadiness(
      ["2026-07-28T00:00:00Z", "2026-07-29T00:00:00Z"],
      "2026-07-29T12:00:00Z",
      [{
        datasetId: "test",
        schemaHash: "schema_1",
        rowCount: 100,
        timeRangeStart: "2026-07-28T00:00:00Z",
        timeRangeEnd: "2026-07-29T00:00:00Z",
        createdAt: "2026-07-29T00:00:00Z",
      }],
    );
    expect(result.ready).toBe(true);
    expect(result.zeroLookAhead).toBe(true);
    expect(result.manifestsValid).toBe(true);
  });

  it("returns not ready when look-ahead exists", () => {
    const result = checkReplayReadiness(
      ["2026-07-28T00:00:00Z", "2026-07-30T00:00:00Z"],
      "2026-07-29T12:00:00Z",
      [],
    );
    expect(result.ready).toBe(false);
    expect(result.zeroLookAhead).toBe(false);
  });

  it("returns not ready when manifest is invalid", () => {
    const result = checkReplayReadiness(
      ["2026-07-28T00:00:00Z"],
      "2026-07-29T12:00:00Z",
      [{
        datasetId: "test",
        schemaHash: "schema_1",
        rowCount: 0, // invalid
        timeRangeStart: "2026-07-28T00:00:00Z",
        timeRangeEnd: "2026-07-29T00:00:00Z",
        createdAt: "2026-07-29T00:00:00Z",
      }],
    );
    expect(result.ready).toBe(false);
    expect(result.manifestsValid).toBe(false);
  });

  it("verifyNoFutureData returns true for clean data", () => {
    expect(verifyNoFutureData(
      [{ timestamp: "2026-07-28T00:00:00Z" }, { timestamp: "2026-07-29T00:00:00Z" }],
      "2026-07-29T12:00:00Z",
    )).toBe(true);
  });

  it("verifyNoFutureData returns false for future data", () => {
    expect(verifyNoFutureData(
      [{ timestamp: "2026-07-30T00:00:00Z" }],
      "2026-07-29T12:00:00Z",
    )).toBe(false);
  });
});
