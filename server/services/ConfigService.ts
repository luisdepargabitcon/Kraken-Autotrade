import { storage } from '../storage';
import { botLogger } from './botLogger';
import { environment } from './environment';
import { 
  tradingConfig, 
  configChange, 
  configPreset,
  type TradingConfigRow,
  type ConfigChangeRow,
  type ConfigPresetRow
} from '@shared/schema';
import { 
  tradingConfigSchema, 
  validationRules,
  type TradingConfig,
  type ConfigChange,
  type SignalConfig
} from '@shared/config-schema';
import { db } from '../db';
import { eq, desc } from 'drizzle-orm';
import { EventEmitter } from 'events';

export interface ConfigUpdateOptions {
  userId?: string;
  description?: string;
  metadata?: Record<string, any>;
  validateOnly?: boolean;
  skipValidation?: boolean;
}

export interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  fieldErrors: Record<string, string>;
}

export interface ConfigApplyResult {
  success: boolean;
  configId: string;
  changeId?: string;
  errors: string[];
  warnings: string[];
  appliedAt?: Date;
}

export class ConfigService extends EventEmitter {
  private static instance: ConfigService;
  private activeConfigId: string | null = null;
  private configCache = new Map<string, TradingConfig>();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  private constructor() {
    super();
  }

  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  // === CONFIGURATION MANAGEMENT ===

  async getActiveConfig(): Promise<TradingConfig | null> {
    if (this.activeConfigId) {
      const cached = this.configCache.get(this.activeConfigId);
      if (cached) return cached;
    }

    try {
      const [activeConfig] = await db.select().from(tradingConfig).where(eq(tradingConfig.isActive, true));
      if (!activeConfig) return null;

      this.activeConfigId = activeConfig.id.toString();
      const config = activeConfig.config as TradingConfig;
      this.configCache.set(this.activeConfigId, config);
      return config;
    } catch (error) {
      console.error('[ConfigService] Error getting active config:', error);
      return null;
    }
  }

  async getConfig(configId: string): Promise<TradingConfig | null> {
    const cached = this.configCache.get(configId);
    if (cached) return cached;

    try {
      const [configRow] = await db.select().from(tradingConfig).where(eq(tradingConfig.id, parseInt(configId)));
      if (!configRow) return null;

      const config = configRow.config as TradingConfig;
      this.configCache.set(configId, config);
      return config;
    } catch (error) {
      console.error('[ConfigService] Error getting config:', error);
      return null;
    }
  }

  async listConfigs(): Promise<Array<{ id: string; name: string; description: string; isActive: boolean; createdAt: Date; updatedAt: Date }>> {
    try {
      const configs = await db.select({
        id: tradingConfig.id,
        name: tradingConfig.name,
        description: tradingConfig.description,
        isActive: tradingConfig.isActive,
        createdAt: tradingConfig.createdAt,
        updatedAt: tradingConfig.updatedAt,
      }).from(tradingConfig).orderBy(desc(tradingConfig.updatedAt));

      return configs.map(config => ({
        id: config.id.toString(),
        name: config.name,
        description: config.description || '',
        isActive: config.isActive,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      }));
    } catch (error) {
      console.error('[ConfigService] Error listing configs:', error);
      return [];
    }
  }

  async createConfig(name: string, config: TradingConfig, options: ConfigUpdateOptions = {}): Promise<ConfigApplyResult> {
    try {
      const validationResult = this.validateConfig(config);
      if (!validationResult.isValid && !options.skipValidation) {
        return { success: false, configId: '', errors: validationResult.errors, warnings: validationResult.warnings };
      }

      const configRow: Omit<TradingConfigRow, 'id' | 'createdAt' | 'updatedAt'> = {
        name,
        description: options.description || `Configuration created at ${new Date().toISOString()}`,
        config: config as any,
        isActive: false,
      };

      const [createdConfig] = await db.insert(tradingConfig).values(configRow).returning();
      const configId = createdConfig.id.toString();

      const changeRow: Omit<ConfigChangeRow, 'id' | 'createdAt' | 'appliedAt'> = {
        configId,
        userId: options.userId || null,
        changeType: 'CREATE',
        description: options.description || 'Configuration created',
        previousConfig: null,
        newConfig: config as any,
        changedFields: Object.keys(config),
        metadata: options.metadata || null,
        isActive: false,
      };

      const [createdChange] = await db.insert(configChange).values(changeRow).returning();
      this.configCache.set(configId, config);

      await botLogger.info('CONFIG_CREATED', `Configuration ${name} created`, {
        configId,
        name,
        userId: options.userId,
        env: environment.envTag,
      });

      return { 
        success: true, 
        configId, 
        changeId: createdChange.id.toString(), 
        errors: [], 
        warnings: validationResult.warnings 
      };
    } catch (error) {
      console.error('[ConfigService] Error creating config:', error);
      return { success: false, configId: '', errors: [error instanceof Error ? error.message : 'Unknown error'], warnings: [] };
    }
  }

