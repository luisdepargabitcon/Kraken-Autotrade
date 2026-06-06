/**
 * EUR conversion rates for FISCO module.
 * Uses ECB daily reference rates API (free, no key).
 * Falls back to hardcoded rates if API unavailable.
 *
 * Supports:
 * - Current rate (with 4h TTL cache)
 * - Historical rate by date (with per-day cache)
 */

const FALLBACK_RATES: Record<string, number> = {
  USD: 0.92,   // 1 USD = 0.92 EUR (approx 2026)
  EUR: 1.0,
  USDC: 0.92,
  USDT: 0.92,
};

let cachedUsdEur: number | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// Per-day historical cache: "YYYY-MM-DD" → rate
const historicalRateCache = new Map<string, number>();

function toDateStr(date: Date): string {
  return date.toISOString().split("T")[0]; // "YYYY-MM-DD"
}

/**
 * Parse ECB CSV response and extract the USD/EUR rate.
 * ECB EXR gives: 1 EUR = X USD → USD→EUR = 1/X
 */
function parseEcbCsv(text: string): number | null {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return null;
  const header = lines[0].split(",");
  const obsIdx = header.indexOf("OBS_VALUE");
  if (obsIdx < 0) return null;
  const lastLine = lines[lines.length - 1].split(",");
  const rate = parseFloat(lastLine[obsIdx]);
  if (isNaN(rate) || rate <= 0) return null;
  return 1 / rate;
}

/**
 * Fetch USD/EUR rate from ECB or use cache/fallback (current rate).
 */
export async function getUsdToEurRate(): Promise<number> {
  if (cachedUsdEur && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedUsdEur;
  }

  try {
    const resp = await fetch(
      "https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=1&format=csvdata",
      { signal: AbortSignal.timeout(5000) }
    );
    if (resp.ok) {
      const rate = parseEcbCsv(await resp.text());
      if (rate !== null) {
        cachedUsdEur = rate;
        cacheTimestamp = Date.now();
        console.log(`[fisco/eur] ECB current rate: 1 USD = ${cachedUsdEur.toFixed(6)} EUR`);
        return cachedUsdEur;
      }
    }
  } catch (e: any) {
    console.warn(`[fisco/eur] ECB API failed, using fallback: ${e.message}`);
  }

  return FALLBACK_RATES.USD;
}

/**
 * Fetch historical USD/EUR rate for a specific date.
 * Caches per calendar day to avoid redundant API calls.
 * Falls back to current rate if historical unavailable.
 */
export async function getHistoricalUsdEurRate(date: Date): Promise<number> {
  const dateStr = toDateStr(date);

  if (historicalRateCache.has(dateStr)) {
    return historicalRateCache.get(dateStr)!;
  }

  // ECB only provides business days; try date and up to 5 prior business days
  // Use startPeriod slightly before the date to ensure we get a reading
  const startDate = new Date(date);
  startDate.setDate(startDate.getDate() - 5);
  const startStr = toDateStr(startDate);

  try {
    const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod=${startStr}&endPeriod=${dateStr}&format=csvdata`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (resp.ok) {
      const rate = parseEcbCsv(await resp.text());
      if (rate !== null) {
        historicalRateCache.set(dateStr, rate);
        console.log(`[fisco/eur] ECB historical rate ${dateStr}: 1 USD = ${rate.toFixed(6)} EUR`);
        return rate;
      }
    }
  } catch (e: any) {
    console.warn(`[fisco/eur] ECB historical rate failed for ${dateStr}: ${e.message}`);
  }

  // Fallback: use current rate
  const fallback = await getUsdToEurRate();
  historicalRateCache.set(dateStr, fallback);
  return fallback;
}

/**
 * Prefetch historical USD/EUR rates for a batch of dates (to avoid sequential API calls).
 * Groups dates by month to minimize API requests.
 */
export async function prefetchHistoricalRates(dates: Date[]): Promise<void> {
  if (dates.length === 0) return;

  // Determine overall range
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const startStr = toDateStr(sorted[0]);
  const endStr = toDateStr(sorted[sorted.length - 1]);

  try {
    const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?startPeriod=${startStr}&endPeriod=${endStr}&format=csvdata`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return;

    const text = await resp.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) return;

    const header = lines[0].split(",");
    const obsIdx = header.indexOf("OBS_VALUE");
    const dateIdx = header.indexOf("TIME_PERIOD");
    if (obsIdx < 0 || dateIdx < 0) return;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const dateKey = cols[dateIdx]?.trim();
      const rawRate = parseFloat(cols[obsIdx]);
      if (dateKey && !isNaN(rawRate) && rawRate > 0) {
        historicalRateCache.set(dateKey, 1 / rawRate);
      }
    }
    console.log(`[fisco/eur] Prefetched ${historicalRateCache.size} historical rates (${startStr}→${endStr})`);
  } catch (e: any) {
    console.warn(`[fisco/eur] Prefetch historical rates failed: ${e.message}`);
  }
}

