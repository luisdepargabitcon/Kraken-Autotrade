/**
 * FISCO Normalizer: Converts raw exchange data into unified FiscoOperation format.
 * Handles deduplication, classification, and EUR conversion.
 * Sources: Kraken ledger + RevolutX historical orders.
 */

import { toEur, getUsdToEurRate } from "./eur-rates";

// ============================================================
// Types
// ============================================================

export interface NormalizedOperation {
  exchange: string;
  externalId: string;
  opType: "trade_buy" | "trade_sell" | "deposit" | "withdrawal" | "conversion" | "staking";
  asset: string;
  amount: number;       // Always positive
  priceEur: number | null;
  totalEur: number | null;
  feeEur: number;
  counterAsset: string | null;
  pair: string | null;
  executedAt: Date;
  rawData: any;
}

// ============================================================
// Asset normalization
// ============================================================

const ASSET_MAP: Record<string, string> = {
  XXBT: "BTC", XETH: "ETH", XXRP: "XRP", XLTC: "LTC", XDOT: "DOT",
  ZUSD: "USD", ZEUR: "EUR", ZGBP: "GBP", ZJPY: "JPY",
  XBT: "BTC",
};

function normalizeAsset(raw: string): string {
  return ASSET_MAP[raw] || raw;
}

// ============================================================
// Kraken ledger normalization
// ============================================================

interface KrakenLedgerEntry {
  id: string;
  refid: string;
  type: string;
  subtype: string;
  asset: string;
  amount: number;
  fee: number;
  balance: number;
  time: number;
}

/**
 * Group Kraken ledger entries by refid to reconstruct full operations.
 * Trade entries come in pairs (e.g., -BTC + USD for a BTC sell).
 */
export async function normalizeKrakenLedger(
  entries: KrakenLedgerEntry[]
): Promise<NormalizedOperation[]> {
  const ops: NormalizedOperation[] = [];
  const usdEurRate = await getUsdToEurRate();

  // Group by refid
  const byRefid = new Map<string, KrakenLedgerEntry[]>();
  for (const e of entries) {
    const group = byRefid.get(e.refid) || [];
    group.push(e);
    byRefid.set(e.refid, group);
  }

  for (const [refid, group] of byRefid) {
    const firstEntry = group[0];
    const execDate = new Date(firstEntry.time * 1000);

    // --- TRADE ---
    if (firstEntry.type === "trade") {
      // Find the two sides: one positive (received), one negative (spent)
      const positive = group.filter(e => e.amount > 0);
      const negative = group.filter(e => e.amount < 0);

      if (positive.length === 0 || negative.length === 0) continue;

      const received = positive[0];
      const spent = negative[0];
      const recvAsset = normalizeAsset(received.asset);
      const spentAsset = normalizeAsset(spent.asset);
      const recvAmount = Math.abs(received.amount);
      const spentAmount = Math.abs(spent.amount);

      // Determine if this is a buy or sell of the crypto asset
      const stablecoins = ["USD", "EUR", "USDC", "USDT", "GBP"];
      const recvIsStable = stablecoins.includes(recvAsset);
      const spentIsStable = stablecoins.includes(spentAsset);

      let isBuy: boolean;
      let cryptoAsset: string;
      let quoteAsset: string;
      let cryptoAmount: number;
      let quoteAmount: number;
      let totalFee: number;

      if (recvIsStable && !spentIsStable) {
        // Selling crypto: received USD, spent BTC
        isBuy = false;
        cryptoAsset = spentAsset;
        quoteAsset = recvAsset;
        cryptoAmount = spentAmount;
        quoteAmount = recvAmount;
        totalFee = Math.abs(received.fee) + Math.abs(spent.fee);
      } else if (!recvIsStable && spentIsStable) {
        // Buying crypto: spent USD, received BTC
        isBuy = true;
        cryptoAsset = recvAsset;
        quoteAsset = spentAsset;
        cryptoAmount = recvAmount;
        quoteAmount = spentAmount;
        totalFee = Math.abs(received.fee) + Math.abs(spent.fee);
      } else if (!recvIsStable && !spentIsStable) {
        // Crypto-to-crypto trade: treat received as buy
        isBuy = true;
        cryptoAsset = recvAsset;
        quoteAsset = spentAsset;
        cryptoAmount = recvAmount;
        quoteAmount = spentAmount;
        totalFee = Math.abs(received.fee) + Math.abs(spent.fee);
      } else {
        // Stable-to-stable (conversion): e.g. USD→USDC
        const feeTotal = group.reduce((s, e) => s + Math.abs(e.fee), 0);
        ops.push({
          exchange: "kraken",
          externalId: `${refid}_conv`,
          opType: "conversion",
          asset: recvAsset,
          amount: recvAmount,
          priceEur: null,
          totalEur: await toEur(recvAmount, recvAsset),
          feeEur: await toEur(feeTotal, spentAsset),
          counterAsset: spentAsset,
          pair: `${recvAsset}/${spentAsset}`,
          executedAt: execDate,
          rawData: group,
        });
        continue;
      }

      const priceInQuote = quoteAmount / cryptoAmount;
      let priceEur: number;
      let totalEur: number;
      let feeEur: number;

      if (quoteAsset === "EUR") {
        priceEur = priceInQuote;
        totalEur = quoteAmount;
        feeEur = totalFee;
      } else {
        priceEur = priceInQuote * usdEurRate;
        totalEur = quoteAmount * usdEurRate;
        feeEur = totalFee * usdEurRate;
      }

      ops.push({
        exchange: "kraken",
        externalId: refid,
        opType: isBuy ? "trade_buy" : "trade_sell",
        asset: cryptoAsset,
        amount: cryptoAmount,
        priceEur,
        totalEur,
        feeEur,
        counterAsset: quoteAsset,
        pair: `${cryptoAsset}/${quoteAsset}`,
        executedAt: execDate,
        rawData: group,
      });
    }

    // --- DEPOSIT ---
    else if (firstEntry.type === "deposit") {
      const asset = normalizeAsset(firstEntry.asset);
      const amount = Math.abs(firstEntry.amount);
      ops.push({
        exchange: "kraken",
        externalId: refid,
        opType: "deposit",
        asset,
        amount,
        priceEur: null,
        totalEur: null,
        feeEur: await toEur(Math.abs(firstEntry.fee), asset),
        counterAsset: null,
        pair: null,
        executedAt: execDate,
        rawData: group,
      });
    }

    // --- WITHDRAWAL ---
    else if (firstEntry.type === "withdrawal") {
      const asset = normalizeAsset(firstEntry.asset);
      const amount = Math.abs(firstEntry.amount);
      ops.push({
        exchange: "kraken",
        externalId: refid,
        opType: "withdrawal",
        asset,
        amount,
        priceEur: null,
        totalEur: null,
        feeEur: await toEur(Math.abs(firstEntry.fee), asset),
        counterAsset: null,
        pair: null,
        executedAt: execDate,
        rawData: group,
      });
    }

    // --- RECEIVE / SPEND (internal conversion like USDC↔USD) ---
    else if (firstEntry.type === "receive" || firstEntry.type === "spend") {
      // These come in pairs via the same refid — handle as conversion
      if (group.length >= 2) {
        const recv = group.find(e => e.amount > 0);
        const spend = group.find(e => e.amount < 0);
        if (recv && spend) {
          const recvAsset = normalizeAsset(recv.asset);
          const spentAsset = normalizeAsset(spend.asset);
          ops.push({
            exchange: "kraken",
            externalId: `${refid}_conv`,
            opType: "conversion",
            asset: recvAsset,
            amount: Math.abs(recv.amount),
            priceEur: null,
            totalEur: await toEur(Math.abs(recv.amount), recvAsset),
            feeEur: await toEur(Math.abs(recv.fee) + Math.abs(spend.fee), spentAsset),
            counterAsset: spentAsset,
            pair: `${spentAsset}→${recvAsset}`,
            executedAt: execDate,
            rawData: group,
          });
        }
      }
    }

    // --- STAKING ---
    else if (firstEntry.type === "staking") {
      const asset = normalizeAsset(firstEntry.asset);
      ops.push({
        exchange: "kraken",
        externalId: refid,
        opType: "staking",
        asset,
        amount: Math.abs(firstEntry.amount),
        priceEur: null,
        totalEur: null,
        feeEur: 0,
        counterAsset: null,
        pair: null,
        executedAt: execDate,
        rawData: group,
      });
    }
  }

  return ops;
}