  async updateConfig(configId: string, updates: Partial<TradingConfig>, options: ConfigUpdateOptions = {}): Promise<ConfigApplyResult> {
    try {
      const currentConfig = await this.getConfig(configId);
      if (!currentConfig) {
        return { success: false, configId, errors: ['Configuration not found'], warnings: [] };
      }

      const updatedConfig = { ...currentConfig, ...updates };
      const validationResult = this.validateConfig(updatedConfig);
      
      if (!validationResult.isValid && !options.skipValidation) {
        return { success: false, configId, errors: validationResult.errors, warnings: validationResult.warnings };
      }

      if (options.validateOnly) {
        return { success: true, configId, errors: [], warnings: validationResult.warnings };
      }

      await db.update(tradingConfig)
        .set({ 
          config: updatedConfig as any, 
          updatedAt: new Date(),
          description: options.description || `Configuration updated at ${new Date().toISOString()}`
        })
        .where(eq(tradingConfig.id, parseInt(configId)));

      const changedFields = Object.keys(updates);
      const changeRow: Omit<ConfigChangeRow, 'id' | 'createdAt' | 'appliedAt'> = {
        configId,
        userId: options.userId || null,
        changeType: 'UPDATE',
        description: options.description || 'Configuration updated',
        previousConfig: currentConfig as any,
        newConfig: updatedConfig as any,
        changedFields,
        metadata: options.metadata || null,
        isActive: this.activeConfigId === configId,
      };

      const [createdChange] = await db.insert(configChange).values(changeRow).returning();
      this.configCache.set(configId, updatedConfig);

      await botLogger.info('CONFIG_UPDATED', `Configuration ${configId} updated`, {
        configId,
        changedFields,
        userId: options.userId,
        env: environment.envTag,
      });

      return { 
        success: true, 
        configId, 
        changeId: createdChange.id.toString(), 
        errors: [], 
        warnings: validationResult.warnings,
        appliedAt: this.activeConfigId === configId ? new Date() : undefined
      };
    } catch (error) {
      console.error('[ConfigService] Error updating config:', error);
      return { success: false, configId, errors: [error instanceof Error ? error.message : 'Unknown error'], warnings: [] };
    }
  }

