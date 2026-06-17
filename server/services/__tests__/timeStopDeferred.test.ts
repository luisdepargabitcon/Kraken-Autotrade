/**
 * timeStopDeferred.test.ts
 * FASE 9 — Tests unitarios para lógica de TimeStop deferral y classifyExitReason
 *
 * Tests cubiertos:
 *  T1-T6:  softMode gate con minProfitPctToExit (lógica pura)
 *  T7-T12: classifyExitReason (clasificación de razones de salida)
 *  T13-T15: Detección de duplicados (lógica del endpoint)
 *
 * Run: npx tsx server/services/__tests__/timeStopDeferred.test.ts
 */

import { classifyExitReason } from "../../utils/exitReasonClassifier";

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function test(name: string, fn: () => void): void {
  console.log(`\n📋 ${name}`);
  fn();
}

// ─── Lógica pura de softMode gate (extraída de TimeStopService) ───────────────

interface SoftModeGateResult {
  shouldClose: boolean;
  softModeBlocked: boolean;
  reason: string;
}

function evaluateSoftModeGate(params: {
  expired: boolean;
  timeStopDisabled: boolean;
  softMode: boolean;
  minProfitPctToExit: number;
  priceChangePct?: number;
  roundTripFeePct?: number;
}): SoftModeGateResult {
  const { expired, timeStopDisabled, softMode, minProfitPctToExit, priceChangePct, roundTripFeePct } = params;

  if (!expired) return { shouldClose: false, softModeBlocked: false, reason: "not_expired" };
  if (timeStopDisabled) return { shouldClose: false, softModeBlocked: false, reason: "toggle_disabled" };

  // softMode gate
  if (softMode && typeof priceChangePct === "number") {
    const fee = typeof roundTripFeePct === "number" ? roundTripFeePct : 0;
    const netPnlPct = priceChangePct - fee;
    if (netPnlPct < minProfitPctToExit) {
      return {
        shouldClose: false,
        softModeBlocked: true,
        reason: `deferred: netPnl=${netPnlPct.toFixed(3)}% < minProfit=${minProfitPctToExit.toFixed(3)}%`,
      };
    }
  }

  return { shouldClose: true, softModeBlocked: false, reason: "close_allowed" };
}

// ─── TESTS: softMode gate ─────────────────────────────────────────────────────

test("T1: NOT expired → no cierra, no softModeBlocked", () => {
  const result = evaluateSoftModeGate({
    expired: false,
    timeStopDisabled: false,
    softMode: true,
    minProfitPctToExit: 0.25,
    priceChangePct: -1.0,
    roundTripFeePct: 0.16,
  });
  assert(result.shouldClose === false, "shouldClose debe ser false");
  assert(result.softModeBlocked === false, "softModeBlocked debe ser false (no expiró)");
});

test("T2: Expirado + timeStopDisabled=true → no cierra (toggle)", () => {
  const result = evaluateSoftModeGate({
    expired: true,
    timeStopDisabled: true,
    softMode: true,
    minProfitPctToExit: 0.25,
    priceChangePct: 2.0,
    roundTripFeePct: 0.16,
  });
  assert(result.shouldClose === false, "shouldClose debe ser false");
  assert(result.reason === "toggle_disabled", "razón debe ser toggle_disabled");
});

test("T3: Expirado + softMode=true + netPnl negativo → DIFERIDO (softModeBlocked=true)", () => {
  const result = evaluateSoftModeGate({
    expired: true,
    timeStopDisabled: false,
    softMode: true,
    minProfitPctToExit: 0.25,
    priceChangePct: -0.5,
    roundTripFeePct: 0.16,
  });
  assert(result.shouldClose === false, "shouldClose debe ser false");
  assert(result.softModeBlocked === true, "softModeBlocked debe ser true");
  assert(result.reason.includes("deferred"), "razón debe contener 'deferred'");
});

