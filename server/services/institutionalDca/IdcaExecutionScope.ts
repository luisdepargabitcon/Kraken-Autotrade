export type IdcaExecutionScopeMode = 'live' | 'simulation';

export type IdcaExecutionScopeFailureReason =
  | 'requested_mode_invalid'
  | 'persisted_mode_invalid'
  | 'mode_scope_mismatch';

export type IdcaExecutionScopeResult =
  | { ok: true; mode: IdcaExecutionScopeMode }
  | { ok: false; reason: IdcaExecutionScopeFailureReason };

function isExecutionScopeMode(value: unknown): value is IdcaExecutionScopeMode {
  return value === 'live' || value === 'simulation';
}

/**
 * Scope puro de ejecución IDCA: el modo solicitado debe ser exacto y coincidir
 * con el scope persistido del ciclo. No hay coerción ni fallback simulado.
 */
export function resolveIdcaExecutionScope(
  cycle: { mode?: unknown } | null | undefined,
  requestedMode: unknown
): IdcaExecutionScopeResult {
  if (!isExecutionScopeMode(requestedMode)) {
    return { ok: false, reason: 'requested_mode_invalid' };
  }
  if (!isExecutionScopeMode(cycle?.mode)) {
    return { ok: false, reason: 'persisted_mode_invalid' };
  }
  if (cycle.mode !== requestedMode) {
    return { ok: false, reason: 'mode_scope_mismatch' };
  }
  return { ok: true, mode: requestedMode };
}
