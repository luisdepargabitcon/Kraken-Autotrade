import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import {
  buildCanonicalSeedPlan,
  type SeedTranchePlanInput,
} from "../server/services/ama/amaDeterministicEngine";
import {
  makeAdaptiveDecision,
  createCooldownState,
  applyCooldown,
  createPeriodLimitState,
  applyTrancheToPeriod,
  type CooldownState,
  type PeriodLimitState,
} from "../server/services/ama/amaAdaptivePlanner";
import {
  bootstrapHWM,
  processIncrementalClose,
  freezeHWM,
  computeATR,
  computeDropPct,
  type HighWaterMark,
  type Candle as AmaCandle,
} from "../server/services/ama/amaHwmBar";
import {
  determineExitPhase,
  createExitStrategy,
  shouldTriggerTrailingStop,
  computeDistributionSize,
} from "../server/services/ama/amaProtectionExits";
import {
  BTC_SEED_POLICY,
  BTC_SEED_TRANCHES,
} from "../server/services/ama/amaSeedTypes";
import type {
  AmaResolvedParameters,
  AmaCycle,
  AmaTranchePlan,
} from "../server/services/ama/amaTypes";

/**
 * AMA Quantitative Audit — research-only.
 *
 * Goals:
 * 1) Exercise canonical BTC seed entries using the actual pure AMA engine functions.
 * 2) Separate canonical entry quality from exit logic, because BTC exits are currently
 *    explicitly LAB_HYPOTHESIS in amaSeedTypes.ts.
 * 3) Compare against 100% Buy & Hold and 75% BTC + 25% cash benchmark.
 * 4) Run execution/fee sensitivity and historical stress windows.
 *
 * SAFETY: no DB, no private exchange API, no real orders, no VPS writes.
 */

const OUT_DIR = "artifacts/ama-quant-audit";
const BINANCE_CSV_URL =
  "https://raw.githubusercontent.com/riba2534/bitcoin-cycle-analysis/main/data/btcusdt_1d.csv";
const KRAKEN_OHLC_URL =
  "https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440";

const INITIAL_CAPITAL = 10_000;
const WARMUP_DAYS = 200;
const MIN_WARMUP_DAYS = 90;
const REVERSAL_THRESHOLD_PCT = BTC_SEED_POLICY.fixedReversalCenterPct;
const REQUIRED_CONFIRMATIONS = BTC_SEED_POLICY.requiredDailyCloses;
const FEE_BPS_SET = [0, 10, 25];

type FillTiming = "SAME_CLOSE" | "NEXT_OPEN";
type StrategyVariant =
  | "AMA_ENTRY_CANONICAL_HOLD"
  | "AMA_EXIT_DEFINED_RUNNER_HOLD"
  | "AMA_EXIT_EXPERIMENTAL_RUNNER_TRAIL";

interface Candle {
  date: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
}

interface Trade {
  date: string;
  side: "BUY" | "SELL";
  reason: string;
  price: number;
  grossUsd: number;
  feeUsd: number;
  quantity: number;
  trancheIndex?: number;
  hwm?: number;
  dropPct?: number;
}

interface DailyPoint {
  date: string;
  equity: number;
  cash: number;
  btc: number;
  close: number;
  costBasisUsd: number;
  hwm: number | null;
  hwmState: string | null;
}

interface Metrics {
  startDate: string;
  endDate: string;
  days: number;
  startingEquity: number;
  endingEquity: number;
  totalReturnPct: number;
  cagrPct: number | null;
  maxDrawdownPct: number;
  annualizedVolPct: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  buys: number;
  sells: number;
  turnoverUsd: number;
  feesUsd: number;
  maxCapitalDeployedUsd: number;
  maxExposurePct: number;
  timeInvestedPct: number;
  finalBtc: number;
  weightedAvgBuyPrice: number | null;
}

interface RunResult {
  variant: StrategyVariant;
  fillTiming: FillTiming;
  feeBps: number;
  period: string;
  source: string;
  metrics: Metrics;
  trades: Trade[];
  daily: DailyPoint[];
  notes: string[];
  deterministicHash: string;
}

interface PeriodDef {
  name: string;
  start: string;
  end: string;
}

const PERIODS: PeriodDef[] = [
  { name: "FULL_AVAILABLE", start: "2018-03-05", end: "2026-02-01" },
  { name: "2018_BEAR", start: "2017-12-17", end: "2018-12-15" },
  { name: "COVID_2020", start: "2020-02-14", end: "2020-04-30" },
  { name: "2021_MID_CORRECTION", start: "2021-04-14", end: "2021-07-20" },
  { name: "2021_2022_BEAR", start: "2021-11-10", end: "2022-11-21" },
  { name: "2022_2025_EXPANSION", start: "2022-11-21", end: "2025-12-31" },
];

