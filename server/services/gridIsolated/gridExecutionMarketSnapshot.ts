import type { RevolutXPairConstraints } from "../exchanges/RevolutXService";

export interface GridExecutionMarketSnapshot {
  pair: string;
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
  timestamp?: Date | null;
  acquiredAt?: Date;
  now?: Date;
  maxAgeMs?: number;
  maxFutureSkewMs?: number;
}): GridExecutionMarketSnapshot {
  const fetchedAt = input.now ?? new Date();
  const acquiredAt = input.acquiredAt ?? fetchedAt;
  const timestamp = input.timestamp ?? null;
  const maxAgeMs = input.maxAgeMs ?? 30_000;
  const maxFutureSkewMs = input.maxFutureSkewMs ?? 5_000;
  const bid = input.ticker?.bid ?? null;
  const ask = input.ticker?.ask ?? null;
  const last = input.ticker?.last ?? null;
  const normalizedPair = input.pair.replace("/", "-").toUpperCase();
  const invalid = (reasonCode: string, explanation: string): GridExecutionMarketSnapshot => ({ pair: input.pair, venue: "REVOLUT_X", bid, ask, last, spreadUsd: null, spreadPct: null, priceTickSize: input.constraints.priceTickSize, priceTickPct: null, source: input.source, timestamp, acquiredAt, fetchedAt, maxAgeMs, fresh: false, verified: false, reasonCode, explanation });
  if (input.constraints.normalizedPair !== normalizedPair) return invalid("EXECUTION_MARKET_PAIR_MISMATCH", "El par del snapshot no coincide exactamente con las constraints Revolut X.");
  if (input.constraints.executionVenue !== "REVOLUT_X" || !input.constraints.verified || !Number.isFinite(input.constraints.priceTickSize) || !input.constraints.priceTickSize || input.constraints.priceTickSize <= 0) return invalid("EXECUTION_MARKET_CONSTRAINTS_UNAVAILABLE", "No hay constraints Revolut X verificadas para calcular el tick de ejecución.");
  if (!Number.isFinite(bid) || bid == null || bid <= 0) return invalid("EXECUTION_MARKET_BID_INVALID", "El BID de Revolut X no es válido.");
  if (!Number.isFinite(ask) || ask == null || ask <= bid) return invalid("EXECUTION_MARKET_ASK_INVALID", "El ASK de Revolut X no es válido o no supera al BID.");
  if (last != null && (!Number.isFinite(last) || last <= 0)) return invalid("EXECUTION_MARKET_TIMESTAMP_INVALID", "El último precio de Revolut X no es válido.");
  if (!input.source.toUpperCase().includes("REVOLUT") && !input.source.toUpperCase().includes("KRAKEN")) return invalid("EXECUTION_MARKET_SOURCE_INVALID", "La fuente no identifica ni Revolut X ni Kraken de forma inequívoca.");
  if (timestamp != null) {
    if (!Number.isFinite(timestamp.getTime())) return invalid("EXECUTION_MARKET_TIMESTAMP_INVALID", "El timestamp de mercado no es válido.");
    if (timestamp.getTime() > fetchedAt.getTime() + maxFutureSkewMs) return invalid("EXECUTION_MARKET_FUTURE_TIMESTAMP", "El timestamp de mercado está excesivamente en el futuro.");
    if (fetchedAt.getTime() - timestamp.getTime() > maxAgeMs) return invalid("EXECUTION_MARKET_STALE", "El snapshot de Revolut X está caducado.");
  } else if (!Number.isFinite(acquiredAt.getTime()) || fetchedAt.getTime() - acquiredAt.getTime() > maxAgeMs) {
    return invalid("EXECUTION_MARKET_STALE", "La respuesta de Revolut X se recibió fuera de la ventana de frescura.");
  }
  const referencePrice = last ?? (bid + ask) / 2;
  const spreadUsd = ask - bid;
  const isKrakenSource = input.source.toUpperCase().includes("KRAKEN");
  const explanation = isKrakenSource
    ? "Ticker de referencia Kraken verificado para planificación Grid. Constraints Revolut X verificadas."
    : "Snapshot de microestructura Revolut X verificado.";
  return { pair: input.pair, venue: "REVOLUT_X", bid, ask, last, spreadUsd, spreadPct: spreadUsd / bid * 100, priceTickSize: input.constraints.priceTickSize, priceTickPct: input.constraints.priceTickSize / referencePrice * 100, source: input.source, timestamp, acquiredAt, fetchedAt, maxAgeMs, fresh: true, verified: true, reasonCode: null, explanation };
}
