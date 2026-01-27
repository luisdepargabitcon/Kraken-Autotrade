export const DEFAULT_ACTIVE_PAIRS = [
  "BTC/USD",
  "ETH/USD",
  "SOL/USD",
  "XRP/USD",
  "TON/USD",
] as const;

export function normalizePair(pair: string): string {
  return pair.trim().replace(/-/g, "/");
}

export function getActivePairsAllowlist(activePairs: unknown): Set<string> {
  const pairsRaw = Array.isArray(activePairs) ? activePairs : [];
  const pairs = pairsRaw
    .map((p) => (typeof p === "string" ? normalizePair(p) : ""))
    .filter((p): p is string => Boolean(p));

  if (pairs.length === 0) return new Set(DEFAULT_ACTIVE_PAIRS);
  return new Set(pairs);
}

export function isPairAllowed(pair: string, allowlist: Set<string>): boolean {
  return allowlist.has(normalizePair(pair));
}
