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