  async activateConfig(configId: string, options: ConfigUpdateOptions = {}): Promise<ConfigApplyResult> {
    try {
      const config = await this.getConfig(configId);
      if (!config) {
        return { success: false, configId, errors: ['Configuration not found'], warnings: [] };
      }

      const validationResult = this.validateConfig(config);
      if (!validationResult.isValid && !options.skipValidation) {
        return { success: false, configId, errors: validationResult.errors, warnings: validationResult.warnings };
      }

      const previousConfigId = this.activeConfigId;

      if (previousConfigId) {
        await db.update(tradingConfig)
          .set({ isActive: false })
          .where(eq(tradingConfig.id, parseInt(previousConfigId)));
      }

      await db.update(tradingConfig)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(tradingConfig.id, parseInt(configId)));

      this.activeConfigId = configId;

      const changeRow: Omit<ConfigChangeRow, 'id' | 'createdAt' | 'appliedAt'> = {
        configId,
        userId: options.userId || null,
        changeType: 'ACTIVATE_PRESET',
        description: options.description || 'Configuration activated',
        previousConfig: previousConfigId ? await this.getConfig(previousConfigId) : null,
        newConfig: config as any,
        changedFields: ['isActive'],
        metadata: { ...options.metadata, previousConfigId } as any,
        isActive: true,
      };

      const [createdChange] = await db.insert(configChange).values(changeRow).returning();

      await botLogger.info('CONFIG_ACTIVATED', `Configuration ${configId} activated`, {
        configId,
        previousConfigId,
        userId: options.userId,
        env: environment.envTag,
      });

      return { 
        success: true, 
        configId, 
        changeId: createdChange.id.toString(), 
        errors: [], 
        warnings: validationResult.warnings,
        appliedAt: new Date()
      };
    } catch (error) {
      console.error('[ConfigService] Error activating config:', error);
      return { success: false, configId, errors: [error instanceof Error ? error.message : 'Unknown error'], warnings: [] };
    }
  }

  // === VALIDATION ===

  validateConfig(config: TradingConfig): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const fieldErrors: Record<string, string> = {};

    // Validate global configuration
    if (config.global) {
      this.validateSection(config.global, validationRules.global, 'global', errors, warnings, fieldErrors);
    }

    // Validate signal configuration
    if (config.signals) {
      Object.entries(config.signals).forEach(([regime, signalConfig]) => {
        this.validateSection(signalConfig, validationRules.signals, `signals.${regime}`, errors, warnings, fieldErrors);
      });
    }

    // Validate exchange configuration
    if (config.exchanges) {
      Object.entries(config.exchanges).forEach(([exchange, exchangeConfig]) => {
        this.validateSection(exchangeConfig, validationRules.exchanges, `exchanges.${exchange}`, errors, warnings, fieldErrors);
      });
    }

    // Cross-validation rules
    this.validateCrossRules(config, errors, warnings, fieldErrors);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      fieldErrors,
    };
  }

  private validateSection(obj: any, rules: any, prefix: string, errors: string[], warnings: string[], fieldErrors: Record<string, string>): void {
    if (!rules) return;
    
    Object.entries(rules).forEach(([field, rule]: [string, any]) => {
      const value = obj[field];
      const fieldPath = `${prefix}.${field}`;

      if (value !== undefined && value !== null && rule) {
        if (typeof value === 'number' && rule.min !== undefined && rule.max !== undefined) {
          if (value < rule.min || value > rule.max) {
            const message = rule.error || `${fieldPath} must be between ${rule.min} and ${rule.max}`;
            fieldErrors[fieldPath] = message;
            errors.push(message);
          } else if (rule.warning && (value < rule.min * 1.1 || value > rule.max * 0.9)) {
            warnings.push(rule.warning);
          }
        }
      }
    });
  }

  private validateCrossRules(config: TradingConfig, errors: string[], warnings: string[], fieldErrors: Record<string, string>): void {
    if (config.global?.maxTotalExposurePct && config.global?.maxPairExposurePct) {
      if (config.global.maxTotalExposurePct < config.global.maxPairExposurePct) {
        const message = 'Total exposure must be greater than or equal to pair exposure';
        fieldErrors['global.maxTotalExposurePct'] = message;
        errors.push(message);
      }
    }

    if (config.global?.riskPerTradePct && config.global?.maxPairExposurePct) {
      if (config.global.riskPerTradePct > config.global.maxPairExposurePct * 0.5) {
        warnings.push('Risk per trade is high relative to pair exposure');
      }
    }

    if (config.signals) {
      Object.entries(config.signals).forEach(([regime, signalConfig]) => {
        const sc = signalConfig as SignalConfig;
        if (sc.minSignals > sc.maxSignals) {
          const message = `Minimum signals cannot exceed maximum signals for ${regime}`;
          fieldErrors[`signals.${regime}.minSignals`] = message;
          errors.push(message);
        }
        if (sc.currentSignals < sc.minSignals || sc.currentSignals > sc.maxSignals) {
          const message = `Current signals must be within min/max range for ${regime}`;
          fieldErrors[`signals.${regime}.currentSignals`] = message;
          errors.push(message);
        }
      });
    }
  }

  // === PRESET MANAGEMENT ===

  async listPresets(): Promise<Array<{ id: string; name: string; description: string; isDefault: boolean; createdAt: Date }>> {
    try {
      const presets = await db.select({
        id: configPreset.id,
        name: configPreset.name,
        description: configPreset.description,
        isDefault: configPreset.isDefault,
        createdAt: configPreset.createdAt,
      }).from(configPreset).orderBy(desc(configPreset.createdAt));

      return presets.map(preset => ({
        id: preset.id.toString(),
        name: preset.name,
        description: preset.description,
        isDefault: preset.isDefault,
        createdAt: preset.createdAt,
      }));
    } catch (error) {
      console.error('[ConfigService] Error listing presets:', error);
      return [];
    }
  }

  async getPreset(name: string): Promise<ConfigPresetRow | null> {
    try {
      const [preset] = await db.select().from(configPreset).where(eq(configPreset.name, name));
      return preset || null;
    } catch (error) {
      console.error('[ConfigService] Error getting preset:', error);
      return null;
    }
  }

  async createPreset(name: string, description: string, config: TradingConfig, isDefault: boolean = false): Promise<ConfigPresetRow | null> {
    try {
      if (isDefault) {
        await db.update(configPreset).set({ isDefault: false }).where(eq(configPreset.isDefault, true));
      }

      const presetRow: Omit<ConfigPresetRow, 'id' | 'createdAt' | 'updatedAt'> = {
        name,
        description,
        config: config as any,
        isDefault,
      };

      const [createdPreset] = await db.insert(configPreset).values(presetRow).returning();

      await botLogger.info('PRESET_CREATED', `Preset ${name} created`, {
        presetId: createdPreset.id.toString(),
        name,
        isDefault,
        env: environment.envTag,
      });

      return createdPreset;
    } catch (error) {
      console.error('[ConfigService] Error creating preset:', error);
      return null;
    }
  }

  async activatePreset(presetName: string, options: ConfigUpdateOptions = {}): Promise<ConfigApplyResult> {
    const preset = await this.getPreset(presetName);
    if (!preset) {
      return { success: false, configId: '', errors: ['Preset not found'], warnings: [] };
    }

    const configName = `${presetName}-active-${Date.now()}`;
    const createResult = await this.createConfig(configName, preset.config as TradingConfig, {
      ...options,
      description: `Activated from preset: ${presetName}`,
    });

    if (!createResult.success) {
      return createResult;
    }

    const activateResult = await this.activateConfig(createResult.configId, {
      ...options,
      description: `Activated preset: ${presetName}`,
      metadata: { ...options.metadata, presetName, presetId: preset.id?.toString() || 'unknown' },
    });

    if (activateResult.success) {
      await botLogger.info('PRESET_ACTIVATED', `Preset ${presetName} activated`, {
        presetName,
        configId: createResult.configId,
        presetId: preset.id?.toString() || 'unknown',
        userId: options.userId,
        env: environment.envTag,
      });
    }

    return activateResult;
  }

  // === CHANGE HISTORY ===

  async getChangeHistory(configId?: string, limit: number = 50): Promise<any[]> {
    try {
      let query = db.select().from(configChange);
      
      if (configId) {
        query = query.where(eq(configChange.configId, configId)) as any;
      }
      
      const changes = await query
        .orderBy(desc(configChange.createdAt))
        .limit(limit);

      return changes.map(change => ({
        id: change.id.toString(),
        configId: change.configId,
        userId: change.userId || undefined,
        changeType: change.changeType,
        description: change.description,
        previousConfig: change.previousConfig,
        newConfig: change.newConfig,
        changedFields: change.changedFields,
        metadata: change.metadata || undefined,
        createdAt: change.createdAt,
        appliedAt: change.appliedAt || undefined,
        isActive: change.isActive,
      }));
    } catch (error) {
      console.error('[ConfigService] Error getting change history:', error);
      return [];
    }
  }

  // === UTILITY METHODS ===

  async exportConfig(configId: string): Promise<string | null> {
    try {
      const config = await this.getConfig(configId);
      if (!config) return null;
      return JSON.stringify(config, null, 2);
    } catch (error) {
      console.error('[ConfigService] Error exporting config:', error);
      return null;
    }
  }

  async importConfig(configJson: string, name: string, options: ConfigUpdateOptions = {}): Promise<ConfigApplyResult> {
    try {
      const config = JSON.parse(configJson) as TradingConfig;
      const validationResult = this.validateConfig(config);
      
      if (!validationResult.isValid && !options.skipValidation) {
        return { success: false, configId: '', errors: validationResult.errors, warnings: validationResult.warnings };
      }

      return this.createConfig(name, config, {
        ...options,
        description: `Imported configuration: ${name}`,
        metadata: { ...options.metadata, imported: true },
      });
    } catch (error) {
      console.error('[ConfigService] Error importing config:', error);
      return { success: false, configId: '', errors: ['Invalid JSON configuration'], warnings: [] };
    }
  }

  async rollbackToChange(changeId: string, options: ConfigUpdateOptions = {}): Promise<ConfigApplyResult> {
    try {
      const [change] = await db.select().from(configChange).where(eq(configChange.id, parseInt(changeId)));
      if (!change) {
        return { success: false, configId: '', errors: ['Change not found'], warnings: [] };
      }

      if (!change.previousConfig) {
        return { success: false, configId: '', errors: ['Cannot rollback - no previous configuration'], warnings: [] };
      }

      const updateResult = await this.updateConfig(change.configId, change.previousConfig as any, {
        ...options,
        description: `Rollback to change ${changeId}`,
        metadata: { ...options.metadata, rollbackChangeId: changeId },
      });

      if (updateResult.success) {
        const rollbackChangeRow: Omit<ConfigChangeRow, 'id' | 'createdAt' | 'appliedAt'> = {
          configId: change.configId,
          userId: options.userId || null,
          changeType: 'ROLLBACK',
          description: `Rollback to change ${changeId}`,
          previousConfig: change.newConfig,
          newConfig: change.previousConfig,
          changedFields: Object.keys(change.previousConfig as any),
          metadata: { ...options.metadata, rollbackChangeId: changeId } as any,
          isActive: true,
        };

        await db.insert(configChange).values(rollbackChangeRow);

        await botLogger.info('CONFIG_ROLLBACK', `Rollback to change ${changeId}`, {
          changeId,
          configId: change.configId,
          userId: options.userId,
          env: environment.envTag,
        });
      }

      return updateResult;
    } catch (error) {
      console.error('[ConfigService] Error rolling back:', error);
      return { success: false, configId: '', errors: [error instanceof Error ? error.message : 'Unknown error'], warnings: [] };
    }
  }
}

export const configService = ConfigService.getInstance();
