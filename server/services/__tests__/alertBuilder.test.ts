/**
 * AlertBuilder Module — Unit Tests
 *
 * Tests: buildTimeStopAlertMessage, sendTimeStopAlert, checkExpiredTimeStopPositions, forceTimeStopAlerts
 * Run: npx tsx server/services/__tests__/alertBuilder.test.ts
 */

import {
  buildTimeStopAlertMessage,
  sendTimeStopAlert,
  checkExpiredTimeStopPositions,
  forceTimeStopAlerts,
  type IAlertBuilderHost,
  type AlertOpenPosition,
  type AlertExitConfig,
} from "../alertBuilder";

// ===================== TEST RUNNER =====================

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    console.log(`  ❌ ${testName}`);
  }
}

// ===================== MOCK HOST =====================

function createMockHost(overrides: Partial<IAlertBuilderHost> = {}): IAlertBuilderHost {
  const positions = new Map<string, AlertOpenPosition>();
  const sentMessages: string[] = [];

  return {
    isTelegramInitialized: () => true,
    sendTelegramAlert: async (msg) => { sentMessages.push(msg); },
    getCurrentPrice: async () => 50000,
    calculateMinCloseNetPct: (e, x, b) => e + x + b,
    getAdaptiveExitConfig: async () => ({
      takerFeePct: 0.4,
      profitBufferPct: 0.2,
      timeStopHours: 48,
      timeStopMode: "soft" as const,
    }),
    getOpenPositions: () => positions,
    setPosition: (lotId, pos) => { positions.set(lotId, pos); },
    savePositionToDB: async () => {},
    // Expose internal state for assertions
    _sentMessages: sentMessages,
    _positions: positions,
    ...overrides,
  } as any;
}

// ===================== TESTS =====================

console.log("\n=== buildTimeStopAlertMessage ===");
{
  // HARD mode message
  const hardMsg = buildTimeStopAlertMessage("BTC/USD", 50, 48, "hard", 2.5, 1.0);
  assert(hardMsg.includes("Time-Stop HARD"), "hard mode includes HARD label");
  assert(hardMsg.includes("BTC/USD"), "message includes pair");
  assert(hardMsg.includes("50 horas"), "message includes age");
  assert(hardMsg.includes("48 horas"), "message includes configured limit");
  assert(hardMsg.includes("+2.50%"), "message includes positive price change");
  assert(hardMsg.includes("INMEDIATAMENTE"), "hard mode mentions immediate close");

  // SOFT mode message
  const softMsg = buildTimeStopAlertMessage("ETH/USD", 50, 48, "soft", -1.5, 1.0);
  assert(softMsg.includes("Time-Stop Alcanzado"), "soft mode label");
  assert(softMsg.includes("-1.50%"), "message includes negative price change");
  assert(softMsg.includes("+1.00%"), "message includes minCloseNetPct");
  assert(softMsg.includes("manualmente"), "soft mode mentions manual close option");
}

console.log("\n=== sendTimeStopAlert ===");
{
  // Success case
  const host1 = createMockHost();
  const position: AlertOpenPosition = {
    lotId: "lot-1",
    pair: "BTC/USD",
    amount: 0.001,
    entryPrice: 48000,
    openedAt: Date.now() - 50 * 60 * 60 * 1000, // 50 hours ago
  };
  const exitConfig: AlertExitConfig = { takerFeePct: 0.4, profitBufferPct: 0.2, timeStopHours: 48, timeStopMode: "soft" };

  const r1 = await sendTimeStopAlert(host1, position, exitConfig);
  assert(r1.success === true, "returns success when telegram sends");
  assert((host1 as any)._sentMessages.length === 1, "one telegram message sent");

  // Telegram not initialized
  const host2 = createMockHost({ isTelegramInitialized: () => false });
  const r2 = await sendTimeStopAlert(host2, position, exitConfig);
  assert(r2.success === false, "fails when telegram not initialized");
  assert(r2.error === "Telegram not initialized", "error message explains cause");

  // Invalid price
  const host3 = createMockHost({ getCurrentPrice: async () => null });
  const r3 = await sendTimeStopAlert(host3, position, exitConfig);
  assert(r3.success === false, "fails when price is null");
  assert(r3.error!.includes("Invalid price"), "error mentions invalid price");

  // Ticker error
  const host4 = createMockHost({
    getCurrentPrice: async () => { throw new Error("API timeout"); },
  });
  const r4 = await sendTimeStopAlert(host4, position, exitConfig);
  assert(r4.success === false, "fails on ticker error");
  assert(r4.error!.includes("Ticker error"), "error mentions ticker");
}

