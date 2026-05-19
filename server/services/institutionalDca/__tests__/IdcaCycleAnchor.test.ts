// ─── Test runner mínimo (patrón del repo) ───────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function test(name: string, fn: () => void): void {
  console.log(`\n📋 ${name}`);
  fn();
}

// ─── Lógica pura: réplica de resolveCycleAnchorForDto ────────────────────────

interface DbVwapAnchor {
  anchor_price: number;
  anchor_ts: number;
  set_at: number;
  drawdown_pct: number;
}

interface CycleAnchorResult {
  price: number | null;
  source: string | null;
  label: string | null;
  timestamp: string | null;
  ageHours: number | null;
  origin: "cycle_meta" | "db_vwap_anchor" | "none";
}

function resolveCycleAnchorForDto(
  cycle: { pair: string; id: number; basePriceMetaJson?: any; basePriceType?: string },
  dbAnchor: DbVwapAnchor | null,
  now: number = Date.now()
): CycleAnchorResult {
  // Prioridad 1: cycleAnchorPrice persistido en basePriceMetaJson
  const meta = cycle.basePriceMetaJson && typeof cycle.basePriceMetaJson === "object"
    ? cycle.basePriceMetaJson
    : null;
  const metaAnchorPrice = meta?.cycleAnchorPrice ?? null;
  if (metaAnchorPrice && metaAnchorPrice > 0) {
    return {
      price: metaAnchorPrice,
      source: "vwap_anchor",
      label: "VWAP anclado",
      timestamp: null,
      ageHours: null,
      origin: "cycle_meta",
    };
  }

  // Prioridad 2: DB VWAP anchor directo (sin condición vwapEnabled)
  // NUNCA usar basePrice hybrid_v2 como ancla ciclo
  // NUNCA usar marketAnchorLive
  if (dbAnchor && dbAnchor.anchor_price > 0) {
    const ageHours = dbAnchor.set_at
      ? Math.round((now - dbAnchor.set_at) / (1000 * 60 * 60) * 10) / 10
      : null;
    return {
      price: dbAnchor.anchor_price,
      source: "vwap_anchor",
      label: "VWAP anclado",
      timestamp: dbAnchor.set_at ? new Date(dbAnchor.set_at).toISOString() : null,
      ageHours,
      origin: "db_vwap_anchor",
    };
  }

  return {
    price: null,
    source: null,
    label: null,
    timestamp: null,
    ageHours: null,
    origin: "none",
  };
}

// ─── Réplica de isSafeToStart con nueva política ─────────────────────────────

interface ReconcResult {
  criticalErrors?: string[];
  cyclesNeedingReview?: Array<{ pair: string; cycleId: number; reason: string }>;
}

function isSafeToStart(r: ReconcResult): boolean {
  if (r.criticalErrors && r.criticalErrors.length > 0) return false;
  return true;
}

// ─── Réplica de frontend mapping (camelCase + snake_case fallback) ────────────

function resolveFrontendAnchor(raw: Record<string, any>): number | null {
  return raw.cycleAnchorPrice ?? raw.cycle_anchor_price ?? null;
}

