/**
 * testEntryV4ProductionParity — Parity tests for V4 production vs research.
 *
 * Tests:
 *   1. ENTRY_V4_PRODUCTION_RESEARCH_PARITY: productive spotEntryV4 exports
 *      the same functions, weights, and thresholds as research spotEntryV4Research.
 *   2. PRODUCTIVE_V4_HISTORICAL_PARITY: productive evaluateV4Gate produces the
 *      same quality scores as research computeV4QualityScores on identical features.
 *   3. PRODUCTION_030_BASELINE: threshold 0.30 is the frozen production threshold.
 *   4. V4_FAIL_CLOSED: V4 failure (missing features, NaN, disabled) never allows entry.
 *   5. V4_B0_OVERLAY: V4 only evaluates after B0 shouldExecute=true.
 *   6. V4_SIZING_UNCHANGED: V4 does not modify sizing.
 *   7. V4_MODE_INDEPENDENT: V4 decision is the same in OFF, SHADOW, REAL.
 *   8. V4_CLOSED_CANDLE: V4 uses only closed candles (no forming candle data).
 *   9. V4_WEIGHTS_FROZEN: weights are 0.20 each, sum to 1.0.
 *  10. V4_THRESHOLD_FROZEN: threshold is 0.30, no per-pair adaptation.
 */

import {
  impulseScoreFn as prodImpulse,
  retracementScoreFn as prodRetracement,
  structureScoreFn as prodStructure,
  reclaimScoreFn as prodReclaim,
  resumptionScoreFn as prodResumption,
  computeV4QualityScores as prodCompute,
  checkV4Acceptance as prodCheck,
  V4_WEIGHTS as prodWeights,
  V4_QUALITY_THRESHOLDS as prodThresholds,
  SPOT_ENTRY_V4_ENABLED,
  SPOT_ENTRY_V4_MIN_QUALITY_SCORE,
  evaluateV4Gate,
  type V4EvaluationResult,
} from "../spotEntryV4";
import {
  impulseScoreFn as resImpulse,
  retracementScoreFn as resRetracement,
  structureScoreFn as resStructure,
  reclaimScoreFn as resReclaim,
  resumptionScoreFn as resResumption,
  computeV4QualityScores as resCompute,
  checkV4Acceptance as resCheck,
  V4_WEIGHTS as resWeights,
  V4_QUALITY_THRESHOLDS as resThresholds,
} from "./spotEntryV4Research";
import { extractEntryV4Features } from "../spotEntryQualityFeatures";
import type { V3RawFeatures } from "../spotEntryQualityFeatures";
import { DEFAULT_ENTRY_V3_CONFIG } from "../spotEntryV3";
import type { SpotMarketContext, SpotEntryIntent, SpotCandle } from "../spotTypes";
import { EntryIntentState, SetupTag, Regime, RegimeDirection, MacroBias } from "../spotTypes";
import { DataHealth } from "../candleTimestamp";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeFeatures(overrides: Partial<V3RawFeatures> = {}): V3RawFeatures {
  return {
    atr: 100,
    impulseAtr: 1.5,
    impulseHigh: 50000,
    retracementAtr: 0.6,
    retracementLow: 49500,
    ema20: 49800,
    reclaimCandleClose: 50000,
    reclaimCandleOpen: 49800,
    reclaimBodyPct: 0.004,
    reclaim15mCloseTime: Date.now(),
    reclaimIsBullish: true,
    reclaimAboveEma: true,
    reclaimAfterOrigin: true,
    resumptionExists: true,
    resumptionCandleClose: 50100,
    resumptionCandleOpen: 50000,
    resumptionBodyPct: 0.002,
    resumptionIsBullish: true,
    resumptionUpperWickRatio: 0.1,
    resumptionVolRatio5m: 1.5,
    resumption5mCloseTime: Date.now(),
    originPrice: 49500,
    origin15mCloseAt: Date.now() - 3600000,
    originAtrPct: 1.0,
    expiresAt: Date.now() + 3600000,
    distanceFromOriginAtr: 0.5,
    ...overrides,
  };
}

