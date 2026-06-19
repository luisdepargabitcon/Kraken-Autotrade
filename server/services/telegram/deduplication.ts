/**
 * Telegram Message Deduplication
 * Prevents duplicate/spam messages via hash and throttle
 * Extended with persistent DB-backed logical fingerprint deduplication
 */
import { computeMessageHash } from "./types";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { log } from "../../utils/logger";

interface DedupeEntry {
  hash: string;
  timestamp: number;
  count: number;
}

interface ThrottleConfig {
  /** Minimum seconds between identical messages */
  minIntervalSeconds: number;
  /** Minimum seconds between any message of this type */
  typeThrottleSeconds: number;
  /** Max messages of this type per hour */
  maxPerHour: number;
}

const DEFAULT_THROTTLE: ThrottleConfig = {
  minIntervalSeconds: 60,
  typeThrottleSeconds: 30,
  maxPerHour: 20,
};

// Throttle configs by message type
const THROTTLE_CONFIGS: Record<string, ThrottleConfig> = {
  positions_update: {
    minIntervalSeconds: 300, // 5 min between same content
    typeThrottleSeconds: 120, // 2 min between any position update
    maxPerHour: 12,
  },
  heartbeat: {
    minIntervalSeconds: 3600 * 6, // 6 hours between same
    typeThrottleSeconds: 3600, // 1 hour between any
    maxPerHour: 2,
  },
  daily_report: {
    minIntervalSeconds: 3600 * 12, // 12 hours
    typeThrottleSeconds: 3600 * 6,
    maxPerHour: 2,
  },
  entry_intent: {
    minIntervalSeconds: 900, // 15 min (one candle)
    typeThrottleSeconds: 300,
    maxPerHour: 8,
  },
  trade_buy: {
    minIntervalSeconds: 10, // Almost no dedupe for actual trades
    typeThrottleSeconds: 5,
    maxPerHour: 60,
  },
  trade_sell: {
    minIntervalSeconds: 10,
    typeThrottleSeconds: 5,
    maxPerHour: 60,
  },
  error: {
    minIntervalSeconds: 300, // 5 min for same error
    typeThrottleSeconds: 60,
    maxPerHour: 20,
  },
  regime_change: {
    minIntervalSeconds: 300,
    typeThrottleSeconds: 180,
    maxPerHour: 10,
  },
};

export class MessageDeduplicator {
  private cache: Map<string, DedupeEntry> = new Map();
  private typeLastSent: Map<string, number> = new Map();
  private typeHourlyCount: Map<string, { count: number; resetAt: number }> = new Map();
  