/**
 * Convert an amount from a quote currency to EUR using historical date rate.
 */
export async function toEurHistorical(amount: number, currency: string, date: Date): Promise<number> {
  const cur = currency.toUpperCase();
  if (cur === "EUR") return amount;
  if (cur === "USD" || cur === "USDC" || cur === "USDT") {
    const rate = await getHistoricalUsdEurRate(date);
    return amount * rate;
  }
  console.warn(`[fisco/eur] Unknown currency for EUR conversion: ${currency} (date ${toDateStr(date)})`);
  return amount;
}

/**
 * Convert an amount from a quote currency to EUR (current rate).
 */
export async function toEur(amount: number, currency: string): Promise<number> {
  const cur = currency.toUpperCase();
  if (cur === "EUR") return amount;
  if (cur === "USD" || cur === "USDC" || cur === "USDT") {
    const rate = await getUsdToEurRate();
    return amount * rate;
  }
  console.warn(`[fisco/eur] Unknown currency for EUR conversion: ${currency}`);
  return amount;
}

/**
 * Get the current USD→EUR rate (cached or fallback)
 */
export function getCachedUsdEurRate(): number {
  return cachedUsdEur || FALLBACK_RATES.USD;
}

// ============================================================
// Historical crypto EUR prices — Priority: Kraken OHLC → CoinGecko → null
// ============================================================

// CoinGecko asset ID map (fallback source)
const COINGECKO_ID_MAP: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
  DOT: "polkadot",
  ADA: "cardano",
  MATIC: "matic-network",
  POL: "matic-network",
  LINK: "chainlink",
  UNI: "uniswap",
  ATOM: "cosmos",
  TON: "the-open-network",
  AVAX: "avalanche-2",
  LTC: "litecoin",
  DOGE: "dogecoin",
  SHIB: "shiba-inu",
  NEAR: "near",
  APT: "aptos",
  SUI: "sui",
  OP: "optimism",
  ARB: "arbitrum",
  INJ: "injective-protocol",
  TIA: "celestia",
  SEI: "sei-network",
};

// Kraken native asset name prefixes (Kraken uses X/Z prefix for legacy pairs)
const KRAKEN_ASSET_PREFIXES: Record<string, string[]> = {
  BTC: ["XBT", "XXBT"],
  ETH: ["XETH", "ETH"],
  XRP: ["XXRP", "XRP"],
  LTC: ["XLTC", "LTC"],
};

// Cache: "ASSET:YYYY-MM-DD" → EUR price (null = tried and failed)
const cryptoPriceCache = new Map<string, number | null>();
// Kraken OHLC per-day cache: "k:ASSET:YYYY-MM-DD" → EUR close price (null = tried and failed)
const krakenOhlcCache = new Map<string, number | null>();
// Tracks which assets have had their full year OHLC bulk-fetched
const ohlcBulkFetchedAssets = new Set<string>();

/**
 * Fetch a Kraken API URL with automatic exponential-backoff retry on rate-limit errors.
 * Returns the parsed JSON body or null on unrecoverable failure.
 */
