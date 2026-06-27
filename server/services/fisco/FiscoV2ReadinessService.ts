/**
 * FiscoV2ReadinessService — Validación conjunta multianual antes de activación oficial V2.
 *
 * Reglas estrictas:
 * - activation_allowed = true SOLO si todos los años están UPDATED, sin blockers reales,
 *   safe_for_official_switch=true, sin unmapped legacy/V2, disposals_count_diff=0.
 * - non_blocking_diagnostics se reportan separadamente de blockers.
 * - NO activa V2 oficial, NO toca fisco_disposals, NO modifica resultados oficiales.
 */

import { fiscoControlStatusService, type ControlStatusResponse } from "./FiscoControlStatusService";
import { runComparison, type ComparisonResult } from "./FiscoComparisonService";

export interface YearReadiness {
  year: number;
  fiscal_result_status: string;
  is_updated: boolean;
  safe_for_official_switch: boolean;
  blockers: string[];
  official_switch_blockers: string[];
  non_blocking_diagnostics: string[];
  unmapped_legacy_count: number;
  unmapped_v2_count: number;
  disposals_count_diff: number;
  legacy_result: {
    net_gain_loss_eur: number;
    gains_eur: number;
    losses_eur: number;
    disposals_count: number;
    engine: string;
  };
  v2_result: {
    net_gain_loss_eur: number;
    gains_eur: number;
    losses_eur: number;
    disposals_count: number;
    engine: string;
    is_full_v2_engine: boolean;
  };
  diff_eur: number;
  year_operation_set_hash: string;
  global_operation_set_hash: string;
  last_committed_hash: string | null;
  last_committed_scope: string;
  hash_scope_match: boolean;
  hash_matches: boolean;
  hash_status_reason: string;
  hash_semantic_status: "OK_GLOBAL" | "OK_YEAR" | "SCOPE_MISMATCH_STORED_YEAR_AS_GLOBAL" | "REAL_GLOBAL_MISMATCH" | "MISSING_HASH";
  has_operation_set_hash: boolean;
  v2_activation_blocked: boolean;
  v2_activation_block_reason: string | null;
  historical_blockers: string[];
  warnings: string[];
}

export interface ReadinessResponse {
  activation_allowed: boolean;
  activation_block_reasons: string[];
  years: YearReadiness[];
  all_updated: boolean;
  all_safe_for_official_switch: boolean;
  any_blockers: boolean;
  any_unmapped: boolean;
  any_disposals_diff: boolean;
  all_hashes_registered: boolean;
  engine_mode: string;
  generated_at: string;
}

/**
 * Compute readiness for a set of years.
 * Does NOT activate V2, does NOT modify any data.
 */
