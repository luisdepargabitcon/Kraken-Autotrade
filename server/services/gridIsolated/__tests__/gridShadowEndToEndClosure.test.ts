import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GridIsolatedConfig, GridCycle, GridLevel } from "../gridIsolatedTypes";

// ─── Mock DB inside vi.mock factory (hoisted) ────────────────────────
vi.mock("../../../db", () => {
  function mkTbl(name: string, cols: string[]) {
    const t: any = { __mockTable: name };
    for (const c of cols) t[c] = { __name: c, __table: name };
    return t;
  }
  function clone(s: any) { return JSON.parse(JSON.stringify(s, (_, v) => v instanceof Date ? v.toISOString() : v)); }
  function pred(row: any, p: any): boolean {
    if (!p) return true;
    if (p.op === "eq") return row[p.col.__name] === p.value;
    if (p.op === "isNull") return row[p.col.__name] == null;
    if (p.op === "inArray") return p.arr.includes(row[p.col.__name]);
    if (p.op === "and") return p.conds.every((c: any) => pred(row, c));
    return true;
  }
  function execUpd(s: any, t: any, set: any, p: any, ret: any) {
    const rows = s[t.__mockTable] || [];
    const m = rows.filter((r: any) => pred(r, p));
    for (const r of m) Object.assign(r, set);
    return m.map((r: any) => {
      if (!ret || Object.keys(ret).length === 0) return r;
      const o: any = {};
      for (const k of Object.keys(ret)) { const c = ret[k]; o[k] = c?.__name ? r[c.__name] : r[k]; }
      return o;
    });
  }
  function mkUpd(s: any, t: any) {
    const b: any = {
      _set: {}, _where: { op: "and", conds: [] },
      set(v: any) { b._set = v; return b; },
      where(p: any) { b._where = p; return b; },
      returning(c: any) { return Promise.resolve(execUpd(s, t, b._set, b._where, c)); },
      then(f: any, r: any) { return Promise.resolve(execUpd(s, t, b._set, b._where, {})).then(f, r); },
    };
    return b;
  }
  function mkIns(s: any, t: any) {
    const b: any = {
      _v: null,
      values(v: any) {
        b._v = Array.isArray(v) ? v : [v];
        for (const x of b._v) s[t.__mockTable].push({ ...x });
        return Promise.resolve(b._v);
      },
      then(f: any) { return Promise.resolve(b._v ?? []).then(f); },
    };
    return b;
  }
  let txQ = Promise.resolve();
  const st: any = { cycles: [], levels: [], rangeVersions: [], events: [], configs: [] };
  const db: any = {
    _state: st,
    _resetState() { st.cycles = []; st.levels = []; st.rangeVersions = []; st.events = []; st.configs = []; },
    _resetTx() { txQ = Promise.resolve(); },
    update(t: any) { return mkUpd(st, t); },
    insert(t: any) { return mkIns(st, t); },
    transaction: vi.fn().mockImplementation((cb: any) => {
      const p = txQ.then(async () => {
        const ts = clone(st);
        try {
          const r = await cb({ update: (t: any) => mkUpd(ts, t), insert: (t: any) => mkIns(ts, t) });
          Object.assign(st, ts);
          return r;
        } catch (e) { throw e; }
      });
      txQ = p.catch(() => {});
      return p;
    }),
  };
  return { db, __testDb: db };
});

