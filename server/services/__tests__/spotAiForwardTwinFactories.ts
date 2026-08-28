/**
 * spotAiForwardTwinFactories.ts — R12-04: Typed ForwardTwinSnapshot factories.
 *
 * These factories produce objects that FULLY satisfy the ForwardTwinSnapshot
 * type contract from spotForwardTwinTypes.ts. No `any`, no casts.
 * Used by the TRUE E2E backfill parity test.
 */

import type {
  ForwardTwinSnapshot,
  ForwardTwinTickerSnapshot,
  ForwardTwinRegimeSnapshot,
  ForwardTwinVolumeSnapshot,
  ForwardTwinSignalSnapshot,
  ForwardTwinSizingSnapshot,
  ForwardTwinCapitalSnapshot,
  ForwardTwinPositionSnapshot,
  ForwardTwinExitDecisionSnapshot,
  ForwardTwinFillSnapshot,
} from "../spot/spotForwardTwinTypes";

const EXECUTION_MODE = "SPOT";
const ENGINE_OWNER = "forward-twin";

function makeTicker(bid = 100, ask = 100.1, last = 100, fetchedAt = 1000): ForwardTwinTickerSnapshot {
  return {
    bid,
    ask,
    last,
    spread: ask - bid,
    spreadPct: (ask - bid) / last,
    fetchedAt,
  };
}

function makeRegime(): ForwardTwinRegimeSnapshot {
  return {
    regime: "trend",
    direction: "up",
    macroBias: "neutral",
    volatility: "normal",
    adx: 25,
    ema20: 99,
    ema50: 98,
    ema200: 95,
    emaAlignment: "bullish",
    bollingerWidth: 2.5,
    atrPct: 1.5,
    confidence: 0.8,
    regimeId: "regime-1",
    contextId: "ctx-1",
  };
}

function makeVolume(): ForwardTwinVolumeSnapshot {
  return {
    volumeRatio: 1.2,
    volume24h: 1000000,
    participation: "normal",
  };
}

function makeSignal(): ForwardTwinSignalSnapshot {
  return {
    signal: "BUY",
    setupTag: "BREAKOUT",
    reason: "ema_alignment",
    confidence: 0.85,
    originPrice: 99.5,
    origin15mCloseAt: 900,
    originAtrPct: 1.5,
    originVolume: 1.2,
    contextId: "ctx-1",
    blockReason: null,
  };
}

function makeSizing(): ForwardTwinSizingSnapshot {
  return {
    approved: true,
    reason: "ok",
    volume: 1,
    notionalUsd: 100,
    stopPrice: 95,
    stopDistanceUsd: 5,
    stopDistancePct: 5,
    riskUsd: 10,
    entryFeeUsd: 1,
    roundTripFeeUsd: 2,
    blockReason: null,
    blockCode: null,
  };
}

function makeCapital(): ForwardTwinCapitalSnapshot {
  return {
    availableCapital: 10000,
    openLots: 0,
    maxLotsPerPair: 5,
    reservedCapital: 0,
    realizedPnl: 0,
    totalFees: 0,
  };
}

export function makeScanSnapshot(overrides: Partial<ForwardTwinSnapshot> = {}): ForwardTwinSnapshot {
  return {
    schemaVersion: 1,
    snapshotType: "SCAN",
    scanId: "scan-1",
    timestamp: 1000,
    pair: "BTC/USD",
    policyVersion: "SPOT_POLICY_X",
    executionMode: EXECUTION_MODE,
    engineOwner: ENGINE_OWNER,
    ticker: makeTicker(),
    regime: makeRegime(),
    volume: makeVolume(),
    signal: makeSignal(),
    sizing: makeSizing(),
    capital: makeCapital(),
    ...overrides,
  };
}

export function makeFillSnapshot(
  side: "BUY" | "SELL",
  lotId: string,
  overrides: Partial<ForwardTwinSnapshot> = {},
): ForwardTwinSnapshot {
  const fill: ForwardTwinFillSnapshot = {
    side,
    lotId,
    fillPrice: side === "BUY" ? 100 : 110,
    fillVolume: 1,
    notionalUsd: side === "BUY" ? 100 : 110,
    feeUsd: 1,
    slippageUsd: 0,
    slippagePct: 0,
    fillQuality: "ok",
    orderId: side === "BUY" ? "o1" : "o2",
    executedAt: side === "BUY" ? 1100 : 2000,
    tickerBid: 100,
    tickerAsk: 100.1,
    tickerLast: 100,
  };
  return {
    schemaVersion: 1,
    snapshotType: "FILL",
    scanId: "scan-1",
    timestamp: side === "BUY" ? 1100 : 2000,
    pair: "BTC/USD",
    policyVersion: "SPOT_POLICY_X",
    executionMode: EXECUTION_MODE,
    engineOwner: ENGINE_OWNER,
    fill,
    ...overrides,
  };
}

export function makeSupervisorSnapshot(
  lotId: string,
  currentR: number,
  timestamp: number,
  overrides: Partial<ForwardTwinSnapshot> = {},
): ForwardTwinSnapshot {
  // R12F-01: mfeR/maeR are CUMULATIVE and MUST differ from currentR
  // (instantaneous). This prevents regressions where cumulative mfeR/maeR
  // are used instead of currentR for giveback labels.
  const cumulativeMfeR = currentR * 2;
  const cumulativeMaeR = -currentR * 1.5;
  const position: ForwardTwinPositionSnapshot = {
    lotId,
    pair: "BTC/USD",
    entryPrice: 100,
    amount: 1,
    qtyRemaining: 1,
    highestPrice: 100 + cumulativeMfeR * 5,
    lowestPrice: 95,
    mfe: cumulativeMfeR * 5,
    mae: cumulativeMaeR * 5,
    mfeR: cumulativeMfeR,
    maeR: cumulativeMaeR,
    openedAt: 1100,
    setupTag: "BREAKOUT",
    executionMode: EXECUTION_MODE,
    sgBreakEvenActivated: false,
    sgTrailingActivated: false,
    sgCurrentStopPrice: 95,
    breakEvenStopPrice: null,
    trailingStopPrice: null,
    trailingHighestPrice: 100 + cumulativeMfeR * 5,
    initialStopPrice: 95,
    initialStopDistanceUsd: 5,
    riskUsd: 10,
    currentR,
    currentPrice: 100 + currentR * 5,
  };
  const exitDecision: ForwardTwinExitDecisionSnapshot = {
    shouldExit: false,
    reasonType: null,
    reason: "none",
    price: 100 + currentR * 5,
    priority: null,
    evaluatedAt: timestamp,
  };
  return {
    schemaVersion: 2,
    snapshotType: "SUPERVISOR",
    scanId: "scan-1",
    timestamp,
    pair: "BTC/USD",
    policyVersion: "SPOT_POLICY_X",
    executionMode: EXECUTION_MODE,
    engineOwner: ENGINE_OWNER,
    position,
    exitDecision,
    ...overrides,
  };
}
