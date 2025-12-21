/**
 * Confidence normalization utilities
 * 
 * Convention:
 * - Internal (signals/positions): 0..1 scale
 * - Display (UI/Telegram/logs) and ML features: 0..100 scale
 */

/**
 * Convert any confidence value to percentage (0..100)
 * Accepts both 0..1 and 0..100 inputs
 */
export function toConfidencePct(value: unknown, fallback = 50): number {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  const pct = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Convert any confidence value to unit (0..1)
 * Accepts both 0..1 and 0..100 inputs
 */
export function toConfidenceUnit(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  const unit = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, unit));
}
