import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { db } from '../db';
import { masterBackups, type InsertMasterBackup, type MasterBackup } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';
import { storage } from '../storage';

const execAsync = promisify(exec);

interface BackupFile {
  name: string;
  type: 'database' | 'code' | 'full';
  path: string;
  size: string;
  createdAt: Date;
  isMaster: boolean;
  masterInfo?: MasterBackup;
}

interface BackupMetrics {
  totalTrades: number;
  openPositions: number;
  totalPnlUsd: number;
  uptimeHours: number;
  lastErrorAt: Date | null;
  activeExchange: string;
  activePairs: string[];
  botVersion: string;
  gitBranch: string;
}

interface SystemInfo {
  nodeVersion: string;
  dbVersion: string;
  diskSpace: string;
  memoryUsage: string;
}

export class BackupService {
  private static instance: BackupService;
  private backupDir = process.env.BACKUP_DIR || '/app/backups';
  private scriptsDir = process.env.BACKUP_SCRIPTS_DIR || '/app/scripts';

  private constructor() {
    console.log(`[BackupService] Initialized with scriptsDir=${this.scriptsDir}, backupDir=${this.backupDir}`);
  }

  static getInstance(): BackupService {
    if (!BackupService.instance) {
      BackupService.instance = new BackupService();
    }
    return BackupService.instance;
  }

  /**
   * List all available backups (files + master info)
   */
  async listBackups(): Promise<BackupFile[]> {
    try {
      const [dbFiles, codeFiles, masters] = await Promise.all([
        this.listBackupFiles('database'),
        this.listBackupFiles('code'),
        this.getMasterBackups(),
      ]);

      const masterMap = new Map(masters.map(m => [m.name, m]));

      const allBackups: BackupFile[] = [];

    // Process database backups
    for (const file of dbFiles) {
      const basename = path.basename(file.name, '.sql.gz');
      const master = masterMap.get(basename);
      allBackups.push({
        name: basename,
        type: 'database',
        path: file.path,
        size: file.size,
        createdAt: file.createdAt,
        isMaster: !!master,
        masterInfo: master,
      });
    }

    // Process code backups
    for (const file of codeFiles) {
      const basename = path.basename(file.name, '.tar.gz');
      const master = masterMap.get(basename);
      allBackups.push({
        name: basename,
        type: 'code',
        path: file.path,
        size: file.size,
        createdAt: file.createdAt,
        isMaster: !!master,
        masterInfo: master,
      });
    }

      // Sort by creation date (newest first)
      allBackups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      return allBackups;
    } catch (error) {
      console.error('[BackupService] Error listing backups:', error);
      return [];
    }
  }

  /**
   * List backup files from filesystem
   */
  private async listBackupFiles(type: 'database' | 'code'): Promise<Array<{ name: string; path: string; size: string; createdAt: Date }>> {
    const dir = type === 'database' ? `${this.backupDir}/database` : `${this.backupDir}/code`;
    const extension = type === 'database' ? '.sql.gz' : '.tar.gz';

    try {
      const files = await fs.readdir(dir);
      const backupFiles = files.filter(f => f.endsWith(extension));

      const filesWithStats = await Promise.all(
        backupFiles.map(async (file) => {
          const filePath = path.join(dir, file);
          const stats = await fs.stat(filePath);
          return {
            name: file,
            path: filePath,
            size: this.formatBytes(stats.size),
            createdAt: stats.mtime,
          };
        })
      );

      return filesWithStats;
    } catch (error) {
      console.error(`Error listing ${type} backups:`, error);
      return [];
    }
  }

  /**
   * Create a new backup
   */
  async createBackup(type: 'full' | 'database' | 'code', name?: string): Promise<{ success: boolean; name: string; error?: string }> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const backupName = name || `backup_${timestamp}`;

      let scriptName: string;
      if (type === 'full') {
        scriptName = 'backup-full.sh';
      } else if (type === 'database') {
        scriptName = 'backup-database.sh';
      } else {
        scriptName = 'backup-code.sh';
      }

      const scriptPath = path.join(this.scriptsDir, scriptName);
      
