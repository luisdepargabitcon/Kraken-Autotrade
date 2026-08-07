import type { RevolutXPairConstraints } from "../exchanges/RevolutXService";

export interface GridExecutionMarketSnapshot {
  pair: string;
  // REV-C12E: Explicit venue fields — no ambiguous single venue.
  marketDataVenue: "KRAKEN" | "REVOLUT_X" | null;
  executionVenue: "REVOLUT_X";
  // REV-C12E: Legacy alias for executionVenue — kept for backward compat with tests.
  venue: "REVOLUT_X";
  bid: number | null;
  ask: number | null;
  last: number | null;
  spreadUsd: number | null;
  spreadPct: number | null;
  priceTickSize: number | null;
  priceTickPct: number | null;
  source: string;
  timestamp: Date | null;
  acquiredAt: Date;
  fetchedAt: Date;
  maxAgeMs: number;
  fresh: boolean;
  verified: boolean;
  reasonCode: string | null;
  explanation: string;
}

export function buildGridExecutionMarketSnapshot(input: {
  pair: string;
  ticker: { bid?: number | null; ask?: number | null; last?: number | null } | null;
  constraints: RevolutXPairConstraints;
  source: string;
  // REV-C12E: Real fetchedAt from the data source (NOT new Date()).
  // When source is Kraken, this is tickerSnapshot.fetchedAt.
  fetchedAt?: Date;
  maxAgeMs?: number;
  marketDataVenue?: "KRAKEN" | "REVOLUT_X" | null;
  timestamp?: Date | null;
  acquiredAt?: Date;
  now?: Date;
  maxFutureSkewMs?: number;
}): GridExecutionMarketSnapshot {
  // acquiredAt = evaluation instant (when we built this snapshot)
  const acquiredAt = input.acquiredAt ?? input.now ?? new Date();
  // fetchedAt = evaluation instant for staleness checks (default = acquiredAt).
  // When the real fetch time is known (REV-C12E Kraken path), pass it explicitly.
  const fetchedAt = input.fetchedAt ?? input.now ?? acquiredAt;
  const timestamp = input.timestamp ?? null;
  // REV-C12E: Canonical TTL = 45000ms. When provided, use the real source maxAgeMs.
  const maxAgeMs = input.maxAgeMs ?? 45_000;
  const maxFutureSkewMs = input.maxFutureSkewMs ?? 5_000;
  const bid = input.ticker?.bid ?? null;
  const ask = input.ticker?.ask ?? null;
  const last = input.ticker?.last ?? null;
  const normalizedPair = input.pair.replace("/", "-").toUpperCase();
  const marketDataVenue = input.marketDataVenue ?? (input.source.toUpperCase().includes("KRAKEN") ? "KRAKEN" : null);
  const isKrakenSource = marketDataVenue === "KRAKEN" || input.source.toUpperCase().includes("KRAKEN");

  const invalid = (reasonCode: string, explanation: string): GridExecutionMarketSnapshot => ({
    pair: input.pair,
    marketDataVenue,
    executionVenue: "REVOLUT_X",
    venue: "REVOLUT_X",
    bid, ask, last,
    spreadUsd: null, spreadPct: null,
    priceTickSize: input.constraints.priceTickSize, priceTickPct: null,
    source: input.source, timestamp, acquiredAt, fetchedAt, maxAgeMs,
    fresh: false, verified: false, reasonCode, explanation,
  });

  if (input.constraints.normalizedPair !== normalizedPair) {
    return invalid("EXECUTION_MARKET_PAIR_MISMATCH", "El par del snapshot no coincide exactamente con las constraints Revolut X.");
  }
  if (input.constraints.executionVenue !== "REVOLUT_X" || !input.constraints.verified || !Number.isFinite(input.constraints.priceTickSize) || !input.constraints.priceTickSize || input.constraints.priceTickSize <= 0) {
    return invalid("EXECUTION_MARKET_CONSTRAINTS_UNAVAILABLE", "No hay constraints Revolut X verificadas para calcular el tick de ejecución.");
  }
  // REV-C12E: Use REFERENCE_MARKET_* reason codes when data is from Kraken.
  if (!Number.isFinite(bid) || bid == null || bid <= 0) {
    return invalid(
      isKrakenSource ? "REFERENCE_MARKET_BID_INVALID" : "EXECUTION_MARKET_BID_INVALID",
      isKrakenSource ? "El BID de referencia de Kraken no es válido." : "El BID de Revolut X no es válido.",
    );
  }
  if (!Number.isFinite(ask) || ask == null || ask <= bid) {
    return invalid(
      isKrakenSource ? "REFERENCE_MARKET_ASK_INVALID" : "EXECUTION_MARKET_ASK_INVALID",
      isKrakenSource ? "El ASK de referencia de Kraken no es válido o no supera al BID." : "El ASK de Revolut X no es válido o no supera al BID.",
    );
  }
  if (last != null && (!Number.isFinite(last) || last <= 0)) {
    return invalid(
      isKrakenSource ? "REFERENCE_MARKET_LAST_INVALID" : "EXECUTION_MARKET_TIMESTAMP_INVALID",
      isKrakenSource ? "El último precio de referencia de Kraken no es válido." : "El último precio de Revolut X no es válido.",
    );
  }
  if (!input.source.toUpperCase().includes("REVOLUT") && !input.source.toUpperCase().includes("KRAKEN")) {
    return invalid("EXECUTION_MARKET_SOURCE_INVALID", "La fuente no identifica ni Revolut X ni Kraken de forma inequívoca.");
  }
  // REV-C12E: Validate maxAgeMs — must be finite and > 0.
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    return invalid("EXECUTION_MARKET_STALE", "maxAgeMs no es válido.");
  }
  // REV-C12E: Validate fetchedAt and acquiredAt are valid Dates.
  if (!Number.isFinite(fetchedAt.getTime())) {
    return invalid("EXECUTION_MARKET_TIMESTAMP_INVALID", "fetchedAt no es una fecha válida.");
  }
  if (!Number.isFinite(acquiredAt.getTime())) {
    return invalid("EXECUTION_MARKET_TIMESTAMP_INVALID", "acquiredAt no es una fecha válida.");
  }
  // REV-C12E: fetchedAt must not be excessively in the future.
  if (fetchedAt.getTime() > acquiredAt.getTime() + maxFutureSkewMs) {
    return invalid("EXECUTION_MARKET_FUTURE_TIMESTAMP", "fetchedAt está excesivamente en el futuro.");
  }
  if (timestamp != null) {
    if (!Number.isFinite(timestamp.getTime())) {
      return invalid("EXECUTION_MARKET_TIMESTAMP_INVALID", "El timestamp de mercado no es válido.");
    }
    if (timestamp.getTime() > acquiredAt.getTime() + maxFutureSkewMs) {
      return invalid("EXECUTION_MARKET_FUTURE_TIMESTAMP", "El timestamp de mercado está excesivamente en el futuro.");
    }
    if (acquiredAt.getTime() - timestamp.getTime() > maxAgeMs) {
      return invalid("EXECUTION_MARKET_STALE", isKrakenSource ? "El ticker de referencia de Kraken está caducado." : "El snapshot de Revolut X está caducado.");
    }
  } else if (acquiredAt.getTime() - fetchedAt.getTime() >= maxAgeMs) {
    // REV-C12E: Correct direction — acquiredAt - fetchedAt >= maxAgeMs → stale.
    return invalid("EXECUTION_MARKET_STALE", isKrakenSource ? "El ticker de referencia de Kraken se recibió fuera de la ventana de frescura." : "La respuesta de Revolut X se recibió fuera de la ventana de frescura.");
  }

  const referencePrice = last ?? (bid + ask) / 2;
  const spreadUsd = ask - bid;
  const explanation = isKrakenSource
    ? "Ticker de referencia Kraken verificado para planificación Grid. Constraints Revolut X verificadas."
    : "Snapshot de microestructura Revolut X verificado.";
  return {
    pair: input.pair,
    marketDataVenue,
    executionVenue: "REVOLUT_X",
    venue: "REVOLUT_X",
    bid, ask, last,
    spreadUsd,
    spreadPct: spreadUsd / bid * 100,
    priceTickSize: input.constraints.priceTickSize,
    priceTickPct: input.constraints.priceTickSize / referencePrice * 100,
    source: input.source,
    timestamp,
    acquiredAt,
    fetchedAt,
    maxAgeMs,
    fresh: true,
    verified: true,
    reasonCode: null,
    explanation,
  };
}
