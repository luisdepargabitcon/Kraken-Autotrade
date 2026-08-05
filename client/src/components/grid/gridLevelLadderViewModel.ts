export type LadderRowKind = "BUY_ENTRY" | "REFERENCE_RUNG" | "CYCLE_SELL_TARGET";
export type LadderSide = "BUY" | "SELL";
export type LadderFilter = "all" | "buy" | "sell" | "withCycle";

export interface LadderRow {
  key: string;
  kind: LadderRowKind;
  side: LadderSide;
  price: number | null;
  quantity: number | null;
  notionalUsd: number | null;
  status: string;
  statusLabel: string;
  rangeVersionId: string | null;
  rangeRelation: string;
  levelId: string | null;
  cycleId: string | null;
  cycleNumber: number | null;
  targetSellPrice: number | null;
  linkedCycles: LinkedCycleInfo[];
  isExecutable: boolean;
  explanation: string;
}

export interface LinkedCycleInfo {
  cycleId: string;
  cycleNumber: number;
  targetSellPrice: number | null;
}

export interface CycleExitCard {
  cycleId: string;
  cycleNumber: number;
  buyPrice: number | null;
  targetSellPrice: number | null;
  quantity: number | null;
  expectedNetUsd: number | null;
  netTargetPct: number | null;
  makerState: string | null;
  rangeRelation: string;
  policyVersion: string | null;
  targetKind: string | null;
  targetOwner: string;
  exchangeFeesUsd: number | null;
  taxReserveUsd: number | null;
  executionMicrostructureSource: string | null;
  constraintsSource: string | null;
  requiresReview: boolean;
  requestedMakerPrice: number | null;
  targetDistancePctFromBuy: number | null;
}

export interface HistoricalRow {
  id: string;
  side: string;
  price: number | null;
  quantity: number | null;
  status: string;
  statusLabel: string;
  rangeRelation: string;
  cycleNumber: number | null;
  cycleId: string | null;
  rangeVersionId: string | null;
  createdAt: string | null;
}

export interface LadderCounts {
  total: number;
  buy: number;
  sell: number;
  withCycle: number;
}

export interface LadderWarning {
  code: string;
  message: string;
}

export interface GridLevelLadderViewModel {
  currentPrice: number | null;
  activeRangeId: string | null;
  activeRangeLabel: string;
  rows: LadderRow[];
  cycleExits: CycleExitCard[];
  historicalRows: HistoricalRow[];
  counts: LadderCounts;
  warnings: LadderWarning[];
}

export interface OperationalInput {
  header?: {
    currentPrice?: number | null;
  };
  levels?: {
    entryLevels?: EntryLevelInput[];
    referenceRungs?: RungLevelInput[];
    legacyTargetLevels?: LevelInput[];
    historicalLevels?: LevelInput[];
  };
  cycleOwnedExits?: CycleOwnedExitInput[];
  currentRange?: {
    exists?: boolean;
    message?: string;
    subtitle?: string | null;
    lowerPrice?: number | null;
    centerPrice?: number | null;
    upperPrice?: number | null;
    widthPct?: number | null;
  };
  market?: {
    entryRange?: {
      activeRangeVersionId?: string | null;
      active?: boolean;
    };
  };
}

export interface EntryLevelInput {
  id: string;
  side: string;
  price: number | null;
  quantity: number | null;
  status: string;
  statusLabel?: string;
  rangeVersionId?: string | null;
  rangeRelation?: string;
  cycleNumber?: number | null;
  cycleId?: string | null;
  targetOfOpenCycle?: boolean;
  estimatedNetProfit?: number | null;
  createdAt?: string | null;
}

export interface RungLevelInput {
  id: string;
  side: string;
  price: number | null;
  quantity: number | null;
  status: string;
  statusLabel?: string;
  rangeVersionId?: string | null;
  rangeRelation?: string;
  targetOfOpenCycle?: boolean;
  createdAt?: string | null;
}

