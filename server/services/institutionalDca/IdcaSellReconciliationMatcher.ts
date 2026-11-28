export interface SellReconciliationInput {
  id: string | number;
  pair?: string | null;
  quantity: number | string;
  price?: number | string | null;
  executedAt?: number | string | Date | null;
  feeUsd?: number | string | null;
  orderId?: string | null;
}

export interface FillReconciliationInput {
  id: string | number;
  orderId?: string | null;
  pair?: string | null;
  quantity: number | string;
  price?: number | string | null;
  executedAt?: number | string | Date | null;
  feeUsd?: number | string | null;
}

export interface SellReconciliationOptions {
  quantityRelTolerancePct?: number;
  quantityAbsStep?: number;
  priceRelTolerancePct?: number;
  timeWindowMs?: number;
  feeRelTolerancePct?: number;
}

export interface SellMatchEvidence {
  fillQuantity: number;
  fillAvgPrice: number | null;
  fillFeeUsd: number | null;
  quantityDiff: number;
  quantityDiffPct: number | null;
  priceDiffPct: number | null;
  timeDiffMs: number | null;
  feeDiffPct: number | null;
}

export interface SellMatchResult {
  sellId: string;
  status: "verified" | "unmatched" | "ambiguous";
  fillIds: string[];
  evidence?: SellMatchEvidence;
  reason: string;
  candidateUnitCount: number;
  candidateSellCount: number;
}

export interface SellReconciliationResult {
  results: SellMatchResult[];
  unmatchedFillIds: string[];
  summary: {
    sells: number;
    fills: number;
    verified: number;
    unmatched: number;
    ambiguous: number;
  };
}

const DEFAULT_OPTIONS: Required<Omit<SellReconciliationOptions, "feeRelTolerancePct">> = {
  quantityRelTolerancePct: 0.2,
  quantityAbsStep: 1e-8,
  priceRelTolerancePct: 0.3,
  timeWindowMs: 10 * 60 * 1000,
};

interface NormalizedRow {
  id: string;
  orderId: string;
  pair: string;
  quantity: number;
  price: number | null;
  timeMs: number | null;
  feeUsd: number | null;
}

