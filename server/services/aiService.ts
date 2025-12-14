import { storage } from "../storage";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface AiFeatures {
  rsi14: number;
  macdLine: number;
  macdSignal: number;
  macdHist: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  atr14: number;
  ema12: number;
  ema26: number;
  volume24hChange: number;
  priceChange1h: number;
  priceChange4h: number;
  priceChange24h: number;
  spreadPct: number;
  confidence: number;
}

export interface AiPrediction {
  approve: boolean;
  score: number;
  threshold: number;
}

export interface AiStatus {
  phase: "red" | "yellow" | "green";
  phaseLabel: string;
  completeSamples: number;
  minSamplesForTrain: number;
  minSamplesForActivate: number;
  canTrain: boolean;
  canActivate: boolean;
  filterEnabled: boolean;
  shadowEnabled: boolean;
  modelLoaded: boolean;
  lastTrainTs: Date | null;
  threshold: number;
  metrics: {
    accuracy?: number;
    precision?: number;
    recall?: number;
    f1?: number;
    tradesBlocked?: number;
    lossesAvoided?: number;
  } | null;
}

const MODEL_DIR = "/tmp/models";
const MODEL_PATH = `${MODEL_DIR}/ai_filter.joblib`;
const STATUS_PATH = `${MODEL_DIR}/ai_status.json`;

const MIN_SAMPLES_TRAIN = 200;
const MIN_SAMPLES_ACTIVATE = 300;

class AiService {
  private modelLoaded: boolean = false;
  private cachedMetrics: any = null;

  extractFeatures(indicators: {
    rsi?: number;
    macd?: { line: number; signal: number; histogram: number };
    bollinger?: { upper: number; middle: number; lower: number };
    atr?: number;
    ema12?: number;
    ema26?: number;
    volume24hChange?: number;
    priceChange1h?: number;
    priceChange4h?: number;
    priceChange24h?: number;
    spreadPct?: number;
    confidence?: number;
  }): AiFeatures {
    return {
      rsi14: indicators.rsi ?? 50,
      macdLine: indicators.macd?.line ?? 0,
      macdSignal: indicators.macd?.signal ?? 0,
      macdHist: indicators.macd?.histogram ?? 0,
      bbUpper: indicators.bollinger?.upper ?? 0,
      bbMiddle: indicators.bollinger?.middle ?? 0,
      bbLower: indicators.bollinger?.lower ?? 0,
      atr14: indicators.atr ?? 0,
      ema12: indicators.ema12 ?? 0,
      ema26: indicators.ema26 ?? 0,
      volume24hChange: indicators.volume24hChange ?? 0,
      priceChange1h: indicators.priceChange1h ?? 0,
      priceChange4h: indicators.priceChange4h ?? 0,
      priceChange24h: indicators.priceChange24h ?? 0,
      spreadPct: indicators.spreadPct ?? 0,
      confidence: indicators.confidence ?? 50,
    };
  }

  async getStatus(): Promise<AiStatus> {
    const aiConfig = await storage.getAiConfig();
    const completeSamples = await storage.getAiSamplesCount(true);
    
    let phase: "red" | "yellow" | "green" = "red";
    let phaseLabel = "Recolectando datos";
    
    if (completeSamples >= MIN_SAMPLES_ACTIVATE && aiConfig?.filterEnabled) {
      phase = "green";
      phaseLabel = "Filtro activo";
    } else if (completeSamples >= MIN_SAMPLES_TRAIN) {
      phase = "yellow";
      phaseLabel = "Listo para entrenar";
    }

    const modelExists = fs.existsSync(MODEL_PATH);
    
    let metrics = null;
    if (fs.existsSync(STATUS_PATH)) {
      try {
        const statusData = fs.readFileSync(STATUS_PATH, "utf-8");
        metrics = JSON.parse(statusData);
        this.cachedMetrics = metrics;
      } catch (e) {
        metrics = this.cachedMetrics;
      }
    }

    return {
      phase,
      phaseLabel,
      completeSamples,
      minSamplesForTrain: MIN_SAMPLES_TRAIN,
      minSamplesForActivate: MIN_SAMPLES_ACTIVATE,
      canTrain: completeSamples >= MIN_SAMPLES_TRAIN,
      canActivate: completeSamples >= MIN_SAMPLES_ACTIVATE && modelExists,
      filterEnabled: aiConfig?.filterEnabled ?? false,
      shadowEnabled: aiConfig?.shadowEnabled ?? false,
      modelLoaded: modelExists && this.modelLoaded,
      lastTrainTs: aiConfig?.lastTrainTs ?? null,
      threshold: parseFloat(aiConfig?.threshold ?? "0.60"),
      metrics,
    };
  }

