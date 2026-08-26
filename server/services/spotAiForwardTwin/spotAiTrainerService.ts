/**
 * spotAiTrainerService — Manual training pipeline for Forward Twin AI.
 *
 * INVARIANTS:
 *   - AUTO_RETRAIN = NO. Only manual trigger.
 *   - Training blocked if labeledTrades < MIN_TRADES_TO_TRAIN.
 *   - Executes outside hot path (spawn Python subprocess).
 *   - Evaluates baselines: LogisticRegression, RandomForest, GradientBoosting.
 *   - Selects by out-of-sample validation, not training accuracy.
 *   - Never overwrites previous model — creates new version.
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { modelRegistry } from "./spotAiModelRegistry";
import { advisoryService } from "./spotAiAdvisoryService";
import { MIN_TRADES_TO_TRAIN, PREFERRED_TRADES_TO_TRAIN } from "./spotAiForwardTwinTypes";
import type { SpotAiDataset, ModelRegistryEntry, ModelName } from "./spotAiForwardTwinTypes";

const PYTHON_BIN = process.env.AI_PYTHON_BIN || "python3";

const MODEL_DIR = process.env.AI_MODEL_DIR
  ? path.join(process.env.AI_MODEL_DIR, "spot_forward_twin")
  : "/tmp/models/spot_forward_twin";

export interface TrainResult {
  success: boolean;
  message: string;
  errorCode?: string;
  modelVersion?: string;
  metrics?: Record<string, number>;
}

class SpotAiTrainerService {
  async trainEntryModel(dataset: SpotAiDataset, gitSha: string): Promise<TrainResult> {
    return this.trainModel(dataset, "SPOT_AI_FORWARD_TWIN_ENTRY", gitSha);
  }

  async trainGivebackModel(dataset: SpotAiDataset, gitSha: string): Promise<TrainResult> {
    return this.trainModel(dataset, "SPOT_AI_FORWARD_TWIN_GIVEBACK", gitSha);
  }

  private async trainModel(
    dataset: SpotAiDataset,
    modelName: ModelName,
    gitSha: string,
  ): Promise<TrainResult> {
    if (!advisoryService.canTrain(dataset.labeledTradeCount)) {
      return {
        success: false,
        errorCode: "INSUFFICIENT_DATA",
        message: `Insufficient labeled trades: ${dataset.labeledTradeCount}. Minimum: ${MIN_TRADES_TO_TRAIN}.`,
      };
    }

    if (dataset.labeledTradeCount < PREFERRED_TRADES_TO_TRAIN) {
      console.warn(
        `[SpotAiTrainer] Warning: only ${dataset.labeledTradeCount} labeled trades (preferred: ${PREFERRED_TRADES_TO_TRAIN}). Proceeding with caution.`,
      );
    }

    const modelVersion = `v${Date.now()}`;
    const modelPath = modelRegistry.getModelPath(modelName, modelVersion);

    // Defect M: check trainer availability BEFORE creating MODEL_DIR or
    // writing dataset_v*.json. If the trainer script does not exist, fail
    // closed with TRAINER_NOT_AVAILABLE and NO side effects on disk.
    const scriptPath = path.join(process.cwd(), "server/services/spotAiForwardTwin/spotAiMlTrainer.py");
    if (!fs.existsSync(scriptPath)) {
      return {
        success: false,
        errorCode: "TRAINER_NOT_AVAILABLE",
        message: `Python trainer script not found at ${scriptPath}. Cannot train model.`,
      };
    }

    if (!fs.existsSync(MODEL_DIR)) {
      fs.mkdirSync(MODEL_DIR, { recursive: true });
    }

    const datasetPath = path.join(MODEL_DIR, `dataset_${modelVersion}.json`);
    fs.writeFileSync(datasetPath, JSON.stringify(dataset));

    return new Promise(resolve => {
      const proc = spawn(PYTHON_BIN, [scriptPath, "train", datasetPath, modelPath, modelName]);
      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", d => (stdout += d.toString()));
      proc.stderr.on("data", d => (stderr += d.toString()));

      proc.on("close", async code => {
        if (code !== 0) {
          resolve({ success: false, message: `Training failed: ${stderr.slice(0, 500)}` });
          return;
        }

        let metrics: Record<string, number> = {};
        try {
          const result = JSON.parse(stdout.trim());
          metrics = result.metrics ?? {};
        } catch {
          // non-fatal
        }

        const entry: ModelRegistryEntry = {
          modelName,
          modelVersion,
          featureSchemaVersion: dataset.featureSchemaVersion,
          status: "CANDIDATE",
          datasetStart: dataset.samples[0]?.features.timestamp ?? 0,
          datasetEnd: dataset.samples[dataset.samples.length - 1]?.features.timestamp ?? 0,
          tradeCount: dataset.labeledTradeCount,
          gitSha,
          trainedAt: Date.now(),
          metrics,
          modelPath,
        };
        await modelRegistry.register(entry);

        resolve({
          success: true,
          modelVersion,
          metrics,
          message: `Model ${modelName} ${modelVersion} trained and registered as CANDIDATE.`,
        });
      });

      proc.on("error", () => {
        resolve({ success: false, message: "Python runtime error during training." });
      });
    });
  }
}

export const trainerService = new SpotAiTrainerService();