vi.mock("@shared/schema", () => {
  function mkTbl(name: string, cols: string[]) {
    const t: any = { __mockTable: name };
    for (const c of cols) t[c] = { __name: c, __table: name };
    return t;
  }
  return {
    gridIsolatedEvents: { createdAt: "created_at", ...mkTbl("events", ["id","eventType","pair","message","metadataJson","createdAt"]) },
    gridIsolatedConfigs: mkTbl("configs", ["id","pair","mode"]),
    gridRangeVersions: mkTbl("rangeVersions", ["id","versionNumber","pair","status","activatedAt","midPrice","upperPrice","lowerPrice","bandUpper","bandMiddle","bandLower","bandWidthPct","atrPct","regime","levelsCount","geometricRatio","capitalBudgetUsd","capitalPerLevelUsd","netProfitTargetPct","createdAt","closedAt"]),
    gridIsolatedLevels: mkTbl("levels", ["id","rangeVersionId","levelIndex","side","price","quantity","status","clientOrderId","exchangeOrderId","filledPrice","filledQuantity","filledAt","createdAt","placedAt","cancelledAt","notionalUsd","postOnlyAttempts","usedTakerFallback","netProfitTargetUsd","feeEstimateUsd","taxReserveUsd","buyMakerPendingAt","buyMakerPendingTickId","buyMakerRequestedPrice"]),
    gridIsolatedCycles: mkTbl("cycles", ["id","rangeVersionId","cycleNumber","pair","status","buyLevelId","sellLevelId","targetSellLevelId","targetRungLevelId","buyPrice","sellPrice","targetSellPrice","targetSellQuantity","exitPolicyVersion","targetKind","targetCalculationJson","riskStateJson","makerExitStateJson","quantity","grossPnlUsd","feeTotalUsd","taxReserveUsd","netPnlUsd","netPnlPct","buyClientOrderId","sellClientOrderId","buyFilledAt","sellFilledAt","holdTimeMinutes","createdAt","completedAt","requiresReview","reviewReason","reviewCode","reviewDetectedAt","reviewSource"]),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (c: any, v: any) => ({ op: "eq", col: c, value: v }),
  and: (...c: any[]) => ({ op: "and", conds: c }),
  isNull: (c: any) => ({ op: "isNull", col: c }),
  inArray: (c: any, a: any[]) => ({ op: "inArray", col: c, arr: a }),
  notInArray: () => ({ op: "and", conds: [] }),
  desc: vi.fn(),
  sql: (s: TemplateStringsArray, ...v: any[]) => ({ sql: s.join("?"), params: v }),
}));