export interface LevelInput {
  id: string;
  side: string;
  price: number | null;
  quantity: number | null;
  status: string;
  statusLabel?: string;
  rangeVersionId?: string | null;
  rangeRelation?: string;
  cycleNumber?: number | null;
  cycleId?: string | null;
  targetOfOpenCycle?: boolean;
  createdAt?: string | null;
}

export interface CycleOwnedExitInput {
  cycleId: string;
  cycleNumber: number;
  policyVersion?: string | null;
  targetKind?: string | null;
  targetOwner: string;
  buyPrice?: number | null;
  targetSellPrice?: number | null;
  targetDistancePctFromBuy?: number | null;
  quantity?: number | null;
  netTargetPct?: number | null;
  expectedNetUsd?: number | null;
  targetSellLevelId?: string | null;
  targetRungLevelId?: string | null;
  makerState?: string | null;
  requestedMakerPrice?: number | null;
  rangeRelation?: string;
  exchangeFeesUsd?: number | null;
  taxReserveUsd?: number | null;
  executionMicrostructureSource?: string | null;
  constraintsSource?: string | null;
  requiresReview?: boolean;
}

const PRICE_TICK_TOLERANCE = 0.01;

function safeNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function computeNotional(price: number | null, quantity: number | null): number | null {
  if (price == null || quantity == null) return null;
  const n = price * quantity;
  return Number.isFinite(n) ? n : null;
}

function statusLabelFromStatus(status: string, fallback?: string): string {
  const map: Record<string, string> = {
    planned: "Esperando precio",
    open: "Activo",
    active: "Activo",
    buy_maker_pending: "BUY maker pendiente",
    buy_filled: "BUY ejecutado",
    sell_triggered: "SELL activado",
    sell_maker_pending: "SELL maker pendiente",
    sell_closed: "Ciclo completado",
    completed: "Ciclo completado",
    cancelled: "Cancelado",
    replaced: "Sustituido",
    expired: "Caducado",
  };
  return map[status] ?? fallback ?? status;
}

export function humanizeMakerState(state: string | null | undefined): string | null {
  if (state == null || state === "") return null;
  const map: Record<string, string> = {
    MAKER_PENDING: "SELL maker pendiente",
    maker_pending: "SELL maker pendiente",
    MAKER_FILLED: "SELL maker ejecutado",
    maker_filled: "SELL maker ejecutado",
    MAKER_REPRICED: "SELL maker reprecio",
    maker_repriced: "SELL maker reprecio",
    TRIGGER_DETECTED: "SELL activado",
    trigger_detected: "SELL activado",
    IDLE: "Esperando target",
    idle: "Esperando target",
  };
  return map[state] ?? state;
}

function isCurrentRange(rel: string | undefined): boolean {
  return rel === "current";
}

function filterCurrentLevels<T extends { rangeRelation?: string; rangeVersionId?: string | null }>(
  items: T[],
  activeRangeId: string | null,
): T[] {
  const hasRangeRelation = items.some((i) => i.rangeRelation != null);
  if (hasRangeRelation) {
    return items.filter((i) => i.rangeRelation === "current");
  }
  if (activeRangeId) {
    return items.filter((i) => i.rangeVersionId === activeRangeId);
  }
  return items;
}

function matchCycleToRung(
  cycle: CycleOwnedExitInput,
  rungs: RungLevelInput[],
): { rung: RungLevelInput | null; warning: string | null } {
  const rungId = cycle.targetRungLevelId;
  if (rungId && rungId.trim() !== "") {
    const byId = rungs.find((r) => r.id === rungId);
    if (byId) return { rung: byId, warning: null };
    return {
      rung: null,
      warning: `targetRungLevelId "${rungId}" no encontrado entre los rungs visibles del rango vigente`,
    };
  }
  const targetPrice = safeNum(cycle.targetSellPrice);
  if (targetPrice == null) return { rung: null, warning: null };
  for (const rung of rungs) {
    const rungPrice = safeNum(rung.price);
    if (rungPrice == null) continue;
    if (Math.abs(rungPrice - targetPrice) <= PRICE_TICK_TOLERANCE) {
      return { rung, warning: null };
    }
  }
  return { rung: null, warning: null };
}

