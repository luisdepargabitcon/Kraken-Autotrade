/**
 * EUR conversion rates for FISCO module.
 * Uses ECB daily reference rates API (free, no key).
 * Falls back to hardcoded rates if API unavailable.
 */

const FALLBACK_RATES: Record<string, number> = {
  USD: 0.92,   // 1 USD = 0.92 EUR (approx Feb 2026)
  EUR: 1.0,
  USDC: 0.92,
  USDT: 0.92,
};

let cachedUsdEur: number | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Fetch USD/EUR rate from ECB or use cache/fallback
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
      const text = await resp.text();
      const lines = text.trim().split("\n");
      // CSV: last line contains the rate in the OBS_VALUE column
      if (lines.length >= 2) {
        const header = lines[0].split(",");
        const obsIdx = header.indexOf("OBS_VALUE");
        if (obsIdx >= 0) {
          const lastLine = lines[lines.length - 1].split(",");
          const rate = parseFloat(lastLine[obsIdx]);
          if (!isNaN(rate) && rate > 0) {
            // ECB gives EUR per 1 USD (inverse: how many EUR for 1 USD)
            // Actually ECB EXR gives: 1 EUR = X USD, so USD→EUR = 1/X
            cachedUsdEur = 1 / rate;
            cacheTimestamp = Date.now();
            console.log(`[fisco/eur] ECB rate fetched: 1 USD = ${cachedUsdEur.toFixed(6)} EUR`);
            return cachedUsdEur;
          }
        }
      }
    }
  } catch (e: any) {
    console.warn(`[fisco/eur] ECB API failed, using fallback: ${e.message}`);
  }

  return FALLBACK_RATES.USD;
}

/**
 * Convert an amount from a quote currency to EUR.
 */
export async function toEur(amount: number, currency: string): Promise<number> {
  const cur = currency.toUpperCase();
  if (cur === "EUR") return amount;
  if (cur === "USD" || cur === "USDC" || cur === "USDT") {
    const rate = await getUsdToEurRate();
    return amount * rate;
  }
  // Unknown currency — return as-is with warning
  console.warn(`[fisco/eur] Unknown currency for EUR conversion: ${currency}`);
  return amount;
}

/**
 * Get the current USD→EUR rate (cached or fallback)
 */
export function getCachedUsdEurRate(): number {
  return cachedUsdEur || FALLBACK_RATES.USD;
}
