import React from "react";
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { DataHealthMini } from "../IdcaMarketContextCard";
import {
  formatEntryDataAgeMs,
  formatEntryDataOrigin,
  formatEntryDataStatus,
} from "../idcaMarketContextHelpers";
import type { MarketDataHealthResult } from "@/hooks/useInstitutionalDca";

const baseHealth: MarketDataHealthResult = {
  pair: "BTC/USD",
  timeframe: "1h",
  source: "kraken",
  candleCount: 100,
  requiredCandles: 72,
  sufficientCandles: 24,
  minimumCandles: 7,
  missingCandles: 0,
  lastCandleTimestamp: 1,
  lastCandleAgeMinutes: 30,
  timeframeMinutes: 60,
  estimatedReadyAt: null,
  hasGaps: false,
  gapCount: 0,
  backfillStatus: "no_necesario",
  dataReadinessState: "ready",
  quality: "good_context",
  usableForEntry: true,
  usableForContext: true,
  usableForMacro: false,
  isFallback: false,
  canUseDynamicAnchor: true,
  canOpenNewIdcaCycle: true,
  allowsActiveCycleManagement: true,
  blocksNewMain: false,
  reason: "ok",
  checkedAt: "2026-01-02T00:00:00Z",
};

describe("salud de datos IDCA en UI", () => {
  it("helpers muestran edad, origen y estado en castellano sin inventar ausencias", () => {
    expect(formatEntryDataAgeMs(30 * 60_000)).toBe("30 min");
    expect(formatEntryDataAgeMs(null)).toBe("sin dato");
    expect(formatEntryDataOrigin("live")).toBe("en vivo");
    expect(formatEntryDataOrigin("cache+db_fallback")).toBe("caché + respaldo de BD");
    expect(formatEntryDataStatus({ warmup: true })).toBe("warm-up insuficiente");
    expect(formatEntryDataStatus({ status: "partial" })).toBe("parcial");
    expect(formatEntryDataStatus(undefined)).toBe("sin dato");
  });

  it("DTO conserva campos antiguos y renderiza los nuevos", () => {
    const health: MarketDataHealthResult = {
      ...baseHealth,
      entryDataHealth: {
        validity: "valid",
        ageMs: 30 * 60_000,
        maxAgeMs: 2 * 60 * 60_000,
        missing: [],
        origin: "live",
        source: "kraken",
        status: "ok",
        warmup: false,
        components: { ema20: { available: true } },
      },
    };
    for (const key of [
      "pair", "timeframe", "source", "candleCount", "requiredCandles",
      "lastCandleAgeMinutes", "dataReadinessState", "quality", "reason", "checkedAt",
    ]) {
      expect(health).toHaveProperty(key);
    }
    const html = renderToString(<DataHealthMini health={health} />);
    expect(html).toContain("30 min");
    expect(html).toContain("en vivo");
    expect(html).toContain("datos completos");
  });

  it("sin entryDataHealth muestra sin dato y no rellena artificialmente", () => {
    const html = renderToString(<DataHealthMini health={baseHealth} />);
    expect(html).toContain("sin dato");
  });
});
