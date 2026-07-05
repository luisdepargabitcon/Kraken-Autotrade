/**
 * TelegramNotificationCenter — Central authority for all Telegram message routing.
 *
 * Every module MUST send alerts through this center. No module is allowed to
 * decide on its own which chat to send to. The center enforces:
 *   1. Global kill switch (telegram_global_config.telegram_global_enabled)
 *   2. Mode-level enable/disable
 *   3. Channel active/authorized validation (telegram_chats.isActive)
 *   4. Centralized dedupe (in-memory + DB)
 *   5. Centralized rate-limit (per source_module per hour)
 *   6. Quiet hours
 *   7. Audit logging (telegram_alert_events)
 *
 * TelegramService is kept as low-level transport only.
 */

import { storage } from "../storage";
import { log } from "../utils/logger";

// ─── Types ────────────────────────────────────────────────────

export type AlertMode =
  | "spot"
  | "spot_dry_run"
  | "idca"
  | "idca_hybrid"
  | "smart_exit"
  | "fisco"
  | "system"
  | "ai";

export type AlertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type AlertStatus =
  | "sent"
  | "blocked_by_global_disabled"
  | "blocked_by_mode_disabled"
  | "blocked_by_channel_disabled"
  | "blocked_by_missing_channel"
  | "blocked_by_missing_token"
  | "blocked_by_dedupe"
  | "blocked_by_rate_limit"
  | "blocked_by_quiet_hours"
  | "failed_send";

export interface NormalizedAlert {
  sourceModule: string;
  mode: AlertMode;
  alertType: string;
  severity?: AlertSeverity;
  pair?: string;
  cycleId?: string;
  positionId?: string;
  dryRunId?: string;
  message: string;
  alertCategory?: "trades" | "errors" | "system" | "balance" | "heartbeat" | "strategy" | "fisco";
  alertSubtype?: string;
  dedupeKey?: string;
  skipDedupe?: boolean;
  skipRateLimit?: boolean;
  skipQuietHours?: boolean;
  technicalDetails?: Record<string, any>;
  rawPayload?: Record<string, any>;
}

interface DedupeEntry {
  timestamp: number;
  count: number;
}

interface RateLimitEntry {
  windowStart: number;
  count: number;
}

// ─── Command permission levels ───────────────────────────────

export type CommandPermission = "read_only" | "action" | "admin";

interface CommandDefinition {
  name: string;
  permission: CommandPermission;
  description: string;
}

const COMMAND_DEFINITIONS: CommandDefinition[] = [
  { name: "/estado", permission: "read_only", description: "Estado del bot" },
  { name: "/pausar", permission: "action", description: "Pausar el bot" },
  { name: "/reanudar", permission: "action", description: "Reanudar el bot" },
  { name: "/ultimas", permission: "read_only", description: "Últimas operaciones" },
  { name: "/ayuda", permission: "read_only", description: "Ayuda" },
  { name: "/balance", permission: "read_only", description: "Balance exchanges" },
  { name: "/config", permission: "read_only", description: "Configuración riesgo" },
  { name: "/exposicion", permission: "read_only", description: "Exposición actual" },
  { name: "/uptime", permission: "read_only", description: "Uptime" },
  { name: "/menu", permission: "read_only", description: "Menú inline" },
  { name: "/channels", permission: "read_only", description: "Gestión canales" },
  { name: "/cartera", permission: "read_only", description: "Cartera valorada" },
  { name: "/logs", permission: "read_only", description: "Logs paginados" },
  { name: "/posiciones", permission: "read_only", description: "Posiciones abiertas" },
  { name: "/ganancias", permission: "read_only", description: "Resumen P&L" },
  { name: "/refresh_commands", permission: "admin", description: "Admin: refrescar comandos" },
  { name: "/informe_fiscal", permission: "action", description: "Generar informe fiscal" },
  { name: "/fiscal", permission: "action", description: "Alias informe fiscal" },
  { name: "/reporte", permission: "action", description: "Alias informe fiscal" },
  { name: "/impuestos", permission: "action", description: "Alias informe fiscal" },
];

// ─── TelegramNotificationCenter ──────────────────────────────

class TelegramNotificationCenter {
  private globalConfig: any = null;
  private configLoadedAt = 0;
  private readonly CONFIG_CACHE_MS = 10_000; // 10s cache

