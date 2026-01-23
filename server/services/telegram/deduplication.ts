/**
 * Telegram Message Deduplication
 * Prevents duplicate/spam messages via hash and throttle
 */
import { computeMessageHash } from "./types";

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
