/**
 * gridPlanningContextResolver.ts — REV-C12E
 *
 * The single canonical orchestrator for obtaining the complete Grid planning
 * context. Used by: tick normal, rebuild automatic, rebuild manual,
 * proposeRangeVersion, buildRangeProposal, recommendations B/C,
 * SHADOW analysis, preview, and apply when it recalculates.
 *
 * The orchestrator resolves exactly once:
 *   1. Band snapshot (Kraken candles) — or accepts a pre-resolved one from tick
 *   2. MarketDataService.getFreshTickerSnapshot() — Kraken ticker (one call)
 *   3. resolveGridReferenceMarketSnapshot() — validate Kraken reference market
 *   4. revolutXService.resolveGridPairConstraints() — Revolut X constraints (one call)
 *   5. resolveGridExecutionCapability() — Revolut X execution readiness
 *   6. buildGridExecutionMarketSnapshot() — execution market snapshot
 *   7. gridCapitalAllocator.allocate() — allocation (one call, only when allowed)
 *   8. splitSymmetricLevels() — symmetric split
 *   9. resolveGridProfessionalProjectionContext() — projection context (one call)
 *  10. computeGateTtl() — TTL (one call)
 *  11. Build final gate with blockers
 *
 * Functions receiving this context must NOT call again:
 *   getFreshTickerSnapshot, resolveGridPairConstraints,
 *   gridCapitalAllocator.allocate, resolveGridProfessionalProjectionContext.
 *
 * Does NOT call revolutXService.getTicker().
 */

import { MarketDataService } from "../MarketDataService";
import { revolutXService } from "../exchanges/RevolutXService";
import { getGridBandSnapshot, type GridBandSnapshot, type GridBandConfig } from "./gridBandAdapter";
import { resolveGridReferenceMarketSnapshot } from "./gridReferenceMarketResolver";
import { resolveGridExecutionCapability } from "./gridExecutionCapabilityResolver";
import { buildGridExecutionMarketSnapshot, type GridExecutionMarketSnapshot } from "./gridExecutionMarketSnapshot";
import { computeGateTtl, type GateTtlResult } from "./gridExecutionGateTtl";
import { resolveGridProfessionalProjectionContext, splitSymmetricLevels, type ProjectionContextResult } from "./gridProfessionalProjectionContext";
import { gridCapitalAllocator, type CapitalAllocationResult } from "./gridCapitalAllocator";
import type {
  GridReferenceMarketSnapshot,
  GridExecutionCapabilitySnapshot,
  GridPlanningGate,
} from "./gridIsolatedTypes";
import type { MarketTickerSnapshot } from "../MarketDataService";
import type { RevolutXPairConstraints } from "../exchanges/RevolutXService";

// ─── Allocation input ─────────────────────────────────────────────
export interface GridAllocationInput {
  capitalProfile: string;
  netProfitTargetPct: number;
  maxCapitalPerCycleUsd: number;
  allocationMode: string;
  deploymentMode: string;
  progressiveIntensity: number;
  maxLevelPct: number;
  minLevelUsd: number;
}

export interface GridPlanningContextInput {
  pair: string;
  bandConfig: GridBandConfig;
  executionPolicy: string;
  takerFallbackEnabled: boolean;
  tickerMaxAgeMs?: number;
  // Allocation parameters — when provided, orchestrator resolves allocation once.
  allocationInput?: GridAllocationInput;
  // Config for projection context — the full config object.
  config?: any;
  // Optional pre-resolved band snapshot (from tick to avoid duplicate candle fetches).
  preResolvedBandSnapshot?: GridBandSnapshot | null;
}