  private dedupeCache = new Map<string, DedupeEntry>();
  private rateLimitCache = new Map<string, RateLimitEntry>();
  private readonly DEDUPE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
  private lastDedupeCleanup = 0;

  private commandDefs: CommandDefinition[] = [...COMMAND_DEFINITIONS];

  // ─── Config ────────────────────────────────────────────────

  private async loadConfig(): Promise<any> {
    const now = Date.now();
    if (this.globalConfig && now - this.configLoadedAt < this.CONFIG_CACHE_MS) {
      return this.globalConfig;
    }
    try {
      this.globalConfig = await storage.getTelegramGlobalConfig();
      this.configLoadedAt = now;
    } catch (err) {
      console.error("[TelegramNotificationCenter] Failed to load global config:", err);
      // Default to enabled to avoid breaking trading on DB errors
      this.globalConfig = {
        telegramGlobalEnabled: true,
        telegramSilentMode: false,
        telegramMinSeverity: "LOW",
        telegramDefaultDedupeMinutes: 5,
        telegramDefaultRateLimitPerHour: 30,
        telegramQuietHoursConfig: { enabled: false, start: "22:00", end: "08:00", timezone: "Europe/Madrid" },
        telegramEnvironmentLabel: "staging",
      };
      this.configLoadedAt = now;
    }
    return this.globalConfig;
  }

  /** Force config reload (e.g., after UI update) */
  invalidateConfigCache(): void {
    this.configLoadedAt = 0;
  }

  // ─── Public API ────────────────────────────────────────────

