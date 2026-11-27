export interface EntryDataHealth {
  validity: "valid" | "stale" | "invalid" | "unknown";
  ageMs: number | null;
  maxAgeMs: number;
  missing: string[];
  origin?: string;
  components?: Record<string, { available: boolean; reason?: string }>;
}

export interface EntryDataGateResult {
  allow: boolean;
  code: string | null;
  reason: string;
  missing: string[];
  ageMs?: number | null;
}

export function resolveEntryDataGate(health: EntryDataHealth): EntryDataGateResult {
  const missing = health.missing.filter((item) => item !== "gaps");

  if (health.validity === "invalid") {
    return {
      allow: false,
      code: "market_data_invalid",
      reason: "datos de mercado inválidos",
      missing: health.missing,
    };
  }

  if (health.validity === "unknown") {
    return {
      allow: false,
      code: "market_data_unavailable",
      reason: "datos de mercado no disponibles o warm-up insuficiente",
      missing: health.missing,
    };
  }

  if (health.validity === "stale" || health.ageMs === null || health.ageMs > health.maxAgeMs) {
    return {
      allow: false,
      code: "market_data_stale",
      reason: "datos de mercado obsoletos para entrada",
      missing: health.missing,
      ageMs: health.ageMs,
    };
  }

  if (missing.length > 0) {
    return {
      allow: false,
      code: "market_data_incomplete",
      reason: "faltan componentes indispensables de mercado",
      missing,
    };
  }

  return { allow: true, code: null, reason: "ok", missing: [] };
}

export interface ExitPriceInput {
  realtimePrice: number | null;
  realtimeAgeMs: number | null;
  fallbackPrice?: number | null;
  fallbackAgeMs?: number | null;
  maxRealtimeAgeMs: number;
  maxFallbackAgeMs: number;
}

export interface ExitPriceResolution {
  price: number | null;
  source: "realtime" | "fallback" | "none";
  degraded: boolean;
  alert: string | null;
}

export function resolveExitPriceInput(input: ExitPriceInput): ExitPriceResolution {
  const hasRealtimePrice =
    input.realtimePrice !== null &&
    Number.isFinite(input.realtimePrice) &&
    input.realtimePrice > 0 &&
    input.realtimeAgeMs !== null &&
    input.realtimeAgeMs <= input.maxRealtimeAgeMs;

  if (hasRealtimePrice) {
    return {
      price: input.realtimePrice,
      source: "realtime",
      degraded: false,
      alert: null,
    };
  }

  const hasFallbackPrice =
    input.fallbackPrice !== null &&
    input.fallbackPrice !== undefined &&
    Number.isFinite(input.fallbackPrice) &&
    input.fallbackPrice > 0 &&
    input.fallbackAgeMs !== null &&
    input.fallbackAgeMs !== undefined &&
    input.fallbackAgeMs <= input.maxFallbackAgeMs;

  if (hasFallbackPrice) {
    return {
      price: input.fallbackPrice ?? null,
      source: "fallback",
      degraded: true,
      alert: "exit_price_degraded_fallback",
    };
  }

  return {
    price: null,
    source: "none",
    degraded: true,
    alert: "exit_price_unavailable_no_invented_price",
  };
}
