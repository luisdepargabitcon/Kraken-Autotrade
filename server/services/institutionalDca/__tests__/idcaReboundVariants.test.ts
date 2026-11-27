import { describe, expect, it } from "vitest";
import {
  detectRebound,
  detectReboundDetailed,
  type OhlcCandle,
  type ReboundInput,
} from "../IdcaSmartLayer";

function candle(open: number | undefined, high: number, low: number, close: number): OhlcCandle {
  return { open, high, low, close };
}

function input(
  recentCandles: OhlcCandle[],
  currentPrice: number,
  localLow: number,
  reboundMinPct = 0.3,
): ReboundInput {
  return { recentCandles, currentPrice, localLow, reboundMinPct };
}

const goldenLegacyVectors: Array<[string, ReboundInput, boolean]> = [
  [
    "wickLegacyGreen",
    input([
      candle(100, 101, 98, 100.5),
      candle(101, 102, 98, 101.8),
    ], 101.8, 98),
    true,
  ],
  [
    "wickLegacyRed",
    input([
      candle(100, 101, 98, 100.5),
      candle(102, 102, 98, 100.2),
    ], 100.2, 98),
    true,
  ],
  [
    "recovery",
    input([
      candle(100, 101, 99, 100),
      candle(100, 101, 99, 100.6),
    ], 100.7, 99),
    true,
  ],
  [
    "slowingLegacyAbsMove",
    input([
      candle(100, 101, 99, 100),
      candle(100, 102, 99, 101),
      candle(101, 102, 100.4, 101.2),
    ], 101.2, 99),
    true,
  ],
  [
    "none",
    input([
      candle(112, 112, 110, 110),
      candle(110, 110, 105, 105),
      candle(105, 105, 100, 100),
    ], 100, 90),
    false,
  ],
  [
    "insufficient",
    input([
      candle(100, 101, 99, 100.5),
    ], 100.5, 99),
    false,
  ],
  [
    "zeroRange",
    input([
      candle(100, 100, 100, 100),
      candle(100, 100, 100, 100),
    ], 100, 99),
    false,
  ],
];

function geometryInput(): ReboundInput {
  return input([
    candle(102, 102.2, 100.8, 101),
    candle(101, 101.2, 99.8, 100),
    candle(100, 103, 98, 102),
  ], 98.2, 98, 0.3);
}

function realFallInput(lastClose = 99.8): ReboundInput {
  return input([
    candle(106, 106.2, 104.8, 105),
    candle(105, 105.2, 99.8, 100),
    candle(100, 100.4, lastClose - 0.2, lastClose),
  ], lastClose, lastClose - 0.2, 5);
}

describe("detectRebound legacy golden outputs", () => {
  it.each(goldenLegacyVectors)("%s conserva la salida legacy esperada", (_name, vector, expected) => {
    expect(detectRebound(vector)).toBe(expected);
    expect(detectReboundDetailed(vector, "legacy").confirmed).toBe(expected);
  });
});

