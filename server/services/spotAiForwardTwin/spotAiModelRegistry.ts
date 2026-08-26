/**
 * spotAiModelRegistry — Append-only model registry for Forward Twin AI.
 *
 * Stores model metadata in DB table spot_ai_model_registry (migration 089).
 * Never overwrites previous versions.
 * States: CANDIDATE → VALIDATED → ACTIVE_ADVISORY → RETIRED.
 *
 * Artifacts (.joblib) remain on filesystem, but canonical metadata is in DB.
 */

import * as path from "path";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import type { ModelRegistryEntry, ModelName, ModelStatus } from "./spotAiForwardTwinTypes";

const MODEL_DIR = process.env.AI_MODEL_DIR
  ? path.join(process.env.AI_MODEL_DIR, "spot_forward_twin")
  : "/tmp/models/spot_forward_twin";

export class SpotAiModelRegistry {

  async register(entry: ModelRegistryEntry): Promise<void> {
    try {
      await db.execute(sql`
        INSERT INTO spot_ai_model_registry
          (model_name, model_version, feature_schema_version, status,
           dataset_start, dataset_end, trade_count, git_sha, trained_at,
           metrics_json, model_path)
        VALUES
          (${entry.modelName}, ${entry.modelVersion}, ${entry.featureSchemaVersion},
           ${entry.status}, ${entry.datasetStart}, ${entry.datasetEnd},
           ${entry.tradeCount}, ${entry.gitSha}, ${entry.trainedAt},
           ${JSON.stringify(entry.metrics)}::jsonb, ${entry.modelPath})
      `);
    } catch (error: any) {
      if (error.message?.includes("unique") || error.code === "23505") {
        throw new Error(
          `Model ${entry.modelName} version ${entry.modelVersion} already registered. Version must be unique.`,
        );
      }
      throw error;
    }
  }

  async getLatest(modelName: ModelName): Promise<ModelRegistryEntry | null> {
    try {
      const rows = await db.execute(sql`
        SELECT * FROM spot_ai_model_registry
        WHERE model_name = ${modelName}
        ORDER BY trained_at DESC LIMIT 1
      `);
      const r = (rows.rows ?? [])[0] as any;
      return r ? this.mapRow(r) : null;
    } catch {
      return null;
    }
  }

  async getActiveAdvisory(modelName: ModelName): Promise<ModelRegistryEntry | null> {
    try {
      const rows = await db.execute(sql`
        SELECT * FROM spot_ai_model_registry
        WHERE model_name = ${modelName} AND status = 'ACTIVE_ADVISORY'
        LIMIT 1
      `);
      const r = (rows.rows ?? [])[0] as any;
      return r ? this.mapRow(r) : null;
    } catch {
      return null;
    }
  }

  async updateStatus(modelName: ModelName, modelVersion: string, status: ModelStatus): Promise<void> {
    const result = await db.execute(sql`
      UPDATE spot_ai_model_registry
      SET status = ${status}
      WHERE model_name = ${modelName} AND model_version = ${modelVersion}
    `);
    if ((result as any)?.rowCount === 0) {
      throw new Error(`Model ${modelName} version ${modelVersion} not found in registry.`);
    }
  }

  async listAll(): Promise<ModelRegistryEntry[]> {
    try {
      const rows = await db.execute(sql`
        SELECT * FROM spot_ai_model_registry ORDER BY trained_at DESC
      `);
      return ((rows.rows ?? []) as any[]).map(r => this.mapRow(r));
    } catch {
      return [];
    }
  }

  async listByModel(modelName: ModelName): Promise<ModelRegistryEntry[]> {
    try {
      const rows = await db.execute(sql`
        SELECT * FROM spot_ai_model_registry
        WHERE model_name = ${modelName}
        ORDER BY trained_at DESC
      `);
      return ((rows.rows ?? []) as any[]).map(r => this.mapRow(r));
    } catch {
      return [];
    }
  }

  getModelPath(modelName: ModelName, modelVersion: string): string {
    const prefix = modelName === "SPOT_AI_FORWARD_TWIN_ENTRY" ? "entry" : "giveback";
    return path.join(MODEL_DIR, `${prefix}_${modelVersion}.joblib`);
  }

  private mapRow(r: any): ModelRegistryEntry {
    let metrics: Record<string, number> = {};
    try {
      metrics = typeof r.metrics_json === "string" ? JSON.parse(r.metrics_json) : (r.metrics_json ?? {});
    } catch {
      metrics = {};
    }
    return {
      modelName: r.model_name,
      modelVersion: r.model_version,
      featureSchemaVersion: r.feature_schema_version,
      status: r.status as ModelStatus,
      datasetStart: r.dataset_start ?? 0,
      datasetEnd: r.dataset_end ?? 0,
      tradeCount: r.trade_count ?? 0,
      gitSha: r.git_sha ?? "",
      trainedAt: r.trained_at ?? 0,
      metrics,
      modelPath: r.model_path ?? "",
    };
  }
}

export const modelRegistry = new SpotAiModelRegistry();
