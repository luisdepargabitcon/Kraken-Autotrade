/**
 * Shared rebuild-mode flag for FISCO.
 *
 * While a rebuild is active, non-essential services (MarketData polling,
 * IDCA preloads, TrailingBuy scans) should check isFiscoRebuildActive()
 * before making Kraken API calls, to avoid competing with the rebuild's
 * OHLC prefetch and ledger pagination requests.
 *
 * Usage:
 *   import { isFiscoRebuildActive } from "../fisco/rebuild-state";
 *   if (isFiscoRebuildActive()) return; // skip non-critical Kraken call
 */

let rebuildActive = false;

export function setFiscoRebuildMode(active: boolean): void {
  rebuildActive = active;
  console.log(`[fisco/rebuild-state] Rebuild mode: ${active ? "ACTIVE — non-essential Kraken polling should pause" : "inactive"}`);
}

export function isFiscoRebuildActive(): boolean {
  return rebuildActive;
}
