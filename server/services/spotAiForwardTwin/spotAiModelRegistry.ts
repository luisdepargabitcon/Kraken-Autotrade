/**
 * spotAiModelRegistry — Append-only model registry for Forward Twin AI.
 *
 * Stores model metadata in a JSON file. Never overwrites previous versions.
 * States: CANDIDATE → VALIDATED → ACTIVE_ADVISORY → RETIRED.
 */

import * as fs from "fs";
import * as path from "path";
import type { ModelRegistryEntry, ModelName, ModelStatus } from "./spotAiForwardTwinTypes";

const REGISTRY_DIR = process.env.AI_MODEL_DIR
  ? path.join(process.env.AI_MODEL_DIR, "spot_forward_twin")
  : "/tmp/models/spot_forward_twin";

const REGISTRY_PATH = path.join(REGISTRY_DIR, "registry.json");

export class SpotAiModelRegistry {
  private entries: ModelRegistryEntry[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(REGISTRY_PATH)) {
        const raw = fs.readFileSync(REGISTRY_PATH, "utf-8");
        this.entries = JSON.parse(raw);
      }
    } catch {
      this.entries = [];
    }
  }

  private persist(): void {
    if (!fs.existsSync(REGISTRY_DIR)) {
      fs.mkdirSync(REGISTRY_DIR, { recursive: true });
    }
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(this.entries, null, 2));
  }

  register(entry: ModelRegistryEntry): void {
    const exists = this.entries.some(
      e => e.modelName === entry.modelName && e.modelVersion === entry.modelVersion,
    );
    if (exists) {
      throw new Error(
        `Model ${entry.modelName} version ${entry.modelVersion} already registered. Version must be unique.`,
      );
    }
    this.entries.push(entry);
    this.persist();
  }

  getLatest(modelName: ModelName): ModelRegistryEntry | null {
    const filtered = this.entries.filter(e => e.modelName === modelName);
    if (filtered.length === 0) return null;
    return filtered.sort((a, b) => b.trainedAt - a.trainedAt)[0];
  }

  getActiveAdvisory(modelName: ModelName): ModelRegistryEntry | null {
    return (
      this.entries.find(e => e.modelName === modelName && e.status === "ACTIVE_ADVISORY") ?? null
    );
  }

  updateStatus(modelName: ModelName, modelVersion: string, status: ModelStatus): void {
    const entry = this.entries.find(
      e => e.modelName === modelName && e.modelVersion === modelVersion,
    );
    if (!entry) {
      throw new Error(`Model ${modelName} version ${modelVersion} not found in registry.`);
    }
    entry.status = status;
    this.persist();
  }

  listAll(): ModelRegistryEntry[] {
    return [...this.entries];
  }

  listByModel(modelName: ModelName): ModelRegistryEntry[] {
    return this.entries.filter(e => e.modelName === modelName);
  }

  getModelPath(modelName: ModelName, modelVersion: string): string {
    const prefix = modelName === "SPOT_AI_FORWARD_TWIN_ENTRY" ? "entry" : "giveback";
    return path.join(REGISTRY_DIR, `${prefix}_${modelVersion}.joblib`);
  }
}

export const modelRegistry = new SpotAiModelRegistry();