  async predict(features: AiFeatures): Promise<AiPrediction> {
    const aiConfig = await storage.getAiConfig();
    const threshold = parseFloat(aiConfig?.threshold ?? "0.60");
    
    if (!fs.existsSync(MODEL_PATH)) {
      return { approve: true, score: 0.5, threshold };
    }

    try {
      const featuresJson = JSON.stringify(features);
      const result = await this.runPythonPredict(featuresJson);
      const score = parseFloat(result.score);
      
      return {
        approve: score >= threshold,
        score,
        threshold,
      };
    } catch (error) {
      console.error("[AI] Prediction error:", error);
      return { approve: true, score: 0.5, threshold };
    }
  }

  private runPythonPredict(featuresJson: string): Promise<{ score: string }> {
    return new Promise((resolve, reject) => {
      const pythonScript = path.join(process.cwd(), "server/services/mlTrainer.py");
      
      if (!fs.existsSync(pythonScript)) {
        resolve({ score: "0.5" });
        return;
      }

      const proc = spawn("python3", [pythonScript, "predict", featuresJson], {
        cwd: process.cwd(),
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => (stdout += data.toString()));
      proc.stderr.on("data", (data) => (stderr += data.toString()));

      proc.on("close", (code) => {
        if (code !== 0) {
          console.error("[AI] Python predict error:", stderr);
          resolve({ score: "0.5" });
          return;
        }
        try {
          const result = JSON.parse(stdout.trim());
          resolve({ score: result.score?.toString() ?? "0.5" });
        } catch (e) {
          resolve({ score: "0.5" });
        }
      });

      proc.on("error", (err) => {
        console.error("[AI] Python spawn error:", err);
        resolve({ score: "0.5" });
      });
    });
  }

  async runTraining(): Promise<{ success: boolean; message: string }> {
    const samples = await storage.getAiSamples({ complete: true });
    
    if (samples.length < MIN_SAMPLES_TRAIN) {
      return {
        success: false,
        message: `Necesitas al menos ${MIN_SAMPLES_TRAIN} samples (tienes ${samples.length})`,
      };
    }

    if (!fs.existsSync(MODEL_DIR)) {
      fs.mkdirSync(MODEL_DIR, { recursive: true });
    }

    const samplesPath = `${MODEL_DIR}/training_samples.json`;
    fs.writeFileSync(samplesPath, JSON.stringify(samples, null, 2));

    return new Promise((resolve) => {
      const pythonScript = path.join(process.cwd(), "server/services/mlTrainer.py");
      
      if (!fs.existsSync(pythonScript)) {
        resolve({ success: false, message: "Script de entrenamiento no encontrado" });
        return;
      }

      const proc = spawn("python3", [pythonScript, "train", samplesPath], {
        cwd: process.cwd(),
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => (stdout += data.toString()));
      proc.stderr.on("data", (data) => (stderr += data.toString()));

      proc.on("close", async (code) => {
        if (code !== 0) {
          console.error("[AI] Training failed:", stderr);
          resolve({ success: false, message: `Error en entrenamiento: ${stderr.slice(0, 200)}` });
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          
          await storage.updateAiConfig({
            lastTrainTs: new Date(),
            nSamples: samples.length,
            modelPath: MODEL_PATH,
            metricsJson: result.metrics,
          });

          this.modelLoaded = true;
          
          resolve({
            success: true,
            message: `Modelo entrenado con ${samples.length} samples. Accuracy: ${(result.metrics?.accuracy * 100).toFixed(1)}%`,
          });
        } catch (e) {
          resolve({ success: true, message: "Modelo entrenado (sin métricas)" });
        }
      });

      proc.on("error", (err) => {
        console.error("[AI] Training spawn error:", err);
        resolve({ success: false, message: `Error: ${err.message}` });
      });
    });
  }

  async toggleFilter(enabled: boolean): Promise<void> {
    await storage.updateAiConfig({ filterEnabled: enabled });
  }

  async toggleShadow(enabled: boolean): Promise<void> {
    await storage.updateAiConfig({ shadowEnabled: enabled });
  }

  async setThreshold(threshold: number): Promise<void> {
    await storage.updateAiConfig({ threshold: threshold.toFixed(4) });
  }
}

export const aiService = new AiService();