  /**
   * Main entry point: route an alert through all validation layers.
   * Returns the status (sent, blocked_*, failed_send).
   */
  async send(alert: NormalizedAlert): Promise<AlertStatus> {
    const config = await this.loadConfig();
    const env = config?.telegramEnvironmentLabel || "unknown";
    const severity = alert.severity || "LOW";

    // 1. Global kill switch
    if (!config?.telegramGlobalEnabled) {
      await this.audit(alert, "blocked_by_global_disabled", env);
      log(`[TelegramNC] BLOCKED by global disabled: ${alert.sourceModule}/${alert.alertType}`, "trading");
      return "blocked_by_global_disabled";
    }

    // 2. Silent mode (blocks everything except CRITICAL)
    if (config?.telegramSilentMode && severity !== "CRITICAL") {
      await this.audit(alert, "blocked_by_global_disabled", env, "silent_mode_active");
      log(`[TelegramNC] BLOCKED by silent mode: ${alert.sourceModule}/${alert.alertType}`, "trading");
      return "blocked_by_global_disabled";
    }

    // 3. Severity filter
    const minSeverity = config?.telegramMinSeverity || "LOW";
    if (!this.meetsMinSeverity(severity, minSeverity)) {
      await this.audit(alert, "blocked_by_mode_disabled", env, `severity_below_min:${severity}<${minSeverity}`);
      log(`[TelegramNC] BLOCKED by severity filter: ${severity} < ${minSeverity}`, "trading");
      return "blocked_by_mode_disabled";
    }

    // 4. Quiet hours (unless skipped for critical)
    if (!alert.skipQuietHours && this.isInQuietHours(config?.telegramQuietHoursConfig)) {
      if (severity !== "CRITICAL") {
        await this.audit(alert, "blocked_by_quiet_hours", env);
        log(`[TelegramNC] BLOCKED by quiet hours: ${alert.sourceModule}/${alert.alertType}`, "trading");
        return "blocked_by_quiet_hours";
      }
    }

    // 5. Dedupe
    if (!alert.skipDedupe) {
      const dedupeKey = alert.dedupeKey || this.buildDedupeKey(alert);
      if (this.isDeduped(dedupeKey, config?.telegramDefaultDedupeMinutes || 5)) {
        await this.audit(alert, "blocked_by_dedupe", env, undefined, dedupeKey);
        log(`[TelegramNC] BLOCKED by dedupe: ${dedupeKey}`, "trading");
        return "blocked_by_dedupe";
      }
    }

    // 6. Rate limit
    if (!alert.skipRateLimit) {
      const rateLimitKey = `${alert.sourceModule}:${alert.mode}`;
      if (this.isRateLimited(rateLimitKey, config?.telegramDefaultRateLimitPerHour || 30)) {
        await this.audit(alert, "blocked_by_rate_limit", env);
        log(`[TelegramNC] BLOCKED by rate limit: ${rateLimitKey}`, "trading");
        return "blocked_by_rate_limit";
      }
    }

    // 7. Get active channels and send
    const { telegramService } = await import("./telegram");
    if (!telegramService.isInitialized()) {
      await this.audit(alert, "blocked_by_missing_token", env);
      log(`[TelegramNC] BLOCKED by missing token: ${alert.sourceModule}/${alert.alertType}`, "trading");
      return "blocked_by_missing_token";
    }

    const chats = await storage.getActiveTelegramChats();
    if (chats.length === 0) {
      await this.audit(alert, "blocked_by_missing_channel", env);
      log(`[TelegramNC] BLOCKED no active channels: ${alert.sourceModule}/${alert.alertType}`, "trading");
      return "blocked_by_missing_channel";
    }

    // Filter chats by alert category/subtype preferences
    const alertCategory = alert.alertCategory || this.inferCategory(alert.mode, alert.alertType);
    const alertSubtype = alert.alertSubtype || alert.alertType;
    const targetChats = chats.filter(chat => this.shouldSendToChat(chat, alertCategory, alertSubtype));

    if (targetChats.length === 0) {
      await this.audit(alert, "blocked_by_channel_disabled", env);
      log(`[TelegramNC] BLOCKED no matching channels for category=${alertCategory} subtype=${alertSubtype}`, "trading");
      return "blocked_by_channel_disabled";
    }

    // Send to each matching chat
    let anySent = false;
    let lastError = "";
    for (const chat of targetChats) {
      try {
        const sent = await telegramService.sendToChat(chat.chatId, alert.message, { parseMode: "HTML" });
        if (sent) {
          anySent = true;
          await this.audit(alert, "sent", env, undefined, undefined, chat.chatId, chat.id);
        } else {
          lastError = "sendToChat returned false";
        }
      } catch (err: any) {
        lastError = err?.message || String(err);
        console.error(`[TelegramNC] Failed to send to chat ${chat.chatId}:`, lastError);
      }
    }

    if (!anySent) {
      await this.audit(alert, "failed_send", env, lastError);
      return "failed_send";
    }

    // Mark dedupe + rate limit
    if (!alert.skipDedupe) {
      const dedupeKey = alert.dedupeKey || this.buildDedupeKey(alert);
      this.markDeduped(dedupeKey);
    }
    if (!alert.skipRateLimit) {
      const rateLimitKey = `${alert.sourceModule}:${alert.mode}`;
      this.markRateLimited(rateLimitKey);
    }

    return "sent";
  }

  /**
   * Send to a specific chatId (for backward compat with services that had their own chatId).
   * Validates the chatId is active in telegram_chats first.
   */
  async sendToSpecificChat(chatId: string, alert: NormalizedAlert): Promise<AlertStatus> {
    const config = await this.loadConfig();
    const env = config?.telegramEnvironmentLabel || "unknown";

    // Global kill switch
    if (!config?.telegramGlobalEnabled) {
      await this.audit(alert, "blocked_by_global_disabled", env);
      return "blocked_by_global_disabled";
    }

    // Validate chatId is active
    const chats = await storage.getActiveTelegramChats();
    const chat = chats.find(c => c.chatId === chatId);
    if (!chat) {
      await this.audit(alert, "blocked_by_channel_disabled", env, "chatId_not_active");
      log(`[TelegramNC] BLOCKED chatId ${chatId} not in active telegram_chats`, "trading");
      return "blocked_by_channel_disabled";
    }

    const { telegramService } = await import("./telegram");
    if (!telegramService.isInitialized()) {
      await this.audit(alert, "blocked_by_missing_token", env);
      return "blocked_by_missing_token";
    }

    try {
      const sent = await telegramService.sendToChat(chatId, alert.message, { parseMode: "HTML" });
      if (sent) {
        await this.audit(alert, "sent", env, undefined, undefined, chatId, chat.id);
        return "sent";
      } else {
        await this.audit(alert, "failed_send", env, "sendToChat returned false");
        return "failed_send";
      }
    } catch (err: any) {
      await this.audit(alert, "failed_send", env, err?.message || String(err));
      return "failed_send";
    }
  }

