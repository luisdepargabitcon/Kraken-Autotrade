/**
 * spotAiFeatureBuilder — Extract features from Forward Twin snapshots.
 *
 * PURE function: no DB, no side effects, no async.
 * Reads ONLY from ForwardTwinSnapshot data.
 * No lookahead: features come exclusively from the snapshot at prediction time.
 */

import { SPOT_AI_FEATURE_SCHEMA_VERSION } from "./spotAiForwardTwinTypes";
import type { SpotAiFeatures } from "./spotAiForwardTwinTypes";
import type { ForwardTwinSnapshot } from "../spot/spotForwardTwinTypes";

export function buildFeaturesFromSnapshot(snapshot: ForwardTwinSnapshot): SpotAiFeatures {
  const ticker = snapshot.ticker;
  const regime = snapshot.regime;
  const volume = snapshot.volume;
  const signal = snapshot.signal;
  const intent = snapshot.intent;
  const sizing = snapshot.sizing;
  const capital = snapshot.capital;

  if (!ticker || !regime || !volume || !signal || !capital) {
    throw new Error("SCAN snapshot missing required fields for feature extraction");
  }

  return {
    featureSchemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION,
    pair: snapshot.pair,
    scanId: snapshot.scanId,
    timestamp: snapshot.timestamp,
    regime: regime.regime,
    direction: regime.direction,
    macroBias: regime.macroBias,
    dataHealth: snapshot.dataHealth ?? "UNKNOWN",
    bid: ticker.bid,
    ask: ticker.ask,
    last: ticker.last,
    spreadPct: ticker.spreadPct,
    atr: regime.atrPct > 0 ? regime.atrPct * ticker.last : 0,
    atrPct: regime.atrPct,
    adx: regime.adx,
    ema20: regime.ema20,
    ema50: regime.ema50,
    ema200: regime.ema200,
    emaAlignment: regime.emaAlignment,
    volume: volume.volume24h,
    volumeRatio: volume.volumeRatio,
    participation: volume.participation,
    setupTag: signal.setupTag,
    signalConfidence: signal.confidence,
    intentState: intent?.state ?? null,
    antiLateEntryState: intent?.lastBlockReason ?? null,
    availableCapital: capital.availableCapital,
    reservedCapital: capital.reservedCapital,
    openLotsForPair: capital.openLots,
    notionalUsd: sizing?.notionalUsd ?? null,
    initialRiskUsd: sizing?.riskUsd ?? null,
  };
}

export function validateNoLookahead(features: SpotAiFeatures, predictionTimestamp: number): boolean {
  return features.timestamp <= predictionTimestamp;
}

export function validateFeatureSchema(features: SpotAiFeatures): boolean {
  return features.featureSchemaVersion === SPOT_AI_FEATURE_SCHEMA_VERSION;
}
