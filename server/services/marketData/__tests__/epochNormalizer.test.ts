import { describe, expect, it } from "vitest";
import { normalizeEpochToMs } from "../epochNormalizer";

const NOW = 1_700_000_000_000;
const SEC = 1_699_999_000;
const MS = SEC * 1000;

describe("normalizeEpochToMs", () => {
  it("accepts seconds, milliseconds and numeric strings", () => {
    expect(normalizeEpochToMs(SEC, { nowMs: NOW })).toEqual({ ok: true, ms: MS });
    expect(normalizeEpochToMs(MS, { nowMs: NOW })).toEqual({ ok: true, ms: MS });
    expect(normalizeEpochToMs(String(SEC), { nowMs: NOW })).toEqual({ ok: true, ms: MS });
    expect(normalizeEpochToMs(String(MS), { nowMs: NOW })).toEqual({ ok: true, ms: MS });
  });
  it("honors unit hints", () => {
    expect(normalizeEpochToMs(SEC, { nowMs: NOW, unitHint: "seconds" })).toEqual({ ok: true, ms: MS });
    expect(normalizeEpochToMs(MS, { nowMs: NOW, unitHint: "milliseconds" })).toEqual({ ok: true, ms: MS });
  });
  it("rejects 1970, pre-2009, negative, zero, NaN and non-numeric values", () => {
    expect(normalizeEpochToMs(0, { nowMs: NOW })).toEqual({ ok: false, reason: "non_positive" });
    expect(normalizeEpochToMs(-1, { nowMs: NOW })).toEqual({ ok: false, reason: "non_positive" });
    expect(normalizeEpochToMs(NaN, { nowMs: NOW })).toEqual({ ok: false, reason: "non_numeric" });
    expect(normalizeEpochToMs("x", { nowMs: NOW })).toEqual({ ok: false, reason: "non_numeric" });
    expect(normalizeEpochToMs(1, { nowMs: NOW })).toEqual({ ok: false, reason: "before_2009" }); // 1970-01-01T00:00:01Z en ms si se interpreta mal; aquí segundo y sigue en 1970
    expect(normalizeEpochToMs(Date.UTC(2008, 0, 1), { nowMs: NOW })).toEqual({ ok: false, reason: "before_2009" });
  });
  it("rejects future timestamps beyond tolerance and accepts small clock skew", () => {
    expect(normalizeEpochToMs(NOW + 6 * 60_000, { nowMs: NOW })).toEqual({ ok: false, reason: "future" });
    expect(normalizeEpochToMs(NOW + 4 * 60_000, { nowMs: NOW })).toEqual({ ok: true, ms: NOW + 4 * 60_000 });
  });
  it("rejects values outside explicit seconds/ms ranges", () => {
    expect(normalizeEpochToMs(1e15, { nowMs: NOW })).toEqual({ ok: false, reason: "out_of_range" });
  });
});
