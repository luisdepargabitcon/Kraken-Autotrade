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

export interface AiDiagnostic {
  operationsCount: number;
  trainingTradesTotal: number;
  closedTradesCount: number;
  labeledTradesCount: number;
  openTradesCount: number;
  openLotsCount: number;
  openTradesDescription: string;
  openLotsDescription: string;
  lastBackfillRun: Date | null;
  lastBackfillError: string | null;
  lastTrainRun: Date | null;
  lastTrainError: string | null;
  modelVersion: string | null;
  discardReasonsDataset: Record<string, number>;
  lastBackfillDiscardReasons: Record<string, number>;
  winRate: number | null;
  avgPnlNet: number | null;
  avgHoldTimeMinutes: number | null;
}

const MODEL_DIR = "/tmp/models";
const MODEL_PATH = `${MODEL_DIR}/ai_filter.joblib`;
const STATUS_PATH = `${MODEL_DIR}/ai_status.json`;

const MIN_SAMPLES_TRAIN = 300;
const MIN_SAMPLES_ACTIVATE = 300;

const LEGACY_KEY_MAP: Record<string, string> = {
  'no_matching_sell': 'venta_sin_compra_previa',
  'invalid_data': 'datos_invalidos',
  'outlier_pnl': 'pnl_atipico',
  'excessive_hold': 'hold_excesivo',
  'abnormal_fees': 'comisiones_anormales',
  'invalid_timestamps': 'timestamps_invalidos',
  'sell_exceeds_lots': 'venta_excede_lotes',
  'no_execution_date': 'sin_fecha_ejecucion',
};

