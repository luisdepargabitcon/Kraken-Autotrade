/**
 * IdcaExitManager — Servicio unificado de gestión de salidas
 * 
 * Consolida todas las estrategias de salida en un solo lugar:
 * - Fail-safe (protección contra pérdidas extremas)
 * - Break-even (proteger capital invertido)
 * - Trailing (seguir ganancias)
 * - OCO lógico (One-Cancels-Other)
 * - TP dinámico (take profit adaptativo)
 */
import { InstitutionalDcaCycle, InstitutionalDcaAssetConfigRow } from "@shared/schema";
import { idcaMarketContextService, MarketContext } from "./IdcaMarketContextService";

export interface ExitConfig {
  // Fail-safe
  failSafeEnabled: boolean;
  failSafeMaxLossPct: number;     // Máxima pérdida tolerada (ej: 15%)
  failSafeTriggerPct: number;     // Trigger para activar (ej: 12%)
  
  // Break-even
  breakEvenEnabled: boolean;
  breakEvenActivationPct: number; // Activar BE con X% de ganancia
  breakEvenBufferPct: number;     // Buffer sobre precio de entrada (ej: 0.5%)
  
  // Trailing
  trailingEnabled: boolean;
  trailingActivationPct: number;  // Activar trailing con X% de ganancia
  trailingMarginPct: number;      // Margen de trailing (ej: 1.5%)
  
  // Take Profit
  takeProfitEnabled: boolean;
  takeProfitPct: number;          // TP base
  dynamicTpEnabled: boolean;      // TP dinámico según mercado
  
  // OCO lógico
  ocoEnabled: boolean;            // One-Cancels-Other lógico
  tpRefMode: "aggressive" | "conservative" | "disabled"; // TP reference mode
}

export interface ExitState {
  cycleId: number;
  pair: string;
  mode: string;
  
  // Estado actual
  currentPrice: number;
  avgEntryPrice: number;
  unrealizedPnlPct: number;
  totalQuantity: number;
  
  // Estados de protección
  failSafeArmed: boolean;
  failSafeTriggerPrice?: number;
  breakEvenArmed: boolean;
  breakEvenPrice?: number;
  trailingArmed: boolean;
  trailingLocalHigh?: number;
  trailingStopPrice?: number;
  tpArmed: boolean;
  tpTargetPrice?: number;
  
  // Timestamps
  failSafeArmedAt?: Date;
  breakEvenArmedAt?: Date;
  trailingArmedAt?: Date;
  tpArmedAt?: Date;
  
  // Última actualización
  lastUpdated: Date;
}

export interface ExitSignal {
  shouldExit: boolean;
  exitType: "fail_safe" | "break_even" | "trailing" | "take_profit" | "manual";
  exitPrice: number;
  exitReason: string;
  urgency: "low" | "medium" | "high" | "critical";
  metadata: {
    currentState: ExitState;
    triggeredBy: string;
    marketContext?: MarketContext;
  };
}

class IdcaExitManager {
  private exitStates = new Map<number, ExitState>();

  /**
   * Crea configuración de salida desde asset config
   */
  createExitConfig(assetConfig: InstitutionalDcaAssetConfigRow): ExitConfig {
    return {
      failSafeEnabled: true, // Siempre activado por seguridad
      failSafeMaxLossPct: 15.0,
      failSafeTriggerPct: 12.0,
      
      breakEvenEnabled: assetConfig.breakevenEnabled ?? true,
      breakEvenActivationPct: parseFloat(String(assetConfig.protectionActivationPct || "1.0")),
      breakEvenBufferPct: 0.5,
      
      trailingEnabled: true,
      trailingActivationPct: parseFloat(String(assetConfig.trailingActivationPct || "3.5")),
      trailingMarginPct: parseFloat(String(assetConfig.trailingMarginPct || "1.5")),
      
      takeProfitEnabled: true,
      takeProfitPct: parseFloat(String(assetConfig.takeProfitPct || "4.0")),
      dynamicTpEnabled: assetConfig.dynamicTakeProfit ?? true,
      
      ocoEnabled: true,
      tpRefMode: "conservative", // Por defecto conservador
    };
  }

