/**
 * Tests for the sell quantity dust-tolerance fix.
 *
 * Root cause: BTC #24 had requested=0.01799884, available=0.01798263 (diff=0.0901%).
 * The old AND(pct=0.20%, abs=0.00001000) check failed because diff(0.00001621) > abs(0.00001000).
 * Fix: use dynamic tolerance = max(2 base units, 0.25% of requestedQty).
 *
 * Tests:
 *   A. Caso real BTC #24 — debe pasar, sellQty <= available, adjusted=true
 *   B. Diferencia grande — debe lanzar insufficient_exchange_balance
 *   C. Available >= requested — sin ajuste, adjusted=false
 *   D. Partial close — NUNCA ajusta, lanza aunque diff sea mínimo
 *   E. Caso trailing — misma función, mismo comportamiento
 *   F. Edge: diff exactamente en el límite del 0.25%
 *   G. Edge: diff 1 satoshi sobre el límite — lanza
 */

import { describe, it, expect } from "vitest";

// ─── Reproduce the function under test (extracted logic) ──────────────────────
// We test the pure function logic, not the async wrapper.

function computeLiveSellQtyWithDustTolerance(
  requestedQty: number,
  availableQty: number,
  isFullClose: boolean,
  asset: string
): { sellQty: number; adjusted: boolean; reason: string | null } {
  if (availableQty >= requestedQty) {
    return { sellQty: requestedQty, adjusted: false, reason: null };
  }
  const diff = requestedQty - availableQty;
  const diffPct = requestedQty > 0 ? (diff / requestedQty) * 100 : 100;
  const dustTolerance = Math.max(0.00000002, requestedQty * 0.0025); // 0.25% relative

  if (isFullClose && diff <= dustTolerance) {
    return {
      sellQty: availableQty,
      adjusted: true,
      reason: `fee_dust_quantity_adjustment: requested=${requestedQty.toFixed(8)}, available=${availableQty.toFixed(8)}, diff=${diff.toFixed(8)} (${diffPct.toFixed(4)}%) tolerance=${dustTolerance.toFixed(8)}`,
    };
  }

  throw new Error(
    `insufficient_exchange_balance: requested=${requestedQty.toFixed(8)} ${asset}, ` +
    `available=${availableQty.toFixed(8)}, diff=${diff.toFixed(8)} (${diffPct.toFixed(4)}%)`
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("computeLiveSellQtyWithDustTolerance", () => {

  /**
   * A. CASO REAL BTC #24
   * requested=0.01799884, available=0.01798263, diff=0.00001621 (0.0901%)
   * Con la corrección: dustTolerance = 0.01799884 * 0.0025 = 0.00004497 > 0.00001621
   * => canSell=true, sellQty=available, adjusted=true
   */
  it("A: BTC #24 real case — diff 0.0901% should be absorbed (canSell=true)", () => {
    const requested = 0.01799884;
    const available = 0.01798263;

    const result = computeLiveSellQtyWithDustTolerance(requested, available, true, "BTC");

    expect(result.adjusted).toBe(true);
    expect(result.sellQty).toBe(available);
    expect(result.sellQty).toBeLessThanOrEqual(available);
    expect(result.reason).toContain("fee_dust_quantity_adjustment");

    // Verify we would NOT throw (the old bug)
    const diff = requested - available;
    const diffPct = (diff / requested) * 100;
    expect(diffPct).toBeCloseTo(0.0901, 3);
    expect(diff).toBeCloseTo(0.00001621, 8);
  });

  /**
   * B. DIFERENCIA GRANDE
   * requested=0.01799884, available=0.01600000, diff=0.00199884 (11.1%)
   * => debe lanzar insufficient_exchange_balance
   */
  it("B: large shortage (11.1%) should throw insufficient_exchange_balance", () => {
    const requested = 0.01799884;
    const available = 0.01600000;

    expect(() =>
      computeLiveSellQtyWithDustTolerance(requested, available, true, "BTC")
    ).toThrow("insufficient_exchange_balance");
  });

  /**
   * C. AVAILABLE >= REQUESTED
   * Sin ajuste necesario, adjusted=false
   */
  it("C: available >= requested — no adjustment, adjusted=false", () => {
    const requested = 0.01799884;
    const available = 0.01799884; // exact match

    const result = computeLiveSellQtyWithDustTolerance(requested, available, true, "BTC");

    expect(result.adjusted).toBe(false);
    expect(result.sellQty).toBe(requested);
    expect(result.reason).toBeNull();
  });

  it("C2: available > requested — no adjustment", () => {
    const result = computeLiveSellQtyWithDustTolerance(0.01, 0.015, true, "BTC");
    expect(result.adjusted).toBe(false);
    expect(result.sellQty).toBe(0.01);
  });

  /**
   * D. PARTIAL CLOSE — NUNCA debe ajustar
   * isFullClose=false: aunque diff sea pequeño, debe lanzar
   */
  it("D: partial close — never adjusts even for tiny diff, always throws", () => {
    const requested = 0.01799884;
    const available = 0.01798263; // same as BTC #24 case

    expect(() =>
      computeLiveSellQtyWithDustTolerance(requested, available, false, "BTC")
    ).toThrow("insufficient_exchange_balance");
  });

  /**
   * E. ETH TRAILING — misma función, mismo comportamiento
   * ETH qty tipica: requested=0.5, available=0.4988 (diff=0.0024, 0.24%)
   * dustTolerance = 0.5 * 0.0025 = 0.00125
   * 0.0012 <= 0.00125 => adjusted=true
   */
  it("E: ETH trailing exit — diff 0.24% absorbed (canSell=true)", () => {
    const requested = 0.5;
    const available  = 0.4988; // diff=0.0012, pct=0.24%

    const result = computeLiveSellQtyWithDustTolerance(requested, available, true, "ETH");

    expect(result.adjusted).toBe(true);
    expect(result.sellQty).toBe(available);
  });

  /**
   * F. EXACTAMENTE EN EL LÍMITE: diff = dustTolerance exacto
   * requestedQty * 0.0025 = dustTolerance — diff ≤ tolerance => pasa
   */
  it("F: diff exactly at dust tolerance boundary — should pass", () => {
    const requested = 0.01799884;
    const dustTolerance = Math.max(0.00000002, requested * 0.0025);
    const available = requested - dustTolerance; // diff = dustTolerance

    const result = computeLiveSellQtyWithDustTolerance(requested, available, true, "BTC");

    expect(result.adjusted).toBe(true);
    expect(result.sellQty).toBeCloseTo(available, 8);
  });

  /**
   * G. 1 SATOSHI SOBRE EL LÍMITE — debe lanzar
   * diff = dustTolerance + 0.00000001 => supera tolerancia => throws
   */
  it("G: 1 satoshi above dust tolerance — should throw", () => {
    const requested = 0.01799884;
    const dustTolerance = Math.max(0.00000002, requested * 0.0025);
    const available = requested - dustTolerance - 0.00000001; // 1 satoshi over limit

    expect(() =>
      computeLiveSellQtyWithDustTolerance(requested, available, true, "BTC")
    ).toThrow("insufficient_exchange_balance");
  });
});

// ─── verifyBalance logic (IdcaExitExecutor) ──────────────────────────────────

describe("verifyBalance logic (IdcaExitExecutor equivalent)", () => {

  function verifyBalanceSync(
    quantityToSell: number,
    available: number,
    isFullClose: boolean,
    asset: string
  ): number {
    if (available <= 0) throw new Error(`balance_zero: balance de ${asset} es 0 en exchange.`);
    if (available >= quantityToSell) return quantityToSell;

    const diff = quantityToSell - available;
    const diffPct = quantityToSell > 0 ? (diff / quantityToSell) * 100 : 100;
    const dustTolerance = Math.max(0.00000002, quantityToSell * 0.0025);

    if (isFullClose && diff <= dustTolerance) return available;

    throw new Error(
      `insufficient_exchange_balance: ciclo requiere ${quantityToSell.toFixed(8)} ${asset}, ` +
      `disponible ${available.toFixed(8)}. Diferencia ${diff.toFixed(8)} (${diffPct.toFixed(4)}%) supera tolerancia.`
    );
  }

  it("BTC #24 case via verifyBalance path — returns available qty", () => {
    const result = verifyBalanceSync(0.01799884, 0.01798263, true, "BTC");
    expect(result).toBe(0.01798263);
  });

  it("balance_zero throws", () => {
    expect(() => verifyBalanceSync(0.01, 0, true, "BTC")).toThrow("balance_zero");
  });

  it("large shortage throws", () => {
    expect(() => verifyBalanceSync(0.01799884, 0.016, true, "BTC")).toThrow("insufficient_exchange_balance");
  });
});
