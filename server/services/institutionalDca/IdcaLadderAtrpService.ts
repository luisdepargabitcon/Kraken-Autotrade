/**
 * IdcaLadderAtrpService — Servicio de ladder inteligente basado en ATRP
 * 
 * Calcula niveles de entrada dinámicos basados en:
 * - ATRP (Average True Range Percentage)
 * - Perfiles predefinidos (aggressive/balanced/conservative)
 * - Slider de intensidad (0-100)
 * - Ajuste adaptativo por volatilidad
 * - Rebalance por zonas VWAP
 */
import { LadderAtrpConfig, LadderProfile, LadderLevel, LadderResult, TrailingBuyLevel1Config, TrailingBuyState } from "./IdcaTypes";
import { idcaMarketContextService, MarketContext } from "./IdcaMarketContextService";

// Perfiles predefinidos
const LADDER_PROFILES: Record<LadderProfile, Omit<LadderAtrpConfig, 'enabled' | 'sliderIntensity' | 'effectiveMultipliers'>> = {
  aggressive: {
    profile: "aggressive",
    baseMultiplier: 0.8,
    stepMultiplier: 0.3,
    maxMultiplier: 3.0,
    sizeDistribution: [30, 25, 20, 15, 10],
    minDipPct: 0.5,
    maxDipPct: 15,
    maxLevels: 5,
    depthMode: "normal",
    targetCoveragePct: 6,
    minStepPct: 0.5,
    allowDeepExtension: true,
    adaptiveScaling: true,
    volatilityScaling: 1.0,
    rebalanceOnVwap: true,
  },
  balanced: {
    profile: "balanced",
    baseMultiplier: 1.0,
    stepMultiplier: 0.4,
    maxMultiplier: 4.0,
    sizeDistribution: [25, 25, 20, 15, 15],
    minDipPct: 0.8,
    maxDipPct: 20,
    maxLevels: 5,
    depthMode: "normal",
    targetCoveragePct: 8,
    minStepPct: 0.5,
    allowDeepExtension: true,
    adaptiveScaling: true,
    volatilityScaling: 1.0,
    rebalanceOnVwap: true,
  },
  conservative: {
    profile: "conservative",
    baseMultiplier: 1.2,
    stepMultiplier: 0.5,
    maxMultiplier: 5.0,
    sizeDistribution: [20, 20, 20, 20, 20],
    minDipPct: 1.0,
    maxDipPct: 25,
    maxLevels: 5,
    depthMode: "normal",
    targetCoveragePct: 10,
    minStepPct: 0.5,
    allowDeepExtension: true,
    adaptiveScaling: true,
    volatilityScaling: 1.0,
    rebalanceOnVwap: true,
  },
  custom: {
    profile: "custom",
    baseMultiplier: 1.0,
    stepMultiplier: 0.4,
    maxMultiplier: 4.0,
    sizeDistribution: [25, 25, 20, 15, 15],
    minDipPct: 0.8,
    maxDipPct: 20,
    maxLevels: 5,
    depthMode: "normal",
    targetCoveragePct: 8,
    minStepPct: 0.5,
    allowDeepExtension: true,
    adaptiveScaling: true,
    volatilityScaling: 1.0,
    rebalanceOnVwap: true,
  },
};

class IdcaLadderAtrpService {
  private trailingBuyStates = new Map<string, TrailingBuyState>();

