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
  | "blocked_by_token_disabled"
  | "blocked_by_alert_rule_disabled"
  | "blocked_by_no_matching_channel"
  | "blocked_by_channel_mode_not_allowed"
  | "blocked_by_channel_alert_not_allowed"
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
  module?: "general" | "spot" | "idca" | "grid" | "fisco" | "system";
  deprecated?: boolean;
  aliasOf?: string;
  requiresConfirmation?: boolean;
}

// FASE I: Catálogo de comandos rehecho — nuevos comandos en inglés organizados
// por módulo, comandos legacy en español mantenidos como alias deprecated.
const COMMAND_DEFINITIONS: CommandDefinition[] = [
  // ── General ──────────────────────────────────────────────
  { name: "/help", permission: "read_only", description: "Lista de comandos disponibles", module: "general" },
  { name: "/status", permission: "read_only", description: "Estado general del bot", module: "general" },
  { name: "/health", permission: "read_only", description: "Estado de salud del sistema (sin secretos)", module: "general" },
  { name: "/version", permission: "read_only", description: "Versión y commit actual desplegado", module: "general" },
  { name: "/uptime", permission: "read_only", description: "Tiempo activo del bot", module: "general" },
  { name: "/last_alerts", permission: "read_only", description: "Últimas alertas enviadas", module: "general" },
  { name: "/telegram_status", permission: "read_only", description: "Estado global Telegram (kill switch, canales activos)", module: "general" },

  // ── SPOT ─────────────────────────────────────────────────
  { name: "/spot_status", permission: "read_only", description: "Estado del trading SPOT activo", module: "spot" },
  { name: "/spot_positions", permission: "read_only", description: "Posiciones SPOT abiertas", module: "spot" },
  { name: "/spot_dryrun_status", permission: "read_only", description: "Estado del modo Dry Run", module: "spot" },

  // ── IDCA ─────────────────────────────────────────────────
  { name: "/idca_status", permission: "read_only", description: "Estado general de IDCA", module: "idca" },
  { name: "/idca_cycles", permission: "read_only", description: "Ciclos IDCA (activos e históricos)", module: "idca" },
  { name: "/idca_active", permission: "read_only", description: "Ciclos IDCA activos actualmente", module: "idca" },
  { name: "/idca_summary", permission: "read_only", description: "Resumen P&L y capital IDCA", module: "idca" },

  // ── Grid ─────────────────────────────────────────────────
  { name: "/grid_status", permission: "read_only", description: "Estado del sistema Grid/Hybrid", module: "grid" },
  { name: "/grid_observer", permission: "read_only", description: "Estado del Grid Observer (modo simulado)", module: "grid" },
  { name: "/grid_cycles", permission: "read_only", description: "Ciclos Grid observados", module: "grid" },
  { name: "/grid_proposals", permission: "read_only", description: "Propuestas asistidas de Grid pendientes", module: "grid" },

  // ── Fiscalidad ───────────────────────────────────────────
  { name: "/fisco_status", permission: "read_only", description: "Estado de sincronización fiscal", module: "fisco" },
  { name: "/informe_fiscal", permission: "action", description: "Generar informe fiscal", module: "fisco", requiresConfirmation: true },

  // ── Sistema ──────────────────────────────────────────────
  { name: "/errors", permission: "read_only", description: "Errores recientes del sistema", module: "system" },
  { name: "/audit", permission: "read_only", description: "Diagnóstico telegram:audit", module: "system" },
  { name: "/commands", permission: "read_only", description: "Catálogo de comandos disponibles", module: "system" },

  // ── Acciones con permiso (requieren confirmación) ────────
  { name: "/pause_bot", permission: "action", description: "Pausar el bot completo", module: "system", requiresConfirmation: true },
  { name: "/resume_bot", permission: "action", description: "Reanudar el bot completo", module: "system", requiresConfirmation: true },
  { name: "/spot_pause", permission: "action", description: "Pausar trading SPOT", module: "spot", requiresConfirmation: true },
  { name: "/spot_resume", permission: "action", description: "Reanudar trading SPOT", module: "spot", requiresConfirmation: true },
  { name: "/idca_pause", permission: "action", description: "Pausar módulo IDCA", module: "idca", requiresConfirmation: true },
  { name: "/idca_resume", permission: "action", description: "Reanudar módulo IDCA", module: "idca", requiresConfirmation: true },
  { name: "/grid_pause", permission: "action", description: "Pausar módulo Grid", module: "grid", requiresConfirmation: true },
  { name: "/grid_resume", permission: "action", description: "Reanudar módulo Grid", module: "grid", requiresConfirmation: true },
  { name: "/telegram_mute", permission: "admin", description: "Activar modo silencioso Telegram", module: "system", requiresConfirmation: true },
  { name: "/telegram_unmute", permission: "admin", description: "Desactivar modo silencioso Telegram", module: "system", requiresConfirmation: true },
  { name: "/refresh_commands", permission: "admin", description: "Admin: refrescar catálogo de comandos", module: "system" },

  // ── Legacy (español) — mantenidos como alias deprecated ──
  { name: "/estado", permission: "read_only", description: "Legacy. Nuevo comando recomendado: /status", module: "general", deprecated: true, aliasOf: "/status" },
  { name: "/pausar", permission: "action", description: "Legacy. Nuevo comando recomendado: /pause_bot", module: "system", deprecated: true, aliasOf: "/pause_bot", requiresConfirmation: true },
  { name: "/reanudar", permission: "action", description: "Legacy. Nuevo comando recomendado: /resume_bot", module: "system", deprecated: true, aliasOf: "/resume_bot", requiresConfirmation: true },
  { name: "/ultimas", permission: "read_only", description: "Legacy. Nuevo comando recomendado: /last_alerts", module: "general", deprecated: true, aliasOf: "/last_alerts" },
  { name: "/ayuda", permission: "read_only", description: "Legacy. Nuevo comando recomendado: /help", module: "general", deprecated: true, aliasOf: "/help" },
  { name: "/balance", permission: "read_only", description: "Legacy. Balance exchanges", module: "general", deprecated: true },
  { name: "/config", permission: "read_only", description: "Legacy. Configuración riesgo", module: "general", deprecated: true },
  { name: "/exposicion", permission: "read_only", description: "Legacy. Exposición actual", module: "general", deprecated: true },
  { name: "/menu", permission: "read_only", description: "Legacy. Menú inline", module: "general", deprecated: true },
  { name: "/channels", permission: "read_only", description: "Legacy. Nuevo comando recomendado: /telegram_status", module: "general", deprecated: true, aliasOf: "/telegram_status" },
  { name: "/cartera", permission: "read_only", description: "Legacy. Nuevo comando recomendado: /idca_summary", module: "idca", deprecated: true, aliasOf: "/idca_summary" },
  { name: "/logs", permission: "read_only", description: "Legacy. Nuevo comando recomendado: /errors", module: "system", deprecated: true, aliasOf: "/errors" },
  { name: "/posiciones", permission: "read_only", description: "Legacy. Nuevo comando recomendado: /spot_positions", module: "spot", deprecated: true, aliasOf: "/spot_positions" },
  { name: "/ganancias", permission: "read_only", description: "Legacy. Nuevo comando recomendado: /idca_summary", module: "idca", deprecated: true, aliasOf: "/idca_summary" },
  { name: "/fiscal", permission: "action", description: "Legacy. Nuevo comando recomendado: /informe_fiscal", module: "fisco", deprecated: true, aliasOf: "/informe_fiscal", requiresConfirmation: true },
  { name: "/reporte", permission: "action", description: "Legacy. Nuevo comando recomendado: /informe_fiscal", module: "fisco", deprecated: true, aliasOf: "/informe_fiscal", requiresConfirmation: true },
  { name: "/impuestos", permission: "action", description: "Legacy. Nuevo comando recomendado: /informe_fiscal", module: "fisco", deprecated: true, aliasOf: "/informe_fiscal", requiresConfirmation: true },
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

    // 5. Alert rule lookup (mode + alertType)
    const alertCategory = alert.alertCategory || this.inferCategory(alert.mode, alert.alertType);
    const rule = await this.getAlertRule(alert.mode, alert.alertType);

    // 5a. If alert rule exists and is disabled, block
    if (rule && !rule.enabled) {
      await this.audit(alert, "blocked_by_alert_rule_disabled", env, `rule_id:${rule.id}`);
      log(`[TelegramNC] BLOCKED by alert rule disabled: ${alert.mode}/${alert.alertType} rule_id=${rule.id}`, "trading");
      return "blocked_by_alert_rule_disabled";
    }

    // 6. Dedupe
    if (!alert.skipDedupe) {
      const dedupeKey = alert.dedupeKey || this.buildDedupeKey(alert);
      if (this.isDeduped(dedupeKey, config?.telegramDefaultDedupeMinutes || 5)) {
        await this.audit(alert, "blocked_by_dedupe", env, undefined, dedupeKey);
        log(`[TelegramNC] BLOCKED by dedupe: ${dedupeKey}`, "trading");
        return "blocked_by_dedupe";
      }
    }

    // 7. Rate limit
    if (!alert.skipRateLimit) {
      const rateLimitKey = `${alert.sourceModule}:${alert.mode}`;
      if (this.isRateLimited(rateLimitKey, config?.telegramDefaultRateLimitPerHour || 30)) {
        await this.audit(alert, "blocked_by_rate_limit", env);
        log(`[TelegramNC] BLOCKED by rate limit: ${rateLimitKey}`, "trading");
        return "blocked_by_rate_limit";
      }
    }

    // 8. Get all chats (not just active — we need to check isActive in routing)
    const allChats = await storage.getTelegramChats();
    const activeChats = allChats.filter(c => c.isActive);
    if (activeChats.length === 0) {
      await this.audit(alert, "blocked_by_missing_channel", env);
      log(`[TelegramNC] BLOCKED no active channels: ${alert.sourceModule}/${alert.alertType}`, "trading");
      return "blocked_by_missing_channel";
    }

    // 9. Resolve channel using routing: rule.channelId → compatible → default
    const targetChat = this.resolveChannelForAlert(allChats, alert.mode, alertCategory, rule);
    if (!targetChat) {
      await this.audit(alert, "blocked_by_no_matching_channel", env, `mode:${alert.mode},category:${alertCategory}`);
      log(`[TelegramNC] BLOCKED no matching channel for mode=${alert.mode} category=${alertCategory}`, "trading");
      return "blocked_by_no_matching_channel";
    }

    // 10. Validate channel allows this mode
    if (!this.isChannelAllowedForMode(targetChat, alert.mode)) {
      await this.audit(alert, "blocked_by_channel_mode_not_allowed", env, `mode:${alert.mode},chat:${targetChat.chatId}`, undefined, targetChat.chatId, targetChat.id);
      log(`[TelegramNC] BLOCKED channel ${targetChat.chatId} does not allow mode ${alert.mode}`, "trading");
      return "blocked_by_channel_mode_not_allowed";
    }

    // 11. Validate channel allows this alert category
    if (!this.isChannelAllowedForAlert(targetChat, alertCategory)) {
      await this.audit(alert, "blocked_by_channel_alert_not_allowed", env, `category:${alertCategory},chat:${targetChat.chatId}`, undefined, targetChat.chatId, targetChat.id);
      log(`[TelegramNC] BLOCKED channel ${targetChat.chatId} does not allow alert ${alertCategory}`, "trading");
      return "blocked_by_channel_alert_not_allowed";
    }

    // 12. Also check legacy shouldSendToChat for backward compat
    const alertSubtype = alert.alertSubtype || alert.alertType;
    if (!this.shouldSendToChat(targetChat, alertCategory, alertSubtype)) {
      await this.audit(alert, "blocked_by_channel_disabled", env, `shouldSendToChat:false,category:${alertCategory}`, undefined, targetChat.chatId, targetChat.id);
      log(`[TelegramNC] BLOCKED shouldSendToChat false for ${targetChat.chatId} category=${alertCategory}`, "trading");
      return "blocked_by_channel_disabled";
    }

    // 13. Resolve token: rule.tokenId → chat.tokenId → default token
    const token = await this.resolveTokenForChannel(targetChat, rule);
    if (!token) {
      await this.audit(alert, "blocked_by_missing_token", env, `no_token_for_chat:${targetChat.chatId}`, undefined, targetChat.chatId, targetChat.id);
      log(`[TelegramNC] BLOCKED no active token for chat ${targetChat.chatId}`, "trading");
      return "blocked_by_missing_token";
    }

    // 14. Validate token is active
    if (!token.isActive) {
      await this.audit(alert, "blocked_by_token_disabled", env, `token_id:${token.id}`, undefined, targetChat.chatId, targetChat.id, token.id);
      log(`[TelegramNC] BLOCKED token ${token.id} is disabled`, "trading");
      return "blocked_by_token_disabled";
    }

    // 15. Send via telegram service
    const { telegramService } = await import("./telegram");
    if (!telegramService.isInitialized()) {
      await this.audit(alert, "blocked_by_missing_token", env, "telegram_service_not_initialized", undefined, targetChat.chatId, targetChat.id, token.id);
      log(`[TelegramNC] BLOCKED telegram service not initialized`, "trading");
      return "blocked_by_missing_token";
    }

    let anySent = false;
    let lastError = "";
    try {
      const sent = await telegramService.sendToChat(targetChat.chatId, alert.message, { parseMode: "HTML" });
      if (sent) {
        anySent = true;
        await this.audit(alert, "sent", env, undefined, undefined, targetChat.chatId, targetChat.id, token.id);
      } else {
        lastError = "sendToChat returned false";
      }
    } catch (err: any) {
      lastError = err?.message || String(err);
      console.error(`[TelegramNC] Failed to send to chat ${targetChat.chatId}:`, lastError);
    }

    if (!anySent) {
      await this.audit(alert, "failed_send", env, lastError, undefined, targetChat.chatId, targetChat.id, token.id);
      return "failed_send";
    }

    // 16. Mark dedupe + rate limit
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

    // Resolve token for this chat
    const token = await this.resolveTokenForChannel(chat, null);
    if (!token) {
      await this.audit(alert, "blocked_by_missing_token", env, `no_token_for_chat:${chatId}`, undefined, chatId, chat.id);
      log(`[TelegramNC] BLOCKED no active token for chat ${chatId}`, "trading");
      return "blocked_by_missing_token";
    }

    if (!token.isActive) {
      await this.audit(alert, "blocked_by_token_disabled", env, `token_id:${token.id}`, undefined, chatId, chat.id, token.id);
      log(`[TelegramNC] BLOCKED token ${token.id} is disabled`, "trading");
      return "blocked_by_token_disabled";
    }

    const { telegramService } = await import("./telegram");
    if (!telegramService.isInitialized()) {
      await this.audit(alert, "blocked_by_missing_token", env, "telegram_service_not_initialized", undefined, chatId, chat.id, token.id);
      return "blocked_by_missing_token";
    }

    try {
      const sent = await telegramService.sendToChat(chatId, alert.message, { parseMode: "HTML" });
      if (sent) {
        await this.audit(alert, "sent", env, undefined, undefined, chatId, chat.id, token.id);
        return "sent";
      } else {
        await this.audit(alert, "failed_send", env, "sendToChat returned false", undefined, chatId, chat.id, token.id);
        return "failed_send";
      }
    } catch (err: any) {
      await this.audit(alert, "failed_send", env, err?.message || String(err), undefined, chatId, chat.id, token.id);
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

  // ─── FASE 6: Routing helpers ───────────────────────────────

  private mapModeToEnabledMode(mode: AlertMode): string {
    const modeMap: Record<string, string> = {
      spot: "trading",
      spot_dry_run: "trading",
      idca: "idca",
      idca_hybrid: "idca",
      smart_exit: "smart_exit",
      fisco: "fiscal",
      system: "system",
      ai: "trading",
    };
    return modeMap[mode] || mode;
  }

  private isChannelAllowedForMode(chat: any, mode: AlertMode): boolean {
    const enabledModes = chat.enabledModes as string[] | null;
    if (!enabledModes || enabledModes.length === 0) return true;
    const mappedMode = this.mapModeToEnabledMode(mode);
    return enabledModes.includes(mappedMode);
  }

  private isChannelAllowedForAlert(chat: any, alertCategory: string): boolean {
    const enabledAlerts = chat.enabledAlerts as string[] | null;
    if (!enabledAlerts || enabledAlerts.length === 0) return true;
    return enabledAlerts.includes(alertCategory);
  }

  private async getAlertRule(mode: AlertMode, alertType: string): Promise<any | null> {
    try {
      const rules = await storage.getTelegramAlertRules();
      const mappedMode = this.mapModeToEnabledMode(mode);
      return rules.find(r => r.mode === mappedMode && r.alertType === alertType) || null;
    } catch {
      return null;
    }
  }

  private resolveChannelForAlert(
    chats: any[],
    mode: AlertMode,
    alertCategory: string,
    rule: any | null,
  ): any | null {
    // 1. If rule specifies a chatId (channel), find that specific channel
    if (rule?.chatId) {
      const specific = chats.find(c => c.id === rule.chatId && c.isActive);
      if (specific) return specific;
    }

    // 2. Find active channels that allow this mode and alert category
    const compatible = chats.filter(c =>
      c.isActive &&
      this.isChannelAllowedForMode(c, mode) &&
      this.isChannelAllowedForAlert(c, alertCategory)
    );

    if (compatible.length > 0) {
      // Prefer default channel
      const defaultChan = compatible.find(c => c.isDefault);
      return defaultChan || compatible[0];
    }

    // 3. Fallback: any active default channel
    const defaultChan = chats.find(c => c.isActive && c.isDefault);
    if (defaultChan) return defaultChan;

    return null;
  }

  private async resolveTokenForChannel(chat: any, rule: any | null): Promise<any | null> {
    // 1. Use channel's token_id
    if (chat.tokenId) {
      const token = await storage.getTelegramBotTokenById(chat.tokenId);
      if (token && token.isActive) return token;
    }

    // 2. Fallback: default active token
    const defaultToken = await storage.getDefaultTelegramBotToken();
    if (defaultToken && defaultToken.isActive) return defaultToken;

    return null;
  }

  private async audit(
    alert: NormalizedAlert,
    status: AlertStatus,
    env: string,
    blockReason?: string,
    dedupeKey?: string,
    chatId?: string,
    channelId?: number,
    tokenId?: number,
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
        tokenId: tokenId || null,
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
