import type { AmaEnvironment } from "./AmaContextualNav";

interface ReadyBlockerLike {
  ready: boolean;
}

export interface ReadinessChecksLike {
  schema: ReadyBlockerLike;
  database: ReadyBlockerLike;
  market: ReadyBlockerLike;
  hwm: ReadyBlockerLike;
  mandate: ReadyBlockerLike;
  policy: ReadyBlockerLike;
  budget: ReadyBlockerLike;
  reconciliation: ReadyBlockerLike;
  killSwitch: ReadyBlockerLike;
  gateway: ReadyBlockerLike;
  scheduler: ReadyBlockerLike;
  shadowScenario: { ready: boolean };
  shadowLive: { ready: boolean };
  realExecutionGate: ReadyBlockerLike;
}

export interface ContextualReadiness {
  label: string;
  readyCount: number;
  totalCount: number;
}

/**
 * Resuelve qué checks de preparación son relevantes según el entorno/subtipo
 * activo. Evita que, por ejemplo, `realExecutionGate` (relevante solo para
 * Real) cuente en la preparación mostrada mientras el usuario está en
 * Laboratorio u OFF, lo que antes producía cifras engañosas como "13/14"
 * en un entorno que en realidad estaba completamente listo para su propósito.
 */
export function getContextualReadiness(
  environment: AmaEnvironment,
  checks: ReadinessChecksLike | null | undefined,
  labSubtype?: "quick" | "replay" | "scenario" | "live",
): ContextualReadiness {
  if (!checks) return { label: "Preparación", readyCount: 0, totalCount: 0 };

  const infra = [checks.schema.ready, checks.database.ready, checks.market.ready];

  if (environment === "OFF") {
    return {
      label: "Preparación",
      readyCount: infra.filter(Boolean).length,
      totalCount: infra.length,
    };
  }

  if (environment === "LAB") {
    const base = [...infra, checks.hwm.ready];
    let extra: boolean[] = [];
    if (labSubtype === "scenario") extra = [checks.shadowScenario.ready];
    else if (labSubtype === "live") extra = [checks.shadowLive.ready, checks.market.ready];
    const items = [...base, ...extra];
    return {
      label: "Preparación Laboratorio",
      readyCount: items.filter(Boolean).length,
      totalCount: items.length,
    };
  }

  // REAL
  const items = [
    checks.schema.ready,
    checks.database.ready,
    checks.market.ready,
    checks.hwm.ready,
    checks.mandate.ready,
    checks.policy.ready,
    checks.budget.ready,
    checks.reconciliation.ready,
    checks.killSwitch.ready,
    checks.gateway.ready,
    checks.scheduler.ready,
    checks.realExecutionGate.ready,
  ];
  return {
    label: "Preparación Real",
    readyCount: items.filter(Boolean).length,
    totalCount: items.length,
  };
}