  /**
   * Crea configuración de ladder basada en perfil e intensidad
   */
  createLadderConfig(profile: LadderProfile, sliderIntensity: number): LadderAtrpConfig {
    const baseProfile = LADDER_PROFILES[profile];
    
    // Ajustar multiplicadores según intensidad (0-100)
    const intensityFactor = 0.5 + (sliderIntensity / 100) * 1.5; // 0.5 a 2.0
    const adjustedBase = baseProfile.baseMultiplier / intensityFactor;
    const adjustedStep = baseProfile.stepMultiplier / intensityFactor;
    const adjustedMax = baseProfile.maxMultiplier / intensityFactor;

    // Calcular effective multipliers
    const effectiveMultipliers: number[] = [];
    for (let i = 0; i < baseProfile.maxLevels; i++) {
      const multiplier = Math.min(
        adjustedBase + (i * adjustedStep),
        adjustedMax
      );
      effectiveMultipliers.push(multiplier);
    }

    return {
      ...baseProfile,
      enabled: true,
      sliderIntensity,
      baseMultiplier: adjustedBase,
      stepMultiplier: adjustedStep,
      maxMultiplier: adjustedMax,
      effectiveMultipliers,
    };
  }

  /**
   * Calcula ladder completo basado en contexto de mercado
   */
  async calculateLadder(
    pair: string,
    config: LadderAtrpConfig,
    marketContext?: MarketContext,
    frozenAnchorPrice?: number
  ): Promise<LadderResult> {
    // Obtener contexto si no se proporciona, pasando frozenAnchorPrice si está disponible
    const context = marketContext || await idcaMarketContextService.getMarketContext(pair, { frozenAnchorPrice });
    
    if (!config.enabled) {
      throw new Error(`Ladder ATRP not enabled for ${pair}`);
    }

    if (!context.atrPct) {
      throw new Error(`ATRP not available for ${pair}`);
    }

    const levels: LadderLevel[] = [];
    let currentPrice = context.currentPrice;
    let totalSizePct = 0;

    // Calcular ajuste adaptativo
    let adaptiveFactor = 1.0;
    if (config.adaptiveScaling && context.atrPct) {
      adaptiveFactor = 1.0 + (config.volatilityScaling * (context.atrPct - 2.0) / 10.0);
      adaptiveFactor = Math.max(0.5, Math.min(2.0, adaptiveFactor)); // Clamp 0.5-2.0
    }

    // Ajuste por VWAP zone
    let vwapFactor = 1.0;
    if (config.rebalanceOnVwap && context.vwapZone) {
      switch (context.vwapZone) {
        case "below_lower3":
          vwapFactor = 0.8;  // Zona de valor profundo (más agresivo)
          break;
        case "below_lower2":
        case "below_lower1":
          vwapFactor = 0.9;  // Zona de valor
          break;
        case "between_bands":
          vwapFactor = 1.0;  // Zona neutral
          break;
        case "above_upper1":
        case "above_upper2":
          vwapFactor = 1.2;  // Zona sobreextendida (más conservador)
          break;
      }
    }

    // Generar niveles
    for (let i = 0; i < config.maxLevels; i++) {
      // Usar manualMultipliers si manualLevelEnabled=true, sino effectiveMultipliers
      const atrpMultiplier = config.manualLevelEnabled && config.manualMultipliers && config.manualMultipliers[i]
        ? config.manualMultipliers[i]
        : config.effectiveMultipliers[i];
      
      // Usar manualSizeDistribution si manualLevelEnabled=true, sino sizeDistribution
      const sizePct = config.manualLevelEnabled && config.manualSizeDistribution && config.manualSizeDistribution[i]
        ? config.manualSizeDistribution[i]
        : config.sizeDistribution[i] || 0;
      
      const rawDipPct = atrpMultiplier * context.atrPct * adaptiveFactor * vwapFactor;

      // Aplicar clamps pero asegurar que cada nivel sea mayor que el anterior
      const minDipForLevel = i === 0 ? config.minDipPct : (levels[i - 1].dipPct + config.minStepPct); // Usar minStepPct configurable
      const dipPct = Math.max(
        minDipForLevel,
        Math.min(config.maxDipPct, rawDipPct)
      );

      const triggerPrice = context.anchorPrice * (1 - dipPct / 100);

      totalSizePct += sizePct;

      levels.push({
        level: i,
        dipPct,
        triggerPrice,
        sizePct,
        atrpMultiplier,
        isActive: currentPrice <= triggerPrice,
      });

      // Si el precio actual no ha alcanzado este nivel, los siguientes tampoco estarán activos
      if (currentPrice > triggerPrice) {
        break;
      }
    }

    // Extender niveles si targetCoveragePct no se alcanza y allowDeepExtension es true
    let isLimitedByMaxLevels = false;
    if (config.allowDeepExtension && config.depthMode !== "normal") {
      const maxDrawdownCovered = levels.length > 0 ? levels[levels.length - 1].dipPct : 0;
      const targetCoverage = config.targetCoveragePct;
      
      while (maxDrawdownCovered < targetCoverage && levels.length < config.maxLevels * 2) {
        const i = levels.length;
        const lastLevel = levels[levels.length - 1];
        
        // Calcular siguiente nivel extendido
        const atrpMultiplier = config.maxMultiplier; // Usar máximo para profundidad
        const rawDipPct = atrpMultiplier * context.atrPct * adaptiveFactor * vwapFactor;
        
        const minDipForLevel = lastLevel.dipPct + config.minStepPct;
        const dipPct = Math.max(
          minDipForLevel,
          Math.min(config.maxDipPct, rawDipPct)
        );

        if (dipPct <= lastLevel.dipPct) break; // No más progreso

        const triggerPrice = context.anchorPrice * (1 - dipPct / 100);
        const sizePct = config.sizeDistribution[config.sizeDistribution.length - 1] || 5; // Usar último tamaño o 5% default

        levels.push({
          level: i,
          dipPct,
          triggerPrice,
          sizePct,
          atrpMultiplier,
          isActive: currentPrice <= triggerPrice,
        });

        totalSizePct += sizePct;
        
        // Actualizar maxDrawdownCovered
        const newMaxDrawdownCovered = levels[levels.length - 1].dipPct;
        if (newMaxDrawdownCovered >= targetCoverage) {
          break;
        }
      }
      
      // Verificar si se limitó por maxLevels
      if (levels.length >= config.maxLevels * 2 && levels[levels.length - 1].dipPct < targetCoverage) {
        isLimitedByMaxLevels = true;
      }
    }

    return {
      levels,
      totalLevels: levels.length,
      maxDrawdownCovered: levels.length > 0 ? levels[levels.length - 1].dipPct : 0,
      totalSizePct,
      isLimitedByMaxLevels,
      calculatedAt: new Date(),
      config,
      marketContext: {
        anchorPrice: context.anchorPrice,
        currentPrice: context.currentPrice,
        atrPct: context.atrPct,
        vwapZone: context.vwapZone,
      },
    };
  }

