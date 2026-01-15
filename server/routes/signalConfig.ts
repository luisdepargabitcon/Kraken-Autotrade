import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { botLogger } from "../services/botLogger";
import { environment } from "../services/environment";

// Interfaces for signal configuration
interface SignalConfig {
  trend: { min: number; max: number; current: number };
  range: { min: number; max: number; current: number };
  transition: { min: number; max: number; current: number };
}

interface SimulationResult {
  tradesExecuted: number;
  falsePositives: number;
  profitability: number;
  impact: {
    trades: string;
    risk: string;
    confidence: string;
  };
}

interface OptimizationSuggestion {
  regime: string;
  recommended: number;
  reason: string;
  confidence: number;
  expectedImpact: string;
}

// Validation schemas
const SIGNAL_CONFIG_SCHEMA = z.object({
  trend: z.object({
    min: z.number().min(1).max(10),
    max: z.number().min(1).max(10),
    current: z.number().min(1).max(10),
  }),
  range: z.object({
    min: z.number().min(1).max(10),
    max: z.number().min(1).max(10),
    current: z.number().min(1).max(10),
  }),
  transition: z.object({
    min: z.number().min(1).max(10),
    max: z.number().min(1).max(10),
    current: z.number().min(1).max(10),
  }),
});

const SIMULATION_SCHEMA = z.object({
  trend: z.object({
    min: z.number().min(1).max(10),
    max: z.number().min(1).max(10),
    current: z.number().min(1).max(10),
  }),
  range: z.object({
    min: z.number().min(1).max(10),
    max: z.number().min(1).max(10),
    current: z.number().min(1).max(10),
  }),
  transition: z.object({
    min: z.number().min(1).max(10),
    max: z.number().min(1).max(10),
    current: z.number().min(1).max(10),
  }),
});

// Default configuration
const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  trend: { min: 3, max: 8, current: 5 },
  range: { min: 4, max: 10, current: 6 },
  transition: { min: 2, max: 6, current: 4 },
};

export function registerSignalConfigRoutes(app: Express): void {
  // GET current signal configuration
  app.get("/api/trading/signals/config", async (req, res) => {
    try {
      const config = await storage.getSignalConfig();
      
      // If no config exists, return defaults
      if (!config) {
        return res.json(DEFAULT_SIGNAL_CONFIG);
      }

      // Validate and ensure structure
      const validatedConfig = SIGNAL_CONFIG_SCHEMA.parse(config);
      res.json(validatedConfig);
    } catch (error) {
      console.error("[signals/config] Error:", error);
      res.status(500).json({ error: "Failed to get signal configuration" });
    }
  });

  // PUT update signal configuration
  app.put("/api/trading/signals/config", async (req, res) => {
    try {
      const body = req.body;
      
      // Validate the configuration
      const parsedConfig = SIGNAL_CONFIG_SCHEMA.partial().safeParse(body);
      if (!parsedConfig.success) {
        return res.status(400).json({ 
          error: "Invalid configuration", 
          details: parsedConfig.error.flatten() 
        });
      }

      // Get current config
      const currentConfig = await storage.getSignalConfig() || DEFAULT_SIGNAL_CONFIG;
      
      // Merge with current configuration
      const updatedConfig = {
        ...currentConfig,
        ...parsedConfig.data,
      };

      // Validate the complete configuration
      const validatedConfig = SIGNAL_CONFIG_SCHEMA.parse(updatedConfig);
      
      // Save to storage
      await storage.setSignalConfig(validatedConfig);
      
      // Log the change
      const envInfo = environment.getInfo();
      await botLogger.info("SIGNAL_CONFIG_UPDATED", "Configuración de señales actualizada", {
        changes: Object.keys(parsedConfig.data),
        config: validatedConfig,
        env: envInfo.env,
        instanceId: envInfo.instanceId,
      });

      res.json(validatedConfig);
    } catch (error) {
      console.error("[signals/config] Error updating config:", error);
      res.status(500).json({ error: "Failed to update signal configuration" });
    }
  });

  // POST simulate signal configuration
  app.post("/api/trading/signals/simulate", async (req, res) => {
    try {
      const body = req.body;
      
      // Validate the simulation configuration
      const parsedConfig = SIMULATION_SCHEMA.safeParse(body);
      if (!parsedConfig.success) {
        return res.status(400).json({ 
          error: "Invalid simulation configuration", 
          details: parsedConfig.error.flatten() 
        });
      }

      // Get recent trades for simulation
      const recentTrades = await storage.getTrades(100);
      const recentScans = await storage.getRecentScans(200); // Assuming this method exists
      
      // Simulate with the new thresholds
      const simulationResult = await simulateSignalThresholds(
        parsedConfig.data,
        recentTrades,
        recentScans
      );

      res.json(simulationResult);
    } catch (error) {
      console.error("[signals/simulate] Error:", error);
      res.status(500).json({ error: "Failed to simulate signal configuration" });
    }
  });

  // GET optimization suggestions
  app.get("/api/trading/signals/optimize", async (req, res) => {
    try {
      const { pair } = req.query;
      
      // Get historical data for optimization
      const historicalTrades = await storage.getTrades(500);
      const historicalScans = await storage.getRecentScans(1000);
      
      // Generate optimization suggestions
      const suggestions = await generateOptimizationSuggestions(
        historicalTrades,
        historicalScans,
        pair as string
      );

      res.json(suggestions);
    } catch (error) {
      console.error("[signals/optimize] Error:", error);
      res.status(500).json({ error: "Failed to generate optimization suggestions" });
    }
  });

  // GET performance metrics for current configuration
  app.get("/api/trading/signals/performance", async (req, res) => {
    try {
      const config = await storage.getSignalConfig() || DEFAULT_SIGNAL_CONFIG;
      const { timeframe = "24h" } = req.query;
      
      // Get performance data
      const trades = await storage.getTradesByTimeframe(timeframe as string);
      const scans = await storage.getRecentScansByTimeframe(timeframe as string);
      
      // Calculate performance metrics
      const performance = await calculatePerformanceMetrics(config, trades, scans);

      res.json(performance);
    } catch (error) {
      console.error("[signals/performance] Error:", error);
      res.status(500).json({ error: "Failed to get performance metrics" });
    }
  });
}