// ============================================================
// RevolutX orders normalization
// ============================================================

interface RevolutXOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  quantity: number;
  filled_quantity: number;
  average_fill_price: number;
  status: string;
  created_date: number;
  filled_date?: number;
}

export async function normalizeRevolutXOrders(
  orders: RevolutXOrder[]
): Promise<NormalizedOperation[]> {
  const ops: NormalizedOperation[] = [];
  const usdEurRate = await getUsdToEurRate();

  for (const order of orders) {
    if (order.status !== "filled" || order.filled_quantity <= 0) continue;

    // Parse symbol: "BTC/USD", "ETH/EUR", etc.
    const [baseAsset, quoteAsset] = order.symbol.split("/");
    if (!baseAsset || !quoteAsset) continue;

    const amount = order.filled_quantity;
    const priceInQuote = order.average_fill_price;
    const totalInQuote = amount * priceInQuote;

    let priceEur: number;
    let totalEur: number;

    if (quoteAsset === "EUR") {
      priceEur = priceInQuote;
      totalEur = totalInQuote;
    } else {
      priceEur = priceInQuote * usdEurRate;
      totalEur = totalInQuote * usdEurRate;
    }

    // RevolutX doesn't report fees in order data; set to 0
    // (fees are embedded in the spread)
    const feeEur = 0;

    ops.push({
      exchange: "revolutx",
      externalId: order.id,
      opType: order.side === "buy" ? "trade_buy" : "trade_sell",
      asset: baseAsset,
      amount,
      priceEur,
      totalEur,
      feeEur,
      counterAsset: quoteAsset,
      pair: order.symbol,
      executedAt: new Date(order.created_date),
      rawData: order,
    });
  }

  return ops;
}

// ============================================================
// Merge & deduplicate
// ============================================================

/**
 * Merge operations from both exchanges, sort chronologically, deduplicate.
 * Cross-exchange transfers (withdrawal from one + deposit to other) are kept separate
 * but flagged — they don't create taxable events.
 */
export function mergeAndSort(
  krakenOps: NormalizedOperation[],
  revolutxOps: NormalizedOperation[]
): NormalizedOperation[] {
  const all = [...krakenOps, ...revolutxOps];

  // Deduplicate by exchange+externalId
  const seen = new Set<string>();
  const unique: NormalizedOperation[] = [];
  for (const op of all) {
    const key = `${op.exchange}:${op.externalId}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(op);
    }
  }

  // Sort chronologically
  unique.sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());

  return unique;
}
