import type { IdcaMode } from "./IdcaTypes";

export type IdcaEntryPolicyVersion = "legacy" | "v2_candidate";
export type IdcaReboundVariant =
  | "legacy"
  | "a1a_wick_geometry"
  | "a1b_slowing_real_fall"
  | "a1c_combined";

export type IdcaConfluenceEnforcement = "diagnostic" | "enforced";

export interface IdcaEntryPolicyResolution {
  version: IdcaEntryPolicyVersion;
  reboundVariant: IdcaReboundVariant;
  confluenceEnforcement: IdcaConfluenceEnforcement;
}

type PolicyMode = IdcaMode | "shadow" | "replay";
type WarningSink = (message: string) => void;

const VALID_VERSIONS = new Set<IdcaEntryPolicyVersion>(["legacy", "v2_candidate"]);
const VALID_ENFORCEMENTS = new Set<IdcaConfluenceEnforcement>(["diagnostic", "enforced"]);
const VALID_VARIANTS = new Set<IdcaReboundVariant>([
  "legacy",
  "a1a_wick_geometry",
  "a1b_slowing_real_fall",
  "a1c_combined",
]);
const EXPERIMENTAL_MODES = new Set<PolicyMode>(["simulation", "shadow", "replay"]);

function readEntryPolicy(config: unknown): Record<string, unknown> | null {
  if (!config || typeof config !== "object") return null;
  const entryUiJson = (config as { entryUiJson?: unknown }).entryUiJson;
  if (!entryUiJson || typeof entryUiJson !== "object") return null;
  const entryPolicy = (entryUiJson as { entryPolicy?: unknown }).entryPolicy;
  if (!entryPolicy || typeof entryPolicy !== "object") return null;
  return entryPolicy as Record<string, unknown>;
}

function warnDefault(message: string): void {
  console.warn(`[IDCA_ENTRY_POLICY] ${message}`);
}

/**
 * Resuelve la política experimental de entrada IDCA desde entryUiJson.entryPolicy.
 *
 * El comportamiento productivo es legacy por defecto. Las variantes candidatas
 * solo se respetan en simulation o en harnesses shadow/replay; live, disabled y
 * cualquier modo desconocido fuerzan legacy.
 */
export function resolveIdcaEntryPolicy(
  config: unknown,
  mode: PolicyMode,
  onWarning: WarningSink = warnDefault,
): IdcaEntryPolicyResolution {
  const raw = readEntryPolicy(config);
  const rawVersion = raw?.version;
  const rawVariant = raw?.reboundVariant;
  const rawEnforcement = raw?.confluenceEnforcement;

  const requestedVersion = VALID_VERSIONS.has(rawVersion as IdcaEntryPolicyVersion)
    ? rawVersion as IdcaEntryPolicyVersion
    : "legacy";
  const requestedVariant = VALID_VARIANTS.has(rawVariant as IdcaReboundVariant)
    ? rawVariant as IdcaReboundVariant
    : "legacy";
  const requestedEnforcement = VALID_ENFORCEMENTS.has(rawEnforcement as IdcaConfluenceEnforcement)
    ? rawEnforcement as IdcaConfluenceEnforcement
    : "diagnostic";

  if ((rawVersion !== undefined && requestedVersion === "legacy" && rawVersion !== "legacy") ||
      (rawVariant !== undefined && requestedVariant === "legacy" && rawVariant !== "legacy") ||
      (rawEnforcement !== undefined && requestedEnforcement === "diagnostic" && rawEnforcement !== "diagnostic")) {
    onWarning(`valor de entryPolicy inválido; usando legacy/diagnostic (version=${String(rawVersion)}, reboundVariant=${String(rawVariant)}, confluenceEnforcement=${String(rawEnforcement)})`);
  }

  const wantsCandidate = requestedVersion === "v2_candidate"
    || requestedVariant !== "legacy"
    || requestedEnforcement === "enforced";
  if (!wantsCandidate) {
    return { version: "legacy", reboundVariant: "legacy", confluenceEnforcement: "diagnostic" };
  }

  if (!EXPERIMENTAL_MODES.has(mode)) {
    onWarning(`entryPolicy no legacy ignorada en mode=${String(mode)}; usando legacy`);
    return { version: "legacy", reboundVariant: "legacy", confluenceEnforcement: "diagnostic" };
  }

  if (requestedVersion !== "v2_candidate") {
    onWarning("entryPolicy experimental requiere version='v2_candidate'; usando legacy");
    return { version: "legacy", reboundVariant: "legacy", confluenceEnforcement: "diagnostic" };
  }

  return {
    version: "v2_candidate",
    reboundVariant: requestedVariant,
    confluenceEnforcement: requestedEnforcement,
  };
}
