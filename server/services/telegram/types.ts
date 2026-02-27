/**
 * Telegram Message Types with Zod Validation
 * Anti-placeholder validation - ensures no null/undefined/'-' values
 */
import { z } from "zod";

// ============================================================
// CONSTANTS
// ============================================================
export const BOT_CANONICAL_NAME = "CHESTER BOT";
export const EXCHANGES = ["Kraken", "RevolutX"] as const;
export type ExchangeName = typeof EXCHANGES[number];

// ============================================================
// HELPER SCHEMAS - Anti-placeholder validation
// ============================================================

// String that cannot be null, undefined, empty, or placeholder
const safeString = z.string().min(1).refine(
  (val) => val !== "-" && val !== "null" && val !== "undefined" && val.trim() !== "",
  { message: "Value cannot be a placeholder (-), null, undefined, or empty" }
);

// Optional string with fallback reason
const optionalWithReason = (fieldName: string) => z.union([
  safeString,
  z.literal(`N/D (${fieldName} no disponible)`),
]);

// Number that is finite
const safeNumber = z.number().finite();

// Positive number
const positiveNumber = z.number().min(0).finite();

// ============================================================
// BASE CONTEXT SCHEMAS
// ============================================================

export const ConnectionStatusSchema = z.object({
  kraken: z.boolean(),
  revolutx: z.boolean(),
  db: z.boolean(),
  telegram: z.boolean(),
});
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

export const SyncStatusSchema = z.object({
  exchange: z.enum(EXCHANGES),
  lastSyncAt: z.date().nullable(),
  ageSeconds: z.number().nullable(),
});
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

// ============================================================
// DAILY REPORT CONTEXT
// ============================================================
export const DailyReportContextSchema = z.object({
  env: safeString,
  timestamp: z.date(),
  
  // Connections
  connections: ConnectionStatusSchema,
  
  // System resources
  system: z.object({
    cpu: safeString,
    mem: safeString,
    memWarning: z.boolean().default(false),
    disk: safeString,
    uptime: safeString,
  }),
  
  // Bot config
  bot: z.object({
    dryRun: z.boolean(),
    mode: safeString, // SMART_GUARD, SINGLE, etc.
    strategy: safeString,
    pairs: z.array(safeString),
  }),
  
  // Portfolio - Confirmed positions
  portfolio: z.object({
    positionCount: z.number().int().min(0),
    exposureUsd: positiveNumber,
    positions: z.array(z.object({
      pair: safeString,
      exchange: z.enum(EXCHANGES),
      lotId: safeString,
      entryPrice: positiveNumber,
      amount: positiveNumber,
      exposureUsd: positiveNumber,
    })).default([]),
  }),
  
  // Pending orders
  pendingOrders: z.object({
    count: z.number().int().min(0),
    orders: z.array(z.object({
      exchange: z.enum(EXCHANGES),
      pair: safeString,
      side: z.enum(["BUY", "SELL"]),
      orderId: safeString,
      createdAt: z.date().optional(),
    })).default([]),
  }),
  
  // Sync status per exchange
  syncStatus: z.array(SyncStatusSchema),
});
export type DailyReportContext = z.infer<typeof DailyReportContextSchema>;

// ============================================================
// TRADE BUY CONTEXT
// ============================================================
export const TradeBuyContextSchema = z.object({
  env: safeString,
  exchange: z.enum(EXCHANGES),
  pair: safeString,
  amount: safeString,
  price: safeString,
  total: safeString,
  orderId: safeString,
  clientOrderId: safeString.optional(),
  lotId: safeString.optional(),
  strategyLabel: safeString,
  confPct: safeString,
  reason: safeString,
  signalsSummary: safeString.optional(),
  mode: safeString,
  regime: safeString.optional(),
  regimeReason: safeString.optional(),
  routerStrategy: safeString.optional(),
  timestamp: z.date().default(() => new Date()),
});
export type TradeBuyContext = z.infer<typeof TradeBuyContextSchema>;

// ============================================================
// TRADE SELL CONTEXT
// ============================================================
export const TradeSellContextSchema = z.object({
  env: safeString,
  exchange: z.enum(EXCHANGES),
  pair: safeString,
  amount: safeString,
  price: safeString,
  total: safeString,
  orderId: safeString,
  clientOrderId: safeString.optional(),
  lotId: safeString.optional(),
  exitType: safeString, // SL, TP, TRAILING, MANUAL, SIGNAL
  trigger: safeString.optional(),
  pnlUsd: z.number().nullable(),
  pnlPct: z.number().nullable(),
  feeUsd: z.number().nullable().optional(),
  strategyLabel: safeString,
  confPct: safeString,
  reason: safeString,
  mode: safeString,
  openedAt: z.date().nullable().optional(),
  holdDuration: safeString.optional(),
  timestamp: z.date().default(() => new Date()),
});
export type TradeSellContext = z.infer<typeof TradeSellContextSchema>;