function canonicalParams(capital: number): AmaResolvedParameters {
  return {
    mandatoryReservePct: 25,
    maxSingleTranchePct: 15,
    maxCycleDeploymentPct: 75,
    maxWeeklyDeploymentPct: 30,
    maxMonthlyDeploymentPct: 60,
    minimumSpacingPct: 5,
    spacingAtrMultiplier: 3.0,
    minimumDataCoveragePct: 90,
    requiredConfirmationStrength: 3,
    cooldownPolicy: "1_daily",
    maximumCandidateTranches: 6,
    absoluteSafetyCap: capital,
    absoluteCapitalCapUsd: capital,
    absoluteTrancheCountCap: 6,
    spreadTolerancePct: 0.5,
    crossVenueBasisTolerancePct: 1.0,
    profitRecoveryPolicy: "trailing",
    deRiskPolicy: "gradual",
    runnerPolicy: "50_pct",
    trailingPolicy: "atr_based",
    thesisInvalidationPolicy: "strict",
    asset: "BTC",
  };
}

function finite(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric value: ${v}`);
  return n;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "kraken-autotrade-ama-quant-audit/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return await res.text();
}

async function loadBinanceDataset(): Promise<Candle[]> {
  const text = await fetchText(BINANCE_CSV_URL);
  const lines = text.trim().split(/\r?\n/);
  const header = lines.shift();
  if (!header?.startsWith("date,open,high,low,close")) {
    throw new Error("Unexpected Binance research CSV header");
  }
  const candles: Candle[] = [];
  for (const line of lines) {
    const p = line.split(",");
    if (p.length < 6) continue;
    const date = p[0];
    candles.push({
      date,
      timestamp: `${date}T23:59:59.000Z`,
      open: finite(p[1]),
      high: finite(p[2]),
      low: finite(p[3]),
      close: finite(p[4]),
      volume: finite(p[5]),
      source: "BINANCE_BTCUSDT_RESEARCH_MIRROR",
    });
  }
  candles.sort((a, b) => a.date.localeCompare(b.date));
  return candles;
}

async function loadKrakenRecent(): Promise<Candle[]> {
  const text = await fetchText(KRAKEN_OHLC_URL);
  const parsed = JSON.parse(text);
  if (parsed.error?.length) throw new Error(`Kraken OHLC error: ${parsed.error.join(",")}`);
  const key = Object.keys(parsed.result).find((k) => k !== "last");
  if (!key) throw new Error("Kraken OHLC result missing pair key");
  const rows = parsed.result[key] as unknown[][];
  const today = new Date().toISOString().slice(0, 10);
  return rows
    .map((r) => {
      const ts = finite(r[0]) * 1000;
      const date = new Date(ts).toISOString().slice(0, 10);
      return {
        date,
        timestamp: `${date}T23:59:59.000Z`,
        open: finite(r[1]),
        high: finite(r[2]),
        low: finite(r[3]),
        close: finite(r[4]),
        volume: finite(r[6]),
        source: "KRAKEN_XBTUSD_PUBLIC_OHLC",
      } as Candle;
    })
    .filter((c) => c.date < today)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function toAmaCandles(candles: Candle[]): AmaCandle[] {
  return candles.map((c) => ({
    timestamp: c.timestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

function toDailyClose(c: Candle) {
  return { timestamp: c.timestamp, close: c.close, isClosed: true as const };
}

function clonePlanDisablingExecuted(plan: AmaTranchePlan, executed: Set<number>): AmaTranchePlan {
  return {
    ...plan,
    candidateTranches: plan.candidateTranches.map((c) => {
      const idx = c.seedTrancheIndex;
      if (idx !== undefined && executed.has(idx)) {
        return {
          ...c,
          eligible: false,
          eligibilityReasons: [...c.eligibilityReasons, "ALREADY_FULLY_EXECUTED"],
          executionState: "FULLY_EXECUTED" as const,
          executedAmountUsd: c.plannedAmountUsd ?? c.amountUsd,
          remainingAmountUsd: 0,
        };
      }
      return c;
    }),
  };
}

function makeCycle(
  cycleId: string,
  hwm: HighWaterMark | null,
  budgetUsd: number,
  deployedUsd: number,
  btc: number,
  costBasisUsd: number,
  cycleLow: number | null,
  currentClose: number,
): AmaCycle {
  const avg = btc > 0 ? costBasisUsd / btc : null;
  return {
    cycleId,
    asset: "BTC",
    pair: "BTC/USD",
    mode: "REPLAY",
    state: btc > 0 ? "POSITION_OPEN" : "ACCUMULATING",
    highWaterMark: hwm?.price ?? null,
    ceilingConfirmedAt: hwm?.confirmedAt ?? null,
    cycleLow,
    cycleLowAt: null,
    maxDropPct: hwm && cycleLow ? computeDropPct(hwm.price, cycleLow) : null,
    currentDropPct: hwm ? computeDropPct(hwm.price, currentClose) : null,
    reboundFromLowPct: cycleLow && cycleLow > 0 ? ((currentClose - cycleLow) / cycleLow) * 100 : null,
    budgetUsd,
    deployedUsd,
    reservedUsd: 0,
    freeUsd: Math.max(0, budgetUsd - deployedUsd),
    accumulatedQuantity: btc,
    averageCostBasis: avg,
    activePolicyId: BTC_SEED_POLICY.policyId,
    createdAt: hwm?.timestamp ?? new Date(0).toISOString(),
    closedAt: null,
  };
}

function nextDayIndex(candles: Candle[], i: number): number | null {
  return i + 1 < candles.length ? i + 1 : null;
}

function buildPeriodStateFromDecision(
  decision: ReturnType<typeof makeAdaptiveDecision>,
  prior: PeriodLimitState,
): PeriodLimitState {
  return {
    weekStart: decision.effectiveWeekStart ?? prior.weekStart,
    monthStart: decision.effectiveMonthStart ?? prior.monthStart,
    weeklyDeployedUsd: decision.effectiveWeeklyDeployedUsd ?? prior.weeklyDeployedUsd,
    monthlyDeployedUsd: decision.effectiveMonthlyDeployedUsd ?? prior.monthlyDeployedUsd,
  };
}

function maxDrawdown(equities: number[]): number {
  let peak = equities[0] ?? 0;
  let worst = 0;
  for (const e of equities) {
    peak = Math.max(peak, e);
    if (peak > 0) worst = Math.min(worst, (e / peak) - 1);
  }
  return Math.abs(worst) * 100;
}

function std(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function summarize(daily: DailyPoint[], trades: Trade[], initialCapital: number): Metrics {
  if (daily.length === 0) throw new Error("Cannot summarize empty daily series");
  const equities = daily.map((d) => d.equity);
  const returns: number[] = [];
  for (let i = 1; i < equities.length; i++) {
    if (equities[i - 1] > 0) returns.push(equities[i] / equities[i - 1] - 1);
  }
  const start = equities[0];
  const end = equities[equities.length - 1];
  const totalReturn = start > 0 ? end / start - 1 : 0;
  const years = Math.max(1 / 365.25, daily.length / 365.25);
  const cagr = start > 0 && end > 0 ? (end / start) ** (1 / years) - 1 : null;
  const dailyStd = std(returns);
  const meanDaily = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const negative = returns.filter((r) => r < 0);
  const downsideStd = std(negative);
  const sharpe = dailyStd && dailyStd > 0 ? (meanDaily / dailyStd) * Math.sqrt(365) : null;
  const sortino = downsideStd && downsideStd > 0 ? (meanDaily / downsideStd) * Math.sqrt(365) : null;
  const mdd = maxDrawdown(equities);
  const calmar = cagr !== null && mdd > 0 ? (cagr * 100) / mdd : null;
  const buys = trades.filter((t) => t.side === "BUY");
  const sells = trades.filter((t) => t.side === "SELL");
  const turnoverUsd = trades.reduce((s, t) => s + t.grossUsd, 0);
  const feesUsd = trades.reduce((s, t) => s + t.feeUsd, 0);
  const maxCapitalDeployedUsd = Math.max(0, ...daily.map((d) => d.costBasisUsd));
  const maxExposurePct = Math.max(
    0,
    ...daily.map((d) => d.equity > 0 ? ((d.btc * d.close) / d.equity) * 100 : 0),
  );
  const investedDays = daily.filter((d) => d.btc > 1e-12).length;
  const buyGross = buys.reduce((s, t) => s + t.grossUsd, 0);
  const buyQty = buys.reduce((s, t) => s + t.quantity, 0);
  return {
    startDate: daily[0].date,
    endDate: daily[daily.length - 1].date,
    days: daily.length,
    startingEquity: start,
    endingEquity: end,
    totalReturnPct: totalReturn * 100,
    cagrPct: cagr === null ? null : cagr * 100,
    maxDrawdownPct: mdd,
    annualizedVolPct: dailyStd === null ? null : dailyStd * Math.sqrt(365) * 100,
    sharpe,
    sortino,
    calmar,
    buys: buys.length,
    sells: sells.length,
    turnoverUsd,
    feesUsd,
    maxCapitalDeployedUsd,
    maxExposurePct,
    timeInvestedPct: (investedDays / daily.length) * 100,
    finalBtc: daily[daily.length - 1].btc,
    weightedAvgBuyPrice: buyQty > 0 ? buyGross / buyQty : null,
  };
}

function hashRun(result: Omit<RunResult, "deterministicHash">): string {
  const compact = {
    variant: result.variant,
    fillTiming: result.fillTiming,
    feeBps: result.feeBps,
    period: result.period,
    source: result.source,
    trades: result.trades,
    metrics: result.metrics,
  };
  return createHash("sha256").update(JSON.stringify(compact)).digest("hex");
}

function benchmark(
  candles: Candle[],
  btcPct: number,
  feeBps: number,
  label: string,
): { label: string; metrics: Metrics; daily: DailyPoint[] } {
  const fee = feeBps / 10_000;
  const first = candles[0];
  const gross = INITIAL_CAPITAL * btcPct;
  const feeUsd = gross * fee;
  const netForBtc = gross - feeUsd;
  const qty = netForBtc / first.close;
  const cash = INITIAL_CAPITAL - gross;
  const daily = candles.map((c) => ({
    date: c.date,
    equity: cash + qty * c.close,
    cash,
    btc: qty,
    close: c.close,
    costBasisUsd: gross,
    hwm: null,
    hwmState: null,
  }));
  const trades: Trade[] = [{
    date: first.date,
    side: "BUY",
    reason: label,
    price: first.close,
    grossUsd: gross,
    feeUsd,
    quantity: qty,
  }];
  return { label, metrics: summarize(daily, trades, INITIAL_CAPITAL), daily };
}

function windowWithWarmup(all: Candle[], period: PeriodDef): { warmup: Candle[]; test: Candle[]; warmupShort: boolean } {
  const startIdx = all.findIndex((c) => c.date >= period.start);
  if (startIdx < 0) throw new Error(`Period ${period.name}: start outside dataset`);
  let endIdx = -1;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].date <= period.end) { endIdx = i; break; }
  }
  if (endIdx < startIdx) throw new Error(`Period ${period.name}: end before start/outside dataset`);
  const warmupStart = Math.max(0, startIdx - WARMUP_DAYS);
  const warmup = all.slice(warmupStart, startIdx);
  const test = all.slice(startIdx, endIdx + 1);
  if (warmup.length < MIN_WARMUP_DAYS) {
    throw new Error(`Period ${period.name}: only ${warmup.length} warmup days (<${MIN_WARMUP_DAYS})`);
  }
  return { warmup, test, warmupShort: warmup.length < WARMUP_DAYS };
}

interface PendingBuy {
  trancheIndex: number;
  amountUsd: number;
  hwm: number;
  dropPct: number;
  reason: string;
  decisionDate: string;
}

function simulate(
  warmup: Candle[],
  candles: Candle[],
  variant: StrategyVariant,
  fillTiming: FillTiming,
  feeBps: number,
  periodName: string,
): RunResult {
  const fee = feeBps / 10_000;
  const params = canonicalParams(INITIAL_CAPITAL);
  const closesWarmup = warmup.map(toDailyClose);
  let hwm = bootstrapHWM(closesWarmup, REQUIRED_CONFIRMATIONS, REVERSAL_THRESHOLD_PCT);
  if (!hwm) throw new Error(`${periodName}: HWM bootstrap failed`);

  let cash = INITIAL_CAPITAL;
  let btc = 0;
  let costBasisUsd = 0;
  let realizedPnlUsd = 0;
  let executed = new Set<number>();
  let cycleId = `audit-${periodName}-1`;
  let cycleCounter = 1;
  let cycleLow: number | null = null;
  let highestSinceEntry: number | null = null;
  let partialDistributed = false;
  let pendingBuy: PendingBuy | null = null;
  let cooldown: CooldownState = createCooldownState(params.cooldownPolicy);
  let periodState: PeriodLimitState = createPeriodLimitState(candles[0].timestamp);
  const trades: Trade[] = [];
  const daily: DailyPoint[] = [];
  const allSeen: Candle[] = [...warmup];

  const resetCycleAfterExit = (c: Candle) => {
    cycleCounter += 1;
    cycleId = `audit-${periodName}-${cycleCounter}`;
    hwm = {
      hwmId: `hwm-${c.timestamp}`,
      price: c.close,
      timestamp: c.timestamp,
      status: "CANDIDATE",
      confirmedAt: null,
      supersededBy: null,
    };
    executed = new Set<number>();
    cycleLow = null;
    highestSinceEntry = null;
    partialDistributed = false;
    pendingBuy = null;
  };

  const executeBuy = (c: Candle, p: PendingBuy, price: number) => {
    const maxSpend = Math.max(0, cash);
    const gross = Math.min(p.amountUsd, maxSpend);
    if (gross <= 0) return;
    const feeUsd = gross * fee;
    const qty = (gross - feeUsd) / price;
    cash -= gross;
    btc += qty;
    costBasisUsd += gross;
    executed.add(p.trancheIndex);
    cycleLow = cycleLow === null ? c.close : Math.min(cycleLow, c.close);
    highestSinceEntry = highestSinceEntry === null ? c.close : Math.max(highestSinceEntry, c.close);
    trades.push({
      date: c.date,
      side: "BUY",
      reason: p.reason,
      price,
      grossUsd: gross,
      feeUsd,
      quantity: qty,
      trancheIndex: p.trancheIndex,
      hwm: p.hwm,
      dropPct: p.dropPct,
    });
    cooldown = applyCooldown(cooldown, c.timestamp);
    periodState = applyTrancheToPeriod(periodState, gross, c.timestamp);
    if (hwm && hwm.status !== "FROZEN") hwm = freezeHWM(hwm);
  };

  const executeSell = (c: Candle, qty: number, reason: string) => {
    qty = Math.min(qty, btc);
    if (qty <= 0) return;
    const beforeQty = btc;
    const avgCost = beforeQty > 0 ? costBasisUsd / beforeQty : 0;
    const gross = qty * c.close;
    const feeUsd = gross * fee;
    const proceeds = gross - feeUsd;
    cash += proceeds;
    btc -= qty;
    const basisSold = avgCost * qty;
    costBasisUsd = Math.max(0, costBasisUsd - basisSold);
    realizedPnlUsd += proceeds - basisSold;
    trades.push({
      date: c.date,
      side: "SELL",
      reason,
      price: c.close,
      grossUsd: gross,
      feeUsd,
      quantity: qty,
      hwm: hwm?.price,
      dropPct: hwm ? computeDropPct(hwm.price, c.close) : undefined,
    });
  };

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    // Conservative execution variant: fill yesterday's close decision at today's open.
    if (pendingBuy && fillTiming === "NEXT_OPEN") {
      executeBuy(c, pendingBuy, c.open);
      pendingBuy = null;
    }

    allSeen.push(c);
    const amaWindow = toAmaCandles(allSeen.slice(-60));
    const atr = computeATR(amaWindow, 20);

    if (btc <= 1e-12) {
      btc = 0;
      costBasisUsd = 0;
      // Update/confirm HWM only while no inventory is open.
      const closesAsOf = allSeen.map(toDailyClose);
      const transition = processIncrementalClose(
        hwm,
        toDailyClose(c),
        closesAsOf,
        REQUIRED_CONFIRMATIONS,
        REVERSAL_THRESHOLD_PCT,
      );
      hwm = transition.current;
    } else {
      cycleLow = cycleLow === null ? c.close : Math.min(cycleLow, c.close);
      highestSinceEntry = highestSinceEntry === null ? c.close : Math.max(highestSinceEntry, c.close);
    }

    // Canonical entry decision. Entry-hold and defined-exit stop adding only when seed/caps do.
    if (hwm.status === "CONFIRMED" || hwm.status === "FROZEN") {
      const input: SeedTranchePlanInput = {
        hwmPrice: hwm.price,
        hwmTimestamp: hwm.timestamp,
        budgetUsd: INITIAL_CAPITAL,
        deployedUsd: costBasisUsd,
        reservedUsd: 0,
        parameters: params,
        cycleId,
        asset: "BTC",
        riskOverlayMultiplier: 1.0,
        previousTranchePrice: trades.filter((t) => t.side === "BUY").at(-1)?.price ?? null,
        atr,
      };
      const plan0 = buildCanonicalSeedPlan(input, toDailyClose(c));
      if (plan0) {
        const plan = clonePlanDisablingExecuted(plan0, executed);
        const decisionInput = {
          hwmPrice: input.hwmPrice,
          currentPrice: c.close,
          cycleLowPrice: cycleLow,
          atr,
          budgetUsd: input.budgetUsd,
          deployedUsd: input.deployedUsd,
          reservedUsd: input.reservedUsd,
          previousTranchePrice: input.previousTranchePrice,
          parameters: params,
          cycleId,
          asset: "BTC" as const,
          riskOverlayMultiplier: 1.0,
        };
        const decision = makeAdaptiveDecision(plan, decisionInput, cooldown, periodState, c.timestamp);
        periodState = buildPeriodStateFromDecision(decision, periodState);
        if (
          decision.action === "SIMULATE" &&
          decision.selectedSeedTrancheIndex !== null &&
          decision.selectedAmountUsd !== null &&
          !executed.has(decision.selectedSeedTrancheIndex) &&
          !pendingBuy
        ) {
          const p: PendingBuy = {
            trancheIndex: decision.selectedSeedTrancheIndex,
            amountUsd: decision.selectedAmountUsd,
            hwm: hwm.price,
            dropPct: computeDropPct(hwm.price, c.close),
            reason: `CANONICAL_TRANCHE_${decision.selectedSeedTrancheIndex}`,
            decisionDate: c.date,
          };
          if (fillTiming === "SAME_CLOSE") executeBuy(c, p, c.close);
          else if (nextDayIndex(candles, i) !== null) pendingBuy = p;
        }
      }
    }

    // Exit layer is intentionally isolated because seed declares exits LAB_HYPOTHESIS.
    if (variant !== "AMA_ENTRY_CANONICAL_HOLD" && btc > 1e-12) {
      const cycle = makeCycle(cycleId, hwm, INITIAL_CAPITAL, costBasisUsd, btc, costBasisUsd, cycleLow, c.close);
      const exitStrategy = createExitStrategy(cycle, params);
      const phase = determineExitPhase(cycle, c.close, params);
      const trailingTriggered =
        highestSinceEntry !== null &&
        ((phase === "TRAILING_ACTIVE") || partialDistributed) &&
        shouldTriggerTrailingStop(c.close, highestSinceEntry, exitStrategy.trailingStopPct);

      if (!partialDistributed && (phase === "DISTRIBUTING" || trailingTriggered)) {
        const size = computeDistributionSize(btc, "DISTRIBUTING", exitStrategy.runnerPct);
        executeSell(c, size.distributeBtc, phase === "DISTRIBUTING" ? "DEFINED_DISTRIBUTION_20PCT" : "DEFINED_TRAILING_DISTRIBUTION");
        partialDistributed = true;
        highestSinceEntry = c.close;
      } else if (
        variant === "AMA_EXIT_EXPERIMENTAL_RUNNER_TRAIL" &&
        partialDistributed &&
        highestSinceEntry !== null &&
        shouldTriggerTrailingStop(c.close, highestSinceEntry, exitStrategy.trailingStopPct)
      ) {
        executeSell(c, btc, "EXPERIMENTAL_RUNNER_TRAILING_EXIT");
        if (btc <= 1e-12) resetCycleAfterExit(c);
      }
    }

    const equity = cash + btc * c.close;
    daily.push({
      date: c.date,
      equity,
      cash,
      btc,
      close: c.close,
      costBasisUsd,
      hwm: hwm?.price ?? null,
      hwmState: hwm?.status ?? null,
    });
  }

  const notes = [
    `Seed BTC canónico: ${BTC_SEED_TRANCHES.map((t) => `${t.triggerDropPct}%/${t.capitalPct}%`).join(", ")}.`,
    `HWM canónico: cierre diario, reversión ${REVERSAL_THRESHOLD_PCT}% y ${REQUIRED_CONFIRMATIONS} cierres de confirmación; HWM congelado tras primer fill.`,
    "Máximo una compra por cierre diario mediante makeAdaptiveDecision().",
    "Límites semanal/mensual y cooldown aplicados mediante funciones canónicas.",
    variant === "AMA_ENTRY_CANONICAL_HOLD"
      ? "Sin ventas: mide exclusivamente calidad de entrada canónica y marca a mercado al final."
      : "La capa de salida usa funciones existentes, pero BTC_EXIT_STATUS es LAB_HYPOTHESIS.",
    variant === "AMA_EXIT_EXPERIMENTAL_RUNNER_TRAIL"
      ? "La liquidación final del runner con trailing es una hipótesis explícita del harness; no está orquestada end-to-end en el runtime actual."
      : "No se inventa una salida final del runner: el remanente se marca a mercado al final.",
    `PnL realizado interno no usado para inflar presupuesto autorizado; capital base permanece ${INITIAL_CAPITAL} USD.`,
    `RealizedPnL informational: ${realizedPnlUsd.toFixed(2)} USD.`,
  ];

  const base: Omit<RunResult, "deterministicHash"> = {
    variant,
    fillTiming,
    feeBps,
    period: periodName,
    source: candles[0]?.source ?? "UNKNOWN",
    metrics: summarize(daily, trades, INITIAL_CAPITAL),
    trades,
    daily,
    notes,
  };
  return { ...base, deterministicHash: hashRun(base) };
}

function pct(n: number | null): string {
  return n === null ? "N/D" : `${n.toFixed(2)}%`;
}

function num(n: number | null): string {
  return n === null ? "N/D" : n.toFixed(2);
}

function mdTable(rows: string[][]): string {
  if (!rows.length) return "";
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) => `| ${r.map((v, i) => v.padEnd(widths[i])).join(" | ")} |`;
  return [line(rows[0]), line(widths.map((w) => "-".repeat(Math.max(3, w)))), ...rows.slice(1).map(line)].join("\n");
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const binance = await loadBinanceDataset();
  const krakenRecent = await loadKrakenRecent();
  const manifest = {
    generatedAt: new Date().toISOString(),
    codeVersion: "AMA_QUANT_AUDIT_V1",
    sources: {
      binanceResearchMirror: {
        url: BINANCE_CSV_URL,
        first: binance[0]?.date,
        last: binance.at(-1)?.date,
        candles: binance.length,
      },
      krakenRecent: {
        url: KRAKEN_OHLC_URL,
        first: krakenRecent[0]?.date,
        last: krakenRecent.at(-1)?.date,
        candles: krakenRecent.length,
      },
    },
    seed: {
      policyId: BTC_SEED_POLICY.policyId,
      deploymentPct: BTC_SEED_POLICY.capitalDeploymentPct,
      reservePct: BTC_SEED_POLICY.capitalReservePct,
      tranches: BTC_SEED_TRANCHES,
      requiredDailyCloses: REQUIRED_CONFIRMATIONS,
      reversalThresholdPct: REVERSAL_THRESHOLD_PCT,
    },
  };

  const allRuns: RunResult[] = [];
  const benchmarkRows: any[] = [];
  const variants: StrategyVariant[] = [
    "AMA_ENTRY_CANONICAL_HOLD",
    "AMA_EXIT_DEFINED_RUNNER_HOLD",
    "AMA_EXIT_EXPERIMENTAL_RUNNER_TRAIL",
  ];

  for (const period of PERIODS) {
    const { warmup, test, warmupShort } = windowWithWarmup(binance, period);
    for (const feeBps of FEE_BPS_SET) {
      const b100 = benchmark(test, 1.0, feeBps, "BUY_HOLD_100");
      const b75 = benchmark(test, 0.75, feeBps, "BUY_HOLD_75_CASH_25");
      benchmarkRows.push({
        period: period.name,
        feeBps,
        warmupDays: warmup.length,
        warmupShort,
        buyHold100: b100.metrics,
        buyHold75: b75.metrics,
      });
      for (const fillTiming of ["SAME_CLOSE", "NEXT_OPEN"] as FillTiming[]) {
        for (const variant of variants) {
          const r1 = simulate(warmup, test, variant, fillTiming, feeBps, period.name);
          const r2 = simulate(warmup, test, variant, fillTiming, feeBps, period.name);
          if (r1.deterministicHash !== r2.deterministicHash) {
            throw new Error(`Determinism failure: ${period.name}/${variant}/${fillTiming}/${feeBps}`);
          }
          allRuns.push(r1);
        }
      }
    }
  }

  // Independent recent-source robustness run (Kraken's REST window is limited, so use last 200 as warmup).
  const recentRuns: RunResult[] = [];
  if (krakenRecent.length > 260) {
    const warmup = krakenRecent.slice(0, 200);
    const test = krakenRecent.slice(200);
    for (const fillTiming of ["SAME_CLOSE", "NEXT_OPEN"] as FillTiming[]) {
      for (const variant of variants) {
        recentRuns.push(simulate(warmup, test, variant, fillTiming, 10, "KRAKEN_RECENT_WINDOW"));
      }
    }
  }

  const fullPrimary = allRuns.filter(
    (r) => r.period === "FULL_AVAILABLE" && r.feeBps === 10 && r.fillTiming === "NEXT_OPEN",
  );
  const fullBench = benchmarkRows.find((b) => b.period === "FULL_AVAILABLE" && b.feeBps === 10);

  const summaryRows: string[][] = [[
    "Estrategia", "Retorno", "CAGR", "Max DD", "Sharpe", "Compras", "Ventas", "Fin USD", "Exposición máx",
  ]];
  for (const r of fullPrimary) {
    summaryRows.push([
      r.variant,
      pct(r.metrics.totalReturnPct),
      pct(r.metrics.cagrPct),
      pct(r.metrics.maxDrawdownPct),
      num(r.metrics.sharpe),
      String(r.metrics.buys),
      String(r.metrics.sells),
      r.metrics.endingEquity.toFixed(2),
      pct(r.metrics.maxExposurePct),
    ]);
  }
  if (fullBench) {
    for (const [name, m] of [["BUY_HOLD_100", fullBench.buyHold100], ["BUY_HOLD_75_CASH_25", fullBench.buyHold75]] as const) {
      summaryRows.push([
        name,
        pct(m.totalReturnPct), pct(m.cagrPct), pct(m.maxDrawdownPct), num(m.sharpe),
        String(m.buys), String(m.sells), m.endingEquity.toFixed(2), pct(m.maxExposurePct),
      ]);
    }
  }

  const periodRows: string[][] = [["Período", "AMA entry-hold", "B&H 75/25", "B&H 100", "DD AMA", "DD B&H100"]];
  for (const p of PERIODS) {
    const r = allRuns.find(
      (x) => x.period === p.name && x.variant === "AMA_ENTRY_CANONICAL_HOLD" && x.fillTiming === "NEXT_OPEN" && x.feeBps === 10,
    );
    const b = benchmarkRows.find((x) => x.period === p.name && x.feeBps === 10);
    if (r && b) {
      periodRows.push([
        p.name,
        pct(r.metrics.totalReturnPct),
        pct(b.buyHold75.totalReturnPct),
        pct(b.buyHold100.totalReturnPct),
        pct(r.metrics.maxDrawdownPct),
        pct(b.buyHold100.maxDrawdownPct),
      ]);
    }
  }

  const feeRows: string[][] = [["Fee bps", "Entry-hold retorno", "Entry-hold fin USD", "B&H75 retorno"]];
  for (const feeBps of FEE_BPS_SET) {
    const r = allRuns.find(
      (x) => x.period === "FULL_AVAILABLE" && x.variant === "AMA_ENTRY_CANONICAL_HOLD" && x.fillTiming === "NEXT_OPEN" && x.feeBps === feeBps,
    );
    const b = benchmarkRows.find((x) => x.period === "FULL_AVAILABLE" && x.feeBps === feeBps);
    if (r && b) feeRows.push([String(feeBps), pct(r.metrics.totalReturnPct), r.metrics.endingEquity.toFixed(2), pct(b.buyHold75.totalReturnPct)]);
  }

  const report = `# Auditoría cuantitativa AMA BTC — V1\n\n` +
    `Generada: ${manifest.generatedAt}\n\n` +
    `## Veredicto de alcance\n\n` +
    `- **Entradas:** se ejecutan con las funciones canónicas del repositorio: buildCanonicalSeedPlan + makeAdaptiveDecision + HWM/cooldown/límites de período.\n` +
    `- **Seed BTC:** 18/25/33/42/52/63% de caída, pesos 7/9/12/14/15/18%, despliegue máximo 75%, reserva 25%.\n` +
    `- **Salidas:** el propio código marca BTC_EXIT_STATUS=LAB_HYPOTHESIS. Por eso el resultado principal es AMA_ENTRY_CANONICAL_HOLD. Las variantes de salida se muestran separadas.\n` +
    `- **Replay actual:** no se usa para medir rentabilidad porque amaReplayService.ts tiene reglas hardcodeadas distintas del seed canónico.\n\n` +
    `## Datos\n\n` +
    `- Histórico principal: BTCUSDT diario, ${binance[0]?.date} → ${binance.at(-1)?.date}, ${binance.length} velas, mirror de investigación de Binance.\n` +
    `- Robustez reciente: Kraken XBT/USD REST, ${krakenRecent[0]?.date} → ${krakenRecent.at(-1)?.date}, ${krakenRecent.length} velas (ventana limitada por API).\n` +
    `- Warm-up objetivo: ${WARMUP_DAYS} cierres diarios; mínimo aceptado para ventanas antiguas: ${MIN_WARMUP_DAYS}.\n` +
    `- Resultado principal: ejecución conservadora **NEXT_OPEN**, coste 10 bps por lado. Sensibilidad: 0/10/25 bps.\n\n` +
    `## Resultado global principal\n\n${mdTable(summaryRows)}\n\n` +
    `## Calidad de entrada por régimen histórico\n\n${mdTable(periodRows)}\n\n` +
    `## Sensibilidad a costes\n\n${mdTable(feeRows)}\n\n` +
    `## Interpretación obligatoria\n\n` +
    `1. AMA_ENTRY_CANONICAL_HOLD mide si la escalera canónica compra bien grandes caídas; no pretende ser el sistema de salida final.\n` +
    `2. AMA_EXIT_DEFINED_RUNNER_HOLD solo ejecuta la distribución parcial definida y conserva el runner hasta el final.\n` +
    `3. AMA_EXIT_EXPERIMENTAL_RUNNER_TRAIL añade una liquidación final del runner con trailing; está etiquetada como hipótesis y **no debe confundirse con runtime canónico**.\n` +
    `4. Las comparaciones B&H 75/25 son especialmente importantes porque igualan la reserva estructural del 25% de AMA.\n` +
    `5. Los resultados no prueban rendimiento futuro. Son una auditoría histórica de comportamiento del algoritmo.\n\n` +
    `## Hallazgos de arquitectura detectados antes del cálculo\n\n` +
    `- El Replay persistente actual no es el seed AMA BTC canónico.\n` +
    `- El runtime HWM bootstrap usa el máximo HIGH de las velas devueltas, mientras el flujo canónico puro de HWM usa cierres + confirmación. Esta auditoría usa el flujo canónico puro.\n` +
    `- La salida BTC sigue declarada LAB_HYPOTHESIS, por lo que no es metodológicamente correcto presentar una cifra de rentabilidad end-to-end como si fuese producción final.\n`;

  await writeFile(`${OUT_DIR}/manifest.json`, JSON.stringify(manifest, null, 2));
  await writeFile(`${OUT_DIR}/runs.json`, JSON.stringify({ runs: allRuns, recentRuns, benchmarks: benchmarkRows }, null, 2));
  await writeFile(`${OUT_DIR}/AUDITORIA_CUANTITATIVA_AMA_BTC.md`, report);

  const tradesCsv = ["period,variant,fillTiming,feeBps,date,side,reason,price,grossUsd,feeUsd,quantity,trancheIndex,hwm,dropPct"];
  for (const r of allRuns) {
    for (const t of r.trades) {
      tradesCsv.push([
        r.period, r.variant, r.fillTiming, r.feeBps, t.date, t.side, t.reason,
        t.price, t.grossUsd, t.feeUsd, t.quantity, t.trancheIndex ?? "", t.hwm ?? "", t.dropPct ?? "",
      ].join(","));
    }
  }
  await writeFile(`${OUT_DIR}/trades.csv`, tradesCsv.join("\n"));

  console.log(report);
  console.log(`\nARTIFACT_DIR=${OUT_DIR}`);
  console.log(`PRIMARY_RUNS=${allRuns.length}`);
  console.log(`RECENT_RUNS=${recentRuns.length}`);
  console.log("AMA_QUANT_AUDIT=PASS");
}

main().catch((err) => {
  console.error("AMA_QUANT_AUDIT=FAIL");
  console.error(err);
  process.exit(1);
});