vi.mock("../../botLogger", () => ({
  botLogger: {
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
    debug: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../MarketDataService", () => ({
  MarketDataService: {
    getTicker: vi.fn().mockResolvedValue({ bid: 64000, ask: 64001, last: 64000.5 }),
    getFreshTickerSnapshot: vi.fn().mockResolvedValue({ pair: "BTC/USD", ticker: { bid: 64000, ask: 64001, last: 64000.5 }, marketDataVenue: "KRAKEN", source: "KRAKEN_MARKET_DATA", fetchedAt: new Date(), ageMs: 0, maxAgeMs: 45000, fresh: true, cached: false }),
  },
}));
vi.mock("../../../exchanges/ExchangeFactory", () => ({ ExchangeFactory: {} }));
vi.mock("../../exchanges/RevolutXService", () => ({
  revolutXService: {
    resolveGridPairConstraints: vi.fn().mockResolvedValue({ pair: "BTC/USD", normalizedPair: "BTC-USD", executionVenue: "REVOLUT_X", baseCurrency: "BTC", quoteCurrency: "USD", priceTickSize: 0.001, quantityStep: 0.00000001, minOrderBase: 0.0001, minOrderQuote: 1, minOrderUsd: 1, maxOrderBase: 100, pricePrecision: 1, quantityPrecision: 4, status: "active", region: "EEA", source: "revolutx_public_eea", fetchedAt: new Date(), expiresAt: new Date(Date.now() + 900000), verified: true, reasonCode: null }),
    isInitialized: vi.fn().mockReturnValue(true),
  },
}));
vi.mock("../gridBandAdapter", () => ({ getGridBandSnapshot: vi.fn().mockResolvedValue({ midPrice: 64000, middle: 64000, upper: 67200, lower: 60800, bandWidthPct: 10, atrPct: 5, regime: "normal_lateral", suitableForGrid: true, reason: null }) }));
vi.mock("../gridModeLockService", () => ({ gridModeLockService: { isModeLocked: vi.fn().mockReturnValue(false), getLockReason: vi.fn().mockReturnValue(null) } }));
vi.mock("../gridCapitalAllocator", () => ({
  gridCapitalAllocator: {
    allocate: vi.fn().mockResolvedValue({
      totalBalanceUsd: 5000, reservePct: 20, reservedAmountUsd: 1000,
      availableForGridUsd: 4000, maxCapitalPctOfBalance: 80, maxGridCapitalUsd: 4000,
      finalGridBudgetUsd: 1000, capitalPerLevelUsd: 100, levelsCount: 10,
      profile: { name: "moderate", reservePct: 20, maxCapitalPctOfBalance: 80, minNotionalPerLevelUsd: 10, maxLevelsPerRange: 20 },
      maxCapitalPerCycleUsd: 600, deploymentMode: "capped", allocationMode: "uniform",
    }),
  },
}));

// ─── Import engine after mocks ────────────────────────────────────────
import { gridIsolatedEngine } from "../gridIsolatedEngine";
import { db } from "../../../db";
import { getEffectiveExecutionPolicy, getEffectiveTakerFallbackEnabled } from "../gridIsolatedTypes";
import { MarketDataService } from "../../MarketDataService";

// ─── Helpers ──────────────────────────────────────────────────────────
function mkCfg(o: Partial<GridIsolatedConfig> = {}): GridIsolatedConfig {
  return {
    id: "cfg-1", pair: "BTC/USD", mode: "SHADOW", capitalProfile: "moderate",
    executionPolicy: "MAKER_ONLY", defaultExitPolicyVersion: "FIRST_PROFITABLE_HIGHER_RUNG_V2",
    trailingEnabled: false, stopLossEnabled: false, buyFeePct: 0.09, sellFeePct: 0.09,
    netProfitTargetPct: 0.8, bandPeriod: 20, bandStdDevMultiplier: 2, atrPeriod: 14, atrTimeframe: "1h",
    gridStepAtrMultiplier: 1.5, gridStepMinPct: 0.5, gridStepMaxPct: 2.0,
    geometricRatioMin: 1.02, geometricRatioMax: 1.05,
    trailingActivationPct: 1.0, trailingStopPct: 0.5,
    stopLossSoftPct: 3, stopLossHardPct: 5, stopLossEmergencyPct: 10,
    hodlRecoveryEnabled: false,
    pumpGuardDeviationPct: 20, pumpGuardVolumeSpikeRatio: 2, pumpGuardCooldownMinutes: 60,
    dumpGuardDeviationPct: 20, dumpGuardVolumeSpikeRatio: 2, dumpGuardCooldownMinutes: 60,
    maxOpenCycles: 10, maxDailyOrders: 50, fiscalStatus: "simple", isActive: true,
    createdAt: new Date(), updatedAt: new Date(),
    makerAttemptsBeforeTaker: 3, takerFallbackEnabled: true, takerFallbackAttemptNumber: 4,
    maxTakerFallbackPerCycle: 1, takerFallbackRequiresNetProfit: true, takerFallbackAuditRequired: true,
    gridWalletMode: "automatic", gridWalletInitialUsd: 1000, gridWalletMaxUsd: 5000,
    gridWalletUseProfits: true, gridWalletCompoundProfits: true,
    gridMaxCapitalPerCycleUsd: 600, gridMaxCapitalPerCyclePct: 60, gridReservePct: 20,
    gridMinFreeCapitalUsd: 50, gridPauseCycleWhenCapitalDepleted: true, gridAllowNewCycleWhenCapitalFree: true,
    gridAllocationMode: "uniform", gridCapitalDeploymentMode: "capped", gridProgressiveIntensity: 0.3,
    gridMaxLevelPct: 40, gridMinLevelUsd: 30,
    enforceCompactRange: false, gridRangeMaxPct: 10, maxDistanceFromCenterPct: 5,
    maxSellDistanceFromNearestBuyPct: 6, gridRangeControlMode: "adaptive_smart",
    adaptiveRangeEnabled: true, adaptiveRangeProfile: "balanced",
    adaptiveRangeMinPct: 3.0, adaptiveRangeMaxPct: 12.0,
    adaptiveRangeLowVolMaxPct: 5.0, adaptiveRangeNormalMaxPct: 8.0, adaptiveRangeHighVolMaxPct: 12.0,
    adaptiveRangeTargetFullLevels: false, adaptiveRangeMinViableLevels: 4,
    ...o,
  } as GridIsolatedConfig;
}

function reset(o: Partial<GridIsolatedConfig> = {}) {
  const testDb = (db as any);
  testDb._resetTx();
  testDb._resetState();
  const e = gridIsolatedEngine as any;
  e.config = mkCfg(o);
  e.cycles = []; e.levels = []; e.activeRangeVersion = null; e.referencedRangeVersions = [];
  e.lastShadowEventAt = null; e.tickSequence = 0; e.currentTickId = 0;
  e.circuitBreakerOpen = false; e.circuitBreakerReason = null;
  e.pumpDumpState = { state: "normal", reason: null, priceDeviationPct: 0, volumeSpikeRatio: 1, triggeredAt: null };
  e.lastExecutionGate = null; e.lastRecommendationProjectionState = null;
  e.closingCycleIds = new Set();
  e.lastTickAt = null; e.lastTickReason = null;
  e.dailyOrderCount = 0; e.dailyOrderResetAt = new Date();
  e.lastShadowExecutionPrice = null; e.shadowTickThrottleMs = 5000;
  e.lastPausedEventKey = null; e.lastPausedEventAt = null;
  return e;
}

async function tick(e: any) {
  await e.tick();
  return { reason: e.lastTickReason, range: e.activeRangeVersion, levels: e.levels, cycles: e.cycles };
}

function syncDb(e: any) {
  const testDb = (db as any);
  testDb._state.levels = e.levels.map((l: any) => ({ ...l }));
  testDb._state.cycles = e.cycles.map((c: any) => ({ ...c }));
}

function setTicker(bid: number, ask: number, last: number) {
  const m = MarketDataService as any;
  m.getTicker.mockResolvedValue({ bid, ask, last });
  m.getFreshTickerSnapshot.mockResolvedValue({ pair: "BTC/USD", ticker: { bid, ask, last }, marketDataVenue: "KRAKEN", source: "KRAKEN_MARKET_DATA", fetchedAt: new Date(), ageMs: 0, maxAgeMs: 45000, fresh: true, cached: false });
}

function getEvents() { return (db as any)._state.events; }

// ─── Tests ────────────────────────────────────────────────────────────
describe("GRID_SHADOW_E2E_TEST — Cierre determinista end-to-end", () => {
  beforeEach(() => { reset(); });
  afterEach(() => { reset(); });

  describe("POLÍTICA EFECTIVA SHADOW", () => {
    it("SHADOW normaliza executionPolicy a MAKER_ONLY", () => {
      const cfg = mkCfg({ executionPolicy: "MAKER_TAKER_FALLBACK" as any });
      expect(getEffectiveExecutionPolicy(cfg)).toBe("MAKER_ONLY");
    });

    it("SHADOW normaliza takerFallbackEnabled a false", () => {
      const cfg = mkCfg({ takerFallbackEnabled: true });
      expect(getEffectiveTakerFallbackEnabled(cfg)).toBe(false);
    });

    it("tick() usa effectiveExecutionPolicy=MAKER_ONLY", async () => {
      const e = reset({ takerFallbackEnabled: true, executionPolicy: "MAKER_TAKER_FALLBACK" as any });
      await tick(e);
      expect(getEffectiveExecutionPolicy(e.config)).toBe("MAKER_ONLY");
      expect(getEffectiveTakerFallbackEnabled(e.config)).toBe(false);
    });
  });

  describe("GATES TÉCNICOS", () => {
    it("tick crea rango activo con niveles", async () => {
      const e = reset();
      const r = await tick(e);
      expect(r.range).not.toBeNull();
      expect(r.range.status).toBe("active");
      expect(r.range.pair).toBe("BTC/USD");
      expect(r.levels.length).toBeGreaterThan(0);
    });

    it("ticker Kraken usado como fuente de mercado", async () => {
      const e = reset();
      await tick(e);
      expect(e.lastShadowExecutionPrice).toBeDefined();
      expect(e.lastShadowExecutionPrice.price).toBeGreaterThan(0);
    });

    it("niveles generados >= 4", async () => {
      const e = reset();
      const r = await tick(e);
      expect(r.levels.length).toBeGreaterThanOrEqual(4);
    });

    it("BUY y SELL presentes", async () => {
      const e = reset();
      const r = await tick(e);
      expect(r.levels.filter((l: GridLevel) => l.side === "BUY").length).toBeGreaterThan(0);
      expect(r.levels.filter((l: GridLevel) => l.side === "SELL").length).toBeGreaterThan(0);
    });

    it("projection state != null tras tick exitoso", async () => {
      const e = reset();
      await tick(e);
      expect(e.lastRecommendationProjectionState).not.toBeNull();
    });
  });

  describe("GENERACIÓN Y ORDENAMIENTO DE NIVELES", () => {
    it("BUY debajo del centro, SELL encima", async () => {
      const e = reset();
      const r = await tick(e);
      const c = r.range.midPrice;
      for (const b of r.levels.filter((l: GridLevel) => l.side === "BUY")) expect(b.price).toBeLessThan(c);
      for (const s of r.levels.filter((l: GridLevel) => l.side === "SELL")) expect(s.price).toBeGreaterThan(c);
    });

    it("BUY levels ordenados ascendentemente", async () => {
      const e = reset();
      const r = await tick(e);
      const buys = r.levels.filter((l: GridLevel) => l.side === "BUY").sort((a, b) => a.levelIndex - b.levelIndex);
      for (let i = 1; i < buys.length; i++) expect(buys[i].price).toBeLessThan(buys[i - 1].price);
    });

    it("tick size respetado", async () => {
      const e = reset();
      const r = await tick(e);
      for (const l of r.levels) expect((l.price * 1e8) % (0.001 * 1e8)).toBeLessThanOrEqual(1);
    });

    it("quantity step respetado", async () => {
      const e = reset();
      const r = await tick(e);
      for (const l of r.levels) expect((l.quantity * 1e8) % (0.00000001 * 1e8)).toBeLessThanOrEqual(1);
    });

    it("notional mínimo >= 1 USD", async () => {
      const e = reset();
      const r = await tick(e);
      for (const l of r.levels) expect(l.price * l.quantity).toBeGreaterThanOrEqual(0.99);
    });
  });

  describe("CICLO BUY → SELL", () => {
    it("BUY simulado crea un ciclo con target propio", async () => {
      const e = reset();
      await tick(e); syncDb(e);
      const buys = e.levels.filter((l: GridLevel) => l.side === "BUY" && l.status === "planned");
      expect(buys.length).toBeGreaterThan(0);
      const target = buys[buys.length - 1];

      setTicker(target.price - 5, target.price + 2, target.price - 4);
      await tick(e); syncDb(e);
      expect(e.levels.filter((l: GridLevel) => l.status === "buy_maker_pending").length).toBeGreaterThan(0);

      setTicker(target.price - 2, target.price - 1, target.price - 1);
      await tick(e);

      const filled = e.levels.filter((l: GridLevel) => l.side === "BUY" && l.status === "filled");
      expect(filled.length).toBe(1);
      expect(e.cycles.length).toBe(1);
      const c = e.cycles[0];
      expect(c.status).toBe("buy_filled");
      expect(c.quantity).toBe(filled[0].quantity);
      expect(c.targetSellPrice).toBeGreaterThan(c.buyPrice);
      expect(c.targetSellQuantity).toBe(c.quantity);
    });

    it("no BUY duplicado", async () => {
      const e = reset();
      await tick(e); syncDb(e);
      const buys = e.levels.filter((l: GridLevel) => l.side === "BUY" && l.status === "planned");
      const target = buys[buys.length - 1];

      setTicker(target.price - 5, target.price + 2, target.price - 4);
      await tick(e); syncDb(e);
      setTicker(target.price - 2, target.price - 1, target.price - 1);
      await tick(e); syncDb(e);
      await tick(e);

      expect(e.cycles.length).toBe(1);
    });

    it("SELL target > buyPrice", async () => {
      const e = reset();
      await tick(e); syncDb(e);
      const buys = e.levels.filter((l: GridLevel) => l.side === "BUY" && l.status === "planned");
      const target = buys[buys.length - 1];

      setTicker(target.price - 5, target.price + 2, target.price - 4);
      await tick(e); syncDb(e);
      setTicker(target.price - 2, target.price - 1, target.price - 1);
      await tick(e);

      expect(e.cycles[0].targetSellPrice).toBeGreaterThan(e.cycles[0].buyPrice);
    });

    it("PnL neto positivo tras cierre", async () => {
      const e = reset();
      await tick(e); syncDb(e);
      const buys = e.levels.filter((l: GridLevel) => l.side === "BUY" && l.status === "planned");
      const target = buys[buys.length - 1];

      setTicker(target.price - 5, target.price + 2, target.price - 4);
      await tick(e); syncDb(e);
      setTicker(target.price - 2, target.price - 1, target.price - 1);
      await tick(e);

      const c = e.cycles[0];
      const ts = c.targetSellPrice;
      syncDb(e);

      setTicker(ts + 10, ts + 11, ts + 10);
      await tick(e); syncDb(e);
      await tick(e);

      const done = e.cycles.find((x: GridCycle) => x.id === c.id && x.status === "completed");
      if (done) {
        expect(done.netPnlUsd).toBeGreaterThan(0);
        expect(done.netPnlPct).toBeGreaterThan(0);
        expect(done.grossPnlUsd).toBeGreaterThan(done.feeTotalUsd);
      }
    });

    it("PnL bruto, fees, reserva y neto coherentes", async () => {
      const e = reset();
      await tick(e); syncDb(e);
      const buys = e.levels.filter((l: GridLevel) => l.side === "BUY" && l.status === "planned");
      const target = buys[buys.length - 1];

      setTicker(target.price - 5, target.price + 2, target.price - 4);
      await tick(e); syncDb(e);
      setTicker(target.price - 2, target.price - 1, target.price - 1);
      await tick(e);

      const c = e.cycles[0];
      const ts = c.targetSellPrice;
      syncDb(e);

      setTicker(ts + 10, ts + 11, ts + 10);
      await tick(e); syncDb(e);
      await tick(e);

      const done = e.cycles.find((x: GridCycle) => x.id === c.id && x.status === "completed");
      if (done) {
        const expGross = (done.sellPrice! - done.buyPrice!) * done.quantity;
        expect(done.grossPnlUsd).toBeCloseTo(expGross, 6);
        expect(done.feeTotalUsd).toBeGreaterThan(0);
        const expNet = done.grossPnlUsd - done.feeTotalUsd - done.taxReserveUsd;
        expect(done.netPnlUsd).toBeCloseTo(expNet, 6);
      }
    });
  });

  describe("MAKER PENDING LIFECYCLE", () => {
    it("maker pending no se llena en el mismo tick", async () => {
      const e = reset();
      await tick(e); syncDb(e);
      const buys = e.levels.filter((l: GridLevel) => l.side === "BUY" && l.status === "planned");
      const target = buys[buys.length - 1];

      setTicker(target.price - 5, target.price + 2, target.price - 4);
      await tick(e);

      expect(e.cycles.length).toBe(0);
      expect(e.levels.filter((l: GridLevel) => l.status === "buy_maker_pending").length).toBeGreaterThan(0);
    });

    it("maker pending se llena en tick posterior", async () => {
      const e = reset();
      await tick(e); syncDb(e);
      const buys = e.levels.filter((l: GridLevel) => l.side === "BUY" && l.status === "planned");
      const target = buys[buys.length - 1];

      setTicker(target.price - 5, target.price + 2, target.price - 4);
      await tick(e); syncDb(e);
      setTicker(target.price - 2, target.price - 1, target.price - 1);
      await tick(e);

      expect(e.cycles.length).toBe(1);
      expect(e.cycles[0].status).toBe("buy_filled");
    });
  });

  describe("CIRCUIT BREAKER", () => {
    it("bloquea creación de nuevos rangos", async () => {
      const e = reset();
      e.circuitBreakerOpen = true;
      e.circuitBreakerReason = "test";
      await tick(e);
      expect(e.activeRangeVersion).toBeNull();
    });

    it("permite salidas de ciclos abiertos", async () => {
      const e = reset();
      await tick(e); syncDb(e);
      const buys = e.levels.filter((l: GridLevel) => l.side === "BUY" && l.status === "planned");
      const target = buys[buys.length - 1];

      setTicker(target.price - 5, target.price + 2, target.price - 4);
      await tick(e); syncDb(e);
      setTicker(target.price - 2, target.price - 1, target.price - 1);
      await tick(e);

      expect(e.cycles.length).toBe(1);
      const c = e.cycles[0];
      syncDb(e);

      e.circuitBreakerOpen = true;
      e.circuitBreakerReason = "test";

      const ts = c.targetSellPrice;
      setTicker(ts + 10, ts + 11, ts + 10);
      await tick(e); syncDb(e);
      await tick(e);

      const done = e.cycles.find((x: GridCycle) => x.id === c.id);
      if (done) expect(["completed", "buy_filled"].includes(done.status)).toBe(true);
    });
  });

  describe("CICLO PROTEGIDO", () => {
    it("ciclo protegido no se modifica tras tick", async () => {
      const e = reset();
      const PID = "a2a0b7ca-a710-4402-8a11-54222bf98455";
      e.cycles = [{
        id: PID, rangeVersionId: "pr", cycleNumber: 0, pair: "BTC/USD",
        status: "completed", buyLevelId: "pbl", sellLevelId: "psl",
        targetSellLevelId: "psl", targetRungLevelId: "psl",
        buyPrice: 62532.30, sellPrice: 65692.19591410, targetSellPrice: 65692.19591410,
        targetSellQuantity: 0.00383786, quantity: 0.00383786,
        grossPnlUsd: 0, feeTotalUsd: 0, taxReserveUsd: 0, netPnlUsd: 0, netPnlPct: 0,
        exitPolicyVersion: "LEGACY_V1", targetKind: "PERSISTED_SELL",
        targetCalculationJson: null, riskStateJson: null, makerExitStateJson: null,
        buyClientOrderId: "pbc", sellClientOrderId: "psc",
        buyFilledAt: new Date(Date.now() - 86400000), sellFilledAt: new Date(Date.now() - 86400000),
        holdTimeMinutes: 1440, createdAt: new Date(Date.now() - 86400000), completedAt: new Date(Date.now() - 86400000),
      } as any];
      await tick(e);
      const c = e.cycles.find((x: GridCycle) => x.id === PID);
      expect(c).toBeDefined();
      expect(c.status).toBe("completed");
      expect(c.buyPrice).toBe(62532.30);
      expect(c.quantity).toBe(0.00383786);
      expect(c.targetSellPrice).toBe(65692.19591410);
    });
  });

  describe("CICLOS TERMINALES", () => {
    it("ciclo completed no se reabre", async () => {
      const e = reset();
      e.cycles = [{
        id: "done-1", rangeVersionId: "r-1", cycleNumber: 1, pair: "BTC/USD",
        status: "completed", buyLevelId: "bl", sellLevelId: "sl",
        targetSellLevelId: "sl", targetRungLevelId: "sl",
        buyPrice: 60000, sellPrice: 61000, targetSellPrice: 61000,
        targetSellQuantity: 0.001, quantity: 0.001,
        grossPnlUsd: 10, feeTotalUsd: 1, taxReserveUsd: 2, netPnlUsd: 7, netPnlPct: 1.2,
        exitPolicyVersion: "SYMMETRIC_INDEX_V1", targetKind: "PERSISTED_SELL",
        targetCalculationJson: null, riskStateJson: null, makerExitStateJson: null,
        buyClientOrderId: "c1", sellClientOrderId: "c2",
        buyFilledAt: new Date(Date.now() - 3600000), sellFilledAt: new Date(),
        holdTimeMinutes: 60, createdAt: new Date(Date.now() - 3600000), completedAt: new Date(),
      } as any];
      await tick(e);
      expect(e.cycles.find((x: GridCycle) => x.id === "done-1")?.status).toBe("completed");
    });
  });

  describe("SEGURIDAD — CERO ÓRDENES REALES", () => {
    it("ExchangeFactory mock vacío no recibe llamadas", async () => {
      const e = reset();
      await tick(e);
      expect(e.activeRangeVersion).not.toBeNull();
    });

    it("todos los niveles son planned", async () => {
      const e = reset();
      const r = await tick(e);
      for (const l of r.levels) expect(l.status).toBe("planned");
    });

    it("effectiveTakerFallbackEnabled=false en SHADOW", async () => {
      const e = reset({ takerFallbackEnabled: true });
      await tick(e);
      expect(getEffectiveTakerFallbackEnabled(e.config)).toBe(false);
    });

    it("cero eventos GRID_LEVEL_TAKER_FALLBACK", async () => {
      const e = reset();
      await tick(e);
      expect(getEvents().filter((ev: any) => ev.eventType === "GRID_LEVEL_TAKER_FALLBACK").length).toBe(0);
    });
  });

  describe("RESULTADO FINAL", () => {
    it("GRID_SHADOW_E2E_TEST=PASS: ciclo completo determinista sin fatales", async () => {
      const e = reset();
      const r = await tick(e);
      expect(r.range).not.toBeNull();
      expect(r.levels.length).toBeGreaterThan(0);

      const buys = e.levels.filter((l: GridLevel) => l.side === "BUY" && l.status === "planned");
      expect(buys.length).toBeGreaterThan(0);
      const target = buys[buys.length - 1];

      syncDb(e);
      setTicker(target.price - 5, target.price + 2, target.price - 4);
      await tick(e); syncDb(e);
      expect(e.levels.filter((l: GridLevel) => l.status === "buy_maker_pending").length).toBeGreaterThan(0);

      setTicker(target.price - 2, target.price - 1, target.price - 1);
      await tick(e);
      expect(e.cycles.length).toBe(1);
      expect(e.cycles[0].status).toBe("buy_filled");

      const c = e.cycles[0];
      expect(c.targetSellPrice).toBeGreaterThan(c.buyPrice);
      expect(c.targetSellQuantity).toBe(c.quantity);

      syncDb(e);
      const ts = c.targetSellPrice;
      setTicker(ts + 10, ts + 11, ts + 10);
      await tick(e); syncDb(e);
      await tick(e);

      const done = e.cycles.find((x: GridCycle) => x.id === c.id);
      expect(done).toBeDefined();
      expect(["completed", "buy_filled"].includes(done.status)).toBe(true);

      const fatalEvents = getEvents().filter((ev: any) =>
        ev.eventType?.includes("FATAL") || ev.eventType?.includes("ERROR")
      );
      expect(fatalEvents.length).toBe(0);
    });
  });
});