  /**
   * Inicializa estado de salida para un ciclo
   */
  async initializeExitState(
    cycle: InstitutionalDcaCycle,
    assetConfig: InstitutionalDcaAssetConfigRow
  ): Promise<ExitState> {
    const config = this.createExitConfig(assetConfig);
    const context = await idcaMarketContextService.getMarketContext(cycle.pair);
    
    const state: ExitState = {
      cycleId: cycle.id,
      pair: cycle.pair,
      mode: cycle.mode,
      
      currentPrice: parseFloat(String(cycle.currentPrice)),
      avgEntryPrice: parseFloat(String(cycle.avgEntryPrice)),
      unrealizedPnlPct: parseFloat(String(cycle.unrealizedPnlPct || "0")),
      totalQuantity: parseFloat(String(cycle.totalQuantity)),
      
      failSafeArmed: false,
      breakEvenArmed: false,
      trailingArmed: false,
      tpArmed: false,
      
      lastUpdated: new Date(),
    };
    
    // Calcular precios de trigger iniciales
    state.failSafeTriggerPrice = state.avgEntryPrice * (1 - config.failSafeTriggerPct / 100);
    state.breakEvenPrice = state.avgEntryPrice * (1 + config.breakEvenBufferPct / 100);
    
    // TP dinámico según contexto
    if (config.dynamicTpEnabled && context.atrPct) {
      const atrpMultiplier = this.getDynamicTpMultiplier(context);
      state.tpTargetPrice = state.avgEntryPrice * (1 + (config.takeProfitPct * atrpMultiplier) / 100);
    } else {
      state.tpTargetPrice = state.avgEntryPrice * (1 + config.takeProfitPct / 100);
    }
    
    this.exitStates.set(cycle.id, state);
    return state;
  }

  /**
   * Evalúa señales de salida para un ciclo
   */
  async evaluateExitSignals(
    cycle: InstitutionalDcaCycle,
    assetConfig: InstitutionalDcaAssetConfigRow,
    currentPrice: number
  ): Promise<ExitSignal[]> {
    const config = this.createExitConfig(assetConfig);
    let state = this.exitStates.get(cycle.id);
    
    if (!state) {
      state = await this.initializeExitState(cycle, assetConfig);
    }
    
    // Actualizar estado
    state.currentPrice = currentPrice;
    state.unrealizedPnlPct = ((currentPrice - state.avgEntryPrice) / state.avgEntryPrice) * 100;
    state.lastUpdated = new Date();
    
    const signals: ExitSignal[] = [];
    const context = await idcaMarketContextService.getMarketContext(cycle.pair);
    
    // 1. Evaluar Fail-Safe (prioridad máxima)
    if (config.failSafeEnabled) {
      const failSafeSignal = this.evaluateFailSafe(state, config, context);
      if (failSafeSignal) signals.push(failSafeSignal);
    }
    
    // 2. Evaluar Take Profit (prioridad alta si está armado)
    if (config.takeProfitEnabled && state.tpArmed) {
      const tpSignal = this.evaluateTakeProfit(state, config, context);
      if (tpSignal) signals.push(tpSignal);
    }
    
    // 3. Evaluar Trailing (si está armado)
    if (config.trailingEnabled && state.trailingArmed) {
      const trailingSignal = this.evaluateTrailing(state, config, context);
      if (trailingSignal) signals.push(trailingSignal);
    }
    
    // 4. Evaluar Break-Even
    if (config.breakEvenEnabled) {
      const beSignal = this.evaluateBreakEven(state, config, context);
      if (beSignal) signals.push(beSignal);
    }
    
    // 5. Evaluar activación de TP
    if (!state.tpArmed && config.takeProfitEnabled) {
      this.checkTpActivation(state, config, context);
    }
    
    // 6. Evaluar activación de Trailing
    if (!state.trailingArmed && config.trailingEnabled) {
      this.checkTrailingActivation(state, config, context);
    }
    
    // Aplicar OCO lógico
    return this.applyOcoLogic(signals, state, config);
  }