interface FillUnit {
  key: string;
  fills: NormalizedRow[];
  quantity: number;
  avgPrice: number | null;
  feeUsd: number | null;
  firstTimeMs: number | null;
  lastTimeMs: number | null;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function timeMs(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function normalize(row: SellReconciliationInput | FillReconciliationInput): NormalizedRow {
  return {
    id: String(row.id),
    orderId: row.orderId == null ? "" : String(row.orderId),
    pair: row.pair == null ? "" : String(row.pair),
    quantity: num(row.quantity) ?? NaN,
    price: num(row.price),
    timeMs: timeMs(row.executedAt),
    feeUsd: num(row.feeUsd),
  };
}

function canonicalRowKey(row: NormalizedRow): string {
  return [
    row.timeMs == null ? "9999999999999999" : String(row.timeMs).padStart(16, "0"),
    row.pair,
    row.quantity.toFixed(12),
    row.price == null ? "" : row.price.toFixed(12),
    row.id,
  ].join("|");
}

function withinPct(actual: number, expected: number, relPct: number, absStep = 0): boolean {
  const diff = Math.abs(actual - expected);
  const tolerance = Math.max(absStep, Math.abs(expected) * (relPct / 100));
  return diff <= tolerance;
}

function pctDiff(actual: number, expected: number): number | null {
  if (!(expected !== 0)) return null;
  return Math.abs(((actual - expected) / expected) * 100);
}

function makeUnit(key: string, fills: NormalizedRow[]): FillUnit {
  const quantity = fills.reduce((sum, fill) => sum + fill.quantity, 0);
  const priced = fills.filter(fill => fill.price != null && fill.quantity > 0);
  const priceQty = priced.reduce((sum, fill) => sum + fill.quantity, 0);
  const avgPrice = priceQty > 0
    ? priced.reduce((sum, fill) => sum + fill.quantity * fill.price!, 0) / priceQty
    : null;
  const fees = fills.map(fill => fill.feeUsd).filter((fee): fee is number => fee != null);
  const times = fills.map(fill => fill.timeMs).filter((time): time is number => time != null);
  return {
    key,
    fills: [...fills].sort((a, b) => canonicalRowKey(a).localeCompare(canonicalRowKey(b))),
    quantity,
    avgPrice,
    feeUsd: fees.length > 0 ? fees.reduce((sum, fee) => sum + fee, 0) : null,
    firstTimeMs: times.length > 0 ? Math.min(...times) : null,
    lastTimeMs: times.length > 0 ? Math.max(...times) : null,
  };
}

function buildUnits(fills: NormalizedRow[]): FillUnit[] {
  const units = fills.map(fill => makeUnit(`fill:${fill.id}`, [fill]));
  const byOrder = new Map<string, NormalizedRow[]>();
  for (const fill of fills) {
    if (!fill.orderId) continue;
    const rows = byOrder.get(fill.orderId) ?? [];
    rows.push(fill);
    byOrder.set(fill.orderId, rows);
  }
  for (const [orderId, rows] of [...byOrder.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (rows.length > 1) units.push(makeUnit(`order:${orderId}`, rows));
  }
  return units.sort((a, b) => a.key.localeCompare(b.key));
}

function timeEvidence(sellTime: number | null, unit: FillUnit): number | null {
  if (sellTime == null || unit.firstTimeMs == null || unit.lastTimeMs == null) return null;
  if (sellTime < unit.firstTimeMs) return unit.firstTimeMs - sellTime;
  if (sellTime > unit.lastTimeMs) return sellTime - unit.lastTimeMs;
  return 0;
}

function candidateEvidence(
  sell: NormalizedRow,
  unit: FillUnit,
  options: SellReconciliationOptions,
): SellMatchEvidence | null {
  const qtyRel = options.quantityRelTolerancePct ?? DEFAULT_OPTIONS.quantityRelTolerancePct;
  const qtyStep = options.quantityAbsStep ?? DEFAULT_OPTIONS.quantityAbsStep;
  const priceRel = options.priceRelTolerancePct ?? DEFAULT_OPTIONS.priceRelTolerancePct;
  const timeWindow = options.timeWindowMs ?? DEFAULT_OPTIONS.timeWindowMs;

  if (!Number.isFinite(sell.quantity) || sell.quantity <= 0 || !Number.isFinite(unit.quantity) || unit.quantity <= 0) return null;
  if (sell.pair && unit.fills[0]?.pair && sell.pair !== unit.fills[0].pair) return null;
  if (!withinPct(unit.quantity, sell.quantity, qtyRel, qtyStep)) return null;
  if (sell.price != null && unit.avgPrice != null && !withinPct(unit.avgPrice, sell.price, priceRel)) return null;

  const timeDiffMs = timeEvidence(sell.timeMs, unit);
  if (timeDiffMs == null || timeDiffMs > timeWindow) return null;

  const feeDiffPct = sell.feeUsd != null && unit.feeUsd != null ? pctDiff(unit.feeUsd, sell.feeUsd) : null;
  if (options.feeRelTolerancePct !== undefined && sell.feeUsd != null && unit.feeUsd != null) {
    if (!withinPct(unit.feeUsd, sell.feeUsd, options.feeRelTolerancePct)) return null;
  }

  const quantityDiff = Math.abs(unit.quantity - sell.quantity);
  return {
    fillQuantity: unit.quantity,
    fillAvgPrice: unit.avgPrice,
    fillFeeUsd: unit.feeUsd,
    quantityDiff,
    quantityDiffPct: pctDiff(unit.quantity, sell.quantity),
    priceDiffPct: sell.price != null && unit.avgPrice != null ? pctDiff(unit.avgPrice, sell.price) : null,
    timeDiffMs,
    feeDiffPct,
  };
}

/**
 * Matcher puro y determinista para ventas IDCA sin exchange_order_id fiable.
 * No hace I/O, no modifica datos y nunca reutiliza fills asignados.
 */
export function matchSellsToFills(
  sellsInput: SellReconciliationInput[],
  fillsInput: FillReconciliationInput[],
  opts: SellReconciliationOptions = {},
): SellReconciliationResult {
  const sells = sellsInput.map(normalize).sort((a, b) => canonicalRowKey(a).localeCompare(canonicalRowKey(b)));
  const fills = fillsInput.map(normalize).sort((a, b) => canonicalRowKey(a).localeCompare(canonicalRowKey(b)));
  const units = buildUnits(fills);

  const sellCandidates = new Map<string, Array<{ unit: FillUnit; evidence: SellMatchEvidence }>>();
  const unitCandidates = new Map<string, string[]>();

  for (const sell of sells) {
    const candidates: Array<{ unit: FillUnit; evidence: SellMatchEvidence }> = [];
    for (const unit of units) {
      const evidence = candidateEvidence(sell, unit, opts);
      if (!evidence) continue;
      candidates.push({ unit, evidence });
      const rows = unitCandidates.get(unit.key) ?? [];
      rows.push(sell.id);
      unitCandidates.set(unit.key, rows);
    }
    candidates.sort((a, b) => a.unit.key.localeCompare(b.unit.key));
    sellCandidates.set(sell.id, candidates);
  }

  const prospective = new Map<string, { unit: FillUnit; evidence: SellMatchEvidence }>();
  const prospectiveFillUse = new Map<string, number>();
  for (const sell of sells) {
    const candidates = sellCandidates.get(sell.id) ?? [];
    if (candidates.length !== 1) continue;
    const candidate = candidates[0];
    if ((unitCandidates.get(candidate.unit.key) ?? []).length !== 1) continue;
    prospective.set(sell.id, candidate);
    for (const fill of candidate.unit.fills) {
      prospectiveFillUse.set(fill.id, (prospectiveFillUse.get(fill.id) ?? 0) + 1);
    }
  }

  const results: SellMatchResult[] = [];
  const usedFillIds = new Set<string>();

  for (const sell of sells) {
    const candidates = sellCandidates.get(sell.id) ?? [];
    if (candidates.length === 0) {
      results.push({
        sellId: sell.id,
        status: "unmatched",
        fillIds: [],
        reason: "sin fills dentro de tolerancias de cantidad/precio/tiempo",
        candidateUnitCount: 0,
        candidateSellCount: 0,
      });
      continue;
    }

    if (candidates.length !== 1) {
      results.push({
        sellId: sell.id,
        status: "ambiguous",
        fillIds: [],
        reason: "la venta casa con varios fills o grupos de fills posibles",
        candidateUnitCount: candidates.length,
        candidateSellCount: 0,
      });
      continue;
    }

    const candidate = candidates[0];
    const competingSells = unitCandidates.get(candidate.unit.key) ?? [];
    const overlappingProspective = candidate.unit.fills.some(fill => (prospectiveFillUse.get(fill.id) ?? 0) > 1);
    const alreadyUsed = candidate.unit.fills.some(fill => usedFillIds.has(fill.id));
    if (competingSells.length !== 1 || overlappingProspective || alreadyUsed) {
      results.push({
        sellId: sell.id,
        status: "ambiguous",
        fillIds: [],
        reason: overlappingProspective || alreadyUsed ? "fill compartido por varios emparejamientos posibles" : "el mismo fill casa con varias ventas",
        candidateUnitCount: 1,
        candidateSellCount: competingSells.length,
      });
      continue;
    }

    for (const fill of candidate.unit.fills) usedFillIds.add(fill.id);
    results.push({
      sellId: sell.id,
      status: "verified",
      fillIds: candidate.unit.fills.map(fill => fill.id),
      evidence: candidate.evidence,
      reason: "emparejamiento inequívoco dentro de tolerancias",
      candidateUnitCount: 1,
      candidateSellCount: 1,
    });
  }

  const unmatchedFillIds = fills
    .filter(fill => !usedFillIds.has(fill.id))
    .map(fill => fill.id)
    .sort();

  return {
    results,
    unmatchedFillIds,
    summary: {
      sells: sells.length,
      fills: fills.length,
      verified: results.filter(result => result.status === "verified").length,
      unmatched: results.filter(result => result.status === "unmatched").length,
      ambiguous: results.filter(result => result.status === "ambiguous").length,
    },
  };
}
