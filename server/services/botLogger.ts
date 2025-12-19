import { db } from "../db";
import { botEvents } from "@shared/schema";
import type { BotEvent, InsertBotEvent } from "@shared/schema";
import { desc } from "drizzle-orm";
import { eventsWs } from "./eventsWebSocket";
import { environment } from "./environment";

export type LogLevel = "INFO" | "WARN" | "ERROR";

export type EventType = 
  | "TRADE_EXECUTED"
  | "TRADE_BLOCKED"
  | "TRADE_FAILED"
  | "TRADE_ADJUSTED"
  | "TRADE_REJECTED_LOW_PROFIT"
  | "TRADE_SKIPPED"
  | "PAIR_COOLDOWN"
  | "DAILY_LIMIT_HIT"
  | "DAILY_LIMIT_RESET"
  | "BOT_STARTED"
  | "BOT_STOPPED"
  | "BOT_PAUSED"
  | "BOT_RESUMED"
  | "ENGINE_TICK"
  | "MARKET_SCAN_SUMMARY"
  | "KRAKEN_ERROR"
  | "KRAKEN_CONNECTED"
  | "TELEGRAM_ERROR"
  | "TELEGRAM_CONNECTED"
  | "SIGNAL_GENERATED"
  | "POSITION_OPENED"
  | "POSITION_CLOSED"
  | "STOP_LOSS_HIT"
  | "TAKE_PROFIT_HIT"
  | "TRAILING_STOP_HIT"
  | "ORPHAN_POSITION_CLEANED"
  | "NONCE_ERROR"
  | "BALANCE_CHECK"
  | "SYSTEM_ERROR"
  // SMART_GUARD events
  | "SG_EMERGENCY_STOPLOSS"
  | "SG_TP_FIXED"
  | "SG_BREAKEVEN_ACTIVATED"
  | "SG_TRAILING_ACTIVATED"
  | "SG_TRAILING_STOP_UPDATED"
  | "SG_STOP_HIT"
  | "SG_SCALE_OUT"
  | "SG_SCALE_OUT_EXECUTED"
  | "SG_BREAK_EVEN_ACTIVATED"
  // Config events
  | "CONFIG_OVERRIDE_UPDATED"
  // DRY_RUN mode
  | "DRY_RUN_TRADE"
  // TEST endpoint events
  | "TEST_TRADE_SIMULATED"
  | "TEST_POSITION_CREATED"
  // Manual close events
  | "MANUAL_CLOSE_INITIATED"
  | "MANUAL_CLOSE_SUCCESS"
  | "MANUAL_CLOSE_FAILED"
  | "MANUAL_CLOSE_EXCEPTION"
  | "MANUAL_CLOSE_DUST"
  | "ORPHAN_POSITION_DELETED";

interface LogMeta {
  [key: string]: any;
}

interface MemoryEvent {
  timestamp: string;
  level: LogLevel;
  type: EventType;
  message: string;
  meta?: LogMeta;
  env: string;
  instanceId: string;
}

const MAX_MEMORY_EVENTS = 100;

class BotLogger {
  private memoryEvents: MemoryEvent[] = [];
  private persistToDb: boolean = true;

  private formatConsoleLog(level: LogLevel, type: EventType, message: string): string {
    const timestamp = new Date().toISOString();
    const levelColor = level === "ERROR" ? "\x1b[31m" : level === "WARN" ? "\x1b[33m" : "\x1b[36m";
    const reset = "\x1b[0m";
    return `${levelColor}[${timestamp}] [${level}] [${type}]${reset} ${message}`;
  }

  private async log(level: LogLevel, type: EventType, message: string, meta?: LogMeta): Promise<void> {
    const timestamp = new Date().toISOString();
    const env = environment.envTag;
    const instanceId = environment.instanceId;
    
    console.log(this.formatConsoleLog(level, type, message));
    if (meta) {
      console.log("  Meta:", JSON.stringify(meta, null, 2));
    }

    const enrichedMeta = { ...meta, env, instanceId };
    const event: MemoryEvent = { timestamp, level, type, message, meta: enrichedMeta, env, instanceId };
    this.memoryEvents.unshift(event);
    if (this.memoryEvents.length > MAX_MEMORY_EVENTS) {
      this.memoryEvents.pop();
    }

    let insertedId: number | undefined;
    if (this.persistToDb) {
      try {
        const result = await db.insert(botEvents).values({
          level,
          type,
          message,
          meta: enrichedMeta ? JSON.stringify(enrichedMeta) : null,
        }).returning({ id: botEvents.id });
        insertedId = result[0]?.id;
      } catch (error) {
        console.error("[BotLogger] Error persisting event to DB:", error);
      }
    }

    try {
      eventsWs.broadcast({
        id: insertedId,
        timestamp,
        level,
        type,
        message,
        meta: enrichedMeta,
        env,
        instanceId,
      });
    } catch (error) {
      // Silently fail if WS not initialized yet
    }
  }

  async info(type: EventType, message: string, meta?: LogMeta): Promise<void> {
    await this.log("INFO", type, message, meta);
  }

  async warn(type: EventType, message: string, meta?: LogMeta): Promise<void> {
    await this.log("WARN", type, message, meta);
  }

  async error(type: EventType, message: string, meta?: LogMeta): Promise<void> {
    await this.log("ERROR", type, message, meta);
  }

  getMemoryEvents(limit: number = 50): MemoryEvent[] {
    return this.memoryEvents.slice(0, limit);
  }

  async getDbEvents(limit: number = 50): Promise<BotEvent[]> {
    try {
      return await db.select()
        .from(botEvents)
        .orderBy(desc(botEvents.timestamp))
        .limit(limit);
    } catch (error) {
      console.error("[BotLogger] Error fetching events from DB:", error);
      return [];
    }
  }

  setPersistToDb(persist: boolean): void {
    this.persistToDb = persist;
  }
}

export const botLogger = new BotLogger();
