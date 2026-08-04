/**
 * gridReferenceMarketResolver.ts — REV-C12E
 *
 * Resolves a validated GridReferenceMarketSnapshot from a Kraken
 * MarketTickerSnapshot. This is the canonical reference market for Grid
 * planning (tick, rebuild, recommendations, projections).
 *
 * Kraken provides bid/ask/last for planning. Revolut X provides execution
 * constraints and order placement only.
 *
 * The reference market is NOT authoritative for venue crossing — it does not
 * guarantee that an order will be maker on Revolut X. The definitive maker
 * guarantee is post_only on Revolut X.
 *
 * REV-C12E correction: Does NOT trust snapshot.fresh alone. Recalculates
 * ageMs = now - fetchedAt and validates all fields fail-closed.
 */

import type { MarketTickerSnapshot } from "../MarketDataService";
import type {
  GridReferenceMarketSnapshot,
  GridReferenceMarketReasonCode,
} from "./gridIsolatedTypes";

// REV-C12E: Maximum tolerance for future timestamps (ms).
const MAX_FUTURE_SKEW_MS = 5_000;

export function resolveGridReferenceMarketSnapshot(
  snapshot: MarketTickerSnapshot | null,
  expectedPair: string,
  now: Date,
): GridReferenceMarketSnapshot {
  const nowMs = now.getTime();

  // Fail-closed: no snapshot
  if (!snapshot) {
    return invalid(
      expectedPair,
      "REFERENCE_MARKET_UNAVAILABLE",
      "No se pudo obtener el ticker de referencia de Kraken.",
      now,
    );
  }

  // Pair mismatch
  if (snapshot.pair !== expectedPair) {
    return invalid(
      expectedPair,
      "REFERENCE_MARKET_PAIR_MISMATCH",
      `El par del snapshot (${snapshot.pair}) no coincide con el par configurado (${expectedPair}).`,
      now,
    );
  }

  // Source must be KRAKEN_MARKET_DATA
  if (snapshot.source !== "KRAKEN_MARKET_DATA") {
    return invalid(
      expectedPair,
      "REFERENCE_MARKET_SOURCE_INVALID",
      "La fuente del ticker de referencia no es KRAKEN_MARKET_DATA.",
      now,
    );
  }

  // marketDataVenue must be KRAKEN
  if (snapshot.marketDataVenue !== "KRAKEN") {
    return invalid(
      expectedPair,
      "REFERENCE_MARKET_SOURCE_INVALID",
      "El venue de datos de mercado no es KRAKEN.",
      now,
    );
  }

  const { ticker, fetchedAt, maxAgeMs } = snapshot;

  // Validate now
  if (!Number.isFinite(nowMs)) {
    return invalid(
      expectedPair,
      "REFERENCE_MARKET_TIMESTAMP_INVALID",
      "El instante de evaluación no es válido.",
      now,
    );
  }

  // Validate fetchedAt
  const fetchedAtMs = fetchedAt.getTime();
  if (!Number.isFinite(fetchedAtMs)) {
    return invalid(
      expectedPair,
      "REFERENCE_MARKET_TIMESTAMP_INVALID",
      "El timestamp del ticker de referencia de Kraken no es válido.",
      now,
      { ticker },
    );
  }

  // Validate maxAgeMs: must be finite and > 0
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    return invalid(
      expectedPair,
      "REFERENCE_MARKET_STALE",
      "maxAgeMs del ticker de referencia no es válido.",
      now,
      { ticker, fetchedAt },
    );
  }

  // Recalculate ageMs — do NOT trust snapshot.fresh alone
  const ageMs = nowMs - fetchedAtMs;

  // Future timestamp check (with tolerance)
  if (ageMs < -MAX_FUTURE_SKEW_MS) {
    return invalid(
      expectedPair,
      "REFERENCE_MARKET_FUTURE_TIMESTAMP",
      "El timestamp del ticker de referencia de Kraken está excesivamente en el futuro.",
      now,
      { ticker, fetchedAt, maxAgeMs, ageMs },
    );
  }

  // Negative ageMs (within tolerance is allowed, but strictly negative without tolerance is suspicious)
  // We already checked ageMs < -MAX_FUTURE_SKEW_MS above. If ageMs is in [-MAX_FUTURE_SKEW_MS, 0),
  // it's within future tolerance — treat as fresh (ageMs = 0 effectively).

  // Stale check: ageMs >= maxAgeMs → stale
  // Canonical boundary: ageMs < maxAgeMs → fresh; ageMs >= maxAgeMs → stale
  if (ageMs >= maxAgeMs) {
    return invalid(
      expectedPair,
      "REFERENCE_MARKET_STALE",
      "El ticker de referencia de Kraken está caducado.",
      now,
      { ticker, fetchedAt, maxAgeMs, ageMs },
    );
  }

  // Verify snapshot.fresh is true (coherence check)
  if (snapshot.fresh !== true) {
    return invalid(
      expectedPair,
      "REFERENCE_MARKET_STALE",
      "El ticker de referencia de Kraken no está marcado como fresco.",
      now,
      { ticker, fetchedAt, maxAgeMs, ageMs },
    );
  }

  // Verify snapshot.ageMs coherence (allow small skew due to processing time)
  const snapshotAgeMs = snapshot.ageMs;
  if (Number.isFinite(snapshotAgeMs) && Math.abs(snapshotAgeMs - ageMs) > 10_000) {
    return invalid(
      expectedPair,
      "REFERENCE_MARKET_TIMESTAMP_INVALID",
      "El ageMs del snapshot no es coherente con el cálculo independiente.",
      now,
      { ticker, fetchedAt, maxAgeMs, ageMs },
    );
  }

  // Bid validation
  const bid = ticker.bid;
  if (!Number.isFinite(bid) || bid <= 0) {
    return invalid(
      expectedPair,
      "REFERENCE_MARKET_BID_INVALID",
      "El BID de referencia de Kraken no es válido.",
      now,
      { fetchedAt, maxAgeMs, ageMs },
    );
  }

  // Ask validation
  const ask = ticker.ask;
  if (!Number.isFinite(ask) || ask <= bid) {
    return invalid(
      expectedPair,
      "REFERENCE_MARKET_ASK_INVALID",
      "El ASK de referencia de Kraken no es válido o no supera al BID.",
      now,
      { bid, fetchedAt, maxAgeMs, ageMs },
    );
  }

  // Last validation
  const last = ticker.last;
  if (!Number.isFinite(last) || last <= 0) {
    return invalid(
      expectedPair,
      "REFERENCE_MARKET_LAST_INVALID",
      "El último precio de referencia de Kraken no es válido.",
      now,
      { bid, ask, fetchedAt, maxAgeMs, ageMs },
    );
  }

  const spreadUsd = ask - bid;
  const spreadPct = (spreadUsd / bid) * 100;

  return {
    pair: expectedPair,
    marketDataVenue: "KRAKEN",
    executionVenue: "REVOLUT_X",
    source: "KRAKEN_MARKET_DATA",
    bid,
    ask,
    last,
    spreadUsd,
    spreadPct,
    timestamp: fetchedAt,
    fetchedAt,
    ageMs,
    maxAgeMs,
    fresh: true,
    verifiedForPlanning: true,
    authoritativeForVenueCrossing: false,
    reasonCode: null,
    explanation: "Ticker de referencia Kraken verificado para planificación Grid.",
  };
}

function invalid(
  pair: string,
  reasonCode: GridReferenceMarketReasonCode,
  explanation: string,
  now: Date,
  extra?: { bid?: number; ask?: number; last?: number; ticker?: any; fetchedAt?: Date; maxAgeMs?: number; ageMs?: number },
): GridReferenceMarketSnapshot {
  const ticker = extra?.ticker;
  return {
    pair,
    marketDataVenue: "KRAKEN",
    executionVenue: "REVOLUT_X",
    source: "KRAKEN_MARKET_DATA",
    bid: extra?.bid ?? ticker?.bid ?? 0,
    ask: extra?.ask ?? ticker?.ask ?? 0,
    last: extra?.last ?? ticker?.last ?? 0,
    spreadUsd: 0,
    spreadPct: 0,
    timestamp: extra?.fetchedAt ?? now,
    fetchedAt: extra?.fetchedAt ?? now,
    ageMs: extra?.ageMs ?? 0,
    maxAgeMs: extra?.maxAgeMs ?? 0,
    fresh: false,
    verifiedForPlanning: false,
    authoritativeForVenueCrossing: false,
    reasonCode,
    explanation,
  };
}