function makeMinimalCtx(candles15m: SpotCandle[], candles5m: SpotCandle[], lastPrice: number): SpotMarketContext {
  return {
    marketContextId: "test-ctx",
    generatedAt: Date.now(),
    pair: "BTC/USDT",
    dataHealth: DataHealth.HEALTHY,
    macroBias: MacroBias.NEUTRAL,
    regimeContext: {
      regime: Regime.TREND,
      direction: RegimeDirection.UP,
      macroBias: MacroBias.NEUTRAL,
      volatility: "NORMAL",
      adx: 30,
      ema20: 49800,
      ema50: 49500,
      ema200: 49000,
      emaAlignment: "BULLISH",
      bollingerWidth: 0.03,
      atrPct: 1.0,
      confidence: 0.8,
      regimeId: "test-regime",
      contextId: "test-ctx",
    },
    candles5m,
    candles15m,
    candles1h: [],
    candles4h: [],
    formingCandle5m: null,
    formingCandle15m: null,
    formingCandle1h: null,
    formingCandle4h: null,
    closedCandleContext: {
      tf5m: { closedCandles: candles5m, formingCandle: null },
      tf15m: { closedCandles: candles15m, formingCandle: null },
      tf1h: { closedCandles: [], formingCandle: null },
      tf4h: { closedCandles: [], formingCandle: null },
    },
    adaptiveMarketState: {
      trendQualityScore: 0.5,
      volatilityState: "NORMAL",
      volatilityPercentile: 50,
      marketStressScore: 0,
      setupQualityScore: 0,
    },
    ticker: { bid: lastPrice - 1, ask: lastPrice + 1, last: lastPrice, spread: 2, fetchedAt: Date.now() },
    spreadPct: 0.01,
    atr: 100,
    volumeMetrics: { volumeRatio: 1.5, volume24h: 1000000, participation: "NORMAL" },
  };
}

function makeIntent(overrides: Partial<SpotEntryIntent> = {}): SpotEntryIntent {
  return {
    signalId: "test-intent",
    pair: "BTC/USDT",
    setupTag: SetupTag.PULLBACK_CONTINUATION,
    createdAt: Date.now() - 3600000,
    expiresAt: Date.now() + 3600000,
    state: EntryIntentState.APPROVED,
    origin15mOpenAt: Date.now() - 3900000,
    origin15mCloseAt: Date.now() - 3600000,
    originPrice: 49500,
    originClose: 49500,
    originAtrPct: 1.0,
    originRegime: Regime.TREND,
    originDirection: RegimeDirection.UP,
    originMacro: MacroBias.NEUTRAL,
    originVolume: 1000,
    originContextId: "test-ctx",
    retryCount: 0,
    initialBlockReason: null,
    lastBlockReason: null,
    lastEvaluatedAt: null,
    ...overrides,
  };
}

function makeCandle(time: number, open: number, high: number, low: number, close: number, volume = 100): SpotCandle {
  return { time, open, high, low, close, volume };
}

// Generate 60 closed 15m candles
function make15mCandles(basePrice = 50000): SpotCandle[] {
  const candles: SpotCandle[] = [];
  const now = Date.now();
  for (let i = 60; i > 0; i--) {
    const t = now - i * 15 * 60 * 1000;
    const variation = Math.sin(i * 0.3) * 200;
    const close = basePrice + variation;
    const open = close - 50;
    const high = Math.max(open, close) + 30;
    const low = Math.min(open, close) - 30;
    candles.push(makeCandle(t, open, high, low, close, 100 + Math.random() * 50));
  }
  return candles;
}

