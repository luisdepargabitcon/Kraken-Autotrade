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
  ModelRegistryEntry,
  ModelStatus,
} from "./spotAiForwardTwinTypes";
import type { ForwardTwinSnapshot } from "../spot/spotForwardTwinTypes";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import * as fs from "fs";

/**
 * INFERENCE_IMPLEMENTED = NO.
 *
 * A real predictor (loading the .joblib artifact and producing probabilities)
 * is not yet implemented. Therefore ADVISORY_ACTIVE_ALLOWED = NO: even if a
 * model row has status = ACTIVE_ADVISORY in the DB, the advisory layer must
 * fail closed and NOT report ADVISORY status or produce predictions.
 *
 * Defect L: active advisory requires ALL of:
 *   - ACTIVE_ADVISORY DB status
 *   - artifact file exists at modelPath
 *   - feature schema compatible
 *   - a real predictor available (INFERENCE_IMPLEMENTED)
 */
const INFERENCE_IMPLEMENTED = false;

class SpotAiAdvisoryService {
  private maxLogs = 1000;

  /**
   * Defect L: an active advisory is only allowed when ALL conditions hold:
   * ACTIVE_ADVISORY DB status, artifact file exists, schema compatible, and a
   * real predictor is available (INFERENCE_IMPLEMENTED). Returns false
   * otherwise (fail closed).
   */
  private isAdvisoryActiveAllowed(entry: ModelRegistryEntry | null): boolean {
    if (!entry) return false;
    if (entry.status !== "ACTIVE_ADVISORY") return false;
    if (entry.featureSchemaVersion !== SPOT_AI_FEATURE_SCHEMA_VERSION) return false;
    if (!entry.modelPath || !fs.existsSync(entry.modelPath)) return false;
    if (!INFERENCE_IMPLEMENTED) return false;
    return true;
  }

  async getStatus(
    totalSnapshots: number,
    labeledTrades: number,
  ): Promise<SpotAiStatusResponse> {
    const entryModel = await modelRegistry.getActiveAdvisory("SPOT_AI_FORWARD_TWIN_ENTRY");
    const givebackModel = await modelRegistry.getActiveAdvisory("SPOT_AI_FORWARD_TWIN_GIVEBACK");

    // Defect L: ADVISORY status requires a real, artifact-backed, schema-
    // compatible predictor (INFERENCE_IMPLEMENTED). Until then, fail closed.
    let status: SpotAiStatus = "COLLECTING";
    if (this.isAdvisoryActiveAllowed(entryModel)) {
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
      // R3: durable training storage (migration 090) is NOT applied yet.
      // The training pipeline is NOT ready until durable completed trade
      // storage exists. The rolling 7-day raw snapshot count is NOT a durable
      // basis for training.
      trainingPipelineReady: false,
      durableLabeledTrades: null,
    };
  }

  async computeEntryAdvisory(snapshot: ForwardTwinSnapshot): Promise<SpotAiEntryPrediction | null> {
    const entryModel = await modelRegistry.getActiveAdvisory("SPOT_AI_FORWARD_TWIN_ENTRY");
    // Defect L: fail closed unless a real predictor is available.
    if (!this.isAdvisoryActiveAllowed(entryModel)) return null;

    let features;
    try {
      features = buildFeaturesFromSnapshot(snapshot);
    } catch {
      return null;
    }

    // No real model artifact / predictor exists yet — cannot produce inference.
    // Return null to indicate MODEL_INFERENCE_NOT_AVAILABLE.
    // When a real predictor is implemented, it will load the artifact
    // from modelPath and produce actual probabilities.
    void features;
    return null;
  }

  async computeGivebackAdvisory(
    snapshot: ForwardTwinSnapshot,
    lotId: string,
  ): Promise<SpotAiGivebackPrediction | null> {
    const givebackModel = await modelRegistry.getActiveAdvisory("SPOT_AI_FORWARD_TWIN_GIVEBACK");
    // Defect L: fail closed unless a real predictor is available.
    if (!this.isAdvisoryActiveAllowed(givebackModel)) return null;

    // No real model artifact / predictor exists yet — cannot produce inference.
    void snapshot; void lotId;
    return null;
  }

  async logAdvisory(log: SpotAiAdvisoryLog): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO spot_ai_advisory_logs
          (scan_id, pair, model_name, model_version, feature_schema_version,
           entry_quality_score, prob_0_5r, prob_1r, prob_2r,
           expected_mfe_r, expected_mae_r, prob_net_profit, giveback_risk_score, lot_id, timestamp)
        VALUES
          (${log.scanId}, ${log.pair}, 'SPOT_AI_FORWARD_TWIN_ENTRY', ${log.modelVersion},
           ${log.featureSchemaVersion}, ${log.entryQualityScore},
           ${log.prob_0_5R ?? null}, ${log.prob_1R}, ${log.prob_2R ?? null},
           ${log.expectedMfeR ?? null}, ${log.expectedMaeR ?? null},
           ${log.prob_net_profit ?? null}, ${log.givebackRiskScore ?? null},
           ${log.lotId ?? null}, ${log.timestamp})
      `);
    } catch (error: any) {
      console.error(`[SpotAiAdvisory] Failed to log advisory: ${error.message}`);
    }
  }

  async getRecentAdvisoryLogs(limit: number = 50): Promise<SpotAiAdvisoryLog[]> {
    try {
      const rows = await db.execute(sql`
        SELECT scan_id, pair, model_version, feature_schema_version,
               entry_quality_score, prob_0_5r, prob_1r, prob_2r,
               expected_mfe_r, expected_mae_r, prob_net_profit,
               giveback_risk_score, lot_id, timestamp
        FROM spot_ai_advisory_logs
        ORDER BY timestamp DESC
        LIMIT ${limit}
      `);
      return ((rows.rows ?? []) as any[]).map((r: any) => ({
        scanId: r.scan_id,
        pair: r.pair,
        modelVersion: r.model_version,
        featureSchemaVersion: r.feature_schema_version,
        entryQualityScore: r.entry_quality_score ?? 0,
        prob_0_5R: r.prob_0_5r ?? 0,
        prob_1R: r.prob_1r ?? 0,
        prob_2R: r.prob_2r ?? 0,
        expectedMfeR: r.expected_mfe_r ?? 0,
        expectedMaeR: r.expected_mae_r ?? 0,
        prob_net_profit: r.prob_net_profit ?? 0,
        givebackRiskScore: r.giveback_risk_score ?? null,
        lotId: r.lot_id ?? null,
        timestamp: parseInt(r.timestamp ?? "0"),
      }));
    } catch {
      return [];
    }
  }

  canTrain(labeledTrades: number): boolean {
    return labeledTrades >= MIN_TRADES_TO_TRAIN;
  }
}

export const advisoryService = new SpotAiAdvisoryService();