function sortRows(rows: LadderRow[]): LadderRow[] {
  return [...rows].sort((a, b) => {
    const pa = a.price ?? -Infinity;
    const pb = b.price ?? -Infinity;
    if (pa !== pb) return pb - pa;
    const kindOrder: Record<LadderRowKind, number> = {
      CYCLE_SELL_TARGET: 0,
      REFERENCE_RUNG: 1,
      BUY_ENTRY: 2,
    };
    const ko = kindOrder[a.kind] - kindOrder[b.kind];
    if (ko !== 0) return ko;
    return (a.key ?? "").localeCompare(b.key ?? "");
  });
}

function filterRows(rows: LadderRow[], filter: LadderFilter): LadderRow[] {
  if (filter === "all") return rows;
  if (filter === "buy") return rows.filter((r) => r.kind === "BUY_ENTRY");
  if (filter === "sell") return rows.filter((r) => r.kind === "REFERENCE_RUNG" || r.kind === "CYCLE_SELL_TARGET");
  if (filter === "withCycle") return rows.filter((r) => r.linkedCycles.length > 0 || r.cycleId != null);
  return rows;
}

function searchRows(rows: LadderRow[], query: string): LadderRow[] {
  if (!query.trim()) return rows;
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    const fields = [
      r.side,
      r.kind,
      r.status,
      r.statusLabel,
      String(r.price ?? ""),
      String(r.cycleNumber ?? ""),
      String(r.cycleId ?? ""),
      String(r.rangeVersionId ?? ""),
      r.explanation,
    ].map((s) => s.toLowerCase());
    return fields.some((f) => f.includes(q));
  });
}

export function searchHistoricalRows(rows: HistoricalRow[], query: string): HistoricalRow[] {
  if (!query.trim()) return rows;
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    const fields = [
      r.side,
      r.status,
      r.statusLabel,
      String(r.price ?? ""),
      String(r.cycleNumber ?? ""),
      String(r.cycleId ?? ""),
      String(r.rangeVersionId ?? ""),
      r.rangeRelation,
    ].map((s) => s.toLowerCase());
    return fields.some((f) => f.includes(q));
  });
}