  // Cleanup interval (every 30 min)
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.startCleanup();
  }

  private startCleanup(): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 30 * 60 * 1000); // 30 min
  }

  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.CACHE_TTL_MS;
    
    let cleaned = 0;
    for (const [key, entry] of this.cache) {
      if (entry.timestamp < cutoff) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[telegram-dedupe] Cleaned ${cleaned} stale entries`);
    }
  }

  /**
   * Check if a message should be sent or deduplicated
   * @returns { allowed: boolean, reason?: string }
   */
  shouldSend(
    messageType: string,
    content: string,
    forceKey?: string
  ): { allowed: boolean; reason?: string } {
    const now = Date.now();
    const config = THROTTLE_CONFIGS[messageType] || DEFAULT_THROTTLE;
    
    // 1. Check hourly rate limit
    const hourlyData = this.typeHourlyCount.get(messageType);
    if (hourlyData) {
      if (now >= hourlyData.resetAt) {
        // Reset hourly counter
        this.typeHourlyCount.set(messageType, { count: 0, resetAt: now + 3600000 });
      } else if (hourlyData.count >= config.maxPerHour) {
        return {
          allowed: false,
          reason: `Rate limit: ${messageType} exceeded ${config.maxPerHour}/hour`,
        };
      }
    }

    // 2. Check type-level throttle
    const lastTypeSent = this.typeLastSent.get(messageType) || 0;
    const typeElapsed = (now - lastTypeSent) / 1000;
    if (typeElapsed < config.typeThrottleSeconds) {
      return {
        allowed: false,
        reason: `Type throttle: ${messageType} sent ${typeElapsed.toFixed(0)}s ago (min: ${config.typeThrottleSeconds}s)`,
      };
    }

    // 3. Check content hash for identical messages
    const hash = forceKey || computeMessageHash(content);
    const cacheKey = `${messageType}:${hash}`;
    const existing = this.cache.get(cacheKey);
    
    if (existing) {
      const elapsed = (now - existing.timestamp) / 1000;
      if (elapsed < config.minIntervalSeconds) {
        return {
          allowed: false,
          reason: `Duplicate: identical ${messageType} sent ${elapsed.toFixed(0)}s ago (min: ${config.minIntervalSeconds}s)`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Mark a message as sent (call after successful send)
   */
  markSent(messageType: string, content: string, forceKey?: string): void {
    const now = Date.now();
    const hash = forceKey || computeMessageHash(content);
    const cacheKey = `${messageType}:${hash}`;

    // Update content cache
    const existing = this.cache.get(cacheKey);
    this.cache.set(cacheKey, {
      hash,
      timestamp: now,
      count: (existing?.count || 0) + 1,
    });

    // Update type last sent
    this.typeLastSent.set(messageType, now);

    // Update hourly counter
    const hourlyData = this.typeHourlyCount.get(messageType);
    if (!hourlyData || now >= hourlyData.resetAt) {
      this.typeHourlyCount.set(messageType, { count: 1, resetAt: now + 3600000 });
    } else {
      hourlyData.count++;
    }
  }

  /**
   * Check and mark in one call - returns whether message was allowed
   */
  checkAndMark(
    messageType: string,
    content: string,
    forceKey?: string
  ): { allowed: boolean; reason?: string } {
    const result = this.shouldSend(messageType, content, forceKey);
    if (result.allowed) {
      this.markSent(messageType, content, forceKey);
    }
    return result;
  }

  /**
   * Force reset throttle for a message type (useful after config changes)
   */
  resetThrottle(messageType: string): void {
    this.typeLastSent.delete(messageType);
    this.typeHourlyCount.delete(messageType);
    
    // Also clear content cache for this type
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${messageType}:`)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get stats for debugging
   */
  getStats(): {
    cacheSize: number;
    typeStats: Record<string, { lastSent: number | null; hourlyCount: number }>;
  } {
    const typeStats: Record<string, { lastSent: number | null; hourlyCount: number }> = {};
    
    for (const [type, ts] of this.typeLastSent) {
      typeStats[type] = {
        lastSent: ts,
        hourlyCount: this.typeHourlyCount.get(type)?.count || 0,
      };
    }

    return {
      cacheSize: this.cache.size,
      typeStats,
    };
  }

  /**
   * Compute hash for positions snapshot (for change detection)
   */
  computePositionsHash(positions: Array<{ lotId: string; pair: string; amount: number }>): string {
    const sortedIds = positions
      .map(p => `${p.lotId}:${p.pair}:${p.amount.toFixed(6)}`)
      .sort()
      .join("|");
    return computeMessageHash(sortedIds);
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    this.typeLastSent.clear();
    this.typeHourlyCount.clear();
  }
}

// Singleton instance
export const messageDeduplicator = new MessageDeduplicator();

// ============================================================
// PERSISTENT DB-BACKED LOGICAL FINGERPRINT DEDUPLICATION
// ============================================================

interface LogicalFingerprintInput {
  module: string;
  pair?: string;
  positionId?: string;
  decision?: string; // e.g., "SUPPRESSED", "EXECUTED", "THRESHOLD_HIT"
  suppressionReason?: string; // e.g., "fee-band", "min-profit"
  signals?: string[];
  score?: number;
  regime?: string;
  confirmation?: string;
  // PnL is excluded or rounded to avoid spam from small fluctuations
  pnlBand?: string; // e.g., "0.00-0.10", "0.10-0.20"
}

interface DedupeResult {
  allowed: boolean;
  reason?: string;
  suppressedCount?: number;
}

/**
 * Compute a logical fingerprint for SMART EXIT and similar events
 * Excludes exact PnL and timestamp to group similar events
 */
export function computeLogicalFingerprint(input: LogicalFingerprintInput): string {
  const parts = [
    input.module,
    input.pair || '*',
    input.positionId || '*',
    input.decision || '*',
    input.suppressionReason || '*',
    input.regime || '*',
    input.score !== undefined ? Math.floor(input.score) : '*',
    input.confirmation || '*',
    // Sort signals for consistent fingerprint
    input.signals ? [...input.signals].sort().join(',') : '*',
    // Use PnL band instead of exact value
    input.pnlBand || '*',
  ];
  
  return parts.join('|');
}

/**
 * Round PnL to band (0.10% increments) for fingerprint
 */
