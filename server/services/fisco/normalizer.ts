/**
 * FISCO Normalizer: Converts raw exchange data into unified FiscoOperation format.
 * Handles deduplication, classification, and EUR conversion.
 * Sources: Kraken ledger + RevolutX historical orders.
 *
 * FIXED (2026-06-06):
 * - Crypto-to-crypto trades now generate TWO operations (sell spent + buy received).
 * - Crypto→stablecoin sells now also create a trade_buy for the stablecoin received.
 * - Stablecoin→fiat now generates proper trade_sell for the stablecoin.
 * - Fiat→stablecoin now generates proper trade_buy for the stablecoin.
 * - Stablecoin→stablecoin generates both sell and buy.
 * - Historical USD/EUR rate used per operation date (not a single global rate).
 * - Kraken refid groups with >2 entries are handled by aggregating all positives/negatives.
 */

import { toEurHistorical, prefetchHistoricalRates, getHistoricalUsdEurRate, getCryptoEurPriceHistorical } from "./eur-rates";

// ============================================================
// Types
// ============================================================

export interface NormalizedOperation {
  exchange: string;
  externalId: string;
  opType: "trade_buy" | "trade_sell" | "deposit" | "withdrawal" | "conversion" | "staking";
  asset: string;
  amount: number;
  priceEur: number | null;
  totalEur: number | null;
  feeEur: number;
  counterAsset: string | null;
  pair: string | null;
  executedAt: Date;
  rawData: any;
  requiresEurPrice?: boolean;
}

// ============================================================
// Asset classification
// ============================================================

const ASSET_MAP: Record<string, string> = {
  XXBT: "BTC", XETH: "ETH", XXRP: "XRP", XLTC: "LTC", XDOT: "DOT",
  ZUSD: "USD", ZEUR: "EUR", ZGBP: "GBP", ZJPY: "JPY", XBT: "BTC",
  "EUR.HOLD": "EUR", "USD.HOLD": "USD", "GBP.HOLD": "GBP",
  "EUR.M": "EUR", "USD.M": "USD", "ETH2.S": "ETH", "ETH2": "ETH",
  "DOT.S": "DOT", "XBT.M": "BTC",
};

export function normalizeAsset(raw: string): string {
  if (ASSET_MAP[raw]) return ASSET_MAP[raw];
  const stripped = raw.replace(/\.(HOLD|S|M|F|P)$/, "");
  return ASSET_MAP[stripped] || stripped;
}

// Fiat currencies: not tracked in FIFO, never generate lots/disposals
const FIAT_ASSETS = new Set(["USD", "EUR", "GBP", "JPY", "CHF"]);
// Crypto-stablecoins: ARE tracked in FIFO (they are crypto tokens with cost basis)
const CRYPTO_STABLES = new Set(["USDC", "USDT", "USDE", "DAI", "BUSD"]);

const isFiat = (a: string) => FIAT_ASSETS.has(a);
const isCryptoStable = (a: string) => CRYPTO_STABLES.has(a);
const isCrypto = (a: string) => !isFiat(a) && !isCryptoStable(a);

// ============================================================
// EUR helpers (per-date historical rate)
// ============================================================

async function rateFor(date: Date): Promise<number> {
  return getHistoricalUsdEurRate(date);
}