// ============================================================
// BOT STARTED CONTEXT
// ============================================================
export const BotStartedContextSchema = z.object({
  env: safeString,
  strategy: safeString,
  risk: safeString,
  pairs: z.array(safeString),
  balanceUsd: safeString,
  mode: safeString,
  positionCount: z.number().int().min(0),
  routerEnabled: z.boolean().default(false),
  exchanges: z.array(z.enum(EXCHANGES)),
  timestamp: z.date().default(() => new Date()),
});
export type BotStartedContext = z.infer<typeof BotStartedContextSchema>;

// ============================================================
// HEARTBEAT CONTEXT
// ============================================================
export const HeartbeatContextSchema = z.object({
  env: safeString,
  cpu: safeString,
  mem: safeString,
  disk: safeString,
  uptime: safeString,
  connections: ConnectionStatusSchema,
  timestamp: z.date().default(() => new Date()),
});
export type HeartbeatContext = z.infer<typeof HeartbeatContextSchema>;

// ============================================================
// POSITIONS UPDATE CONTEXT (with hash for deduplication)
// ============================================================
export const PositionsUpdateContextSchema = z.object({
  env: safeString,
  positions: z.array(z.object({
    pair: safeString,
    exchange: z.enum(EXCHANGES),
    lotId: safeString,
    entryPrice: positiveNumber,
    amount: positiveNumber,
    currentPrice: positiveNumber.optional(),
    pnlUsd: z.number().optional(),
    pnlPct: z.number().optional(),
    beActivated: z.boolean().default(false),
    trailingActivated: z.boolean().default(false),
    openedAt: z.date().nullable(),
  })),
  totalExposureUsd: positiveNumber,
  timestamp: z.date().default(() => new Date()),
});
export type PositionsUpdateContext = z.infer<typeof PositionsUpdateContextSchema>;

// ============================================================
// ENTRY INTENT CONTEXT
// ============================================================
export const EntryIntentContextSchema = z.object({
  env: safeString,
  exchange: z.enum(EXCHANGES),
  pair: safeString,
  amountUsd: safeString,
  price: safeString,
  strategyLabel: safeString,
  signalReason: safeString,
  confidence: z.number().min(0).max(100),
  regime: safeString.optional(),
  regimeReason: safeString.optional(),
  requiredSignals: z.number().int().optional(),
  currentSignals: z.number().int().optional(),
  timestamp: z.date().default(() => new Date()),
});
export type EntryIntentContext = z.infer<typeof EntryIntentContextSchema>;

// ============================================================
// TELEGRAM COMMANDS DEFINITION
// ============================================================
export const TELEGRAM_COMMANDS = [
  { command: "estado", description: "Ver estado del bot y conexiones" },
  { command: "balance", description: "Ver balance por exchange" },
  { command: "cartera", description: "Ver cartera valorada en USD" },
  { command: "posiciones", description: "Ver posiciones abiertas con P&L" },
  { command: "ganancias", description: "Ver ganancias (24h, semana, total)" },
  { command: "exposicion", description: "Ver exposición por par" },
  { command: "ultimas", description: "Ver últimas operaciones" },
  { command: "logs", description: "Ver logs recientes" },
  { command: "config", description: "Ver configuración de riesgo" },
  { command: "uptime", description: "Ver tiempo encendido" },
  { command: "menu", description: "Menú interactivo con botones" },
  { command: "channels", description: "Configurar alertas por chat" },
  { command: "pausar", description: "Pausar el bot" },
  { command: "reanudar", description: "Activar el bot" },
  { command: "informe_fiscal", description: "Generar y enviar informe fiscal" },
  { command: "fiscal", description: "Alias de /informe_fiscal" },
  { command: "reporte", description: "Alias de /informe_fiscal" },
  { command: "impuestos", description: "Alias de /informe_fiscal" },
  { command: "ayuda", description: "Ver lista de comandos" },
  { command: "refresh_commands", description: "[Admin] Actualizar comandos en Telegram" },
] as const;

export type TelegramCommand = typeof TELEGRAM_COMMANDS[number]["command"];

// ============================================================
// MESSAGE HASH FOR DEDUPLICATION
// ============================================================
export function computeMessageHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// ============================================================
// VALIDATION HELPER
// ============================================================
export function validateContext<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  contextName: string
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`[telegram] Invalid ${contextName} context:`, result.error.format());
    throw new Error(`Invalid ${contextName} context: ${result.error.message}`);
  }
  return result.data;
}

// Safe parse that fills in N/D values instead of throwing
export function safeValidateContext<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  contextName: string
): { success: true; data: T } | { success: false; error: string; partialData: Partial<T> } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  console.warn(`[telegram] Partial ${contextName} context - some fields invalid:`, result.error.format());
  return {
    success: false,
    error: result.error.message,
    partialData: data as Partial<T>,
  };
}