export interface GridPlanningContextResult {
  // Band snapshot (Kraken candles)
  bandSnapshot: GridBandSnapshot | null;
  // Kraken ticker snapshot (raw)
  tickerSnapshot: MarketTickerSnapshot | null;
  // Reference market (validated Kraken)
  referenceMarket: GridReferenceMarketSnapshot;
  // Revolut X pair constraints
  pairConstraints: RevolutXPairConstraints;
  // Revolut X execution capability
  executionCapability: GridExecutionCapabilitySnapshot;
  // Execution market snapshot (Kraken data + Revolut X constraints)
  executionMarketSnapshot: GridExecutionMarketSnapshot;
  // Allocation (null when not allowed or allocationInput not provided)
  allocation: CapitalAllocationResult | null;
  // Symmetric split (null when allocation is null or split fails)
  symmetricSplit: { ok: boolean; buyLevels?: number; sellLevels?: number } | null;
  // Projection context result (null when allocation is null or projection fails)
  projectionContextResult: ProjectionContextResult | null;
  // TTL
  ttl: GateTtlResult;
  // Planning gate
  gate: GridPlanningGate;
  // Blockers
  blockers: string[];
  // Evaluation instant
  evaluatedAt: Date;
  // Valid until (from TTL)
  validUntil: Date | null;
}

// ─── REV-C12E: Market + constraints resolution (shared sub-orchestrator) ──
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
  executionMarketSnapshot: GridExecutionMarketSnapshot;
  tickerSnapshot: MarketTickerSnapshot | null;
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
 * REV-C12E: Shared sub-orchestrator for resolving pair constraints (Revolut X),
 * the Kraken reference market ticker, the execution capability snapshot, and
 * the execution market snapshot.
 *
 * Used internally by resolveGridPlanningContext. Can also be called directly
 * when only market+constraints are needed (without allocation/projection).
 * Does NOT call revolutXService.getTicker().
 */
export async function resolveGridMarketAndConstraints(
  input: GridMarketAndConstraintsInput,
): Promise<GridMarketAndConstraintsResult> {
  const now = new Date();

  // 1. Pair constraints (Revolut X).
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
    input.pair,
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
    marketDataVenue: "KRAKEN",
    fetchedAt: referenceMarket.verifiedForPlanning ? referenceMarket.fetchedAt : acquiredAt,
    maxAgeMs: referenceMarket.verifiedForPlanning ? referenceMarket.maxAgeMs : 45_000,
    timestamp: referenceMarket.verifiedForPlanning ? referenceMarket.timestamp : null,
    acquiredAt,
  });

  return { pairConstraints, referenceMarket, executionCapability, executionMarketSnapshot, tickerSnapshot };
}

/**
 * REV-C12E: The single canonical orchestrator for the complete Grid planning
 * context. Resolves band, market, constraints, capability, execution snapshot,
 * allocation, split, projection context, TTL, and gate — all exactly once.
 *
 * Never throws — all failures are captured in the gate blockers.
 */