describe("detectReboundDetailed — geometría de mecha a1a", () => {
  it("vela verde: legacy cuenta cuerpo como mecha y a1a no", () => {
    const vector = geometryInput();
    expect(detectReboundDetailed(vector, "legacy").reasons.wick).toBe(true);
    const result = detectReboundDetailed(vector, "a1a_wick_geometry");
    expect(result.reasons.wick).toBe(false);
    expect(result.confirmed).toBe(false);
    expect(result.status).toBe("NOT_REQUIRED");
  });

  it("vela verde con mecha inferior geométrica real sí se reconoce", () => {
    const vector = input([
      candle(101, 101.2, 100.8, 101),
      candle(100, 103, 97.4, 102),
    ], 100.1, 97.4, 5);
    const result = detectReboundDetailed(vector, "a1a_wick_geometry");
    expect(result.reasons.wick).toBe(true);
    expect(result.confirmed).toBe(true);
  });

  it("vela roja y doji usan el cuerpo inferior sin inventar open", () => {
    const red = input([
      candle(102, 103, 98, 100),
      candle(101, 101.2, 100.8, 101),
    ], 100, 98, 5);
    const doji = input([
      candle(100, 103, 98, 100),
      candle(101, 101.2, 100.8, 101),
    ], 100, 98, 5);
    expect(detectReboundDetailed(red, "a1a_wick_geometry").reasons.wick).toBe(true);
    expect(detectReboundDetailed(doji, "a1a_wick_geometry").reasons.wick).toBe(true);
  });

  it("open ausente invalida a1a y no se sustituye por close", () => {
    const vector = input([
      candle(undefined, 103, 98, 102),
      candle(101, 101.2, 100.8, 101),
    ], 100, 98);
    const result = detectReboundDetailed(vector, "a1a_wick_geometry");
    expect(result.status).toBe("INVALID");
    expect(result.confirmed).toBe(false);
    expect(result.invalidReason).toContain("open");
  });

  it("rango cero no confirma pero no invalida una vela OHLC coherente", () => {
    const vector = input([
      candle(100, 100, 100, 100),
      candle(100, 100, 100, 100),
    ], 100, 99);
    const result = detectReboundDetailed(vector, "a1a_wick_geometry");
    expect(result.status).toBe("NOT_REQUIRED");
    expect(result.reasons.wick).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("valor no finito %s invalida variante corregida", bad => {
    const vector = input([
      candle(100, bad, 98, 102),
      candle(101, 101.2, 100.8, 101),
    ], 100, 98);
    expect(detectReboundDetailed(vector, "a1a_wick_geometry").status).toBe("INVALID");
  });

  it("OHLC incoherente invalida la variante con geometría", () => {
    const vector = input([
      candle(104, 103, 98, 102),
      candle(101, 101.2, 100.8, 101),
    ], 100, 98);
    expect(detectReboundDetailed(vector, "a1a_wick_geometry").status).toBe("INVALID");
  });
});

describe("detectReboundDetailed — desaceleración con caída real a1b", () => {
  it("movimiento al alza que legacy acepta no cuenta como desaceleración en a1b", () => {
    const vector = input([
      candle(100, 101, 99, 100),
      candle(100, 102, 99, 101),
      candle(101, 101.2, 100.6, 100.8),
    ], 100.8, 99);
    expect(detectReboundDetailed(vector, "legacy").reasons.slowing).toBe(true);
    const result = detectReboundDetailed(vector, "a1b_slowing_real_fall");
    expect(result.reasons.slowing).toBe(false);
    expect(result.confirmed).toBe(false);
  });

  it("caída real previa con caída posterior menor sí desacelera", () => {
    const result = detectReboundDetailed(realFallInput(99.8), "a1b_slowing_real_fall");
    expect(result.reasons.slowing).toBe(true);
    expect(result.confirmed).toBe(true);
  });

  it("caída real previa pero última caída no desacelerada no confirma por slowing", () => {
    const result = detectReboundDetailed(realFallInput(97), "a1b_slowing_real_fall");
    expect(result.reasons.slowing).toBe(false);
  });

  it("NaN/Infinity invalidan a1b aunque no exijan open", () => {
    const vector = realFallInput(99.8);
    vector.recentCandles[2].close = Number.NaN;
    expect(detectReboundDetailed(vector, "a1b_slowing_real_fall").status).toBe("INVALID");
  });
});

describe("detectReboundDetailed — combinación estricta a1c", () => {
  it("recovery + wick confirma", () => {
    const vector = input([
      candle(101, 101.2, 100.8, 101),
      candle(100, 103, 97.4, 102),
    ], 103.4, 97.4, 3);
    const result = detectReboundDetailed(vector, "a1c_combined");
    expect(result.reasons).toMatchObject({ wick: true, recovery: true });
    expect(result.status).toBe("CONFIRMED");
    expect(result.confirmed).toBe(true);
  });

  it("recovery + slowing confirma", () => {
    const vector = realFallInput(99.8);
    vector.currentPrice = 106;
    vector.localLow = 99.6;
    vector.recentCandles[2].close = 100.1;
    const result = detectReboundDetailed(vector, "a1c_combined");
    expect(result.reasons.recovery).toBe(true);
    expect(result.reasons.slowing).toBe(true);
    expect(result.status).toBe("CONFIRMED");
  });

  it("wick sola NO confirma en a1c: queda PENDING", () => {
    const vector = input([
      candle(101, 101.2, 100.8, 101),
      candle(100, 103, 97.4, 102),
    ], 100.1, 97.4, 5);
    const result = detectReboundDetailed(vector, "a1c_combined");
    expect(result.reasons.wick).toBe(true);
    expect(result.reasons.recovery).toBe(false);
    expect(result.status).toBe("PENDING");
    expect(result.confirmed).toBe(false);
  });

  it("slowing sola NO confirma en a1c: queda PENDING", () => {
    const result = detectReboundDetailed(realFallInput(99.8), "a1c_combined");
    expect(result.reasons.slowing).toBe(true);
    expect(result.reasons.recovery).toBe(false);
    expect(result.status).toBe("PENDING");
    expect(result.confirmed).toBe(false);
  });

  it("recovery sola NO confirma en a1c: queda PENDING", () => {
    const vector = input([
      candle(100, 100.5, 99.8, 100),
      candle(100, 101, 99.9, 100.6),
    ], 100.7, 99.8, 0.3);
    const result = detectReboundDetailed(vector, "a1c_combined");
    expect(result.reasons.recovery).toBe(true);
    expect(result.reasons.wick).toBe(false);
    expect(result.reasons.slowing).toBe(false);
    expect(result.status).toBe("PENDING");
    expect(result.confirmed).toBe(false);
  });

  it("todo falso es NOT_REQUIRED", () => {
    const vector = goldenLegacyVectors[4][1];
    const result = detectReboundDetailed(vector, "a1c_combined");
    expect(result.reasons).toEqual({ wick: false, recovery: false, slowing: false });
    expect(result.status).toBe("NOT_REQUIRED");
    expect(result.confirmed).toBe(false);
  });

  it("open ausente invalida a1c incluso si hay recovery", () => {
    const vector = input([
      candle(undefined, 101, 99, 100),
      candle(100, 101, 99, 100.6),
    ], 100.7, 99, 0.3);
    const result = detectReboundDetailed(vector, "a1c_combined");
    expect(result.status).toBe("INVALID");
    expect(result.confirmed).toBe(false);
  });
});