export function pnlToBand(pnlPct: number): string {
  const band = Math.floor(pnlPct * 10) / 10; // Round down to 0.10
  const nextBand = band + 0.1;
  return `${band.toFixed(2)}-${nextBand.toFixed(2)}`;
}

/**
 * TTL configuration for different event types (in minutes)
 */
const TTL_CONFIG: Record<string, number> = {
  SMART_EXIT_SUPPRESSED_FEE_BAND: 30,
  SMART_EXIT_SUPPRESSED_OTHER: 15,
  SMART_EXIT_ARMED: 10,
  SMART_EXIT_EXECUTED: 5,
  SMART_EXIT_THRESHOLD_HIT: 5,
  SMART_EXIT_REGIME_CHANGE: 10,
  TRADE_BUY: 1, // Almost no dedupe for real trades
  TRADE_SELL: 1,
  CRITICAL_ERROR: 5,
};

/**
 * Check if an alert should be sent based on persistent DB deduplication
 * This is atomic across multiple workers/processes
 */
export async function shouldSendAlertWithDedupe(
  input: LogicalFingerprintInput,
  ttlMinutes?: number
): Promise<DedupeResult> {
  const fingerprint = computeLogicalFingerprint(input);
  const ttl = ttlMinutes ?? TTL_CONFIG[input.module] ?? 15;
  
  try {
    // Check if fingerprint exists and is within TTL
    const result = await db.execute(sql`
      SELECT 
        last_sent_at,
        suppressed_count,
        NOW() as current_time
      FROM telegram_alert_dedupe
      WHERE fingerprint = ${fingerprint}
      FOR UPDATE
    `);
    
    if (result.rows.length > 0) {
      const row = result.rows[0] as any;
      const lastSent = new Date(row.last_sent_at as string | number | Date);
      const now = new Date(row.current_time as string | number | Date);
      const elapsedMinutes = (now.getTime() - lastSent.getTime()) / (1000 * 60);

      if (elapsedMinutes < ttl) {
        // Within TTL - suppress and increment counter
        await db.execute(sql`
          UPDATE telegram_alert_dedupe
          SET
            suppressed_count = suppressed_count + 1,
            updated_at = NOW(),
            last_payload_json = ${JSON.stringify(input)}::jsonb
          WHERE fingerprint = ${fingerprint}
        `);

        return {
          allowed: false,
          reason: `Suppressed by dedupe (within ${ttl}min TTL, elapsed ${elapsedMinutes.toFixed(1)}min)`,
          suppressedCount: ((row.suppressed_count as number) || 0) + 1,
        };
      }
      
      // TTL expired - allow send and reset
      await db.execute(sql`
        UPDATE telegram_alert_dedupe
        SET 
          last_sent_at = NOW(),
          suppressed_count = 0,
          updated_at = NOW(),
          last_payload_json = ${JSON.stringify(input)}::jsonb
        WHERE fingerprint = ${fingerprint}
      `);
      
      return { allowed: true };
    }
    
    // New fingerprint - insert and allow
    await db.execute(sql`
      INSERT INTO telegram_alert_dedupe (
        fingerprint,
        module,
        pair,
        position_id,
        last_sent_at,
        suppressed_count,
        first_suppressed_at,
        last_payload_json
      ) VALUES (
        ${fingerprint},
        ${input.module},
        ${input.pair || null},
        ${input.positionId || null},
        NOW(),
        0,
        NULL,
        ${JSON.stringify(input)}::jsonb
      )
    `);
    
    return { allowed: true };
    
  } catch (error: any) {
    log(`[telegram-dedupe] Error checking deduplication: ${error.message}`, 'telegram');
    // Fail open - allow send if dedupe fails
    return { allowed: true, reason: 'Dedupe check failed, allowing send' };
  }
}

/**
 * Cleanup old deduplication entries (call periodically)
 */
export async function cleanupOldDedupeEntries(): Promise<number> {
  try {
    const result = await db.execute(sql`
      SELECT cleanup_old_telegram_alert_dedupe() as deleted
    `);
    const row = result.rows[0] as any;
    const deleted = typeof row?.deleted === 'number' ? row.deleted : 0;
    if (deleted > 0) {
      log(`[telegram-dedupe] Cleaned ${deleted} old entries`, 'telegram');
    }
    return deleted;
  } catch (error: any) {
    log(`[telegram-dedupe] Error cleaning old entries: ${error.message}`, 'telegram');
    return 0;
  }
}