  /**
   * Verifica si se debe activar trailing buy nivel 1
   */
  checkTrailingBuyTrigger(
    pair: string,
    config: TrailingBuyLevel1Config,
    ladder: LadderResult,
    currentPrice: number
  ): TrailingBuyState | null {
    if (!config.enabled) {
      return null;
    }

    const state = this.trailingBuyStates.get(pair) || {
      isArmed: false,
      triggerLevel: config.triggerLevel,
    };

    // Encontrar nivel que debe activar trailing
    const triggerLevel = ladder.levels.find(l => l.level === config.triggerLevel);
    if (!triggerLevel) {
      return null;
    }

    // Verificar si hemos alcanzado el nivel de trigger
    const priceReachedTrigger = currentPrice <= triggerLevel.triggerPrice;
    
    if (!state.isArmed && priceReachedTrigger) {
      // Activar trailing
      const newState: TrailingBuyState = {
        isArmed: true,
        triggeredAt: new Date(),
        localLow: currentPrice,
        targetPrice: this.calculateTrailingTarget(config, currentPrice, ladder),
        triggerLevel: config.triggerLevel,
        expiresAt: new Date(Date.now() + config.maxWaitMinutes * 60 * 1000),
      };

      this.trailingBuyStates.set(pair, newState);
      return newState;
    }

    if (state.isArmed) {
      // Actualizar local low si es menor
      if (currentPrice < (state.localLow || Infinity)) {
        state.localLow = currentPrice;
        state.targetPrice = this.calculateTrailingTarget(config, currentPrice, ladder);
      }

      // Verificar expiración
      if (state.expiresAt && Date.now() > state.expiresAt.getTime()) {
        this.trailingBuyStates.delete(pair);
        return null;
      }

      // Verificar cancelación por recuperación
      if (config.cancelOnRecovery && currentPrice > triggerLevel.triggerPrice * 1.02) {
        this.trailingBuyStates.delete(pair);
        return null;
      }

      return state;
    }

    return null;
  }

