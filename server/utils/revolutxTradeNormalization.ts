export type NormalizedRevolutXTrade = {
  tradeId: any;
  executedAt: Date;
  price: any;
  amount: any;
  type: "buy" | "sell" | null;
  assumed: boolean;
  amountSource?: string;
  sideSource?: string;
};

function asLowerString(v: any): string {
  return (v ?? "").toString().trim().toLowerCase();
}

function parseNumberish(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function inferSideFromSideField(t: any): "buy" | "sell" | null {
  const sideRaw = asLowerString(
    t?.side ??
      t?.type ??
      t?.direction ??
      t?.taker_side ??
      t?.maker_side ??
      t?.aggressor_side
  );
  if (sideRaw === "buy" || sideRaw === "sell") return sideRaw;
  if (sideRaw === "b" || sideRaw === "bid") return "buy";
  if (sideRaw === "s" || sideRaw === "ask") return "sell";
  if (sideRaw === "buy_market" || sideRaw === "market_buy") return "buy";
  if (sideRaw === "sell_market" || sideRaw === "market_sell") return "sell";
  return null;
}

export function normalizeRevolutXTrade(t: any, allowAssumedSide: boolean): NormalizedRevolutXTrade {
  const tradeId = t?.tid || t?.id || t?.trade_id || t?.transaction_id || t?.txid;

  const tsRaw = t?.tdt ?? t?.timestamp ?? t?.time ?? t?.date ?? t?.created_at ?? t?.published_at;
  const tsNum = typeof tsRaw === "string" ? Number(tsRaw) : tsRaw;
  const executedAt = Number.isFinite(tsNum) ? new Date(tsNum) : new Date(tsRaw);

  const priceRaw = t?.p ?? t?.price;

  const amountBaseRaw =
    t?.amount_base ??
    t?.base_amount ??
    t?.baseAmount ??
    t?.amountBase ??
    t?.amount;

  const amountQuoteRaw =
    t?.amount_quote ??
    t?.quote_amount ??
    t?.quoteAmount ??
    t?.amountQuote ??
    t?.quote;

  const qtyRaw = t?.q ?? t?.quantity ?? t?.qty ?? t?.vol ?? t?.size;

  const sideFromField = inferSideFromSideField(t);
  if (sideFromField) {
    const n = parseNumberish(amountBaseRaw) ?? parseNumberish(qtyRaw);
    const amountAbs = n !== null ? Math.abs(n) : (amountBaseRaw ?? qtyRaw);
    return {
      tradeId,
      executedAt,
      price: priceRaw,
      amount: amountAbs,
      type: sideFromField,
      assumed: false,
      amountSource: n !== null ? (parseNumberish(amountBaseRaw) !== null ? "amount_base" : "quantity") : undefined,
      sideSource: "side_field",
    };
  }

  const signedBase = parseNumberish(amountBaseRaw);
  if (signedBase !== null && signedBase !== 0) {
    return {
      tradeId,
      executedAt,
      price: priceRaw,
      amount: Math.abs(signedBase),
      type: signedBase < 0 ? "sell" : "buy",
      assumed: false,
      amountSource: "amount_base",
      sideSource: "amount_base_sign",
    };
  }

  if (typeof amountBaseRaw === "string" && amountBaseRaw.trim().startsWith("-")) {
    const n = parseNumberish(amountBaseRaw);
    return {
      tradeId,
      executedAt,
      price: priceRaw,
      amount: n !== null ? Math.abs(n) : amountBaseRaw,
      type: "sell",
      assumed: false,
      amountSource: "amount_base",
      sideSource: "amount_base_sign",
    };
  }

  const signedQuote = parseNumberish(amountQuoteRaw);
  if (signedQuote !== null && signedQuote !== 0) {
    const inferredSide: "buy" | "sell" = signedQuote < 0 ? "buy" : "sell";
    const nBase = parseNumberish(amountBaseRaw);
    const nQty = parseNumberish(qtyRaw);
    const amountAbs = nBase !== null ? Math.abs(nBase) : (nQty !== null ? Math.abs(nQty) : (amountBaseRaw ?? qtyRaw));
    return {
      tradeId,
      executedAt,
      price: priceRaw,
      amount: amountAbs,
      type: inferredSide,
      assumed: false,
      amountSource: nBase !== null ? "amount_base" : (nQty !== null ? "quantity" : undefined),
      sideSource: "amount_quote_sign",
    };
  }

  const isBuyer = t?.is_buyer ?? t?.isBuyer ?? t?.buyer;
  if (typeof isBuyer === "boolean") {
    const n = parseNumberish(qtyRaw);
    const amountAbs = n !== null ? Math.abs(n) : qtyRaw;
    return {
      tradeId,
      executedAt,
      price: priceRaw,
      amount: amountAbs,
      type: isBuyer ? "buy" : "sell",
      assumed: false,
      amountSource: n !== null ? "quantity" : undefined,
      sideSource: "is_buyer",
    };
  }

  const qtyNum = parseNumberish(qtyRaw);
  if (qtyNum !== null && qtyNum !== 0) {
    if (qtyNum < 0) {
      return {
        tradeId,
        executedAt,
        price: priceRaw,
        amount: Math.abs(qtyNum),
        type: "sell",
        assumed: false,
        amountSource: "quantity",
        sideSource: "quantity_sign",
      };
    }

    if (qtyNum > 0) {
      return {
        tradeId,
        executedAt,
        price: priceRaw,
        amount: Math.abs(qtyNum),
        type: allowAssumedSide ? "buy" : null,
        assumed: allowAssumedSide,
        amountSource: "quantity",
        sideSource: allowAssumedSide ? "assumed_positive_quantity" : undefined,
      };
    }
  }

  if (typeof qtyRaw === "string" && qtyRaw.trim().startsWith("-")) {
    const n = parseNumberish(qtyRaw);
    return {
      tradeId,
      executedAt,
      price: priceRaw,
      amount: n !== null ? Math.abs(n) : qtyRaw,
      type: "sell",
      assumed: false,
      amountSource: "quantity",
      sideSource: "quantity_sign",
    };
  }

  return {
    tradeId,
    executedAt,
    price: priceRaw,
    amount: qtyRaw,
    type: null,
    assumed: false,
  };
}
