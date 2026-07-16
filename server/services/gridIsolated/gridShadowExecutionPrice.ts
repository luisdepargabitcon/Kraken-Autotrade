export type GridShadowExecutionPriceSource =
  | "ticker_last"
  | "bid_ask_mid"
  | "market_context"
  | "band_snapshot_fallback"
  | "no_price";

export interface GridShadowExecutionPriceInput {
  tickerLast?: number | null;
  bid?: number | null;
  ask?: number | null;
  marketContextPrice?: number | null;
  bandSnapshotClose?: number | null;
  now?: Date;
}

export interface GridShadowExecutionPriceResult {
  price: number;
  source: GridShadowExecutionPriceSource;
  bid?: number | null;
  ask?: number | null;
  spreadPct?: number | null;
  timestamp: string;
}

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function resolveGridShadowExecutionPrice(
  input: GridShadowExecutionPriceInput
): GridShadowExecutionPriceResult {
  const bid = validPrice(input.bid) ? input.bid : null;
  const ask = validPrice(input.ask) ? input.ask : null;
  const spreadPct = bid != null && ask != null && ask >= bid
    ? ((ask - bid) / bid) * 100
    : null;
  const timestamp = (input.now ?? new Date()).toISOString();

  if (validPrice(input.tickerLast)) {
    return { price: input.tickerLast, source: "ticker_last", bid, ask, spreadPct, timestamp };
  }

  if (bid != null && ask != null) {
    return { price: (bid + ask) / 2, source: "bid_ask_mid", bid, ask, spreadPct, timestamp };
  }

  if (validPrice(input.marketContextPrice)) {
    return { price: input.marketContextPrice, source: "market_context", bid, ask, spreadPct, timestamp };
  }

  if (validPrice(input.bandSnapshotClose)) {
    return { price: input.bandSnapshotClose, source: "band_snapshot_fallback", bid, ask, spreadPct, timestamp };
  }

  throw new Error("No valid Grid SHADOW execution price available");
}