async function toEurAmt(amount: number, asset: string, date: Date): Promise<number> {
  return toEurHistorical(amount, asset, date);
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

export async function normalizeKrakenLedger(
  entries: KrakenLedgerEntry[]
): Promise<NormalizedOperation[]> {
  const ops: NormalizedOperation[] = [];

  // Prefetch all historical EUR rates in one API call
  const dates = [...new Set(entries.map(e => new Date(e.time * 1000).toISOString().split("T")[0]))]
    .map(d => new Date(d));
  await prefetchHistoricalRates(dates);

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

    if (firstEntry.type === "trade") {
      // Aggregate ALL positive (received) and negative (spent) entries
      const posEntries = group.filter(e => e.amount > 0);
      const negEntries = group.filter(e => e.amount < 0);
      if (posEntries.length === 0 || negEntries.length === 0) continue;

      const recvAsset = normalizeAsset(posEntries[0].asset);
      const spentAsset = normalizeAsset(negEntries[0].asset);
      const recvAmount = posEntries.reduce((s, e) => s + Math.abs(e.amount), 0);
      const spentAmount = negEntries.reduce((s, e) => s + Math.abs(e.amount), 0);
      const totalFee = group.reduce((s, e) => s + Math.abs(e.fee), 0);
      const usdEurRate = await rateFor(execDate);

      const newOps = await classifyAndBuildTrade({
        exchange: "kraken",
        refid,
        recvAsset,
        spentAsset,
        recvAmount,
        spentAmount,
        totalFee,
        usdEurRate,
        execDate,
        rawData: group,
      });
      ops.push(...newOps);
    }

    else if (firstEntry.type === "deposit") {
      const asset = normalizeAsset(firstEntry.asset);
      ops.push({
        exchange: "kraken",
        externalId: refid,
        opType: "deposit",
        asset,
        amount: Math.abs(firstEntry.amount),
        priceEur: null, totalEur: null,
        feeEur: await toEurAmt(Math.abs(firstEntry.fee), asset, execDate),
        counterAsset: null, pair: null,
        executedAt: execDate, rawData: group,
      });
    }

    else if (firstEntry.type === "withdrawal") {
      const asset = normalizeAsset(firstEntry.asset);
      ops.push({
        exchange: "kraken",
        externalId: refid,
        opType: "withdrawal",
        asset,
        amount: Math.abs(firstEntry.amount),
        priceEur: null, totalEur: null,
        feeEur: await toEurAmt(Math.abs(firstEntry.fee), asset, execDate),
        counterAsset: null, pair: null,
        executedAt: execDate, rawData: group,
      });
    }

    else if (firstEntry.type === "receive" || firstEntry.type === "spend") {
      if (group.length >= 2) {
        const recv = group.find(e => e.amount > 0);
        const spend = group.find(e => e.amount < 0);
        if (recv && spend) {
          const recvAsset = normalizeAsset(recv.asset);
          const spentAsset = normalizeAsset(spend.asset);
          const recvAmount = Math.abs(recv.amount);
          const spentAmount = Math.abs(spend.amount);
          const totalFee = group.reduce((s, e) => s + Math.abs(e.fee), 0);
          const usdEurRate = await rateFor(execDate);

          // receive/spend can be stablecoin redemptions — use same classification
          const newOps = await classifyAndBuildTrade({
            exchange: "kraken",
            refid: `${refid}_rcv`,
            recvAsset, spentAsset,
            recvAmount, spentAmount,
            totalFee, usdEurRate,
            execDate, rawData: group,
          });
          ops.push(...newOps);
        }
      }
    }

    else if (firstEntry.type === "staking") {
      const asset = normalizeAsset(firstEntry.asset);
      ops.push({
        exchange: "kraken",
        externalId: refid,
        opType: "staking",
        asset,
        amount: Math.abs(firstEntry.amount),
        priceEur: null, totalEur: null, feeEur: 0,
        counterAsset: null, pair: null,
        executedAt: execDate, rawData: group,
      });
    }
  }

  return ops;
}

// ============================================================
// Core trade classifier — shared by Kraken and RevolutX
// ============================================================

interface TradeClassifyInput {
  exchange: string;
  refid: string;
  recvAsset: string;
  spentAsset: string;
  recvAmount: number;
  spentAmount: number;
  totalFee: number;
  usdEurRate: number;
  execDate: Date;
  rawData: any;
}