  /**
   * Calcula precio objetivo para trailing buy
   */
  private calculateTrailingTarget(
    config: TrailingBuyLevel1Config,
    currentPrice: number,
    ladder: LadderResult
  ): number {
    switch (config.trailingMode) {
      case "rebound_pct":
        return currentPrice * (1 + config.trailingValue / 100);
      
      case "atrp_fraction":
        if (!ladder.marketContext.atrPct) return currentPrice;
        return currentPrice * (1 + (config.trailingValue * ladder.marketContext.atrPct / 100));
      
      default:
        return currentPrice;
    }
  }

  /**
   * Verifica si se debe ejecutar compra por trailing buy
   */
  shouldExecuteTrailingBuy(pair: string, currentPrice: number): boolean {
    const state = this.trailingBuyStates.get(pair);
    if (!state || !state.isArmed || !state.targetPrice) {
      return false;
    }

    return currentPrice >= state.targetPrice;
  }

  /**
   * Limpia estado de trailing buy para un par
   */
  clearTrailingBuyState(pair: string): void {
    this.trailingBuyStates.delete(pair);
  }

  /**
   * Obtiene estado actual de trailing buy
   */
  getTrailingBuyState(pair: string): TrailingBuyState | undefined {
    return this.trailingBuyStates.get(pair);
  }

  /**
   * Preview para UI - devuelve ladder simplificado
   */
  async getLadderPreview(
    pair: string,
    profile: LadderProfile,
    sliderIntensity: number,
    depthMode?: "normal" | "deep" | "manual",
    targetCoveragePct?: number,
    frozenAnchorPrice?: number
  ): Promise<{
    levels: Array<{
      level: number;
      dipPct: number;
      triggerPrice: number;
      sizePct: number;
    }>;
    totalLevels: number;
    maxDrawdown: number;
    totalSize: number;
    isLimitedByMaxLevels?: boolean;
    marketContext: {
      anchorPrice: number;
      currentPrice: number;
      atrPct?: number;
      vwapZone?: string;
    };
    profile: LadderProfile;
    sliderIntensity: number;
  }> {
    const config = this.createLadderConfig(profile, sliderIntensity);
    
    // Aplicar configuración de profundidad si se proporciona
    if (depthMode) config.depthMode = depthMode;
    if (targetCoveragePct !== undefined) config.targetCoveragePct = targetCoveragePct;
    
    const result = await this.calculateLadder(pair, config, undefined, frozenAnchorPrice);
    
    return {
      levels: result.levels.map(l => ({
        level: l.level,
        dipPct: l.dipPct,
        triggerPrice: l.triggerPrice,
        sizePct: l.sizePct,
        atrpMultiplier: l.atrpMultiplier,
        isActive: l.isActive,
      })),
      totalLevels: result.totalLevels,
      maxDrawdown: result.maxDrawdownCovered,
      totalSize: result.totalSizePct,
      isLimitedByMaxLevels: result.isLimitedByMaxLevels,
      marketContext: result.marketContext,
      profile: config.profile,
      sliderIntensity: config.sliderIntensity,
    };
  }
}

export const idcaLadderAtrpService = new IdcaLadderAtrpService();
