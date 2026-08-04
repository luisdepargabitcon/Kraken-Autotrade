/**
 * gridPlanningBlockerMetadata.ts — REV-C12G
 *
 * Pure helper that resolves the blocking component, reasonCode and explanation
 * for the Grid planning gate. Used by the EXECUTION_MARKET_SNAPSHOT_UNAVAILABLE
 * event in gridIsolatedEngine.ts so the event metadata identifies the real
 * blocker instead of relying on a generic reason code.
 *
 * Priority (fail-closed, first match wins):
 *   1. REFERENCE_MARKET   — referenceMarket not verified
 *   2. PAIR_CONSTRAINTS   — pairConstraints not verified
 *   3. EXECUTION_CAPABILITY — executionCapability not verified
 *   4. EXECUTION_MARKET_SNAPSHOT — snapshot not verified
 *   5. CIRCUIT_BREAKER    — circuitBreakerOpen
 *   6. PUMP_GUARD         — pumpGuardActive
 *   7. PLANNING_GATE      — fallback
 *
 * PAIR_CONSTRAINTS precedes EXECUTION_CAPABILITY because an invalid capability
 * is often a direct consequence of invalid constraints.
 *
 * Contract:
 *   - reasonCode is always non-null.
 *   - blockerExplanation is always non-empty.
 *   - Never uses a positive explanation of a verified component as a blocker
 *     explanation.
 *   - No secrets or full objects are included.
 */

import type {
  GridReferenceMarketSnapshot,
  GridExecutionCapabilitySnapshot,
} from "./gridIsolatedTypes";
import type { RevolutXPairConstraints } from "../exchanges/RevolutXService";
import type { GridExecutionMarketSnapshot } from "./gridExecutionMarketSnapshot";

export type GridPlanningBlockerComponent =
  | "REFERENCE_MARKET"
  | "PAIR_CONSTRAINTS"
  | "EXECUTION_CAPABILITY"
  | "EXECUTION_MARKET_SNAPSHOT"
  | "CIRCUIT_BREAKER"
  | "PUMP_GUARD"
  | "PLANNING_GATE";

export interface GridPlanningBlockerMetadata {
  blockerComponent: GridPlanningBlockerComponent;
  reasonCode: string;
  blockerExplanation: string;
}

export interface ResolveGridPlanningBlockerMetadataInput {
  referenceMarket: GridReferenceMarketSnapshot | null;
  pairConstraints: RevolutXPairConstraints | null;
  executionCapability: GridExecutionCapabilitySnapshot | null;
  executionMarketSnapshot: GridExecutionMarketSnapshot | null;
  circuitBreakerOpen: boolean;
  circuitBreakerReason?: string | null;
  pumpGuardActive: boolean;
  pumpGuardReason?: string | null;
}

export function resolveGridPlanningBlockerMetadata(
  input: ResolveGridPlanningBlockerMetadataInput,
): GridPlanningBlockerMetadata {
  const {
    referenceMarket,
    pairConstraints,
    executionCapability,
    executionMarketSnapshot,
    circuitBreakerOpen,
    circuitBreakerReason,
    pumpGuardActive,
    pumpGuardReason,
  } = input;

  // 1. REFERENCE_MARKET — highest priority.
  if (!referenceMarket?.verifiedForPlanning) {
    return {
      blockerComponent: "REFERENCE_MARKET",
      reasonCode: referenceMarket?.reasonCode ?? "REFERENCE_MARKET_UNAVAILABLE",
      blockerExplanation:
        referenceMarket?.explanation ?? "Reference market no verificado para planificación Grid.",
    };
  }

  // 2. PAIR_CONSTRAINTS — precedes EXECUTION_CAPABILITY.
  if (!pairConstraints?.verified) {
    return {
      blockerComponent: "PAIR_CONSTRAINTS",
      reasonCode: pairConstraints?.reasonCode ?? "PAIR_CONSTRAINTS_UNAVAILABLE",
      blockerExplanation:
        "Las constraints Revolut X no están verificadas para el par. No se puede planificar hasta resolverlas.",
    };
  }

  // 3. EXECUTION_CAPABILITY.
  if (!executionCapability?.verified) {
    return {
      blockerComponent: "EXECUTION_CAPABILITY",
      reasonCode: executionCapability?.reasonCode ?? "EXECUTION_CAPABILITY_UNAVAILABLE",
      blockerExplanation:
        executionCapability?.explanation ?? "Execution capability no verificada.",
    };
  }

  // 4. EXECUTION_MARKET_SNAPSHOT.
  if (!executionMarketSnapshot?.verified) {
    return {
      blockerComponent: "EXECUTION_MARKET_SNAPSHOT",
      reasonCode: executionMarketSnapshot?.reasonCode ?? "EXECUTION_MARKET_SNAPSHOT_UNAVAILABLE",
      blockerExplanation:
        executionMarketSnapshot?.explanation ?? "Snapshot de mercado de ejecución no verificado.",
    };
  }

  // 5. CIRCUIT_BREAKER — precedes PUMP_GUARD.
  if (circuitBreakerOpen) {
    return {
      blockerComponent: "CIRCUIT_BREAKER",
      reasonCode: "CIRCUIT_BREAKER_OPEN",
      blockerExplanation: circuitBreakerReason ?? "Circuit breaker Grid activo.",
    };
  }

  // 6. PUMP_GUARD.
  if (pumpGuardActive) {
    return {
      blockerComponent: "PUMP_GUARD",
      reasonCode: "PUMP_GUARD_ACTIVE",
      blockerExplanation: pumpGuardReason ?? "Pump/Dump Guard activo.",
    };
  }

  // 7. Fallback — unclassified blocker.
  return {
    blockerComponent: "PLANNING_GATE",
    reasonCode: "PLANNING_GATE_BLOCKED",
    blockerExplanation:
      "El gate de planificación Grid está bloqueado por una condición no clasificada.",
  };
}