// Helper functions

async function simulateSignalThresholds(
  config: SignalConfig,
  trades: any[],
  scans: any[]
): Promise<SimulationResult> {
  // This is a simplified simulation - in a real implementation,
  // you would run the actual trading engine logic with the new thresholds
  
  let tradesExecuted = 0;
  let falsePositives = 0;
  let profitability = 0;

  // Simulate based on historical scans
  for (const scan of scans) {
    if (!scan.signalsCount || !scan.regime || !scan.rawSignal) continue;

    const regimeConfig = config[scan.regime.toLowerCase() as keyof SignalConfig];
    if (!regimeConfig) continue;

    // Check if signal would have triggered with new thresholds
    const wouldTrigger = scan.signalsCount >= regimeConfig.current;
    
    if (wouldTrigger && scan.rawSignal !== "NONE") {
      tradesExecuted++;
      
      // Check if it would have been profitable (simplified)
      const correspondingTrade = trades.find(t => 
        t.pair === scan.pair && 
        new Date(t.createdAt).getTime() > new Date(scan.scanTime).getTime()
      );
      
      if (correspondingTrade) {
        const pnl = parseFloat(correspondingTrade.pnlUsd || "0");
        profitability += pnl;
        
        if (pnl < 0) {
          falsePositives++;
        }
      }
    }
  }

  // Calculate impact metrics
  const currentTrades = trades.length;
  const tradeIncrease = currentTrades > 0 ? ((tradesExecuted - currentTrades) / currentTrades) * 100 : 0;
  const riskIncrease = tradesExecuted > 0 ? (falsePositives / tradesExecuted) * 100 : 0;
  const avgProfitability = tradesExecuted > 0 ? profitability / tradesExecuted : 0;

  return {
    tradesExecuted,
    falsePositives,
    profitability: avgProfitability,
    impact: {
      trades: `${tradeIncrease > 0 ? '+' : ''}${tradeIncrease.toFixed(1)}%`,
      risk: `${riskIncrease.toFixed(1)}%`,
      confidence: `${Math.max(50, 100 - riskIncrease).toFixed(0)}%`,
    },
  };
}