test("T4: Expirado + softMode=true + netPnl < minProfitPctToExit → DIFERIDO", () => {
  const result = evaluateSoftModeGate({
    expired: true,
    timeStopDisabled: false,
    softMode: true,
    minProfitPctToExit: 0.25,
    priceChangePct: 0.30,
    roundTripFeePct: 0.16,
  });
  // netPnl = 0.30 - 0.16 = 0.14% < minProfit 0.25%
  assert(result.shouldClose === false, "shouldClose debe ser false (netPnl=0.14 < minProfit=0.25)");
  assert(result.softModeBlocked === true, "softModeBlocked debe ser true");
});

test("T5: Expirado + softMode=true + netPnl >= minProfitPctToExit → CIERRA", () => {
  const result = evaluateSoftModeGate({
    expired: true,
    timeStopDisabled: false,
    softMode: true,
    minProfitPctToExit: 0.25,
    priceChangePct: 0.50,
    roundTripFeePct: 0.16,
  });
  // netPnl = 0.50 - 0.16 = 0.34% >= minProfit 0.25%
  assert(result.shouldClose === true, "shouldClose debe ser true (netPnl=0.34 >= minProfit=0.25)");
  assert(result.softModeBlocked === false, "softModeBlocked debe ser false");
});

test("T6: Expirado + softMode=false → SIEMPRE CIERRA (backward compat)", () => {
  const result = evaluateSoftModeGate({
    expired: true,
    timeStopDisabled: false,
    softMode: false,
    minProfitPctToExit: 0.25,
    priceChangePct: -5.0,
    roundTripFeePct: 0.16,
  });
  assert(result.shouldClose === true, "softMode=false ignora PnL → shouldClose=true");
  assert(result.softModeBlocked === false, "softModeBlocked debe ser false cuando softMode=false");
});

test("T6b: Expirado + softMode=true + sin priceChangePct → CIERRA (no-op backward compat)", () => {
  const result = evaluateSoftModeGate({
    expired: true,
    timeStopDisabled: false,
    softMode: true,
    minProfitPctToExit: 0.25,
    // priceChangePct no se pasa
  });
  assert(result.shouldClose === true, "sin priceChangePct → gate es no-op → shouldClose=true");
  assert(result.softModeBlocked === false, "softModeBlocked debe ser false");
});

// ─── TESTS: classifyExitReason ────────────────────────────────────────────────

test("T7: classifyExitReason — TimeStop", () => {
  assert(classifyExitReason("TimeStop expirado (40h >= 36.0h) [TREND]") === "TIME_STOP", "TimeStop en inglés");
  assert(classifyExitReason("time-stop expired por régimen") === "TIME_STOP", "time-stop con guión");
  assert(classifyExitReason("TimeStop DIFERIDO — P&L neto -0.14%") === "TIME_STOP", "TimeStop diferido");
});

test("T8: classifyExitReason — Break Even", () => {
  assert(classifyExitReason("Break-even hit BE_HIT stop=100.45") === "BREAK_EVEN", "BE_HIT");
  assert(classifyExitReason("Breakeven activado cushion=0.45%") === "BREAK_EVEN", "Breakeven sin guión");
});

test("T9: classifyExitReason — Trailing Stop", () => {
  assert(classifyExitReason("TRAIL_HIT currentPrice=98.5 <= stop=99.0") === "TRAILING_STOP", "TRAIL_HIT");
  assert(classifyExitReason("Trailing stop hit") === "TRAILING_STOP", "Trailing stop");
});

test("T10: classifyExitReason — Emergency SL", () => {
  assert(classifyExitReason("Stop-Loss emergencia -5.2%") === "EMERGENCY_SL", "emergencia español");
  assert(classifyExitReason("SL_EMERGENCY priceChange=-6%") === "EMERGENCY_SL", "SL_EMERGENCY");
  // Must be classified as EMERGENCY_SL, not STOP_LOSS
  assert(classifyExitReason("Stop-Loss emergencia (−5.5% < −5%)") !== "STOP_LOSS", "emergencia no es STOP_LOSS genérico");
});