async function krakenFetchWithRetry(url: string, maxRetries = 3): Promise<any | null> {
  const retryDelays = [5000, 15000, 30000];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) return null;
      const body = await resp.json() as any;
      const isRateLimit = Array.isArray(body.error) &&
        body.error.some((e: unknown) => typeof e === "string" && e.includes("Rate limit"));
      if (isRateLimit) {
        if (attempt < maxRetries) {
          const delay = retryDelays[attempt] ?? 30000;
          console.warn(`[fisco/eur] Kraken rate limit (attempt ${attempt + 1}/${maxRetries + 1}). Waiting ${delay / 1000}s…`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.warn("[fisco/eur] Kraken rate limit exhausted — switching to CoinGecko fallback");
        return null;
      }
      return body;
    } catch { /* network/timeout — treated as a miss */ }
  }
  return null;
}

/**
 * Bulk-prefetch Kraken daily OHLC EUR prices for a set of crypto assets over a date range.
 * ONE API call per asset fills krakenOhlcCache for the full range, eliminating per-operation
 * Kraken calls during normalization (key rate-limit mitigation).
 *
 * Only EUR-quoted pairs are used in bulk mode (no per-candle USD→EUR conversion needed).
 * A 300 ms pause is inserted between assets to respect Kraken rate limits.
 */
