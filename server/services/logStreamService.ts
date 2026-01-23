import { serverLogsService } from "./serverLogsService";

type LogLevel = "log" | "info" | "warn" | "error" | "debug";

interface LogEntry {
  id: number;
  timestamp: Date;
  level: LogLevel;
  message: string;
  source: string;
}

type LogListener = (entry: LogEntry) => void;

class LogStreamService {
  private buffer: LogEntry[] = [];
  private maxBufferSize = 500;
  private listeners: Set<LogListener> = new Set();
  private idCounter = 0;
  private originalConsole: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  };
  private initialized = false;

  constructor() {
    this.originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console),
    };
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    console.log = (...args: any[]) => {
      this.originalConsole.log(...args);
      this.addEntry("log", args, "console");
    };

    console.info = (...args: any[]) => {
      this.originalConsole.info(...args);
      this.addEntry("info", args, "console");
    };

    console.warn = (...args: any[]) => {
      this.originalConsole.warn(...args);
      this.addEntry("warn", args, "console");
    };

    console.error = (...args: any[]) => {
      this.originalConsole.error(...args);
      this.addEntry("error", args, "console");
    };

    console.debug = (...args: any[]) => {
      this.originalConsole.debug(...args);
      this.addEntry("debug", args, "console");
    };

    this.addEntry("info", ["[LogStreamService] Inicializado - capturando logs de aplicación"], "system");
  }

  private addEntry(level: LogLevel, args: any[], source: string): void {
    const message = args
      .map(arg => {
        if (typeof arg === "string") return arg;
        try {
          return JSON.stringify(arg, null, 0);
        } catch {
          return String(arg);
        }
      })
      .join(" ");

    const entry: LogEntry = {
      id: ++this.idCounter,
      timestamp: new Date(),
      level,
      message,
      source,
    };

    this.buffer.push(entry);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }

    // CENTRALIZED PERSISTENCE: Persist log to DB once here, not per-client
    const time = entry.timestamp.toISOString().slice(11, 23);
    const levelTag = entry.level.toUpperCase().padEnd(5);
    const line = `[${time}] [${levelTag}] ${entry.message}`;
    const isError = entry.level === "error" || entry.level === "warn";
    serverLogsService.persistLog("app_stdout", line, isError);

    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (e) {
        this.originalConsole.error("[LogStreamService] Error en listener:", e);
      }
    }
  }

  addLog(level: LogLevel, message: string, source: string = "app"): void {
    this.addEntry(level, [message], source);
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getHistory(): LogEntry[] {
    return [...this.buffer];
  }

  getHistoryFormatted(): string[] {
    return this.buffer.map(entry => {
      const time = entry.timestamp.toISOString().slice(11, 23);
      const levelTag = entry.level.toUpperCase().padEnd(5);
      return `[${time}] [${levelTag}] ${entry.message}`;
    });
  }

  clear(): void {
    this.buffer = [];
  }

  get bufferSize(): number {
    return this.buffer.length;
  }
}

export const logStreamService = new LogStreamService();
