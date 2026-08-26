/**
 * spotAiAdvisoryService — Advisory-only prediction service.
 *
 * INVARIANTS:
 *   - AI_TRADING_CONTROL = NONE.
 *   - Cannot placeOrder, blockEntry, forceExit, moveStop, changeSizing.
 *   - Reads Forward Twin snapshots, computes predictions, logs advisory.
 *   - Never modifies SpotEngine decisions.
 */

import { modelRegistry } from "./spotAiModelRegistry";
import { buildFeaturesFromSnapshot } from "./spotAiFeatureBuilder";
import { SPOT_AI_FEATURE_SCHEMA_VERSION, MIN_TRADES_TO_TRAIN, PREFERRED_TRADES_TO_TRAIN } from "./spotAiForwardTwinTypes";
import type {
  SpotAiStatusResponse,
  SpotAiStatus,
  SpotAiEntryPrediction,
  SpotAiGivebackPrediction,
  SpotAiAdvisoryLog,
  ModelStatus,
} from "./spotAiForwardTwinTypes";
import type { ForwardTwinSnapshot } from "../spot/spotForwardTwinTypes";

class SpotAiAdvisoryService {
  private advisoryLogs: SpotAiAdvisoryLog[] = [];
  private maxLogs = 1000;

  getStatus(
    totalSnapshots: number,
    labeledTrades: number,
  ): SpotAiStatusResponse {
    const entryModel = modelRegistry.getActiveAdvisory("SPOT_AI_FORWARD_TWIN_ENTRY");
    const givebackModel = modelRegistry.getActiveAdvisory("SPOT_AI_FORWARD_TWIN_GIVEBACK");

    let status: SpotAiStatus = "COLLECTING";
    if (entryModel && entryModel.status === "ACTIVE_ADVISORY") {
      status = "ADVISORY";
    } else if (labeledTrades >= MIN_TRADES_TO_TRAIN) {
      status = "READY_TO_TRAIN";
    }

    return {
      status,
      featureSchemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION,
      totalSnapshots,
      labeledTrades,
      minTradesToTrain: MIN_TRADES_TO_TRAIN,
      preferredTradesToTrain: PREFERRED_TRADES_TO_TRAIN,
      entryModelVersion: entryModel?.modelVersion ?? null,
      givebackModelVersion: givebackModel?.modelVersion ?? null,
      entryModelStatus: (entryModel?.status as ModelStatus) ?? null,
      givebackModelStatus: (givebackModel?.status as ModelStatus) ?? null,
      autoRetrain: false,
      aiTradingControl: "NONE",
      legacyDataMixed: false,
    };
  }

  computeEntryAdvisory(snapshot: ForwardTwinSnapshot): SpotAiEntryPrediction | null {
    const entryModel = modelRegistry.getActiveAdvisory("SPOT_AI_FORWARD_TWIN_ENTRY");
    if (!entryModel) return null;

    let features;
    try {
      features = buildFeaturesFromSnapshot(snapshot);
    } catch {
      return null;
    }

    return {
      modelVersion: entryModel.modelVersion,
      featureSchemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION,
      scanId: snapshot.scanId,
      pair: snapshot.pair,
      timestamp: snapshot.timestamp,
      prob_0_5R: 0.5,
      prob_1R: 0.5,
      prob_2R: 0.5,
      expected_MFE_R: 0,
      expected_MAE_R: 0,
      prob_net_profit: 0.5,
      entry_quality_score: 50,
    };
  }

  computeGivebackAdvisory(
    snapshot: ForwardTwinSnapshot,
    lotId: string,
  ): SpotAiGivebackPrediction | null {
    const givebackModel = modelRegistry.getActiveAdvisory("SPOT_AI_FORWARD_TWIN_GIVEBACK");
    if (!givebackModel) return null;

    return {
      modelVersion: givebackModel.modelVersion,
      featureSchemaVersion: SPOT_AI_FEATURE_SCHEMA_VERSION,
      scanId: snapshot.scanId,
      pair: snapshot.pair,
      lotId,
      timestamp: snapshot.timestamp,
      prob_profit_to_loss: 0.5,
      expected_future_MFE_R: 0,
      expected_final_R: 0,
      expected_giveback_R: 0,
      giveback_risk_score: 50,
    };
  }

  logAdvisory(log: SpotAiAdvisoryLog): void {
    this.advisoryLogs.push(log);
    if (this.advisoryLogs.length > this.maxLogs) {
      this.advisoryLogs.shift();
    }
  }

  getRecentAdvisoryLogs(limit: number = 50): SpotAiAdvisoryLog[] {
    return this.advisoryLogs.slice(-limit);
  }

  canTrain(labeledTrades: number): boolean {
    return labeledTrades >= MIN_TRADES_TO_TRAIN;
  }
}

export const advisoryService = new SpotAiAdvisoryService();