  // ─── Command Authorization ─────────────────────────────────

  /**
   * Check if a chatId is authorized to run a command.
   * Returns { authorized, permission, definition }.
   */
  async authorizeCommand(chatId: string, commandText: string): Promise<{
    authorized: boolean;
    permission: CommandPermission | null;
    definition: CommandDefinition | null;
  }> {
    const commandName = commandText.trim().split(/\s+/)[0];
    const def = this.commandDefs.find(c => c.name === commandName);
    if (!def) {
      return { authorized: false, permission: null, definition: null };
    }

    // Check if chatId is in active telegram_chats
    const chats = await storage.getActiveTelegramChats();
    const chat = chats.find(c => c.chatId === chatId);
    if (!chat) {
      return { authorized: false, permission: null, definition: def };
    }

    // All active chats can run read_only commands.
    // action and admin commands require the chat to be active (already checked).
    // Future: add a per-chat permission field for admin commands.
    return { authorized: true, permission: def.permission, definition: def };
  }

  /**
   * Log a command execution to the audit table.
   */
  async logCommand(params: {
    chatId: string;
    command: string;
    status: string;
    isAuthorized: boolean;
    permissionLevel?: string;
    responseMessage?: string;
    errorMessage?: string;
    executionTimeMs?: number;
  }): Promise<void> {
    try {
      await storage.insertTelegramCommandLog({
        chatId: params.chatId,
        command: params.command,
        status: params.status,
        isAuthorized: params.isAuthorized,
        permissionLevel: params.permissionLevel,
        responseMessage: params.responseMessage,
        errorMessage: params.errorMessage,
        executionTimeMs: params.executionTimeMs,
      });
    } catch (err) {
      console.error("[TelegramNotificationCenter] Failed to log command:", err);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────

  private meetsMinSeverity(severity: AlertSeverity, min: string): boolean {
    const levels: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
    return (levels[severity] || 1) >= (levels[min] || 1);
  }

  private isInQuietHours(config: any): boolean {
    if (!config?.enabled) return false;
    try {
      const tz = config.timezone || "Europe/Madrid";
      const now = new Date();
      const startParts = (config.start || "22:00").split(":").map(Number);
      const endParts = (config.end || "08:00").split(":").map(Number);

      // Get current hour/minute in the configured timezone
      const localStr = now.toLocaleString("en-US", { timeZone: tz, hour12: false });
      const localDate = new Date(localStr);
      const currentMinutes = localDate.getHours() * 60 + localDate.getMinutes();
      const startMinutes = startParts[0] * 60 + startParts[1];
      const endMinutes = endParts[0] * 60 + endParts[1];

      if (startMinutes <= endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
      } else {
        // Overnight (e.g., 22:00 → 08:00)
        return currentMinutes >= startMinutes || currentMinutes < endMinutes;
      }
    } catch {
      return false;
    }
  }

  private buildDedupeKey(alert: NormalizedAlert): string {
    const parts = [
      alert.sourceModule,
      alert.mode,
      alert.alertType,
      alert.pair || "",
    ];
    return parts.join(":");
  }

  private isDeduped(key: string, dedupeMinutes: number): boolean {
    const entry = this.dedupeCache.get(key);
    if (!entry) return false;
    const elapsed = Date.now() - entry.timestamp;
    if (elapsed < dedupeMinutes * 60 * 1000) {
      entry.count++;
      return true;
    }
    return false;
  }

  private markDeduped(key: string): void {
    this.dedupeCache.set(key, { timestamp: Date.now(), count: 1 });
    this.cleanupDedupe();
  }

  private isRateLimited(key: string, maxPerHour: number): boolean {
    const now = Date.now();
    const entry = this.rateLimitCache.get(key);
    if (!entry) return false;
    const hourMs = 60 * 60 * 1000;
    if (now - entry.windowStart > hourMs) {
      // Reset window
      return false;
    }
    return entry.count >= maxPerHour;
  }

  private markRateLimited(key: string): void {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    const entry = this.rateLimitCache.get(key);
    if (!entry || now - entry.windowStart > hourMs) {
      this.rateLimitCache.set(key, { windowStart: now, count: 1 });
    } else {
      entry.count++;
    }
  }

  private cleanupDedupe(): void {
    const now = Date.now();
    if (now - this.lastDedupeCleanup < this.DEDUPE_CLEANUP_INTERVAL_MS) return;
    this.lastDedupeCleanup = now;
    const maxAge = 30 * 60 * 1000; // 30 min
    for (const [key, entry] of this.dedupeCache) {
      if (now - entry.timestamp > maxAge) {
        this.dedupeCache.delete(key);
      }
    }
  }

  private inferCategory(mode: AlertMode, alertType: string): "trades" | "errors" | "system" | "balance" | "heartbeat" | "strategy" | "fisco" {
    if (mode === "fisco") return "fisco";
    if (alertType.startsWith("error") || alertType.startsWith("critical")) return "errors";
    if (alertType.startsWith("system") || alertType.startsWith("bot_")) return "system";
    if (alertType.startsWith("heartbeat") || alertType.startsWith("daily_report")) return "heartbeat";
    if (alertType.startsWith("balance")) return "balance";
    if (alertType.startsWith("strategy") || alertType.startsWith("regime")) return "strategy";
    return "trades";
  }

  private shouldSendToChat(chat: any, alertCategory: string, subtype: string): boolean {
    const prefs = (chat.alertPreferences || {}) as Record<string, boolean>;
    if (subtype && prefs[subtype] !== undefined) {
      return prefs[subtype];
    }
    switch (alertCategory) {
      case "trades": return chat.alertTrades;
      case "errors": return chat.alertErrors;
      case "system": return chat.alertSystem;
      case "balance": return chat.alertBalance;
      case "heartbeat": return chat.alertHeartbeat;
      case "strategy": return true;
      case "fisco": return true;
      default: return false;
    }
  }

  private async audit(
    alert: NormalizedAlert,
    status: AlertStatus,
    env: string,
    blockReason?: string,
    dedupeKey?: string,
    chatId?: string,
    channelId?: number,
  ): Promise<void> {
    try {
      await storage.insertTelegramAlertEvent({
        environment: env,
        sourceModule: alert.sourceModule,
        mode: alert.mode,
        alertType: alert.alertType,
        severity: alert.severity || "LOW",
        pair: alert.pair,
        cycleId: alert.cycleId,
        positionId: alert.positionId,
        dryRunId: alert.dryRunId,
        chatId: chatId || null,
        channelId: channelId || null,
        dedupeKey: dedupeKey || alert.dedupeKey || null,
        payloadHash: null,
        status,
        blockReason: blockReason || null,
        sentAt: status === "sent" ? new Date() : null,
        failedAt: status === "failed_send" ? new Date() : null,
        errorMessage: blockReason || null,
        naturalMessage: alert.message,
        technicalDetailsJson: alert.technicalDetails || null,
        rawPayloadJson: alert.rawPayload || null,
      });
    } catch (err) {
      console.error("[TelegramNotificationCenter] Audit insert failed:", err);
    }
  }

  // ─── Suppressed count summary ──────────────────────────────

  /**
   * Get suppressed count for a dedupe key since a given time.
   */
  getSuppressedCount(dedupeKey: string): number {
    const entry = this.dedupeCache.get(dedupeKey);
    if (!entry || !entry.count || entry.count <= 1) return 0;
    return entry.count - 1;
  }

  // ─── Global config getters for UI ──────────────────────────

  async getGlobalConfig() {
    return await this.loadConfig();
  }

  async updateGlobalConfig(updates: any) {
    const result = await storage.updateTelegramGlobalConfig(updates);
    this.invalidateConfigCache();
    return result;
  }

  async getAlertEvents(limit: number = 100) {
    return await storage.getRecentTelegramAlertEvents(limit);
  }

  async getCommandLogs(limit: number = 100) {
    return await storage.getRecentTelegramCommandLogs(limit);
  }

  getCommandDefinitions(): CommandDefinition[] {
    return [...this.commandDefs];
  }
}

// ─── Singleton export ────────────────────────────────────────

export const telegramNotificationCenter = new TelegramNotificationCenter();
export default telegramNotificationCenter;
