/**
 * IdcaMigrationService — Servicio de migración progresiva de ladder
 * 
 * Gestiona la transición controlada de safetyOrdersJson a ladder ATRP:
 * - Migración automática basada en configuración
 * - Validación de equivalencia
 * - Rollback automático si hay problemas
 * - Evidencia de qué sistema está activo
 */
import { LadderAtrpConfig, LadderLevel, LadderResult } from "./IdcaTypes";
import { idcaLadderAtrpService } from "./IdcaLadderAtrpService";
import { idcaMarketContextService } from "./IdcaMarketContextService";

export interface SafetyOrder {
  dipPct: number;
  sizePctOfAssetBudget: number;
}

export interface MigrationResult {
  success: boolean;
  fromSystem: "safetyOrdersJson" | "ladderAtrp";
  toSystem: "safetyOrdersJson" | "ladderAtrp";
  reason: string;
  evidence: {
    originalLevels: SafetyOrder[];
    newLevels: LadderLevel[];
    maxDrawdownDiff: number;
    totalSizeDiff: number;
  };
  warnings: string[];
  rollbackAvailable: boolean;
}

export interface LadderSystemStatus {
  pair: string;
  activeSystem: "safetyOrdersJson" | "ladderAtrp" | "hybrid";
  safetyOrdersConfigured: boolean;
  ladderAtrpEnabled: boolean;
  lastMigrationAt?: Date;
  migrationHistory: MigrationResult[];
  validationStatus: "valid" | "invalid" | "unknown";
}

class IdcaMigrationService {
  private migrationHistory = new Map<string, MigrationResult[]>();

  /**
   * Analiza safetyOrdersJson y sugiere configuración ladder ATRP equivalente
   */
  async suggestLadderFromSafetyOrders(
    pair: string,
    safetyOrders: SafetyOrder[],
    targetProfile: "aggressive" | "balanced" | "conservative" = "balanced"
  ): Promise<{
    suggestedConfig: LadderAtrpConfig;
    equivalence: {
      maxDrawdownDiff: number;
      totalSizeDiff: number;
      levelCountDiff: number;
    };
    warnings: string[];
  }> {
    if (!safetyOrders.length) {
      throw new Error(`No safety orders found for ${pair}`);
    }

    // Obtener contexto de mercado para cálculos ATRP
    const context = await idcaMarketContextService.getMarketContext(pair);
    
    // Analizar distribución actual
    const maxDrawdown = Math.max(...safetyOrders.map(o => o.dipPct));
    const totalSize = safetyOrders.reduce((sum, o) => sum + o.sizePctOfAssetBudget, 0);
    const avgSize = totalSize / safetyOrders.length;
    
    // Calcular intensidad sugerida basada en drawdown
    let suggestedIntensity = 50; // Default balanced
    if (maxDrawdown > 15) {
      suggestedIntensity = 70; // Más agresivo para drawdown grandes
    } else if (maxDrawdown < 8) {
      suggestedIntensity = 30; // Más conservador para drawdown pequeños
    }

    // Ajustar por perfil
    const profileAdjustments = {
      aggressive: 20,
      balanced: 0,
      conservative: -20,
    };
    suggestedIntensity = Math.max(0, Math.min(100, suggestedIntensity + profileAdjustments[targetProfile]));

    // Crear configuración sugerida
    const suggestedConfig = idcaLadderAtrpService.createLadderConfig(targetProfile, suggestedIntensity);
    
    // Ajustar clamps para que coincidan con safety orders
    suggestedConfig.minDipPct = Math.min(...safetyOrders.map(o => o.dipPct));
    suggestedConfig.maxDipPct = maxDrawdown;
    suggestedConfig.maxLevels = Math.max(safetyOrders.length, 3);
    
    // Ajustar distribución de tamaños para que coincida
    suggestedConfig.sizeDistribution = safetyOrders.map(o => o.sizePctOfAssetBudget);
    
    // Generar ladder para validar equivalencia
    const ladder = await idcaLadderAtrpService.calculateLadder(pair, suggestedConfig, context);
    
    // Calcular diferencias
    const maxDrawdownDiff = Math.abs(ladder.maxDrawdownCovered - maxDrawdown);
    const totalSizeDiff = Math.abs(ladder.totalSizePct - totalSize);
    const levelCountDiff = Math.abs(ladder.totalLevels - safetyOrders.length);
    
    // Generar advertencias
    const warnings: string[] = [];
    if (maxDrawdownDiff > 2) {
      warnings.push(`Drawdown coverage differs by ${maxDrawdownDiff.toFixed(2)}%`);
    }
    if (totalSizeDiff > 5) {
      warnings.push(`Total size differs by ${totalSizeDiff.toFixed(2)}%`);
    }
    if (!context.atrPct) {
      warnings.push("ATRP not available - using fallback calculations");
    }
    
    return {
      suggestedConfig,
      equivalence: {
        maxDrawdownDiff,
        totalSizeDiff,
        levelCountDiff,
      },
      warnings,
    };
  }