export async function computeReadiness(years: number[]): Promise<ReadinessResponse> {
  const yearResults: YearReadiness[] = [];

  for (const year of years) {
    const controlStatus: ControlStatusResponse = await fiscoControlStatusService.getControlStatus(year);
    const comparison: ComparisonResult = await runComparison(year);

    const isUpdated = controlStatus.fiscal_result_status === "UPDATED";
    const safeForSwitch = comparison.safe_for_official_switch;
    const realBlockers = comparison.blockers ?? [];
    const officialSwitchBlockers = comparison.official_switch_blockers ?? [];
    const controlBlockers = controlStatus.blockers ?? [];

    // Non-blocking diagnostics: historical_blockers + warnings that don't block activation
    const nonBlockingDiagnostics: string[] = [];
    for (const hb of comparison.historical_blockers ?? []) {
      nonBlockingDiagnostics.push(`[historical] ${hb}`);
    }
    for (const w of comparison.warnings ?? []) {
      nonBlockingDiagnostics.push(`[warning] ${w}`);
    }
    for (const w of controlStatus.warnings ?? []) {
      nonBlockingDiagnostics.push(`[control_warning] ${w}`);
    }

    // Combine all real blockers
    const allBlockers = [...realBlockers, ...officialSwitchBlockers, ...controlBlockers];

    const unmappedLegacy = comparison.unmapped_legacy_disposals?.length ?? 0;
    const unmappedV2 = comparison.unmapped_v2_disposals?.length ?? 0;
    const disposalsDiff = comparison.disposals_count_diff ?? 0;

    const yearHash = controlStatus.data_fingerprint?.operation_set_hash ?? "";
    const globalHash = controlStatus.data_fingerprint?.global_operation_set_hash ?? "";
    const lastCommittedHash = controlStatus.last_committed_run?.operation_set_hash ?? null;
    const lastCommittedScope = controlStatus.last_committed_run?.operations_count_scope ?? "global";
    const hasOperationSetHash = controlStatus.last_committed_run?.has_operation_set_hash ?? false;

    // Scope-aware hash comparison: compare same-scope hashes only
    const currentHashForComparison = lastCommittedScope === "year" ? yearHash : globalHash;
    const hashScopeMatch = true;
    const hashMatches = lastCommittedHash !== null && lastCommittedHash === currentHashForComparison;

    // Determine hash_semantic_status
    let hashSemanticStatus: "OK_GLOBAL" | "OK_YEAR" | "SCOPE_MISMATCH_STORED_YEAR_AS_GLOBAL" | "REAL_GLOBAL_MISMATCH" | "MISSING_HASH";
    if (!hasOperationSetHash || !lastCommittedHash) {
      hashSemanticStatus = "MISSING_HASH";
    } else if (lastCommittedScope === "year" && lastCommittedHash === yearHash) {
      hashSemanticStatus = "OK_YEAR";
    } else if (lastCommittedScope === "global" && lastCommittedHash === globalHash) {
      hashSemanticStatus = "OK_GLOBAL";
    } else if (lastCommittedScope === "global" && lastCommittedHash === yearHash && lastCommittedHash !== globalHash) {
      // The committed hash matches the year hash but not the global hash —
      // a year hash was stored as if it were global
      hashSemanticStatus = "SCOPE_MISMATCH_STORED_YEAR_AS_GLOBAL";
    } else {
      hashSemanticStatus = "REAL_GLOBAL_MISMATCH";
    }

    const hashStatusReason = !hasOperationSetHash
      ? "last_committed_run no tiene operation_set_hash registrado"
      : hashSemanticStatus === "SCOPE_MISMATCH_STORED_YEAR_AS_GLOBAL"
        ? `Hash anual registrado como global: committed=${lastCommittedHash} coincide con year_hash=${yearHash} pero no con global_hash=${globalHash}`
        : !hashMatches
          ? `Hash no coincide en scope ${lastCommittedScope}: committed=${lastCommittedHash} vs current=${currentHashForComparison}`
          : `Hash coincide en scope ${lastCommittedScope}`;

    yearResults.push({
      year,
      fiscal_result_status: controlStatus.fiscal_result_status,
      is_updated: isUpdated,
      safe_for_official_switch: safeForSwitch,
      blockers: allBlockers,
      official_switch_blockers: officialSwitchBlockers,
      non_blocking_diagnostics: nonBlockingDiagnostics,
      unmapped_legacy_count: unmappedLegacy,
      unmapped_v2_count: unmappedV2,
      disposals_count_diff: disposalsDiff,
      legacy_result: {
        net_gain_loss_eur: comparison.baseline.net_gain_loss_eur,
        gains_eur: comparison.baseline.gains_eur,
        losses_eur: comparison.baseline.losses_eur,
        disposals_count: comparison.baseline.disposals_count,
        engine: comparison.baseline.engine,
      },
      v2_result: {
        net_gain_loss_eur: comparison.v2.net_gain_loss_eur,
        gains_eur: comparison.v2.gains_eur,
        losses_eur: comparison.v2.losses_eur,
        disposals_count: comparison.v2.disposals_count,
        engine: comparison.v2.engine,
        is_full_v2_engine: comparison.v2.is_full_v2_engine,
      },
      diff_eur: comparison.diff_eur,
      year_operation_set_hash: yearHash,
      global_operation_set_hash: globalHash,
      last_committed_hash: lastCommittedHash,
      last_committed_scope: lastCommittedScope,
      hash_scope_match: hashScopeMatch,
      hash_matches: hashMatches,
      hash_status_reason: hashStatusReason,
      hash_semantic_status: hashSemanticStatus,
      has_operation_set_hash: hasOperationSetHash,
      v2_activation_blocked: controlStatus.v2_activation_blocked,
      v2_activation_block_reason: controlStatus.v2_activation_block_reason,
      historical_blockers: comparison.historical_blockers ?? [],
      warnings: comparison.warnings ?? [],
    });
  }

  // Aggregate checks
  const allUpdated = yearResults.every(y => y.is_updated);
  const allSafe = yearResults.every(y => y.safe_for_official_switch);
  const anyBlockers = yearResults.some(y => y.blockers.length > 0);
  const anyUnmapped = yearResults.some(y => y.unmapped_legacy_count > 0 || y.unmapped_v2_count > 0);
  const anyDisposalsDiff = yearResults.some(y => y.disposals_count_diff !== 0);
  const allHashesRegistered = yearResults.every(y => y.has_operation_set_hash && y.hash_matches);

  const activationBlockReasons: string[] = [];
  if (!allUpdated) {
    const outdated = yearResults.filter(y => !y.is_updated).map(y => y.year);
    activationBlockReasons.push(`Años no UPDATED: ${outdated.join(", ")}`);
  }
  if (!allSafe) {
    const notSafe = yearResults.filter(y => !y.safe_for_official_switch).map(y => y.year);
    activationBlockReasons.push(`safe_for_official_switch != true en: ${notSafe.join(", ")}`);
  }
  if (anyBlockers) {
    const withBlockers = yearResults.filter(y => y.blockers.length > 0).map(y => `${y.year} (${y.blockers.length})`);
    activationBlockReasons.push(`Blockers reales en: ${withBlockers.join(", ")}`);
  }
  if (anyUnmapped) {
    const withUnmapped = yearResults.filter(y => y.unmapped_legacy_count > 0 || y.unmapped_v2_count > 0).map(y => y.year);
    activationBlockReasons.push(`Disposiciones sin mapear en: ${withUnmapped.join(", ")}`);
  }
  if (anyDisposalsDiff) {
    const withDiff = yearResults.filter(y => y.disposals_count_diff !== 0).map(y => y.year);
    activationBlockReasons.push(`disposals_count_diff != 0 en: ${withDiff.join(", ")}`);
  }
  if (!allHashesRegistered) {
    const noHash = yearResults.filter(y => !y.has_operation_set_hash || !y.hash_matches).map(y => y.year);
    activationBlockReasons.push(`Hash no coincide en el mismo scope; revisar o registrar hash mediante flujo controlado en: ${noHash.join(", ")}`);
  }

  const activationAllowed = activationBlockReasons.length === 0;

  return {
    activation_allowed: activationAllowed,
    activation_block_reasons: activationBlockReasons,
    years: yearResults,
    all_updated: allUpdated,
    all_safe_for_official_switch: allSafe,
    any_blockers: anyBlockers,
    any_unmapped: anyUnmapped,
    any_disposals_diff: anyDisposalsDiff,
    all_hashes_registered: allHashesRegistered,
    engine_mode: "v2_shadow",
    generated_at: new Date().toISOString(),
  };
}