async function classifyAndBuildTrade(t: TradeClassifyInput): Promise<NormalizedOperation[]> {
  const { exchange, refid, recvAsset, spentAsset, recvAmount, spentAmount, totalFee, usdEurRate, execDate, rawData } = t;

  const recvFiat = isFiat(recvAsset);
  const spentFiat = isFiat(spentAsset);
  const recvStable = isCryptoStable(recvAsset);
  const spentStable = isCryptoStable(spentAsset);
  const recvCrypto = isCrypto(recvAsset);
  const spentCrypto = isCrypto(spentAsset);

  const feeEur = totalFee * usdEurRate;

  // ---- Case 1: Fiat↔Fiat (e.g. USD→EUR) — conversion, no FIFO
  if (recvFiat && spentFiat) {
    return [{
      exchange, externalId: `${refid}_conv`,
      opType: "conversion",
      asset: recvAsset, amount: recvAmount,
      priceEur: null, totalEur: recvAmount * usdEurRate, feeEur,
      counterAsset: spentAsset, pair: `${spentAsset}/${recvAsset}`,
      executedAt: execDate, rawData,
    }];
  }

  // ---- Case 2: Buy crypto with fiat (e.g. BTC/USD buy)
  if (recvCrypto && spentFiat) {
    const totalEur = spentAmount * usdEurRate;
    const priceEur = totalEur / recvAmount;
    return [{
      exchange, externalId: refid,
      opType: "trade_buy", asset: recvAsset, amount: recvAmount,
      priceEur, totalEur, feeEur,
      counterAsset: spentAsset, pair: `${recvAsset}/${spentAsset}`,
      executedAt: execDate, rawData,
    }];
  }

  // ---- Case 3: Sell crypto for fiat (e.g. BTC/USD sell)
  if (spentCrypto && recvFiat) {
    const totalEur = recvAmount * usdEurRate;
    const priceEur = totalEur / spentAmount;
    return [{
      exchange, externalId: refid,
      opType: "trade_sell", asset: spentAsset, amount: spentAmount,
      priceEur, totalEur, feeEur,
      counterAsset: recvAsset, pair: `${spentAsset}/${recvAsset}`,
      executedAt: execDate, rawData,
    }];
  }

  // ---- Case 4: Buy crypto with stablecoin (e.g. TON/USDC buy)
  //      → trade_buy crypto + trade_sell stablecoin (disposed to pay)
  if (recvCrypto && spentStable) {
    const totalEur = spentAmount * usdEurRate;
    const priceEur = totalEur / recvAmount;
    const stableDisposal: NormalizedOperation = {
      exchange, externalId: `${refid}_disp_${spentAsset}`,
      opType: "trade_sell", asset: spentAsset, amount: spentAmount,
      priceEur: usdEurRate, totalEur, feeEur: 0,
      counterAsset: recvAsset, pair: `${spentAsset}/${recvAsset}`,
      executedAt: execDate, rawData,
    };
    const cryptoBuy: NormalizedOperation = {
      exchange, externalId: refid,
      opType: "trade_buy", asset: recvAsset, amount: recvAmount,
      priceEur, totalEur, feeEur,
      counterAsset: spentAsset, pair: `${recvAsset}/${spentAsset}`,
      executedAt: execDate, rawData,
    };
    return [stableDisposal, cryptoBuy];
  }

  // ---- Case 5: Sell crypto for stablecoin (e.g. TON/USDC sell)
  //      → trade_sell crypto + trade_buy stablecoin (acquired as proceeds)
  if (spentCrypto && recvStable) {
    const totalEur = recvAmount * usdEurRate;
    const priceEur = totalEur / spentAmount;
    const cryptoSell: NormalizedOperation = {
      exchange, externalId: refid,
      opType: "trade_sell", asset: spentAsset, amount: spentAmount,
      priceEur, totalEur, feeEur,
      counterAsset: recvAsset, pair: `${spentAsset}/${recvAsset}`,
      executedAt: execDate, rawData,
    };
    const stableAcquisition: NormalizedOperation = {
      exchange, externalId: `${refid}_rcv_${recvAsset}`,
      opType: "trade_buy", asset: recvAsset, amount: recvAmount,
      priceEur: usdEurRate, totalEur, feeEur: 0,
      counterAsset: spentAsset, pair: `${recvAsset}/${spentAsset}`,
      executedAt: execDate, rawData,
    };
    return [cryptoSell, stableAcquisition];
  }

  // ---- Case 6: Buy stablecoin with fiat (e.g. USDC/USD buy)
  //      totalEur = USD spent → EUR; priceEur = cost per stablecoin unit (may differ from usdEurRate if spread exists)
  if (recvStable && spentFiat) {
    const totalEur = spentAmount * usdEurRate;
    const priceEur = totalEur / recvAmount;
    return [{
      exchange, externalId: refid,
      opType: "trade_buy", asset: recvAsset, amount: recvAmount,
      priceEur, totalEur, feeEur,
      counterAsset: spentAsset, pair: `${recvAsset}/${spentAsset}`,
      executedAt: execDate, rawData,
    }];
  }

  // ---- Case 7: Sell stablecoin for fiat (e.g. USDC/USD sell)
  //      proceeds = USD received (not stablecoin amount); priceEur = proceeds per stablecoin unit
  if (spentStable && recvFiat) {
    const totalEur = recvAmount * usdEurRate;   // USD received → EUR
    const priceEur = totalEur / spentAmount;    // per-unit stablecoin price
    return [{
      exchange, externalId: refid,
      opType: "trade_sell", asset: spentAsset, amount: spentAmount,
      priceEur, totalEur, feeEur,
      counterAsset: recvAsset, pair: `${spentAsset}/${recvAsset}`,
      executedAt: execDate, rawData,
    }];
  }

  // ---- Case 8: Stablecoin↔Stablecoin (e.g. USDC/USDT swap)
  if (recvStable && spentStable) {
    const totalEur = spentAmount * usdEurRate;
    return [
      {
        exchange, externalId: `${refid}_disp_${spentAsset}`,
        opType: "trade_sell", asset: spentAsset, amount: spentAmount,
        priceEur: usdEurRate, totalEur, feeEur,
        counterAsset: recvAsset, pair: `${spentAsset}/${recvAsset}`,
        executedAt: execDate, rawData,
      },
      {
        exchange, externalId: `${refid}_rcv_${recvAsset}`,
        opType: "trade_buy", asset: recvAsset, amount: recvAmount,
        priceEur: usdEurRate, totalEur: recvAmount * usdEurRate, feeEur: 0,
        counterAsset: spentAsset, pair: `${recvAsset}/${spentAsset}`,
        executedAt: execDate, rawData,
      },
    ];
  }

  // ---- Case 9: Crypto-to-Crypto (e.g. ETH/BTC)
  //      Try to get EUR historical price from CoinGecko for the spent asset.
  //      Both sides share the same EUR value (what was given = what was received in EUR terms).
  //      Falls back to requiresEurPrice=true only if no price is available.
  if (spentCrypto && recvCrypto) {
    const spentEurPrice = await getCryptoEurPriceHistorical(spentAsset, execDate);

    if (spentEurPrice !== null) {
      const totalEur = spentAmount * spentEurPrice;
      const feeHalf = feeEur / 2;
      return [
        {
          exchange, externalId: `${refid}_c2c_sell`,
          opType: "trade_sell", asset: spentAsset, amount: spentAmount,
          priceEur: spentEurPrice, totalEur, feeEur: feeHalf,
          counterAsset: recvAsset, pair: `${spentAsset}/${recvAsset}`,
          executedAt: execDate, rawData,
          requiresEurPrice: false,
        },
        {
          exchange, externalId: `${refid}_c2c_buy`,
          opType: "trade_buy", asset: recvAsset, amount: recvAmount,
          priceEur: totalEur / recvAmount, totalEur, feeEur: feeHalf,
          counterAsset: spentAsset, pair: `${recvAsset}/${spentAsset}`,
          executedAt: execDate, rawData,
          requiresEurPrice: false,
        },
      ];
    }

    console.warn(`[normalizer] Crypto-to-crypto ${refid}: no EUR price for ${spentAsset} on ${execDate.toISOString().split('T')[0]} — fallback to requiresEurPrice`);
    return [
      {
        exchange, externalId: `${refid}_c2c_sell`,
        opType: "trade_sell", asset: spentAsset, amount: spentAmount,
        priceEur: null, totalEur: null, feeEur: feeEur / 2,
        counterAsset: recvAsset, pair: `${spentAsset}/${recvAsset}`,
        executedAt: execDate, rawData,
        requiresEurPrice: true,
      },
      {
        exchange, externalId: `${refid}_c2c_buy`,
        opType: "trade_buy", asset: recvAsset, amount: recvAmount,
        priceEur: null, totalEur: null, feeEur: feeEur / 2,
        counterAsset: spentAsset, pair: `${recvAsset}/${spentAsset}`,
        executedAt: execDate, rawData,
        requiresEurPrice: true,
      },
    ];
  }

  // Fallback: unknown combination — emit as conversion for manual review
  console.warn(`[normalizer] Unclassified trade ${refid}: recv=${recvAsset} spent=${spentAsset}`);
  return [{
    exchange, externalId: `${refid}_unk`,
    opType: "conversion",
    asset: recvAsset, amount: recvAmount,
    priceEur: null, totalEur: null, feeEur,
    counterAsset: spentAsset, pair: `${recvAsset}/${spentAsset}`,
    executedAt: execDate, rawData,
  }];
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
  total_fee: number;
  status: string;
  created_date: number;
  filled_date?: number;
}

