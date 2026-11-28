import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BITSTAMP_REQUEST_COOLDOWN_MS,
  BitstampCandleProvider,
  compareWithPrimary,
  evaluateSecondaryFallback,
  type SecondaryDivergence,
} from "../BitstampCandleProvider";
import type { CandleSeries } from "../../marketDataContract";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "AUDITORIAS/NEXA_INTEGRAL_2026-11-27/data_public/secondary/bitstamp_BTC_1h.json",
);

function fixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
}

function apiPayload(rows: any[]) {
  return {
    data: {
      pair: "BTC/USD",
      ohlc: rows.map(row => ({
        timestamp: String(Math.floor(row.time / 1000)),
        open: String(row.open),
        high: String(row.high),
        low: String(row.low),
        close: String(row.close),
        volume: String(row.volume),
      })),
    },
  };
}

function response(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

function harness(rows = fixture().candles) {
  const data = fixture();
  const rowsToUse = rows === data.candles ? data.candles : rows;
  const lastTime = rowsToUse.at(-1)?.time ?? data.candles.at(-1).time;
  let now = lastTime + 3_600_000;
  const fetchImpl = vi.fn(async () => response(apiPayload(rowsToUse)));
  const provider = new BitstampCandleProvider({
    enabled: true,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    nowMs: () => now,
  });
  return { provider, fetchImpl, setNow: (value: number) => { now = value; }, getNow: () => now, rowsToUse };
}

describe("BitstampCandleProvider offline", () => {
  it("está desactivado por defecto y hace 0 peticiones", async () => {
    const fetchImpl = vi.fn();
    const provider = new BitstampCandleProvider({ fetchImpl: fetchImpl as any });
    await expect(provider.getCandleSeries("BTC/USD", "1h", 5)).rejects.toThrow("SECONDARY_SOURCE_DISABLED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parsea timestamps Bitstamp en segundos string y valida contrato bitstamp/USD/live", async () => {
    const h = harness();
    const series = await h.provider.getCandleSeries("BTC/USD", "1h", 10);
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((h.fetchImpl.mock.calls[0] as any[])[0])).toContain("https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=3600");
    expect(String((h.fetchImpl.mock.calls[0] as any[])[0])).toContain("exclude_current_candle=true");
    expect(series.source).toBe("bitstamp");
    expect(series.venue).toBe("bitstamp");
    expect(series.quote).toBe("USD");
    expect(series.origin).toBe("live");
    expect(series.candles.length).toBe(h.rowsToUse.length);
    expect(series.candles[0].openTime).toBe(h.rowsToUse[0].time);
    expect(series.candles[0].providerTs).toBe(h.rowsToUse[0].time);
    expect(series.quality.validity).toBe("valid");
    expect(series.gaps).toBe(0);
  });

  it("HTTP 429 produce error explícito sin cachear", async () => {
    let now = 1_800_000_000_000;
    const fetchImpl = vi.fn(async () => response({}, 429));
    const provider = new BitstampCandleProvider({ enabled: true, fetchImpl: fetchImpl as any, nowMs: () => now });
    await expect(provider.getCandleSeries("BTC/USD", "1h", 5)).rejects.toThrow("BITSTAMP_HTTP_429");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("JSON inválido produce error explícito", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new Error("bad json"); },
    }));
    const provider = new BitstampCandleProvider({ enabled: true, fetchImpl: fetchImpl as any, nowMs: () => 1_800_000_000_000 });
    await expect(provider.getCandleSeries("BTC/USD", "1h", 5)).rejects.toThrow("BITSTAMP_JSON_INVALID");
  });

  it("OHLC inválido queda contado por el validador y marca calidad inválida", async () => {
    const rows = fixture().candles.slice(0, 8).map((row: any) => ({ ...row }));
    rows[0].high = rows[0].low - 1;
    const h = harness(rows);
    const series = await h.provider.getCandleSeries("BTC/USD", "1h", 8);
    expect(series.duplicates).toBeGreaterThan(0);
    expect(series.quality.validity).toBe("invalid");
    expect(series.quality.missing).toContain("duplicates_or_invalid");
  });

  it("huecos se contabilizan sin rellenar velas", async () => {
    const rows = fixture().candles.slice(0, 8).filter((_: any, index: number) => index !== 3);
    const h = harness(rows);
    const series = await h.provider.getCandleSeries("BTC/USD", "1h", 8);
    expect(series.gaps).toBeGreaterThan(0);
    expect(series.quality.missing).toContain("gaps");
  });

  it("single-flight comparte una petición y cooldown de 5 minutos evita refetch", async () => {
    const h = harness();
    const [a, b] = await Promise.all([
      h.provider.getCandleSeries("BTC/USD", "1h", 10),
      h.provider.getCandleSeries("BTC/USD", "1h", 10),
    ]);
    expect(a).toBe(b);
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);

    h.setNow(h.getNow() + BITSTAMP_REQUEST_COOLDOWN_MS - 1);
    await h.provider.getCandleSeries("BTC/USD", "1h", 10);
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);

    h.setNow(h.getNow() + 2);
    await h.provider.getCandleSeries("BTC/USD", "1h", 10);
    expect(h.fetchImpl).toHaveBeenCalledTimes(2);
  });
});

