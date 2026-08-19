/**
 * spotContextSnapshotStore — In-memory store of the LAST productive scan snapshots.
 *
 * The SpotEngine publishes snapshots HERE during its real scan cycle.
 * GET /api/spot/context ONLY reads from this store — it never recalculates.
 *
 * Snapshots include the real decision, real gates, real reason from the pipeline.
 * Disabled pairs retain their last snapshot (marked stale) and remain visible.
 */

import { DEFAULT_ACTIVE_PAIRS, normalizePair } from "../pairAllowlist";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DecisionState =
  | "WAITING"
  | "BLOCKED"
  | "CANDIDATE"
  | "APPROVED"
  | "DISABLED";

export interface SpotDecisionGate {
  level: string;
  pass: boolean;
  reason: string;
  reasonCode?: string;
}

export interface SpotContextSnapshot {
  pair: string;
  scanId: string;
  generatedAt: number;
  enabled: boolean;

  // Decision
  decisionState: DecisionState;
  primaryReasonCode: string;
  primaryReasonEs: string;
  secondaryReasonsEs: string[];
  lastReachedStage: string;

  // Market context (from the real scan ctx)
  dataHealth: string;
  macro4h: string;
  regime1h: string;
  setup15m: string | null;
  timing5m: string | null;
  spread: number;
  gates: SpotDecisionGate[];

  // Extended market data
  macroBias: string;
  regime: string;
  direction: string;
  volatility: string;
  adx: number;
  ema20: number;
  ema50: number;
  ema200: number;
  emaAlignment: string;
  bollingerWidth: number;
  atrPct: number;
  confidence: number;
  price: number;
  bid: number;
  ask: number;
  spreadPct: number;
  volumeRatio: number;
  volume24h: number;
  participation: string;

  // Signal
  signal: "BUY" | "NONE";
  setupTag: string | null;
  signalReason: string;
  signalConfidence: number;
  blockReason: string | null;

  // Decision explanation (natural language Spanish)
  decisionTitle: string;
  decisionExplanation: string;
  decisionColor: "green" | "red" | "amber" | "violet" | "cyan" | "gray";

  // Active intent
  hasActiveIntent: boolean;
  intentState: string | null;
  intentLastBlockReason: string | null;
  intentCreatedAt: number | null;
  intentExpiresAt: number | null;

  // Context IDs for traceability
  marketContextId: string;
  regimeId: string;

  // Mode when snapshot was taken
  mode: string;
}

// ─── Store ──────────────────────────────────────────────────────────────────

const store = new Map<string, SpotContextSnapshot>();

/**
 * Publish a snapshot from the real scan pipeline.
 * Called by scanPair AFTER all real evaluations are done.
 */
export function publishSnapshot(snapshot: SpotContextSnapshot): void {
  store.set(normalizePair(snapshot.pair), snapshot);
}

/**
 * Get a snapshot for a single pair. Read-only.
 * Returns null if no snapshot has been published yet.
 */
export function getSnapshot(pair: string): SpotContextSnapshot | null {
  return store.get(normalizePair(pair)) ?? null;
}

/**
 * Get all snapshots. Includes ALL known pairs:
 *   - Pairs with published snapshots (fresh or stale)
 *   - Pairs without snapshots (placeholder with DISABLED or no-data state)
 *   - Disabled pairs (retain last snapshot, marked enabled=false)
 *
 * @param enabledPairs — the current enabled pairs set from bot_config
 */
export function getAllSnapshots(enabledPairs: Set<string>): SpotContextSnapshot[] {
  const allKnownPairs = new Set<string>([...DEFAULT_ACTIVE_PAIRS, ...store.keys()]);
  const result: SpotContextSnapshot[] = [];

  for (const pair of allKnownPairs) {
    const normalized = normalizePair(pair);
    const enabled = enabledPairs.has(normalized);
    const existing = store.get(normalized);

    if (existing) {
      // Update enabled flag and decisionState to reflect current state
      if (enabled) {
        result.push({ ...existing, enabled });
      } else {
        result.push({ ...existing, enabled, decisionState: "DISABLED" as DecisionState, decisionColor: "gray" });
      }
    } else {
      // No snapshot yet — create placeholder
      result.push(createPlaceholderSnapshot(normalized, enabled));
    }
  }

  return result.sort((a, b) => a.pair.localeCompare(b.pair));
}

/**
 * Clear the store (for testing).
 */
export function clearSnapshotStoreForTest(): void {
  store.clear();
}

/**
 * Get all known pairs from the store (for testing).
 */
export function _getStoreKeysForTest(): string[] {
  return Array.from(store.keys());
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function createPlaceholderSnapshot(pair: string, enabled: boolean): SpotContextSnapshot {
  return {
    pair,
    scanId: "",
    generatedAt: 0,
    enabled,
    decisionState: enabled ? "WAITING" : "DISABLED",
    primaryReasonCode: enabled ? "NO_SCAN_YET" : "PAIR_DISABLED",
    primaryReasonEs: enabled
      ? "Aún no se ha realizado ningún análisis de mercado para este par."
      : "Desactivado para nuevas entradas.",
    secondaryReasonsEs: [],
    lastReachedStage: "NONE",
    dataHealth: "UNKNOWN",
    macro4h: "UNKNOWN",
    regime1h: "UNKNOWN",
    setup15m: null,
    timing5m: null,
    spread: 0,
    gates: [],
    macroBias: "UNKNOWN",
    regime: "UNKNOWN",
    direction: "UNKNOWN",
    volatility: "UNKNOWN",
    adx: 0,
    ema20: 0,
    ema50: 0,
    ema200: 0,
    emaAlignment: "unknown",
    bollingerWidth: 0,
    atrPct: 0,
    confidence: 0,
    price: 0,
    bid: 0,
    ask: 0,
    spreadPct: 0,
    volumeRatio: 0,
    volume24h: 0,
    participation: "UNKNOWN",
    signal: "NONE",
    setupTag: null,
    signalReason: "",
    signalConfidence: 0,
    blockReason: null,
    decisionTitle: enabled ? "Sin análisis" : "Desactivado",
    decisionExplanation: enabled
      ? "Este par aún no ha sido analizado por el motor. El primer análisis aparecerá aquí automáticamente."
      : "Este par está desactivado para nuevas entradas. Las posiciones existentes continúan bajo supervisión.",
    decisionColor: "gray",
    hasActiveIntent: false,
    intentState: null,
    intentLastBlockReason: null,
    intentCreatedAt: null,
    intentExpiresAt: null,
    marketContextId: "",
    regimeId: "",
    mode: "UNKNOWN",
  };
}