export function buildGridLevelLadderViewModel(operational: OperationalInput | null | undefined): GridLevelLadderViewModel {
  if (operational == null) {
    return {
      currentPrice: null,
      activeRangeId: null,
      activeRangeLabel: "Sin rango activo",
      rows: [],
      cycleExits: [],
      historicalRows: [],
      counts: { total: 0, buy: 0, sell: 0, withCycle: 0 },
      warnings: [],
    };
  }

  const currentPrice = safeNum(operational.header?.currentPrice);

  const activeRangeId = operational.market?.entryRange?.activeRangeVersionId ?? null;
  const rangeExists = operational.currentRange?.exists === true;

  let resolvedRangeId = activeRangeId;
  if (!resolvedRangeId) {
    const levels = operational.levels ?? {};
    const allCurrentCandidates = [
      ...(levels.entryLevels ?? []),
      ...(levels.referenceRungs ?? []),
    ].filter((l) => l.rangeRelation === "current" && l.rangeVersionId);
    const versionIds = new Set(allCurrentCandidates.map((l) => l.rangeVersionId));
    if (versionIds.size === 1) {
      resolvedRangeId = allCurrentCandidates[0].rangeVersionId ?? null;
    }
  }

  const activeRangeLabel = resolvedRangeId
    ? `Rango vigente · ${resolvedRangeId.slice(0, 8)}`
    : rangeExists
      ? "Rango vigente"
      : "Sin rango activo";

  const levels = operational.levels ?? {};
  const entryLevels = levels.entryLevels ?? [];
  const referenceRungs = levels.referenceRungs ?? [];
  const cycleOwnedExits = operational.cycleOwnedExits ?? [];
  const historicalLevels = levels.historicalLevels ?? [];

  const warnings: LadderWarning[] = [];

  if (currentPrice == null || currentPrice <= 0) {
    warnings.push({ code: "NO_CURRENT_PRICE", message: "Precio actual no disponible" });
  }

  const rungsCurrent = filterCurrentLevels(referenceRungs, resolvedRangeId);
  const entriesCurrent = filterCurrentLevels(entryLevels, resolvedRangeId);

  const cycleByRung = new Map<string, LinkedCycleInfo[]>();
  const matchedCycleIds = new Set<string>();

  for (const cycle of cycleOwnedExits) {
    const { rung: matched, warning } = matchCycleToRung(cycle, rungsCurrent);
    if (warning) {
      warnings.push({ code: "RUNG_NOT_FOUND", message: warning });
    }
    if (matched) {
      const existing = cycleByRung.get(matched.id) ?? [];
      existing.push({
        cycleId: cycle.cycleId,
        cycleNumber: cycle.cycleNumber,
        targetSellPrice: safeNum(cycle.targetSellPrice),
      });
      cycleByRung.set(matched.id, existing);
      matchedCycleIds.add(cycle.cycleId);
    }
  }

  const rows: LadderRow[] = [];

  for (const entry of entriesCurrent) {
    const price = safeNum(entry.price);
    const qty = safeNum(entry.quantity);
    const notional = computeNotional(price, qty);
    const hasCycle = entry.cycleId != null || entry.targetOfOpenCycle === true;
    rows.push({
      key: `entry-${entry.id}`,
      kind: "BUY_ENTRY",
      side: "BUY",
      price,
      quantity: qty,
      notionalUsd: notional,
      status: entry.status,
      statusLabel: statusLabelFromStatus(entry.status, entry.statusLabel),
      rangeVersionId: entry.rangeVersionId ?? null,
      rangeRelation: entry.rangeRelation ?? "current",
      levelId: entry.id,
      cycleId: entry.cycleId ?? null,
      cycleNumber: entry.cycleNumber ?? null,
      targetSellPrice: null,
      linkedCycles: [],
      isExecutable: entry.status !== "planned",
      explanation: hasCycle
        ? "BUY entrada con ciclo asociado"
        : "Target definitivo: se asignará después de ejecutar el BUY",
    });
  }

  for (const rung of rungsCurrent) {
    const price = safeNum(rung.price);
    const qty = safeNum(rung.quantity);
    const notional = computeNotional(price, qty);
    const linked = cycleByRung.get(rung.id) ?? [];
    const cycleLabel = linked.length > 0
      ? `Usado por ciclo ${linked.map((c) => `#${c.cycleNumber}`).join(", ")}`
      : "No ejecutable · precio candidato para targets";
    rows.push({
      key: `rung-${rung.id}`,
      kind: "REFERENCE_RUNG",
      side: rung.side === "BUY" ? "BUY" : "SELL",
      price,
      quantity: qty,
      notionalUsd: notional,
      status: rung.status,
      statusLabel: statusLabelFromStatus(rung.status, rung.statusLabel),
      rangeVersionId: rung.rangeVersionId ?? null,
      rangeRelation: rung.rangeRelation ?? "current",
      levelId: rung.id,
      cycleId: linked.length > 0 ? linked[0].cycleId : null,
      cycleNumber: linked.length > 0 ? linked[0].cycleNumber : null,
      targetSellPrice: linked.length > 0 ? linked[0].targetSellPrice : null,
      linkedCycles: linked,
      isExecutable: false,
      explanation: cycleLabel,
    });
  }

  for (const cycle of cycleOwnedExits) {
    if (matchedCycleIds.has(cycle.cycleId)) continue;
    const targetPrice = safeNum(cycle.targetSellPrice);
    const qty = safeNum(cycle.quantity);
    rows.push({
      key: `synthetic-${cycle.cycleId}`,
      kind: "CYCLE_SELL_TARGET",
      side: "SELL",
      price: targetPrice,
      quantity: qty,
      notionalUsd: computeNotional(targetPrice, qty),
      status: cycle.makerState ?? "planned",
      statusLabel: humanizeMakerState(cycle.makerState) ?? statusLabelFromStatus(cycle.makerState ?? "planned") ?? "Target de ciclo",
      rangeVersionId: null,
      rangeRelation: cycle.rangeRelation ?? "current",
      levelId: null,
      cycleId: cycle.cycleId,
      cycleNumber: cycle.cycleNumber,
      targetSellPrice: targetPrice,
      linkedCycles: [{
        cycleId: cycle.cycleId,
        cycleNumber: cycle.cycleNumber,
        targetSellPrice: targetPrice,
      }],
      isExecutable: false,
      explanation: `SELL del ciclo #${cycle.cycleNumber}`,
    });
  }

  const sortedRows = sortRows(rows);

  const cycleExits: CycleExitCard[] = cycleOwnedExits.map((c) => ({
    cycleId: c.cycleId,
    cycleNumber: c.cycleNumber,
    buyPrice: safeNum(c.buyPrice),
    targetSellPrice: safeNum(c.targetSellPrice),
    quantity: safeNum(c.quantity),
    expectedNetUsd: safeNum(c.expectedNetUsd),
    netTargetPct: safeNum(c.netTargetPct),
    makerState: c.makerState ?? null,
    rangeRelation: c.rangeRelation ?? "current",
    policyVersion: c.policyVersion ?? null,
    targetKind: c.targetKind ?? null,
    targetOwner: c.targetOwner,
    exchangeFeesUsd: safeNum(c.exchangeFeesUsd),
    taxReserveUsd: safeNum(c.taxReserveUsd),
    executionMicrostructureSource: c.executionMicrostructureSource ?? null,
    constraintsSource: c.constraintsSource ?? null,
    requiresReview: c.requiresReview ?? false,
    requestedMakerPrice: safeNum(c.requestedMakerPrice),
    targetDistancePctFromBuy: safeNum(c.targetDistancePctFromBuy),
  }));

  const historicalRows: HistoricalRow[] = historicalLevels.map((h) => ({
    id: h.id,
    side: h.side,
    price: safeNum(h.price),
    quantity: safeNum(h.quantity),
    status: h.status,
    statusLabel: statusLabelFromStatus(h.status, h.statusLabel),
    rangeRelation: h.rangeRelation ?? "previous",
    cycleNumber: h.cycleNumber ?? null,
    cycleId: h.cycleId ?? null,
    rangeVersionId: h.rangeVersionId ?? null,
    createdAt: h.createdAt ?? null,
  }));

  const counts: LadderCounts = {
    total: sortedRows.length,
    buy: sortedRows.filter((r) => r.kind === "BUY_ENTRY").length,
    sell: sortedRows.filter((r) => r.kind === "REFERENCE_RUNG" || r.kind === "CYCLE_SELL_TARGET").length,
    withCycle: sortedRows.filter((r) => r.linkedCycles.length > 0 || r.cycleId != null).length,
  };

  return {
    currentPrice,
    activeRangeId,
    activeRangeLabel,
    rows: sortedRows,
    cycleExits,
    historicalRows,
    counts,
    warnings,
  };
}

export function filterAndSearchRows(
  rows: LadderRow[],
  filter: LadderFilter,
  search: string,
): LadderRow[] {
  const filtered = filterRows(rows, filter);
  return searchRows(filtered, search);
}

export function insertCurrentPriceMarker(
  rows: LadderRow[],
  currentPrice: number | null,
): Array<LadderRow | { key: "current-price-marker"; isMarker: true; price: number | null }> {
  if (currentPrice == null || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return rows;
  }
  const marker = { key: "current-price-marker" as const, isMarker: true as const, price: currentPrice };

  const result: Array<LadderRow | typeof marker> = [];
  let inserted = false;
  for (const row of rows) {
    const rowPrice = row.price ?? -Infinity;
    if (!inserted && currentPrice > rowPrice) {
      result.push(marker);
      inserted = true;
    }
    if (!inserted && Math.abs((row.price ?? 0) - currentPrice) < 0.01) {
      result.push(marker);
      inserted = true;
    }
    result.push(row);
  }
  if (!inserted) {
    result.push(marker);
  }
  return result;
}
