/**
 * Tests para IdcaExchangeFeePresets — Cálculo correcto de fees Revolut X.
 *
 * Verifica:
 * - Preset revolut_x: maker 0%, taker 0.09%
 * - computeEstimatedImportFee calcula correctamente
 * - getExchangeFeePreset con key inválido retorna "other"
 * - DEFAULT_EXCHANGE es revolut_x
 * - Break-even mínimo para ciclo de 600 USD
 */

import { describe, it, expect } from "vitest";
import {
  EXCHANGE_FEE_PRESETS,
  DEFAULT_EXCHANGE,
  getExchangeFeePreset,
  computeEstimatedImportFee,
} from "../institutionalDca/IdcaExchangeFeePresets";

// ─── Preset structure ─────────────────────────────────────────────────────────

describe("IdcaExchangeFeePresets — Revolut X preset", () => {
  it("EF01. DEFAULT_EXCHANGE es revolut_x", () => {
    expect(DEFAULT_EXCHANGE).toBe("revolut_x");
  });

  it("EF02. revolut_x: maker=0%, taker=0.09%, defaultFeeMode=taker", () => {
    const preset = EXCHANGE_FEE_PRESETS.revolut_x;
    expect(preset.makerFeePct).toBe(0.0);
    expect(preset.takerFeePct).toBe(0.09);
    expect(preset.defaultFeePct).toBe(0.09);
    expect(preset.defaultFeeMode).toBe("taker");
    expect(preset.useConfigurableDefault).toBe(false);
  });

  it("EF03. kraken: useConfigurableDefault=true, defaultFeePct=0.25", () => {
    const preset = EXCHANGE_FEE_PRESETS.kraken;
    expect(preset.useConfigurableDefault).toBe(true);
    expect(preset.defaultFeePct).toBe(0.25);
  });

  it("EF04. other: useConfigurableDefault=true, defaultFeePct=0.10", () => {
    const preset = EXCHANGE_FEE_PRESETS.other;
    expect(preset.useConfigurableDefault).toBe(true);
    expect(preset.defaultFeePct).toBe(0.10);
  });

  it("EF05. getExchangeFeePreset con key inválido retorna preset 'other'", () => {
    const preset = getExchangeFeePreset("unknown_exchange");
    expect(preset.key).toBe("other");
  });
});

// ─── Fee calculations ─────────────────────────────────────────────────────────

describe("IdcaExchangeFeePresets — computeEstimatedImportFee", () => {
  it("EF06. Fee Revolut X 0.09% sobre 600 USD = 0.54 USD", () => {
    const fee = computeEstimatedImportFee(600, 0.09);
    expect(fee).toBe(0.54);
  });

  it("EF07. Fee 0% (maker Revolut X) sobre 600 USD = 0 USD", () => {
    const fee = computeEstimatedImportFee(600, 0.0);
    expect(fee).toBe(0);
  });

  it("EF08. Ida+vuelta Revolut X (0.09% entrada + 0.09% salida) sobre 600 USD = 1.08 USD", () => {
    const roundTrip = computeEstimatedImportFee(600, 0.09) + computeEstimatedImportFee(600, 0.09);
    expect(roundTrip).toBeCloseTo(1.08, 2);
  });

  it("EF09. Break-even mínimo ida+vuelta Revolut X ≈ 0.18% de capital de 600 USD", () => {
    const capital = 600;
    const roundTrip = computeEstimatedImportFee(capital, 0.09) * 2;
    const breakEvenPct = (roundTrip / capital) * 100;
    expect(breakEvenPct).toBeCloseTo(0.18, 2);
  });

  it("EF10. Resultado redondeado a 2 decimales", () => {
    const fee = computeEstimatedImportFee(333.33, 0.09);
    expect(fee).toBe(Math.round(333.33 * 0.09 / 100 * 100) / 100);
  });
});

// ─── Net PnL estimation ───────────────────────────────────────────────────────

describe("IdcaExchangeFeePresets — Net PnL estimation logic", () => {
  it("EF11. PnL neto = PnL bruto - fee salida (ciclo activo 600 USD, +3% = +18 USD, fee 0.54 USD → neto +17.46 USD)", () => {
    const capital = 600;
    const grossPnlPct = 3;
    const grossPnlUsd = capital * grossPnlPct / 100; // 18
    const mktVal = capital + grossPnlUsd; // 618
    const exitFee = computeEstimatedImportFee(mktVal, 0.09); // ~0.556
    const netPnlUsd = grossPnlUsd - exitFee;
    expect(netPnlUsd).toBeGreaterThan(17);
    expect(netPnlUsd).toBeLessThan(18);
  });

  it("EF12. Ciclo en pérdida: PnL neto más negativo que bruto", () => {
    const capital = 600;
    const grossPnlUsd = -30; // -5%
    const mktVal = capital + grossPnlUsd; // 570
    const exitFee = computeEstimatedImportFee(mktVal, 0.09);
    const netPnlUsd = grossPnlUsd - exitFee;
    expect(netPnlUsd).toBeLessThan(grossPnlUsd); // más negativo
  });
});
