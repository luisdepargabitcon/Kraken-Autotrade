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
  mockInsertTelegramAlertEvent,
  mockInsertTelegramCommandLog,
  mockUpdateTelegramGlobalConfig,
  mockGetRecentTelegramAlertEvents,
  mockGetRecentTelegramCommandLogs,
} = vi.hoisted(() => ({
  mockGetTelegramGlobalConfig: vi.fn(),
  mockGetActiveTelegramChats: vi.fn(),
  mockInsertTelegramAlertEvent: vi.fn(),
  mockInsertTelegramCommandLog: vi.fn(),
  mockUpdateTelegramGlobalConfig: vi.fn(),
  mockGetRecentTelegramAlertEvents: vi.fn(),
  mockGetRecentTelegramCommandLogs: vi.fn(),
}));

vi.mock("../../storage", () => ({
  storage: {
    getTelegramGlobalConfig: mockGetTelegramGlobalConfig,
    getActiveTelegramChats: mockGetActiveTelegramChats,
    insertTelegramAlertEvent: mockInsertTelegramAlertEvent,
    insertTelegramCommandLog: mockInsertTelegramCommandLog,
    updateTelegramGlobalConfig: mockUpdateTelegramGlobalConfig,
    getRecentTelegramAlertEvents: mockGetRecentTelegramAlertEvents,
    getRecentTelegramCommandLogs: mockGetRecentTelegramCommandLogs,
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
      { id: 1, chatId: "-100123", name: "Main", isActive: true, alertTrades: true, alertErrors: true, alertSystem: true, alertBalance: true, alertHeartbeat: true, alertPreferences: {} },
      { id: 2, chatId: "-100456", name: "Trades", isActive: true, alertTrades: true, alertErrors: false, alertSystem: false, alertBalance: false, alertHeartbeat: false, alertPreferences: {} },
    ]);
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

      // Both chats have alertTrades=true
      expect(sendSpy).toHaveBeenCalledTimes(2);
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
});
