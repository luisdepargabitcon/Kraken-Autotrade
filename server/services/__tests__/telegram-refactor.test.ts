/**
 * Tests for FASE A — Telegram Refactor
 *
 * Tests cover:
 *   A1: Global kill switch (telegram_global_config)
 *   A2: No phantom fallbacks to this.chatId
 *   A3: Active/inactive channel validation
 *   A4: FISCO dual-path eliminated
 *   A5: IDCA chat authorization
 *   A6: ErrorAlertService HTML escaping + no fallback instance
 *   A7: Command authorization
 *   A8: Audit table inserts
 *   A9: Centralized dedupe/rate-limit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock storage — vi.hoisted ensures variables are available when vi.mock factory runs
const {
  mockGetTelegramGlobalConfig,
  mockGetActiveTelegramChats,
  mockGetTelegramChats,
  mockInsertTelegramAlertEvent,
  mockInsertTelegramCommandLog,
  mockUpdateTelegramGlobalConfig,
  mockGetRecentTelegramAlertEvents,
  mockGetRecentTelegramCommandLogs,
  mockGetTelegramAlertRules,
  mockGetTelegramBotTokenById,
  mockGetDefaultTelegramBotToken,
} = vi.hoisted(() => ({
  mockGetTelegramGlobalConfig: vi.fn(),
  mockGetActiveTelegramChats: vi.fn(),
  mockGetTelegramChats: vi.fn(),
  mockInsertTelegramAlertEvent: vi.fn(),
  mockInsertTelegramCommandLog: vi.fn(),
  mockUpdateTelegramGlobalConfig: vi.fn(),
  mockGetRecentTelegramAlertEvents: vi.fn(),
  mockGetRecentTelegramCommandLogs: vi.fn(),
  mockGetTelegramAlertRules: vi.fn(),
  mockGetTelegramBotTokenById: vi.fn(),
  mockGetDefaultTelegramBotToken: vi.fn(),
}));

vi.mock("../../storage", () => ({
  storage: {
    getTelegramGlobalConfig: mockGetTelegramGlobalConfig,
    getActiveTelegramChats: mockGetActiveTelegramChats,
    getTelegramChats: mockGetTelegramChats,
    insertTelegramAlertEvent: mockInsertTelegramAlertEvent,
    insertTelegramCommandLog: mockInsertTelegramCommandLog,
    updateTelegramGlobalConfig: mockUpdateTelegramGlobalConfig,
    getRecentTelegramAlertEvents: mockGetRecentTelegramAlertEvents,
    getRecentTelegramCommandLogs: mockGetRecentTelegramCommandLogs,
    getTelegramAlertRules: mockGetTelegramAlertRules,
    getTelegramBotTokenById: mockGetTelegramBotTokenById,
    getDefaultTelegramBotToken: mockGetDefaultTelegramBotToken,
  },
}));

// Mock logger
vi.mock("../../utils/logger", () => ({
  log: vi.fn(),
}));

// Mock telegram service (dynamic import inside TelegramNotificationCenter)
vi.mock("../telegram", () => ({
  telegramService: {
    isInitialized: vi.fn(() => true),
    sendToChat: vi.fn(() => Promise.resolve(true)),
    sendAlertWithSubtype: vi.fn(() => Promise.resolve()),
  },
}));

import { telegramNotificationCenter } from "../TelegramNotificationCenter";

describe("FASE A — Telegram Refactor Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: global enabled, 2 active chats
    mockGetTelegramGlobalConfig.mockResolvedValue({
      telegramGlobalEnabled: true,
      telegramSilentMode: false,
      telegramMinSeverity: "LOW",
      telegramDefaultDedupeMinutes: 5,
      telegramDefaultRateLimitPerHour: 30,
      telegramQuietHoursConfig: { enabled: false, start: "22:00", end: "08:00", timezone: "Europe/Madrid" },
      telegramEnvironmentLabel: "test",
    });
    mockGetActiveTelegramChats.mockResolvedValue([
      { id: 1, chatId: "-100123", name: "Main", isActive: true, isDefault: true, alertTrades: true, alertErrors: true, alertSystem: true, alertBalance: true, alertHeartbeat: true, alertPreferences: {}, enabledModes: null, enabledAlerts: null, tokenId: null },
      { id: 2, chatId: "-100456", name: "Trades", isActive: true, isDefault: false, alertTrades: true, alertErrors: false, alertSystem: false, alertBalance: false, alertHeartbeat: false, alertPreferences: {}, enabledModes: null, enabledAlerts: null, tokenId: null },
    ]);
    mockGetTelegramChats.mockResolvedValue([
      { id: 1, chatId: "-100123", name: "Main", isActive: true, isDefault: true, alertTrades: true, alertErrors: true, alertSystem: true, alertBalance: true, alertHeartbeat: true, alertPreferences: {}, enabledModes: null, enabledAlerts: null, tokenId: null },
      { id: 2, chatId: "-100456", name: "Trades", isActive: true, isDefault: false, alertTrades: true, alertErrors: false, alertSystem: false, alertBalance: false, alertHeartbeat: false, alertPreferences: {}, enabledModes: null, enabledAlerts: null, tokenId: null },
    ]);
    mockGetTelegramAlertRules.mockResolvedValue([]);
    mockGetDefaultTelegramBotToken.mockResolvedValue({ id: 1, isActive: true, name: "default", tokenLast4: "1234" });
    mockGetTelegramBotTokenById.mockResolvedValue(undefined);
    mockInsertTelegramAlertEvent.mockResolvedValue(undefined);
    mockInsertTelegramCommandLog.mockResolvedValue(undefined);
    telegramNotificationCenter.invalidateConfigCache();
    // Clear dedupe and rate-limit caches between tests
    (telegramNotificationCenter as any).dedupeCache.clear();
    (telegramNotificationCenter as any).rateLimitCache.clear();
  });

  // ── A1: Kill switch ──────────────────────────────────────────

  describe("A1: Global kill switch", () => {
    it("blocks all alerts when telegramGlobalEnabled is false", async () => {
      mockGetTelegramGlobalConfig.mockResolvedValue({
        telegramGlobalEnabled: false,
        telegramSilentMode: false,
        telegramMinSeverity: "LOW",
        telegramDefaultDedupeMinutes: 5,
        telegramDefaultRateLimitPerHour: 30,
        telegramQuietHoursConfig: { enabled: false },
        telegramEnvironmentLabel: "test",
      });

      const status = await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Test message",
      });

      expect(status).toBe("blocked_by_global_disabled");
      expect(mockInsertTelegramAlertEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: "blocked_by_global_disabled" }),
      );
    });

    it("allows alerts when telegramGlobalEnabled is true", async () => {
      const status = await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Test message",
        alertCategory: "trades",
      });

      expect(status).toBe("sent");
    });

    it("blocks non-CRITICAL alerts in silent mode", async () => {
      mockGetTelegramGlobalConfig.mockResolvedValue({
        telegramGlobalEnabled: true,
        telegramSilentMode: true,
        telegramMinSeverity: "LOW",
        telegramDefaultDedupeMinutes: 5,
        telegramDefaultRateLimitPerHour: 30,
        telegramQuietHoursConfig: { enabled: false },
        telegramEnvironmentLabel: "test",
      });

      const status = await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Test",
        severity: "LOW",
      });

      expect(status).toBe("blocked_by_global_disabled");
    });

    it("allows CRITICAL alerts in silent mode", async () => {
      mockGetTelegramGlobalConfig.mockResolvedValue({
        telegramGlobalEnabled: true,
        telegramSilentMode: true,
        telegramMinSeverity: "LOW",
        telegramDefaultDedupeMinutes: 5,
        telegramDefaultRateLimitPerHour: 30,
        telegramQuietHoursConfig: { enabled: false },
        telegramEnvironmentLabel: "test",
      });

      const status = await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "critical_error",
        message: "Critical!",
        severity: "CRITICAL",
        alertCategory: "errors",
        skipDedupe: true,
        skipRateLimit: true,
      });

      expect(status).toBe("sent");
    });
  });

  // ── A2: No phantom fallbacks ─────────────────────────────────

  describe("A2: No phantom fallbacks", () => {
    it("does not send when no active chats exist", async () => {
      mockGetActiveTelegramChats.mockResolvedValue([]);
      mockGetTelegramChats.mockResolvedValue([]);

      const status = await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Test",
      });

      expect(status).toBe("blocked_by_missing_channel");
      expect(mockInsertTelegramAlertEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: "blocked_by_missing_channel" }),
      );
    });

    it("does not send to specific chatId if not in active telegram_chats", async () => {
      const status = await telegramNotificationCenter.sendToSpecificChat("-999999", {
        sourceModule: "test",
        mode: "fisco",
        alertType: "sync_complete",
        message: "Test FISCO",
      });

      expect(status).toBe("blocked_by_channel_disabled");
    });
  });

  // ── FASE G: Legacy import as inactive channel ────────────────

  describe("FASE G: Legacy channel imported as inactive requires review", () => {
    it("does not send to a legacy channel imported as inactive, and audits blocked_by_channel_disabled", async () => {
      // getActiveTelegramChats only returns ACTIVE chats — an imported-but-inactive
      // legacy channel must NOT appear here, simulating the real DB behavior.
      mockGetActiveTelegramChats.mockResolvedValue([
        { id: 1, chatId: "-100123", name: "Main", isActive: true, alertTrades: true, alertErrors: true, alertSystem: true, alertBalance: true, alertHeartbeat: true, alertPreferences: {} },
      ]);

      const legacyChatId = "-1002639300934"; // Legacy API Config chatId (imported inactive)
      const status = await telegramNotificationCenter.sendToSpecificChat(legacyChatId, {
        sourceModule: "test",
        mode: "system",
        alertType: "error_api",
        message: "Should not be delivered — legacy channel pending review",
      });

      expect(status).toBe("blocked_by_channel_disabled");
      expect(mockInsertTelegramAlertEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: "blocked_by_channel_disabled" }),
      );
    });
  });

  // ── A3: Active/inactive channel validation ──────────────────

  describe("A3: Channel validation", () => {
    it("sends to active chats matching alert category", async () => {
      const { telegramService } = await import("../telegram");
      const sendSpy = vi.spyOn(telegramService, "sendToChat");

      await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Buy!",
        alertCategory: "trades",
      });

      // FASE 6 routing: resolves to a single target chat (default channel)
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith("-100123", "Buy!", { parseMode: "HTML" });
    });

    it("does not send to chat with alertErrors=false for error alerts", async () => {
      const { telegramService } = await import("../telegram");
      const sendSpy = vi.spyOn(telegramService, "sendToChat");

      await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "error_api",
        message: "Error!",
        alertCategory: "errors",
      });

      // Only chat 1 has alertErrors=true, chat 2 has alertErrors=false
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith("-100123", "Error!", { parseMode: "HTML" });
    });
  });

  // ── A7: Command authorization ───────────────────────────────

  describe("A7: Command authorization", () => {
    it("authorizes command from active chat", async () => {
      const result = await telegramNotificationCenter.authorizeCommand("-100123", "/estado");
      expect(result.authorized).toBe(true);
      expect(result.permission).toBe("read_only");
    });

    it("rejects command from unauthorized chat", async () => {
      const result = await telegramNotificationCenter.authorizeCommand("-999999", "/estado");
      expect(result.authorized).toBe(false);
    });

    it("rejects unknown command", async () => {
      const result = await telegramNotificationCenter.authorizeCommand("-100123", "/unknown");
      expect(result.authorized).toBe(false);
      expect(result.definition).toBe(null);
    });

    it("classifies /pausar as action permission", async () => {
      const result = await telegramNotificationCenter.authorizeCommand("-100123", "/pausar");
      expect(result.authorized).toBe(true);
      expect(result.permission).toBe("action");
    });

    it("classifies /refresh_commands as admin permission", async () => {
      const result = await telegramNotificationCenter.authorizeCommand("-100123", "/refresh_commands");
      expect(result.authorized).toBe(true);
      expect(result.permission).toBe("admin");
    });

    // ── FASE I: Catálogo de comandos rehecho ──────────────────
    it("/grid_status exists in the command catalog", () => {
      const defs = telegramNotificationCenter.getCommandDefinitions();
      const gridStatus = defs.find(c => c.name === "/grid_status");
      expect(gridStatus).toBeDefined();
      expect(gridStatus?.module).toBe("grid");
    });

    it("/idca_status exists in the command catalog", () => {
      const defs = telegramNotificationCenter.getCommandDefinitions();
      const idcaStatus = defs.find(c => c.name === "/idca_status");
      expect(idcaStatus).toBeDefined();
      expect(idcaStatus?.module).toBe("idca");
    });

    it("/telegram_status exists as read_only general command", () => {
      const defs = telegramNotificationCenter.getCommandDefinitions();
      const cmd = defs.find(c => c.name === "/telegram_status");
      expect(cmd).toBeDefined();
      expect(cmd?.permission).toBe("read_only");
    });

    it("legacy command /estado is marked deprecated with alias to /status", () => {
      const defs = telegramNotificationCenter.getCommandDefinitions();
      const legacy = defs.find(c => c.name === "/estado");
      expect(legacy?.deprecated).toBe(true);
      expect(legacy?.aliasOf).toBe("/status");
      expect(legacy?.description).toContain("/status");
    });

    it("dangerous action commands require confirmation", () => {
      const defs = telegramNotificationCenter.getCommandDefinitions();
      const pauseBot = defs.find(c => c.name === "/pause_bot");
      const telegramMute = defs.find(c => c.name === "/telegram_mute");
      expect(pauseBot?.requiresConfirmation).toBe(true);
      expect(pauseBot?.permission).toBe("action");
      expect(telegramMute?.requiresConfirmation).toBe(true);
      expect(telegramMute?.permission).toBe("admin");
    });

    it("read-only commands do not require confirmation", () => {
      const defs = telegramNotificationCenter.getCommandDefinitions();
      const readOnlyCmds = defs.filter(c => c.permission === "read_only");
      for (const cmd of readOnlyCmds) {
        expect(cmd.requiresConfirmation).toBeFalsy();
      }
    });

    it("logs command execution", async () => {
      await telegramNotificationCenter.logCommand({
        chatId: "-100123",
        command: "/estado",
        status: "executed",
        isAuthorized: true,
        permissionLevel: "read_only",
        executionTimeMs: 42,
      });

      expect(mockInsertTelegramCommandLog).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: "-100123",
          command: "/estado",
          status: "executed",
          isAuthorized: true,
          permissionLevel: "read_only",
          executionTimeMs: 42,
        }),
      );
    });
  });

  // ── A8: Audit table ─────────────────────────────────────────

  describe("A8: Audit table inserts", () => {
    it("inserts audit event on sent status", async () => {
      await telegramNotificationCenter.send({
        sourceModule: "tradingEngine",
        mode: "spot",
        alertType: "trade_buy",
        message: "Buy executed",
        pair: "BTC/USD",
        alertCategory: "trades",
      });

      expect(mockInsertTelegramAlertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "sent",
          sourceModule: "tradingEngine",
          alertType: "trade_buy",
          pair: "BTC/USD",
        }),
      );
    });

    it("inserts audit event on blocked status with block reason", async () => {
      mockGetActiveTelegramChats.mockResolvedValue([]);
      mockGetTelegramChats.mockResolvedValue([]);

      await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Test",
      });

      expect(mockInsertTelegramAlertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "blocked_by_missing_channel",
        }),
      );
    });
  });

  // ── A9: Dedupe / rate-limit ─────────────────────────────────

  describe("A9: Centralized dedupe", () => {
    it("blocks duplicate alerts within dedupe window", async () => {
      // First send should succeed
      const status1 = await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Buy!",
        pair: "BTC/USD",
        alertCategory: "trades",
      });
      expect(status1).toBe("sent");

      // Second send with same key should be deduped
      const status2 = await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Buy!",
        pair: "BTC/USD",
        alertCategory: "trades",
      });
      expect(status2).toBe("blocked_by_dedupe");
    });

    it("allows alerts with skipDedupe=true", async () => {
      const status1 = await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "critical",
        message: "Critical!",
        pair: "BTC/USD",
        alertCategory: "errors",
        skipDedupe: true,
      });

      const status2 = await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "critical",
        message: "Critical!",
        pair: "BTC/USD",
        alertCategory: "errors",
        skipDedupe: true,
      });

      expect(status1).toBe("sent");
      expect(status2).toBe("sent");
    });
  });

  // ── Severity filter ─────────────────────────────────────────

  describe("Severity filter", () => {
    it("blocks LOW severity when min is HIGH", async () => {
      mockGetTelegramGlobalConfig.mockResolvedValue({
        telegramGlobalEnabled: true,
        telegramSilentMode: false,
        telegramMinSeverity: "HIGH",
        telegramDefaultDedupeMinutes: 5,
        telegramDefaultRateLimitPerHour: 30,
        telegramQuietHoursConfig: { enabled: false },
        telegramEnvironmentLabel: "test",
      });

      const status = await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Low sev",
        severity: "LOW",
      });

      expect(status).toBe("blocked_by_mode_disabled");
    });
  });

  // ── FASE 6: Routing central token → canal → modo → alerta ────

  describe("FASE 6: Routing central", () => {
    it("blocks when alert rule is disabled", async () => {
      mockGetTelegramAlertRules.mockResolvedValue([
        { id: 10, mode: "trading", alertType: "trade_buy", enabled: false, chatId: 1 },
      ]);

      const status = await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Test",
        alertCategory: "trades",
      });

      expect(status).toBe("blocked_by_alert_rule_disabled");
      expect(mockInsertTelegramAlertEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: "blocked_by_alert_rule_disabled" }),
      );
    });

    it("routes to rule-specified channel when alert rule has chatId", async () => {
      const { telegramService } = await import("../telegram");
      const sendSpy = vi.spyOn(telegramService, "sendToChat");

      mockGetTelegramAlertRules.mockResolvedValue([
        { id: 10, mode: "trading", alertType: "trade_buy", enabled: true, chatId: 2 },
      ]);

      await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Routed!",
        alertCategory: "trades",
      });

      // Should route to chat id=2 (Trades channel), not id=1 (Main)
      expect(sendSpy).toHaveBeenCalledWith("-100456", "Routed!", { parseMode: "HTML" });
    });

    it("blocks when channel does not allow mode", async () => {
      mockGetTelegramChats.mockResolvedValue([
        { id: 1, chatId: "-100123", name: "Main", isActive: true, isDefault: true, alertTrades: true, alertErrors: true, alertSystem: true, alertBalance: true, alertHeartbeat: true, alertPreferences: {}, enabledModes: ["idca"], enabledAlerts: null, tokenId: null },
      ]);
      mockGetActiveTelegramChats.mockResolvedValue([
        { id: 1, chatId: "-100123", name: "Main", isActive: true, isDefault: true, alertTrades: true, alertErrors: true, alertSystem: true, alertBalance: true, alertHeartbeat: true, alertPreferences: {}, enabledModes: ["idca"], enabledAlerts: null, tokenId: null },
      ]);

      const status = await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Test",
        alertCategory: "trades",
      });

      expect(status).toBe("blocked_by_channel_mode_not_allowed");
    });

    it("blocks when channel does not allow alert category", async () => {
      mockGetTelegramChats.mockResolvedValue([
        { id: 1, chatId: "-100123", name: "Main", isActive: true, isDefault: true, alertTrades: true, alertErrors: true, alertSystem: true, alertBalance: true, alertHeartbeat: true, alertPreferences: {}, enabledModes: null, enabledAlerts: ["trades"], tokenId: null },
      ]);
      mockGetActiveTelegramChats.mockResolvedValue([
        { id: 1, chatId: "-100123", name: "Main", isActive: true, isDefault: true, alertTrades: true, alertErrors: true, alertSystem: true, alertBalance: true, alertHeartbeat: true, alertPreferences: {}, enabledModes: null, enabledAlerts: ["trades"], tokenId: null },
      ]);

      const status = await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "error_api",
        message: "Error",
        alertCategory: "errors",
      });

      expect(status).toBe("blocked_by_channel_alert_not_allowed");
    });

    it("blocks when no token available for channel", async () => {
      mockGetDefaultTelegramBotToken.mockResolvedValue(undefined);
      mockGetTelegramBotTokenById.mockResolvedValue(undefined);

      const status = await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Test",
        alertCategory: "trades",
      });

      expect(status).toBe("blocked_by_missing_token");
    });

    it("blocks when token is disabled", async () => {
      mockGetDefaultTelegramBotToken.mockResolvedValue({ id: 1, isActive: false, name: "disabled", tokenLast4: "0000" });
      mockGetTelegramBotTokenById.mockResolvedValue(undefined);

      const status = await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Test",
        alertCategory: "trades",
      });

      expect(status).toBe("blocked_by_missing_token");
    });

    it("resolves token from channel tokenId", async () => {
      const { telegramService } = await import("../telegram");
      const sendSpy = vi.spyOn(telegramService, "sendToChat");

      mockGetTelegramBotTokenById.mockImplementation(async (id: number) => {
        if (id === 5) return { id: 5, isActive: true, name: "channel-token", tokenLast4: "5555" };
        return undefined;
      });
      mockGetDefaultTelegramBotToken.mockResolvedValue({ id: 1, isActive: true, name: "default", tokenLast4: "1234" });
      mockGetTelegramChats.mockResolvedValue([
        { id: 1, chatId: "-100123", name: "Main", isActive: true, isDefault: true, alertTrades: true, alertErrors: true, alertSystem: true, alertBalance: true, alertHeartbeat: true, alertPreferences: {}, enabledModes: null, enabledAlerts: null, tokenId: 5 },
      ]);
      mockGetActiveTelegramChats.mockResolvedValue([
        { id: 1, chatId: "-100123", name: "Main", isActive: true, isDefault: true, alertTrades: true, alertErrors: true, alertSystem: true, alertBalance: true, alertHeartbeat: true, alertPreferences: {}, enabledModes: null, enabledAlerts: null, tokenId: 5 },
      ]);

      await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Token test",
        alertCategory: "trades",
      });

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(mockInsertTelegramAlertEvent).toHaveBeenCalledWith(
        expect.objectContaining({ tokenId: 5 }),
      );
    });

    it("audits sent alert with tokenId and channelId", async () => {
      await telegramNotificationCenter.send({
        sourceModule: "tradingEngine",
        mode: "spot",
        alertType: "trade_buy",
        message: "Buy!",
        pair: "BTC/USD",
        alertCategory: "trades",
      });

      expect(mockInsertTelegramAlertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "sent",
          tokenId: 1,
          channelId: 1,
          chatId: "-100123",
        }),
      );
    });

    it("sendToSpecificChat resolves token and audits with tokenId", async () => {
      await telegramNotificationCenter.sendToSpecificChat("-100123", {
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Direct",
        alertCategory: "trades",
      });

      expect(mockInsertTelegramAlertEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "sent",
          tokenId: 1,
          channelId: 1,
          chatId: "-100123",
        }),
      );
    });

    it("sendToSpecificChat blocks when token is missing", async () => {
      mockGetDefaultTelegramBotToken.mockResolvedValue(undefined);
      mockGetTelegramBotTokenById.mockResolvedValue(undefined);

      const status = await telegramNotificationCenter.sendToSpecificChat("-100123", {
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "No token",
      });

      expect(status).toBe("blocked_by_missing_token");
    });

    it("sendToSpecificChat blocks when token is disabled", async () => {
      mockGetDefaultTelegramBotToken.mockResolvedValue({ id: 2, isActive: false, name: "disabled", tokenLast4: "0000" });
      mockGetTelegramBotTokenById.mockResolvedValue(undefined);

      const status = await telegramNotificationCenter.sendToSpecificChat("-100123", {
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Disabled token",
      });

      expect(status).toBe("blocked_by_missing_token");
    });

    it("authorizeCommand returns tokenId when token is valid", async () => {
      const result = await telegramNotificationCenter.authorizeCommand("-100123", "/status");
      expect(result.authorized).toBe(true);
      expect(result.tokenId).toBe(1);
    });

    it("authorizeCommand rejects when token is missing", async () => {
      mockGetDefaultTelegramBotToken.mockResolvedValue(undefined);
      mockGetTelegramBotTokenById.mockResolvedValue(undefined);

      const result = await telegramNotificationCenter.authorizeCommand("-100123", "/status");
      expect(result.authorized).toBe(false);
    });

    it("authorizeCommand resolves deprecated alias to canonical command", async () => {
      const result = await telegramNotificationCenter.authorizeCommand("-100123", "/estado");
      expect(result.authorized).toBe(true);
      expect(result.definition?.name).toBe("/status");
    });

    it("blocks when alert rule is disabled for legacy channel", async () => {
      mockGetTelegramAlertRules.mockResolvedValue([
        { id: 10, mode: "trading", alertType: "trade_buy", enabled: false, chatId: 1 },
      ]);

      const status = await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Test",
        alertCategory: "trades",
      });

      expect(status).toBe("blocked_by_alert_rule_disabled");
    });

    it("legacy channel with importedFromLegacy=true has alert rules disabled", async () => {
      // This tests the migration 067/068 behavior
      mockGetTelegramChats.mockResolvedValue([
        { id: 1, chatId: "-100123", name: "Legacy API Config", isActive: false, isDefault: false, alertTrades: true, alertErrors: true, alertSystem: true, alertBalance: true, alertHeartbeat: true, alertPreferences: { importedFromLegacy: "true", needsUserReview: "true" }, enabledModes: null, enabledAlerts: null, tokenId: null },
      ]);
      mockGetActiveTelegramChats.mockResolvedValue([]);

      mockGetTelegramAlertRules.mockResolvedValue([
        { id: 10, mode: "trading", alertType: "all", enabled: false, chatId: 1 },
      ]);

      const status = await telegramNotificationCenter.send({
        sourceModule: "test",
        mode: "spot",
        alertType: "trade_buy",
        message: "Test",
        alertCategory: "trades",
      });

      // Should be blocked by alert rule disabled OR missing channel (since legacy is inactive)
      expect(status === "blocked_by_alert_rule_disabled" || status === "blocked_by_missing_channel").toBe(true);
    });
  });
});
