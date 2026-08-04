/**
 * gridPlanningContextResolver.ts — REV-C12E
 *
 * The single canonical route for obtaining the Grid planning context.
 * Used by: tick normal, proposeRangeVersion, buildRangeProposal,
 * rebuild manual, recommendations B/C, preview/analysis SHADOW.
 *
 * Flow:
 *   1. getGridBandSnapshot()         — Kraken candles
 *   2. MarketDataService.getFreshTickerSnapshot() — Kraken ticker
 *   3. resolveGridReferenceMarketSnapshot()  — validate Kraken
 *   4. resolveGridPairConstraints()  — Revolut X constraints
 *   5. resolveGridExecutionCapability() — Revolut X execution readiness
 *   6. gridCapitalAllocator.allocate() — allocation
 *   7. resolveGridProfessionalProjectionContext() — final validation
 *
 * Does NOT call revolutXService.getTicker().
 */

import { MarketDataService } from "../MarketDataService";
import { revolutXService } from "../exchanges/RevolutXService";
import { getGridBandSnapshot, type GridBandSnapshot, type GridBandConfig } from "./gridBandAdapter";
import { resolveGridReferenceMarketSnapshot } from "./gridReferenceMarketResolver";
import { resolveGridExecutionCapability } from "./gridExecutionCapabilityResolver";
import { buildGridExecutionMarketSnapshot } from "./gridExecutionMarketSnapshot";
import type {
  GridReferenceMarketSnapshot,
  GridExecutionCapabilitySnapshot,
  GridPlanningGate,
} from "./gridIsolatedTypes";
import type { RevolutXPairConstraints } from "../exchanges/RevolutXService";

export interface GridPlanningContextInput {
  pair: string;
  bandConfig: GridBandConfig;
  executionPolicy: string;
  takerFallbackEnabled: boolean;
  tickerMaxAgeMs?: number;
}

export interface GridPlanningContextResult {
  bandSnapshot: GridBandSnapshot | null;
  referenceMarket: GridReferenceMarketSnapshot;
  pairConstraints: RevolutXPairConstraints;
  executionCapability: GridExecutionCapabilitySnapshot;
  gate: GridPlanningGate;
}

// ─── REV-C12E: Market + constraints resolution (shared by tick and rebuild) ──
export interface GridMarketAndConstraintsInput {
  pair: string;
  executionPolicy: string;
  takerFallbackEnabled: boolean;
  tickerMaxAgeMs?: number;
}

export interface GridMarketAndConstraintsResult {
  pairConstraints: RevolutXPairConstraints;
  referenceMarket: GridReferenceMarketSnapshot;
  executionCapability: GridExecutionCapabilitySnapshot;
  executionMarketSnapshot: ReturnType<typeof buildGridExecutionMarketSnapshot>;
}

function fallbackPairConstraints(pair: string): RevolutXPairConstraints {
  return {
    pair,
    normalizedPair: pair.replace("/", "-").toUpperCase(),
    executionVenue: "REVOLUT_X",
    baseCurrency: null,
    quoteCurrency: null,
    priceTickSize: null,
    quantityStep: null,
    minOrderBase: null,
    minOrderQuote: null,
    minOrderUsd: null,
    maxOrderBase: null,
    pricePrecision: null,
    quantityPrecision: null,
    status: null,
    region: null,
    source: null,
    fetchedAt: null,
    expiresAt: null,
    verified: false,
    reasonCode: "PAIR_CONSTRAINTS_UNAVAILABLE",
  };
}

/**
 * REV-C12E: Single shared implementation for resolving pair constraints
 * (Revolut X), the Kraken reference market ticker, the execution capability
 * snapshot, and the execution market snapshot used to gate range creation.
 *
 * Used identically by tick() and manual rebuild — no duplicated logic.
 * Does NOT call revolutXService.getTicker().
 */