function seriesWithCloses(closes: number[], start = 1_800_000_000_000): CandleSeries {
  return {
    contractVersion: "test",
    pair: "BTC/USD",
    base: "BTC",
    quote: "USD",
    source: "test",
    venue: "test",
    timeframe: "1h",
    timeframeMs: 3_600_000,
    candles: closes.map((close, index) => ({
      pair: "BTC/USD", base: "BTC", quote: "USD", source: "test", venue: "test", timeframe: "1h",
      openTime: start + index * 3_600_000,
      closeTime: start + (index + 1) * 3_600_000,
      providerTs: null, receivedAt: null, cachedAt: null, isClosed: true,
      open: close, high: close, low: close, close, volume: 1, origin: "live",
    })),
    quality: { validity: "valid", reason: "ok", dataQuality: "good", ageMs: 0, missing: [] },
    gaps: 0,
    duplicates: 0,
    referenceCount: closes.length,
    lastClosedTime: null,
    providerTs: null,
    receivedAt: null,
    cachedAt: null,
    origin: "live",
  };
}

function divergence(overrides: Partial<SecondaryDivergence> = {}): SecondaryDivergence {
  return {
    alignedCount: 10,
    primaryCount: 10,
    secondaryCount: 10,
    coveragePct: 100,
    meanAbsDiffPct: 0.1,
    p95AbsDiffPct: 0.2,
    maxAbsDiffPct: 0.3,
    ...overrides,
  };
}

describe("compareWithPrimary y política de fallback secundario", () => {
  it("calcula media, p95, máximo y cobertura solo en velas alineadas", () => {
    const primary = seriesWithCloses([100, 100, 100, 100]);
    const secondary = seriesWithCloses([100, 101, 99, 100]);
    const result = compareWithPrimary(primary, secondary);
    expect(result.alignedCount).toBe(4);
    expect(result.meanAbsDiffPct).toBeCloseTo(0.5, 8);
    expect(result.maxAbsDiffPct).toBeCloseTo(1, 8);
    expect(result.p95AbsDiffPct).toBeCloseTo(1, 8);
    expect(result.coveragePct).toBe(100);
  });

  it("tracking/UI permite con etiqueta incluso si está viejo", () => {
    const decision = evaluateSecondaryFallback("tracking_ui", null, 10 * 60_000);
    expect(decision.useSecondary).toBe(true);
    expect(decision.requiresLabel).toBe(true);
  });

  it("salidas protectoras permiten solo divergencia medida ≤0.5% y exigen alerta", () => {
    const ok = evaluateSecondaryFallback("protective_exit", divergence({ maxAbsDiffPct: 0.5 }), 60_000);
    expect(ok.useSecondary).toBe(true);
    expect(ok.decision).toBe("allowed_with_alert");
    expect(ok.requiresAlert).toBe(true);

    expect(evaluateSecondaryFallback("protective_exit", divergence({ maxAbsDiffPct: 0.501 }), 60_000).useSecondary).toBe(false);
    expect(evaluateSecondaryFallback("protective_exit", divergence(), 6 * 60_000).useSecondary).toBe(false);
  });

  it("entradas nuevas nunca usan fuente secundaria", () => {
    const decision = evaluateSecondaryFallback("new_entry", divergence(), 1_000);
    expect(decision.useSecondary).toBe(false);
    expect(decision.decision).toBe("denied");
  });

  it("indicadores/score exigen serie completa de una única fuente", () => {
    expect(evaluateSecondaryFallback("indicator_score", divergence(), 60_000).useSecondary).toBe(true);
    expect(evaluateSecondaryFallback("indicator_score", divergence({ coveragePct: 99.9 }), 60_000).useSecondary).toBe(false);
  });
});