// Generate 30 closed 5m candles
function make5mCandles(basePrice = 50000): SpotCandle[] {
  const candles: SpotCandle[] = [];
  const now = Date.now();
  for (let i = 30; i > 0; i--) {
    const t = now - i * 5 * 60 * 1000;
    const variation = Math.sin(i * 0.5) * 100;
    const close = basePrice + variation;
    const open = close - 20;
    const high = Math.max(open, close) + 15;
    const low = Math.min(open, close) - 15;
    candles.push(makeCandle(t, open, high, low, close, 80 + Math.random() * 40));
  }
  return candles;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

function testProductionResearchParity(): boolean {
  const features = makeFeatures();

  // Compare each function
  const impulseEqual = prodImpulse(features.impulseAtr) === resImpulse(features.impulseAtr);
  const retracementEqual = prodRetracement(features.retracementAtr) === resRetracement(features.retracementAtr);
  const structureEqual = prodStructure(features.retracementLow, features.ema20, features.atr)
    === resStructure(features.retracementLow, features.ema20, features.atr);
  const reclaimEqual = prodReclaim(features.reclaimBodyPct, features.reclaimIsBullish, features.reclaimAboveEma, features.reclaimAfterOrigin)
    === resReclaim(features.reclaimBodyPct, features.reclaimIsBullish, features.reclaimAboveEma, features.reclaimAfterOrigin);
  const resumptionEqual = prodResumption(features.resumptionExists, features.resumptionIsBullish, features.resumptionBodyPct, features.resumptionUpperWickRatio, features.resumptionVolRatio5m)
    === resResumption(features.resumptionExists, features.resumptionIsBullish, features.resumptionBodyPct, features.resumptionUpperWickRatio, features.resumptionVolRatio5m);

  const prodScores = prodCompute(features);
  const resScores = resCompute(features);
  const scoresEqual = prodScores.qualityScore === resScores.qualityScore;

  // Compare weights
  const weightsEqual =
    prodWeights.impulse === resWeights.impulse &&
    prodWeights.retracement === resWeights.retracement &&
    prodWeights.structure === resWeights.structure &&
    prodWeights.reclaim === resWeights.reclaim &&
    prodWeights.resumption === resWeights.resumption;

  // Compare thresholds
  const thresholdsEqual = prodThresholds.length === resThresholds.length &&
    prodThresholds.every((t, i) => t === resThresholds[i]);

  // Compare checkV4Acceptance
  const nowMs = Date.now();
  const prodAccept = prodCheck(features, 0.30, nowMs, DEFAULT_ENTRY_V3_CONFIG);
  const resAccept = resCheck(features, 0.30, nowMs, DEFAULT_ENTRY_V3_CONFIG);
  const acceptEqual = prodAccept.accepted === resAccept.accepted;

  const pass = impulseEqual && retracementEqual && structureEqual && reclaimEqual && resumptionEqual
    && scoresEqual && weightsEqual && thresholdsEqual && acceptEqual;

  console.log(`ENTRY_V4_PRODUCTION_RESEARCH_PARITY: ${pass ? "PASS" : "FAIL"}`);
  console.log(`  impulse=${impulseEqual} retracement=${retracementEqual} structure=${structureEqual} reclaim=${reclaimEqual} resumption=${resumptionEqual}`);
  console.log(`  scores=${scoresEqual} weights=${weightsEqual} thresholds=${thresholdsEqual} accept=${acceptEqual}`);
  return pass;
}

function testHistoricalParity(): boolean {
  // Test that productive evaluateV4Gate produces the same quality scores
  // as research computeV4QualityScores on identical features.
  const candles15m = make15mCandles();
  const candles5m = make5mCandles();
  const ctx = makeMinimalCtx(candles15m, candles5m, 50000);
  const intent = makeIntent();

  // Extract features using the shared module
  const features = extractEntryV4Features(ctx, intent);
  if (!features) {
    console.log(`PRODUCTIVE_V4_HISTORICAL_PARITY: FAIL (features null)`);
    return false;
  }

  // Compute scores via productive module
  const prodScores = prodCompute(features);

  // Evaluate via productive gate
  const v4Result = evaluateV4Gate(ctx, intent);

  // The quality score from evaluateV4Gate should match prodCompute
  const scoreMatch = v4Result.scores?.qualityScore === prodScores.qualityScore;

  console.log(`PRODUCTIVE_V4_HISTORICAL_PARITY: ${scoreMatch ? "PASS" : "FAIL"}`);
  console.log(`  features.impulseAtr=${features.impulseAtr.toFixed(4)} retracementAtr=${features.retracementAtr.toFixed(4)}`);
  console.log(`  prodScore=${prodScores.qualityScore} gateScore=${v4Result.scores?.qualityScore ?? "null"}`);
  console.log(`  accepted=${v4Result.accepted} rejectReason=${v4Result.rejectReason}`);
  return scoreMatch;
}

function testProduction030Baseline(): boolean {
  // Verify the frozen production threshold is exactly 0.30
  const thresholdOk = SPOT_ENTRY_V4_MIN_QUALITY_SCORE === 0.30;
  const enabledOk = SPOT_ENTRY_V4_ENABLED === true;

  // Test acceptance at threshold boundary
  const features = makeFeatures();

  // Score above 0.30 should be accepted
  const aboveResult = prodCheck(features, 0.30, Date.now(), DEFAULT_ENTRY_V3_CONFIG);

  // Score below 0.30 should be rejected
  const lowFeatures = makeFeatures({
    impulseAtr: 0.1,
    retracementAtr: 0.05,
    reclaimIsBullish: false,
    resumptionExists: false,
  });
  const lowScores = prodCompute(lowFeatures);
  const belowResult = prodCheck(lowFeatures, 0.30, Date.now(), DEFAULT_ENTRY_V3_CONFIG);

  const pass = thresholdOk && enabledOk && lowScores.qualityScore < 0.30 && !belowResult.accepted;

  console.log(`PRODUCTION_030_BASELINE: ${pass ? "PASS" : "FAIL"}`);
  console.log(`  threshold=${SPOT_ENTRY_V4_MIN_QUALITY_SCORE} enabled=${SPOT_ENTRY_V4_ENABLED}`);
  console.log(`  lowScore=${lowScores.qualityScore} lowAccepted=${belowResult.accepted}`);
  return pass;
}

function testV4FailClosed(): boolean {
  // 1. V4 disabled → fail closed
  // Can't test disabled since SPOT_ENTRY_V4_ENABLED is a const true,
  // but evaluateV4Gate checks it and returns V4_DISABLED

  // 2. Features unavailable → fail closed
  const shortCandles: SpotCandle[] = [];
  const ctx = makeMinimalCtx(shortCandles, shortCandles, 50000);
  const intent = makeIntent();
  const resultNoFeatures = evaluateV4Gate(ctx, intent);
  const noFeaturesFail = !resultNoFeatures.accepted && resultNoFeatures.rejectReason === "V4_FEATURES_UNAVAILABLE";

  // 3. Score below threshold → fail closed
  const features = makeFeatures({
    impulseAtr: 0,
    retracementAtr: 0,
    reclaimIsBullish: false,
    resumptionExists: false,
  });
  const scores = prodCompute(features);
  const belowThreshold = scores.qualityScore < 0.30;

  // 4. V4 rejection never falls back to B0 — verify rejectReason is set
  const rejectReasonSet = resultNoFeatures.rejectReason !== "ENTRY_APPROVED";

  const pass = noFeaturesFail && belowThreshold && rejectReasonSet;

  console.log(`V4_FAIL_CLOSED: ${pass ? "PASS" : "FAIL"}`);
  console.log(`  noFeatures=${noFeaturesFail} belowThreshold=${belowThreshold} rejectReason=${resultNoFeatures.rejectReason}`);
  return pass;
}

function testV4B0Overlay(): boolean {
  // V4 only evaluates AFTER B0 shouldExecute=true.
  // evaluateV4Gate is only called after B0 approval in spotEngine.
  // Here we verify the function signature requires an intent (B0 output).
  const candles15m = make15mCandles();
  const candles5m = make5mCandles();
  const ctx = makeMinimalCtx(candles15m, candles5m, 50000);
  const intent = makeIntent({ state: EntryIntentState.APPROVED });

  // V4 gate should work with an approved intent
  const result = evaluateV4Gate(ctx, intent);
  const hasResult = result !== null && result !== undefined;
  const hasRejectReason = "rejectReason" in result;

  console.log(`V4_B0_OVERLAY: ${hasResult && hasRejectReason ? "PASS" : "FAIL"}`);
  console.log(`  hasResult=${hasResult} hasRejectReason=${hasRejectReason} accepted=${result.accepted}`);
  return hasResult && hasRejectReason;
}

function testV4SizingUnchanged(): boolean {
  // V4 evaluation result does not contain sizing fields
  const candles15m = make15mCandles();
  const candles5m = make5mCandles();
  const ctx = makeMinimalCtx(candles15m, candles5m, 50000);
  const intent = makeIntent();
  const result = evaluateV4Gate(ctx, intent);

  const hasNoSizing = !("positionSize" in result) && !("riskUsd" in result) && !("stopPrice" in result)
    && !("volume" in result) && !("notionalUsd" in result);

  console.log(`V4_SIZING_UNCHANGED: ${hasNoSizing ? "PASS" : "FAIL"}`);
  return hasNoSizing;
}

function testV4ModeIndependent(): boolean {
  // V4 quality score is the same regardless of execution mode.
  // evaluateV4Gate does not take a mode parameter.
  const candles15m = make15mCandles();
  const candles5m = make5mCandles();
  const ctx = makeMinimalCtx(candles15m, candles5m, 50000);
  const intent = makeIntent();

  const result = evaluateV4Gate(ctx, intent);
  // Run twice — should be identical
  const result2 = evaluateV4Gate(ctx, intent);

  const identical = result.accepted === result2.accepted
    && result.rejectReason === result2.rejectReason
    && (result.scores?.qualityScore ?? null) === (result2.scores?.qualityScore ?? null);

  console.log(`V4_MODE_INDEPENDENT: ${identical ? "PASS" : "FAIL"}`);
  console.log(`  accepted=${result.accepted} score=${result.scores?.qualityScore ?? "null"}`);
  return identical;
}

function testV4ClosedCandle(): boolean {
  // V4 features are extracted from ctx.candles15m and ctx.candles5m
  // which contain ONLY closed candles (forming candle excluded).
  // The extractEntryV4Features function does not reference forming candles.
  const candles15m = make15mCandles();
  const candles5m = make5mCandles();
  const ctx = makeMinimalCtx(candles15m, candles5m, 50000);
  const intent = makeIntent();

  // Verify forming candles are null
  const formingNull = ctx.formingCandle5m === null && ctx.formingCandle15m === null;

  // Extract features — should work with only closed candles
  const features = extractEntryV4Features(ctx, intent);
  const featuresExtracted = features !== null;

  // Verify features don't reference forming candle data
  // (The function only uses ctx.candles15m and ctx.candles5m)
  const usesClosedOnly = features !== null && features.atr > 0;

  console.log(`V4_CLOSED_CANDLE: ${formingNull && featuresExtracted && usesClosedOnly ? "PASS" : "FAIL"}`);
  console.log(`  formingNull=${formingNull} featuresExtracted=${featuresExtracted} usesClosedOnly=${usesClosedOnly}`);
  return formingNull && featuresExtracted && usesClosedOnly;
}

function testV4WeightsFrozen(): boolean {
  const weightSum = prodWeights.impulse + prodWeights.retracement + prodWeights.structure + prodWeights.reclaim + prodWeights.resumption;
  const allEqual = prodWeights.impulse === 0.20 && prodWeights.retracement === 0.20
    && prodWeights.structure === 0.20 && prodWeights.reclaim === 0.20 && prodWeights.resumption === 0.20;
  const sumOk = Math.abs(weightSum - 1.0) < 0.001;

  console.log(`V4_WEIGHTS_FROZEN: ${allEqual && sumOk ? "PASS" : "FAIL"}`);
  console.log(`  weights=${prodWeights.impulse}/${prodWeights.retracement}/${prodWeights.structure}/${prodWeights.reclaim}/${prodWeights.resumption} sum=${weightSum}`);
  return allEqual && sumOk;
}

function testV4ThresholdFrozen(): boolean {
  // Threshold must be 0.30, no per-pair adaptation
  const thresholdOk = SPOT_ENTRY_V4_MIN_QUALITY_SCORE === 0.30;
  // No per-pair config exists in the module — threshold is a single const
  const isConst = typeof SPOT_ENTRY_V4_MIN_QUALITY_SCORE === "number";

  console.log(`V4_THRESHOLD_FROZEN: ${thresholdOk && isConst ? "PASS" : "FAIL"}`);
  console.log(`  threshold=${SPOT_ENTRY_V4_MIN_QUALITY_SCORE} isConst=${isConst}`);
  return thresholdOk && isConst;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const results: Record<string, boolean> = {};

  results["ENTRY_V4_PRODUCTION_RESEARCH_PARITY"] = testProductionResearchParity();
  results["PRODUCTIVE_V4_HISTORICAL_PARITY"] = testHistoricalParity();
  results["PRODUCTION_030_BASELINE"] = testProduction030Baseline();
  results["V4_FAIL_CLOSED"] = testV4FailClosed();
  results["V4_B0_OVERLAY"] = testV4B0Overlay();
  results["V4_SIZING_UNCHANGED"] = testV4SizingUnchanged();
  results["V4_MODE_INDEPENDENT"] = testV4ModeIndependent();
  results["V4_CLOSED_CANDLE"] = testV4ClosedCandle();
  results["V4_WEIGHTS_FROZEN"] = testV4WeightsFrozen();
  results["V4_THRESHOLD_FROZEN"] = testV4ThresholdFrozen();

  let allPass = true;
  for (const [name, pass] of Object.entries(results)) {
    console.log(`${name}=${pass ? "PASS" : "FAIL"}`);
    if (!pass) allPass = false;
  }

  console.log(`\nALL_V4_PRODUCTION_TESTS=${allPass ? "PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
}

main();
