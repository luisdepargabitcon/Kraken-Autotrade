import { db } from "../db";
import { serverLogs } from "../../shared/schema";
import { desc, gte, lte, lt, eq, and, like, sql, or } from "drizzle-orm";

const MAX_MEMORY_LOGS = 500;
const BATCH_INSERT_SIZE = 50;
const BATCH_INSERT_INTERVAL_MS = 5000;

interface ServerLog {
  id?: number;
  timestamp: Date;
  source: string;
  level: string;
  line: string;
  isError: boolean | null;
}

class ServerLogsService {
  private memoryLogs: ServerLog[] = [];
  private pendingInserts: Omit<ServerLog, 'id'>[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;

  async persistLog(source: string, line: string, isError: boolean = false): Promise<void> {
    const level = this.detectLevel(line);
    const logEntry: Omit<ServerLog, 'id'> = {
      timestamp: new Date(),
      source,
      level,
      line,
      isError,
    };

    // Add to memory
    this.memoryLogs.push({ ...logEntry, id: Date.now() });
    if (this.memoryLogs.length > MAX_MEMORY_LOGS) {
      this.memoryLogs.shift();
    }

    // Add to pending batch
    this.pendingInserts.push(logEntry);

    // Schedule batch insert
    if (!this.batchTimeout) {
      this.batchTimeout = setTimeout(() => this.flushBatch(), BATCH_INSERT_INTERVAL_MS);
    }

    // Force flush if batch is large enough
    if (this.pendingInserts.length >= BATCH_INSERT_SIZE) {
      await this.flushBatch();
    }
  }

  private detectLevel(line: string): string {
    // Check for real log level patterns, not JSON content like "isError":false
    // Priority: check explicit log level markers first
    
    // Real ERROR patterns: [ERROR], (ERROR), ERROR:, level":"ERROR, "level":"ERROR"
    const errorPatterns = [
      /\[ERROR\]/i,
      /\(ERROR\)/i,
      /^ERROR:/i,
      /\bERROR\b.*:/,  // ERROR followed by colon (not inside JSON)
      /\[FATAL\]/i,
      /\bFATAL\b/i,
      /\bEXCEPTION\b/i,
      /\bUncaught\b/i,
      /\bUnhandled\b/i,
    ];
    
    // Check if this is a JSON response log (contains large JSON payloads)
    // These should NOT be marked as ERROR just because nested content has "isError"
    const isJsonResponseLog = line.includes('{"logs":') || line.includes('"isError"');
    
    if (!isJsonResponseLog) {
      for (const pattern of errorPatterns) {
        if (pattern.test(line)) {
          return "ERROR";
        }
      }
    } else {
      // For JSON response logs, only mark as ERROR if the HTTP status is error (4xx/5xx)
      const httpStatusMatch = line.match(/\s([45]\d{2})\s+in\s+\d+ms/);
      if (httpStatusMatch) {
        return "ERROR";
      }
    }
    
    // WARN patterns
    if (/\[WARN(ING)?\]/i.test(line) || /\bWARN(ING)?:/i.test(line)) {
      return "WARN";
    }
    
    // DEBUG patterns
    if (/\[DEBUG\]/i.test(line)) {
      return "DEBUG";
    }
    
    return "INFO";
  }

  private async flushBatch(): Promise<void> {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    if (this.pendingInserts.length === 0) return;

    const toInsert = [...this.pendingInserts];
    this.pendingInserts = [];

    try {
      await db.insert(serverLogs).values(toInsert);
    } catch (error) {
      console.error("[ServerLogsService] Error persisting logs batch:", error);
    }
  }

  async getLogs(options: {
    limit?: number;
    from?: Date;
    to?: Date;
    source?: string;
    level?: string;
    search?: string;
  } = {}): Promise<ServerLog[]> {
    const { limit = 500, from, to, source, level, search } = options;

    try {
      const conditions: any[] = [];

      if (from) {
        conditions.push(gte(serverLogs.timestamp, from));
      }
      if (to) {
        conditions.push(lte(serverLogs.timestamp, to));
      }
      if (source) {
        conditions.push(eq(serverLogs.source, source));
      }
      if (level) {
        conditions.push(eq(serverLogs.level, level.toUpperCase()));
      }
      if (search) {
        conditions.push(like(serverLogs.line, `%${search}%`));
      }

      let query = db.select().from(serverLogs);
      
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      return await query
        .orderBy(desc(serverLogs.timestamp))
        .limit(limit);
    } catch (error) {
      console.error("[ServerLogsService] Error fetching logs from DB:", error);
      return [];
    }
  }

  async getLogsCount(from?: Date, to?: Date): Promise<number> {
    try {
      const conditions: any[] = [];
      if (from) conditions.push(gte(serverLogs.timestamp, from));
      if (to) conditions.push(lte(serverLogs.timestamp, to));

      let query = db.select({ count: sql<number>`count(*)` }).from(serverLogs);
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      const result = await query;
      return Number(result[0]?.count || 0);
    } catch (error) {
      console.error("[ServerLogsService] Error counting logs:", error);
      return 0;
    }
  }

  async purgeOldLogs(retentionDays: number = 7): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const result = await db.delete(serverLogs)
        .where(lt(serverLogs.timestamp, cutoffDate))
        .returning({ id: serverLogs.id });

      const deletedCount = result.length;
      if (deletedCount > 0) {
        console.log(`[ServerLogsService] Purged ${deletedCount} logs older than ${retentionDays} days`);
      }
      return deletedCount;
    } catch (error) {
      console.error("[ServerLogsService] Error purging old logs:", error);
      return 0;
    }
  }

  getMemoryLogs(): ServerLog[] {
    return [...this.memoryLogs];
  }

  async exportLogs(options: {
    from?: Date;
    to?: Date;
    source?: string;
    level?: string;
    search?: string;
    format?: 'ndjson' | 'csv' | 'txt';
  }): Promise<{ content: string; contentType: string; filename: string }> {
    const { format = 'txt', ...filterOptions } = options;
    const logs = await this.getLogs({ ...filterOptions, limit: 100000 });

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    
    if (format === 'ndjson') {
      const content = logs.map(log => JSON.stringify(log)).join("\n");
      return {
        content,
        contentType: 'application/x-ndjson',
        filename: `server-logs-${timestamp}.ndjson`,
      };
    }
    
    if (format === 'csv') {
      const header = 'timestamp,source,level,line,isError';
      const rows = logs.map(log => 
        `"${log.timestamp.toISOString()}","${log.source}","${log.level}","${log.line.replace(/"/g, '""')}",${log.isError}`
      );
      return {
        content: [header, ...rows].join("\n"),
        contentType: 'text/csv',
        filename: `server-logs-${timestamp}.csv`,
      };
    }

    // Default: plain text
    const content = logs.map(log => 
      `[${log.timestamp.toISOString()}] [${log.source}] [${log.level}] ${log.line}`
    ).join("\n");
    return {
      content,
      contentType: 'text/plain',
      filename: `server-logs-${timestamp}.txt`,
    };
  }
}

export const serverLogsService = new ServerLogsService();
