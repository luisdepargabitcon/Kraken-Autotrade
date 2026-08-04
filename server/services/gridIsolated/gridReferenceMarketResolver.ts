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
 */

import type { MarketTickerSnapshot } from "../MarketDataService";
import type {
  GridReferenceMarketSnapshot,
  GridReferenceMarketReasonCode,
} from "./gridIsolatedTypes";

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

  const { ticker, fetchedAt, maxAgeMs, fresh } = snapshot;

  // Stale check
  if (!fresh) {
    return invalid(
      expectedPair,
      "REFERENCE_MARKET_STALE",
      "El ticker de referencia de Kraken está caducado.",
      now,
      { bid: ticker.bid, ask: ticker.ask, last: ticker.last, fetchedAt, maxAgeMs, ageMs: snapshot.ageMs },
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
    );
  }

  // Timestamp validation
  const fetchedAtMs = fetchedAt.getTime();
  if (!Number.isFinite(fetchedAtMs)) {
    return invalid(
      expectedPair,
      "REFERENCE_MARKET_STALE",
      "El timestamp del ticker de referencia no es válido.",
      now,
    );
  }

  const ageMs = nowMs - fetchedAtMs;
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
  extra?: { bid?: number; ask?: number; last?: number; fetchedAt?: Date; maxAgeMs?: number; ageMs?: number },
): GridReferenceMarketSnapshot {
  return {
    pair,
    marketDataVenue: "KRAKEN",
    executionVenue: "REVOLUT_X",
    source: "KRAKEN_MARKET_DATA",
    bid: extra?.bid ?? 0,
    ask: extra?.ask ?? 0,
    last: extra?.last ?? 0,
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