test("T11: classifyExitReason — Smart Exit", () => {
  assert(classifyExitReason("Smart Exit técnico confirmado score=4.5") === "SMART_EXIT", "Smart Exit");
  assert(classifyExitReason("smart_exit triggered") === "SMART_EXIT", "smart_exit snake_case");
});

test("T12: classifyExitReason — Scale Out / Take Profit / UNKNOWN", () => {
  assert(classifyExitReason("Scale-out parcial 35%") === "SCALE_OUT", "Scale-out");
  assert(classifyExitReason("TP fijo activado +10%") === "TAKE_PROFIT", "TP fijo");
  assert(classifyExitReason(null) === "UNKNOWN", "null → UNKNOWN");
  assert(classifyExitReason("") === "UNKNOWN", "string vacío → UNKNOWN");
  assert(classifyExitReason("Orden manual usuario") === "UNKNOWN", "razón desconocida → UNKNOWN");
});

// ─── TESTS: duplicate detection logic ────────────────────────────────────────

test("T13: Detección de duplicados — mismo entrySimTxid", () => {
  const sells = [
    { entrySimTxid: "DRY-001", pnlUsd: -5.0 },
    { entrySimTxid: "DRY-001", pnlUsd: -5.0 }, // duplicado
    { entrySimTxid: "DRY-002", pnlUsd: 3.0 },
  ];

  const entryTxidCount = new Map<string, number>();
  for (const s of sells) {
    if (s.entrySimTxid) {
      entryTxidCount.set(s.entrySimTxid, (entryTxidCount.get(s.entrySimTxid) ?? 0) + 1);
    }
  }
  const duplicates = Array.from(entryTxidCount.entries()).filter(([, count]) => count > 1);

  assert(duplicates.length === 1, "debe detectar 1 duplicado");
  assert(duplicates[0][0] === "DRY-001", "duplicado debe ser DRY-001");
  assert(duplicates[0][1] === 2, "DRY-001 aparece 2 veces");
});

test("T14: Sin duplicados → lista vacía", () => {
  const sells = [
    { entrySimTxid: "DRY-001", pnlUsd: -5.0 },
    { entrySimTxid: "DRY-002", pnlUsd: 3.0 },
    { entrySimTxid: "DRY-003", pnlUsd: 1.5 },
  ];

  const entryTxidCount = new Map<string, number>();
  for (const s of sells) {
    if (s.entrySimTxid) {
      entryTxidCount.set(s.entrySimTxid, (entryTxidCount.get(s.entrySimTxid) ?? 0) + 1);
    }
  }
  const duplicates = Array.from(entryTxidCount.entries()).filter(([, count]) => count > 1);
  assert(duplicates.length === 0, "sin duplicados → lista vacía");
});

test("T15: Duplicados sin entrySimTxid (orphan sells) no se detectan como duplicados", () => {
  const sells = [
    { entrySimTxid: null, pnlUsd: -5.0 },
    { entrySimTxid: null, pnlUsd: -3.0 }, // ambos sin match
  ];

  const entryTxidCount = new Map<string, number>();
  for (const s of sells) {
    if (s.entrySimTxid) {
      entryTxidCount.set(s.entrySimTxid, (entryTxidCount.get(s.entrySimTxid) ?? 0) + 1);
    }
  }
  const duplicates = Array.from(entryTxidCount.entries()).filter(([, count]) => count > 1);
  assert(duplicates.length === 0, "sells sin entrySimTxid no se cuentan como duplicados");
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"=".repeat(55)}`);
console.log(`📊 Resultados: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("✅ Todos los tests pasaron");
} else {
  console.error(`❌ ${failed} test(s) fallaron`);
  process.exit(1);
}