  /**
   * Evalúa señal de fail-safe
   */
  private evaluateFailSafe(
    state: ExitState,
    config: ExitConfig,
    context: MarketContext
  ): ExitSignal | null {
    const maxLossPrice = state.avgEntryPrice * (1 - config.failSafeMaxLossPct / 100);
    
    if (state.currentPrice <= maxLossPrice) {
      return {
        shouldExit: true,
        exitType: "fail_safe",
        exitPrice: state.currentPrice,
        exitReason: `Fail-safe triggered: loss exceeded ${config.failSafeMaxLossPct}%`,
        urgency: "critical",
        metadata: {
          currentState: state,
          triggeredBy: "max_loss_threshold",
          marketContext: context,
        },
      };
    }
    
    // Armado de fail-safe
    if (!state.failSafeArmed && state.currentPrice <= state.failSafeTriggerPrice!) {
      state.failSafeArmed = true;
      state.failSafeArmedAt = new Date();
    }
    
    return null;
  }

  /**
   * Evalúa señal de take profit
   */
  private evaluateTakeProfit(
    state: ExitState,
    config: ExitConfig,
    context: MarketContext
  ): ExitSignal | null {
    if (!state.tpTargetPrice) return null;
    
    if (state.currentPrice >= state.tpTargetPrice) {
      return {
        shouldExit: true,
        exitType: "take_profit",
        exitPrice: state.currentPrice,
        exitReason: `Take profit reached: ${state.unrealizedPnlPct.toFixed(2)}%`,
        urgency: "medium",
        metadata: {
          currentState: state,
          triggeredBy: "tp_target_reached",
          marketContext: context,
        },
      };
    }
    
    return null;
  }

  /**
   * Evalúa señal de trailing
   */
  private evaluateTrailing(
    state: ExitState,
    config: ExitConfig,
    context: MarketContext
  ): ExitSignal | null {
    if (!state.trailingLocalHigh || !state.trailingStopPrice) return null;
    
    // Actualizar local high si el precio sube
    if (state.currentPrice > state.trailingLocalHigh) {
      state.trailingLocalHigh = state.currentPrice;
      state.trailingStopPrice = state.currentPrice * (1 - config.trailingMarginPct / 100);
    }
    
    // Verificar si se disparó trailing stop
    if (state.currentPrice <= state.trailingStopPrice) {
      return {
        shouldExit: true,
        exitType: "trailing",
        exitPrice: state.currentPrice,
        exitReason: `Trailing stop triggered: ${state.unrealizedPnlPct.toFixed(2)}% peak`,
        urgency: "high",
        metadata: {
          currentState: state,
          triggeredBy: "trailing_stop_hit",
          marketContext: context,
        },
      };
    }
    
    return null;
  }

  /**
   * Evalúa señal de break-even
   */
  private evaluateBreakEven(
    state: ExitState,
    config: ExitConfig,
    context: MarketContext
  ): ExitSignal | null {
    if (!state.breakEvenArmed || !state.breakEvenPrice) return null;
    
    if (state.currentPrice <= state.breakEvenPrice) {
      return {
        shouldExit: true,
        exitType: "break_even",
        exitPrice: state.currentPrice,
        exitReason: `Break-even protection triggered`,
        urgency: "medium",
        metadata: {
          currentState: state,
          triggeredBy: "break_even_protection",
          marketContext: context,
        },
      };
    }
    
    return null;
  }

  /**
   * Verifica activación de TP
   */
  private checkTpActivation(state: ExitState, config: ExitConfig, context: MarketContext): void {
    if (state.unrealizedPnlPct >= 0) { // TP se activa en ganancia
      state.tpArmed = true;
      state.tpArmedAt = new Date();
    }
  }

