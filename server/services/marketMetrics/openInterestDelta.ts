export interface OpenInterestSnapshotInput {
  value: number;
  tsProviderMs: number;
  source: string;
  asset: string;
  unit: string;
}

export interface OpenInterestDeltaResult {
  deltaPct: number | null;
  state: "ok" | "missing" | "invalid";
  reason: string;
  referenceTsProviderMs: number | null;
}

export function computeOpenInterestDelta24hPct(
  snapshots: OpenInterestSnapshotInput[],
  input: {
    nowMs: number;
    source: string;
    asset: string;
    unit: string;
    toleranceMs?: number;
  }
): OpenInterestDeltaResult {
  const toleranceMs = input.toleranceMs ?? 2 * 60 * 60 * 1000;
  const targetMs = input.nowMs - 24 * 60 * 60 * 1000;
  const sameSeries = snapshots.filter(s =>
    s.source === input.source &&
    s.asset.toUpperCase() === input.asset.toUpperCase() &&
    s.unit === input.unit &&
    Number.isFinite(s.value) &&
    Number.isFinite(s.tsProviderMs) &&
    s.tsProviderMs <= input.nowMs
  );
  const current = sameSeries
    .filter(s => s.tsProviderMs <= input.nowMs)
    .sort((a, b) => b.tsProviderMs - a.tsProviderMs)[0];
  if (!current) {
    return { deltaPct: null, state: "missing", reason: "Sin observación actual de open interest", referenceTsProviderMs: null };
  }
  const reference = sameSeries
    .filter(s => s.tsProviderMs < current.tsProviderMs && Math.abs(s.tsProviderMs - targetMs) <= toleranceMs)
    .sort((a, b) => Math.abs(a.tsProviderMs - targetMs) - Math.abs(b.tsProviderMs - targetMs))[0];
  if (!reference) {
    return { deltaPct: null, state: "missing", reason: "Histórico insuficiente de open interest en ventana 24h±2h", referenceTsProviderMs: null };
  }
  if (!(reference.value > 0) || !Number.isFinite(reference.value)) {
    return { deltaPct: null, state: "invalid", reason: "Denominador de open interest inválido", referenceTsProviderMs: reference.tsProviderMs };
  }
  const deltaPct = ((current.value - reference.value) / reference.value) * 100;
  if (!Number.isFinite(deltaPct)) {
    return { deltaPct: null, state: "invalid", reason: "Variación de open interest no finita", referenceTsProviderMs: reference.tsProviderMs };
  }
  return { deltaPct, state: "ok", reason: "Variación 24h calculada desde snapshots del mismo proveedor/activo/unidad", referenceTsProviderMs: reference.tsProviderMs };
}