function translateDiscardReasons(reasons: Record<string, number>): Record<string, number> {
  const translated: Record<string, number> = {};
  for (const [key, count] of Object.entries(reasons)) {
    const translatedKey = LEGACY_KEY_MAP[key] || key;
    translated[translatedKey] = (translated[translatedKey] || 0) + count;
  }
  return translated;
}

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
    const labeledCount = await storage.getTrainingTradesCount({ labeled: true });
    
    let phase: "red" | "yellow" | "green" = "red";
    let phaseLabel = "Recolectando datos";
    
    if (labeledCount >= MIN_SAMPLES_ACTIVATE && aiConfig?.filterEnabled) {
      phase = "green";
      phaseLabel = "Filtro activo";
    } else if (labeledCount >= MIN_SAMPLES_TRAIN) {
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
      completeSamples: labeledCount,
      minSamplesForTrain: MIN_SAMPLES_TRAIN,
      minSamplesForActivate: MIN_SAMPLES_ACTIVATE,
      canTrain: labeledCount >= MIN_SAMPLES_TRAIN,
      canActivate: labeledCount >= MIN_SAMPLES_ACTIVATE && modelExists,
      filterEnabled: aiConfig?.filterEnabled ?? false,
      shadowEnabled: aiConfig?.shadowEnabled ?? false,
      modelLoaded: modelExists && this.modelLoaded,
      lastTrainTs: aiConfig?.lastTrainTs ?? null,
      threshold: parseFloat(aiConfig?.threshold ?? "0.60"),
      metrics,
    };
  }

  async getDiagnostic(): Promise<AiDiagnostic> {
    const aiConfig = await storage.getAiConfig();
    const allTrades = await storage.getAllTradesForBackfill();
    const trainingTradesTotal = await storage.getTrainingTradesCount();
    const closedCount = await storage.getTrainingTradesCount({ closed: true });
    const labeledCount = await storage.getTrainingTradesCount({ labeled: true });
    const openCount = await storage.getTrainingTradesCount({ closed: false });
    const openLotsCount = await storage.getTrainingTradesCount({ hasOpenLots: true });
    
    const labeledTrades = await storage.getTrainingTrades({ labeled: true });
    
    const rawDiscardReasonsDataset = await storage.getDiscardReasonsDataset();
    const discardReasonsDataset = translateDiscardReasons(rawDiscardReasonsDataset);
    
    const rawLastBackfillDiscardReasons: Record<string, number> = 
      (aiConfig?.lastBackfillDiscardReasonsJson as Record<string, number>) || {};
    const lastBackfillDiscardReasons = translateDiscardReasons(rawLastBackfillDiscardReasons);
    
    let winRate: number | null = null;
    let avgPnlNet: number | null = null;
    let avgHoldTimeMinutes: number | null = null;
    
    if (labeledTrades.length > 0) {
      const wins = labeledTrades.filter(t => t.labelWin === 1).length;
      winRate = (wins / labeledTrades.length) * 100;
      
      const pnlSum = labeledTrades.reduce((sum, t) => sum + parseFloat(t.pnlNet || '0'), 0);
      avgPnlNet = pnlSum / labeledTrades.length;
      
      const holdSum = labeledTrades.reduce((sum, t) => sum + (t.holdTimeMinutes || 0), 0);
      avgHoldTimeMinutes = holdSum / labeledTrades.length;
    }
    
    return {
      operationsCount: allTrades.length,
      trainingTradesTotal,
      closedTradesCount: closedCount,
      labeledTradesCount: labeledCount,
      openTradesCount: openCount,
      openLotsCount,
      openTradesDescription: "training_trades con isClosed=false",
      openLotsDescription: "training_trades con qtyRemaining > 0",
      lastBackfillRun: aiConfig?.lastBackfillTs ?? null,
      lastBackfillError: aiConfig?.lastBackfillError ?? null,
      lastTrainRun: aiConfig?.lastTrainTs ?? null,
      lastTrainError: aiConfig?.lastTrainError ?? null,
      modelVersion: aiConfig?.modelVersion ?? null,
      discardReasonsDataset,
      lastBackfillDiscardReasons,
      winRate,
      avgPnlNet,
      avgHoldTimeMinutes,
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

  async runTraining(): Promise<{ 
    success: boolean; 
    message: string; 
    errorCode?: string;
    required?: number;
    current?: number;
    metrics?: { accuracy: number; precision: number; recall: number; f1: number; trainSize: number; valSize: number } 
  }> {
    const labeledTrades = await storage.getTrainingTrades({ labeled: true });
    
    if (labeledTrades.length < MIN_SAMPLES_TRAIN) {
      return { 
        success: false, 
        errorCode: "INSUFFICIENT_DATA",
        message: `Datos insuficientes para entrenar el modelo. Necesitas ${MIN_SAMPLES_TRAIN} trades cerrados etiquetados. Actualmente hay ${labeledTrades.length}.`,
        required: MIN_SAMPLES_TRAIN,
        current: labeledTrades.length
      };
    }

    if (!fs.existsSync(MODEL_DIR)) {
      fs.mkdirSync(MODEL_DIR, { recursive: true });
    }

    const sortedTrades = [...labeledTrades].sort((a, b) => {
      const timeA = a.entryTs ? new Date(a.entryTs).getTime() : 0;
      const timeB = b.entryTs ? new Date(b.entryTs).getTime() : 0;
      return timeA - timeB;
    });

    const validTrades = sortedTrades.filter(trade => {
      const entryTime = trade.entryTs ? new Date(trade.entryTs).getTime() : 0;
      const exitTime = trade.exitTs ? new Date(trade.exitTs).getTime() : 0;
      const entryPrice = parseFloat(trade.entryPrice || '0');
      const exitPrice = parseFloat(trade.exitPrice || '0');
      const amount = parseFloat(trade.entryAmount || '0');
      
      if (exitTime <= entryTime) return false;
      if (entryPrice <= 0 || exitPrice <= 0) return false;
      if (amount <= 0) return false;
      if (trade.holdTimeMinutes !== null && trade.holdTimeMinutes < 0) return false;
      
      return true;
    });

    if (validTrades.length < MIN_SAMPLES_TRAIN) {
      return { 
        success: false, 
        errorCode: "INSUFFICIENT_DATA",
        message: `Datos insuficientes para entrenar el modelo. Solo hay ${validTrades.length} trades válidos después de validación. Necesitas ${MIN_SAMPLES_TRAIN}.`,
        required: MIN_SAMPLES_TRAIN,
        current: validTrades.length
      };
    }

    const splitIdx = Math.floor(validTrades.length * 0.8);
    const trainTrades = validTrades.slice(0, splitIdx);
    const valTrades = validTrades.slice(splitIdx);

    const trainingData = {
      train: trainTrades.map(trade => ({
        tradeId: trade.buyTxid,
        pair: trade.pair,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        pnlNet: trade.pnlNet,
        pnlPct: trade.pnlPct,
        holdTimeMinutes: trade.holdTimeMinutes,
        labelWin: trade.labelWin,
        featuresJson: trade.featuresJson || {},
        entryTs: trade.entryTs,
      })),
      val: valTrades.map(trade => ({
        tradeId: trade.buyTxid,
        pair: trade.pair,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        pnlNet: trade.pnlNet,
        pnlPct: trade.pnlPct,
        holdTimeMinutes: trade.holdTimeMinutes,
        labelWin: trade.labelWin,
        featuresJson: trade.featuresJson || {},
        entryTs: trade.entryTs,
      })),
    };

    const samplesPath = `${MODEL_DIR}/training_samples.json`;
    fs.writeFileSync(samplesPath, JSON.stringify(trainingData, null, 2));

    const modelVersion = `v${Date.now()}`;

    return new Promise((resolve) => {
      const pythonScript = path.join(process.cwd(), "server/services/mlTrainer.py");
      
      if (!fs.existsSync(pythonScript)) {
        storage.updateAiConfig({ lastTrainError: "Script de entrenamiento no encontrado" });
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
          const errorMsg = stderr.slice(0, 500) || 'Unknown training error';
          await storage.updateAiConfig({ lastTrainError: errorMsg });
          resolve({ success: false, message: `Error en entrenamiento: ${errorMsg.slice(0, 200)}` });
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          const metrics = {
            accuracy: result.metrics?.accuracy ?? 0,
            precision: result.metrics?.precision ?? 0,
            recall: result.metrics?.recall ?? 0,
            f1: result.metrics?.f1 ?? 0,
            trainSize: trainTrades.length,
            valSize: valTrades.length,
          };
          
          await storage.updateAiConfig({
            lastTrainTs: new Date(),
            lastTrainError: null,
            nSamples: validTrades.length,
            modelPath: MODEL_PATH,
            modelVersion,
            metricsJson: metrics,
          });

          this.modelLoaded = true;
          
          resolve({
            success: true,
            message: `Modelo ${modelVersion} entrenado: ${trainTrades.length} train / ${valTrades.length} val. Accuracy: ${(metrics.accuracy * 100).toFixed(1)}%`,
            metrics,
          });
        } catch (e: any) {
          await storage.updateAiConfig({
            lastTrainTs: new Date(),
            lastTrainError: null,
            modelVersion,
          });
          resolve({ success: true, message: `Modelo ${modelVersion} entrenado (sin métricas parseables)` });
        }
      });

      proc.on("error", async (err) => {
        console.error("[AI] Training spawn error:", err);
        await storage.updateAiConfig({ lastTrainError: err.message });
        resolve({ success: false, message: `Error: ${err.message}` });
      });
    });
  }

  async runBackfill(): Promise<{ success: boolean; message: string; stats: { created: number; closed: number; labeled: number; discardReasons: Record<string, number> } }> {
    try {
      const stats = await storage.runTrainingTradesBackfill();
      
      await storage.updateAiConfig({
        lastBackfillTs: new Date(),
        lastBackfillError: null,
        lastBackfillDiscardReasonsJson: stats.discardReasons,
      });
      
      return {
        success: true,
        message: `Backfill completado: ${stats.created} trades creados, ${stats.closed} cerrados, ${stats.labeled} etiquetados`,
        stats,
      };
    } catch (error: any) {
      const errorMsg = error.message || 'Unknown error';
      await storage.updateAiConfig({
        lastBackfillTs: new Date(),
        lastBackfillError: errorMsg,
      });
      
      return {
        success: false,
        message: `Error en backfill: ${errorMsg}`,
        stats: { created: 0, closed: 0, labeled: 0, discardReasons: {} },
      };
    }
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
