/**
 * Telegram Templates Snapshot Tests
 * Validates message structure, required fields, and anti-placeholder compliance
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  buildDailyReportHTML,
  buildBotStartedHTML,
  buildHeartbeatHTML,
  buildTradeBuyHTML,
  buildTradeSellHTML,
  buildPositionsUpdateHTML,
  buildEntryIntentHTML,
  buildErrorAlertHTML,
  escapeHtml,
  formatSpanishDate,
  formatDuration,
  formatAge,
} from "./templates";
import {
  DailyReportContext,
  BotStartedContext,
  HeartbeatContext,
  TradeBuyContext,
  TradeSellContext,
  PositionsUpdateContext,
  EntryIntentContext,
  DailyReportContextSchema,
  TradeBuyContextSchema,
  TradeSellContextSchema,
  validateContext,
} from "./types";

// ============================================================
// TEST FIXTURES
// ============================================================

const mockDailyReportFull: DailyReportContext = {
  env: "NAS/PROD",
  timestamp: new Date("2026-01-23T14:00:00Z"),
  connections: {
    kraken: true,
    revolutx: true,
    db: true,
    telegram: true,
  },
  system: {
    cpu: "0.4%",
    mem: "7.4/7.7 GB (96.4%)",
    memWarning: true,
    disk: "42.1/232.4 GB (18.1%)",
    uptime: "17d 16h 13m",
  },
  bot: {
    dryRun: false,
    mode: "SMART_GUARD",
    strategy: "momentum",
    pairs: ["TON/USD", "BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"],
  },
  portfolio: {
    positionCount: 3,
    exposureUsd: 1087.32,
    positions: [
      { pair: "XRP/USD", exchange: "RevolutX", lotId: "engine-1769186188930-XRPUSD", entryPrice: 3.15, amount: 109.58, exposureUsd: 345.19 },
      { pair: "ETH/USD", exchange: "RevolutX", lotId: "engine-1769172237672-ETHUSD", entryPrice: 3218.45, amount: 0.175, exposureUsd: 563.14 },
      { pair: "TON/USD", exchange: "RevolutX", lotId: "engine-1769172237666-TONUSD", entryPrice: 5.23, amount: 34.22, exposureUsd: 178.99 },
    ],
  },
  pendingOrders: {
    count: 0,
    orders: [],
  },
  syncStatus: [
    { exchange: "Kraken", lastSyncAt: new Date("2026-01-23T13:58:10Z"), ageSeconds: 110 },
    { exchange: "RevolutX", lastSyncAt: new Date("2026-01-23T13:52:05Z"), ageSeconds: 475 },
  ],
};

const mockDailyReportEmpty: DailyReportContext = {
  env: "NAS/PROD",
  timestamp: new Date("2026-01-23T14:00:00Z"),
  connections: {
    kraken: true,
    revolutx: true,
    db: true,
    telegram: true,
  },
  system: {
    cpu: "1.2%",
    mem: "2.1/7.7 GB (27.3%)",
    memWarning: false,
    disk: "42.1/232.4 GB (18.1%)",
    uptime: "5d 2h 30m",
  },
  bot: {
    dryRun: true,
    mode: "SINGLE",
    strategy: "mean_reversion",
    pairs: ["BTC/USD", "ETH/USD"],
  },
  portfolio: {
    positionCount: 0,
    exposureUsd: 0,
    positions: [],
  },
  pendingOrders: {
    count: 0,
    orders: [],
  },
  syncStatus: [
    { exchange: "Kraken", lastSyncAt: null, ageSeconds: null },
    { exchange: "RevolutX", lastSyncAt: new Date("2026-01-23T13:55:00Z"), ageSeconds: 300 },
  ],
};

const mockDailyReportWithPending: DailyReportContext = {
  ...mockDailyReportEmpty,
  portfolio: {
    positionCount: 0,
    exposureUsd: 0,
    positions: [],
  },
  pendingOrders: {
    count: 2,
    orders: [
      { exchange: "RevolutX", pair: "XRP/USD", side: "BUY", orderId: "177b3f2a-abc123", createdAt: new Date("2026-01-23T13:45:00Z") },
      { exchange: "RevolutX", pair: "SOL/USD", side: "BUY", orderId: "188c4g3b-def456", createdAt: new Date("2026-01-23T13:46:00Z") },
    ],
  },
};

const mockTradeBuy: TradeBuyContext = {
  env: "NAS/PROD",
  exchange: "RevolutX",
  pair: "XRP/USD",
  amount: "109.58",
  price: "3.15",
  total: "345.19",
  orderId: "177b3f2a-1234-5678-9abc-def012345678",
  clientOrderId: "client-order-12345",
  lotId: "engine-1769186188930-XRPUSD",
  strategyLabel: "momentum_candles_15m",
  confPct: "85",
  reason: "Momentum Velas COMPRA: EMA10>EMA20, MACD alcista, Volumen alto | Señales: 4/4",
  signalsSummary: "EMA10>EMA20 ✓, MACD+ ✓, Vol 1.8x ✓, RSI 42",
  mode: "SMART_GUARD",
  regime: "TREND",
  regimeReason: "Tendencia alcista (ADX=32, EMAs alineadas)",
  routerStrategy: "momentum_candles_15m",
  timestamp: new Date("2026-01-23T10:30:00Z"),
};

const mockTradeSell: TradeSellContext = {
  env: "NAS/PROD",
  exchange: "RevolutX",
  pair: "ETH/USD",
  amount: "0.175",
  price: "3350.00",
  total: "586.25",
  orderId: "288c4g3b-9876-5432-1fed-cba987654321",
  clientOrderId: "client-order-67890",
  lotId: "engine-1769172237672-ETHUSD",
  exitType: "TRAILING_STOP",
  trigger: "Trail activado en $3380, ejecutado en $3350",
  pnlUsd: 23.11,
  pnlPct: 4.1,
  feeUsd: 1.17,
  strategyLabel: "momentum_candles_15m",
  confPct: "N/A",
  reason: "Trailing stop triggered",
  mode: "SMART_GUARD",
  openedAt: new Date("2026-01-22T08:15:00Z"),
  holdDuration: "1d 2h 15m",
  timestamp: new Date("2026-01-23T10:30:00Z"),
};

const mockBotStarted: BotStartedContext = {
  env: "NAS/PROD",
  strategy: "momentum",
  risk: "medium",
  pairs: ["TON/USD", "BTC/USD", "ETH/USD", "SOL/USD", "XRP/USD"],
  balanceUsd: "1500.00",
  mode: "SMART_GUARD",
  positionCount: 0,
  routerEnabled: true,
  exchanges: ["Kraken", "RevolutX"],
  timestamp: new Date("2026-01-23T08:00:00Z"),
};

const mockHeartbeat: HeartbeatContext = {
  env: "NAS/PROD",
  cpu: "2.1%",
  mem: "5.2/7.7 GB (67.5%)",
  disk: "42.1/232.4 GB (18.1%)",
  uptime: "17d 16h 13m",
  connections: {
    kraken: true,
    revolutx: true,
    db: true,
    telegram: true,
  },
  timestamp: new Date("2026-01-23T20:00:00Z"),
};

const mockPositionsUpdate: PositionsUpdateContext = {
  env: "NAS/PROD",
  positions: [
    {
      pair: "XRP/USD",
      exchange: "RevolutX",
      lotId: "engine-1769186188930-XRPUSD",
      entryPrice: 3.15,
      amount: 109.58,
      currentPrice: 3.22,
      pnlUsd: 7.67,
      pnlPct: 2.2,
      beActivated: true,
      trailingActivated: false,
      openedAt: new Date("2026-01-22T14:30:00Z"),
    },
  ],
  totalExposureUsd: 345.19,
  timestamp: new Date("2026-01-23T14:00:00Z"),
};

const mockEntryIntent: EntryIntentContext = {
  env: "NAS/PROD",
  exchange: "RevolutX",
  pair: "SOL/USD",
  amountUsd: "140.50",
  price: "245.30",
  strategyLabel: "mean_reversion_simple",
  signalReason: "Mean Reversion COMPRA: RSI oversold (28), BB% bajo (12%), precio cerca de banda inferior",
  confidence: 78,
  regime: "RANGE",
  regimeReason: "Mercado lateral (ADX=16, BB width=3.2%)",
  requiredSignals: 5,
  currentSignals: 4,
  timestamp: new Date("2026-01-23T10:45:00Z"),
};

// ============================================================
// HELPER FUNCTIONS TESTS
// ============================================================

describe("Helper Functions", () => {
  describe("escapeHtml", () => {
    it("should escape HTML special characters", () => {
      expect(escapeHtml("<script>alert('xss')</script>")).toBe(
        "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;"
      );
    });

    it("should handle null and undefined", () => {
      expect(escapeHtml(null)).toBe("");
      expect(escapeHtml(undefined)).toBe("");
    });
  });

  describe("formatSpanishDate", () => {
    it("should format date in Spanish timezone", () => {
      const result = formatSpanishDate(new Date("2026-01-23T14:00:00Z"));
      expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    });

    it("should handle invalid dates", () => {
      expect(formatSpanishDate("invalid")).toBe("N/D (fecha inválida)");
    });
  });

  describe("formatDuration", () => {
    it("should format short durations", () => {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
      expect(formatDuration(thirtyMinAgo)).toBe("30m");
    });

    it("should format long durations", () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 - 3 * 60 * 60 * 1000);
      expect(formatDuration(twoDaysAgo)).toMatch(/2d 3h/);
    });

    it("should handle null", () => {
      expect(formatDuration(null)).toBe("N/D");
    });
  });

  describe("formatAge", () => {
    it("should format seconds", () => {
      expect(formatAge(45)).toBe("hace 45s");
    });

    it("should format minutes", () => {
      expect(formatAge(125)).toBe("hace 2m 5s");
    });

    it("should format hours", () => {
      expect(formatAge(3725)).toBe("hace 1h 2m");
    });

    it("should handle null", () => {
      expect(formatAge(null)).toBe("N/D");
    });
  });
});

// ============================================================
// DAILY REPORT TESTS
// ============================================================

describe("Daily Report Template", () => {
  it("should render full report with positions", () => {
    const html = buildDailyReportHTML(mockDailyReportFull);
    
    // Check header
    expect(html).toContain("CHESTER BOT");
    expect(html).toContain("[NAS/PROD]");
    
    // Check connections
    expect(html).toContain("✅ Kraken");
    expect(html).toContain("✅ RevolutX");
    expect(html).toContain("✅ DB");
    expect(html).toContain("✅ Telegram");
    
    // Check system stats with warning
    expect(html).toContain("96.4%");
    expect(html).toContain("⚠️"); // Memory warning
    
    // Check bot config
    expect(html).toContain("SMART_GUARD");
    expect(html).toContain("momentum");
    expect(html).toContain("DRY_RUN");
    expect(html).toContain("NO");
    
    // Check positions
    expect(html).toContain("Posiciones: 3");
    expect(html).toContain("XRP/USD");
    expect(html).toContain("RevolutX");
    expect(html).toContain("$345.19");
    
    // Check sync status
    expect(html).toContain("lastSync");
    expect(html).toContain("hace");
  });

  it("should render empty report without positions", () => {
    const html = buildDailyReportHTML(mockDailyReportEmpty);
    
    expect(html).toContain("Posiciones: 0");
    expect(html).toContain("$0.00");
    expect(html).toContain("Sin órdenes pendientes");
    expect(html).toContain("N/D (sin sincronizar)"); // Kraken no sync
  });

  it("should render report with pending orders (important: no false 0 positions)", () => {
    const html = buildDailyReportHTML(mockDailyReportWithPending);
    
    // Should show pending orders even when positions = 0
    expect(html).toContain("2 pendientes");
    expect(html).toContain("BUY");
    expect(html).toContain("SOL/USD");
    expect(html).toContain("188c4g3b");
  });

  it("should never contain placeholders", () => {
    const html = buildDailyReportHTML(mockDailyReportFull);
    
    expect(html).not.toContain(": -");
    expect(html).not.toContain(": null");
    expect(html).not.toContain(": undefined");
    expect(html).not.toMatch(/:\s*$/m); // No empty values after colon
  });

  it("should validate context with Zod", () => {
    expect(() => {
      validateContext(DailyReportContextSchema, mockDailyReportFull, "DailyReport");
    }).not.toThrow();
  });
});

// ============================================================
// TRADE BUY TESTS
// ============================================================

describe("Trade Buy Template", () => {
  it("should render buy notification with all fields", () => {
    const html = buildTradeBuyHTML(mockTradeBuy);
    
    // Check header and branding
    expect(html).toContain("CHESTER BOT");
    expect(html).toContain("🟢");
    expect(html).toContain("COMPRA");
    
    // Check exchange is explicit
    expect(html).toContain("Exchange");
    expect(html).toContain("RevolutX");
    
    // Check trade details
    expect(html).toContain("XRP/USD");
    expect(html).toContain("$3.15");
    expect(html).toContain("109.58");
    expect(html).toContain("$345.19");
    
    // Check IDs
    expect(html).toContain("OrderID");
    expect(html).toContain("177b3f2a");
    expect(html).toContain("LotID");
    
    // Check regime info
    expect(html).toContain("TREND");
    expect(html).toContain("ADX=32");
    
    // Check signals summary
    expect(html).toContain("EMA10&gt;EMA20");
  });

  it("should validate buy context with Zod", () => {
    expect(() => {
      validateContext(TradeBuyContextSchema, mockTradeBuy, "TradeBuy");
    }).not.toThrow();
  });

  it("should reject invalid buy context", () => {
    const invalidBuy = { ...mockTradeBuy, exchange: "InvalidExchange" };
    expect(() => {
      validateContext(TradeBuyContextSchema, invalidBuy, "TradeBuy");
    }).toThrow();
  });
});

// ============================================================
// TRADE SELL TESTS
// ============================================================

describe("Trade Sell Template", () => {
  it("should render sell notification with P&L", () => {
    const html = buildTradeSellHTML(mockTradeSell);
    
    // Check header
    expect(html).toContain("🔴");
    expect(html).toContain("VENTA");
    
    // Check exchange
    expect(html).toContain("RevolutX");
    
    // Check P&L display
    expect(html).toContain("+$23.11");
    expect(html).toContain("+4.10%");
    expect(html).toContain("📈"); // Positive PnL emoji
    
    // Check exit type
    expect(html).toContain("TRAILING_STOP");
    expect(html).toContain("Trigger");
    
    // Check duration
    expect(html).toContain("1d 2h 15m");
  });

  it("should handle negative P&L", () => {
    const lossTrade: TradeSellContext = {
      ...mockTradeSell,
      pnlUsd: -15.50,
      pnlPct: -2.8,
    };
    const html = buildTradeSellHTML(lossTrade);
    
    expect(html).toContain("$-15.50");
    expect(html).toContain("-2.80%");
    expect(html).toContain("📉"); // Negative PnL emoji
  });

  it("should handle null P&L", () => {
    const noPnlTrade: TradeSellContext = {
      ...mockTradeSell,
      pnlUsd: null,
      pnlPct: null,
    };
    const html = buildTradeSellHTML(noPnlTrade);
    
    expect(html).toContain("N/D");
  });
});

// ============================================================
// BOT STARTED TESTS
// ============================================================

describe("Bot Started Template", () => {
  it("should render startup notification", () => {
    const html = buildBotStartedHTML(mockBotStarted);
    
    expect(html).toContain("Bot Iniciado");
    expect(html).toContain("SMART_GUARD");
    expect(html).toContain("momentum");
    expect(html).toContain("Kraken, RevolutX");
    expect(html).toContain("Router");
    expect(html).toContain("ACTIVO");
    expect(html).toContain("$1500.00");
  });
});

// ============================================================
// HEARTBEAT TESTS
// ============================================================

describe("Heartbeat Template", () => {
  it("should render heartbeat status", () => {
    const html = buildHeartbeatHTML(mockHeartbeat);
    
    expect(html).toContain("Sistema operativo 24x7");
    expect(html).toContain("2.1%");
    expect(html).toContain("17d 16h 13m");
    expect(html).toContain("✅ Kraken");
    expect(html).toContain("✅ RevolutX");
  });
});

// ============================================================
// POSITIONS UPDATE TESTS
// ============================================================

describe("Positions Update Template", () => {
  it("should render positions with P&L and status", () => {
    const html = buildPositionsUpdateHTML(mockPositionsUpdate);
    
    expect(html).toContain("POSICIONES ABIERTAS (1)");
    expect(html).toContain("XRP/USD");
    expect(html).toContain("RevolutX");
    expect(html).toContain("+$7.67");
    expect(html).toContain("🔒 B.E."); // Break-even activated
    expect(html).toContain("$345.19");
  });

  it("should render empty positions", () => {
    const emptyCtx: PositionsUpdateContext = {
      env: "NAS/PROD",
      positions: [],
      totalExposureUsd: 0,
      timestamp: new Date(),
    };
    const html = buildPositionsUpdateHTML(emptyCtx);
    
    expect(html).toContain("Sin posiciones abiertas");
  });
});

// ============================================================
// ENTRY INTENT TESTS
// ============================================================

describe("Entry Intent Template", () => {
  it("should render entry intent with signals", () => {
    const html = buildEntryIntentHTML(mockEntryIntent);
    
    expect(html).toContain("INTENCIÓN DE ENTRADA");
    expect(html).toContain("RevolutX");
    expect(html).toContain("SOL/USD");
    expect(html).toContain("$140.50");
    expect(html).toContain("78%");
    expect(html).toContain("4/5"); // Signals count
    expect(html).toContain("RANGE");
    expect(html).toContain("Mean Reversion");
  });
});

// ============================================================
// ERROR ALERT TESTS
// ============================================================

describe("Error Alert Template", () => {
  it("should render error with meta", () => {
    const html = buildErrorAlertHTML(
      "API Connection Failed",
      "Unable to connect to Kraken API after 3 retries",
      { exchange: "Kraken", retries: 3, lastError: "ETIMEDOUT" }
    );
    
    expect(html).toContain("⚠️");
    expect(html).toContain("API Connection Failed");
    expect(html).toContain("Kraken API");
    expect(html).toContain("exchange");
    expect(html).toContain("ETIMEDOUT");
  });
});

// ============================================================
// ANTI-PLACEHOLDER VALIDATION
// ============================================================

describe("Anti-Placeholder Compliance", () => {
  const allTemplates = [
    { name: "DailyReport", fn: () => buildDailyReportHTML(mockDailyReportFull) },
    { name: "TradeBuy", fn: () => buildTradeBuyHTML(mockTradeBuy) },
    { name: "TradeSell", fn: () => buildTradeSellHTML(mockTradeSell) },
    { name: "BotStarted", fn: () => buildBotStartedHTML(mockBotStarted) },
    { name: "Heartbeat", fn: () => buildHeartbeatHTML(mockHeartbeat) },
    { name: "PositionsUpdate", fn: () => buildPositionsUpdateHTML(mockPositionsUpdate) },
    { name: "EntryIntent", fn: () => buildEntryIntentHTML(mockEntryIntent) },
  ];

  for (const { name, fn } of allTemplates) {
    it(`${name} should not contain placeholder values`, () => {
      const html = fn();
      
      // Should not have raw placeholders
      expect(html).not.toMatch(/:\s*-\s*[<\n]/);
      expect(html).not.toContain(": null");
      expect(html).not.toContain(": undefined");
      expect(html).not.toContain(">null<");
      expect(html).not.toContain(">undefined<");
      
      // Should contain env tag
      expect(html).toContain("NAS/PROD");
      
      // Should contain timestamp
      expect(html).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    });

    it(`${name} should contain CHESTER BOT branding`, () => {
      const html = fn();
      expect(html).toContain("CHESTER BOT");
    });
  }
});

// ============================================================
// SNAPSHOT TESTS (for regression detection)
// ============================================================

describe("Template Snapshots", () => {
  it("DailyReport full snapshot", () => {
    const html = buildDailyReportHTML(mockDailyReportFull);
    expect(html).toMatchSnapshot();
  });

  it("DailyReport empty snapshot", () => {
    const html = buildDailyReportHTML(mockDailyReportEmpty);
    expect(html).toMatchSnapshot();
  });

  it("DailyReport with pending orders snapshot", () => {
    const html = buildDailyReportHTML(mockDailyReportWithPending);
    expect(html).toMatchSnapshot();
  });

  it("TradeBuy snapshot", () => {
    const html = buildTradeBuyHTML(mockTradeBuy);
    expect(html).toMatchSnapshot();
  });

  it("TradeSell snapshot", () => {
    const html = buildTradeSellHTML(mockTradeSell);
    expect(html).toMatchSnapshot();
  });
});
