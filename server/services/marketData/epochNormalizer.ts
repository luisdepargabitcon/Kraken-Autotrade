export type EpochNormalizeResult =
  | { ok: true; ms: number }
  | { ok: false; reason: "non_numeric" | "non_positive" | "out_of_range" | "before_2009" | "future" };

const EARLIEST_PLAUSIBLE_MS = Date.UTC(2009, 0, 3);
const DEFAULT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export interface NormalizeEpochOptions {
  nowMs: number;
  unitHint?: "seconds" | "milliseconds";
  futureToleranceMs?: number;
}

// Canonical ingestion boundary for epoch timestamps. Ranges are explicit:
// <1e11 means seconds; 1e11..1e14 means milliseconds; anything else is invalid.
export function normalizeEpochToMs(value: unknown, options: NormalizeEpochOptions): EpochNormalizeResult {
  const nowMs = options.nowMs;
  if (!Number.isFinite(nowMs)) return { ok: false, reason: "non_numeric" };
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && value.trim() !== "") n = Number(value);
  else return { ok: false, reason: "non_numeric" };
  if (!Number.isFinite(n)) return { ok: false, reason: "non_numeric" };
  if (n <= 0) return { ok: false, reason: "non_positive" };

  let ms: number;
  if (options.unitHint === "seconds") ms = n * 1000;
  else if (options.unitHint === "milliseconds") ms = n;
  else if (n < 1e11) ms = n * 1000;
  else if (n >= 1e11 && n <= 1e14) ms = n;
  else return { ok: false, reason: "out_of_range" };

  if (!Number.isFinite(ms) || ms <= 0) return { ok: false, reason: "out_of_range" };
  if (ms < EARLIEST_PLAUSIBLE_MS) return { ok: false, reason: "before_2009" };
  const tolerance = options.futureToleranceMs ?? DEFAULT_FUTURE_TOLERANCE_MS;
  if (ms > nowMs + tolerance) return { ok: false, reason: "future" };
  return { ok: true, ms };
}
