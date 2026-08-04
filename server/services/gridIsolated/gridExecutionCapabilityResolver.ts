/**
 * gridExecutionCapabilityResolver.ts — REV-C12E
 *
 * Resolves the Revolut X execution capability snapshot for Grid.
 * Derives exclusively from:
 *   - revolutXService.isInitialized()
 *   - resolveGridPairConstraints()
 *   - executionPolicy === MAKER_ONLY
 *   - taker fallback disabled
 *
 * Does NOT call revolutXService.getTicker().
 * Separates execution readiness (Revolut X) from reference market (Kraken).
 */

import { revolutXService } from "../exchanges/RevolutXService";
import type {
  GridExecutionCapabilitySnapshot,
  GridExecutionCapabilityReasonCode,
} from "./gridIsolatedTypes";
import type { RevolutXPairConstraints } from "../exchanges/RevolutXService";

export function resolveGridExecutionCapability(
  constraints: RevolutXPairConstraints | null,
  executionPolicy: string,
  takerFallbackEnabled: boolean,
  now: Date,
): GridExecutionCapabilitySnapshot {
  const initialized = revolutXService.isInitialized();

  // Not initialized
  if (!initialized) {
    return invalidCapability(
      "REVOLUT_X_NOT_INITIALIZED",
      "Revolut X no está inicializado — no se pueden colocar órdenes.",
    );
  }

  // Constraints not verified
  if (!constraints || !constraints.verified) {
    return invalidCapability(
      "REVOLUT_X_CONSTRAINTS_UNAVAILABLE",
      "Las constraints del par en Revolut X no están verificadas.",
      constraints,
    );
  }

  // Constraints stale
  const constraintsFresh = constraints.expiresAt == null || constraints.expiresAt.getTime() > now.getTime();
  if (!constraintsFresh) {
    return invalidCapability(
      "REVOLUT_X_CONSTRAINTS_STALE",
      "Las constraints del par en Revolut X están caducadas.",
      constraints,
    );
  }

  // Execution policy must be MAKER_ONLY
  if (executionPolicy !== "MAKER_ONLY") {
    // Legacy taker policies are blocked
    if (
      executionPolicy === "MAKER_FIRST_THEN_LIMIT_TAKER_FALLBACK" ||
      executionPolicy === "MAKER_3_ATTEMPTS_THEN_TAKER_FALLBACK"
    ) {
      return invalidCapability(
        "LEGACY_TAKER_POLICY_BLOCKED",
        `Política legacy ${executionPolicy} bloqueada — solo MAKER_ONLY está permitido.`,
        constraints,
      );
    }
    return invalidCapability(
      "POST_ONLY_NOT_ENFORCED",
      `Política de ejecución ${executionPolicy} no enforce post_only — se requiere MAKER_ONLY.`,
      constraints,
    );
  }

  // Taker fallback must be disabled
  if (takerFallbackEnabled) {
    return invalidCapability(
      "TAKER_FALLBACK_NOT_DISABLED",
      "El fallback taker está habilitado — debe estar desactivado para el Grid.",
      constraints,
    );
  }

  // All checks passed
  return {
    executionVenue: "REVOLUT_X",
    initialized: true,
    pairConstraintsVerified: true,
    pairConstraintsFresh: true,
    priceTickSize: constraints.priceTickSize,
    quantityStep: constraints.quantityStep,
    minOrderBase: constraints.minOrderBase,
    minOrderQuote: constraints.minOrderQuote,
    minOrderUsd: constraints.minOrderUsd,
    postOnlyRequired: true,
    takerFallbackAllowed: false,
    verified: true,
    reasonCode: null,
    explanation: "Capacidad de ejecución Revolut X verificada: MAKER_ONLY, post_only, taker fallback desactivado.",
  };
}

function invalidCapability(
  reasonCode: GridExecutionCapabilityReasonCode,
  explanation: string,
  constraints?: RevolutXPairConstraints | null,
): GridExecutionCapabilitySnapshot {
  return {
    executionVenue: "REVOLUT_X",
    initialized: revolutXService.isInitialized(),
    pairConstraintsVerified: constraints?.verified ?? false,
    pairConstraintsFresh: false,
    priceTickSize: constraints?.priceTickSize ?? null,
    quantityStep: constraints?.quantityStep ?? null,
    minOrderBase: constraints?.minOrderBase ?? null,
    minOrderQuote: constraints?.minOrderQuote ?? null,
    minOrderUsd: constraints?.minOrderUsd ?? null,
    postOnlyRequired: true,
    takerFallbackAllowed: false,
    verified: false,
    reasonCode,
    explanation,
  };
}