async function generateOptimizationSuggestions(
  trades: any[],
  scans: any[],
  pair?: string
): Promise<OptimizationSuggestion[]> {
  const suggestions: OptimizationSuggestion[] = [];
  
  // Analyze performance by regime
  const regimes = ["TREND", "RANGE", "TRANSITION"];
  
  for (const regime of regimes) {
    const regimeScans = scans.filter(s => s.regime === regime);
    const regimeTrades = trades.filter(t => {
      const correspondingScan = scans.find(s => 
        s.pair === t.pair && 
        new Date(t.createdAt).getTime() > new Date(s.scanTime).getTime()
      );
      return correspondingScan?.regime === regime;
    });

    // Calculate optimal threshold (simplified)
    const signalCounts = regimeScans.map(s => s.signalsCount || 0).filter(n => n > 0);
    const avgSignals = signalCounts.length > 0 ? signalCounts.reduce((a, b) => a + b, 0) / signalCounts.length : 0;
    
    // Calculate success rate by signal count
    const successBySignals: Record<number, { success: number; total: number }> = {};
    
    for (const scan of regimeScans) {
      const signalCount = scan.signalsCount || 0;
      if (!successBySignals[signalCount]) {
        successBySignals[signalCount] = { success: 0, total: 0 };
      }
      
      successBySignals[signalCount].total++;
      
      // Check if corresponding trade was profitable
      const correspondingTrade = regimeTrades.find(t => 
        t.pair === scan.pair && 
        Math.abs(new Date(t.createdAt).getTime() - new Date(scan.scanTime).getTime()) < 300000 // 5 minutes
      );
      
      if (correspondingTrade && parseFloat(correspondingTrade.pnlUsd || "0") > 0) {
        successBySignals[signalCount].success++;
      }
    }

    // Find optimal threshold (highest success rate with sufficient samples)
    let optimalThreshold = Math.round(avgSignals);
    let bestSuccessRate = 0;
    
    for (const [signalCount, stats] of Object.entries(successBySignals)) {
      if (stats.total >= 5) { // Minimum sample size
        const successRate = stats.success / stats.total;
        if (successRate > bestSuccessRate) {
          bestSuccessRate = successRate;
          optimalThreshold = parseInt(signalCount);
        }
      }
    }

    // Generate suggestion
    const confidence = Math.round(bestSuccessRate * 100);
    const expectedImpact = confidence > 70 ? "Alta probabilidad de mejora" : 
                          confidence > 50 ? "Mejora moderada esperada" : 
                          "Riesgo elevado, proceder con caution";

    suggestions.push({
      regime,
      recommended: optimalThreshold,
      reason: `Basado en ${regimeScans.length} scans históricos. Tasa de éxito: ${bestSuccessRate.toFixed(2)}%`,
      confidence,
      expectedImpact,
    });
  }

  return suggestions;
}

async function calculatePerformanceMetrics(
  config: SignalConfig,
  trades: any[],
  scans: any[]
): Promise<any> {
  // Calculate performance metrics for current configuration
  const totalScans = scans.length;
  const signalScans = scans.filter(s => s.signalsCount > 0);
  const tradeScans = scans.filter(s => s.rawSignal !== "NONE");
  
  const totalTrades = trades.length;
  const profitableTrades = trades.filter(t => parseFloat(t.pnlUsd || "0") > 0).length;
  const losingTrades = trades.filter(t => parseFloat(t.pnlUsd || "0") < 0).length;
  
  const winRate = totalTrades > 0 ? (profitableTrades / totalTrades) * 100 : 0;
  const totalPnl = trades.reduce((sum, t) => sum + parseFloat(t.pnlUsd || "0"), 0);
  const avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;

  // Calculate signal efficiency by regime
  const regimePerformance: Record<string, any> = {};
  
  for (const regime of ["TREND", "RANGE", "TRANSITION"]) {
    const regimeScans = scans.filter(s => s.regime === regime);
    const regimeConfig = config[regime.toLowerCase() as keyof SignalConfig];
    
    const qualifiedScans = regimeScans.filter(s => s.signalsCount >= regimeConfig.current);
    const actualTrades = qualifiedScans.filter(s => s.rawSignal !== "NONE").length;
    
    const regimeTrades = trades.filter(t => {
      const correspondingScan = scans.find(s => 
        s.pair === t.pair && 
        new Date(t.createdAt).getTime() > new Date(s.scanTime).getTime()
      );
      return correspondingScan?.regime === regime;
    });

    regimePerformance[regime] = {
      totalScans: regimeScans.length,
      qualifiedScans: qualifiedScans.length,
      actualTrades: actualTrades,
      executedTrades: regimeTrades.length,
      efficiency: qualifiedScans.length > 0 ? (actualTrades / qualifiedScans.length) * 100 : 0,
      avgPnl: regimeTrades.length > 0 ? 
        regimeTrades.reduce((sum, t) => sum + parseFloat(t.pnlUsd || "0"), 0) / regimeTrades.length : 0,
    };
  }

  return {
    timeframe: "24h",
    totalScans,
    signalScans: signalScans.length,
    tradeScans: tradeScans.length,
    totalTrades,
    profitableTrades,
    losingTrades,
    winRate: winRate.toFixed(2),
    totalPnl: totalPnl.toFixed(2),
    avgPnl: avgPnl.toFixed(2),
    regimePerformance,
    config,
  };
}
