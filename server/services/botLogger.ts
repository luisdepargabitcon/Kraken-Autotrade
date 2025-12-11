import { db } from "../db";
import { botEvents } from "@shared/schema";
import type { BotEvent, InsertBotEvent } from "@shared/schema";
import { desc } from "drizzle-orm";

export type LogLevel = "INFO" | "WARN" | "ERROR";

export type EventType = 
  | "TRADE_EXECUTED"
  | "TRADE_BLOCKED"
  | "TRADE_FAILED"
  | "DAILY_LIMIT_HIT"
  | "DAILY_LIMIT_RESET"
  | "BOT_STARTED"
  | "BOT_STOPPED"
  | "BOT_PAUSED"
  | "BOT_RESUMED"
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
  | "NONCE_ERROR"
  | "BALANCE_CHECK"
  | "SYSTEM_ERROR";

interface LogMeta {
  [key: string]: any;
}

interface MemoryEvent {
  timestamp: string;
  level: LogLevel;
  type: EventType;
  message: string;
  meta?: LogMeta;
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
    
    console.log(this.formatConsoleLog(level, type, message));
    if (meta) {
      console.log("  Meta:", JSON.stringify(meta, null, 2));
    }

    const event: MemoryEvent = { timestamp, level, type, message, meta };
    this.memoryEvents.unshift(event);
    if (this.memoryEvents.length > MAX_MEMORY_EVENTS) {
      this.memoryEvents.pop();
    }

    if (this.persistToDb) {
      try {
        await db.insert(botEvents).values({
          level,
          type,
          message,
          meta: meta ? JSON.stringify(meta) : null,
        });
      } catch (error) {
        console.error("[BotLogger] Error persisting event to DB:", error);
      }
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