      // Detect shell: prefer bash, fallback to sh if bash not available (Alpine containers)
      const shell = existsSync('/bin/bash') ? 'bash' : 'sh';
      console.log(`[BackupService] Using shell: ${shell}`);
      
      const { stdout, stderr } = await execAsync(`${shell} ${scriptPath} ${backupName}`);

      console.log('[BackupService] Backup created:', stdout);
      if (stderr) console.error('[BackupService] Backup stderr:', stderr);

      return { success: true, name: backupName };
    } catch (error: any) {
      console.error('[BackupService] Error creating backup:', error);
      return { success: false, name: '', error: error.message };
    }
  }

  /**
   * Mark a backup as master
   */
  async markAsMaster(backupName: string, notes?: string, captureMetrics: boolean = true): Promise<{ success: boolean; master?: MasterBackup; error?: string }> {
    try {
      // Check if already exists as master
      const existing = await db.query.masterBackups.findFirst({
        where: eq(masterBackups.name, backupName),
      });

      if (existing) {
        return { success: false, error: 'Backup already marked as master' };
      }

      // Check master count limit (max 2)
      const currentMasters = await this.getMasterBackups();
      if (currentMasters.length >= 2) {
        return { success: false, error: 'Maximum 2 master backups allowed. Please remove one first.' };
      }

      // Determine backup type and path
      const dbPath = `${this.backupDir}/database/${backupName}.sql.gz`;
      const codePath = `${this.backupDir}/code/${backupName}.tar.gz`;

      let type: 'database' | 'code' | 'full' = 'full';
      let filePath = '';
      let size = '';

      try {
        const dbStat = await fs.stat(dbPath);
        const codeStat = await fs.stat(codePath);
        type = 'full';
        filePath = `${dbPath};${codePath}`;
        size = this.formatBytes(dbStat.size + codeStat.size);
      } catch {
        try {
          const dbStat = await fs.stat(dbPath);
          type = 'database';
          filePath = dbPath;
          size = this.formatBytes(dbStat.size);
        } catch {
          try {
            const codeStat = await fs.stat(codePath);
            type = 'code';
            filePath = codePath;
            size = this.formatBytes(codeStat.size);
          } catch {
            return { success: false, error: 'Backup files not found' };
          }
        }
      }

      // Capture metrics if requested
      let metrics: BackupMetrics | null = null;
      let systemInfo: SystemInfo | null = null;

      if (captureMetrics) {
        metrics = await this.captureMetrics();
        systemInfo = await this.captureSystemInfo();
      }

      // Insert master backup record
      const [master] = await db.insert(masterBackups).values({
        name: backupName,
        originalName: backupName,
        type,
        filePath,
        size,
        notes: notes || null,
        metrics: metrics as any,
        systemInfo: systemInfo as any,
        tags: ['master', 'golden'],
        priority: 10,
        protection: 'permanent',
      }).returning();

      return { success: true, master };
    } catch (error: any) {
      console.error('[BackupService] Error marking as master:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Unmark a backup as master
   */
  async unmarkAsMaster(backupName: string): Promise<{ success: boolean; error?: string }> {
    try {
      await db.delete(masterBackups).where(eq(masterBackups.name, backupName));
      return { success: true };
    } catch (error: any) {
      console.error('[BackupService] Error unmarking master:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all master backups
   */
  async getMasterBackups(): Promise<MasterBackup[]> {
    return await db.query.masterBackups.findMany({
      orderBy: [desc(masterBackups.priority), desc(masterBackups.markedAsMasterAt)],
    });
  }

  /**
   * Get a specific master backup
   */
  async getMasterBackup(name: string): Promise<MasterBackup | undefined> {
    return await db.query.masterBackups.findFirst({
      where: eq(masterBackups.name, name),
    });
  }

  /**
   * Restore a backup
   */
  async restoreBackup(backupName: string, type: 'database' | 'code' | 'full'): Promise<{ success: boolean; error?: string }> {
    try {
      if (type === 'database' || type === 'full') {
        const scriptPath = path.join(this.scriptsDir, 'restore-database.sh');
        const dbBackupName = backupName.startsWith('db_') ? backupName : `db_${backupName}`;
        
        // Note: This requires manual confirmation in the script
        const { stdout, stderr } = await execAsync(`echo "SI" | bash ${scriptPath} ${dbBackupName}`);
        console.log('[BackupService] Restore output:', stdout);
        if (stderr) console.error('[BackupService] Restore stderr:', stderr);
      }

      return { success: true };
    } catch (error: any) {
      console.error('[BackupService] Error restoring backup:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete a backup
   */
  async deleteBackup(backupName: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if it's a master backup
      const master = await this.getMasterBackup(backupName);
      if (master) {
        return { success: false, error: 'Cannot delete master backup. Unmark it first.' };
      }

      // Delete files
      const dbPath = `${this.backupDir}/database/${backupName}.sql.gz`;
      const codePath = `${this.backupDir}/code/${backupName}.tar.gz`;

      try {
        await fs.unlink(dbPath);
      } catch {}

      try {
        await fs.unlink(codePath);
      } catch {}

      return { success: true };
    } catch (error: any) {
      console.error('[BackupService] Error deleting backup:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Capture current bot metrics
   */
  private async captureMetrics(): Promise<BackupMetrics> {
    try {
      const [trades, positions, botConfig] = await Promise.all([
        storage.getTrades(),
        storage.getOpenPositions(),
        storage.getBotConfig(),
      ]);

      const totalPnl = positions.reduce((sum: number, pos: any) => {
        const unrealizedPnl = parseFloat(pos.unrealizedPnl || '0');
        return sum + unrealizedPnl;
      }, 0);

      // Get git info
      let gitBranch = 'unknown';
      let gitCommit = 'unknown';
      try {
        const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD');
        const { stdout: commit } = await execAsync('git rev-parse --short HEAD');
        gitBranch = branch.trim();
        gitCommit = commit.trim();
      } catch {}

      return {
        totalTrades: trades.length,
        openPositions: positions.length,
        totalPnlUsd: totalPnl,
        uptimeHours: 0, // TODO: Calculate from bot start time
        lastErrorAt: null, // TODO: Get from bot_logs
        activeExchange: 'revolutx',
        activePairs: (botConfig?.activePairs as any) || [],
        botVersion: gitCommit,
        gitBranch,
      };
    } catch (error) {
      console.error('[BackupService] Error capturing metrics:', error);
      return {
        totalTrades: 0,
        openPositions: 0,
        totalPnlUsd: 0,
        uptimeHours: 0,
        lastErrorAt: null,
        activeExchange: 'unknown',
        activePairs: [],
        botVersion: 'unknown',
        gitBranch: 'unknown',
      };
    }
  }

  /**
   * Capture system information
   */
  private async captureSystemInfo(): Promise<SystemInfo> {
    try {
      const { stdout: nodeVersion } = await execAsync('node --version');
      const { stdout: diskSpace } = await execAsync('df -h /opt | tail -1 | awk \'{print $4}\'');
      const { stdout: memUsage } = await execAsync('free -h | grep Mem | awk \'{print $3}\'');

      return {
        nodeVersion: nodeVersion.trim(),
        dbVersion: 'PostgreSQL 16',
        diskSpace: diskSpace.trim() + ' available',
        memoryUsage: memUsage.trim(),
      };
    } catch (error) {
      console.error('[BackupService] Error capturing system info:', error);
      return {
        nodeVersion: 'unknown',
        dbVersion: 'PostgreSQL 16',
        diskSpace: 'unknown',
        memoryUsage: 'unknown',
      };
    }
  }

  /**
   * Format bytes to human readable
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Get disk space info
   */
  async getDiskSpace(): Promise<{ total: string; used: string; available: string; percentage: string }> {
    try {
      const { stdout } = await execAsync('df -h /opt | tail -1');
      const parts = stdout.trim().split(/\s+/);
      return {
        total: parts[1],
        used: parts[2],
        available: parts[3],
        percentage: parts[4],
      };
    } catch (error) {
      console.error('[BackupService] Error getting disk space:', error);
      return { total: 'unknown', used: 'unknown', available: 'unknown', percentage: 'unknown' };
    }
  }
}

export const backupService = BackupService.getInstance();