export async function prefetchKrakenOhlcForAssets(assets: string[], from: Date, to: Date): Promise<void> {
  const unique = [...new Set(assets.map(a => a.toUpperCase()))];
  if (unique.length === 0) return;

  const sinceTs = Math.floor(from.getTime() / 1000);
  console.log(`[fisco/eur] Bulk OHLC prefetch: ${unique.length} assets from ${toDateStr(from)} to ${toDateStr(to)}`);

  for (const asset of unique) {
    if (ohlcBulkFetchedAssets.has(asset)) continue; // already done
    ohlcBulkFetchedAssets.add(asset);

    const names = KRAKEN_ASSET_PREFIXES[asset] ?? [asset];
    let fetched = false;

    outerLoop: for (const name of names) {
      for (const suffix of ["ZEUR", "EUR"]) { // EUR-quoted only for bulk
        const pair = `${name}${suffix}`;
        const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=1440&since=${sinceTs}`;
        const body = await krakenFetchWithRetry(url, 3);
        if (!body || (body.error?.length ?? 0) > 0) continue;

        const candles = (Object.entries(body.result as Record<string, any>)
          .find(([k]) => k !== "last")?.[1] as any[][] | undefined);
        if (!candles || candles.length === 0) continue;

        let cached = 0;
        for (const candle of candles) {
          const candleDate = toDateStr(new Date(candle[0] * 1000));
          const close = parseFloat(candle[4]);
          if (isNaN(close) || close <= 0) continue;
          const cacheKey = `k:${asset}:${candleDate}`;
          if (!krakenOhlcCache.has(cacheKey)) {
            krakenOhlcCache.set(cacheKey, close);
            cached++;
          }
        }
        console.log(`[fisco/eur] Kraken OHLC bulk ${pair}: ${cached} EUR prices cached (${candles.length} candles)`);
        fetched = true;
        break outerLoop;
      }
    }

    if (!fetched) {
      console.warn(`[fisco/eur] Kraken OHLC bulk prefetch failed for ${asset} — CoinGecko will be used as fallback`);
    }
    // Pause between assets to stay within Kraken rate limits
    await new Promise(r => setTimeout(r, 300));
  }
}

/**
 * Try Kraken public OHLC API for a daily close price in EUR.
 * Checks bulk cache first (populated by prefetchKrakenOhlcForAssets).
 * Falls back to individual API request with retry if not cached.
 * @internal Called by getCryptoEurPriceHistorical.
 */
async function tryKrakenOhlcEurPrice(asset: string, date: Date): Promise<number | null> {
  const assetUpper = asset.toUpperCase();
  const dateStr = toDateStr(date);
  const cacheKey = `k:${assetUpper}:${dateStr}`;

  // Check cache (may have been filled by bulk prefetch)
  if (krakenOhlcCache.has(cacheKey)) {
    const v = krakenOhlcCache.get(cacheKey) ?? null;
    return (v !== null && v > 0) ? v : null;
  }

  const names = KRAKEN_ASSET_PREFIXES[assetUpper] ?? [assetUpper];
  const since = Math.floor(date.getTime() / 1000) - 2 * 86400;

  for (const name of names) {
    for (const [suffix, isEur] of [["ZEUR", true], ["EUR", true], ["ZUSD", false], ["USD", false]] as [string, boolean][]) {
      const pair = `${name}${suffix}`;
      const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=1440&since=${since}`;
      const body = await krakenFetchWithRetry(url, 3);
      if (!body || (body.error?.length ?? 0) > 0) continue;

      const candles = (Object.entries(body.result as Record<string, any>)
        .find(([k]) => k !== "last")?.[1] as any[][] | undefined);
      if (!candles || candles.length === 0) continue;

      const dayCandle = candles.find((c) => toDateStr(new Date(c[0] * 1000)) === dateStr)
        ?? candles[candles.length - 1];
      const close = parseFloat(dayCandle[4]);
      if (isNaN(close) || close <= 0) continue;

      const eurPrice = isEur ? close : close * await getHistoricalUsdEurRate(date);
      krakenOhlcCache.set(cacheKey, eurPrice);
      console.log(`[fisco/eur] Kraken OHLC ${pair} on ${dateStr}: close=${close} → ${eurPrice.toFixed(4)} EUR`);
      return eurPrice;
    }
  }

  krakenOhlcCache.set(cacheKey, null); // mark as tried-and-failed
  return null;
}

/**
 * Fetch historical EUR price for a crypto asset on a specific date.
 *
 * Priority:
 *   1) Kraken OHLC daily close (authoritative for Kraken-origin operations)
 *   2) CoinGecko historical daily price (broad coverage)
 *   3) null → caller (normalizer) marks requiresEurPrice=true and blocks the report
 *
 * Cached per (asset, YYYY-MM-DD) to avoid redundant API calls.
 */
export async function getCryptoEurPriceHistorical(asset: string, date: Date): Promise<number | null> {
  const assetUpper = asset.toUpperCase();
  const dateStr = toDateStr(date);
  const cacheKey = `${assetUpper}:${dateStr}`;

  if (cryptoPriceCache.has(cacheKey)) return cryptoPriceCache.get(cacheKey)!;

  // Priority 1: Kraken OHLC
  const krakenPrice = await tryKrakenOhlcEurPrice(assetUpper, date);
  if (krakenPrice !== null) {
    cryptoPriceCache.set(cacheKey, krakenPrice);
    return krakenPrice;
  }

  // Priority 2: CoinGecko historical daily
  const cgId = COINGECKO_ID_MAP[assetUpper];
  if (cgId) {
    const [year, month, day] = dateStr.split("-");
    const cgDate = `${day}-${month}-${year}`;
    try {
      const url = `https://api.coingecko.com/api/v3/coins/${cgId}/history?date=${cgDate}&localization=false`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (resp.ok) {
        const data = await resp.json() as any;
        const price = data?.market_data?.current_price?.eur;
        if (typeof price === "number" && price > 0) {
          cryptoPriceCache.set(cacheKey, price);
          console.log(`[fisco/eur] CoinGecko ${assetUpper} on ${dateStr}: ${price.toFixed(4)} EUR`);
          return price;
        }
      }
    } catch (e: any) {
      console.warn(`[fisco/eur] CoinGecko failed for ${assetUpper} on ${dateStr}: ${e.message}`);
    }
  } else {
    console.warn(`[fisco/eur] No price source for "${assetUpper}" on ${dateStr} — will require manual EUR price`);
  }

  // Priority 3: null → normalizer marks requiresEurPrice=true
  cryptoPriceCache.set(cacheKey, null);
  return null;
}

/** Clear crypto EUR price caches. For testing only — do not call in production. */
export function _clearCryptoEurCacheForTest(): void {
  cryptoPriceCache.clear();
  krakenOhlcCache.clear();
  ohlcBulkFetchedAssets.clear();
}
