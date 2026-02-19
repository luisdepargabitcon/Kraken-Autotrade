import type { Express } from "express";
import type { RegisterRoutes } from "./types";

export const registerBackupRoutes: RegisterRoutes = async (app, _deps) => {
  const { backupService } = await import('../services/BackupService');

  // List all backups
  app.get("/api/backups", async (req, res) => {
    try {
      const [backups, diskSpace, masters] = await Promise.all([
        backupService.listBackups(),
        backupService.getDiskSpace(),
        backupService.getMasterBackups(),
      ]);

      res.json({
        backups,
        diskSpace,
        masters,
        stats: {
          total: backups.length,
          masterCount: masters.length,
        },
      });
    } catch (error: any) {
      console.error('[API] Error listing backups:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Create a new backup
  app.post("/api/backups/create", async (req, res) => {
    try {
      const { type, name } = req.body;
      
      if (!type || !['full', 'database', 'code'].includes(type)) {
        return res.status(400).json({ error: 'Invalid backup type' });
      }

      const result = await backupService.createBackup(type, name);
      
      if (result.success) {
        res.json({ success: true, name: result.name });
      } else {
        res.status(500).json({ error: result.error });
      }
    } catch (error: any) {
      console.error('[API] Error creating backup:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Mark backup as master
  app.post("/api/backups/:name/set-master", async (req, res) => {
    try {
      const { name } = req.params;
      const { notes, captureMetrics } = req.body;

      const result = await backupService.markAsMaster(name, notes, captureMetrics !== false);
      
      if (result.success) {
        res.json({ success: true, master: result.master });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error: any) {
      console.error('[API] Error marking as master:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Unmark backup as master
  app.post("/api/backups/:name/unmark-master", async (req, res) => {
    try {
      const { name } = req.params;
      const result = await backupService.unmarkAsMaster(name);
      
      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error: any) {
      console.error('[API] Error unmarking master:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get master backups
  app.get("/api/backups/masters", async (req, res) => {
    try {
      const masters = await backupService.getMasterBackups();
      res.json({ masters });
    } catch (error: any) {
      console.error('[API] Error getting masters:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Restore a backup (requires confirmation)
  app.post("/api/backups/:name/restore", async (req, res) => {
    try {
      const { name } = req.params;
      const { confirmation, type } = req.body;

      if (confirmation !== 'RESTAURAR MAESTRO' && confirmation !== 'CONFIRMAR') {
        return res.status(400).json({ error: 'Invalid confirmation' });
      }

      if (!type || !['database', 'code', 'full'].includes(type)) {
        return res.status(400).json({ error: 'Invalid restore type' });
      }

      const result = await backupService.restoreBackup(name, type);
      
      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(500).json({ error: result.error });
      }
    } catch (error: any) {
      console.error('[API] Error restoring backup:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a backup
  app.delete("/api/backups/:name", async (req, res) => {
    try {
      const { name } = req.params;
      const result = await backupService.deleteBackup(name);
      
      if (result.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ error: result.error });
      }
    } catch (error: any) {
      console.error('[API] Error deleting backup:', error);
      res.status(500).json({ error: error.message });
    }
  });
};