export async function resolveGridPlanningContext(
  input: GridPlanningContextInput,
): Promise<GridPlanningContextResult> {
  const evaluatedAt = new Date();
  const blockers: string[] = [];

  // 1. Band snapshot (Kraken) — use pre-resolved if provided (avoid duplicate candle fetches)
  const bandSnapshot = input.preResolvedBandSnapshot ?? await getGridBandSnapshot(input.bandConfig);
  if (!bandSnapshot) {
    blockers.push("BAND_SNAPSHOT_UNAVAILABLE");
  } else if (!bandSnapshot.suitableForGrid) {
    blockers.push("BAND_NOT_SUITABLE_FOR_GRID");
  }

  // 2-6. Market + constraints + capability + execution snapshot (shared sub-orchestrator)
  const { pairConstraints, referenceMarket, executionCapability, executionMarketSnapshot, tickerSnapshot } =
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

  // REV-C12E: Separate market+capability readiness from full canCreateRange.
  // canPlanRange only requires band + reference market.
  // canCreateRange requires market+capability AND allocation+split+projection+TTL.
  const marketAndCapabilityReady =
    bandSnapshot != null &&
    bandSnapshot.suitableForGrid &&
    referenceMarket.verifiedForPlanning &&
    executionCapability.verified;

  const canPlanRange =
    bandSnapshot != null &&
    bandSnapshot.suitableForGrid &&
    referenceMarket.verifiedForPlanning;

  // 7. Allocation — resolve only once, only when marketAndCapabilityReady
  let allocation: CapitalAllocationResult | null = null;
  if (marketAndCapabilityReady) {
    if (!input.allocationInput) {
      blockers.push("ALLOCATION_INPUT_MISSING");
    } else {
      try {
        allocation = await gridCapitalAllocator.allocate(
          input.allocationInput.capitalProfile as any,
          10,
          input.allocationInput.netProfitTargetPct,
          {
            maxCapitalPerCycleUsd: input.allocationInput.maxCapitalPerCycleUsd,
            allocationMode: input.allocationInput.allocationMode as any,
            deploymentMode: input.allocationInput.deploymentMode as any,
            progressiveIntensity: input.allocationInput.progressiveIntensity,
            maxLevelPct: input.allocationInput.maxLevelPct,
            minLevelUsd: input.allocationInput.minLevelUsd,
          },
        );
      } catch {
        allocation = null;
        blockers.push("ALLOCATION_FAILED");
      }
    }
  }

  // 8. Symmetric split
  let symmetricSplit: { ok: boolean; buyLevels?: number; sellLevels?: number } | null = null;
  if (allocation) {
    const split = splitSymmetricLevels(allocation.levelsCount);
    symmetricSplit = split;
    if (!split.ok) {
      blockers.push("SYMMETRIC_SPLIT_FAILED");
    }
  }

  // 9. Projection context — resolve only once, only when allocation and split are valid
  let projectionContextResult: ProjectionContextResult | null = null;
  if (allocation && symmetricSplit?.ok && bandSnapshot && input.config) {
    projectionContextResult = resolveGridProfessionalProjectionContext({
      currentPrice: bandSnapshot.midPrice,
      bollingerMiddle: bandSnapshot.middle,
      bollingerUpper: bandSnapshot.upper,
      bollingerLower: bandSnapshot.lower,
      atrPct: bandSnapshot.atrPct,
      config: input.config,
      configuredBuyLevels: symmetricSplit.buyLevels!,
      configuredSellLevels: symmetricSplit.sellLevels!,
      allocation,
      executionMarketSnapshot,
      pairConstraints,
      regimeLabel: bandSnapshot.regime ?? "",
      marketSuitable: bandSnapshot.suitableForGrid ?? false,
    });
    if (!projectionContextResult.ok) {
      blockers.push(projectionContextResult.reasonCode);
    }
  }

  // 10. TTL — compute once
  const ttl = computeGateTtl(executionMarketSnapshot, pairConstraints, evaluatedAt);
  if (!ttl.fresh) {
    blockers.push(ttl.staleReason ?? "TTL_STALE");
  }
  if (!ttl.validUntil) {
    blockers.push("TTL_VALID_UNTIL_MISSING");
  }

  // 11. Build gate — canCreateRange requires ALL conditions
  const canSubmitMakerOrder =
    executionCapability.verified &&
    executionCapability.postOnlyRequired &&
    !executionCapability.takerFallbackAllowed;

  // REV-C12E: canCreateRange is fail-closed — requires market+capability+
  // allocation+split+projection+TTL+no blockers.
  const canCreateRange =
    marketAndCapabilityReady &&
    allocation !== null &&
    symmetricSplit?.ok === true &&
    projectionContextResult?.ok === true &&
    ttl.fresh === true &&
    ttl.validUntil !== null &&
    blockers.length === 0;

  const gate: GridPlanningGate = {
    canPlanRange,
    canCreateRange,
    canSubmitMakerOrder,
    allowCycleExits: true,
    referenceMarket,
    executionCapability,
    blockers,
    evaluatedAt: evaluatedAt.toISOString(),
  };

  return {
    bandSnapshot,
    tickerSnapshot,
    referenceMarket,
    pairConstraints,
    executionCapability,
    executionMarketSnapshot,
    allocation,
    symmetricSplit,
    projectionContextResult,
    ttl,
    gate,
    blockers,
    evaluatedAt,
    validUntil: ttl.validUntil,
  };
}