export async function resolveGridMarketAndConstraints(
  input: GridMarketAndConstraintsInput,
): Promise<GridMarketAndConstraintsResult> {
  const now = new Date();

  // 1. Pair constraints (Revolut X). resolveGridPairConstraints never throws
  // in practice (all exceptions caught internally) — safety catch handles
  // the edge case of an invalid pair format string.
  let pairConstraints: RevolutXPairConstraints;
  try {
    pairConstraints = await revolutXService.resolveGridPairConstraints(input.pair);
  } catch {
    pairConstraints = fallbackPairConstraints(input.pair);
  }

  // 2. Fresh ticker snapshot (Kraken) — revolutXService.getTicker() is NOT called.
  const tickerSnapshot = await MarketDataService.getFreshTickerSnapshot(
    input.pair,
    input.tickerMaxAgeMs,
  );

  // 3. Reference market (validate Kraken)
  const referenceMarket = resolveGridReferenceMarketSnapshot(tickerSnapshot, input.pair, now);

  // 4. Execution capability (Revolut X: init + constraints + policy + taker fallback)
  const executionCapability = resolveGridExecutionCapability(
    pairConstraints,
    input.executionPolicy,
    input.takerFallbackEnabled,
    now,
  );

  // 5. Execution market snapshot — Kraken reference data + Revolut X constraints.
  const acquiredAt = new Date();
  const tickerForSnapshot = referenceMarket.verifiedForPlanning
    ? { bid: referenceMarket.bid, ask: referenceMarket.ask, last: referenceMarket.last }
    : null;
  const executionMarketSnapshot = buildGridExecutionMarketSnapshot({
    pair: input.pair,
    ticker: tickerForSnapshot,
    constraints: pairConstraints,
    source: referenceMarket.verifiedForPlanning ? "KRAKEN_MARKET_DATA" : "KRAKEN_MARKET_DATA_UNAVAILABLE",
    acquiredAt,
    timestamp: referenceMarket.verifiedForPlanning ? referenceMarket.timestamp : null,
  });

  return { pairConstraints, referenceMarket, executionCapability, executionMarketSnapshot };
}

/**
 * Resolve the full planning context for Grid.
 * Returns a typed result with the planning gate.
 * Never throws — all failures are captured in the gate blockers.
 *
 * REV-C12E: Delegates market/constraints resolution to
 * resolveGridMarketAndConstraints — the single shared implementation used
 * by tick() and manual rebuild in gridIsolatedEngine.ts. No duplicated logic.
 */
export async function resolveGridPlanningContext(
  input: GridPlanningContextInput,
): Promise<GridPlanningContextResult> {
  const now = new Date();
  const blockers: string[] = [];

  // 1. Band snapshot (Kraken)
  const bandSnapshot = await getGridBandSnapshot(input.bandConfig);
  if (!bandSnapshot) {
    blockers.push("BAND_SNAPSHOT_UNAVAILABLE");
  } else if (!bandSnapshot.suitableForGrid) {
    blockers.push("BAND_NOT_SUITABLE_FOR_GRID");
  }

  // 2-5. Market + constraints (shared implementation)
  const { pairConstraints, referenceMarket, executionCapability } =
    await resolveGridMarketAndConstraints({
      pair: input.pair,
      executionPolicy: input.executionPolicy,
      takerFallbackEnabled: input.takerFallbackEnabled,
      tickerMaxAgeMs: input.tickerMaxAgeMs,
    });

  if (!referenceMarket.verifiedForPlanning) {
    blockers.push(referenceMarket.reasonCode ?? "REFERENCE_MARKET_UNAVAILABLE");
  }
  if (!executionCapability.verified) {
    blockers.push(executionCapability.reasonCode ?? "EXECUTION_CAPABILITY_UNAVAILABLE");
  }

  // 6. Build gate
  // Note: allocation is resolved separately by the engine which has the
  // specific parameters (profile, levelsCount, netProfitTargetPct).
  const canPlanRange =
    bandSnapshot != null &&
    bandSnapshot.suitableForGrid &&
    referenceMarket.verifiedForPlanning;

  const canCreateRange =
    canPlanRange &&
    executionCapability.verified;

  const canSubmitMakerOrder =
    executionCapability.verified &&
    executionCapability.postOnlyRequired &&
    !executionCapability.takerFallbackAllowed;

  const gate: GridPlanningGate = {
    canPlanRange,
    canCreateRange,
    canSubmitMakerOrder,
    allowCycleExits: true,
    referenceMarket,
    executionCapability,
    blockers,
    evaluatedAt: now.toISOString(),
  };

  return {
    bandSnapshot,
    referenceMarket,
    pairConstraints,
    executionCapability,
    gate,
  };
}