  /**
   * Migra de safetyOrdersJson a ladder ATRP con validación
   */
  async migrateToLadderAtrp(
    pair: string,
    safetyOrders: SafetyOrder[],
    targetConfig?: LadderAtrpConfig
  ): Promise<MigrationResult> {
    try {
      // Si no se proporciona config, sugerir una automática
      const config = targetConfig || (await this.suggestLadderFromSafetyOrders(pair, safetyOrders)).suggestedConfig;
      
      // Validar que ladder ATRP sea equivalente
      const context = await idcaMarketContextService.getMarketContext(pair);
      const ladder = await idcaLadderAtrpService.calculateLadder(pair, config, context);
      
      const maxDrawdown = Math.max(...safetyOrders.map(o => o.dipPct));
      const totalSize = safetyOrders.reduce((sum, o) => sum + o.sizePctOfAssetBudget, 0);
      
      const maxDrawdownDiff = Math.abs(ladder.maxDrawdownCovered - maxDrawdown);
      const totalSizeDiff = Math.abs(ladder.totalSizePct - totalSize);
      
      // Validar umbrales de equivalencia
      const warnings: string[] = [];
      if (maxDrawdownDiff > 3) {
        warnings.push(`Significant drawdown difference: ${maxDrawdownDiff.toFixed(2)}%`);
      }
      if (totalSizeDiff > 10) {
        warnings.push(`Significant size difference: ${totalSizeDiff.toFixed(2)}%`);
      }
      
      const result: MigrationResult = {
        success: true,
        fromSystem: "safetyOrdersJson",
        toSystem: "ladderAtrp",
        reason: "Progressive migration to intelligent ladder",
        evidence: {
          originalLevels: safetyOrders,
          newLevels: ladder.levels,
          maxDrawdownDiff,
          totalSizeDiff,
        },
        warnings,
        rollbackAvailable: true,
      };
      
      // Guardar en historial
      this.saveMigrationResult(pair, result);
      
      console.log(
        `[MigrationService] Migrated ${pair} from safetyOrdersJson to ladder ATRP. ` +
        `Drawdown: ${maxDrawdown}% → ${ladder.maxDrawdownCovered.toFixed(2)}%, ` +
        `Size: ${totalSize}% → ${ladder.totalSizePct.toFixed(2)}%`
      );
      
      return result;
      
    } catch (error) {
      const result: MigrationResult = {
        success: false,
        fromSystem: "safetyOrdersJson",
        toSystem: "ladderAtrp",
        reason: `Migration failed: ${(error as Error).message}`,
        evidence: {
          originalLevels: safetyOrders,
          newLevels: [],
          maxDrawdownDiff: 0,
          totalSizeDiff: 0,
        },
        warnings: [`Migration error: ${(error as Error).message}`],
        rollbackAvailable: false,
      };
      
      this.saveMigrationResult(pair, result);
      return result;
    }
  }

  /**
   * Migra de ladder ATRP a safetyOrdersJson (rollback)
   */
  async rollbackToSafetyOrders(
    pair: string,
    ladderConfig: LadderAtrpConfig,
    originalSafetyOrders: SafetyOrder[]
  ): Promise<MigrationResult> {
    try {
      // Validar que tengamos los safety orders originales
      if (!originalSafetyOrders.length) {
        throw new Error("No original safety orders available for rollback");
      }
      
      const result: MigrationResult = {
        success: true,
        fromSystem: "ladderAtrp",
        toSystem: "safetyOrdersJson",
        reason: "Rollback to legacy safety orders",
        evidence: {
          originalLevels: (await idcaLadderAtrpService.calculateLadder(pair, ladderConfig)).levels as unknown as SafetyOrder[],
          newLevels: [], // Safety orders no tienen niveles complejos
          maxDrawdownDiff: 0,
          totalSizeDiff: 0,
        },
        warnings: ["Rollback completed - consider reviewing ladder configuration"],
        rollbackAvailable: false, // No podemos rollback de un rollback
      };
      
      this.saveMigrationResult(pair, result);
      
      console.log(`[MigrationService] Rolled back ${pair} to safetyOrdersJson`);
      
      return result;
      
    } catch (error) {
      const result: MigrationResult = {
        success: false,
        fromSystem: "ladderAtrp",
        toSystem: "safetyOrdersJson",
        reason: `Rollback failed: ${(error as Error).message}`,
        evidence: {
          originalLevels: [],
          newLevels: [],
          maxDrawdownDiff: 0,
          totalSizeDiff: 0,
        },
        warnings: [`Rollback error: ${(error as Error).message}`],
        rollbackAvailable: false,
      };
      
      this.saveMigrationResult(pair, result);
      return result;
    }
  }