export async function normalizeRevolutXOrders(
  orders: RevolutXOrder[]
): Promise<NormalizedOperation[]> {
  const ops: NormalizedOperation[] = [];

  const validOrders = orders.filter(o => o.status === "filled" && o.filled_quantity > 0);
  const dates = validOrders.map(o => new Date(o.created_date));
  await prefetchHistoricalRates(dates);

  for (const order of validOrders) {
    const parts = order.symbol.split("/");
    if (parts.length !== 2) continue;
    const [baseAsset, quoteAsset] = parts;

    const execDate = new Date(order.created_date);
    const usdEurRate = await rateFor(execDate);
    const amount = order.filled_quantity;
    const priceInQuote = order.average_fill_price;
    const totalInQuote = amount * priceInQuote;
    const rawFeeInQuote = order.total_fee || totalInQuote * 0.0009;
    const totalFee = rawFeeInQuote;

    // Map to recv/spent based on side
    const recvAsset = order.side === "buy" ? baseAsset : quoteAsset;
    const spentAsset = order.side === "buy" ? quoteAsset : baseAsset;
    const recvAmount = order.side === "buy" ? amount : totalInQuote;
    const spentAmount = order.side === "buy" ? totalInQuote : amount;

    const newOps = await classifyAndBuildTrade({
      exchange: "revolutx",
      refid: order.id,
      recvAsset, spentAsset,
      recvAmount, spentAmount,
      totalFee, usdEurRate,
      execDate, rawData: order,
    });
    ops.push(...newOps);
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
