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
 *
 * REV-C12E correction: fail-closed on expiresAt=null, invalid expiresAt,
 * invalid priceTickSize, invalid quantityStep, pair mismatch.
 * Captures isInitialized() once and reuses the value.
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
  expectedPair?: string,
): GridExecutionCapabilitySnapshot {
  // REV-C12E: Capture isInitialized() once and reuse.
  const initialized = revolutXService.isInitialized();

  // Not initialized
  if (!initialized) {
    return invalidCapability(
      "REVOLUT_X_NOT_INITIALIZED",
      "Revolut X no está inicializado — no se pueden colocar órdenes.",
      constraints,
      initialized,
    );
  }

  // Constraints null
  if (!constraints) {
    return invalidCapability(
      "REVOLUT_X_CONSTRAINTS_UNAVAILABLE",
      "Las constraints del par en Revolut X no están disponibles.",
      constraints,
      initialized,
    );
  }

  // Constraints not verified
  if (!constraints.verified) {
    return invalidCapability(
      "REVOLUT_X_CONSTRAINTS_UNAVAILABLE",
      "Las constraints del par en Revolut X no están verificadas.",
      constraints,
      initialized,
    );
  }

  // Execution venue must be REVOLUT_X
  if (constraints.executionVenue !== "REVOLUT_X") {
    return invalidCapability(
      "REVOLUT_X_CONSTRAINTS_UNAVAILABLE",
      "El venue de ejecución de las constraints no es REVOLUT_X.",
      constraints,
      initialized,
    );
  }

  // REV-C12E: Pair mismatch — normalizedPair must match expectedPair
  if (expectedPair) {
    const expectedNormalized = expectedPair.replace("/", "-").toUpperCase();
    if (constraints.normalizedPair !== expectedNormalized) {
      return invalidCapability(
        "REVOLUT_X_CONSTRAINTS_PAIR_MISMATCH",
        `El par de las constraints (${constraints.normalizedPair}) no coincide con el par esperado (${expectedNormalized}).`,
        constraints,
        initialized,
      );
    }
  }

  // REV-C12E: expiresAt null → NOT fresh, block.
  if (constraints.expiresAt == null) {
    return invalidCapability(
      "REVOLUT_X_CONSTRAINTS_STALE",
      "Las constraints del par en Revolut X no tienen fecha de expiración — se consideran caducadas.",
      constraints,
      initialized,
    );
  }

  // REV-C12E: expiresAt invalid → NOT fresh, block.
  const expiresAtMs = constraints.expiresAt.getTime();
  if (!Number.isFinite(expiresAtMs)) {
    return invalidCapability(
      "REVOLUT_X_CONSTRAINTS_STALE",
      "La fecha de expiración de las constraints de Revolut X no es válida.",
      constraints,
      initialized,
    );
  }

  // REV-C12E: expiresAt must be in the future
  if (expiresAtMs <= now.getTime()) {
    return invalidCapability(
      "REVOLUT_X_CONSTRAINTS_STALE",
      "Las constraints del par en Revolut X están caducadas.",
      constraints,
      initialized,
    );
  }

  // REV-C12E: priceTickSize must be finite and > 0
  if (!Number.isFinite(constraints.priceTickSize) || constraints.priceTickSize == null || constraints.priceTickSize <= 0) {
    return invalidCapability(
      "REVOLUT_X_PRICE_TICK_INVALID",
      "El priceTickSize de las constraints de Revolut X no es válido.",
      constraints,
      initialized,
    );
  }

  // REV-C12E: quantityStep must be finite and > 0
  if (!Number.isFinite(constraints.quantityStep) || constraints.quantityStep == null || constraints.quantityStep <= 0) {
    return invalidCapability(
      "REVOLUT_X_QUANTITY_STEP_INVALID",
      "El quantityStep de las constraints de Revolut X no es válido.",
      constraints,
      initialized,
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
        initialized,
      );
    }
    return invalidCapability(
      "POST_ONLY_NOT_ENFORCED",
      `Política de ejecución ${executionPolicy} no enforce post_only — se requiere MAKER_ONLY.`,
      constraints,
      initialized,
    );
  }

  // Taker fallback must be disabled
  if (takerFallbackEnabled) {
    return invalidCapability(
      "TAKER_FALLBACK_NOT_DISABLED",
      "El fallback taker está habilitado — debe estar desactivado para el Grid.",
      constraints,
      initialized,
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
  initialized?: boolean,
): GridExecutionCapabilitySnapshot {
  return {
    executionVenue: "REVOLUT_X",
    // REV-C12E: Reuse captured initialized value — do NOT call isInitialized() again.
    initialized: initialized ?? false,
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
