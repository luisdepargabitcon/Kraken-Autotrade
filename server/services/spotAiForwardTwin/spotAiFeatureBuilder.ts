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
import { getCandleCloseTimeMs } from "../spot/candleTimestamp";

// Map ForwardTwin candle-array keys to canonical timeframe strings used by
// the candleTimestamp helpers (defect I: lookahead must use CLOSE-time).
const CANDLE_TF_MAP = {
  candles5m: "5m",
  candles15m: "15m",
  candles1h: "1h",
  candles4h: "4h",
} as const;

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
    atr: regime.atrPct > 0 ? (regime.atrPct * ticker.last) / 100 : 0,
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

export function validateNoLookahead(
  features: SpotAiFeatures,
  predictionTimestamp: number,
  snapshot?: ForwardTwinSnapshot,
): boolean {
  if (features.timestamp > predictionTimestamp) return false;

  if (snapshot) {
    const ticker = snapshot.ticker;
    if (ticker && ticker.fetchedAt > predictionTimestamp) return false;

    const intent = snapshot.intent;
    if (intent) {
      if (intent.createdAt > predictionTimestamp) return false;
      if (intent.lastEvaluatedAt !== null && intent.lastEvaluatedAt > predictionTimestamp) return false;
    }

    const candles = snapshot.candles;
    if (candles) {
      // Defect I: a candle is only safe to use if it is CLOSED, i.e.
      //   openTime + timeframe <= predictionTimestamp
      // Checking only openTime <= predictionTimestamp allows an still-open
      // candle whose close is in the future (lookahead). Use the canonical
      // candleTimestamp close-time helper.
      for (const tf of ["candles5m", "candles15m", "candles1h", "candles4h"] as const) {
        const ca = candles[tf];
        if (ca && ca.meta) {
          const closeMs = getCandleCloseTimeMs(ca.meta.lastTime, CANDLE_TF_MAP[tf]);
          if (closeMs === null) return false;
          if (closeMs > predictionTimestamp) return false;
        }
      }
    }
  }

  return true;
}

export function validateFeatureSchema(features: SpotAiFeatures): boolean {
  return features.featureSchemaVersion === SPOT_AI_FEATURE_SCHEMA_VERSION;
}

export interface FeatureDefinition {
  name: string;
  type: string;
  origin: string;
  timeframe: string;
  version: number;
}

export const CANONICAL_FEATURE_DEFINITIONS: FeatureDefinition[] = [
  { name: "pair", type: "string", origin: "snapshot.pair", timeframe: "point", version: 1 },
  { name: "scanId", type: "string", origin: "snapshot.scanId", timeframe: "point", version: 1 },
  { name: "timestamp", type: "number", origin: "snapshot.timestamp", timeframe: "point", version: 1 },
  { name: "regime", type: "string", origin: "snapshot.regime.regime", timeframe: "point", version: 1 },
  { name: "direction", type: "string", origin: "snapshot.regime.direction", timeframe: "point", version: 1 },
  { name: "macroBias", type: "string", origin: "snapshot.regime.macroBias", timeframe: "point", version: 1 },
  { name: "dataHealth", type: "string", origin: "snapshot.dataHealth", timeframe: "point", version: 1 },
  { name: "bid", type: "number", origin: "snapshot.ticker.bid", timeframe: "point", version: 1 },
  { name: "ask", type: "number", origin: "snapshot.ticker.ask", timeframe: "point", version: 1 },
  { name: "last", type: "number", origin: "snapshot.ticker.last", timeframe: "point", version: 1 },
  { name: "spreadPct", type: "number", origin: "snapshot.ticker.spreadPct", timeframe: "point", version: 1 },
  { name: "atr", type: "number", origin: "computed: atrPct * last / 100", timeframe: "point", version: 1 },
  { name: "atrPct", type: "number", origin: "snapshot.regime.atrPct", timeframe: "point", version: 1 },
  { name: "adx", type: "number", origin: "snapshot.regime.adx", timeframe: "point", version: 1 },
  { name: "ema20", type: "number", origin: "snapshot.regime.ema20", timeframe: "point", version: 1 },
  { name: "ema50", type: "number", origin: "snapshot.regime.ema50", timeframe: "point", version: 1 },
  { name: "ema200", type: "number", origin: "snapshot.regime.ema200", timeframe: "point", version: 1 },
  { name: "emaAlignment", type: "string", origin: "snapshot.regime.emaAlignment", timeframe: "point", version: 1 },
  { name: "volume", type: "number", origin: "snapshot.volume.volume24h", timeframe: "24h", version: 1 },
  { name: "volumeRatio", type: "number", origin: "snapshot.volume.volumeRatio", timeframe: "point", version: 1 },
  { name: "participation", type: "string", origin: "snapshot.volume.participation", timeframe: "point", version: 1 },
  { name: "setupTag", type: "string|null", origin: "snapshot.signal.setupTag", timeframe: "point", version: 1 },
  { name: "signalConfidence", type: "number", origin: "snapshot.signal.confidence", timeframe: "point", version: 1 },
  { name: "intentState", type: "string|null", origin: "snapshot.intent.state", timeframe: "point", version: 1 },
  { name: "antiLateEntryState", type: "string|null", origin: "snapshot.intent.lastBlockReason", timeframe: "point", version: 1 },
  { name: "availableCapital", type: "number", origin: "snapshot.capital.availableCapital", timeframe: "point", version: 1 },
  { name: "reservedCapital", type: "number", origin: "snapshot.capital.reservedCapital", timeframe: "point", version: 1 },
  { name: "openLotsForPair", type: "number", origin: "snapshot.capital.openLots", timeframe: "point", version: 1 },
  { name: "notionalUsd", type: "number|null", origin: "snapshot.sizing.notionalUsd", timeframe: "point", version: 1 },
  { name: "initialRiskUsd", type: "number|null", origin: "snapshot.sizing.riskUsd", timeframe: "point", version: 1 },
];
