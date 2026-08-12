import { describe, it, expect } from "vitest";
import {
  LEGACY_DRY_RUN_TAG,
  LEGACY_DEPRECATION_HEADER,
  LEGACY_DEPRECATION_MESSAGE,
  DEAD_STRATEGIES,
  DEPRECATED_MODULES,
  LEGACY_ENDPOINTS,
  isDeadStrategy,
  isLegacyEndpoint,
  applyLegacyHeaders,
  legacyDeprecationMiddleware,
} from "../spot/legacyIsolation";

describe("LegacyIsolation", () => {
  // ─── Constants ──────────────────────────────────────────────────────────────

  it("LEGACY_DRY_RUN_TAG is a non-empty string", () => {
    expect(LEGACY_DRY_RUN_TAG).toBe("LEGACY_DRY_RUN");
    expect(LEGACY_DRY_RUN_TAG.length).toBeGreaterThan(0);
  });

  it("LEGACY_DEPRECATION_HEADER is X-Legacy-Warning", () => {
    expect(LEGACY_DEPRECATION_HEADER).toBe("X-Legacy-Warning");
  });

  it("LEGACY_DEPRECATION_MESSAGE mentions /api/spot/*", () => {
    expect(LEGACY_DEPRECATION_MESSAGE).toContain("/api/spot/*");
  });

  // ─── Dead strategies ───────────────────────────────────────────────────────

  it("DEAD_STRATEGIES contains exactly 4 strategies", () => {
    expect(DEAD_STRATEGIES).toHaveLength(4);
  });

  it("DEAD_STRATEGIES includes momentumStrategy, meanReversionStrategy, scalpingStrategy, gridStrategy", () => {
    expect(DEAD_STRATEGIES).toContain("momentumStrategy");
    expect(DEAD_STRATEGIES).toContain("meanReversionStrategy");
    expect(DEAD_STRATEGIES).toContain("scalpingStrategy");
    expect(DEAD_STRATEGIES).toContain("gridStrategy");
  });

  it("isDeadStrategy returns true for dead strategies", () => {
    expect(isDeadStrategy("momentumStrategy")).toBe(true);
    expect(isDeadStrategy("scalpingStrategy")).toBe(true);
  });

  it("isDeadStrategy returns false for active strategies", () => {
    expect(isDeadStrategy("momentumCandlesStrategy")).toBe(false);
    expect(isDeadStrategy("meanReversionSimpleStrategy")).toBe(false);
    expect(isDeadStrategy("SPOT_CANONICAL")).toBe(false);
  });

  // ─── Deprecated modules ────────────────────────────────────────────────────

  it("DEPRECATED_MODULES includes signalAccumulator, SmartExitEngine, SmartTimeStopV2", () => {
    expect(DEPRECATED_MODULES).toContain("server/services/signalAccumulator.ts");
    expect(DEPRECATED_MODULES).toContain("server/services/SmartExitEngine.ts");
    expect(DEPRECATED_MODULES).toContain("server/services/SmartTimeStopV2.ts");
  });

  it("DEPRECATED_MODULES does NOT include SPOT canonical modules", () => {
    expect(DEPRECATED_MODULES).not.toContain("server/services/spot/spotTypes.ts");
    expect(DEPRECATED_MODULES).not.toContain("server/services/spot/spotCanonicalStrategy.ts");
    expect(DEPRECATED_MODULES).not.toContain("server/services/spot/spotExitPolicy.ts");
  });

  // ─── Legacy endpoints ──────────────────────────────────────────────────────

  it("LEGACY_ENDPOINTS contains exactly 7 endpoints", () => {
    expect(LEGACY_ENDPOINTS).toHaveLength(7);
  });

  it("LEGACY_ENDPOINTS includes all /api/dryrun/* paths", () => {
    expect(LEGACY_ENDPOINTS).toContain("/api/dryrun/positions");
    expect(LEGACY_ENDPOINTS).toContain("/api/dryrun/history");
    expect(LEGACY_ENDPOINTS).toContain("/api/dryrun/summary");
    expect(LEGACY_ENDPOINTS).toContain("/api/dryrun/clear");
    expect(LEGACY_ENDPOINTS).toContain("/api/dryrun/backfill");
    expect(LEGACY_ENDPOINTS).toContain("/api/dryrun/exit-audit");
    expect(LEGACY_ENDPOINTS).toContain("/api/dryrun/timestop-audit");
  });

  it("LEGACY_ENDPOINTS does NOT include /api/spot/* paths", () => {
    expect(LEGACY_ENDPOINTS).not.toContain("/api/spot/status");
    expect(LEGACY_ENDPOINTS).not.toContain("/api/spot/positions");
  });

  it("isLegacyEndpoint returns true for dryrun endpoints", () => {
    expect(isLegacyEndpoint("/api/dryrun/positions")).toBe(true);
    expect(isLegacyEndpoint("/api/dryrun/summary")).toBe(true);
  });

  it("isLegacyEndpoint returns false for SPOT endpoints", () => {
    expect(isLegacyEndpoint("/api/spot/status")).toBe(false);
    expect(isLegacyEndpoint("/api/spot/positions")).toBe(false);
    expect(isLegacyEndpoint("/api/dashboard")).toBe(false);
  });

  // ─── applyLegacyHeaders ────────────────────────────────────────────────────

  it("applyLegacyHeaders sets X-Legacy-Warning and X-Deprecation-Tag on response", () => {
    const headers: Record<string, string> = {};
    const fakeRes = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    };
    applyLegacyHeaders(fakeRes);
    expect(headers[LEGACY_DEPRECATION_HEADER]).toBe(LEGACY_DEPRECATION_MESSAGE);
    expect(headers["X-Deprecation-Tag"]).toBe(LEGACY_DRY_RUN_TAG);
  });

  // ─── legacyDeprecationMiddleware ───────────────────────────────────────────

  it("legacyDeprecationMiddleware calls next() (does not block)", () => {
    let nextCalled = false;
    const middleware = legacyDeprecationMiddleware();
    middleware({ method: "GET", path: "/api/dryrun/positions" }, {}, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it("legacyDeprecationMiddleware does not throw on non-dryrun paths", () => {
    const middleware = legacyDeprecationMiddleware();
    expect(() => {
      middleware({ method: "GET", path: "/api/spot/status" }, {}, () => {});
    }).not.toThrow();
  });

  // ─── Isolation invariants ──────────────────────────────────────────────────

  it("SPOT canonical modules are NOT in DEPRECATED_MODULES", () => {
    const spotModules = [
      "server/services/spot/spotTypes.ts",
      "server/services/spot/spotCanonicalStrategy.ts",
      "server/services/spot/spotExitPolicy.ts",
      "server/services/spot/spotExecutionAdapter.ts",
      "server/services/spot/spotRiskManager.ts",
      "server/services/spot/spotEntryIntent.ts",
      "server/services/spot/spotRegimeEngine.ts",
      "server/services/spot/spotMarketContext.ts",
      "server/services/spot/spotAuditTracker.ts",
      "server/services/spot/feeModel.ts",
      "server/services/spot/candleTimestamp.ts",
    ];
    for (const mod of spotModules) {
      expect(DEPRECATED_MODULES).not.toContain(mod);
    }
  });

  it("DEAD_STRATEGIES does not include active strategies", () => {
    expect(DEAD_STRATEGIES).not.toContain("momentumCandlesStrategy");
    expect(DEAD_STRATEGIES).not.toContain("meanReversionSimpleStrategy");
  });
});