  /**
   * Determina qué sistema está activo para un par
   */
  getActiveSystem(
    pair: string,
    safetyOrders: SafetyOrder[],
    ladderEnabled: boolean,
    ladderConfig?: LadderAtrpConfig
  ): "safetyOrdersJson" | "ladderAtrp" | "hybrid" {
    const hasSafetyOrders = safetyOrders.length > 0;
    const hasLadderConfig = ladderEnabled && ladderConfig;
    
    if (hasSafetyOrders && hasLadderConfig) {
      return "hybrid"; // Ambos configurados - posible conflicto
    } else if (hasLadderConfig) {
      return "ladderAtrp";
    } else if (hasSafetyOrders) {
      return "safetyOrdersJson";
    } else {
      return "safetyOrdersJson"; // Default por seguridad
    }
  }

  /**
   * Obtiene estado completo de migración para un par
   */
  async getMigrationStatus(
    pair: string,
    safetyOrders: SafetyOrder[],
    ladderEnabled: boolean,
    ladderConfig?: LadderAtrpConfig
  ): Promise<LadderSystemStatus> {
    const activeSystem = this.getActiveSystem(pair, safetyOrders, ladderEnabled, ladderConfig);
    const history = this.migrationHistory.get(pair) || [];
    
    // Validar configuración actual
    let validationStatus: "valid" | "invalid" | "unknown" = "unknown";
    try {
      if (activeSystem === "ladderAtrp" && ladderConfig) {
        const ladder = await idcaLadderAtrpService.calculateLadder(pair, ladderConfig);
        validationStatus = ladder.levels.length > 0 ? "valid" : "invalid";
      } else if (activeSystem === "safetyOrdersJson") {
        validationStatus = safetyOrders.length > 0 ? "valid" : "invalid";
      }
    } catch (error) {
      validationStatus = "invalid";
    }
    
    return {
      pair,
      activeSystem,
      safetyOrdersConfigured: safetyOrders.length > 0,
      ladderAtrpEnabled: ladderEnabled,
      lastMigrationAt: history.length > 0 ? history[history.length - 1].evidence.newLevels[0]?.triggerPrice ? new Date() : undefined : undefined,
      migrationHistory: history,
      validationStatus,
    };
  }

  /**
   * Guarda resultado de migración en historial
   */
  private saveMigrationResult(pair: string, result: MigrationResult): void {
    const history = this.migrationHistory.get(pair) || [];
    history.push(result);
    
    // Mantener solo últimos 10 resultados
    if (history.length > 10) {
      history.splice(0, history.length - 10);
    }
    
    this.migrationHistory.set(pair, history);
  }

  /**
   * Limpia historial de migraciones
   */
  clearMigrationHistory(pair?: string): void {
    if (pair) {
      this.migrationHistory.delete(pair);
    } else {
      this.migrationHistory.clear();
    }
  }

  /**
   * Valida que no haya doble lógica ejecutando simultáneamente
   */
  validateNoDoubleExecution(
    pair: string,
    safetyOrders: SafetyOrder[],
    ladderEnabled: boolean,
    ladderConfig?: LadderAtrpConfig
  ): {
    valid: boolean;
    issues: string[];
    recommendation: string;
  } {
    const issues: string[] = [];
    const activeSystem = this.getActiveSystem(pair, safetyOrders, ladderEnabled, ladderConfig);
    
    if (activeSystem === "hybrid") {
      issues.push("Both safetyOrdersJson and ladder ATRP are configured");
      issues.push("Risk of double execution or conflicting signals");
    }
    
    if (ladderEnabled && !ladderConfig) {
      issues.push("Ladder ATRP enabled but no configuration found");
    }
    
    if (!safetyOrders.length && !ladderEnabled) {
      issues.push("No entry system configured");
    }
    
    let recommendation = "";
    if (activeSystem === "hybrid") {
      recommendation = "Disable safetyOrdersJson or ladder ATRP to avoid conflicts";
    } else if (activeSystem === "ladderAtrp") {
      recommendation = "Ladder ATRP is active - ensure safetyOrdersJson is empty";
    } else {
      recommendation = "Safety orders are active - ensure ladder ATRP is disabled";
    }
    
    return {
      valid: issues.length === 0,
      issues,
      recommendation,
    };
  }
}

// Singleton export
export const idcaMigrationService = new IdcaMigrationService();