  /**
   * Verifica activación de trailing
   */
  private checkTrailingActivation(state: ExitState, config: ExitConfig, context: MarketContext): void {
    if (state.unrealizedPnlPct >= config.trailingActivationPct) {
      state.trailingArmed = true;
      state.trailingArmedAt = new Date();
      state.trailingLocalHigh = state.currentPrice;
      state.trailingStopPrice = state.currentPrice * (1 - config.trailingMarginPct / 100);
    }
  }

  /**
   * Aplica lógica OCO (One-Cancels-Other)
   */
  private applyOcoLogic(
    signals: ExitSignal[],
    state: ExitState,
    config: ExitConfig
  ): ExitSignal[] {
    if (!config.ocoEnabled || signals.length <= 1) {
      return signals;
    }
    
    // Priorizar señales por urgencia
    const priorityOrder = {
      critical: 1,
      high: 2,
      medium: 3,
      low: 4,
    };
    
    signals.sort((a, b) => priorityOrder[a.urgency] - priorityOrder[b.urgency]);
    
    // Retornar solo la señal de mayor prioridad
    return [signals[0]];
  }

  /**
   * Calcula multiplicador dinámico para TP basado en contexto
   */
  private getDynamicTpMultiplier(context: MarketContext): number {
    let multiplier = 1.0;
    
    // Ajustar por volatilidad (ATRP)
    if (context.atrPct) {
      if (context.atrPct > 3.0) {
        multiplier *= 1.2; // Más volátil → TP más grande
      } else if (context.atrPct < 1.5) {
        multiplier *= 0.8; // Menos volátil → TP más pequeño
      }
    }
    
    // Ajustar por zona VWAP
    if (context.vwapZone) {
      switch (context.vwapZone) {
        case "below_lower3":
        case "below_lower2":
          multiplier *= 1.3; // Compra en valor profundo → TP más ambicioso
          break;
        case "above_upper1":
        case "above_upper2":
          multiplier *= 0.7; // Compra sobreextendido → TP más conservador
          break;
      }
    }
    
    return Math.max(0.5, Math.min(2.0, multiplier));
  }

  /**
   * Obtiene estado actual de salida para un ciclo
   */
  getExitState(cycleId: number): ExitState | undefined {
    return this.exitStates.get(cycleId);
  }

  /**
   * Limpia estado de salida para un ciclo
   */
  clearExitState(cycleId: number): void {
    this.exitStates.delete(cycleId);
  }

  /**
   * Obtiene todos los estados de salida activos
   */
  getAllExitStates(): ExitState[] {
    return Array.from(this.exitStates.values());
  }

  /**
   * Genera diagnóstico de sistema de salidas
   */
  async generateExitDiagnostics(
    cycle: InstitutionalDcaCycle,
    assetConfig: InstitutionalDcaAssetConfigRow
  ): Promise<{
    config: ExitConfig;
    state: ExitState;
    signals: ExitSignal[];
    recommendations: string[];
  }> {
    const config = this.createExitConfig(assetConfig);
    const state = await this.initializeExitState(cycle, assetConfig);
    const signals = await this.evaluateExitSignals(cycle, assetConfig, state.currentPrice);
    
    const recommendations: string[] = [];
    
    if (!config.breakEvenEnabled) {
      recommendations.push("Consider enabling break-even protection");
    }
    
    if (config.failSafeMaxLossPct > 20) {
      recommendations.push("Fail-safe threshold is very high - consider reducing risk");
    }
    
    if (config.trailingMarginPct < 1.0) {
      recommendations.push("Trailing margin is tight - may trigger prematurely");
    }
    
    return {
      config,
      state,
      signals,
      recommendations,
    };
  }
}

// Singleton export
export const idcaExitManager = new IdcaExitManager();
