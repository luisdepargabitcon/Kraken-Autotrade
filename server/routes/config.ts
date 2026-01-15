import type { Express } from "express";
import { z } from "zod";
import { configService } from "../services/ConfigService";
import { botLogger } from "../services/botLogger";
import { environment } from "../services/environment";
import { 
  tradingConfigSchema, 
  configChangeSchema,
  type TradingConfig,
  type ConfigChange
} from "@shared/config-schema";

// Validation schemas for API endpoints
const createConfigSchema = z.object({
  name: z.string().min(1).max(100),
  config: tradingConfigSchema,
  description: z.string().optional(),
  userId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const updateConfigSchema = z.object({
  configId: z.string(),
  updates: z.record(z.any()).refine(data => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update"
  }),
  description: z.string().optional(),
  userId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  validateOnly: z.boolean().optional(),
  skipValidation: z.boolean().optional(),
});

const activateConfigSchema = z.object({
  configId: z.string(),
  description: z.string().optional(),
  userId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const activatePresetSchema = z.object({
  presetName: z.string(),
  description: z.string().optional(),
  userId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const createPresetSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  config: tradingConfigSchema,
  isDefault: z.boolean().optional(),
});

const rollbackSchema = z.object({
  changeId: z.string(),
  description: z.string().optional(),
  userId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const importConfigSchema = z.object({
  configJson: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  userId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  skipValidation: z.boolean().optional(),
});

export function registerConfigRoutes(app: Express): void {
  
  // === CONFIGURATION MANAGEMENT ===

  // GET /api/config - Get active configuration
  app.get("/api/config", async (req, res) => {
    try {
      const config = await configService.getActiveConfig();
      if (!config) {
        return res.status(404).json({ error: "No active configuration found" });
      }

      res.json({
        success: true,
        data: config,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[config] Error getting active config:", error);
      res.status(500).json({ error: "Failed to get active configuration" });
    }
  });

  // GET /api/config/list - List all configurations
  app.get("/api/config/list", async (req, res) => {
    try {
      const configs = await configService.listConfigs();
      res.json({
        success: true,
        data: configs,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[config] Error listing configs:", error);
      res.status(500).json({ error: "Failed to list configurations" });
    }
  });

  // GET /api/config/:id - Get specific configuration
  app.get("/api/config/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const config = await configService.getConfig(id);
      
      if (!config) {
        return res.status(404).json({ error: "Configuration not found" });
      }

      res.json({
        success: true,
        data: config,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[config] Error getting config:", error);
      res.status(500).json({ error: "Failed to get configuration" });
    }
  });

  // POST /api/config - Create new configuration
  app.post("/api/config", async (req, res) => {
    try {
      const body = createConfigSchema.parse(req.body);
      
      const result = await configService.createConfig(body.name, body.config, {
        userId: body.userId,
        description: body.description,
        metadata: body.metadata,
      });

      if (!result.success) {
        return res.status(400).json({
          error: "Failed to create configuration",
          details: result.errors,
          warnings: result.warnings,
        });
      }

      // Log configuration creation
      await botLogger.info("CONFIG_CREATED", `Configuration ${body.name} created`, {
        configId: result.configId,
        name: body.name,
        userId: body.userId,
        env: environment.envTag,
        instanceId: environment.instanceId,
      });

      res.status(201).json({
        success: true,
        data: {
          configId: result.configId,
          changeId: result.changeId,
          warnings: result.warnings,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Invalid request data",
          details: error.errors,
        });
      }
      console.error("[config] Error creating config:", error);
      res.status(500).json({ error: "Failed to create configuration" });
    }
  });

  // PUT /api/config/:id - Update configuration
  app.put("/api/config/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const body = updateConfigSchema.parse({ ...req.body, configId: id });
      
      const result = await configService.updateConfig(body.configId, body.updates, {
        userId: body.userId,
        description: body.description,
        metadata: body.metadata,
        validateOnly: body.validateOnly,
        skipValidation: body.skipValidation,
      });

      if (!result.success) {
        return res.status(400).json({
          error: "Failed to update configuration",
          details: result.errors,
          warnings: result.warnings,
        });
      }

      // Log configuration update
      await botLogger.info("CONFIG_UPDATED", `Configuration ${body.configId} updated`, {
        configId: body.configId,
        changedFields: Object.keys(body.updates),
        userId: body.userId,
        validateOnly: body.validateOnly,
        env: environment.envTag,
        instanceId: environment.instanceId,
      });

      res.json({
        success: true,
        data: {
          configId: result.configId,
          changeId: result.changeId,
          warnings: result.warnings,
          appliedAt: result.appliedAt,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Invalid request data",
          details: error.errors,
        });
      }
      console.error("[config] Error updating config:", error);
      res.status(500).json({ error: "Failed to update configuration" });
    }
  });

  // POST /api/config/:id/activate - Activate configuration
  app.post("/api/config/:id/activate", async (req, res) => {
    try {
      const { id } = req.params;
      const body = activateConfigSchema.parse({ ...req.body, configId: id });
      
      const result = await configService.activateConfig(body.configId, {
        userId: body.userId,
        description: body.description,
        metadata: body.metadata,
      });

      if (!result.success) {
        return res.status(400).json({
          error: "Failed to activate configuration",
          details: result.errors,
          warnings: result.warnings,
        });
      }

      // Log configuration activation
      await botLogger.info("CONFIG_ACTIVATED", `Configuration ${body.configId} activated`, {
        configId: body.configId,
        changeId: result.changeId,
        userId: body.userId,
        env: environment.envTag,
        instanceId: environment.instanceId,
      });

      res.json({
        success: true,
        data: {
          configId: result.configId,
          changeId: result.changeId,
          warnings: result.warnings,
          appliedAt: result.appliedAt,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Invalid request data",
          details: error.errors,
        });
      }
      console.error("[config] Error activating config:", error);
      res.status(500).json({ error: "Failed to activate configuration" });
    }
  });

  // POST /api/config/validate - Validate configuration without saving
  app.post("/api/config/validate", async (req, res) => {
    try {
      const { config } = req.body;
      
      const validationResult = configService.validateConfig(config);
      
      res.json({
        success: true,
        data: validationResult,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[config] Error validating config:", error);
      res.status(500).json({ error: "Failed to validate configuration" });
    }
  });

  // === PRESET MANAGEMENT ===

  // GET /api/config/presets - List all presets
  app.get("/api/config/presets", async (req, res) => {
    try {
      const presets = await configService.listPresets();
      res.json({
        success: true,
        data: presets,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[config] Error listing presets:", error);
      res.status(500).json({ error: "Failed to list presets" });
    }
  });

  // GET /api/config/presets/:name - Get specific preset
  app.get("/api/config/presets/:name", async (req, res) => {
    try {
      const { name } = req.params;
      const preset = await configService.getPreset(name);
      
      if (!preset) {
        return res.status(404).json({ error: "Preset not found" });
      }

      res.json({
        success: true,
        data: preset,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[config] Error getting preset:", error);
      res.status(500).json({ error: "Failed to get preset" });
    }
  });

  // POST /api/config/presets - Create new preset
  app.post("/api/config/presets", async (req, res) => {
    try {
      const body = createPresetSchema.parse(req.body);
      
      const preset = await configService.createPreset(
        body.name,
        body.description,
        body.config,
        body.isDefault
      );


      res.status(201).json({
        success: true,
        data: preset,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Invalid request data",
          details: error.errors,
        });
      }
      console.error("[config] Error creating preset:", error);
      res.status(500).json({ error: "Failed to create preset" });
    }
  });

  // POST /api/config/presets/:name/activate - Activate preset
  app.post("/api/config/presets/:name/activate", async (req, res) => {
    try {
      const { name } = req.params;
      const body = activatePresetSchema.parse({ ...req.body, presetName: name });
      
      const result = await configService.activatePreset(body.presetName, {
        userId: body.userId,
        description: body.description,
        metadata: body.metadata,
      });

      if (!result.success) {
        return res.status(400).json({
          error: "Failed to activate preset",
          details: result.errors,
          warnings: result.warnings,
        });
      }

      // Log preset activation
      await botLogger.info("PRESET_ACTIVATED", `Preset ${body.presetName} activated`, {
        presetName: body.presetName,
        configId: result.configId,
        changeId: result.changeId,
        userId: body.userId,
        env: environment.envTag,
        instanceId: environment.instanceId,
      });

      res.json({
        success: true,
        data: {
          configId: result.configId,
          changeId: result.changeId,
          warnings: result.warnings,
          appliedAt: result.appliedAt,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Invalid request data",
          details: error.errors,
        });
      }
      console.error("[config] Error activating preset:", error);
      res.status(500).json({ error: "Failed to activate preset" });
    }
  });

  // === CHANGE HISTORY ===

  // GET /api/config/:id/history - Get configuration change history
  app.get("/api/config/:id/history", async (req, res) => {
    try {
      const { id } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      
      const history = await configService.getChangeHistory(id, limit);
      
      res.json({
        success: true,
        data: history,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[config] Error getting change history:", error);
      res.status(500).json({ error: "Failed to get change history" });
    }
  });

  // GET /api/config/history - Get all change history
  app.get("/api/config/history", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      
      const history = await configService.getChangeHistory(undefined, limit);
      
      res.json({
        success: true,
        data: history,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("[config] Error getting change history:", error);
      res.status(500).json({ error: "Failed to get change history" });
    }
  });

  // POST /api/config/rollback - Rollback to specific change
  app.post("/api/config/rollback", async (req, res) => {
    try {
      const body = rollbackSchema.parse(req.body);
      
      const result = await configService.rollbackToChange(body.changeId, {
        userId: body.userId,
        description: body.description,
        metadata: body.metadata,
      });

      if (!result.success) {
        return res.status(400).json({
          error: "Failed to rollback",
          details: result.errors,
          warnings: result.warnings,
        });
      }

      // Log rollback
      await botLogger.info("CONFIG_ROLLBACK", `Rollback to change ${body.changeId}`, {
        changeId: body.changeId,
        configId: result.configId,
        userId: body.userId,
        env: environment.envTag,
        instanceId: environment.instanceId,
      });

      res.json({
        success: true,
        data: {
          configId: result.configId,
          warnings: result.warnings,
          appliedAt: result.appliedAt,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Invalid request data",
          details: error.errors,
        });
      }
      console.error("[config] Error rolling back:", error);
      res.status(500).json({ error: "Failed to rollback" });
    }
  });

  // === IMPORT/EXPORT ===

  // GET /api/config/:id/export - Export configuration
  app.get("/api/config/:id/export", async (req, res) => {
    try {
      const { id } = req.params;
      const configJson = await configService.exportConfig(id);
      
      if (!configJson) {
        return res.status(404).json({ error: "Configuration not found" });
      }

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="config-${id}.json"`);
      res.send(configJson);
    } catch (error) {
      console.error("[config] Error exporting config:", error);
      res.status(500).json({ error: "Failed to export configuration" });
    }
  });

  // POST /api/config/import - Import configuration
  app.post("/api/config/import", async (req, res) => {
    try {
      const body = importConfigSchema.parse(req.body);
      
      const result = await configService.importConfig(
        body.configJson,
        body.name,
        {
          userId: body.userId,
          description: body.description,
          metadata: { ...body.metadata, imported: true },
          skipValidation: body.skipValidation,
        }
      );

      if (!result.success) {
        return res.status(400).json({
          error: "Failed to import configuration",
          details: result.errors,
          warnings: result.warnings,
        });
      }

      // Log import
      await botLogger.info("CONFIG_IMPORTED", `Configuration imported: ${body.name}`, {
        configId: result.configId,
        name: body.name,
        userId: body.userId,
        env: environment.envTag,
        instanceId: environment.instanceId,
      });

      res.status(201).json({
        success: true,
        data: {
          configId: result.configId,
          changeId: result.changeId,
          warnings: result.warnings,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Invalid request data",
          details: error.errors,
        });
      }
      console.error("[config] Error importing config:", error);
      res.status(500).json({ error: "Failed to import configuration" });
    }
  });

  // === HEALTH CHECK ===

  // GET /api/config/health - Check configuration service health
  app.get("/api/config/health", async (req, res) => {
    try {
      const activeConfig = await configService.getActiveConfig();
      const configs = await configService.listConfigs();
      const presets = await configService.listPresets();
      
      res.json({
        success: true,
        data: {
          healthy: true,
          activeConfigId: configService['activeConfigId'],
          totalConfigs: configs.length,
          totalPresets: presets.length,
          hasActiveConfig: !!activeConfig,
          cacheSize: configService['configCache'].size,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("[config] Error checking health:", error);
      res.status(500).json({ 
        success: false, 
        healthy: false, 
        error: "Configuration service unhealthy" 
      });
    }
  });
}