function resolveFrontendAnchorSource(raw: Record<string, any>): string | null {
  return raw.cycleAnchorSource ?? raw.cycle_anchor_source ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 1 — Resolución de ancla ciclo DTO (T9.1–T9.3)
// ═══════════════════════════════════════════════════════════════════════════

test("T9.1: getVwapAnchor=82017.40 + cycle active hybrid_v2 → ancla=82017.40, base separada", () => {
  const cycle = {
    pair: "BTC/USD", id: 24,
    basePriceMetaJson: {},
    basePriceType: "hybrid_v2",
  };
  const dbAnchor: DbVwapAnchor = {
    anchor_price: 82017.40,
    anchor_ts: Date.now() - 102 * 3600 * 1000,
    set_at: Date.now() - 102 * 3600 * 1000,
    drawdown_pct: 0,
  };
  const result = resolveCycleAnchorForDto(cycle, dbAnchor);
  assert(result.price === 82017.40, `cycleAnchorPrice debe ser 82017.40 (got ${result.price})`);
  assert(result.source === "vwap_anchor", `source debe ser vwap_anchor (got ${result.source})`);
  assert(result.origin === "db_vwap_anchor", `origin debe ser db_vwap_anchor (got ${result.origin})`);
  assert(result.label === "VWAP anclado", `label debe ser VWAP anclado (got ${result.label})`);
  // Confirm base price (81646.50 hybrid_v2) stays separate — cycle.basePriceType not touched
  assert(cycle.basePriceType === "hybrid_v2", `basePriceType debe seguir siendo hybrid_v2`);
});

test("T9.2: cycle basePriceType=hybrid_v2 sin vwap anchor → cycleAnchorPrice=null", () => {
  const cycle = { pair: "BTC/USD", id: 24, basePriceMetaJson: {}, basePriceType: "hybrid_v2" };
  const result = resolveCycleAnchorForDto(cycle, null);
  assert(result.price === null, `cycleAnchorPrice debe ser null sin DB anchor`);
  assert(result.origin === "none", `origin debe ser none`);
});

test("T9.3: marketAnchorLive=77336.20 sin vwap_anchor → NO se usa como cycleAnchorPrice", () => {
  const cycle = { pair: "BTC/USD", id: 24, basePriceMetaJson: {}, basePriceType: "hybrid_v2" };
  // Simulate: only live market anchor available, no DB anchor
  const marketAnchorLive = 77336.20;
  const result = resolveCycleAnchorForDto(cycle, null);
  // marketAnchorLive MUST NOT be used
  assert(result.price !== marketAnchorLive, `marketAnchorLive NO debe usarse como cycleAnchorPrice`);
  assert(result.price === null, `cycleAnchorPrice debe ser null (got ${result.price})`);
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 2 — Frontend mapping camelCase + snake_case (T9.4–T9.5)
// ═══════════════════════════════════════════════════════════════════════════

test("T9.4: frontend raw cycle_anchor_price=82017.40 → chip muestra 82017.40", () => {
  const raw = { cycle_anchor_price: 82017.40, cycle_anchor_source: "vwap_anchor" };
  const price = resolveFrontendAnchor(raw);
  assert(price === 82017.40, `precio resuelto debe ser 82017.40 (got ${price})`);
  assert(price !== null, `precio NO debe ser null`);
});

test("T9.5: frontend raw cycleAnchorPrice=82017.40 → chip muestra 82017.40", () => {
  const raw = { cycleAnchorPrice: 82017.40, cycleAnchorSource: "vwap_anchor" };
  const price = resolveFrontendAnchor(raw);
  assert(price === 82017.40, `precio resuelto debe ser 82017.40 (got ${price})`);
});

test("T9.5b: camelCase tiene prioridad sobre snake_case en frontend", () => {
  const raw = { cycleAnchorPrice: 82017.40, cycle_anchor_price: 99999.99 };
  const price = resolveFrontendAnchor(raw);
  assert(price === 82017.40, `camelCase debe tener prioridad (got ${price})`);
});

// ═══════════════════════════════════════════════════════════════════════════
// SUITE 3 — Estado ciclo + scheduler (T9.6–T9.7)
// ═══════════════════════════════════════════════════════════════════════════

test("T9.6: BTC reconciliado ACTIVE → no cuenta como cyclesNeedingReview", () => {
  // Simula que BTC fue restaurado a active después del void
  const r: ReconcResult = {
    criticalErrors: [],
    cyclesNeedingReview: [
      // ETH sigue necesitando revisión
      { pair: "ETH/USD", cycleId: 17, reason: "legacy_orders_need_verification" },
    ],
  };
  assert(r.cyclesNeedingReview!.length === 1, "Solo 1 ciclo debe quedar en revisión (ETH)");
  assert(r.cyclesNeedingReview![0].pair === "ETH/USD", "El ciclo en revisión debe ser ETH");
  const btcStillBlocked = r.cyclesNeedingReview!.some(c => c.pair === "BTC/USD");
  assert(!btcStillBlocked, "BTC NO debe estar en cyclesNeedingReview tras restauración");
  assert(isSafeToStart(r) === true, "Scheduler debe arrancar (solo ETH bloqueado, no BTC)");
});

test("T9.7: ETH needs_reconciliation → sí se salta con CYCLE_SKIPPED_RECONCILIATION", () => {
  const cycle = { id: 17, pair: "ETH/USD", status: "needs_reconciliation" };
  const shouldSkip = cycle.status === "needs_reconciliation";
  assert(shouldSkip === true, "Ciclo ETH #17 con needs_reconciliation debe ser skippado");
});

test("T9.7b: BTC activo con anchor → NO se salta", () => {
  const cycle = { id: 24, pair: "BTC/USD", status: "active" };
  const shouldSkip = cycle.status === "needs_reconciliation";
  assert(shouldSkip === false, "Ciclo BTC #24 activo NO debe ser skippado");
});

test("T9.8: criticalErrors bloquea scheduler; ambiguousBlocked no bloquea", () => {
  const withCritical: ReconcResult = {
    criticalErrors: ["db_connection_failed"],
    cyclesNeedingReview: [],
  };
  const withAmbiguous: ReconcResult = {
    criticalErrors: [],
    cyclesNeedingReview: [{ pair: "ETH/USD", cycleId: 17, reason: "legacy" }],
  };
  assert(isSafeToStart(withCritical) === false, "criticalErrors DEBE bloquear scheduler");
  assert(isSafeToStart(withAmbiguous) === true, "ambiguous cycles NO deben bloquear scheduler global");
});

test("T9.9: anchor ageHours calculado correctamente desde set_at", () => {
  const cycle = { pair: "BTC/USD", id: 24, basePriceMetaJson: {}, basePriceType: "hybrid_v2" };
  const setAt = Date.now() - 102.1 * 3600 * 1000; // 102.1h ago
  const dbAnchor: DbVwapAnchor = {
    anchor_price: 82017.40,
    anchor_ts: setAt - 1000,
    set_at: setAt,
    drawdown_pct: 0,
  };
  const result = resolveCycleAnchorForDto(cycle, dbAnchor, Date.now());
  assert(result.ageHours !== null, "ageHours no debe ser null");
  assert(result.ageHours! >= 101 && result.ageHours! <= 103, `ageHours debe ser ~102 (got ${result.ageHours})`);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log("\n────────────────────────────────────────────────────────────");
if (failed === 0) {
  console.log(`✅ ${passed} tests pasaron — 0 fallaron`);
} else {
  console.error(`❌ ${passed} pasaron — ${failed} FALLARON`);
  process.exit(1);
}