console.log("\n=== checkExpiredTimeStopPositions ===");
{
  // No positions → check 0
  const host1 = createMockHost();
  const r1 = await checkExpiredTimeStopPositions(host1);
  assert(r1.checked === 0, "0 checked when no positions");
  assert(r1.alerted === 0, "0 alerted when no positions");

  // One expired, one not expired
  const positions = new Map<string, AlertOpenPosition>();
  positions.set("lot-expired", {
    lotId: "lot-expired",
    pair: "BTC/USD",
    amount: 0.001,
    entryPrice: 48000,
    openedAt: Date.now() - 50 * 60 * 60 * 1000, // 50h ago (> 48h limit)
  });
  positions.set("lot-fresh", {
    lotId: "lot-fresh",
    pair: "ETH/USD",
    amount: 0.01,
    entryPrice: 3000,
    openedAt: Date.now() - 10 * 60 * 60 * 1000, // 10h ago (< 48h limit)
  });

  const host2 = createMockHost({ getOpenPositions: () => positions });
  const r2 = await checkExpiredTimeStopPositions(host2);
  assert(r2.checked === 2, "2 positions checked");
  assert(r2.alerted === 1, "1 position alerted (expired one)");
  assert(r2.errors === 0, "0 errors");

  // Already notified position → skip
  positions.set("lot-already", {
    lotId: "lot-already",
    pair: "SOL/USD",
    amount: 1,
    entryPrice: 150,
    openedAt: Date.now() - 100 * 60 * 60 * 1000,
    timeStopExpiredAt: Date.now() - 3600000, // already notified
  });
  const host3 = createMockHost({ getOpenPositions: () => positions });
  const r3 = await checkExpiredTimeStopPositions(host3);
  // lot-expired was marked in previous run, lot-fresh is fresh, lot-already was already notified
  assert(r3.checked === 3, "3 positions checked");

  // Telegram not initialized → skip all
  const host4 = createMockHost({
    isTelegramInitialized: () => false,
    getOpenPositions: () => positions,
  });
  const r4 = await checkExpiredTimeStopPositions(host4);
  assert(r4.checked === 0, "0 checked when telegram not initialized");

  // Disabled time-stop position → skip
  const disabledPositions = new Map<string, AlertOpenPosition>();
  disabledPositions.set("lot-disabled", {
    lotId: "lot-disabled",
    pair: "XRP/USD",
    amount: 100,
    entryPrice: 0.5,
    openedAt: Date.now() - 100 * 60 * 60 * 1000,
    timeStopDisabled: true,
  });
  const host5 = createMockHost({ getOpenPositions: () => disabledPositions });
  const r5 = await checkExpiredTimeStopPositions(host5);
  assert(r5.alerted === 0, "0 alerted for disabled time-stop position");
}

console.log("\n=== forceTimeStopAlerts ===");
{
  const positions = new Map<string, AlertOpenPosition>();
  positions.set("lot-1", {
    lotId: "lot-1",
    pair: "BTC/USD",
    amount: 0.001,
    entryPrice: 48000,
    openedAt: Date.now() - 50 * 60 * 60 * 1000, // expired
  });
  positions.set("lot-2", {
    lotId: "lot-2",
    pair: "ETH/USD",
    amount: 0.01,
    entryPrice: 3000,
    openedAt: Date.now() - 10 * 60 * 60 * 1000, // not expired
  });
  positions.set("lot-3", {
    lotId: "lot-3",
    pair: "SOL/USD",
    amount: 1,
    entryPrice: 150,
    openedAt: Date.now() - 100 * 60 * 60 * 1000, // expired but disabled
    timeStopDisabled: true,
  });

  const host = createMockHost({ getOpenPositions: () => positions });
  const r = await forceTimeStopAlerts(host);
  assert(r.checked === 3, "3 positions checked");
  assert(r.alerted === 1, "1 alerted (lot-1 expired)");
  assert(r.skipped === 2, "2 skipped (lot-2 not expired, lot-3 disabled)");
  assert(r.errors === 0, "0 errors");
}

// ===================== SUMMARY =====================

console.log(`\n${"═".repeat(50)}`);
console.log(`alertBuilder.test.ts: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(50)}\n`);

if (failed > 0) process.exit(1);
