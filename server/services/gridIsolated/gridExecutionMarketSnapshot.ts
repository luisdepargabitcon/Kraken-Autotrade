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
  timestamp?: Date;
  now?: Date;
  maxAgeMs?: number;
}): GridExecutionMarketSnapshot {
  const fetchedAt = input.now ?? new Date();
  const timestamp = input.timestamp ?? fetchedAt;
  const maxAgeMs = input.maxAgeMs ?? 30_000;
  const bid = input.ticker?.bid ?? null;
  const ask = input.ticker?.ask ?? null;
  const last = input.ticker?.last ?? null;
  const invalid = (reasonCode: string, explanation: string): GridExecutionMarketSnapshot => ({ pair: input.pair, venue: "REVOLUT_X", bid, ask, last, spreadUsd: null, spreadPct: null, priceTickSize: input.constraints.priceTickSize, priceTickPct: null, source: input.source, timestamp, fetchedAt, maxAgeMs, fresh: false, verified: false, reasonCode, explanation });
  if (!input.constraints.verified || !input.constraints.priceTickSize || input.constraints.priceTickSize <= 0) return invalid("EXECUTION_MARKET_CONSTRAINTS_UNAVAILABLE", "No hay constraints Revolut X verificadas para calcular el tick de ejecución.");
  if (!Number.isFinite(bid) || bid == null || bid <= 0) return invalid("EXECUTION_MARKET_BID_INVALID", "El BID de Revolut X no es válido.");
  if (!Number.isFinite(ask) || ask == null || ask <= bid) return invalid("EXECUTION_MARKET_ASK_INVALID", "El ASK de Revolut X no es válido o no supera al BID.");
  if (last != null && (!Number.isFinite(last) || last <= 0)) return invalid("EXECUTION_MARKET_SNAPSHOT_UNAVAILABLE", "El último precio de Revolut X no es válido.");
  if (!timestamp || !Number.isFinite(timestamp.getTime()) || fetchedAt.getTime() - timestamp.getTime() > maxAgeMs) return invalid("EXECUTION_MARKET_STALE", "El snapshot de Revolut X está caducado.");
  if (!input.source.toUpperCase().includes("REVOLUT")) return invalid("EXECUTION_MARKET_SNAPSHOT_UNAVAILABLE", "La fuente no identifica Revolut X.");
  const referencePrice = last ?? (bid + ask) / 2;
  const spreadUsd = ask - bid;
  return { pair: input.pair, venue: "REVOLUT_X", bid, ask, last, spreadUsd, spreadPct: spreadUsd / bid * 100, priceTickSize: input.constraints.priceTickSize, priceTickPct: input.constraints.priceTickSize / referencePrice * 100, source: input.source, timestamp, fetchedAt, maxAgeMs, fresh: true, verified: true, reasonCode: null, explanation: "Snapshot de microestructura Revolut X verificado." };
}
